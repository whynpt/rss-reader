import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'reader.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL UNIQUE,
  site_url        TEXT,
  title           TEXT NOT NULL,
  description     TEXT,
  source          TEXT NOT NULL DEFAULT 'web',
  kind            TEXT NOT NULL DEFAULT 'article',
  category        TEXT NOT NULL DEFAULT '未分类',
  created_at      TEXT NOT NULL,
  last_fetched_at TEXT,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid         TEXT NOT NULL,
  title        TEXT NOT NULL,
  link         TEXT,
  author       TEXT,
  summary      TEXT,
  content      TEXT,
  published_at TEXT NOT NULL,
  thumbnail    TEXT,
  media_type   TEXT NOT NULL DEFAULT 'article',
  media_url    TEXT,
  embed_url    TEXT,
  duration     INTEGER,
  is_read      INTEGER NOT NULL DEFAULT 0,
  is_starred   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  UNIQUE(feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_entries_published ON entries(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_feed      ON entries(feed_id);
CREATE INDEX IF NOT EXISTS idx_entries_unread    ON entries(is_read, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_starred   ON entries(is_starred, published_at DESC);
`);

const now = () => new Date().toISOString();

/* ---------------------------------- feeds --------------------------------- */

export function listFeeds() {
  return db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id AND e.is_read = 0) AS unread_count,
              (SELECT COUNT(*) FROM entries e WHERE e.feed_id = f.id)                   AS total_count
         FROM feeds f
     ORDER BY f.category, f.title COLLATE NOCASE`
    )
    .all();
}

export function getFeedByUrl(url) {
  return db.prepare('SELECT * FROM feeds WHERE url = ?').get(url);
}

export function getFeed(id) {
  return db.prepare('SELECT * FROM feeds WHERE id = ?').get(id);
}

export function insertFeed({ url, siteUrl, title, description, source, kind, category }) {
  const info = db
    .prepare(
      `INSERT INTO feeds (url, site_url, title, description, source, kind, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(url, siteUrl || null, title, description || null, source || 'web', kind || 'article', category || '未分类', now());
  return getFeed(Number(info.lastInsertRowid));
}

export function updateFeedMeta(id, { title, siteUrl, description, kind }) {
  db.prepare(
    `UPDATE feeds
        SET title       = COALESCE(?, title),
            site_url    = COALESCE(?, site_url),
            description = COALESCE(?, description),
            kind        = COALESCE(?, kind)
      WHERE id = ?`
  ).run(title || null, siteUrl || null, description || null, kind || null, id);
}

export function markFeedFetched(id, error) {
  db.prepare('UPDATE feeds SET last_fetched_at = ?, last_error = ? WHERE id = ?').run(now(), error || null, id);
}

export function deleteFeed(id) {
  return db.prepare('DELETE FROM feeds WHERE id = ?').run(id).changes > 0;
}

export function renameFeed(id, { title, category }) {
  db.prepare('UPDATE feeds SET title = COALESCE(?, title), category = COALESCE(?, category) WHERE id = ?').run(
    title || null,
    category || null,
    id
  );
  return getFeed(id);
}

/* --------------------------------- entries -------------------------------- */

const existingEntryStmt = db.prepare('SELECT id FROM entries WHERE feed_id = ? AND guid = ?');

const upsertEntryStmt = db.prepare(
  `INSERT INTO entries
     (feed_id, guid, title, link, author, summary, content,
      published_at, thumbnail, media_type, media_url, embed_url, duration, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    + `
   ON CONFLICT(feed_id, guid) DO UPDATE SET
      title        = excluded.title,
      link         = excluded.link,
      author       = excluded.author,
      summary      = excluded.summary,
      content      = excluded.content,
      published_at = excluded.published_at,
      thumbnail    = excluded.thumbnail,
      media_type   = excluded.media_type,
      media_url    = excluded.media_url,
      embed_url    = excluded.embed_url,
      duration     = excluded.duration`
);

/** 批量写入，返回真正新增的条数（靠 UNIQUE(feed_id, guid) 去重） */
export function insertEntries(feedId, items) {
  let added = 0;
  const tx = () => {
    for (const it of items) {
      const existed = existingEntryStmt.get(feedId, it.guid);
      upsertEntryStmt.run(
        feedId,
        it.guid,
        it.title,
        it.link || null,
        it.author || null,
        it.summary || null,
        it.content || null,
        it.publishedAt,
        it.thumbnail || null,
        it.mediaType || 'article',
        it.mediaUrl || null,
        it.embedUrl || null,
        it.duration ?? null,
        now()
      );
      if (!existed) added += 1;
    }
  };
  db.exec('BEGIN');
  try {
    tx();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
}

/** 列表、计数与批量已读使用同一组条件，避免分页或组合筛选改变操作范围。 */
function entryConditions({ filter = 'all', feedId, category, q, mediaType } = {}) {
  const where = [];
  const params = [];

  if (filter === 'unread') where.push('e.is_read = 0');
  if (filter === 'starred') where.push('e.is_starred = 1');
  if (filter === 'video') where.push("e.media_type IN ('video', 'audio')");

  if (mediaType === 'podcast' || mediaType === 'audio') {
    where.push("e.media_type = 'audio'");
  } else if (mediaType === 'article' || mediaType === 'video') {
    where.push('e.media_type = ?');
    params.push(mediaType);
  }

  if (feedId) {
    where.push('e.feed_id = ?');
    params.push(feedId);
  }
  if (category) {
    where.push('f.category = ?');
    params.push(category);
  }
  if (q) {
    where.push('(e.title LIKE ? OR e.summary LIKE ? OR e.author LIKE ? OR f.title LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listEntries({ limit = 60, offset = 0, ...scope } = {}) {
  const { clause, params } = entryConditions(scope);

  const sql = `
    SELECT e.*, f.title AS feed_title, f.source AS feed_source, f.category AS feed_category
      FROM entries e
      JOIN feeds f ON f.id = e.feed_id
     ${clause}
  ORDER BY e.published_at DESC, e.id DESC
     LIMIT ? OFFSET ?`;

  return db.prepare(sql).all(...params, limit, offset);
}

/** 类型标签计数覆盖整个查询结果，不局限于已加载的一页。 */
export function entryCounts(scope = {}) {
  const { clause, params } = entryConditions(scope);
  return db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(CASE WHEN e.media_type = 'article' THEN 1 END) AS article,
           COUNT(CASE WHEN e.media_type = 'video' THEN 1 END) AS video,
           COUNT(CASE WHEN e.media_type = 'audio' THEN 1 END) AS podcast,
           COUNT(CASE WHEN e.is_read = 0 THEN 1 END) AS unread,
           COUNT(CASE WHEN e.is_read = 0 AND e.media_type = 'article' THEN 1 END) AS unread_article,
           COUNT(CASE WHEN e.is_read = 0 AND e.media_type = 'video' THEN 1 END) AS unread_video,
           COUNT(CASE WHEN e.is_read = 0 AND e.media_type = 'audio' THEN 1 END) AS unread_podcast
      FROM entries e JOIN feeds f ON f.id = e.feed_id
      ${clause}
  `).get(...params);
}

export function getEntry(id) {
  return db
    .prepare(
      `SELECT e.*, f.title AS feed_title, f.source AS feed_source
         FROM entries e JOIN feeds f ON f.id = e.feed_id
        WHERE e.id = ?`
    )
    .get(id);
}

export function setEntryFlag(id, field, value) {
  if (field !== 'is_read' && field !== 'is_starred') throw new Error('非法字段');
  db.prepare(`UPDATE entries SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
  return getEntry(id);
}

export function setEntryContent(id, content) {
  db.prepare('UPDATE entries SET content = ? WHERE id = ?').run(content, id);
  return getEntry(id);
}

export function markAllRead(scope = {}) {
  const { clause, params } = entryConditions(scope);
  return db.prepare(`
    UPDATE entries SET is_read = 1
     WHERE is_read = 0 AND id IN (
       SELECT e.id FROM entries e JOIN feeds f ON f.id = e.feed_id ${clause}
     )
  `).run(...params).changes;
}

export function stats() {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM entries)                                            AS total,
         (SELECT COUNT(*) FROM entries WHERE is_read = 0)                          AS unread,
         (SELECT COUNT(*) FROM entries WHERE is_starred = 1)                       AS starred,
         (SELECT COUNT(*) FROM entries WHERE media_type IN ('video','audio'))      AS videos,
         (SELECT COUNT(*) FROM feeds)                                              AS feeds`
    )
    .get();
  return row;
}
