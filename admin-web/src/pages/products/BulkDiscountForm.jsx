import { useState } from 'react';
import { setBulkDiscount } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { formatIDR } from './utils.jsx';

/**
 * Diskon Grosir form (dock content) — dipakai di ProductWorkspace mode "bulk".
 * Logika/endpoint SAMA dengan BulkDiscountModal lama, hanya tanpa scrim/modal.
 * props: prod, onSaved(msg), onCancel, toast
 */
export default function BulkDiscountForm({ prod, onSaved, onCancel, toast }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tiers, setTiers] = useState((prod.parsed_qty_discounts || []).map(t => ({ ...t, type: t.type || (t.price != null ? 'fixed_price' : 'percent') })));
  const addTier = () => setTiers([...tiers, { min_qty: 2, type: 'percent', percent: 10 }]);
  const removeTier = (idx) => setTiers(tiers.filter((_, i) => i !== idx));
  const updateTier = (idx, field, val) => {
    const updated = [...tiers];
    if (field === 'type') {
      updated[idx] = val === 'fixed_price'
        ? { min_qty: updated[idx].min_qty, type: val, price: Math.max(1, Math.floor(prod.price_idr * 0.85)) }
        : { min_qty: updated[idx].min_qty, type: 'percent', percent: 10 };
    } else updated[idx][field] = parseInt(val) || 0;
    setTiers(updated);
  };
  const handleSave = async () => {
    setBusy(true); setErr('');
    try { const r = await setBulkDiscount(prod.id, tiers); onSaved(r.message); }
    catch (e) { setErr(e.message); toast?.(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="dock-body">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 6px' }}>
          Harga Normal: <b>{formatIDR(prod.price_idr)}</b>
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
          Atur diskon persen atau harga per pcs berdasarkan minimal jumlah pembelian.
        </p>
        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="bulk-tier-list">
          {tiers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 13 }}>
              Belum ada tier diskon grosir. Klik tombol di bawah untuk menambahkan.
            </div>
          ) : (
            tiers.map((t, idx) => (
              <div key={idx} className="bd-tier">
                <div className="bd-tier-qty">
                  <span className="bd-lbl">Beli ≥</span>
                  <input type="number" min="2" className="qty-field bd-qty" value={t.min_qty} onChange={(e) => updateTier(idx, 'min_qty', e.target.value)} />
                  <span className="bd-lbl">pcs</span>
                </div>
                <div className="bd-tier-val">
                  <select className="qty-field bd-type" value={t.type || 'percent'} onChange={(e) => updateTier(idx, 'type', e.target.value)}>
                    <option value="percent">%</option>
                    <option value="fixed_price">Rp</option>
                  </select>
                  {t.type === 'fixed_price' ? (
                    <input type="number" min="1" max={Math.max(1, prod.price_idr - 1)} className="qty-field bd-num" value={t.price || 0} onChange={(e) => updateTier(idx, 'price', e.target.value)} />
                  ) : (
                    <input type="number" min="1" max="99" className="qty-field bd-num" value={t.percent || 0} onChange={(e) => updateTier(idx, 'percent', e.target.value)} />
                  )}
                  <button type="button" className="bd-del" onClick={() => removeTier(idx)} aria-label="Hapus tier"><Icon name="x" size={15} /></button>
                </div>
              </div>
            ))
          )}
        </div>
        <button type="button" className="btn-ghost btn-icon" style={{ width: '100%', marginTop: 12, borderStyle: 'dashed', justifyContent: 'center' }} onClick={addTier}>
          <Icon name="plus" size={15} /> Tambah Tier Diskon
        </button>
      </div>
      <div className="dock-footer">
        <div className="modal-actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn-ghost" onClick={onCancel}>Batal</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? 'Memproses...' : 'Simpan'}</button>
        </div>
      </div>
    </>
  );
}
