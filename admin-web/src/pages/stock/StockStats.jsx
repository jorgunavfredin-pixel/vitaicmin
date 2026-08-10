import Icon from '../../components/Icons.jsx';
import { formatIDR, compact } from './stock-utils.js';

// KPI card kecil — reuse .stat-card, accent via kelas scoped stok-*.
function KpiCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`stat-card stok-kpi-card stok-accent-${accent}`}>
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

// KPI 4 CARD. Nilai Stok Jual = steel/blue, BUKAN violet, BUKAN modal/HPP.
export default function StockStats({ stats }) {
  if (!stats) return null;
  const restock = (stats.lowStockCount || 0) + (stats.outOfStockCount || 0);
  return (
    <div className="prod-stat-grid stok-kpi-grid">
      <KpiCard icon="box" accent="green" label="Stok Tersedia"
        value={compact(stats.totalAvailable)} sub="item siap dijual" />
      <KpiCard icon="clock" accent="amber" label="Stok Dicadangkan"
        value={compact(stats.totalReserved)} sub="ditahan oleh order aktif/pending" />
      <KpiCard icon="warning" accent={stats.outOfStockCount > 0 ? 'red' : 'amber'} label="Perlu Restock"
        value={restock} sub={`${stats.lowStockCount || 0} menipis · ${stats.outOfStockCount || 0} habis`} />
      <KpiCard icon="wallet" accent="steel" label="Nilai Stok Jual"
        value={formatIDR(stats.inventoryValue)} sub="berdasarkan harga jual efektif" />
    </div>
  );
}
