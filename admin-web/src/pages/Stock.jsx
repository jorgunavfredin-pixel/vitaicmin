import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  fetchStockOverview, fetchReservedDetail, bulkRestock, fetchCategories
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
  { key: 'ok', label: 'Aman' }
];

const byName = (a, b) => a.name_id.localeCompare(b.name_id, 'id', { sensitivity: 'base' });

function StatusPill({ status, available }) {
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
  const [sortBy, setSortBy] = useState('name'); // name | available | sold_30d | inventory_value
  const [sortDir, setSortDir] = useState('asc');

  // Modals & drawers
  const [drawerProd, setDrawerProd] = useState(null);
  const [reservedProd, setReservedProd] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [reservedOpen, setReservedOpen] = useState(false);

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
    else { setSortBy(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  // Kategori diurutkan A-Z untuk rail kiri
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' })),
    [categories]
  );

  // Hitungan produk per kategori (untuk badge di rail)
  const catCounts = useMemo(() => {
    const m = {};
    (data?.products || []).forEach((p) => { m[p.category_id] = (m[p.category_id] || 0) + 1; });
    return m;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = [...data.products];
    if (catFilter !== 'all') r = r.filter((x) => x.category_id === catFilter);
    if (statusFilter !== 'all') r = r.filter((x) => x.stock_status === statusFilter);
    if (q) {
      const query = q.toLowerCase().trim();
      r = r.filter((x) => x.name_id.toLowerCase().includes(query) || (x.name_en || '').toLowerCase().includes(query) || x.id.toLowerCase().includes(query));
    }
    if (sortBy === 'name') {
      r.sort(byName);
      if (sortDir === 'desc') r.reverse();
    } else {
      r.sort((a, b) => {
        const av = a[sortBy] ?? -1, bv = b[sortBy] ?? -1;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }
    return r;
  }, [data, statusFilter, catFilter, q, sortBy, sortDir]);

  const sortIcon = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // Produk yang punya stok ter-reserve (untuk panel collapsible di bawah), urut reserved terbanyak.
  const reservedRows = useMemo(
    () => (data?.products || []).filter((p) => p.reserved > 0).sort((a, b) => b.reserved - a.reserved),
    [data]
  );

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  const s = data?.stats;

  return (
    <div className="stock-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Kontrol Stok</h2>
          <p className="page-sub">Pantau, restock, & kelola stok seluruh produk dari satu tempat</p>
        </div>
        <button className="btn-primary btn-icon" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => setBulkOpen(true)}>
          <Icon name="upload" size={16} /> Bulk Restock
        </button>
      </div>

      {/* Stat cards */}
      {s && (
        <div className="prod-stat-grid">
          <StatCard icon="box" accent="green" label="Stok Tersedia" value={compact(s.totalAvailable)}
            sub={`${s.totalProducts} produk`} />
          <StatCard icon="clock" accent="amber" label="Ter-reserve" value={compact(s.totalReserved)}
            sub="Ditahan order pending" />
          <StatCard icon="warning" accent={s.outOfStockCount > 0 ? 'red' : 'amber'} label="Perlu Restock"
            value={s.lowStockCount + s.outOfStockCount} sub={`${s.outOfStockCount} habis · ${s.lowStockCount} menipis`} />
          <StatCard icon="wallet" accent="violet" label="Nilai Inventory" value={formatIDR(s.inventoryValue)}
            sub="Estimasi modal stok tersedia" />
        </div>
      )}

      {/* Layout: rail kategori (kiri) + konten (kanan) */}
      <div className="stock-layout">
        {/* Rail kategori A-Z */}
        <aside className="cat-rail">
          <div className="cat-rail-title">Kategori</div>
          <button className={`cat-item ${catFilter === 'all' ? 'active' : ''}`} onClick={() => setCatFilter('all')}>
            <span>Semua Kategori</span>
            <span className="cat-count">{data?.products.length || 0}</span>
          </button>
          {sortedCategories.map((c) => (
            <button key={c.id} className={`cat-item ${catFilter === c.id ? 'active' : ''}`} onClick={() => setCatFilter(c.id)}>
              <span className="cat-item-name">{c.name_id}</span>
              <span className="cat-count">{catCounts[c.id] || 0}</span>
            </button>
          ))}
        </aside>

        {/* Konten */}
        <div className="stock-main">
          <div className="toolbar">
            <div className="chips">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} className={`chip ${statusFilter === f.key ? 'active' : ''}`} onClick={() => setStatusFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="search" style={{ minWidth: 200 }}>
              <span className="search-icon"><Icon name="search" size={15} /></span>
              <input placeholder="Cari produk…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

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
                      <th className="th-sort" onClick={() => toggleSort('name')}>Produk{sortIcon('name')}</th>
                      <th>Kategori</th>
                      <th>Tipe</th>
                      <th className="th-sort" onClick={() => toggleSort('available')}>Tersedia{sortIcon('available')}</th>
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
                        <td><b>{p.sold_30d}</b> <span className="muted">pcs</span></td>
                        <td>{formatIDR(p.inventory_value)}</td>
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
        </div>
      </div>

      {/* Panel bawah — collapsible, sejajar: Perlu Restock + Ter-reserve */}
      {data && (data.alerts.length > 0 || reservedRows.length > 0) && (
        <div className="stock-bottom-panels">
          {data.alerts.length > 0 && (
            <div className="panel alert-panel collapsible">
              <button className="alert-toggle" onClick={() => setAlertOpen((v) => !v)}>
                <span className="h3-icon"><Icon name="warning" size={17} /> Perlu Restock ({data.alerts.length})</span>
                <Icon name="chevron" size={18} className={`chev ${alertOpen ? 'open' : ''}`} />
              </button>
              {alertOpen && (
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
              )}
            </div>
          )}

          {reservedRows.length > 0 && (
            <div className="panel alert-panel reserved-panel collapsible">
              <button className="alert-toggle" onClick={() => setReservedOpen((v) => !v)}>
                <span className="h3-icon"><Icon name="clock" size={17} /> Stok Ter-reserve ({reservedRows.length})</span>
                <Icon name="chevron" size={18} className={`chev ${reservedOpen ? 'open' : ''}`} />
              </button>
              {reservedOpen && (
                <div className="alert-list">
                  {reservedRows.map((p) => (
                    <div key={p.id} className="alert-item">
                      <div className="alert-info">
                        <span className="alert-dot reserved" />
                        <div>
                          <div className="alert-name">{p.name_id}</div>
                          <div className="alert-meta">{p.category_name} · {stockTypeLabel(p.stock_type)}</div>
                        </div>
                      </div>
                      <div className="alert-right">
                        <b className="hint-icon" style={{ color: '#ffb454' }}><Icon name="clock" size={13} /> {p.reserved} ditahan</b>
                        <button className="a-btn a-blue btn-icon" onClick={() => setReservedProd(p)}>
                          <Icon name="eye" size={14} /> Detail
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {drawerProd && (
        <StockDrawer prod={drawerProd} onClose={() => setDrawerProd(null)} toast={showToast} onChanged={load} />
      )}
      {reservedProd && (
        <ReservedModal prod={reservedProd} onClose={() => setReservedProd(null)} />
      )}
      {bulkOpen && (
        <BulkRestockModal products={data?.products || []} categories={sortedCategories} onClose={() => setBulkOpen(false)}
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

// ---- Custom product picker (light theme, search + grup kategori A-Z) ----
function ProductPicker({ products, categories, excludeIds, onPick }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Grup produk per kategori (A-Z), produk dalam grup A-Z. Kategori tanpa produk disembunyikan.
  const groups = useMemo(() => {
    const q = search.toLowerCase().trim();
    const avail = products.filter((p) => !excludeIds.includes(p.id) &&
      (!q || p.name_id.toLowerCase().includes(q) || (p.name_en || '').toLowerCase().includes(q)));
    const catOrder = [...categories];
    const result = [];
    for (const c of catOrder) {
      const items = avail.filter((p) => p.category_id === c.id).sort(byName);
      if (items.length) result.push({ id: c.id, name: c.name_id, items });
    }
    // produk tanpa kategori
    const noCat = avail.filter((p) => !categories.some((c) => c.id === p.category_id)).sort(byName);
    if (noCat.length) result.push({ id: '_none', name: 'Tanpa Kategori', items: noCat });
    return result;
  }, [products, categories, excludeIds, search]);

  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker-trigger" onClick={() => setOpen((v) => !v)}>
        <span>+ Pilih produk untuk ditambahkan…</span>
        <Icon name="chevron" size={16} className={`chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="picker-panel">
          <div className="picker-search">
            <Icon name="search" size={15} />
            <input autoFocus placeholder="Cari produk…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="picker-list">
            {groups.length === 0 ? (
              <div className="picker-empty">Tidak ada produk.</div>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="picker-group">
                  <div className="picker-group-head">{g.name}</div>
                  {g.items.map((p) => (
                    <button key={p.id} type="button" className="picker-option"
                      onClick={() => { onPick(p); setOpen(false); setSearch(''); }}>
                      <span className="picker-opt-name">{p.name_id}</span>
                      <span className="picker-opt-stock">stok: {p.available ?? 0}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Bulk restock modal ----
function BulkRestockModal({ products, categories, onClose, toast, onDone }) {
  const [entries, setEntries] = useState([]); // { product_id, name_id, lines }
  const [busy, setBusy] = useState(false);

  const addEntry = (p) => {
    if (entries.some((e) => e.product_id === p.id)) { toast('Produk sudah ada di daftar', 'err'); return; }
    setEntries((prev) => [...prev, { product_id: p.id, name_id: p.name_id, lines: '' }]);
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
          Tambah stok ke beberapa produk sekaligus. Cari & pilih produk (dikelompokkan per kategori), lalu tempel data stok (1 baris = 1 item).
        </p>

        <ProductPicker products={products} categories={categories}
          excludeIds={entries.map((e) => e.product_id)} onPick={addEntry} />

        {entries.length === 0 ? (
          <div className="empty" style={{ marginTop: 14 }}>Belum ada produk dipilih.</div>
        ) : (
          <div className="bulk-entries" style={{ marginTop: 14 }}>
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
