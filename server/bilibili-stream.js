import { createHash } from 'node:crypto';
import { biliAppRequest, BILI_UA } from './feeds.js';
import { getAuth } from './bilibili-auth.js';

/**
 * B 站播放地址解析
 *
 * 内嵌播放器（player.bilibili.com iframe）未登录状态下清晰度经常给得很低，
 * 这里用安卓签名接口直接要 durl（渐进式 mp4，可直接 <video src> 播放，
 * 不需要 MediaSource Extensions 拼流），默认在站内播放并支持选择清晰度。
 *
 * 已登录时会带上 access_token；实际清晰度由平台权限和视频格式决定。
 */

const cache = new Map();
const CACHE_MAX = 100;

/** 直链自带 deadline 时间戳（秒），据此决定缓存多久 */
function expiryOf(url) {
  const m = url.match(/[?&]deadline=(\d+)/);
  const fallback = Date.now() + 60 * 60_000;
  if (!m) return fallback;
  // 提前 5 分钟过期，避免正播着突然失效
  const at = Number(m[1]) * 1000 - 5 * 60_000;
  return at > Date.now() ? at : fallback;
}

function extractBvid(pageUrl) {
  const m = String(pageUrl || '').match(/\/(BV[\w]+)/);
  if (!m) throw new Error('不是有效的 B 站视频链接');
  return m[1];
}

async function fetchCid(bvid) {
  const res = await fetch(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`, {
    headers: { 'user-agent': BILI_UA },
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  const cid = json.data?.[0]?.cid;
  if (!cid) throw new Error('没能拿到该视频的分 P 信息（cid）');
  return cid;
}

export async function resolveBilibiliStream(pageUrl, quality = 80) {
  if (!pageUrl) throw new Error('缺少视频地址');
  if (![64, 80].includes(quality)) throw new Error('只支持 720P 或 1080P');
  const auth = getAuth();
  const identity = auth?.accessToken
    ? createHash('sha256').update(auth.accessToken).digest('hex')
    : 'anonymous';
  const cacheKey = `${pageUrl}:${quality}:${identity}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() < hit.expiresAt) return hit.stream;

  const bvid = extractBvid(pageUrl);
  const cid = await fetchCid(bvid);

  const params = {
    bvid,
    cid,
    // 64 = 720P，80 = 1080P；响应中的 quality 才是实际返回清晰度。
    qn: quality,
    fnval: 1,
    platform: 'html5',
  };
  if (auth?.accessToken) params.access_token = auth.accessToken;

  const data = await biliAppRequest('https://api.bilibili.com/x/player/playurl', params);
  const url = data?.durl?.[0]?.url;
  if (!url) throw new Error('这个视频没有可直接播放的清晰度（可能仅支持分离流，暂不支持）');
  if (data.durl.length !== 1) throw new Error('这个视频包含多个播放分段，暂不支持站内播放');
  const actualQuality = Number(data.quality) || null;
  const description = data.accept_description?.[data.accept_quality?.indexOf(actualQuality)];
  const stream = {
    url,
    quality: actualQuality,
    qualityLabel: description || ({ 64: '720P', 80: '1080P' }[actualQuality]) || '未知清晰度',
    needsLogin: quality === 80 && !auth && actualQuality !== null && actualQuality < 80,
  };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { stream, expiresAt: expiryOf(url) });
  return stream;
}
