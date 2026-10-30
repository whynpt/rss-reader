import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { mediaSrc } from '../api.js';

const PlaybackContext = createContext(null);

export function PlaybackProvider({ children }) {
  const audioRef = useRef(null);
  const activeRef = useRef(null);
  const pendingSeek = useRef(null);
  const attemptRef = useRef(0);
  const [activeEntry, setActiveEntry] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(null);

  const seek = useCallback(seconds => {
    const audio = audioRef.current;
    const target = Math.max(0, Number(seconds) || 0);
    if (audio?.readyState >= 1) {
      audio.currentTime = Number.isFinite(audio.duration) ? Math.min(target, audio.duration) : target;
      pendingSeek.current = null;
      setCurrentTime(audio.currentTime);
    } else {
      pendingSeek.current = target;
      setCurrentTime(target);
    }
  }, []);

  const playEntry = useCallback((entry, seconds) => {
    if (!entry?.media_url) return;
    const audio = audioRef.current;
    const attempt = ++attemptRef.current;
    const changed = activeRef.current?.id !== entry.id || activeRef.current?.media_url !== entry.media_url;
    setError(null);
    if (changed) {
      activeRef.current = entry;
      setActiveEntry(entry);
      setCurrentTime(seconds || 0);
      setDuration(entry.duration || 0);
      pendingSeek.current = seconds ?? 0;
      audio.src = mediaSrc(entry.media_url);
      audio.load();
    } else if (audio.error) {
      pendingSeek.current = seconds ?? audio.currentTime;
      audio.load();
    }
    if (seconds != null) seek(seconds);
    setLoading(true);
    audio.play()?.then(() => {
      if (attempt === attemptRef.current && !audio.paused) setLoading(false);
    }).catch(err => {
      if (attempt !== attemptRef.current || err.name === 'AbortError') return;
      setLoading(false);
      setPlaying(false);
      setError(err.name === 'NotAllowedError' ? '浏览器暂停了自动播放，请再次点击播放。' : '音频暂时无法播放，请重试或打开节目原文。');
    });
  }, [seek]);

  const pause = useCallback(() => {
    ++attemptRef.current;
    audioRef.current?.pause();
    setLoading(false);
  }, []);
  const toggle = useCallback(() => {
    if (!activeRef.current) return;
    if (!audioRef.current.paused) pause();
    else playEntry(activeRef.current);
  }, [pause, playEntry]);
  const stop = useCallback(() => {
    pause();
    activeRef.current = null;
    setActiveEntry(null);
    audioRef.current.removeAttribute('src');
    audioRef.current.load();
    pendingSeek.current = null;
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [pause]);
  const skip = useCallback(amount => seek((audioRef.current?.currentTime || 0) + amount), [seek]);

  useEffect(() => { audioRef.current.playbackRate = rate; }, [rate, activeEntry?.id]);

  return <PlaybackContext.Provider value={{ activeEntry, playing, loading, currentTime, duration, rate, error, playEntry, pause, toggle, stop, seek, skip, setRate }}>
    {children}
    <audio
      ref={audioRef}
      preload="metadata"
      onLoadedMetadata={() => {
        const audio = audioRef.current;
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        audio.playbackRate = rate;
        if (pendingSeek.current != null) seek(pendingSeek.current);
      }}
      onDurationChange={() => { if (Number.isFinite(audioRef.current.duration)) setDuration(audioRef.current.duration); }}
      onTimeUpdate={() => setCurrentTime(audioRef.current.currentTime)}
      onPlay={() => { setPlaying(true); window.dispatchEvent(new Event('rss:podcast-play')); }}
      onPlaying={() => setLoading(false)}
      onPause={() => { setPlaying(false); setLoading(false); }}
      onWaiting={() => setLoading(true)}
      onEnded={() => { setPlaying(false); setLoading(false); }}
      onError={() => { if (activeRef.current) { setPlaying(false); setLoading(false); setError('音频加载失败。请重试，或打开节目原文检查音源。'); } }}
    />
  </PlaybackContext.Provider>;
}

export const usePlayback = () => useContext(PlaybackContext);
