import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';

const SOURCES = {
  article: { label: '知乎 / 文章', placeholder: 'https://example.com/feed.xml', hint: '支持标准 RSS 和博客首页；知乎热榜可直接订阅，其他知乎内容需要可用的 RSS 地址。' },
  video: { label: 'B站 / 视频', placeholder: 'https://space.bilibili.com/数字ID', hint: '粘贴 B站 UP 主空间或 YouTube 频道地址，自动识别订阅源。' },
  podcast: { label: '播客 / RSS音频', placeholder: 'https://example.com/podcast/rss', hint: '粘贴节目的 RSS 订阅地址，支持带音频附件的标准播客源。' },
};
const EXAMPLES = [
  { label: '知乎热榜', value: '知乎热榜', type: 'article' },
  { label: 'B站 UP 主', value: 'https://space.bilibili.com/946974', type: 'video' },
  { label: '播客', value: 'https://feed.syntax.fm/rss', type: 'podcast' },
  { label: '博客', value: 'https://overreacted.io', type: 'article' },
  { label: 'YouTube', value: 'https://www.youtube.com/@Fireship', type: 'video' },
];
function addressError(value) {
  if (!value.trim()) return '请填写订阅地址，或选择下方示例。';
  if (value.trim() === '知乎热榜') return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.') || parsed.username || parsed.password) throw new Error();
    return null;
  } catch { return '请输入完整的 HTTP / HTTPS 地址。'; }
}

export default function AddFeedDialog({ open, onClose, onSubmit }) {
  const [source, setSource] = useState('article');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState(null);
  const [urlError, setUrlError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setSource('article'); setUrl(''); setName(''); setCategory(''); setError(null); setUrlError(null); setBusy(false); }
  }, [open]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    const invalid = addressError(url);
    setUrlError(invalid);
    if (invalid) return;
    setBusy(true); setError(null);
    try { await onSubmit(url.trim(), category.trim(), name.trim()); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} label="添加订阅" busy={busy}>
    <form onSubmit={submit} noValidate>
      <div className="modal-head"><p className="eyebrow">留给喜欢的内容</p><h2>添加一份好内容</h2><p>把喜欢的作者、频道或节目，放进你的内容收件箱。</p></div>
      <div className="modal-body">
        <label className="field-label" htmlFor="feed-source">来源类型</label><select id="feed-source" value={source} disabled={busy} onChange={event => setSource(event.target.value)}>{Object.entries(SOURCES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
        <label className="field-label" htmlFor="feed-name">订阅名称 <span>可选</span></label><input id="feed-name" type="text" maxLength={80} value={name} disabled={busy} placeholder="留空时使用来源名称" onChange={event => setName(event.target.value)} />
        <label className="field-label" htmlFor="feed-url">订阅地址</label><input id="feed-url" data-autofocus type="text" value={url} disabled={busy} placeholder={SOURCES[source].placeholder} aria-invalid={urlError ? 'true' : undefined} aria-describedby="feed-url-hint feed-url-error" onChange={event => { setUrl(event.target.value); setUrlError(null); setError(null); }} onBlur={() => { if (url.trim()) setUrlError(addressError(url)); }} />
        <p id="feed-url-hint" className="field-hint">{SOURCES[source].hint}</p><p id="feed-url-error" className="field-error" role="alert">{urlError}</p>
        <label className="field-label" htmlFor="feed-category">分类 <span>可选</span></label><input id="feed-category" type="text" maxLength={40} placeholder="例如：技术、生活、播客" value={category} disabled={busy} onChange={event => setCategory(event.target.value)} />
        <div className="examples">{EXAMPLES.map(example => <button type="button" className="example-chip" key={example.label} disabled={busy} onClick={() => { setSource(example.type); setUrl(example.value); setUrlError(null); setError(null); }}>{example.label}</button>)}</div>
        {error && <div className="modal-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot"><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>取消</button><button className="btn-primary" type="submit" disabled={busy}>{busy ? '正在解析并订阅…' : '添加订阅'}</button></div>
    </form>
  </Modal>;
}
