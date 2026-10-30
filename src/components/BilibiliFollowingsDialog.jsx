import { useEffect, useState } from 'react';
import { api, imgSrc } from '../api.js';
import Modal from './Modal.jsx';

export default function BilibiliFollowingsDialog({ open, onClose, onImported }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [list, setList] = useState([]);
  const [checked, setChecked] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setResult(null);
    api
      .bilibiliFollowings()
      .then((data) => {
        setList(data);
        setChecked(new Set(data.map((u) => u.mid))); // 默认全选，用户可以取消不想要的
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const toggle = (mid) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid);
      else next.add(mid);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked((prev) => (prev.size === list.length ? new Set() : new Set(list.map((u) => u.mid))));
  };

  const doImport = async () => {
    if (!checked.size) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.bilibiliImportFollowings([...checked]);
      setResult(res);
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} label="导入关注" style={{ maxWidth: 480 }} busy={importing}>
        <div className="modal-head">
          <h2>导入关注的 UP 主</h2>
          <p>勾选想订阅的 UP 主，一次性批量添加。已经订阅过的会自动跳过。</p>
        </div>

        <div className="modal-body">
          {loading && <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '20px 0' }}>正在拉取关注列表…</div>}

          {error && <div className="modal-error">{error}</div>}

          {!loading && !error && list.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '20px 0' }}>还没有关注任何 UP 主。</div>
          )}

          {!loading && list.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <button className="tool-btn" onClick={toggleAll}>
                  {checked.size === list.length ? '取消全选' : '全选'}
                </button>
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)', alignSelf: 'center' }}>
                  已选 {checked.size} / {list.length}
                </span>
              </div>

              <div className="following-list">
                {list.map((u) => (
                  <label key={u.mid} className="following-row">
                    <input type="checkbox" checked={checked.has(u.mid)} onChange={() => toggle(u.mid)} />
                    <img className="following-face" src={imgSrc(u.face)} alt="" />
                    <div className="following-info">
                      <div className="following-name">{u.name}</div>
                      {u.sign && <div className="following-sign">{u.sign}</div>}
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          {result && (
            <div className="fulltext-hint" style={{ marginTop: 12 }}>
              导入完成：新增 {result.added} 个，已订阅跳过 {result.skipped} 个
              {result.failed.length > 0 && `，失败 ${result.failed.length} 个`}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose} disabled={importing}>
            {result ? '关闭' : '取消'}
          </button>
          {!result && (
            <button className="btn-primary" onClick={doImport} disabled={importing || !checked.size}>
              {importing ? '正在导入…' : `导入选中的 ${checked.size} 个`}
            </button>
          )}
        </div>
    </Modal>
  );
}
