import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, imgSrc, mediaSrc } from '../api.js';
import { usePlayback } from './PlaybackProvider.jsx';
import Icon from './Icon.jsx';

export default forwardRef(function VideoPlayer({ entry, directMedia, biliLoggedIn, onBiliLogin }, ref) {
  const playback = usePlayback();
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const resumeRef = useRef(null);
  const [forceLocal, setForceLocal] = useState(false);
  const [embedFailed, setEmbedFailed] = useState(false);
  const [quality, setQuality] = useState(80);
  const [streamInfo, setStreamInfo] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [resolution, setResolution] = useState(null);
  const isBilibili = entry.feed_source === 'bilibili';
  const embedUrl = entry.embed_url;
  const wantLocal = isBilibili || (!!embedUrl && (forceLocal || embedFailed || directMedia === false));
  const poster = entry.thumbnail ? imgSrc(entry.thumbnail) : undefined;

  useEffect(() => {
    const pauseVideo = () => {
      videoRef.current?.pause();
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
    };
    window.addEventListener('rss:podcast-play', pauseVideo);
    return () => window.removeEventListener('rss:podcast-play', pauseVideo);
  }, []);

  useEffect(() => {
    if (!embedUrl || wantLocal) return undefined;
    const onMessage = event => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      try { if (!/(^|\.)youtube(-nocookie)?\.com$/.test(new URL(event.origin).hostname)) return; } catch { return; }
      let data = event.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
      const code = data?.info?.errorCode ?? (data?.event === 'onError' ? data.info : null);
      if (code != null) setEmbedFailed(true);
      if (data?.info?.playerState === 1 || (data?.event === 'onStateChange' && data.info === 1)) playback.pause();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedUrl, wantLocal, playback.pause]);

  useEffect(() => {
    if (!wantLocal) return undefined;
    let cancelled = false;
    setStatus('loading'); setError(null); setStreamInfo(null); setResolution(null);
    api.stream(entry.id, isBilibili ? quality : undefined).then(result => {
      if (!cancelled) { setStreamInfo(result); setStatus('ready'); }
    }).catch(err => { if (!cancelled) { setError(err.message); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [wantLocal, entry.id, quality, retry, isBilibili, biliLoggedIn]);

  useEffect(() => {
    if (status !== 'loading') return undefined;
    setElapsed(0);
    const timer = setInterval(() => setElapsed(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status, retry]);

  useImperativeHandle(ref, () => ({
    seekTo(seconds) {
      if (videoRef.current) {
        if (videoRef.current.readyState) videoRef.current.currentTime = seconds;
        else resumeRef.current = { time: seconds, playing: true };
        videoRef.current.play().catch(() => {});
      } else {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }), '*');
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
      }
    },
  }), []);

  const retryLocal = () => {
    setError(null);
    if (!embedUrl && !isBilibili) {
      setStatus('idle');
      return;
    }
    setForceLocal(true); setRetry(value => value + 1);
  };
  const capturePosition = () => {
    if (videoRef.current) resumeRef.current = { time: videoRef.current.currentTime, playing: !videoRef.current.paused };
  };
  const nativeVideo = src => <video ref={videoRef} className="player" src={src} poster={poster} controls preload="metadata" onPlay={playback.pause} onLoadedMetadata={() => {
    const video = videoRef.current;
    setResolution(video.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight}` : null);
    if (resumeRef.current) {
      const saved = resumeRef.current;
      video.currentTime = Number.isFinite(video.duration) ? Math.min(saved.time, video.duration) : saved.time;
      if (saved.playing) video.play().catch(() => {});
      resumeRef.current = null;
    }
  }} onError={() => { setError('视频加载失败，可以重试取流或打开原站。'); setStatus('error'); }} />;

  let stage;
  if (wantLocal && status === 'error') stage = <div className="player-fallback error"><Icon name="video" size={32} /><p>{error}</p><div className="player-fallback-actions"><button className="tool-btn" onClick={retryLocal}>重新加载</button>{entry.link && <a className="tool-btn" href={entry.link} target="_blank" rel="noreferrer">打开原站 <Icon name="external" size={14} /></a>}</div></div>;
  else if (wantLocal && status === 'ready' && streamInfo?.src) stage = nativeVideo(streamInfo.src);
  else if (wantLocal) stage = <div className="player-fallback"><Icon name="refresh" className="spin" size={28} /><p>正在加载视频{elapsed ? ` · ${elapsed}秒` : '…'}</p><span>首次加载可能需要一点时间</span></div>;
  else if (embedUrl) stage = <iframe ref={iframeRef} className="player" src={`${embedUrl}${embedUrl.includes('?') ? '&' : '?'}enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`} title={entry.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => { iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*'); }} />;
  else if (entry.media_url && status !== 'error') stage = nativeVideo(mediaSrc(entry.media_url));
  else stage = <div className="player-fallback error"><p>{error || '这个订阅没有提供可播放的视频地址。'}</p><div className="player-fallback-actions">{entry.media_url && <button className="tool-btn" onClick={retryLocal}>重新加载</button>}{entry.link && <a className="tool-btn" href={entry.link} target="_blank" rel="noreferrer">打开原站</a>}</div></div>;

  return <div className="video-viewer">
    <div className="video-stage">{stage}</div>
    {embedUrl && !wantLocal && <div className="player-note"><span>播放遇到问题？</span><button className="tool-btn" onClick={retryLocal}>尝试备用播放</button></div>}
    {isBilibili && <div className="video-quality">
      <label>清晰度 <select aria-label="B站清晰度" value={quality} onChange={event => { capturePosition(); setQuality(Number(event.target.value)); }}><option value={80}>1080P</option><option value={64}>720P</option></select></label>
      <span aria-live="polite">实际：{streamInfo?.qualityLabel || '尚未获取'}{resolution ? ` · ${resolution}` : ''}</span>
      {streamInfo?.needsLogin ? <button className="text-btn" onClick={onBiliLogin}>登录 B站以尝试 1080P</button> : streamInfo?.quality != null && streamInfo.quality < quality ? <span>当前账号或视频未提供所选清晰度，已使用可用版本。</span> : null}
    </div>}
  </div>;
});
