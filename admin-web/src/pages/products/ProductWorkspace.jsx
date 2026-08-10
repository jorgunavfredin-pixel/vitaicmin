import { useState, useEffect } from 'react';
import { toggleActiveProduct } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { formatIDR, stockTypeLabel } from './utils.jsx';
import ProductForm from './ProductForm.jsx';
import FlashSaleForm from './FlashSaleForm.jsx';
import BulkDiscountForm from './BulkDiscountForm.jsx';
import StockManagerContent from '../../features/stock/StockManagerContent.jsx';
import ConfirmDeleteModal from './modals/ConfirmDeleteModal.jsx';
import { deleteProduct } from '../../api.js';

/**
 * SATU Product Workspace (dock kanan multi-mode) — spec 02b.
 * mode: detail | edit | stock | flash | bulk | create
 * Semua manajemen produk terjadi di dock yang sama; TIDAK ada modal/drawer
 * menumpuk (§76). Delete = confirm modal (boleh, destruktif §4).
 */
export default function ProductWorkspace({ product, mode, categories, onClose, setMode, toast, reload, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Escape → tutup workspace
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (moreOpen) setMoreOpen(false); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, moreOpen]);

  const p = product;
  const back = () => setMode('detail');

  // create mode boleh tanpa product
  if (!p && mode !== 'create') return null;

  const HEAD = {
    detail: 'Detail Produk',
    edit: 'Edit Produk',
    stock: 'Kelola Stok',
    flash: 'Atur Flash Sale',
    bulk: 'Atur Diskon Grosir',
    create: 'Tambah Produk'
  };
  const showBack = ['edit', 'stock', 'flash', 'bulk'].includes(mode);

  const handleToggle = async () => {
    setMoreOpen(false);
    try { const r = await toggleActiveProduct(p.id); toast(r.message); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const doDelete = async () => {
    try { const r = await deleteProduct(p.id); toast(r.message); setConfirmDelete(false); onDeleted(); }
    catch (e) { toast(e.message, 'err'); setConfirmDelete(false); }
  };

  return (
    <div className="dock-panel">
      <div className="dock-head">
        {showBack && <button className="dock-back" onClick={back} aria-label="Kembali ke detail"><Icon name="arrow-back" /></button>}
        <h3>{HEAD[mode]}</h3>
        <button className="x" onClick={onClose} aria-label="Tutup workspace"><Icon name="x" /></button>
      </div>

      {/* ---- DETAIL ---- */}
      {mode === 'detail' && p && (
        <>
          <div className="dock-body">
            {/* HERO */}
            <div className="od-hero">
              <div className="pd-hero-top">
                <div className="pd-hero-thumb">{(p.name_id || '?').charAt(0).toUpperCase()}</div>
                <div className="pd-hero-info">
                  <div className="pd-hero-name">{p.name_id}</div>
                  <span className="badge st-muted pd-hero-cat">{p.category_name_id}</span>
                </div>
                <span className={`badge ${p.active ? 'st-delivered' : 'st-expired'}`}>{p.active ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className="pd-hero-price">{p.is_flash_active ? formatIDR(p.flash_price) : formatIDR(p.price_idr)}
                {p.is_flash_active && <span className="pd-hero-price-was">{formatIDR(p.price_idr)}</span>}
              </div>
            </div>

            {/* RINGKASAN 2×2 */}
            <div className="od-section">
              <div className="od-section-title">Ringkasan</div>
              <div className="od-summary">
                <div className="od-sum-cell"><span className="od-sum-label">Stok Tersedia</span><b className="od-sum-value">{p.available_stock}</b></div>
                <div className="od-sum-cell"><span className="od-sum-label">Terjual (30h)</span><b className="od-sum-value">{p.sold_stock || 0}</b></div>
                <div className="od-sum-cell"><span className="od-sum-label">Tipe Stok</span><b className="od-sum-value">{stockTypeLabel(p.stock_type)}</b></div>
                <div className="od-sum-cell"><span className="od-sum-label">Status</span><b className="od-sum-value">{p.active ? 'Aktif' : 'Nonaktif'}</b></div>
              </div>
            </div>

            {/* PROMOSI — flash + bulk digabung (§11) */}
            <div className="od-section">
              <div className="od-section-title">Promosi</div>
              <div className="promo-row">
                <div className="promo-info">
                  <span className="promo-name">Flash Sale</span>
                  <span className="promo-sub">
                    {p.is_flash_active
                      ? `${formatIDR(p.flash_price)} · aktif`
                      : 'Tidak aktif'}
                  </span>
                </div>
                <button className="promo-set" onClick={() => setMode('flash')}>Atur</button>
              </div>
              <div className="promo-row">
                <div className="promo-info">
                  <span className="promo-name">Diskon Grosir</span>
                  <span className="promo-sub">
                    {p.parsed_qty_discounts?.length > 0
                      ? `${p.parsed_qty_discounts.length} tier aktif`
                      : 'Belum diatur'}
                  </span>
                </div>
                <button className="promo-set" onClick={() => setMode('bulk')}>Atur</button>
              </div>
            </div>
          </div>

          {/* FOOTER: Edit (primary) · Stok (secondary) · ⋯ (ghost) */}
          <div className="dock-footer">
            <div className="pw-footer">
              <button className="a-btn a-blue btn-icon" onClick={() => setMode('edit')}><Icon name="edit" size={15} /> Edit Produk</button>
              <button className="a-btn btn-icon" onClick={() => setMode('stock')}><Icon name="box" size={15} /> Kelola Stok</button>
              <div className="pw-more">
                <button className="a-btn pw-more-btn" onClick={() => setMoreOpen((v) => !v)} aria-label="Aksi lainnya"><Icon name="menu" size={16} /></button>
                {moreOpen && (
                  <>
                    <div className="pw-more-scrim" onClick={() => setMoreOpen(false)} />
                    <div className="pw-more-menu">
                      <button onClick={handleToggle}><Icon name={p.active ? 'pause' : 'check'} size={14} /> {p.active ? 'Nonaktifkan' : 'Aktifkan'} Produk</button>
                      <button className="danger" onClick={() => { setMoreOpen(false); setConfirmDelete(true); }}><Icon name="trash" size={14} /> Hapus Produk</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- EDIT / CREATE ---- */}
      {(mode === 'edit' || mode === 'create') && (
        <div className="dock-body pw-form-body">
          <ProductForm
            prod={mode === 'edit' ? p : null}
            categories={categories}
            toast={toast}
            footerClass="pw-form-footer"
            onCancel={mode === 'edit' ? back : onClose}
            onSaved={(msg) => { toast(msg); reload(); if (mode === 'edit') back(); else onClose(); }}
          />
        </div>
      )}

      {/* ---- STOCK ---- */}
      {mode === 'stock' && p && (
        <div className="dock-body">
          <div className="pw-ctx">{p.name_id} · {stockTypeLabel(p.stock_type)}</div>
          <StockManagerContent prod={p} toast={toast} onChanged={reload} />
        </div>
      )}

      {/* ---- FLASH ---- */}
      {mode === 'flash' && p && (
        <FlashSaleForm prod={p} toast={toast}
          onCancel={back}
          onSaved={(msg) => { toast(msg); reload(); back(); }} />
      )}

      {/* ---- BULK ---- */}
      {mode === 'bulk' && p && (
        <BulkDiscountForm prod={p} toast={toast}
          onCancel={back}
          onSaved={(msg) => { toast(msg); reload(); back(); }} />
      )}

      {confirmDelete && p && (
        <ConfirmDeleteModal
          title={`Hapus Produk ${p.name_id}?`}
          message="Produk dengan histori transaksi akan diarsipkan/nonaktif. Hard-delete hanya berlaku untuk produk baru tanpa histori atau reservasi."
          onClose={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
