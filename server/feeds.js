import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import { buildEmbedUrl } from './resolver.js';
import {
  getFeed,
  insertEntries,
  listFeeds,
  markFeedFetched,
  updateFeedMeta,
} from './db.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const parser = new Parser({
  headers: { 'user-agent': UA },
  customFields: {
    feed: [['yt:channelId', 'ytChannelId'], 'icon', 'logo'],
    item: [
      ['media:group', 'mediaGroup'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
      ['yt:videoId', 'ytVideoId'],
      ['content:encoded', 'contentEncoded'],
      ['description', 'descriptionRaw'],
    ],
  },
});

const ZHIHU_HOTLIST_URL = 'native:zhihu/hotlist';
const ZHIHU_HOTLIST_API = 'https://api.zhihu.com/topstory/hot-list?limit=50&reverse_order=0';

// B 站空间地址用 native:bilibili/space/{mid} 标记，交给下面的原生抓取器处理
export const BILIBILI_SPACE_PREFIX = 'native:bilibili/space/';

// 安卓客户端的 appkey/appsec，社区逆向文档广泛记录、B 站官方也长期未换，
// 用它签名请求可以绕开网页端接口的风控（412），无需登录、无需 Cookie。
const BILI_APP_KEY = '1d8b6e7d45233436';
const BILI_APP_SEC = '560c52ccd288fed045859ed18bffd973';
export const BILI_UA = 'Mozilla/5.0 (Linux; Android 13) bilibili/8.60.0';

/* ------------------------------ 工具函数 ------------------------------ */

/** xml2js 的产物形态多变（字符串 / {$:{url}} / 数组），统一挖出 url */
function urlOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = urlOf(v);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    const attrs = value.$ || value;
    for (const key of ['url', 'href', 'src']) {
      if (typeof attrs[key] === 'string' && /^https?:\/\//i.test(attrs[key])) return attrs[key];
    }
  }
  return null;
}

/** xml2js 常把文本节点包成数组，这里取出第一个非空字符串 */
function firstString(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = firstString(v);
      if (hit) return hit;
    }
  }
  if (value && typeof value === 'object' && typeof value._ === 'string') return value._.trim() || null;
  return null;
}

/** 在解析结果里递归找第一个符合条件的键 */
function deepFind(node, predicate, depth = 0) {
  if (!node || depth > 6 || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = deepFind(child, predicate, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, value] of Object.entries(node)) {
    const hit = predicate(key, value);
    if (hit) return hit;
    const nested = deepFind(value, predicate, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function pickThumbnail(item, source) {
  // YouTube 的缩略图地址可由 videoId 直接推导，最稳
  const ytId = typeof item.ytVideoId === 'string' ? item.ytVideoId : null;
  if (ytId) return `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

  const fromMedia = deepFind(item, (key, value) =>
    /thumbnail|thumb|image|itunes:image/i.test(key) ? urlOf(value) : null
  );
  if (fromMedia) return fromMedia;

  if (item.enclosure && /^image\//i.test(item.enclosure.type || '')) return item.enclosure.url || null;

  const html = item.contentEncoded || item.content || item.descriptionRaw || item.summary || '';
  if (typeof html === 'string') {
    const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (img && /^https?:\/\//i.test(img[1])) return img[1];
  }

  if (source === 'bilibili') {
    const bv = String(item.link || '').match(/\/(BV[\w]+)/);
    if (bv && typeof html === 'string') {
      const pic = html.match(/https?:\/\/[^"'\s]+hdslb\.com[^"'\s]+\.(jpg|png|webp)/i);
      if (pic) return pic[0];
    }
  }
  return null;
}

/** itunes:duration 可能是 "3600" 或 "01:02:03"，统一成秒 */
function parseDuration(raw) {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (/^\d+$/.test(str)) return Number(str);
  const parts = str.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

/** feed 内容不可信，去掉脚本与事件属性再存 */
function sanitize(html) {
  if (!html || typeof html !== 'string') return null;
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

function toText(html, limit = 400) {
  if (!html) return null;
  const text = String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 纯文本简介（如 YouTube）转成可渲染的 HTML：转义 + 自动链接 + 换行 */
function textToHtml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zhihuQuestionLink(target) {
  const apiUrl = target?.url || '';
  const id = String(apiUrl.match(/questions\/(\d+)/)?.[1] || target?.id || '').trim();
  return id ? `https://www.zhihu.com/question/${id}` : apiUrl.replace('https://api.zhihu.com/questions/', 'https://www.zhihu.com/question/');
}

function normalizeZhihuHotItem(item, index, fetchedAt) {
  const target = item.target || {};
  const title = target.title || '(无标题)';
  const link = zhihuQuestionLink(target);
  const heat = item.detail_text || '';
  const excerpt = target.excerpt || '';
  const thumbnail = item.children?.[0]?.thumbnail || target.thumbnail || target.image_url || null;
  const questionId = String(item.card_id || target.url?.match(/questions\/(\d+)/)?.[1] || target.id || item.id || index);
  // 热榜是一个“当前排名”列表，用问题创建时间排序会完全乱掉；
  // 用本次抓取时间减去 index 秒，既能保持榜单顺序，也能在刷新时把当前榜单顶上来。
  const publishedAt = new Date(fetchedAt - index * 1000).toISOString();

  const meta = [
    heat && `<p><strong>${escapeHtml(heat)}</strong></p>`,
    Number.isFinite(target.answer_count) && `<p>${target.answer_count} 个回答</p>`,
    link && `<p><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener">在知乎查看</a></p>`,
  ]
    .filter(Boolean)
    .join('');

  return {
    guid: `zhihu-hotlist:${questionId}`,
    id: `zhihu-hotlist:${questionId}`,
    title,
    link,
    author: '知乎热榜',
    pubDate: publishedAt,
    isoDate: publishedAt,
    contentSnippet: [heat, excerpt].filter(Boolean).join(' · '),
    contentEncoded: `<p>${escapeHtml(excerpt || title)}</p>${meta}`,
    thumbnail,
  };
}

async function fetchZhihuHotlist() {
  let res;
  try {
    res = await fetch(ZHIHU_HOTLIST_API, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ZhihuHybrid',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    throw new Error(/timeout|aborted/i.test(err.message) ? '知乎热榜接口超时，稍后再试。' : `知乎热榜抓取失败：${err.message}`);
  }

  if (!res.ok) throw new Error(`知乎热榜抓取失败：HTTP ${res.status}`);

  const json = await res.json();
  const fetchedAt = Date.now();
  const items = Array.isArray(json.data) ? json.data.map((item, index) => normalizeZhihuHotItem(item, index, fetchedAt)) : [];
  if (!items.length) throw new Error('知乎热榜返回为空');

  return {
    title: '知乎热榜',
    link: 'https://www.zhihu.com/hot',
    description: '知乎实时热门话题',
    items,
  };
}

/* ------------------------------ B 站原生抓取 ------------------------------
 * 网页端 api.bilibili.com 的公开接口会被风控直接 412（即便签了 WBI），
 * 但安卓客户端的签名接口不受此限制，且不需要登录/Cookie。
 * appkey/appsec 是社区长期使用的公开值（如 bilibili-API-collect 等项目）。
 * -------------------------------------------------------------------- */

function signBiliAppParams(params) {
  const withTs = { ...params, appkey: BILI_APP_KEY, ts: Math.floor(Date.now() / 1000) };
  const sorted = Object.keys(withTs)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(withTs[k])}`)
    .join('&');
  const sign = createHash('md5').update(sorted + BILI_APP_SEC).digest('hex');
  return `${sorted}&sign=${sign}`;
}

export async function biliAppRequest(path, params) {
  const url = `${path}?${signBiliAppParams(params)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': BILI_UA, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(/abort|timeout/i.test(err.message) ? 'B 站接口超时，稍后再试。' : `B 站接口请求失败：${err.message}`);
  }
  if (!res.ok) throw new Error(`B 站接口请求失败：HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`B 站接口返回错误：${json.message || json.code}`);
  return json.data;
}

function normalizeBiliVideoItem(item) {
  const bvid = item.bvid;
  const link = bvid ? `https://www.bilibili.com/video/${bvid}` : null;
  const publishedAt = item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString();
  // 官方封面地址有些还是 http，浏览器同源代理会重新拉一次，统一转 https 更稳
  const thumbnail = item.cover ? item.cover.replace(/^http:\/\//, 'https://') : null;

  const meta = [
    Number.isFinite(item.play) && `<p>播放 ${item.view_content || item.play}</p>`,
    Number.isFinite(item.danmaku) && `<p>弹幕 ${item.danmaku}</p>`,
    link && `<p><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener">在 B 站查看</a></p>`,
  ]
    .filter(Boolean)
    .join('');

  return {
    guid: `bilibili:${bvid || item.param}`,
    id: `bilibili:${bvid || item.param}`,
    title: (item.title || '(无标题)').trim(),
    link,
    author: item.author || null,
    pubDate: publishedAt,
    isoDate: publishedAt,
    contentSnippet: `播放 ${item.view_content || item.play || 0} · 弹幕 ${item.danmaku || 0}`,
    contentEncoded: `<p>${escapeHtml(item.title || '')}</p>${meta}`,
    thumbnail,
    duration: item.duration,
  };
}

async function fetchBilibiliSpace(mid) {
  const [data, space] = await Promise.all([
    biliAppRequest('https://app.bilibili.com/x/v2/space/archive/cursor', {
      vmid: mid,
      ps: 30,
      pn: 1,
    }),
    biliAppRequest('https://app.bilibili.com/x/v2/space', {
      vmid: mid,
      build: 8600300,
      mobi_app: 'android',
      platform: 'android',
    }),
  ]);

  const rawItems = data?.item || [];
  if (!rawItems.length) throw new Error('该 UP 主没有可见的公开视频（或 UID 不存在）');

  // 联合投稿的 author 可能是另一位合作者，订阅名必须来自该 UID 的空间资料。
  const author = space?.card?.name?.trim();
  if (!author || String(space.card.mid) !== String(mid)) throw new Error('无法确认该 UP 主的空间名称，请稍后重试。');
  const items = rawItems.map(normalizeBiliVideoItem);

  return {
    title: author,
    link: `https://space.bilibili.com/${mid}`,
    description: `${author} 的 B 站投稿视频`,
    items,
  };
}

function detectMediaType(item, source) {
  if (source === 'youtube' || source === 'bilibili') return 'video';
  const encType = item.enclosure?.type || '';
  if (/^video\//i.test(encType)) return 'video';
  if (/^audio\//i.test(encType)) return 'audio';
  if (item.itunes) return 'audio';
  const mediaUrl = urlOf(item.mediaContent);
  if (mediaUrl && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(mediaUrl)) return 'video';
  if (mediaUrl && /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(mediaUrl)) return 'audio';
  return 'article';
}

function normalizeItem(item, feed) {
  const source = feed.source;
  const link = item.link || item.guid || null;
  // 不同 feed 放正文的位置差异很大：RSS 用 content:encoded/description，Atom 常只有 summary
  const rawContent =
    item.contentEncoded || item.content || item.descriptionRaw || item.summary || item.contentSnippet || null;
  const mediaType = detectMediaType(item, source);

  const mediaUrl =
    (item.enclosure && /^(audio|video)\//i.test(item.enclosure.type || '') ? item.enclosure.url : null) ||
    (mediaType !== 'article' ? urlOf(item.mediaContent) : null);

  // YouTube 的 media:group 里藏着真正的简介（且被包成了字符串数组）
  const ytDescription = deepFind(item.mediaGroup, (key, value) =>
    /description/i.test(key) ? firstString(value) : null
  );

  const publishedAt = item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString());

  return {
    guid: item.guid || item.id || link || `${feed.id}:${item.title}:${publishedAt}`,
    title: (item.title || '(无标题)').trim(),
    link,
    author: item.author || item.creator || feed.title || null,
    summary: toText(ytDescription || item.contentSnippet || rawContent),
    // YouTube 只给纯文本简介，转成带换行的段落，详情页才有东西可读
    content: sanitize(rawContent) || (ytDescription ? textToHtml(ytDescription) : null),
    publishedAt: Number.isNaN(Date.parse(publishedAt)) ? new Date().toISOString() : publishedAt,
    thumbnail: pickThumbnail(item, source),
    mediaType,
    mediaUrl: mediaUrl || null,
    embedUrl: mediaType === 'video' ? buildEmbedUrl(link, source) : null,
    // B 站原生抓取器直接给出的是秒数（item.duration），itunes:duration 是播客专用格式
    duration: parseDuration(item.itunes?.duration ?? item.duration),
  };
}

/* ------------------------------ 对外接口 ------------------------------ */

/** 把底层网络错误翻译成用户能据此行动的提示 */
function friendlyError(err, url) {
  const msg = String(err?.message || err);
  const viaRsshub = /rsshub/i.test(url);

  if (/timeout|aborted|timed out/i.test(msg)) {
    return viaRsshub
      ? `${rsshubHint(url)}（连接超时）`
      : '抓取超时，对方服务器响应太慢，稍后再试试。';
  }
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|certificate/i.test(msg)) {
    return '无法连接到该地址，请检查网址是否正确、网络是否可达。';
  }
  return msg;
}

function rsshubHint(url) {
  const base = new URL(url).origin;
  return `RSSHub 实例不可用：${base}。知乎等站点没有官方 RSS，需要可用的 RSSHub；建议自建后用 RSSHUB_BASE=http://localhost:1200 npm run dev。`;
}

export async function fetchAndParse(url) {
  if (url === ZHIHU_HOTLIST_URL) return fetchZhihuHotlist();
  if (url.startsWith(BILIBILI_SPACE_PREFIX)) {
    return fetchBilibiliSpace(url.slice(BILIBILI_SPACE_PREFIX.length));
  }

  let res;
  const viaRsshub = /rsshub/i.test(url);
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
      // 公共 RSSHub 超时很常见，等 25 秒只会让 UI 看起来像卡死。
      signal: AbortSignal.timeout(viaRsshub ? 8_000 : 25_000),
    });
  } catch (err) {
    throw new Error(friendlyError(err, url));
  }
  if (!res.ok) {
    throw new Error(viaRsshub ? `${rsshubHint(url)}（HTTP ${res.status}）` : `抓取失败 ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) {
    throw new Error(viaRsshub ? `${rsshubHint(url)}（返回的不是 RSS）` : '返回内容不是有效的 RSS/Atom');
  }
  return parser.parseString(xml);
}

/** 刷新单个订阅源，返回新增条目数 */
export async function refreshFeed(feedId) {
  const feed = getFeed(feedId);
  if (!feed) throw new Error('订阅源不存在');
  try {
    const parsed = await fetchAndParse(feed.url);
    const title = feed.url.startsWith(BILIBILI_SPACE_PREFIX) && /等联合创作\s*$/.test(feed.title)
      ? parsed.title
      : feed.title;
    const items = (parsed.items || []).map((item) => normalizeItem(item, feed));
    const added = insertEntries(feed.id, items);

    const kind = items.some((i) => i.mediaType === 'video')
      ? 'video'
      : items.some((i) => i.mediaType === 'audio')
        ? 'podcast'
        : 'article';
    updateFeedMeta(feed.id, {
      title,
      siteUrl: parsed.link || null,
      description: toText(parsed.description, 200),
      kind,
    });
    markFeedFetched(feed.id, null);
    return { feedId: feed.id, title, added, error: null };
  } catch (err) {
    markFeedFetched(feed.id, err.message);
    return { feedId: feed.id, title: feed.title, added: 0, error: err.message };
  }
}

/** 并发刷新全部订阅源（限制并发度，避免一次性打爆对端） */
export async function refreshAll(concurrency = 4) {
  const feeds = listFeeds();
  const results = [];
  const queue = [...feeds];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const feed = queue.shift();
      results.push(await refreshFeed(feed.id));
    }
  });

  await Promise.all(workers);
  return results;
}

/** 首次订阅：抓一次拿标题等元信息，交给调用方入库 */
export async function probeFeed(feedUrl, source) {
  const parsed = await fetchAndParse(feedUrl);
  const items = parsed.items || [];
  const kind = items.some((i) => i.ytVideoId || /youtube|bilibili/i.test(source || ''))
    ? 'video'
    : items.some((i) => /^audio\//i.test(i.enclosure?.type || ''))
      ? 'podcast'
      : 'article';
  return {
    title: (parsed.title || feedUrl).trim(),
    siteUrl: parsed.link || null,
    description: toText(parsed.description, 200),
    kind,
    parsed,
  };
}

export function startScheduler(minutes = 30) {
  const interval = Math.max(5, minutes) * 60_000;
  const tick = async () => {
    const results = await refreshAll();
    const added = results.reduce((sum, r) => sum + r.added, 0);
    if (added) console.log(`[定时刷新] 新增 ${added} 条`);
  };
  setTimeout(tick, 10_000).unref?.();
  const timer = setInterval(tick, interval);
  timer.unref?.();
  return timer;
}
