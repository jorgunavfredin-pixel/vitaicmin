import { useEffect, useState } from 'react';
import { fetchReservedDetail } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { fmtDate } from './stock-utils.js';

// Reserved detail modal — daftar lengkap order yang menahan stok (§46 "Lihat Semua").
// JANGAN kontrol hapus reserved (§48).
export default function ReservedModal({ product, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchReservedDetail(product.id).then(setData).catch((e) => setErr(e.message));
  }, [product.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="clock" size={18} /> Stok Dicadangkan — {product.name_id}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p className="stok-modal-note">
          Stok ini ditahan oleh order yang belum lunas. Akan otomatis dilepas saat order expired/cancel/refund.
        </p>
        {err && <div className="empty error-panel">{err}</div>}
        {!data && !err && <div className="empty">Memuat…</div>}
        {data && data.items.length === 0 && <div className="empty">Tidak ada stok ter-reserve.</div>}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order ID</th><th>User</th><th>Qty</th><th>Status</th><th>Dicadangkan</th></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.order_id}>
                    <td data-label="Order ID" className="mono">{it.order_id}</td>
                    <td data-label="User">{it.username ? '@' + it.username : (it.first_name || it.user_id || '-')}</td>
                    <td data-label="Qty"><b>{it.qty}</b></td>
                    <td data-label="Status"><span className="badge st-pending">{it.order_status}</span></td>
                    <td data-label="Dicadangkan" className="muted-cell">{fmtDate(it.reserved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
