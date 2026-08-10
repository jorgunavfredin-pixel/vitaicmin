import { useEffect, useState, useCallback } from 'react';
import { fetchVouchers, createVoucher, deleteVoucher } from '../api.js';
import Icon from '../components/Icons.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';
import './vouchers/vouchers.css';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) + ' WIB' : '-';

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-head">
        <div className="stat-icon"><Icon name={icon} size={20} /></div>
      </div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function Vouchers() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetchVouchers()
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener('voucher_updated', refresh);
    return () => window.removeEventListener('voucher_updated', refresh);
  }, [load]);

  const doDelete = async (v) => {
    try {
      const r = await deleteVoucher(v.id);
      showToast(r.message);
      setConfirmDel(null);
      load();
    } catch (e) { showToast(e.message, 'err'); }
  };

  const s = data?.stats;

  return (
    <div className="vouchers-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Voucher</h2>
          <p className="page-sub">Kelola kode diskon. 1 kode berlaku 1x pakai per user.</p>
        </div>
        <button className="btn-primary btn-icon" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={16} /> Buat Voucher
        </button>
      </div>

      {s && (
        <div className="prod-stat-grid">
          <StatCard icon="ticket" accent="blue" label="Total Voucher" value={compact(s.total)} sub="Semua kode" />
          <StatCard icon="discount" accent="blue" label="Tipe Persen" value={compact(s.percent)} sub="Diskon %" />
          <StatCard icon="cash" accent="green" label="Tipe Potongan" value={compact(s.fixed)} sub="Diskon Rp" />
          <StatCard icon="check" accent="amber" label="Total Dipakai" value={compact(s.totalRedemptions)} sub="Redemption oleh user" />
        </div>
      )}

      <div className="panel no-pad vouchers-table-card">
        {error ? (
          <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>
        ) : loading && !data ? (
          <SkeletonTable rows={6} cols={5} />
        ) : data && data.vouchers.length === 0 ? (
          <div className="empty">Belum ada voucher. Klik "Buat Voucher" untuk menambah.</div>
        ) : (
          <div className="table-wrap vouchers-desktop-table">
            <table className="table vouchers-table">
              <thead>
                <tr>
                  <th>Kode</th><th>Tipe</th><th>Nilai</th>
                  <th>Dipakai</th><th>Dibuat</th><th className="th-action">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data?.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td data-label="Kode"><span className="voucher-code">{v.code}</span></td>
                    <td data-label="Tipe">
                      <span className={`badge ${v.type === 'percent' ? 'st-paid' : 'st-delivered'}`}>
                        {v.type === 'percent' ? 'Persen' : 'Potongan'}
                      </span>
                    </td>
                    <td data-label="Nilai"><b>{v.label}</b></td>
                    <td data-label="Dipakai">
                      {v.redemptions > 0
                        ? <><b>{v.redemptions}</b> <span className="muted">user</span></>
                        : <span className="muted">Belum dipakai</span>}
                    </td>
                    <td data-label="Dibuat" className="muted-cell">{fmtDate(v.created_at)}</td>
                    <td data-label="Aksi">
                      <div className="stock-action-cell">
                        <button className="a-btn a-red btn-icon" onClick={() => setConfirmDel(v)}>
                          <Icon name="trash" size={14} /> Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dedicated mobile voucher cards — compact, bukan tabel 273px per row */}
      {data && data.vouchers.length > 0 && (
        <div className="vouchers-mobile-list">
          {data.vouchers.map((v) => (
            <div key={v.id} className="voucher-card">
              <div className="voucher-card-head">
                <span className="voucher-code">{v.code}</span>
                <span className={`badge ${v.type === 'percent' ? 'st-paid' : 'st-delivered'}`}>
                  {v.type === 'percent' ? 'Persen' : 'Potongan'}
                </span>
              </div>
              <div className="voucher-card-body">
                <div className="voucher-card-value"><small>Nilai diskon</small><b>{v.label}</b></div>
                <div className="voucher-card-used"><small>Dipakai</small><b>{v.redemptions > 0 ? `${v.redemptions} user` : 'Belum'}</b></div>
                <button className="voucher-card-delete" onClick={() => setConfirmDel(v)} aria-label={`Hapus voucher ${v.code}`}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
              <div className="voucher-card-date">Dibuat {fmtDate(v.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateVoucherModal
          onClose={() => setShowCreate(false)}
          toast={showToast}
          onDone={() => { setShowCreate(false); load(); }}
        />
      )}

      {confirmDel && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon modal-icon-danger"><Icon name="warning" size={30} /></div>
            <h4>Hapus Voucher?</h4>
            <p>Kode <b>{confirmDel.code}</b> ({confirmDel.label}) akan dihapus permanen. Aksi ini tidak bisa dibatalkan.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Batal</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDel)}>Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- Create voucher modal ----
function CreateVoucherModal({ onClose, toast, onDone }) {
  const [type, setType] = useState('percent'); // percent | fixed
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const val = parseInt(value) || 0;
  const preview = type === 'percent' ? `${val}%` : rupiah(val);

  const submit = async () => {
    const codeClean = code.trim().toUpperCase();
    if (!codeClean) return toast('Kode voucher wajib diisi', 'err');
    if (!/^[A-Z0-9_-]+$/.test(codeClean)) return toast('Kode hanya huruf, angka, - dan _', 'err');
    if (val <= 0) return toast('Nilai diskon harus lebih dari 0', 'err');
    if (type === 'percent' && val > 100) return toast('Diskon persen maksimal 100%', 'err');
    setBusy(true);
    try {
      const r = await createVoucher({ code: codeClean, type, value: val });
      toast(r.message);
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const TYPES = [
    { key: 'percent', label: 'Persen (%)' },
    { key: 'fixed', label: 'Potongan (Rp)' }
  ];

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal voucher-create-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="ticket" size={18} /> Buat Voucher Baru</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        <label className="field-label">Tipe Diskon</label>
        <div className="chips" style={{ marginBottom: 14 }}>
          {TYPES.map((t) => (
            <button key={t.key} className={`chip ${type === t.key ? 'active' : ''}`} onClick={() => setType(t.key)}>{t.label}</button>
          ))}
        </div>

        <label className="field-label">Kode Voucher</label>
        <input type="text" className="qty-field" placeholder="cth: DISKON10"
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} />

        <label className="field-label" style={{ marginTop: 12 }}>
          {type === 'percent' ? 'Nilai Persen (1-100)' : 'Nominal Potongan (IDR)'}
        </label>
        <input type="number" min="1" className="qty-field"
          placeholder={type === 'percent' ? 'cth: 10' : 'cth: 5000'}
          value={value} onChange={(e) => setValue(e.target.value)} />

        <div className="balance-preview">
          Preview diskon: <b style={{ color: 'var(--brand)' }}>{preview}</b>
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Menyimpan…' : 'Buat Voucher'}</button>
        </div>
      </div>
    </div>
  );
}
