import { useRef, useState } from 'react';
import { entryAuthor, formatDate, formatDuration, sourceBadge } from '../utils.js';
import { api, imgSrc } from '../api.js';
import { timestampFromLink } from '../timestamps.js';
import Icon from './Icon.jsx';
import VideoPlayer from './VideoPlayer.jsx';
import { EntryCover } from './EntryList.jsx';
import { usePlayback } from './PlaybackProvider.jsx';
import usePanelFocus from './usePanelFocus.js';

export default function EntryDetail({ entry, directMedia, biliLoggedIn, onBiliLogin, onClose, onToggleStar, onToggleRead, onContentLoaded, pending }) {
  const panelRef = useRef(null);
  const videoRef = useRef(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const playback = usePlayback();
  usePanelFocus(panelRef, onClose, true, true);
  const isPodcast = entry.media_type === 'audio';
  const isVideo = entry.media_type === 'video';
  const source = sourceBadge(entry.feed_source, entry.media_type);
  const author = entryAuthor(entry);
  const shortContent = (entry.content || '').replace(/<[^>]+>/g, '').trim().length < 600;
  const canFetchFull = entry.link && entry.media_type === 'article' && shortContent;
  const isPlaying = playback.activeEntry?.id === entry.id && playback.playing;

  const loadFullText = async () => {
    setFetching(true); setFetchError(null);
    try { const updated = await api.fullText(entry.id); onContentLoaded(entry.id, updated.content); }
    catch (err) { setFetchError(err.message); }
    finally { setFetching(false); }
  };
  const handleContentClick = event => {
    if (!isPodcast && !isVideo) return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (!anchor) return;
    const seconds = timestampFromLink(anchor);
    if (seconds == null) return;
    event.preventDefault();
    if (isPodcast) playback.playEntry(entry, seconds);
    else videoRef.current?.seekTo(seconds);
  };

  return <>
    <button className="detail-scrim" aria-label="关闭详情背景" onClick={onClose} tabIndex={-1} />
    <section className={`detail detail-${isPodcast ? 'podcast' : entry.media_type}`} ref={panelRef} role="dialog" aria-labelledby="detail-title">
      <header className="detail-header">
        <div className="detail-top-left"><button className="icon-btn" aria-label="关闭详情，返回信息流" onClick={onClose}><Icon name="arrow" /></button><span>{isPodcast ? '播客详情' : isVideo ? '正在观看' : '沉浸阅读'}</span></div>
        <div className="detail-header-actions">
          <button className={`icon-btn ${entry.is_starred ? 'is-starred' : ''}`} aria-label={entry.is_starred ? '取消收藏当前内容' : '收藏当前内容'} aria-pressed={!!entry.is_starred} disabled={pending} onClick={() => onToggleStar(entry)}><Icon name="star" /></button>
          <button className="icon-btn" aria-label={entry.is_read ? '将当前内容标为未读' : '将当前内容标为已读'} disabled={pending} onClick={() => onToggleRead(entry)}><Icon name={entry.is_read ? 'check' : 'unread'} /></button>
          {entry.link && <a className="icon-btn" href={entry.link} target="_blank" rel="noreferrer" aria-label="打开原文"><Icon name="external" size={18} /></a>}
        </div>
      </header>
      <div className="detail-body">
        {isVideo && <VideoPlayer ref={videoRef} entry={entry} directMedia={directMedia} biliLoggedIn={biliLoggedIn} onBiliLogin={onBiliLogin} />}
        <div className={`detail-inner ${!isVideo && !isPodcast ? 'reading' : ''}`}>
          {isPodcast ? <>
            <div className="episode-header"><EntryCover entry={entry} /><div><p className="eyebrow">{entry.feed_title} · 播客</p><h2 id="detail-title" className="detail-title">{entry.title}</h2><p className="detail-meta">{entry.author || entry.feed_title}{formatDuration(entry.duration) ? ` · ${formatDuration(entry.duration)}` : ''}</p><time className="detail-date" dateTime={entry.published_at}>{formatDate(entry.published_at)}</time></div></div>
            <button className="episode-play btn-primary" disabled={!entry.media_url} onClick={() => isPlaying ? playback.pause() : playback.playEntry(entry)}><Icon name={isPlaying ? 'pause' : 'play'} size={18} />{isPlaying ? '暂停收听' : playback.activeEntry?.id === entry.id ? '继续收听' : '开始收听'}</button>
            {!entry.media_url && <p className="fulltext-error">此订阅未提供音频地址，可以打开节目原文查看。</p>}
            <h3 className="notes-heading">节目笔记 · Show Notes</h3>
          </> : <>
            <p className="eyebrow">{source.text} · {entry.feed_title}</p><h2 id="detail-title" className="detail-title">{entry.title}</h2>
            <div className="detail-meta">{author && <span>{author}</span>}<time dateTime={entry.published_at}>{formatDate(entry.published_at)}</time>{isVideo && formatDuration(entry.duration) && <span>{formatDuration(entry.duration)}</span>}</div>
            {!isVideo && entry.thumbnail && <img className="reading-image" src={imgSrc(entry.thumbnail)} alt="" onError={event => { event.currentTarget.hidden = true; }} />}
          </>}
          {entry.content ? <div className="detail-content" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: entry.content }} /> : <p className="detail-content">{entry.summary || '这个订阅没有提供正文，可以通过右上角的原文入口继续阅读。'}</p>}
          {canFetchFull && <div className="fulltext-hint"><p>想继续阅读？尝试加载原文的完整内容。</p><button className="tool-btn" onClick={loadFullText} disabled={fetching}><Icon name={fetching ? 'refresh' : 'article'} className={fetching ? 'spin' : ''} size={16} />{fetching ? '正在加载全文…' : '加载全文'}</button>{fetchError && <p className="fulltext-error" role="alert">{fetchError}</p>}</div>}
        </div>
      </div>
    </section>
  </>;
}
