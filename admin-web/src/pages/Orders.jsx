import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchOrders, fetchOrder, redeliverOrder, replaceOrder,
  refundOrder, deleteOrder, downloadOrdersCsv
} from '../api.js';
import Icon from '../components/Icons.jsx';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '-';

const STATUS = {
  pending: { label: 'Pending', cls: 'st-pending' },
  paid: { label: 'Dibayar', cls: 'st-paid' },
  delivered: { label: 'Terkirim', cls: 'st-delivered' },
  cancelled: { label: 'Batal', cls: 'st-cancelled' },
  expired: { label: 'Kadaluarsa', cls: 'st-expired' },
  refunded: { label: 'Refund', cls: 'st-cancelled' },
  init: { label: 'Draft', cls: 'st-muted' },
  processing: { label: 'Proses', cls: 'st-pending' }
};
const badge = (s) => {
  const m = STATUS[s] || { label: s, cls: 'st-muted' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
};

const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'pending', label: 'Pending' },
  { key: 'delivered', label: 'Terkirim' },
  { key: 'expired', label: 'Kadaluarsa' },
  { key: 'cancelled', label: 'Batal' },
  { key: 'refunded', label: 'Refund' }
];

export default function Orders() {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = { status, q, page, pageSize: 20 };
    if (from) params.from = from;
    if (to) params.to = to;
    fetchOrders(params)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, q, page, from, to]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0); // debounce search
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const handleUpdate = () => {
      load();
    };
    window.addEventListener('order_updated', handleUpdate);
    return () => window.removeEventListener('order_updated', handleUpdate);
  }, [load]);

  const onExport = async () => {
    try { await downloadOrdersCsv(); } catch (e) { showToast(e.message, 'err'); }
  };

  const counts = data?.counts || {};

  return (
    <div className="orders">
      <div className="page-head">
        <div>
          <h2 className="page-title">Orders</h2>
          <p className="page-sub">{data ? `${data.total} order` : 'Memuat…'}</p>
        </div>
        <button className="btn-ghost btn-icon" onClick={onExport}><Icon name="download" size={16} /> Export CSV</button>
      </div>

      <div className="toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${status === f.key ? 'active' : ''}`}
              onClick={() => { setStatus(f.key); setPage(1); }}
            >
              {f.label}
              {counts[f.key] != null && <span className="chip-count">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-filters">
          <div className="search">
            <span className="search-icon"><Icon name="search" size={15} /></span>
            <input
              placeholder="Cari ID / user / produk…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </div>
          <div className="date-filter">
            <input
              type="date"
              className="date-field"
              value={from}
              max={to || undefined}
              title="Dari tanggal"
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            />
            <span className="date-sep">—</span>
            <input
              type="date"
              className="date-field"
              value={to}
              min={from || undefined}
              title="Sampai tanggal"
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
            />
            {(from || to) && (
              <button className="date-clear" title="Reset tanggal" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="panel no-pad">
        {error ? (
          <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order ID</th><th>User</th><th>Produk</th><th>Qty</th>
                  <th>Total</th><th>Metode</th><th>Status</th><th>Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr><td colSpan={8} className="empty">Memuat…</td></tr>
                ) : data && data.orders.length === 0 ? (
                  <tr><td colSpan={8} className="empty">Tidak ada order</td></tr>
                ) : (
                  data?.orders.map((o) => (
                    <tr key={o.id} className="row-click" onClick={() => setSelected(o.id)}>
                      <td className="mono">{o.id}</td>
                      <td>{o.username ? '@' + o.username : (o.first_name || o.user_id)}</td>
                      <td className="ellip">{o.product}</td>
                      <td>{o.quantity}</td>
                      <td>{rupiah(o.total_idr)}</td>
                      <td className="up">{o.method || '-'}</td>
                      <td>{badge(o.status)}</td>
                      <td className="muted-cell">{fmtDate(o.created_at)}</td>
                    </tr>
                  ))
                )}
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
        <OrderDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { load(); }}
          toast={showToast}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function OrderDrawer({ id, onClose, onChanged, toast }) {
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const qtyRef = useRef(null);

  const load = useCallback(() => {
    fetchOrder(id).then(setOrder).catch((e) => setErr(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleUpdate = (e) => {
      if (e.detail && e.detail.id === id) {
        load();
      }
    };
    window.addEventListener('order_updated', handleUpdate);
    return () => window.removeEventListener('order_updated', handleUpdate);
  }, [id, load]);

  const run = async (action, fn) => {
    setBusy(action);
    try {
      const r = await fn(id);
      toast(r.message || 'Berhasil');
      setConfirm(null);
      load();
      onChanged();
      if (action === 'delete') onClose();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };

  const runReplace = async (count) => {
    setBusy('replace');
    try {
      const r = await replaceOrder(id, count);
      toast(r.message || 'Berhasil');
      setConfirm(null);
      load();
      onChanged();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };

  // Setelah refund: akun sudah ditarik balik ke admin, jadi kirim ulang & replace TIDAK boleh lagi.
  // Order refunded hanya menyisakan opsi Hapus.
  const isRefunded = order?.status === 'refunded';
  const actions = order ? [
    { key: 'redeliver', icon: 'refresh', label: 'Kirim Ulang', fn: redeliverOrder, show: !isRefunded && order.delivered_data?.length > 0, cls: 'a-blue' },
    { key: 'replace', icon: 'exchange', label: 'Replace Akun', fn: replaceOrder, show: !isRefunded && order.status === 'delivered', cls: 'a-violet' },
    { key: 'refund', icon: 'arrow-back', label: 'Refund', fn: refundOrder, show: ['delivered', 'paid'].includes(order.status), danger: true, cls: 'a-amber' },
    { key: 'delete', icon: 'trash', label: 'Hapus', fn: deleteOrder, show: true, danger: true, cls: 'a-red' }
  ].filter(a => a.show) : [];


  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h3>Detail Order</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        {err && <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {err}</div>}
        {!order && !err && <div className="empty">Memuat…</div>}

        {order && (
          <div className="drawer-body">
            <div className="d-row"><span>Order ID</span><b className="mono">{order.id}</b></div>
            <div className="d-row"><span>Status</span>{badge(order.status)}</div>
            <div className="d-row"><span>Produk</span><b>{order.product_name}</b></div>
            {order.product_id !== 'TOPUP' && <div className="d-row"><span>Qty</span><b>{order.quantity}</b></div>}
            <div className="d-row"><span>Total</span><b>{rupiah(order.total_idr)} <span className="muted">(~${order.total_usd})</span></b></div>
            <div className="d-row"><span>Metode</span><b className="up">{order.payment_method || '-'}</b></div>
            <div className="d-divider" />
            <div className="d-row"><span>User</span><b>{order.user?.first_name || 'Unknown'}</b></div>
            {order.user?.username && <div className="d-row"><span>Username</span><b>@{order.user.username}</b></div>}
            <div className="d-row"><span>User ID</span><b className="mono">{order.user_id}</b></div>
            <div className="d-divider" />
            <div className="d-row"><span>Dibuat</span><b>{fmtDate(order.created_at)}</b></div>
            {order.paid_at && <div className="d-row"><span>Dibayar</span><b>{fmtDate(order.paid_at)}</b></div>}
            {order.delivered_at && <div className="d-row"><span>Terkirim</span><b>{fmtDate(order.delivered_at)}</b></div>}

            {order.delivered_data?.length > 0 && (
              <>
                <div className="d-divider" />
                <div className="d-label hint-icon"><Icon name="clipboard" size={14} /> Data Terkirim ({order.delivered_data.length})</div>
                <div className="d-accounts">
                  {order.delivered_data.map((d, i) => <code key={i}>{d}</code>)}
                </div>
              </>
            )}

            {order.status === 'delivered' && (
              <div className="d-hint hint-icon"><Icon name="box" size={14} /> Stok tersedia untuk replace: <b>{order.available_stock}</b></div>
            )}

            <div className="d-actions">
              {actions.map((a) => (
                <button
                  key={a.key}
                  className={`a-btn btn-icon ${a.cls}`}
                  disabled={!!busy}
                  onClick={() => (a.danger || a.key === 'replace') ? setConfirm(a) : run(a.key, a.fn)}
                >
                  {busy === a.key ? '…' : <><Icon name={a.icon} size={15} /> {a.label}</>}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {confirm && (
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className={`modal-icon ${confirm.key === 'replace' ? '' : 'modal-icon-danger'}`}><Icon name={confirm.key === 'replace' ? 'exchange' : 'warning'} size={30} /></div>
            <h4>{confirm.label}?</h4>
            {confirm.key === 'replace' ? (
              <div style={{ margin: '14px 0', textAlign: 'left' }}>
                <label style={{ marginBottom: 8, display: 'block', fontSize: 13, color: '#8a93a6' }}>
                  Jumlah akun yang ingin dikirim:
                </label>
                <input
                  ref={qtyRef}
                  type="text"
                  inputMode="numeric"
                  placeholder="Masukkan jumlah"
                  defaultValue="1"
                  className="qty-field"
                />
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#8a93a6' }}>
                  Maksimal: <b>{order.available_stock}</b> (stok tersedia)
                </div>
              </div>
            ) : (
              <p>
                {confirm.key === 'refund' && 'Akun yang sudah terkirim ditarik balik ke stok admin & user diberi notifikasi refund. Setelah ini order hanya bisa dihapus (tidak bisa kirim ulang / replace).'}
                {confirm.key === 'delete' && 'Order dihapus permanen. Aksi ini tidak bisa dibatalkan.'}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirm(null)}>Batal</button>
              <button
                className={confirm.key === 'replace' ? 'btn-primary' : 'btn-danger'}
                disabled={!!busy || (confirm.key === 'replace' && order.available_stock === 0)}
                onClick={() => {
                  if (confirm.key === 'replace') {
                    const val = parseInt(qtyRef.current?.value);
                    if (!val || val < 1) return toast('Jumlah harus minimal 1', 'err');
                    if (val > order.available_stock) return toast(`Stok tidak cukup! Maksimal ${order.available_stock}`, 'err');
                    runReplace(val);
                  } else {
                    run(confirm.key, confirm.fn);
                  }
                }}
              >
                {busy ? 'Memproses…' : 'Ya, Lanjut'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
