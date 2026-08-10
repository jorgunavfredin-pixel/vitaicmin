import { useState } from 'react';
import Icon from '../../../components/Icons.jsx';

export default function ConfirmDeleteModal({ title, message, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-icon modal-icon-danger"><Icon name="warning" size={30} /></div>
        <h4>{title}</h4>
        <p style={{ margin: '10px 0 20px', color: 'var(--muted)', fontSize: 13.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Batal</button>
          <button className="btn-danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? 'Menghapus...' : 'Ya, Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  );
}
