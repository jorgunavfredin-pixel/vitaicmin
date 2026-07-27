import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  fetchStockOverview, fetchReservedDetail, bulkRestock, downloadStockCsv, fetchCategories
} from '../api.js';
import { StockDrawer } from './Products.jsx';
import Icon from '../components/Icons.jsx';

const formatIDR = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace('.', ':') + ' WIB' : '-';

const STOCK_TYPES = {
  email_pass: 'Email | Pass', email_pass_key: 'Email | Pass | 2FA',
  code: 'Code / Pin', vcc: 'Card | Exp | CVV', custom: 'Custom Text'
};
const stockTypeLabel = (t) => STOCK_TYPES[t] || t;

const STATUS_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'low', label: 'Menipis' },
  { key: 'out', label: 'Habis' },
  { key: 'ok', label: 'Aman' },
  { key: 'unlimited', label: 'Unlimited' }
];

function StatusPill({ status, available }) {
  if (status === 'unlimited') return <span className="badge st-paid badge-icon"><Icon name="infinity" size={13} /> Unlimited</span>;
  if (status === 'out') return <span className="badge st-cancelled">Habis (0)</span>;
  if (status === 'low') return <b className="hint-icon" style={{ color: '#ffb454' }}>{available} item <Icon name="warning" size={13} /></b>;
  return <b style={{ color: '#37d399' }}>{available} item</b>;
}

function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-icon"><Icon name={icon} size={22} /></div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function Stock() {
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filters & sort
  const [statusFilter, setStatusFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('available'); // available | sold_30d | inventory_value
  const [sortDir, setSortDir] = useState('asc');

  // Modals & drawers
  const [drawerProd, setDrawerProd] = useState(null);
  const [reservedProd, setReservedProd] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchStockOverview(), fetchCategories().catch(() => [])])
      .then(([ov, cats]) => { setData(ov); setCategories(cats); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = () => load();
    window.addEventListener('product_updated', h);
    return () => window.removeEventListener('product_updated', h);
  }, [load]);

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    let r = [...data.products];
    if (statusFilter !== 'all') r = r.filter((x) => x.stock_status === statusFilter);
    if (catFilter !== 'all') r = r.filter((x) => x.category_id === catFilter);
    if (q) {
      const query = q.toLowerCase().trim();
      r = r.filter((x) => x.name_id.toLowerCase().includes(query) || (x.name_en || '').toLowerCase().includes(query) || x.id.toLowerCase().includes(query));
    }
    r.sort((a, b) => {
      const av = a[sortBy] ?? -1, bv = b[sortBy] ?? -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return r;
  }, [data, statusFilter, catFilter, q, sortBy, sortDir]);

  const onExport = async () => {
    try { await downloadStockCsv(); } catch (e) { showToast(e.message, 'err'); }
  };

  const sortIcon = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  const s = data?.stats;

  return (
    <div className="stock-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Kontrol Stok</h2>
          <p className="page-sub">Pantau, restock, & kelola stok seluruh produk dari satu tempat</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost btn-icon" onClick={onExport}><Icon name="download" size={16} /> Export CSV</button>
          <button className="btn-primary btn-icon" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setBulkOpen(true)}>
            <Icon name="upload" size={16} /> Bulk Restock
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {s && (
        <div className="prod-stat-grid">
          <StatCard icon="box" accent="green" label="Stok Tersedia" value={compact(s.totalAvailable)}
            sub={s.unlimitedCount > 0 ? `+${s.unlimitedCount} produk unlimited` : `${s.totalProducts} produk`} />
          <StatCard icon="clock" accent="amber" label="Ter-reserve" value={compact(s.totalReserved)}
            sub="Ditahan order pending" />
          <StatCard icon="warning" accent={s.outOfStockCount > 0 ? 'red' : 'amber'} label="Perlu Restock"
            value={s.lowStockCount + s.outOfStockCount} sub={`${s.outOfStockCount} habis · ${s.lowStockCount} menipis`} />
          <StatCard icon="wallet" accent="violet" label="Nilai Inventory" value={formatIDR(s.inventoryValue)}
            sub="Estimasi modal stok tersedia" />
        </div>
      )}

      {/* Alert restock */}
      {data && data.alerts.length > 0 && (
        <div className="panel alert-panel">
          <div className="panel-head">
            <h3 className="h3-icon"><Icon name="warning" size={17} /> Perlu Restock ({data.alerts.length})</h3>
          </div>
          <div className="alert-list">
            {data.alerts.map((a) => (
              <div key={a.id} className={`alert-item ${a.stock_status}`}>
                <div className="alert-info">
                  <span className={`alert-dot ${a.stock_status}`} />
                  <div>
                    <div className="alert-name">{a.name_id}</div>
                    <div className="alert-meta">{a.category_name} · {stockTypeLabel(a.stock_type)}</div>
                  </div>
                </div>
                <div className="alert-right">
                  <StatusPill status={a.stock_status} available={a.available} />
                  <button className="a-btn a-green btn-icon" onClick={() => setDrawerProd(a)}>
                    <Icon name="plus" size={14} /> Tambah
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="chips">
          {STATUS_FILTERS.map((f) => (
            <button key={f.key} className={`chip ${statusFilter === f.key ? 'active' : ''}`} onClick={() => setStatusFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <div className="search" style={{ flex: 1, minWidth: 200 }}>
            <span className="search-icon"><Icon name="search" size={15} /></span>
            <input placeholder="Cari produk…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select-field" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="all">Semua Kategori</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name_id}</option>)}
          </select>
        </div>
      </div>

      {/* Main table */}
      <div className="panel no-pad">
        {loading && !data ? (
          <div className="empty">Memuat stok…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Tidak ada produk pada filter ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Kategori</th>
                  <th>Tipe</th>
                  <th className="th-sort" onClick={() => toggleSort('available')}>Tersedia{sortIcon('available')}</th>
                  <th>Reserved</th>
                  <th className="th-sort" onClick={() => toggleSort('sold_30d')}>Terjual (30h){sortIcon('sold_30d')}</th>
                  <th className="th-sort" onClick={() => toggleSort('inventory_value')}>Nilai{sortIcon('inventory_value')}</th>
                  <th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{p.name_id}</div>
                      {!p.active && <span className="badge st-expired" style={{ fontSize: 11 }}>Nonaktif</span>}
                    </td>
                    <td><span className="badge st-muted">{p.category_name}</span></td>
                    <td style={{ fontSize: 12, color: '#8a93a6' }}>{stockTypeLabel(p.stock_type)}</td>
                    <td><StatusPill status={p.stock_status} available={p.available} /></td>
                    <td>
                      {p.reserved > 0 ? (
                        <button className="link-reserved hint-icon" onClick={() => setReservedProd(p)} title="Lihat order yang menahan stok">
                          <Icon name="clock" size={13} /> {p.reserved}
                        </button>
                      ) : <span className="muted">0</span>}
                    </td>
                    <td><b>{p.sold_30d}</b> <span className="muted">pcs</span></td>
                    <td>{p.stock_mode === 'unlimited' ? <span className="muted">—</span> : formatIDR(p.inventory_value)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="a-btn a-green btn-icon" onClick={() => setDrawerProd(p)}>
                        <Icon name="box" size={14} /> Kelola
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerProd && (
        <StockDrawer prod={drawerProd} onClose={() => setDrawerProd(null)} toast={showToast} onChanged={load} />
      )}
      {reservedProd && (
        <ReservedModal prod={reservedProd} onClose={() => setReservedProd(null)} />
      )}
      {bulkOpen && (
        <BulkRestockModal products={data?.products || []} onClose={() => setBulkOpen(false)}
          toast={showToast} onDone={() => { setBulkOpen(false); load(); }} />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- Reserved detail modal ----
function ReservedModal({ prod, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchReservedDetail(prod.id).then(setData).catch((e) => setErr(e.message));
  }, [prod.id]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="clock" size={18} /> Stok Ter-reserve — {prod.name_id}</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Stok ini ditahan oleh order yang belum lunas. Akan otomatis dilepas saat order expired/cancel/refund.
        </p>
        {err && <div className="empty error-panel">{err}</div>}
        {!data && !err && <div className="empty">Memuat…</div>}
        {data && data.items.length === 0 && <div className="empty">Tidak ada stok ter-reserve.</div>}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order ID</th><th>User</th><th>Qty</th><th>Status</th><th>Direserve</th></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.order_id}>
                    <td className="mono">{it.order_id}</td>
                    <td>{it.username ? '@' + it.username : (it.first_name || it.user_id || '-')}</td>
                    <td><b>{it.qty}</b></td>
                    <td><span className="badge st-pending">{it.order_status}</span></td>
                    <td className="muted-cell">{fmtDate(it.reserved_at)}</td>
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

// ---- Bulk restock modal ----
function BulkRestockModal({ products, onClose, toast, onDone }) {
  // Hanya produk yang pakai stock line (bukan unlimited murni tanpa line) yang relevan; tampilkan semua limited.
  const options = products.filter((p) => p.stock_mode !== 'unlimited');
  const [selectedId, setSelectedId] = useState('');
  const [entries, setEntries] = useState([]); // { product_id, name_id, lines }
  const [busy, setBusy] = useState(false);

  const addEntry = () => {
    if (!selectedId) return;
    if (entries.some((e) => e.product_id === selectedId)) { toast('Produk sudah ada di daftar', 'err'); return; }
    const p = products.find((x) => x.id === selectedId);
    setEntries((prev) => [...prev, { product_id: p.id, name_id: p.name_id, lines: '' }]);
    setSelectedId('');
  };

  const updateLines = (pid, val) => setEntries((prev) => prev.map((e) => e.product_id === pid ? { ...e, lines: val } : e));
  const removeEntry = (pid) => setEntries((prev) => prev.filter((e) => e.product_id !== pid));

  const totalLines = entries.reduce((sum, e) => sum + e.lines.split('\n').map((l) => l.trim()).filter(Boolean).length, 0);

  const submit = async () => {
    const payload = entries
      .map((e) => ({ product_id: e.product_id, lines: e.lines.split('\n').map((l) => l.trim()).filter(Boolean) }))
      .filter((e) => e.lines.length > 0);
    if (payload.length === 0) return toast('Isi minimal 1 baris stok di salah satu produk', 'err');
    setBusy(true);
    try {
      const r = await bulkRestock(payload);
      toast(r.message);
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="upload" size={18} /> Bulk Restock</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          Tambah stok ke beberapa produk sekaligus. Pilih produk, lalu tempel data stok (1 baris = 1 item).
        </p>

        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <select className="select-field" style={{ flex: 1 }} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">+ Pilih produk untuk ditambahkan…</option>
            {options.filter((o) => !entries.some((e) => e.product_id === o.id)).map((o) => (
              <option key={o.id} value={o.id}>{o.name_id} (stok: {o.available ?? 0})</option>
            ))}
          </select>
          <button className="btn-ghost btn-icon" onClick={addEntry} disabled={!selectedId}><Icon name="plus" size={15} /> Tambah</button>
        </div>

        {entries.length === 0 ? (
          <div className="empty">Belum ada produk dipilih.</div>
        ) : (
          <div className="bulk-entries">
            {entries.map((e) => {
              const n = e.lines.split('\n').map((l) => l.trim()).filter(Boolean).length;
              return (
                <div key={e.product_id} className="bulk-entry">
                  <div className="bulk-entry-head">
                    <b>{e.name_id}</b>
                    <span className="bulk-entry-actions">
                      <span className="muted small">{n} baris</span>
                      <button className="ic-btn ic-danger" onClick={() => removeEntry(e.product_id)}><Icon name="trash" size={15} /></button>
                    </span>
                  </div>
                  <textarea rows={4} className="qty-field" style={{ resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}
                    placeholder={"email@mail.com|password123\nemail2@mail.com|password456"}
                    value={e.lines} onChange={(ev) => updateLines(e.product_id, ev.target.value)} />
                </div>
              );
            })}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy || totalLines === 0}>
            {busy ? 'Memproses…' : `Restock ${totalLines} item`}
          </button>
        </div>
      </div>
    </div>
  );
}
