import { useEffect } from 'react';

export default function usePanelFocus(ref, onClose, enabled = true, includePlayer = false) {
  useEffect(() => {
    if (!enabled || !ref.current) return undefined;
    const previous = document.activeElement;
    const panel = ref.current;
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';
    panel.querySelector(selector)?.focus();
    const handleKey = (event) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const nodes = [...panel.querySelectorAll(selector), ...(includePlayer ? document.querySelectorAll('.persistent-player button, .persistent-player input:not(:disabled), .persistent-player select') : [])].filter(node => node.getClientRects().length);
        const first = nodes[0];
        const last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
      else document.getElementById('main')?.focus();
    };
  }, [enabled, includePlayer, onClose, ref]);
}
