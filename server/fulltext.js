import { extractFromHtml } from '@extractus/article-extractor';

/**
 * 全文抓取
 *
 * 很多博客的 RSS 只输出一段摘要（overreacted 就只有 <summary>），
 * 在阅读器里点开只能看到两行字，体验很差。
 * 这里去抓原文页面，把正文提取出来缓存进库，之后再打开就是全文。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/** 正文明显偏短时才值得去抓一次原文 */
export function looksTruncated(entry) {
  if (!entry.link) return false;
  if (entry.media_type !== 'article') return false;
  const len = (entry.content || '').replace(/<[^>]+>/g, '').trim().length;
  return len < 600;
}

/** 把相对路径的图片/链接补全成绝对地址，否则在我们这边渲染会 404 */
function absolutize(html, baseUrl) {
  if (!html) return html;
  return html.replace(/(src|href)=["'](?!https?:|data:|#|mailto:)([^"']+)["']/gi, (match, attr, value) => {
    try {
      return `${attr}="${new URL(value, baseUrl).toString()}"`;
    } catch {
      return match;
    }
  });
}

function sanitize(html) {
  if (!html) return null;
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/**
 * 抓取并提取正文，返回消毒后的 HTML；失败返回 null。
 */
export async function fetchFullText(link) {
  if (!link) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(link, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const article = await extractFromHtml(html, link);
    if (!article?.content) return null;

    const cleaned = sanitize(absolutize(article.content, link));
    const textLen = (cleaned || '').replace(/<[^>]+>/g, '').trim().length;
    // 提取出来还不如原摘要长就没意义，交回上层判断
    return textLen > 200 ? cleaned : null;
  } catch (err) {
    throw new Error(
      /abort|timeout/i.test(err.message) ? '抓取原文超时' : `抓取原文失败：${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }
}
