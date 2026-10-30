import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

const STATUS_TEXT = {
  loading: '正在生成二维码…',
  pending: '请用 B 站 App 扫码',
  scanned: '已扫描，请在手机上点击确认',
  expired: '二维码已过期',
};

export default function BilibiliLoginDialog({ open, onClose, onLoggedIn }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const authCodeRef = useRef(null);
  const timerRef = useRef(null);

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startLogin = async () => {
    stopPolling();
    setStatus('loading');
    setError(null);
    setQrDataUrl(null);
    try {
      const { authCode, qrDataUrl: dataUrl } = await api.bilibiliLoginStart();
      authCodeRef.current = authCode;
      setQrDataUrl(dataUrl);
      setStatus('pending');

      timerRef.current = setInterval(async () => {
        try {
          const res = await api.bilibiliLoginPoll(authCodeRef.current);
          if (res.status === 'success') {
            stopPolling();
            onLoggedIn?.({ uname: res.uname, mid: res.mid });
          } else if (res.status === 'error') {
            stopPolling();
            setStatus('error');
            setError(res.message);
          } else {
            setStatus(res.status); // pending / scanned / expired
            if (res.status === 'expired') stopPolling();
          }
        } catch (err) {
          stopPolling();
          setStatus('error');
          setError(err.message);
        }
      }, 2000);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  useEffect(() => {
    if (open) startLogin();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} label="登录B站账号">
        <div className="modal-head">
          <h2>登录 B 站账号</h2>
          <p>
            用 B 站 App 扫码登录，登录后可尝试 1080P，实际清晰度由账号权限和视频决定，
            还能一键导入你关注的 UP 主。凭证只存在本机，不会上传到任何第三方。
          </p>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {status === 'error' ? (
            <div className="modal-error" style={{ width: '100%' }}>
              {error}
            </div>
          ) : (
            <>
              <div className="qr-frame">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="B 站登录二维码" width={220} height={220} />
                ) : (
                  <div className="qr-placeholder">⟳</div>
                )}
                {status === 'scanned' && <div className="qr-overlay">✓ 已扫描</div>}
                {status === 'expired' && <div className="qr-overlay">已过期</div>}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{STATUS_TEXT[status]}</div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          {(status === 'expired' || status === 'error') && (
            <button className="btn-primary" onClick={startLogin}>
              重新生成
            </button>
          )}
        </div>
    </Modal>
  );
}
