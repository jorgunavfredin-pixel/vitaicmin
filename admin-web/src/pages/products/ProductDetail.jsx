import { useEffect } from 'react';
import Icon from '../../components/Icons.jsx';
import { formatIDR, stockTypeLabel } from './utils.jsx';

// ---- PRODUCT DETAIL DOCK ----
export default function ProductDetail({ product: p, onClose, onEdit, onStock, onFlash, onBulk, onDelete, onToggle }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!p) return null;

  return (
    <div className="dock-panel">
      <div className="dock-head">
        <h3>Detail Produk</h3>
        <button className="x" onClick={onClose} aria-label="Tutup detail"><Icon name="x" /></button>
      </div>

      <div className="dock-body">
        {/* HERO */}
        <div className="od-hero">
          <div className="pd-hero-top">
            <div className="pd-hero-thumb">{(p.name_id || '?').charAt(0).toUpperCase()}</div>
            <div className="pd-hero-info">
              <div className="pd-hero-name">{p.name_id}</div>
              {p.name_en && <div className="pd-hero-sub">{p.name_en}</div>}
              <span className="badge st-muted pd-hero-cat">{p.category_name_id}</span>
            </div>
            <span className={`badge ${p.active ? 'st-delivered' : 'st-expired'}`}>{p.active ? 'Aktif' : 'Nonaktif'}</span>
          </div>
        </div>

        {/* RINGKASAN 2×2 */}
        <div className="od-section">
          <div className="od-section-title">Ringkasan</div>
          <div className="od-summary">
            <div className="od-sum-cell">
              <span className="od-sum-label">Harga</span>
              <b className="od-sum-value">{p.is_flash_active ? formatIDR(p.flash_price) : formatIDR(p.price_idr)}</b>
              {p.is_flash_active && <span className="od-sum-sub">normal {formatIDR(p.price_idr)}</span>}
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Stok Tersedia</span>
              <b className="od-sum-value">{p.available_stock}</b>
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Terjual (30h)</span>
              <b className="od-sum-value">{p.sold_stock || 0}</b>
            </div>
            <div className="od-sum-cell">
              <span className="od-sum-label">Tipe Stok</span>
              <b className="od-sum-value">{stockTypeLabel(p.stock_type)}</b>
            </div>
          </div>
        </div>

        {/* FLASH SALE */}
        <div className="od-section">
          <div className="od-section-titlerow">
            <span className="od-section-title">Flash Sale</span>
            <button className="pd-mini-btn" onClick={onFlash}>{p.is_flash_active ? 'Kelola' : 'Buat'}</button>
          </div>
          {p.is_flash_active ? (
            <div className="pd-inline">
              <span className="badge st-delivered">Aktif</span>
              <span className="pd-inline-val">{formatIDR(p.flash_price)}</span>
            </div>
          ) : (
            <div className="pd-empty-inline">Tidak ada flash sale aktif</div>
          )}
        </div>

        {/* BULK DISCOUNT */}
        <div className="od-section">
          <div className="od-section-titlerow">
            <span className="od-section-title">Diskon Grosir</span>
            <button className="pd-mini-btn" onClick={onBulk}>Kelola</button>
          </div>
          {p.parsed_qty_discounts?.length > 0 ? (
            <div className="pd-tiers">
              {p.parsed_qty_discounts.map((t, i) => (
                <div key={i} className="pd-tier"><span>Beli {t.min_qty}+</span><b>{formatIDR(t.price)}</b></div>
              ))}
            </div>
          ) : (
            <div className="pd-empty-inline">Belum ada diskon grosir</div>
          )}
        </div>

        {/* INFO STOK */}
        <div className="od-section">
          <div className="od-section-title">Informasi Stok</div>
          <div className="pd-inline"><span className="od-sum-label">Stok tersedia</span><b>{p.available_stock}</b></div>
          <div className="pd-inline"><span className="od-sum-label">Status</span><b>{p.available_stock === 0 ? 'Habis' : p.available_stock < 5 ? 'Menipis' : 'Aman'}</b></div>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="dock-footer">
        <div className="od-actions">
          <button className="a-btn btn-icon a-blue" onClick={onEdit}><Icon name="edit" size={15} /> Edit</button>
          <button className="a-btn btn-icon a-blue" onClick={onStock}><Icon name="box" size={15} /> Stok</button>
          <button className="a-btn btn-icon a-amber" onClick={onToggle}><Icon name={p.active ? 'pause' : 'check'} size={15} /> {p.active ? 'Pause' : 'Aktifkan'}</button>
          <button className="a-btn btn-icon a-red" onClick={onDelete}><Icon name="trash" size={15} /> Hapus</button>
        </div>
      </div>
    </div>
  );
}
