import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * 视频直链解析
 *
 * 内嵌播放器（YouTube iframe）是浏览器直连第三方加载的。
 * 在走企业代理、只有服务端能出网的环境里，iframe 永远是一片空白。
 *
 * 这里用 yt-dlp 在服务端解析出真正的视频直链，
 * 再经 /api/media（支持 Range）回传，浏览器就能用原生 <video> 播放。
 *
 * 注意：解析出的 googlevideo 直链是「按出口 IP + 时效」签名的，
 * 只有跟解析时同一出口的服务端能拉，所以必须走代理，不能丢给浏览器。
 */

// 优先选音视频合流（progressive）的格式，分离流需要 MSE，原生 <video> 放不了
const FORMAT = [
  'best[ext=mp4][acodec!=none][vcodec!=none][height<=720]',
  'best[acodec!=none][vcodec!=none][height<=720]',
  'best[ext=mp4][acodec!=none][vcodec!=none]',
  'best[acodec!=none][vcodec!=none]',
  'best',
].join('/');

// itag 18（360p mp4 合流）几乎所有视频都有，作为兜底
const FALLBACK_FORMAT = '18/22/best[acodec!=none][vcodec!=none]/best';

const cache = new Map();
const CACHE_MAX = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 直链自带 expire 时间戳，据此决定缓存多久 */
function expiryOf(url) {
  const m = url.match(/[?&]expire=(\d+)/);
  const fallback = Date.now() + 60 * 60_000;
  if (!m) return fallback;
  // 提前 5 分钟过期，避免正播着突然失效
  const at = Number(m[1]) * 1000 - 5 * 60_000;
  return at > Date.now() ? at : fallback;
}

async function runYtdlp(pageUrl, format) {
  let stdout;
  try {
    ({ stdout } = await run('yt-dlp', ['-g', '-f', format, '--no-warnings', '--no-playlist', pageUrl], {
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('本机没有安装 yt-dlp。装一下就能用本地播放：brew install yt-dlp');
    }
    if (err.killed) throw new Error('解析视频直链超时');
    const detail = String(err.stderr || err.message).split('\n').filter(Boolean).pop() || err.message;
    throw new Error(detail);
  }

  // -g 可能输出多行（视频流 + 音频流分离），取第一行即合流地址
  const url = stdout.trim().split('\n')[0];
  if (!url || !/^https?:\/\//.test(url)) throw new Error('yt-dlp 没有返回可用的直链');
  return url;
}

export async function resolveStream(pageUrl) {
  if (!pageUrl) throw new Error('缺少视频地址');

  const hit = cache.get(pageUrl);
  if (hit && Date.now() < hit.expiresAt) return hit.url;

  let url;
  try {
    url = await runYtdlp(pageUrl, FORMAT);
  } catch (err) {
    // YouTube 偶尔只返回分离流（限流/风控时常见），这时合流格式全都选不中。
    // 隔一下换个更宽松的格式再要一次，多数情况就正常了。
    if (!/format is not available/i.test(err.message)) {
      throw new Error(`解析视频直链失败：${err.message}`);
    }
    await sleep(1500);
    try {
      url = await runYtdlp(pageUrl, FALLBACK_FORMAT);
    } catch (retryErr) {
      throw new Error(
        /format is not available/i.test(retryErr.message)
          ? '这个视频暂时没有可直接播放的合流格式（YouTube 限流时会这样），过一会儿再试。'
          : `解析视频直链失败：${retryErr.message}`
      );
    }
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(pageUrl, { url, expiresAt: expiryOf(url) });
  return url;
}
