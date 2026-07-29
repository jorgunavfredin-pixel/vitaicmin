import { useEffect, useState, useCallback } from 'react';
import {
  fetchUsers, fetchUserDetail, toggleBanUser, adjustUserBalance
} from '../api.js';
import Icon from '../components/Icons.jsx';
import { SkeletonTable } from '../components/Skeleton.jsx';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace('.', ':') + ' WIB' : '-';

const ORDER_STATUS = {
  pending: { label: 'Pending', cls: 'st-pending' },
  paid: { label: 'Dibayar', cls: 'st-paid' },
  delivered: { label: 'Terkirim', cls: 'st-delivered' },
  cancelled: { label: 'Batal', cls: 'st-cancelled' },
  expired: { label: 'Kadaluarsa', cls: 'st-expired' },
  refunded: { label: 'Refund', cls: 'st-cancelled' },
  init: { label: 'Draft', cls: 'st-muted' },
  processing: { label: 'Proses', cls: 'st-pending' }
};

const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'balance', label: 'Punya Saldo' },
  { key: 'banned', label: 'Banned' }
];

const SORTS = [
  { key: 'recent', label: 'Terbaru' },
  { key: 'spend', label: 'Spend Tertinggi' },
  { key: 'balance', label: 'Saldo Terbanyak' },
  { key: 'orders', label: 'Order Terbanyak' }
];

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

const displayName = (u) => u.username ? '@' + u.username : (u.first_name || u.id);
const initial = (u) => (u.first_name || u.username || '?').trim().charAt(0).toUpperCase();

export default function Users() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetchUsers({ filter, sort, q, page, pageSize: 20 })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter, sort, q, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const counts = data?.counts || {};
  const s = data?.stats;

  return (
    <div className="users-page">
      <div className="page-head">
        <div>
          <h2 className="page-title">Manajemen Pelanggan</h2>
          <p className="page-sub">Kelola user, saldo, ban, & lihat riwayat transaksi</p>
        </div>
      </div>

      {/* Stat cards */}
      {s && (
        <div className="prod-stat-grid">
          <StatCard icon="users" accent="blue" label="Total User" value={compact(s.totalUsers)}
            sub={`${s.activeBuyers} buyer aktif`} />
          <StatCard icon="cash" accent="green" label="Buyer Aktif" value={compact(s.activeBuyers)}
            sub="Pernah checkout sukses" />
          <StatCard icon="wallet" accent="violet" label="Saldo Beredar" value={rupiah(s.totalBalance)}
            sub="Total saldo semua user" />
          <StatCard icon="warning" accent={s.bannedUsers > 0 ? 'red' : 'amber'} label="User Banned" value={compact(s.bannedUsers)}
            sub="Tidak bisa order" />
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => { setFilter(f.key); setPage(1); }}>
              {f.label}
              {counts[f.key] != null && <span className="chip-count">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <div className="search" style={{ flex: 1, minWidth: 200 }}>
            <span className="search-icon"><Icon name="search" size={15} /></span>
            <input placeholder="Cari username / nama / ID…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select className="select-field" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="panel no-pad">
        {error ? (
          <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>
        ) : loading && !data ? (
          <SkeletonTable rows={8} cols={7} />
        ) : data && data.users.length === 0 ? (
          <div className="empty">Tidak ada user pada filter ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table users-table">
              <thead>
                <tr>
                  <th>User</th><th>ID</th><th>Saldo</th><th>Order</th>
                  <th>Total Spend</th><th>Status</th><th className="th-action">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data?.users.map((u) => (
                  <tr key={u.id} className="row-click" onClick={() => setSelected(u.id)}>
                    <td>
                      <div className="user-cell">
                        <span className="user-avatar">{initial(u)}</span>
                        <div className="user-cell-info">
                          <div className="user-cell-name">{u.first_name || '-'}{u.last_name ? ' ' + u.last_name : ''}</div>
                          <div className="user-cell-sub">{u.username ? '@' + u.username : '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{u.id}</td>
                    <td>{u.balance > 0 ? <b style={{ color: '#37d399' }}>{rupiah(u.balance)}</b> : <span className="muted">—</span>}</td>
                    <td>{u.orders_success > 0 ? <><b>{u.orders_success}</b> <span className="muted">sukses</span></> : <span className="muted">0</span>}</td>
                    <td>{u.total_spend > 0 ? rupiah(u.total_spend) : <span className="muted">—</span>}</td>
                    <td>{u.banned ? <span className="badge st-cancelled">Banned</span> : <span className="badge st-delivered">Aktif</span>}</td>
                    <td>
                      <div className="stock-action-cell">
                        <button className="a-btn a-blue btn-icon" onClick={(e) => { e.stopPropagation(); setSelected(u.id); }}>
                          <Icon name="eye" size={14} /> Detail
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

      {data && data.totalPages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
          <span>Hal {data.page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}

      {selected && (
        <UserDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} toast={showToast} />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// ---- User detail drawer ----
function UserDrawer({ id, onClose, onChanged, toast }) {
  const [user, setUser] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [balanceModal, setBalanceModal] = useState(false);

  const load = useCallback(() => {
    fetchUserDetail(id).then(setUser).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doBan = async () => {
    setBusy('ban');
    try {
      const r = await toggleBanUser(id);
      toast(r.message);
      load(); onChanged();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };

  const balHistoryIcon = (type) => {
    if (type === 'topup' || type === 'admin_add') return { icon: 'plus', color: '#37d399' };
    if (type === 'deduct' || type === 'admin_deduct') return { icon: 'minus', color: '#ff6b6b' };
    return { icon: 'coin', color: '#8a93a6' };
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer drawer-wide">
        <div className="drawer-head">
          <h3 className="h3-icon"><Icon name="user" size={18} /> Detail User</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        {err && <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {err}</div>}
        {!user && !err && <div className="empty">Memuat…</div>}

        {user && (
          <div className="drawer-body">
            {/* Identitas */}
            <div className="user-detail-head">
              <span className="user-avatar-lg">{(user.first_name || user.username || '?').charAt(0).toUpperCase()}</span>
              <div>
                <div className="user-detail-name">
                  {user.first_name || '-'}{user.last_name ? ' ' + user.last_name : ''}
                  {user.banned
                    ? <span className="badge st-cancelled" style={{ marginLeft: 8 }}>Banned</span>
                    : <span className="badge st-delivered" style={{ marginLeft: 8 }}>Aktif</span>}
                </div>
                <div className="user-detail-sub">{user.username ? '@' + user.username : '— tanpa username'}</div>
              </div>
            </div>

            <div className="d-row"><span>User ID</span><b className="mono">{user.id}</b></div>
            <div className="d-row"><span>Bahasa</span><b className="up">{user.language}</b></div>
            <div className="d-row"><span>Bergabung</span><b>{fmtDate(user.created_at)}</b></div>

            {/* Ringkasan */}
            <div className="user-stat-row">
              <div className="user-stat"><div className="us-val">{user.stats.orders_total}</div><div className="us-lbl">Total Order</div></div>
              <div className="user-stat"><div className="us-val" style={{ color: '#37d399' }}>{user.stats.orders_success}</div><div className="us-lbl">Sukses</div></div>
              <div className="user-stat"><div className="us-val">{rupiah(user.stats.total_spend)}</div><div className="us-lbl">Total Spend</div></div>
            </div>

            {/* Saldo */}
            <div className="balance-box">
              <div>
                <div className="balance-label">Saldo Saat Ini</div>
                <div className="balance-value">{rupiah(user.balance)}</div>
              </div>
              <button className="btn-primary btn-icon" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => setBalanceModal(true)}>
                <Icon name="wallet" size={15} /> Kelola Saldo
              </button>
            </div>

            {/* Riwayat saldo */}
            {user.balance_history.length > 0 && (
              <>
                <div className="d-label hint-icon" style={{ marginTop: 18 }}><Icon name="coin" size={14} /> Riwayat Saldo</div>
                <div className="bal-history">
                  {user.balance_history.map((h) => {
                    const ic = balHistoryIcon(h.type);
                    return (
                      <div key={h.id} className="bal-item">
                        <span className="bal-icon" style={{ color: ic.color }}><Icon name={ic.icon} size={14} /></span>
                        <div className="bal-item-main">
                          <div className="bal-note">{h.note}</div>
                          <div className="bal-date">{fmtDate(h.created_at)}</div>
                        </div>
                        <div className="bal-amt" style={{ color: h.amount >= 0 ? '#37d399' : '#ff6b6b' }}>
                          {h.amount >= 0 ? '+' : ''}{rupiah(h.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Riwayat order */}
            {user.recent_orders.length > 0 && (
              <>
                <div className="d-label hint-icon" style={{ marginTop: 18 }}><Icon name="receipt" size={14} /> Order Terbaru</div>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="table">
                    <thead><tr><th>Order</th><th>Produk</th><th>Total</th><th>Status</th></tr></thead>
                    <tbody>
                      {user.recent_orders.map((o) => {
                        const st = ORDER_STATUS[o.status] || { label: o.status, cls: 'st-muted' };
                        return (
                          <tr key={o.id}>
                            <td className="mono" style={{ fontSize: 12 }}>{o.id}</td>
                            <td className="ellip">{o.product}</td>
                            <td>{rupiah(o.total_idr)}</td>
                            <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Aksi */}
            <div className="d-actions" style={{ marginTop: 20 }}>
              <button className={`a-btn btn-icon ${user.banned ? 'a-green' : 'a-red'}`} disabled={!!busy} onClick={doBan}>
                <Icon name={user.banned ? 'check' : 'pause'} size={15} /> {user.banned ? 'Unban User' : 'Ban User'}
              </button>
            </div>
          </div>
        )}
      </aside>

      {balanceModal && user && (
        <BalanceModal user={user} onClose={() => setBalanceModal(false)}
          toast={toast} onDone={() => { setBalanceModal(false); load(); onChanged(); }} />
      )}
    </>
  );
}

// ---- Balance adjust modal ----
function BalanceModal({ user, onClose, toast, onDone }) {
  const [action, setAction] = useState('add'); // add | deduct | set
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const amt = parseInt(amount) || 0;
  const preview = action === 'add' ? user.balance + amt
    : action === 'deduct' ? Math.max(0, user.balance - amt)
    : amt;

  const submit = async () => {
    if (amt < 0 || (action !== 'set' && amt <= 0)) return toast('Nominal tidak valid', 'err');
    setBusy(true);
    try {
      const r = await adjustUserBalance(user.id, action, amt, note);
      toast(r.message);
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const ACTIONS = [
    { key: 'add', label: 'Tambah' },
    { key: 'deduct', label: 'Kurangi' },
    { key: 'set', label: 'Set Nilai' }
  ];

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'left' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="h3-icon"><Icon name="wallet" size={18} /> Kelola Saldo</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p style={{ fontSize: 13, color: '#8a93a6', margin: '0 0 14px' }}>
          {displayName(user)} · Saldo saat ini: <b style={{ color: '#37d399' }}>{rupiah(user.balance)}</b>
        </p>

        <div className="chips" style={{ marginBottom: 14 }}>
          {ACTIONS.map((a) => (
            <button key={a.key} className={`chip ${action === a.key ? 'active' : ''}`} onClick={() => setAction(a.key)}>{a.label}</button>
          ))}
        </div>

        <label className="field-label">Nominal (IDR)</label>
        <input type="number" min="0" className="qty-field" placeholder="cth: 50000" value={amount} onChange={(e) => setAmount(e.target.value)} />

        <label className="field-label" style={{ marginTop: 12 }}>Catatan (opsional)</label>
        <input type="text" className="qty-field" placeholder="cth: bonus event / koreksi" value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="balance-preview">
          Saldo setelah perubahan: <b style={{ color: '#37d399' }}>{rupiah(preview)}</b>
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Memproses…' : 'Simpan'}</button>
        </div>
      </div>
    </div>
  );
}
