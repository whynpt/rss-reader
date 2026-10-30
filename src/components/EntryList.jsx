import { useState } from 'react';
import { imgSrc } from '../api.js';
import { entryAuthor, formatDuration, relativeTime, sourceBadge } from '../utils.js';
import Icon from './Icon.jsx';

export function EntryCover({ entry, className = '' }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const hasImage = entry.thumbnail && failedUrl !== entry.thumbnail;
  const type = entry.media_type === 'audio' ? 'podcast' : entry.media_type;
  return <div className={`entry-cover cover-${type} ${className}`}>
    {hasImage ? <img src={imgSrc(entry.thumbnail)} alt="" loading="lazy" onError={() => setFailedUrl(entry.thumbnail)} /> : <div className="cover-placeholder"><Icon name={type} size={30} /><span>{entry.feed_title}</span></div>}
    {type === 'video' && <><span className="cover-play"><Icon name="play" size={20} /></span>{formatDuration(entry.duration) && <span className="duration">{formatDuration(entry.duration)}</span>}</>}
  </div>;
}

export function EntryList({ entries, selectedId, onOpen, onToggleStar, onToggleRead, pending }) {
  return <div className="entry-list">
    {entries.map(entry => {
      const type = entry.media_type === 'audio' ? 'podcast' : entry.media_type;
      const typeLabel = { article: '文章', video: '视频', podcast: '播客' }[type] || '文章';
      const source = sourceBadge(entry.feed_source, entry.media_type).text;
      return <article key={entry.id} className={`entry entry-${type} ${entry.is_read ? 'read' : ''} ${selectedId === entry.id ? 'selected' : ''}`}>
        <div className="entry-meta"><Icon name={type} size={14} /><span>{typeLabel}</span><span className="meta-dot">·</span><span className="entry-feed">{entry.feed_title}</span><span className="meta-dot">·</span><time dateTime={entry.published_at}>{relativeTime(entry.published_at)}</time><span className={entry.is_read ? 'read-label' : 'unread-marker'}>{entry.is_read ? '已读' : <span className="sr-only">未读</span>}</span></div>
        <div className="entry-layout">
          <div className="entry-copy">
            <button className="entry-title-btn" onClick={() => onOpen(entry)}><h2>{entry.title}</h2></button>
            {entry.summary && <p className="entry-summary">{entry.summary}</p>}
            <div className="entry-bottom"><p className="entry-byline">{entryAuthor(entry) || source}{type === 'podcast' && formatDuration(entry.duration) ? ` · ${formatDuration(entry.duration)}` : ''}</p>
              <div className="entry-actions">
                <button className={`icon-btn ${entry.is_starred ? 'is-starred' : ''}`} aria-label={`${entry.is_starred ? '取消收藏' : '收藏'}：${entry.title}`} aria-pressed={!!entry.is_starred} disabled={pending.has(entry.id)} onClick={() => onToggleStar(entry)}><Icon name="star" size={19} /></button>
                <button className="icon-btn" aria-label={`${entry.is_read ? '标为未读' : '标为已读'}：${entry.title}`} disabled={pending.has(entry.id)} onClick={() => onToggleRead(entry)}><Icon name={entry.is_read ? 'check' : 'unread'} size={19} /></button>
              </div>
            </div>
          </div>
          {(type !== 'article' || entry.thumbnail) && <button className="entry-cover-btn" aria-label={`打开${typeLabel}：${entry.title}`} onClick={() => onOpen(entry)}><EntryCover entry={entry} /></button>}
        </div>
      </article>;
    })}
  </div>;
}
