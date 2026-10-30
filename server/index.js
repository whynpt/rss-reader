import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  deleteFeed,
  entryCounts,
  getEntry,
  getFeedByUrl,
  insertFeed,
  listEntries,
  listFeeds,
  markAllRead,
  renameFeed,
  setEntryContent,
  setEntryFlag,
  stats,
} from './db.js';
import { probeFeed, refreshAll, refreshFeed, startScheduler } from './feeds.js';
import { resolveFeedUrl } from './resolver.js';
import { imageProxy, mediaProxy } from './proxy.js';
import { fetchFullText } from './fulltext.js';
import { resolveStream } from './stream.js';
import { resolveBilibiliStream } from './bilibili-stream.js';
import { clearAuth, getAuthStatus, pollLogin, startLogin } from './bilibili-auth.js';
import { fetchFollowings } from './bilibili-follow.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '1mb' }));

/** 把 async 路由的异常统一交给错误中间件 */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* --------------------------------- 概览 --------------------------------- */

app.get('/api/stats', (req, res) => res.json(stats()));

/* -------------------------------- 订阅源 -------------------------------- */

app.get('/api/feeds', (req, res) => res.json(listFeeds()));

/** 单个添加订阅的核心逻辑，单条添加和批量导入（关注列表）都走这里 */
async function addFeedByUrl(url, category) {
  const { feedUrl, source } = await resolveFeedUrl(url);
  const existing = getFeedByUrl(feedUrl);
  if (existing) return { feed: existing, added: 0, alreadyExists: true };

  const meta = await probeFeed(feedUrl, source);
  const feed = insertFeed({
    url: feedUrl,
    siteUrl: meta.siteUrl,
    title: meta.title,
    description: meta.description,
    source,
    kind: meta.kind,
    category:
      category?.trim() ||
      (source === 'zhihu' ? '热榜' : meta.kind === 'video' ? '视频' : meta.kind === 'podcast' ? '播客' : '未分类'),
  });

  const result = await refreshFeed(feed.id);
  return { feed, added: result.added, alreadyExists: false };
}

app.post(
  '/api/feeds',
  wrap(async (req, res) => {
    const { url, category } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少 url' });

    // 解析与首次抓取失败属于用户输入问题，用 422 而不是 500
    let result;
    try {
      result = await addFeedByUrl(url, category);
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }

    if (result.alreadyExists) return res.status(409).json({ error: '已经订阅过这个源了', feed: result.feed });

    res.status(201).json({ feed: result.feed, added: result.added, resolvedFrom: url !== result.feed.url ? result.feed.url : null });
  })
);

app.patch('/api/feeds/:id', (req, res) => {
  const { title, category } = req.body || {};
  const feed = renameFeed(Number(req.params.id), { title, category });
  if (!feed) return res.status(404).json({ error: '订阅源不存在' });
  res.json(feed);
});

app.delete('/api/feeds/:id', (req, res) => {
  const ok = deleteFeed(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '订阅源不存在' });
  res.json({ ok: true });
});

app.post(
  '/api/feeds/:id/refresh',
  wrap(async (req, res) => res.json(await refreshFeed(Number(req.params.id))))
);

app.post(
  '/api/refresh',
  wrap(async (req, res) => {
    const results = await refreshAll();
    res.json({ results, added: results.reduce((sum, r) => sum + r.added, 0) });
  })
);

/* --------------------------------- 条目 --------------------------------- */

app.get('/api/entries', (req, res) => {
  const { filter, feedId, category, q, mediaType, limit, offset } = req.query;
  res.json(
    listEntries({
      filter: filter || 'all',
      feedId: feedId ? Number(feedId) : undefined,
      category: category || undefined,
      q: q?.trim() || undefined,
      mediaType,
      limit: Math.min(Number(limit) || 60, 200),
      offset: Number(offset) || 0,
    })
  );
});

app.get('/api/entries/counts', (req, res) => {
  const { filter, feedId, category, q, mediaType } = req.query;
  res.json(entryCounts({ filter, feedId: feedId ? Number(feedId) : undefined, category, q: q?.trim(), mediaType }));
});

app.get('/api/entries/:id', (req, res) => {
  const entry = getEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  res.json(entry);
});

app.post('/api/entries/:id/read', (req, res) => {
  const entry = setEntryFlag(Number(req.params.id), 'is_read', req.body?.value !== false);
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  res.json(entry);
});

app.post('/api/entries/:id/star', (req, res) => {
  const entry = setEntryFlag(Number(req.params.id), 'is_starred', req.body?.value !== false);
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  res.json(entry);
});

app.post('/api/entries/read-all', (req, res) => {
  const { feedId, category, filter, q, mediaType } = req.body || {};
  res.json({ changed: markAllRead({ feedId: feedId ? Number(feedId) : undefined, category, filter, q: q?.trim(), mediaType }) });
});

/** 抓取全文：RSS 只给摘要时，去原文页面把正文提取回来并缓存 */
app.post(
  '/api/entries/:id/fulltext',
  wrap(async (req, res) => {
    const entry = getEntry(Number(req.params.id));
    if (!entry) return res.status(404).json({ error: '条目不存在' });
    if (!entry.link) return res.status(422).json({ error: '该条目没有原文链接' });

    try {
      const content = await fetchFullText(entry.link);
      if (!content) return res.status(422).json({ error: '没能从原文页面提取出正文' });
      res.json(setEntryContent(entry.id, content));
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  })
);

/* ------------------------------ 代理接口 -------------------------------
 * 封面图与音视频都走同源代理，理由见 server/proxy.js 里的说明。
 * ---------------------------------------------------------------------- */
app.get('/api/img', wrap(imageProxy));
app.get('/api/media', wrap(mediaProxy));
app.head('/api/media', wrap(mediaProxy));

/**
 * 解析视频直链，返回可直接喂给 <video> 的同源地址。
 * YouTube：内嵌播放器加载不出来的网络环境（例如只有服务端能出网）用它兜底。
 * B 站：内嵌播放器未登录清晰度经常偏低，用它主动换更清晰的版本（登录后更高）。
 */
app.post(
  '/api/entries/:id/stream',
  wrap(async (req, res) => {
    const entry = getEntry(Number(req.params.id));
    if (!entry) return res.status(404).json({ error: '条目不存在' });
    if (!entry.link) return res.status(422).json({ error: '该条目没有视频链接' });
    if (entry.media_type !== 'video') {
      return res.status(422).json({ error: '该条目不是视频，无法解析直链' });
    }

    try {
      if (entry.feed_source === 'bilibili') {
        const { url, ...metadata } = await resolveBilibiliStream(entry.link, Number(req.body?.quality ?? 80));
        return res.json({ src: `/api/media?url=${encodeURIComponent(url)}`, ...metadata });
      }
      const direct = await resolveStream(entry.link);
      res.json({ src: `/api/media?url=${encodeURIComponent(direct)}` });
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  })
);

/* ------------------------------ B 站账号登录 ------------------------------
 * 扫码登录用官方 TV 端协议，目的：
 *  1) 播放地址接口带上登录凭证，清晰度能从免登录上限 720P 提到 1080P/4K
 *  2) 登录后可以拉取「我的关注」列表批量订阅
 * 凭证落盘在 data/bilibili_auth.json，整个 data/ 目录都在 .gitignore 里。
 * ---------------------------------------------------------------------- */

app.post(
  '/api/bilibili/login/start',
  wrap(async (req, res) => {
    try {
      const { authCode, qrDataUrl } = await startLogin();
      res.json({ authCode, qrDataUrl });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  })
);

app.get(
  '/api/bilibili/login/poll',
  wrap(async (req, res) => {
    const { authCode } = req.query;
    if (!authCode) return res.status(400).json({ error: '缺少 authCode' });
    try {
      res.json(await pollLogin(authCode));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  })
);

app.get('/api/bilibili/login/status', (req, res) => res.json(getAuthStatus()));

app.post('/api/bilibili/logout', (req, res) => {
  clearAuth();
  res.json({ ok: true });
});

/** 拉取登录账号「我的关注」列表 */
app.get(
  '/api/bilibili/followings',
  wrap(async (req, res) => {
    try {
      res.json(await fetchFollowings());
    } catch (err) {
      res.status(422).json({ error: err.message });
    }
  })
);

/**
 * 批量订阅：从关注列表里勾选的 UP 主一次性导入。
 * 已订阅过的不算失败，单独统计；某一个失败不影响其它继续处理。
 */
app.post(
  '/api/bilibili/followings/import',
  wrap(async (req, res) => {
    const { mids, category } = req.body || {};
    if (!Array.isArray(mids) || !mids.length) return res.status(400).json({ error: '缺少要导入的 UP 主列表' });

    let added = 0;
    let skipped = 0;
    const failed = [];

    for (const mid of mids) {
      try {
        const result = await addFeedByUrl(`https://space.bilibili.com/${mid}`, category);
        if (result.alreadyExists) skipped += 1;
        else added += 1;
      } catch (err) {
        failed.push({ mid, error: err.message });
      }
    }

    res.json({ added, skipped, failed });
  })
);

/* ------------------------- 生产模式下托管前端产物 ------------------------- */

const dist = join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error('[API 错误]', err.message);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

const server = app.listen(PORT, () => {
  console.log(`✅ API 已启动： http://localhost:${PORT}`);
  if (!existsSync(dist)) console.log('   开发模式：前端请访问 Vite 的地址');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n❌ 端口 ${PORT} 已被占用，多半是上一次的服务还没退干净。\n` +
        `   查看占用：lsof -ti tcp:${PORT}\n` +
        `   结束进程：kill $(lsof -ti tcp:${PORT})\n` +
        `   或换个端口：PORT=8788 npm run dev\n`
    );
    process.exit(1);
  }
  throw err;
});

if (process.env.NODE_ENV !== 'test') startScheduler(Number(process.env.REFRESH_MINUTES || 30));
