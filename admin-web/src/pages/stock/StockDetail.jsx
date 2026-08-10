import { useEffect, useState } from 'react';
import { fetchReservedDetail } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { formatIDR, fmtDate, stockTypeLabel, HEALTH } from './stock-utils.js';

const HEALTH_NOTE = {
  ok: (p) => ({ label: 'Aman', desc: `${p.available ?? 0} item siap dijual` }),
  low: (p) => ({ label: 'Menipis', desc: `${p.available ?? 0} item tersisa` }),
  out: () => ({ label: 'Habis', desc: 'Tidak ada stok tersedia' })
};

// Reserved Orders section (§43-46) — hanya di-render bila reserved > 0.
function ReservedSection({ product, onViewAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    fetchReservedDetail(product.id)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [product.id]);

  const items = data?.items || [];
  const shown = items.slice(0, 6);

  return (
    <div className="od-section">
      <div className="od-section-title">Stok Dicadangkan · {product.reserved} item</div>
      {err && <div className="stok-reserved-empty">{err}</div>}
      {!data && !err && <div className="stok-reserved-empty">Memuat…</div>}
      {data && items.length === 0 && <div className="stok-reserved-empty">Tidak ada stok yang sedang dicadangkan</div>}
      {shown.map((it) => (
        <div key={it.order_id} className="stok-res-row">
          <div className="stok-res-main">
            <span className="mono stok-res-oid">{it.order_id}</span>
            <span className="badge st-pending stok-res-status">{it.order_status}</span>
          </div>
          <div className="stok-res-meta">
            <span className="stok-res-user">{it.username ? '@' + it.username : (it.first_name || it.user_id || '-')}</span>
            <span className="stok-res-qty">×{it.qty}</span>
            <span className="stok-res-date">{fmtDate(it.reserved_at)}</span>
          </div>
        </div>
      ))}
      {items.length > shown.length && (
        <button type="button" className="pd-mini-btn stok-res-more" onClick={onViewAll}>
          Lihat Semua ({items.length})
        </button>
      )}
    </div>
  );
}

// STOCK DETAIL DOCK (§37-49) — inspect only. Mutasi stok via onManageStock (StockDrawer).
export default function StockDetail({ product: p, onClose, onManageStock, onViewReserved }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!p) return null;

  const h = HEALTH[p.stock_status] || HEALTH.ok;
  const note = (HEALTH_NOTE[p.stock_status] || HEALTH_NOTE.ok)(p);

  return (
    <div className="dock-panel">
      <div className="dock-head">
        <h3>Detail Stok</h3>
        <button className="x" onClick={onClose} aria-label="Tutup detail"><Icon name="x" /></button>
      </div>

      <div className="dock-body">
        {/* HERO */}
        <div className="od-hero">
          <div className="pd-hero-top">
            <div className="pd-hero-thumb">{(p.name_id || '?').charAt(0).toUpperCase()}</div>
            <div className="pd-hero-info">
              <div className="pd-hero-name">{p.name_id}</div>
              <div className="stok-hero-badges">
                <span className="badge st-muted">{p.category_name}</span>
                <span className={`badge ${h.cls}`}>{h.label}</span>
              </div>
            </div>
          </div>
          <div className="stok-hero-meta">
            <span>{stockTypeLabel(p.stock_type)}</span>
            <span>Harga jual: <b>{formatIDR(p.effective_price)}</b></span>
          </div>
        </div>

        {/* RINGKASAN 2×2 */}
        <div className="od-section">
          <div className="od-section-title">Ringkasan Inventory</div>
          <div className="od-summary">
            <div className="od-sum-cell">
              <span className="od-sum-label">Tersedia</span>
              <b className="od-sum-value">{p.stock_status === 'out' ? 0 : (p.available ?? 0)}</b>
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Dicadangkan</span>
              <b className="od-sum-value">{p.reserved || 0}</b>
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Terjual 30 Hari</span>
              <b className="od-sum-value">{p.sold_30d || 0}</b>
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Nilai Stok Jual</span>
              <b className="od-sum-value">{formatIDR(p.inventory_value)}</b>
            </div>
          </div>
        </div>

        {/* STOCK HEALTH */}
        <div className="od-section">
          <div className="od-section-title">Kondisi Stok</div>
          <div className={`stok-health-card stok-health-${p.stock_status}`}>
            <span className={`stok-health-dot stok-health-${p.stock_status}`} />
            <div>
              <div className="stok-health-label">{note.label}</div>
              <div className="stok-health-desc">{note.desc}</div>
            </div>
          </div>
        </div>

        {/* RESERVED ORDERS — hanya bila ada reserved */}
        {p.reserved > 0 && <ReservedSection product={p} onViewAll={onViewReserved} />}
      </div>

      {/* FOOTER STICKY — satu CTA utama (§18/§32) */}
      <div className="dock-footer">
        <div className="stok-footer-actions stok-footer-single">
          <button className="a-btn btn-icon a-blue" onClick={onManageStock}>
            <Icon name="box" size={15} /> Kelola Stok
          </button>
        </div>
      </div>
    </div>
  );
}
