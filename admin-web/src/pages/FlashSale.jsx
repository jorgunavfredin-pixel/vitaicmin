import { useEffect, useState, useCallback } from 'react';
import { fetchFlashSales, saveFlashSale, deleteFlashSale } from '../api.js';
import Icon from '../components/Icons.jsx';
import './flashsale/flashsale.css';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
}) : '-';
// datetime-local butuh format "YYYY-MM-DDTHH:mm" di waktu lokal
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function FlashSale() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null); // {product_id?, ...} atau null

  const showToast = (msg, kind = 'ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3200); };

  const load = useCallback(() => {
    fetchFlashSales().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const onDelete = async (productId) => {
    try { const r = await deleteFlashSale(productId); showToast(r.message || 'Dihapus'); load(); }
    catch (e) { showToast(e.message, 'err'); }
  };

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  const sections = [
    { key: 'active', label: 'Sedang Berjalan', cls: 'fs-active', items: data?.active || [] },
    { key: 'scheduled', label: 'Terjadwal', cls: 'fs-scheduled', items: data?.scheduled || [] },
    { key: 'expired', label: 'Selesai', cls: 'fs-expired', items: data?.expired || [] },
  ];

  return (
    <div className="page flashsale-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Flash Sale</h2>
          <p className="page-sub">Kelola promo harga kilat dengan batas waktu</p>
        </div>
        <button className="btn-primary btn-icon" onClick={() => setEditing({})}>
          <Icon name="plus" size={16} /> Buat Flash Sale
        </button>
      </div>

      {!data ? (
        <div className="panel"><div className="empty">Memuat…</div></div>
      ) : (
        sections.map((sec) => (
          <div key={sec.key} className={`panel flashsale-section ${sec.items.length === 0 ? 'is-empty' : ''}`}>
            <div className="panel-head">
              <h3>{sec.label} <span className="count-chip">{sec.items.length}</span></h3>
            </div>
            {sec.items.length === 0 ? (
              <div className="empty">Tidak ada flash sale {sec.label.toLowerCase()}</div>
            ) : (
              <div className="fs-list">
                {sec.items.map((f) => {
                  const disc = f.normal_price ? Math.round((1 - f.flash_price / f.normal_price) * 100) : null;
                  return (
                    <div key={f.product_id} className={`fs-item ${sec.cls}`}>
                      <div className="fs-main">
                        <div className="fs-name">{f.name}</div>
                        <div className="fs-price">
                          <span className="fs-flash">{rupiah(f.flash_price)}</span>
                          {f.normal_price != null && <span className="fs-normal">{rupiah(f.normal_price)}</span>}
                          {disc != null && disc > 0 && <span className="fs-disc">-{disc}%</span>}
                        </div>
                        <div className="fs-time">
                          <Icon name="clock" size={12} /> {fmtDate(f.flash_start)} → {fmtDate(f.flash_end)}
                          {f.max_transactions ? ` • maks ${f.max_transactions}x` : ''}
                        </div>
                      </div>
                      <div className="fs-actions">
                        <button className="ic-btn" title="Edit" onClick={() => setEditing(f)}><Icon name="edit" size={16} /></button>
                        <button className="ic-btn ic-danger" title="Hapus" onClick={() => onDelete(f.product_id)}><Icon name="trash" size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))
      )}

      {editing && (
        <FlashSaleModal
          initial={editing}
          products={data?.products || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast('Flash sale disimpan'); }}
          showToast={showToast}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function FlashSaleModal({ initial, products, onClose, onSaved, showToast }) {
  const isEdit = !!initial.product_id;
  const [form, setForm] = useState({
    product_id: initial.product_id || '',
    flash_price: initial.flash_price || '',
    flash_start: toLocalInput(initial.flash_start) || '',
    flash_end: toLocalInput(initial.flash_end) || '',
    max_transactions: initial.max_transactions || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const selectedProd = products.find((p) => p.id === form.product_id);

  const submit = async () => {
    if (!form.product_id) return showToast('Pilih produk dulu', 'err');
    if (!(Number(form.flash_price) > 0)) return showToast('Harga flash harus > 0', 'err');
    if (!form.flash_start || !form.flash_end) return showToast('Isi waktu mulai & selesai', 'err');
    setBusy(true);
    try {
      await saveFlashSale({
        product_id: form.product_id,
        flash_price: Number(form.flash_price),
        flash_start: new Date(form.flash_start).toISOString(),
        flash_end: new Date(form.flash_end).toISOString(),
        max_transactions: form.max_transactions ? Number(form.max_transactions) : null,
      });
      onSaved();
    } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg flashsale-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="flash" size={18} /> {isEdit ? 'Edit Flash Sale' : 'Buat Flash Sale'}</h3>
          <button className="x" onClick={onClose} aria-label="Tutup"><Icon name="x" /></button>
        </div>
        <div className="form-grid flashsale-form-grid">
          <label className="field field-full">
            <span className="field-label">Produk</span>
            <select className="input" value={form.product_id} disabled={isEdit} onChange={(e) => set('product_id', e.target.value)}>
              <option value="">— Pilih produk —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({rupiah(p.price_idr)})</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Harga Flash Sale</span>
            <input className="input" type="number" min="1" value={form.flash_price} onChange={(e) => set('flash_price', e.target.value)} placeholder="mis. 8000" />
            {selectedProd && <span className="field-hint">Harga normal: {rupiah(selectedProd.price_idr)}</span>}
          </label>
          <label className="field">
            <span className="field-label">Batas Transaksi (opsional)</span>
            <input className="input" type="number" min="1" value={form.max_transactions} onChange={(e) => set('max_transactions', e.target.value)} placeholder="kosong = tanpa batas" />
          </label>
          <label className="field">
            <span className="field-label">Mulai</span>
            <input className="input" type="datetime-local" value={form.flash_start} onChange={(e) => set('flash_start', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Selesai</span>
            <input className="input" type="datetime-local" value={form.flash_end} onChange={(e) => set('flash_end', e.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}
