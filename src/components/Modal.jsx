import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

export default function Modal({ open, onClose, label, children, busy = false, style }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
      dialogRef.current.querySelector('[data-autofocus]')?.focus();
    }
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialogRef} className="modal" aria-label={label} style={style} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialogRef.current && !busy) onClose(); }}>
    <button className="icon-btn modal-close" aria-label={`关闭${label}`} disabled={busy} onClick={onClose}><Icon name="close" /></button>
    {children}
  </dialog>;
}
