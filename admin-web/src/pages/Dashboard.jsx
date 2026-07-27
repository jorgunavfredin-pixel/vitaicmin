import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { fetchDashboard } from '../api.js';
import Icon from '../components/Icons.jsx';

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

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

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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

  const c = data.cards;

  return (
    <div className="dash">
      <div className="stat-grid">
        <StatCard accent="green" icon="cash" label="Omzet Hari Ini" value={rupiah(c.revenueToday)} sub={`Bulan ini: ${rupiah(c.revenueMonth)}`} />
        <StatCard accent="blue" icon="receipt" label="Total Order" value={compact(c.ordersTotal)} sub={`${c.ordersPending} pending • ${c.ordersSuccess} sukses`} />
        <StatCard accent="violet" icon="check" label="Success Rate" value={`${c.successRate}%`} sub={`${c.ordersSuccess} order berhasil`} />
        <StatCard accent="amber" icon="users" label="Total User" value={compact(c.totalUsers)} sub={`${c.totalProducts} produk aktif`} />
      </div>

      <div className="grid-2">
        <div className="panel chart-panel">
          <div className="panel-head">
            <h3>Omzet 14 Hari Terakhir</h3>
            <span className="panel-tag">{rupiah(c.revenueAllTime)} total</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.revenueSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#8a93a6', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8a93a6', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} width={48} />
              <Tooltip
                contentStyle={{ background: '#141a29', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#e7ecf5' }}
                formatter={(v, name) => name === 'revenue' ? [rupiah(v), 'Omzet'] : [v, 'Order']}
                labelStyle={{ color: '#8a93a6' }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#5b8cff" strokeWidth={2.5} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Produk Terlaris</h3></div>
          {data.topProducts.length === 0 ? (
            <div className="empty">Belum ada penjualan</div>
          ) : (
            <ul className="top-list">
              {data.topProducts.map((p, i) => (
                <li key={p.id}>
                  <span className={`rank rank-${i}`}>{i + 1}</span>
                  <span className="top-name">{p.name}</span>
                  <span className="top-qty">{p.qty}x</span>
                </li>
              ))}
            </ul>
          )}
          <div className="stock-note">
            <span className="hint-icon"><Icon name="box" size={15} /> Stok tersedia: <b>{c.totalStock}</b></span>
            {c.lowStockCount > 0 && <span className="low-badge hint-icon"><Icon name="warning" size={14} /> {c.lowStockCount} produk menipis</span>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Order Terbaru</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Order ID</th><th>Produk</th><th>Qty</th><th>Total</th><th>Metode</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => {
                const s = STATUS[o.status] || { label: o.status, cls: 'st-muted' };
                return (
                  <tr key={o.id}>
                    <td className="mono">{o.id}</td>
                    <td>{o.product}</td>
                    <td>{o.quantity}</td>
                    <td>{rupiah(o.total_idr)}</td>
                    <td className="up">{o.method || '-'}</td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                  </tr>
                );
              })}
              {data.recentOrders.length === 0 && (
                <tr><td colSpan={6} className="empty">Belum ada order</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
