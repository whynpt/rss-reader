export function parseTimestamp(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  // 01:02 or 1:02:03
  const colon = value.match(/\b(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)\b/);
  if (colon) {
    const [, hours, minutes, seconds] = colon;
    return (Number(hours || 0) * 60 + Number(minutes)) * 60 + Number(seconds);
  }

  // 1h2m3s / 2m10s / 45s, common in YouTube-style URLs.
  const parts = value.match(/\b(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)\b/i);
  if (parts) {
    const [, hours, minutes, seconds] = parts;
    return (Number(hours || 0) * 60 + Number(minutes || 0)) * 60 + Number(seconds || 0);
  }

  return null;
}

export function timestampFromLink(anchor) {
  const href = anchor.getAttribute('href') || '';
  const text = anchor.textContent || '';
  const decodedHref = (() => {
    try {
      return decodeURIComponent(href);
    } catch {
      return href;
    }
  })();

  // Syntax uses #t=01:02. Also support ?t=62 / &t=1m2s from other feeds.
  const tParam = decodedHref.match(/(?:^|[#?&])t=(\d+(?::[0-5]\d){1,2}|\d+h\d+m\d+s|\d+m\d+s|\d+s|\d+)/i);
  if (tParam) {
    if (/^\d+$/.test(tParam[1])) return Number(tParam[1]);
    return parseTimestamp(tParam[1]);
  }

  return parseTimestamp(text);
}
