import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { entryAuthor } from '../src/utils.js';

let store;
let feeds;
let directory;
let articleFeed;
let videoFeed;
let podcastFeed;
const originalPath = process.env.DB_PATH;

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rss-query-test-'));
  process.env.DB_PATH = join(directory, 'test.db');
  store = await import('./db.js');
  feeds = await import('./feeds.js');
});

beforeEach(() => {
  store.db.exec('DELETE FROM entries; DELETE FROM feeds;');
  articleFeed = store.insertFeed({ url: 'https://example.com/articles', title: '纸上日常', category: '阅读' });
  videoFeed = store.insertFeed({ url: 'https://example.com/videos', title: '沿途观察', source: 'bilibili', kind: 'video', category: '生活' });
  podcastFeed = store.insertFeed({ url: 'https://example.com/podcasts', title: '慢慢听', kind: 'podcast', category: '生活' });
  const item = (guid, mediaType, title, author = '') => ({ guid, mediaType, title, author, publishedAt: '2026-10-14T10:00:00Z' });
  store.insertEntries(articleFeed.id, [item('article-1', 'article', '阅读的日常', '林简'), item('article-2', 'article', '周末散步')]);
  store.insertEntries(videoFeed.id, [item('video-1', 'video', '海岸散步')]);
  store.insertEntries(podcastFeed.id, [item('podcast-1', 'audio', '散步时听什么')]);
});

after(() => {
  store?.db.close();
  if (originalPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalPath;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('三种类型分别查询，播客映射到现有 audio 字段', () => {
  for (const [mediaType, expected] of [['article', 2], ['video', 1], ['podcast', 1]]) {
    assert.equal(store.listEntries({ mediaType }).length, expected);
  }
  assert.equal(store.listEntries({ filter: 'video' }).length, 2, '保留旧视频与音频组合筛选');
});

test('类型、订阅、分类、收藏、搜索可以组合', () => {
  const episode = store.listEntries({ mediaType: 'podcast' })[0];
  store.setEntryFlag(episode.id, 'is_starred', true);
  assert.equal(store.listEntries({ filter: 'starred', category: '生活', mediaType: 'podcast', q: '散步' }).length, 1);
  assert.equal(store.listEntries({ feedId: articleFeed.id, mediaType: 'podcast' }).length, 0);
  assert.equal(store.listEntries({ q: '林简' }).length, 1, '支持按作者搜索');
  assert.equal(store.entryCounts({ q: '散步' }).total, 3);
});

test('类型计数覆盖完整数据集，分页不会截断计数', () => {
  store.insertEntries(videoFeed.id, Array.from({ length: 75 }, (_, i) => ({
    guid: `more-video-${i}`, title: `视频 ${i}`, mediaType: 'video', publishedAt: '2026-10-15T10:00:00Z',
  })));
  assert.equal(store.listEntries({ mediaType: 'video', limit: 60 }).length, 60);
  assert.equal(store.listEntries({ mediaType: 'video', limit: 60, offset: 60 }).length, 16);
  assert.deepEqual({ ...store.entryCounts() }, { total: 79, article: 2, video: 76, podcast: 1, unread: 79, unread_article: 2, unread_video: 76, unread_podcast: 1 });
  assert.equal(store.entryCounts({ feedId: articleFeed.id }).article, 2);
});

test('全部已读只修改当前筛选范围，计数随后更新', () => {
  const podcast = store.listEntries({ mediaType: 'podcast' })[0];
  store.setEntryFlag(podcast.id, 'is_starred', true);
  assert.equal(store.markAllRead({ filter: 'starred', category: '生活', q: '散步', mediaType: 'podcast' }), 1);
  assert.equal(store.entryCounts({ filter: 'unread' }).total, 3);
  assert.equal(store.getEntry(podcast.id).is_read, 1);
  assert.equal(store.listEntries({ mediaType: 'article' }).every(entry => !entry.is_read), true);
  assert.equal(store.listEntries({ mediaType: 'video' })[0].is_read, 0);
  assert.equal(store.markAllRead({ feedId: articleFeed.id, q: '阅读' }), 1);
  assert.equal(store.entryCounts({ feedId: articleFeed.id, filter: 'unread' }).total, 1);
});

test('搜索内容通过绑定参数处理，不会扩大操作范围', () => {
  assert.equal(store.listEntries({ q: "' OR 1=1 --" }).length, 0);
  assert.equal(store.markAllRead({ q: "' OR 1=1 --" }), 0);
  assert.equal(store.entryCounts().unread, 4);
});

function mockBilibiliSpace(t, card = { mid: '123', name: '已关注的UP主' }) {
  t.mock.method(globalThis, 'fetch', async address => {
    const url = new URL(address);
    assert.equal(url.searchParams.get('vmid'), '123');
    let data;
    if (url.pathname === '/x/v2/space') data = { card };
    else {
      assert.equal(url.pathname, '/x/v2/space/archive/cursor');
      data = { item: [{
        bvid: 'BV1test123456',
        title: '两位UP合作的视频',
        author: '另一位合作者 等联合创作',
        ctime: 1793318400,
        duration: 60,
      }] };
    }
    return Response.json({ code: 0, data });
  });
}

test('联合投稿的订阅名按空间 UID 获取，视频署名显示订阅的 UP 主', async t => {
  mockBilibiliSpace(t);
  const probe = await feeds.probeFeed('native:bilibili/space/123', 'bilibili');
  assert.equal(probe.title, '已关注的UP主');
  assert.equal(probe.description, '已关注的UP主 的 B 站投稿视频');
  const entry = { feed_source: 'bilibili', feed_title: probe.title, author: probe.parsed.items[0].author };
  assert.equal(entryAuthor(entry), '已关注的UP主');
  assert.equal(entryAuthor({ ...entry, feed_source: 'web' }), '另一位合作者 等联合创作');
});

test('刷新校正旧联合创作订阅名，保留已读收藏和手动名称', async t => {
  mockBilibiliSpace(t);
  const feed = store.insertFeed({ url: 'native:bilibili/space/123', title: '另一位合作者 等联合创作', source: 'bilibili' });
  store.insertEntries(feed.id, [{
    guid: 'bilibili:BV1test123456', title: '两位UP合作的视频', mediaType: 'video', publishedAt: '2026-10-30T00:00:00Z',
  }]);
  const entry = store.listEntries({ feedId: feed.id })[0];
  store.setEntryFlag(entry.id, 'is_read', true);
  store.setEntryFlag(entry.id, 'is_starred', true);

  const result = await feeds.refreshFeed(feed.id);
  assert.equal(result.error, null);
  assert.equal(result.added, 0);
  assert.equal(store.getFeed(feed.id).title, '已关注的UP主');
  assert.equal(store.getEntry(entry.id).is_read, 1);
  assert.equal(store.getEntry(entry.id).is_starred, 1);
  assert.equal(entryAuthor(store.listEntries({ feedId: feed.id })[0]), '已关注的UP主');

  store.renameFeed(feed.id, { title: '我的视频收藏' });
  await feeds.refreshFeed(feed.id);
  assert.equal(store.getFeed(feed.id).title, '我的视频收藏');
});

test('空间资料缺失或 UID 不一致时不拿合作者名称兜底', async t => {
  const card = { mid: '456', name: '另一位UP主' };
  mockBilibiliSpace(t, card);
  await assert.rejects(feeds.probeFeed('native:bilibili/space/123', 'bilibili'), /无法确认/);
  card.mid = '123';
  card.name = '';
  await assert.rejects(feeds.probeFeed('native:bilibili/space/123', 'bilibili'), /无法确认/);
});
