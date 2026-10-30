export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);

  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.round(months / 12)} 年前`;
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sourceBadge(source, mediaType) {
  if (source === 'youtube') return { text: 'YouTube', className: 'badge-youtube' };
  if (source === 'bilibili') return { text: 'B 站', className: 'badge-bilibili' };
  if (source === 'zhihu') return { text: '知乎', className: 'badge-zhihu' };
  if (mediaType === 'audio') return { text: '播客', className: 'badge-podcast' };
  if (mediaType === 'video') return { text: '视频', className: 'badge-video' };
  return { text: '文章', className: 'badge-article' };
}

export function entryAuthor(entry) {
  return entry.feed_source === 'bilibili'
    ? entry.feed_title || entry.author
    : entry.author;
}
