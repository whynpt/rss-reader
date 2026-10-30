/**
 * 视频源解析器
 *
 * 用户粘贴的通常是「频道主页 / 空间 / 播放列表」这类人类可读链接，
 * 而不是真正的 feed 地址。这里负责把它们翻译成可订阅的 RSS/Atom URL，
 * 并顺便标注来源类型（youtube / bilibili / podcast / web），
 * 供后续渲染视频卡片与内嵌播放器使用。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// RSSHub 用于给没有官方 feed 的平台（如番剧）做转换，可用自建实例覆盖。
// B 站 UP 主空间已改用原生抓取（见 feeds.js 的 BILIBILI_SPACE_PREFIX），不再需要 RSSHub。
const HAS_CUSTOM_RSSHUB = Boolean(process.env.RSSHUB_BASE);
export const RSSHUB_BASE = (process.env.RSSHUB_BASE || 'https://rsshub.app').replace(/\/+$/, '');

const YT_FEED = 'https://www.youtube.com/feeds/videos.xml';
const ZHIHU_HOTLIST_FEED = 'native:zhihu/hotlist';
const BILIBILI_SPACE_PREFIX = 'native:bilibili/space/';

/** 把底层网络错误翻译成用户能据此行动的提示 */
function friendlyError(err, url) {
  const msg = String(err?.message || err);
  if (/timeout|aborted|timed out/i.test(msg)) return `连接 ${new URL(url).hostname} 超时，稍后再试。`;
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|certificate/i.test(msg)) {
    return `无法连接到 ${new URL(url).hostname}，请检查网址是否正确、网络是否可达。`;
  }
  return msg;
}

/** 带超时的请求，避免对方挂起时把整个接口拖死 */
async function safeFetch(url, accept) {
  try {
    return await fetch(url, {
      headers: { 'user-agent': UA, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(friendlyError(err, url));
  }
}

async function getText(url) {
  const res = await safeFetch(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  if (!res.ok) throw new Error(`请求失败 ${res.status} ${res.statusText}`);
  return res.text();
}

function normalize(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请输入订阅地址');
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^feed:\/\//i.test(raw)) return raw.replace(/^feed:\/\//i, 'https://');
  return `https://${raw}`;
}

/** 看起来已经是 feed 地址就别折腾了，直接用 */
function looksLikeFeed(url) {
  return (
    /\.(xml|rss|atom)(\?|$)/i.test(url) ||
    /\/(feed|rss|atom|feeds)(\/|\?|$)/i.test(url) ||
    /feeds\/videos\.xml/i.test(url) ||
    /rsshub/i.test(url)
  );
}

/**
 * YouTube 的 handle（@name）、/c/、/user/ 三种链接里都不含 channelId，
 * 必须抓一次页面把 UCxxxx 挖出来才能拼出官方 feed。
 *
 * 注意顺序：页面里会出现大量「推荐频道」的 channelId，
 * 直接取第一个匹配会订阅到别人。canonical / og:url 才唯一指向本频道。
 */
async function resolveYoutubeChannelId(pageUrl) {
  const html = await getText(pageUrl);
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[\w-]{20,})/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["'][^"']*\/channel\/(UC[\w-]{20,})/i,
    /<meta[^>]+itemprop=["'](?:identifier|channelId)["'][^>]+content=["'](UC[\w-]{20,})["']/i,
    /"externalId"\s*:\s*"(UC[\w-]{20,})"/,
    /channel_id=(UC[\w-]{20,})/,
    /"channelId"\s*:\s*"(UC[\w-]{20,})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  throw new Error('没能从该 YouTube 页面解析出频道 ID，可以试试直接粘贴 /channel/UCxxxx 形式的链接');
}

async function resolveYoutube(u) {
  const path = u.pathname;
  const list = u.searchParams.get('list');

  if (list) {
    return { feedUrl: `${YT_FEED}?playlist_id=${list}`, source: 'youtube', kind: 'video' };
  }

  const channelMatch = path.match(/^\/channel\/(UC[\w-]+)/);
  if (channelMatch) {
    return { feedUrl: `${YT_FEED}?channel_id=${channelMatch[1]}`, source: 'youtube', kind: 'video' };
  }

  // 单个视频页：退化为订阅该视频的作者频道
  if (path === '/watch' || path.startsWith('/shorts/')) {
    const id = await resolveYoutubeChannelId(u.toString());
    return { feedUrl: `${YT_FEED}?channel_id=${id}`, source: 'youtube', kind: 'video' };
  }

  if (/^\/(@[^/]+|c\/[^/]+|user\/[^/]+)/.test(path)) {
    const id = await resolveYoutubeChannelId(`https://www.youtube.com${path}`);
    return { feedUrl: `${YT_FEED}?channel_id=${id}`, source: 'youtube', kind: 'video' };
  }

  throw new Error('无法识别的 YouTube 链接，请粘贴频道主页或播放列表地址');
}

function resolveBilibili(u) {
  // UP 主空间：直接走原生抓取（安卓客户端签名接口），不需要 RSSHub、不需要登录
  const space = u.hostname === 'space.bilibili.com' && u.pathname.match(/^\/(\d+)/);
  if (space) {
    return {
      feedUrl: `${BILIBILI_SPACE_PREFIX}${space[1]}`,
      source: 'bilibili',
      kind: 'video',
    };
  }

  // 番剧比较小众，暂时仍走 RSSHub；没配置就直接告知，别让用户干等
  const bangumi = u.pathname.match(/\/bangumi\/media\/md(\d+)/);
  if (bangumi) {
    if (!HAS_CUSTOM_RSSHUB) {
      throw new Error(
        '番剧订阅需要可用的 RSSHub。当前未配置 RSSHUB_BASE，公共 rsshub.app 在此网络不可用；请自建 RSSHub 后用 RSSHUB_BASE=http://localhost:1200 npm run dev。'
      );
    }
    return {
      feedUrl: `${RSSHUB_BASE}/bilibili/bangumi/media/${bangumi[1]}`,
      source: 'bilibili',
      kind: 'video',
    };
  }
  throw new Error('B 站请粘贴 UP 主空间地址（space.bilibili.com/数字）');
}

function resolveZhihu(u) {
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '/hot' || path === '/hotlist' || path === '/billboard') {
    return { feedUrl: ZHIHU_HOTLIST_FEED, source: 'zhihu', kind: 'article' };
  }
  throw new Error('知乎目前只内置了热榜，请输入「知乎热榜」或 zhihu.com/hot');
}

/**
 * 普通网站：一次请求同时判断两件事
 *  1) 这个地址本身就是 feed 吗（很多播客地址没有任何后缀特征，如 feeds.simplecast.com/xxxx）
 *  2) 如果是 HTML，就去 <link rel="alternate"> 里找自动发现声明
 */
async function discoverFeed(url) {
  const res = await safeFetch(url, 'application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.8');
  if (!res.ok) throw new Error(`请求失败 ${res.status} ${res.statusText}`);
  const body = await res.text();

  if (/^\s*(<\?xml|<rss\b|<feed\b|<rdf:RDF\b)/i.test(body)) return url;

  const linkTags = body.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href) return new URL(href[1], url).toString();
  }

  // 没有声明就撞几个最常见的约定路径
  for (const guess of ['/feed', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml']) {
    try {
      const candidate = new URL(guess, url).toString();
      const probe = await safeFetch(candidate, '*/*');
      if (!probe.ok) continue;
      const type = probe.headers.get('content-type') || '';
      if (/(xml|rss|atom)/i.test(type)) return candidate;
    } catch {
      /* 猜测失败是常态，继续下一个 */
    }
  }
  return null;
}

/** 入口：把任意用户输入解析为 { feedUrl, source, kind } */
export async function resolveFeedUrl(input) {
  const raw = String(input || '').trim();
  if (/^(知乎热榜|知乎热搜|zhihu\s*(hot|hotlist)|zhihu)$/i.test(raw)) {
    return { feedUrl: ZHIHU_HOTLIST_FEED, source: 'zhihu', kind: 'article' };
  }

  const url = normalize(input);
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');

  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
    if (u.pathname.startsWith('/feeds/videos.xml')) {
      return { feedUrl: url, source: 'youtube', kind: 'video' };
    }
    if (host === 'youtu.be') {
      const id = await resolveYoutubeChannelId(`https://www.youtube.com/watch?v=${u.pathname.slice(1)}`);
      return { feedUrl: `${YT_FEED}?channel_id=${id}`, source: 'youtube', kind: 'video' };
    }
    return resolveYoutube(u);
  }

  if (/(^|\.)bilibili\.com$/.test(host)) return resolveBilibili(u);

  if (/(^|\.)zhihu\.com$/.test(host)) return resolveZhihu(u);

  if (looksLikeFeed(url)) {
    return { feedUrl: url, source: guessSource(url), kind: 'unknown' };
  }

  const discovered = await discoverFeed(url);
  if (!discovered) {
    throw new Error('该站点没有找到 RSS 源，可尝试直接粘贴 feed 地址，或使用 RSSHub 路由');
  }
  return { feedUrl: discovered, source: guessSource(discovered), kind: 'unknown' };
}

function guessSource(url) {
  if (/youtube\.com/i.test(url)) return 'youtube';
  if (/bilibili/i.test(url)) return 'bilibili';
  if (/zhihu/i.test(url)) return 'zhihu';
  return 'web';
}

/**
 * 生成可内嵌播放的地址，让用户不必跳出应用。
 * 解析不出来就返回 null，前端退化成外链。
 */
export function buildEmbedUrl(link, source) {
  if (!link) return null;
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');

  if (/(^|\.)youtube\.com$/.test(host)) {
    const v = u.searchParams.get('v');
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
    const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shorts) return `https://www.youtube-nocookie.com/embed/${shorts[1]}`;
  }
  if (host === 'youtu.be') {
    return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
  }
  if (/(^|\.)bilibili\.com$/.test(host)) {
    const bv = u.pathname.match(/\/(BV[\w]+)/);
    if (bv) return `https://player.bilibili.com/player.html?bvid=${bv[1]}&autoplay=0&high_quality=1`;
  }
  if (source === 'youtube') {
    // 某些 feed 只给了变体链接，兜个底
    const m = link.match(/[?&]v=([\w-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }
  return null;
}
