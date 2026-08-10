import { useEffect, useState, useCallback } from 'react';
import {
  fetchOrders, downloadOrdersCsv
} from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import { rupiah, fmtDate, fmtTimeShort, badge, FILTERS } from './utils.jsx';
import OrderStat from './OrderStat.jsx';
import Pagination from './Pagination.jsx';
import OrderDrawer from './OrderDetail.jsx';

export default function Orders() {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
    fetchOrders({ status, q, page, pageSize })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, q, page, pageSize]);

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

  // Sort client-side (tidak ubah backend): urut tampilan per-page
  const sortedOrders = data?.orders ? [...data.orders].sort((a, b) => {
    if (sort === 'oldest') return (a.created_at || '').localeCompare(b.created_at || '');
    if (sort === 'highest') return (b.total_idr || 0) - (a.total_idr || 0);
    if (sort === 'lowest') return (a.total_idr || 0) - (b.total_idr || 0);
    return (b.created_at || '').localeCompare(a.created_at || ''); // newest
  }) : [];

  return (
    <div className={`orders-workspace ${selected ? 'dock-open' : ''}`}>
      <div className="orders-main">
      <div className="page-head">
        <div className="page-head-titles">
          <h2 className="page-title">Orders</h2>
          <p className="page-sub">{data ? `${new Intl.NumberFormat('id-ID').format(data.total)} order` : 'Memuat…'}</p>
        </div>
        <button className="btn-export" onClick={onExport} title="Export CSV"><Icon name="download" size={15} /> Export</button>
      </div>

      {/* §8 Status pills — filter navigasi utama (desktop). Mobile pakai stats+sheet. */}
      <div className="status-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`status-tab ${status === f.key ? 'active' : ''}`}
            onClick={() => { setStatus(f.key); setPage(1); }}
          >
            {f.label}
            {counts[f.key] != null && <span className="status-tab-count">{new Intl.NumberFormat('id-ID').format(counts[f.key])}</span>}
          </button>
        ))}
      </div>

      {/* §10 Stats: kartu summary metrics (bukan filter utama; tetap clickable shortcut) */}
      {data && (
        <div className="orders-stats">
          <OrderStat icon="receipt" label="Total Order" value={data.total} tone="blue" active={status === 'all'} onClick={() => { setStatus('all'); setPage(1); }} />
          <OrderStat icon="clock" label="Pending Payment" value={counts.pending ?? 0} tone="amber" active={status === 'pending'} onClick={() => { setStatus('pending'); setPage(1); }} />
          <OrderStat icon="check" label="Terkirim" value={counts.delivered ?? 0} tone="green" active={status === 'delivered'} onClick={() => { setStatus('delivered'); setPage(1); }} />
          <OrderStat icon="x" label="Batal" value={counts.cancelled ?? 0} tone="red" active={status === 'cancelled'} onClick={() => { setStatus('cancelled'); setPage(1); }} />
          <OrderStat icon="arrow-back" label="Refund" value={counts.refunded ?? 0} tone="muted" active={status === 'refunded'} onClick={() => { setStatus('refunded'); setPage(1); }} className="ostat-refund" />
        </div>
      )}

      {/* Search + Sort + Filter — 1 baris */}
      <div className="orders-search-row orders-search-row-mobile">
        <div className="search">
          <span className="search-icon"><Icon name="search" size={15} /></span>
          <input
            placeholder="Cari ID / user / produk…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <label className="sort-control">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Terbaru</option>
            <option value="oldest">Terlama</option>
            <option value="highest">Termahal</option>
            <option value="lowest">Termurah</option>
          </select>
        </label>
        <button className={`filter-btn ${status !== 'all' ? 'active' : ''}`} onClick={() => setFilterOpen(true)}>
          <Icon name="tool" size={15} /> Filter{status !== 'all' ? ' (1)' : ''}
        </button>
      </div>

      <div className="panel no-pad orders-table-card">
        {error ? (
          <div className="empty error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>
        ) : loading && !data ? (
          <SkeletonTable rows={8} cols={8} />
        ) : (
          <>
            {/* Desktop: tabel */}
            <div className="table-wrap orders-desktop-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order ID</th><th>User</th><th>Produk</th><th>Qty</th>
                    <th>Total</th><th>Metode</th><th>Status</th><th>Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {data && data.orders.length === 0 ? (
                    <tr><td colSpan={8} className="empty">Tidak ada order</td></tr>
                  ) : (
                    sortedOrders.map((o) => (
                      <tr key={o.id} className={`row-click ${selected === o.id ? 'row-active' : ''}`} onClick={() => setSelected(o.id)}>
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

            {/* Mobile: card list */}
            <div className="orders-mobile-list">
              {data && data.orders.length === 0 ? (
                <div className="empty">Tidak ada order</div>
              ) : (
                sortedOrders.map((o) => (
                  <button key={o.id} className="omc" onClick={() => setSelected(o.id)}>
                    <div className="omc-top">
                      <span className="omc-id mono">{o.id}</span>
                      <span className="omc-time">{fmtTimeShort(o.created_at)}</span>
                    </div>
                    <div className="omc-user">{o.username ? '@' + o.username : (o.first_name || o.user_id)}</div>
                    <div className="omc-prod">{o.product}{o.quantity > 1 ? <span className="omc-qty"> ×{o.quantity}</span> : ''}</div>
                    <div className="omc-bottom">
                      <span className="omc-total">{rupiah(o.total_idr)}{o.method ? <span className="omc-method"> · {o.method.toUpperCase()}</span> : ''}</span>
                      {badge(o.status)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {data && (
          <div className="orders-table-foot">
            <div className="otf-left">
              <span className="otf-info">Menampilkan {data.orders.length} dari {new Intl.NumberFormat('id-ID').format(data.total)} order</span>
              <label className="otf-pagesize">
                Tampilkan
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                / halaman
              </label>
            </div>
            {data.totalPages > 1 && (
              <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
            )}
          </div>
        )}
      </div>{/* /orders-table-card */}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {/* Filter bottom sheet (mobile) — status pilihan */}
      {filterOpen && (
        <div className="sheet-scrim" onClick={() => setFilterOpen(false)}>
          <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="filter-sheet-head">
              <h3>Filter Orders</h3>
              <button className="x" onClick={() => setFilterOpen(false)} aria-label="Tutup"><Icon name="x" size={18} /></button>
            </div>
            <div className="filter-sheet-body">
              <div className="filter-group-label">Status</div>
              <div className="filter-options">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`filter-opt ${status === f.key ? 'active' : ''}`}
                    onClick={() => { setStatus(f.key); setPage(1); }}
                  >
                    {f.label}
                    {counts[f.key] != null && <span className="filter-opt-count">{counts[f.key]}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-sheet-foot">
              <button className="btn-ghost" onClick={() => { setStatus('all'); setPage(1); }}>Reset</button>
              <button className="btn-primary" onClick={() => setFilterOpen(false)}>Terapkan</button>
            </div>
          </div>
        </div>
      )}
      </div>{/* /orders-main */}

      {/* Docked detail panel — sibling column, bukan overlay */}
      <aside className="order-detail-dock" aria-hidden={!selected}>
        {selected && (
          <OrderDrawer
            id={selected}
            onClose={() => setSelected(null)}
            onChanged={() => { load(); }}
            toast={showToast}
          />
        )}
      </aside>
    </div>
  );
}
