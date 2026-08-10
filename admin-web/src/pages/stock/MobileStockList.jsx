import { formatIDR, stockTypeLabel, HEALTH } from './stock-utils.js';

// MOBILE cards (§74). Tap card → full-screen StockDetail (via onSelect).
export default function MobileStockList({ rows, selectedId, onSelect }) {
  return (
    <div className="stok-mobile-list">
      {rows.map((p) => {
        const h = HEALTH[p.stock_status] || HEALTH.ok;
        return (
          <div key={p.id} className={`stok-mcard ${selectedId === p.id ? 'active' : ''}`} onClick={() => onSelect(p.id)}>
            <div className="stok-mcard-top">
              <div className="stok-mcard-name">{p.name_id}</div>
              <span className={`badge ${h.cls}`}>{h.label}</span>
            </div>
            <div className="stok-mcard-cat">
              <span className="badge st-muted">{p.category_name}</span>
              {!p.active && <span className="badge st-expired">Nonaktif</span>}
            </div>
            <div className="stok-mcard-type">{stockTypeLabel(p.stock_type)}</div>
            <div className="stok-mcard-metrics">
              <div className="stok-mcard-metric">
                <span className="stok-mcard-mlabel">Tersedia</span>
                <b>{p.stock_status === 'out' ? 0 : (p.available ?? 0)}</b>
              </div>
              <div className="stok-mcard-metric">
                <span className="stok-mcard-mlabel">Dicadangkan</span>
                <b className={p.reserved > 0 ? 'stok-reserved' : ''}>{p.reserved || 0}</b>
              </div>
            </div>
            <div className="stok-mcard-foot">
              <span>Terjual 30 Hari: <b>{p.sold_30d || 0}</b></span>
              <span>Nilai Stok Jual: <b>{formatIDR(p.inventory_value)}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
