import { formatDuration } from '../utils.js';
import { EntryCover } from './EntryList.jsx';
import { usePlayback } from './PlaybackProvider.jsx';
import Icon from './Icon.jsx';

export default function PersistentAudioPlayer({ onOpen }) {
  const playback = usePlayback();
  const { activeEntry, playing, loading, currentTime, duration, rate, error } = playback;
  if (!activeEntry) return null;
  return <section className="persistent-player" aria-label="播客播放器">
    {error && <div className="player-error" role="alert">{error}</div>}
    <div className="player-episode"><EntryCover entry={activeEntry} /><div className="player-episode-copy"><button onClick={() => onOpen(activeEntry)} title={activeEntry.title}>{activeEntry.title}</button><p>{loading ? '正在缓冲…' : playing ? '正在收听' : '已暂停'} · {activeEntry.feed_title}</p></div></div>
    <div className="audio-transport">
      <div className="audio-buttons"><button className="icon-btn skip-btn" aria-label="后退15秒" onClick={() => playback.skip(-15)}>−15</button><button className="audio-play" aria-label={playing ? '暂停播客' : '播放播客'} onClick={playback.toggle}><Icon name={playing ? 'pause' : 'play'} size={23} /></button><button className="icon-btn skip-btn" aria-label="前进15秒" onClick={() => playback.skip(15)}>＋15</button></div>
      <div className="audio-progress"><span>{formatDuration(currentTime) || '0:00'}</span><input type="range" aria-label="播客播放进度" aria-valuetext={`${formatDuration(currentTime) || '0:00'} / ${formatDuration(duration) || '未知时长'}`} min="0" max={duration || 0} step="1" value={Math.min(currentTime, duration || 0)} disabled={!duration} onChange={event => playback.seek(Number(event.target.value))} /><span>{formatDuration(duration) || '—:—'}</span></div>
    </div>
    <div className="audio-options"><select aria-label="播客播放速度" value={rate} onChange={event => playback.setRate(Number(event.target.value))}><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><button className="icon-btn" aria-label="停止并关闭播客播放器" onClick={playback.stop}><Icon name="close" size={18} /></button></div>
  </section>;
}
