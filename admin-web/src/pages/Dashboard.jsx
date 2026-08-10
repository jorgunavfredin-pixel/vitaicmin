import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart
} from 'recharts';
import { fetchDashboard } from '../api.js';
import Icon from '../components/Icons.jsx';

const PERIODS = [
  { key: 7, label: '7 Hari' },
  { key: 14, label: '14 Hari' },
  { key: 30, label: '30 Hari' }
];

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtShort = (iso) => iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export function RevenueBreakdown({ month, allTime }) {
  return (
    <div className="stat-breakdown">
      <div className="stat-breakdown-row"><span>Bulan ini</span><b>{rupiah(month)}</b></div>
      <div className="stat-breakdown-row"><span>All time</span><b>{rupiah(allTime)}</b></div>
    </div>
  );
}

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

// §26 MiniSparkline — recharts AreaChart tanpa axis/grid/legend, steel blue + gradient fill
function MiniSparkline({ points, color = '#4F86B8', id = 's' }) {
  if (!points || points.length < 2) return null;
  const data = points.map((v, i) => ({ i, v }));
  const gid = `spark-${id}`;
  return (
    <div className="stat-spark">
      <ResponsiveContainer width="100%" height={24}>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${gid})`} dot={false} isAnimationActive={true} animationDuration={500} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// §25 StatsCard — icon + label + value + growth + sparkline
function StatCard({ icon, label, value, sub, accent, spark, sparkColor, sparkId, growth }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-head">
        <div className="stat-icon"><Icon name={icon} size={20} /></div>
        {growth != null && (
          <span className={`stat-growth ${growth >= 0 ? 'up' : 'down'}`}>
            {growth >= 0 ? '+' : ''}{growth}% <span className="stat-growth-lbl">vs 7 hari</span>
          </span>
        )}
      </div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      {spark && <MiniSparkline points={spark} color={sparkColor} id={sparkId} />}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(14);
  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [topAllOpen, setTopAllOpen] = useState(false);

  const load = useCallback(() => {
    fetchDashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleUpdate = () => {
      load();
    };
    window.addEventListener('order_updated', handleUpdate);
    return () => window.removeEventListener('order_updated', handleUpdate);
  }, [load]);

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;
  if (!data) return <div className="skeleton-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton-card" />)}</div>;

  // PREVIEW ONLY: buka /admin/?demo untuk lihat chart naik-turun (data sintetis, tidak menyentuh backend).
  // Tanpa ?demo, semua pakai data real dari API.
  let view = data;
  if (typeof window !== 'undefined' && window.location.search.includes('demo')) {
    const days = 30;
    const today = new Date();
    const demoSeries = Array.from({ length: days }).map((_, i) => {
      const dt = new Date(today); dt.setDate(today.getDate() - (days - 1 - i));
      const label = `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const base = 400000 + i * 22000;
      const wave = Math.sin(i / 2.2) * 260000;
      const noise = (Math.sin(i * 4.7) * 0.5 + 0.5) * 180000;
      const revenue = Math.max(30000, Math.round(base + wave + noise));
      const orders = Math.max(2, Math.round(8 + Math.sin(i / 1.8) * 6 + (i * 0.6) + (Math.sin(i * 3.3) * 3)));
      return { date: dt.toISOString().slice(0, 10), label, revenue, orders };
    });
    view = { ...data, revenueSeries: demoSeries, cards: { ...data.cards, revenueToday: demoSeries[demoSeries.length - 1].revenue } };
  }

  const c = view.cards;
  // Series datang 30 hari dari backend; potong sesuai periode terpilih (tampil di client, tanpa refetch).
  const series = (view.revenueSeries || []).slice(-period);
  const periodRevenue = series.reduce((sum, d) => sum + (d.revenue || 0), 0);
  const periodOrders = series.reduce((sum, d) => sum + (d.orders || 0), 0);
  // §25-26 sparkline + growth dari revenueSeries — data real dari backend
  const rsAll = view.revenueSeries || [];
  const last7 = rsAll.slice(-7);
  const prev7 = rsAll.slice(-14, -7);
  const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0);
  const growthPct = (cur, prev) => {
    if (!prev) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };
  const sparkRevenue = last7.map((d) => d.revenue || 0);
  const sparkOrders = last7.map((d) => d.orders || 0);
  // User growth (proxy real): kumulatif order per hari = tren akuisisi aktivitas
  let acc = 0;
  const sparkUsers = last7.map((d) => { acc += (d.orders || 0); return acc; });
  // Stok (proxy real): tren volume order harian sebagai indikator perputaran stok
  const sparkStock = last7.map((d) => d.orders || 0);
  const growthRevenue = growthPct(sum(last7, 'revenue'), sum(prev7, 'revenue'));
  const growthOrders = growthPct(sum(last7, 'orders'), sum(prev7, 'orders'));

  return (
    <div className="dash">
      <div className="dash-greet">
        <div>
          <div className="dash-greet-title">Hai, Admin 👋</div>
          <div className="dash-greet-sub">Ringkasan toko kamu</div>
        </div>
      </div>
      <div className="stat-grid">
        <StatCard accent="green" icon="cash" label="Omzet Hari Ini" value={rupiah(c.revenueToday)} sub={`All time ${rupiah(c.revenueAllTime)}`} spark={sparkRevenue} sparkColor="#4F86B8" sparkId="rev" growth={growthRevenue} />
        <StatCard accent="blue" icon="receipt" label="Total Order" value={compact(c.ordersTotal)} sub={`${c.ordersPending} pending • ${c.ordersSuccess} sukses`} spark={sparkOrders} sparkColor="#4F86B8" sparkId="ord" growth={growthOrders} />
        <StatCard accent="blue" icon="users" label="Total User" value={compact(c.totalUsers)} sub={`${compact(c.activeUsers || 0)} user aktif`} spark={sparkUsers} sparkColor="#4F86B8" sparkId="usr" />
        <StatCard accent="amber" icon="box" label="Stok Items" value={compact(c.totalStock)} sub={c.lowStockCount > 0 ? `${c.lowStockCount} produk menipis` : `${c.totalProducts} produk aktif`} spark={sparkStock} sparkColor="#4F86B8" sparkId="stk" />
      </div>

      <div className="grid-2">
        <div className="panel chart-panel">
          <div className="panel-head">
            <h3>Omzet & Order</h3>
            <div className="chips">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  className={`chip ${period === p.key ? 'active' : ''}`}
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-summary">
            <span className="hint-icon"><Icon name="cash" size={14} /> {rupiah(periodRevenue)} omzet</span>
            <span className="hint-icon"><Icon name="receipt" size={14} /> {periodOrders} order</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={series} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4F86B8" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#4F86B8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,150,175,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#8295A8', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis yAxisId="rev" tick={{ fill: '#8295A8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} width={60} />
              <YAxis yAxisId="ord" orientation="right" tick={{ fill: '#5f6981', fontSize: 11 }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
              <Tooltip
                cursor={{ stroke: '#4F86B8', strokeWidth: 1, strokeDasharray: '4 4' }}
                contentStyle={{ background: '#101F2E', border: '1px solid #24394B', borderRadius: 8, color: '#F3F7FA', boxShadow: '0 10px 32px rgba(0,0,0,0.22)' }}
                formatter={(v, name) => name === 'revenue' ? [rupiah(v), 'Omzet'] : [v, 'Order']}
                labelStyle={{ color: '#8295A8', marginBottom: 4 }}
              />
              <Bar yAxisId="ord" dataKey="orders" fill="#45B97C" opacity={0.22} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Area
                yAxisId="rev"
                type="monotone"
                dataKey="revenue"
                stroke="#4F86B8"
                strokeWidth={2}
                fill="url(#rev)"
                dot={false}
                activeDot={{ r: 4, fill: '#4F86B8', stroke: '#07111D', strokeWidth: 3 }}
                animationDuration={500}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Produk Terlaris</h3>
            <span className="top-all-wrap">
              <button className="panel-link" onClick={() => setTopAllOpen((v) => !v)} aria-expanded={topAllOpen}>
                Lihat semua <Icon name={topAllOpen ? 'chevron-up' : 'chevron-down'} size={13} />
              </button>
              {topAllOpen && (
                <>
                  <div className="popover-scrim" onClick={() => setTopAllOpen(false)} />
                  <div className="low-stock-pop top-all-pop" role="dialog">
                    <div className="low-stock-pop-head">
                      <Icon name="products" size={13} /> Ranking Produk Terjual ({(view.topProductsAll || []).length})
                    </div>
                    <ul className="low-stock-list top-all-list">
                      {(view.topProductsAll || []).map((p, i) => (
                        <li key={p.id}>
                          <span className="tap-rank">{i + 1}</span>
                          <span className="lsp-name">{p.name}</span>
                          <span className="tap-qty">{compact(p.qty)} pcs</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </span>
          </div>
          {data.topProducts.length === 0 ? (
            <div className="empty">Belum ada penjualan</div>
          ) : (
            <ul className="top-list">
              {data.topProducts.map((p, i) => (
                <li key={p.id}>
                  <span className="top-rank">{i + 1}</span>
                  <span className="top-thumb">{(p.name || '?').charAt(0).toUpperCase()}</span>
                  <span className="top-name">{p.name}</span>
                  <span className="top-qty">{compact(p.qty)} pcs</span>
                </li>
              ))}
            </ul>
          )}
          <div className="stock-note">
            <span className="hint-icon"><Icon name="box" size={15} /> Stok tersedia: <b>{c.totalStock}</b></span>
            {c.lowStockCount > 0 && (
              <span className="low-stock-wrap">
                <button
                  className="low-badge low-badge-btn hint-icon"
                  onClick={() => setLowStockOpen((v) => !v)}
                  aria-expanded={lowStockOpen}
                >
                  <Icon name="warning" size={14} /> {c.lowStockCount} produk menipis
                  <Icon name={lowStockOpen ? 'chevron-up' : 'chevron-down'} size={13} />
                </button>
                {lowStockOpen && (
                  <>
                    <div className="popover-scrim" onClick={() => setLowStockOpen(false)} />
                    <div className="low-stock-pop" role="dialog">
                      <div className="low-stock-pop-head">
                        <Icon name="warning" size={13} /> Produk Stok Menipis
                      </div>
                      <ul className="low-stock-list">
                        {(data.lowStockProducts || []).map((p) => (
                          <li key={p.id}>
                            <span className="lsp-name">{p.name}</span>
                            <span className={`lsp-qty ${p.qty === 0 ? 'lsp-zero' : ''}`}>
                              {p.qty === 0 ? 'Habis' : `${p.qty} tersisa`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Order Terbaru</h3>
          <button className="panel-link" onClick={() => navigate('/orders')}>Lihat semua order <Icon name="chevron" size={13} /></button>
        </div>

        {/* §33 Desktop: tabel semantik + Actions */}
        <div className="recent-desktop table-wrap">
          <table className="table">
            <thead>
              <tr><th>Order ID</th><th>Produk</th><th>Qty</th><th>Total</th><th>Metode</th><th>Status</th><th>Tanggal</th><th></th></tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id} className="row-click" onClick={() => navigate('/orders')}>
                  <td data-label="Order ID" className="mono link-cell">{o.id}</td>
                  <td data-label="Produk" className="ellip">{o.product}</td>
                  <td data-label="Qty">{o.quantity}</td>
                  <td data-label="Total" className="amt-cell">{rupiah(o.total_idr)}</td>
                  <td data-label="Metode" className="up">{o.method || '-'}</td>
                  <td data-label="Status">{badge(o.status)}</td>
                  <td data-label="Tanggal" className="muted-cell">{fmtShort(o.created_at)}</td>
                  <td className="act-cell"><button className="row-act" aria-label="Aksi" onClick={(e) => { e.stopPropagation(); navigate('/orders'); }}><Icon name="list" size={16} /></button></td>
                </tr>
              ))}
              {data.recentOrders.length === 0 && (
                <tr><td colSpan={8} className="empty">Belum ada order</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* §34 Mobile: list card ringkas */}
        <div className="recent-mobile">
          {data.recentOrders.length === 0 ? (
            <div className="empty">Belum ada order</div>
          ) : (
            data.recentOrders.map((o) => (
              <div key={o.id} className="rec-row" onClick={() => navigate('/orders')}>
                <div className="rec-main">
                  <div className="rec-id mono">{o.id}</div>
                  <div className="rec-prod">{o.product}</div>
                </div>
                <div className="rec-right">
                  <div className="rec-amt">{rupiah(o.total_idr)}</div>
                  {badge(o.status)}
                </div>
              </div>
            ))
          )}
        </div>

        {data.recentOrders.length > 0 && (
          <div className="recent-foot">
            <span>Menampilkan {data.recentOrders.length} order terbaru</span>
          </div>
        )}
      </div>
    </div>
  );
}
