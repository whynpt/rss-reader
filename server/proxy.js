import { Readable } from 'node:stream';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/**
 * 只允许代理公网地址。
 * 否则这个接口就成了打进本机/内网的跳板（SSRF）。
 */
function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http/https');
  const host = u.hostname;
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host === '0.0.0.0';
  if (blocked) throw new Error('不允许代理内网地址');
  return u;
}

/** 拿到响应头就停表；后续的流式传输不该受超时限制 */
async function fetchWithHeaderTimeout(url, { headers, ms = 15_000, onAbort }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  onAbort?.(ctrl);
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
    return { res, ctrl, clear: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function refererFor(hostname, origin) {
  // hdslb.com 是图床，bilivideo.com 是视频 CDN，两个都得带 bilibili.com 的 referer
  if (/hdslb\.com|bilivideo\.com|bilibili/i.test(hostname)) return 'https://www.bilibili.com/';
  if (/ytimg\.com|youtube/i.test(hostname)) return 'https://www.youtube.com/';
  return origin;
}

/* ================================ 封面图 ================================ */

/**
 * 很多播客的封面是 3000×3000 的原图，图床要现场缩放，
 * 慢的能拖到 20 秒以上。我们只显示 270px 宽，直接向图床要小图。
 */
function shrinkImageUrl(raw) {
  try {
    const u = new URL(raw);
    if (/(^|\.)imgix\.net$/i.test(u.hostname)) {
      u.searchParams.delete('max-w');
      u.searchParams.delete('max-h');
      u.searchParams.set('w', '480');
      u.searchParams.set('auto', 'format,compress');
      return u.toString();
    }
    if (/(^|\.)hdslb\.com$/i.test(u.hostname) && !/@\d+w/.test(u.pathname)) {
      return `${raw}@480w.webp`;
    }
    return raw;
  } catch {
    return raw;
  }
}

const imgCache = new Map();
const imgFailures = new Map();
const IMG_CACHE_MAX = 400;
// 超时多半是图床在冷渲染，过一会儿就好了，冷却短一点；
// 4xx/5xx 是硬失败（链接失效、防盗链），没必要频繁重试。
const COOLDOWN_TIMEOUT = 60_000;
const COOLDOWN_HARD = 10 * 60_000;

// 1×1 透明 PNG：失败时回它，前端就不会反复重试同一张挂掉的图
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function sendBlank(res) {
  res.set('content-type', 'image/png');
  res.set('cache-control', 'public, max-age=600');
  res.send(BLANK_PNG);
}

export async function imageProxy(req, res) {
  const raw = req.query.url;
  if (!raw || !/^https?:\/\//i.test(raw)) return sendBlank(res);

  let u;
  try {
    u = assertPublicUrl(raw);
  } catch {
    return sendBlank(res);
  }

  const target = shrinkImageUrl(raw);

  const cached = imgCache.get(target);
  if (cached) {
    res.set('content-type', cached.type);
    res.set('cache-control', 'public, max-age=604800');
    return res.send(cached.body);
  }

  // 之前失败过且还在冷却期，直接给占位，不再去撞同一堵墙
  const failed = imgFailures.get(target);
  if (failed && Date.now() < failed.until) return sendBlank(res);

  try {
    const { res: upstream, clear } = await fetchWithHeaderTimeout(target, {
      headers: { 'user-agent': UA, referer: refererFor(u.hostname, u.origin) },
      ms: 12_000,
    });
    clear();
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);

    const entry = {
      type: upstream.headers.get('content-type') || 'image/jpeg',
      body: Buffer.from(await upstream.arrayBuffer()),
    };
    if (imgCache.size >= IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(target, entry);
    imgFailures.delete(target);

    res.set('content-type', entry.type);
    res.set('cache-control', 'public, max-age=604800');
    res.send(entry.body);
  } catch (err) {
    // 封面拉不到是常态（图床冷渲染、限流、链接失效），
    // 记一条冷却记录即可，不值得当成接口错误刷屏
    const isTimeout = /abort|timeout/i.test(err.message);
    imgFailures.set(target, { until: Date.now() + (isTimeout ? COOLDOWN_TIMEOUT : COOLDOWN_HARD) });
    console.warn(`[封面] ${u.hostname} ${isTimeout ? '渲染超时，稍后重试' : `取不到：${err.message}`}`);
    sendBlank(res);
  }
}

/* =============================== 音视频流 =============================== */

/**
 * 播客的 mp3 地址普遍是「统计跳转」：
 * traffic.megaphone.fm/xxx.mp3 → 302 → CDN?key=签名&session_id=...
 * 每次请求签发的 token 都不同，浏览器一拖进度条重新发 Range 请求，
 * 拿到的是另一个 session 的签名，于是拖不动、也放不出声。
 *
 * 这里做一层同源流代理：服务端跟随跳转，把客户端的 Range 原样转发，
 * 并把 206 / Content-Range / Accept-Ranges 如实回传，
 * <audio> 才能正确知道总时长并支持拖动。
 */
export async function mediaProxy(req, res) {
  const raw = req.query.url;
  if (!raw || !/^https?:\/\//i.test(raw)) return res.status(400).end();

  let u;
  try {
    u = assertPublicUrl(raw);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  const headers = { 'user-agent': UA, referer: refererFor(u.hostname, u.origin) };
  if (req.headers.range) headers.range = req.headers.range;

  let ctrlRef;
  try {
    const { res: upstream, ctrl, clear } = await fetchWithHeaderTimeout(raw, {
      headers,
      ms: 20_000,
      onAbort: (c) => (ctrlRef = c),
    });
    clear(); // 头已到手，正片传输不再计时
    ctrlRef = ctrl;

    if (upstream.status >= 400) return res.status(upstream.status).end();

    for (const h of ['content-type', 'content-length', 'content-range', 'last-modified', 'etag']) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.set('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.set('cache-control', 'public, max-age=3600');
    res.status(upstream.status);

    if (req.method === 'HEAD' || !upstream.body) return res.end();

    const stream = Readable.fromWeb(upstream.body);
    // 用户拖动进度条时浏览器会掐断当前连接，这里要同步终止回源，避免连接泄漏
    res.on('close', () => {
      stream.destroy();
      ctrl.abort();
    });
    stream.on('error', () => res.destroyed || res.end());
    stream.pipe(res);
  } catch (err) {
    ctrlRef?.abort();
    if (!res.headersSent) res.status(502).json({ error: `媒体拉取失败：${err.message}` });
  }
}
