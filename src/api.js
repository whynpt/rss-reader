async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  stats: () => request('/api/stats'),

  feeds: () => request('/api/feeds'),
  addFeed: (url, category) => request('/api/feeds', { method: 'POST', body: { url, category } }),
  updateFeed: (id, patch) => request(`/api/feeds/${id}`, { method: 'PATCH', body: patch }),
  deleteFeed: (id) => request(`/api/feeds/${id}`, { method: 'DELETE' }),
  refreshFeed: (id) => request(`/api/feeds/${id}/refresh`, { method: 'POST' }),
  refreshAll: () => request('/api/refresh', { method: 'POST' }),

  entries: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return request(`/api/entries?${qs}`);
  },
  entryCounts: (params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== ''));
    return request(`/api/entries/counts?${qs}`);
  },
  setRead: (id, value) => request(`/api/entries/${id}/read`, { method: 'POST', body: { value } }),
  setStar: (id, value) => request(`/api/entries/${id}/star`, { method: 'POST', body: { value } }),
  fullText: (id) => request(`/api/entries/${id}/fulltext`, { method: 'POST' }),
  stream: (id, quality) => request(`/api/entries/${id}/stream`, { method: 'POST', body: { quality } }),
  markAllRead: (scope) => request('/api/entries/read-all', { method: 'POST', body: scope || {} }),

  bilibiliLoginStart: () => request('/api/bilibili/login/start', { method: 'POST' }),
  bilibiliLoginPoll: (authCode) => request(`/api/bilibili/login/poll?authCode=${encodeURIComponent(authCode)}`),
  bilibiliLoginStatus: () => request('/api/bilibili/login/status'),
  bilibiliLogout: () => request('/api/bilibili/logout', { method: 'POST' }),
  bilibiliFollowings: () => request('/api/bilibili/followings'),
  bilibiliImportFollowings: (mids, category) =>
    request('/api/bilibili/followings/import', { method: 'POST', body: { mids, category } }),
};

// 统一走后端代理：既规避各家图床的防盗链（B站、微博等），
// 也让浏览器只发同源请求，避免被第三方图片策略拦截。
export function imgSrc(url) {
  if (!url) return null;
  return `/api/img?url=${encodeURIComponent(url)}`;
}

// 播客音频普遍是带签名的统计跳转地址，直接喂给 <audio> 会拖不动进度条，
// 必须经由支持 Range 的同源代理。
export function mediaSrc(url) {
  if (!url) return null;
  return `/api/media?url=${encodeURIComponent(url)}`;
}

/**
 * 探测浏览器能否直连 YouTube 的嵌入播放器域名。
 *
 * 在只有服务端配了代理的环境里（企业网常见），浏览器直连会超时，
 * 内嵌 iframe 就是一片空白。探测到这种情况就自动改用
 * 服务端解析直链 + 同源流播放，用户无需关心网络配置。
 *
 * 探测的必须是 youtube-nocookie.com 本身——i.ytimg.com 是图片 CDN，
 * 两者的可达性未必一致，探错了会做出相反的判断。
 */
export function probeDirectMedia(timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // no-cors 拿不到响应内容，但「请求有没有成功发出去」足够判断连通性
  return fetch('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', {
    mode: 'no-cors',
    cache: 'no-store',
    signal: ctrl.signal,
  })
    .then(() => true)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}
