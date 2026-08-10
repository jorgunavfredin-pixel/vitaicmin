import Icon from '../../components/Icons.jsx';
import { formatIDR, stockTypeLabel } from './utils.jsx';

// ---- SMALL PRESENTATIONAL COMPONENTS ----

export function ProdStat({ icon, label, value, sub, accent }) {
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

export function StockPill({ count }) {
  if (count > 0 && count < 3) return <b className="hint-icon" style={{ color: 'var(--amber)' }}>{count} item <Icon name="warning" size={13} /></b>;
  if (count > 0) return <b style={{ color: 'var(--green)' }}>{count} item</b>;
  return <span className="badge st-cancelled">Habis (0)</span>;
}

// Grid card — klik seluruh card buka Product Workspace (§8). Tanpa tombol aksi & badge clickable.
export function ProductCard({ p, selected, onOpen }) {
  return (
    <div className={`prod-card ${!p.active ? 'is-paused' : ''} ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div className="prod-card-top">
        <span className="badge st-muted" style={{ fontSize: 11 }}>{p.category_name_id}</span>
        <span className={`badge status-dot ${p.active ? 'st-delivered' : 'st-expired'}`}>{p.active ? 'Aktif' : 'Nonaktif'}</span>
      </div>
      <div className="prod-card-name">{p.name_id}</div>
      <div className="prod-card-meta">{p.name_en || '-'}</div>

      <div className="prod-card-price">
        {p.is_flash_active ? (
          <>
            <span className="strike">{formatIDR(p.price_idr)}</span>
            <b className="flash">{formatIDR(p.flash_price)}</b>
            <span className="badge-flash badge-icon"><Icon name="flash" size={12} /> Flash</span>
          </>
        ) : (
          <b>{formatIDR(p.price_idr)}</b>
        )}
      </div>

      <div className="prod-card-stock">
        <div>
          <div className="mini-label">Stok</div>
          <StockPill count={p.available_stock} />
        </div>
        <div>
          <div className="mini-label" title="Item terjual dalam 30 hari terakhir">Terjual (30h)</div>
          <b>{p.sold_stock || 0} pcs</b>
        </div>
        <div>
          <div className="mini-label">Tipe</div>
          <span style={{ fontSize: 12 }}>{stockTypeLabel(p.stock_type)}</span>
        </div>
      </div>
    </div>
  );
}
