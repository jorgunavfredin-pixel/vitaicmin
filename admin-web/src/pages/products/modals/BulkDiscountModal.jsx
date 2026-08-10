import { useState } from 'react';
import { setBulkDiscount } from '../../../api.js';
import Icon from '../../../components/Icons.jsx';

export default function BulkDiscountModal({ prod, onClose, onSaved }) {
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
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bulk-discount-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="discount" size={18} /> Diskon Grosir: {prod.name_id}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
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
              <div key={idx} className="tier-row">
                <span style={{ fontSize: 13, color: 'var(--muted)', minWidth: 44 }}>Beli &ge;</span>
                <input type="number" min="2" className="qty-field" style={{ width: 80 }} value={t.min_qty} onChange={(e) => updateTier(idx, 'min_qty', e.target.value)} />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>pcs</span>
                <select className="select-field" style={{ width: 112 }} value={t.type || 'percent'} onChange={(e) => updateTier(idx, 'type', e.target.value)}>
                  <option value="percent">Persen</option>
                  <option value="fixed_price">Harga/pcs</option>
                </select>
                {t.type === 'fixed_price' ? (
                  <input type="number" min="1" max={Math.max(1, prod.price_idr - 1)} className="qty-field" style={{ width: 105 }} value={t.price || 0} onChange={(e) => updateTier(idx, 'price', e.target.value)} />
                ) : (
                  <><input type="number" min="1" max="99" className="qty-field" style={{ width: 80 }} value={t.percent || 0} onChange={(e) => updateTier(idx, 'percent', e.target.value)} /><span style={{ fontSize: 13, color: 'var(--muted)' }}>%</span></>
                )}
                <button type="button" className="x" style={{ color: 'var(--red)', marginLeft: 'auto' }} onClick={() => removeTier(idx)}><Icon name="x" size={16} /></button>
              </div>
            ))
          )}
        </div>
        <button type="button" className="btn-ghost btn-icon" style={{ width: '100%', marginTop: 12, borderStyle: 'dashed', justifyContent: 'center' }} onClick={addTier}>
          <Icon name="plus" size={15} /> Tambah Tier Diskon
        </button>
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Batal</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? 'Memproses...' : 'Simpan Diskon Grosir'}</button>
        </div>
      </div>
    </div>
  );
}
