import { useState } from 'react';
import { setFlashSale, clearFlashSale } from '../../api.js';
import { formatIDR } from './utils.jsx';

/**
 * Flash Sale form (dock content) — dipakai di ProductWorkspace mode "flash".
 * Logika/endpoint SAMA dengan FlashSaleModal lama, hanya tanpa scrim/modal.
 * props: prod, onSaved(msg), onCancel, toast
 */
export default function FlashSaleForm({ prod, onSaved, onCancel, toast }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const now = new Date();
  const defaultStart = prod.flash_start ? prod.flash_start.slice(0, 16) : now.toISOString().slice(0, 16);
  const defaultEnd = prod.flash_end ? prod.flash_end.slice(0, 16) : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const [price, setPrice] = useState(prod.flash_price || Math.round(prod.price_idr * 0.8));
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [limitEnabled, setLimitEnabled] = useState(!!prod.flash_max_transactions);
  const [maxTransactions, setMaxTransactions] = useState(prod.flash_max_transactions || 10);

  const discountPct = prod.price_idr > 0 ? Math.round((1 - price / prod.price_idr) * 100) : 0;

  const handleSet = async () => {
    setBusy(true); setErr('');
    try {
      const r = await setFlashSale(prod.id, { flash_price: price, flash_start: startDate, flash_end: endDate, flash_limit_enabled: limitEnabled, flash_max_transactions: limitEnabled ? maxTransactions : null });
      onSaved(r.message);
    } catch (e) { setErr(e.message); toast?.(e.message, 'err'); } finally { setBusy(false); }
  };
  const handleClear = async () => {
    setBusy(true); setErr('');
    try { const r = await clearFlashSale(prod.id); onSaved(r.message); }
    catch (e) { setErr(e.message); toast?.(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="dock-body">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
          Harga Normal: <b>{formatIDR(prod.price_idr)}</b>
          {price > 0 && price < prod.price_idr && <span className="badge-flash" style={{ marginLeft: 8 }}>Hemat {discountPct}%</span>}
        </p>
        {err && <div className="empty error-panel" style={{ marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Harga Diskon Flash Sale (IDR) *</label>
            <input type="number" className="qty-field" value={price} onChange={(e) => setPrice(parseInt(e.target.value) || 0)} />
          </div>
          <div className="form-grid">
            <div>
              <label className="field-label">Waktu Mulai *</label>
              <input type="datetime-local" className="qty-field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Waktu Selesai *</label>
              <input type="datetime-local" className="qty-field" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <label className="toggle-line" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={limitEnabled} onChange={(e) => setLimitEnabled(e.target.checked)} />
            <span>Batasi jumlah transaksi flash sale</span>
          </label>
          {limitEnabled && (
            <div>
              <label className="field-label">Maksimal Transaksi / Slot *</label>
              <input type="number" min="1" className="qty-field" value={maxTransactions} onChange={(e) => setMaxTransactions(parseInt(e.target.value) || 0)} />
              <div className="muted small" style={{ marginTop: 6 }}>Satu order sukses dihitung sebagai satu slot.</div>
            </div>
          )}
        </div>
      </div>
      <div className="dock-footer">
        <div className="modal-actions" style={{ marginTop: 0 }}>
          {prod.is_flash_active && (
            <button type="button" className="btn-ghost" style={{ color: 'var(--red)' }} onClick={handleClear} disabled={busy}>Matikan Promo</button>
          )}
          <button type="button" className="btn-primary" onClick={handleSet} disabled={busy}>{busy ? 'Memproses...' : 'Simpan'}</button>
        </div>
      </div>
    </>
  );
}
