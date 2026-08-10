import Icon from '../../components/Icons.jsx';
import { formatIDR, stockTypeLabel, HEALTH } from './stock-utils.js';

// Sel Tersedia (§30): angka; out→0, low→warning kecil.
function AvailableCell({ p }) {
  if (p.stock_status === 'out') return <b className="stok-num stok-out">0</b>;
  if (p.stock_status === 'low') {
    return <b className="stok-num stok-low">{p.available ?? 0} <Icon name="warning" size={12} /></b>;
  }
  return <b className="stok-num stok-ok">{p.available ?? 0}</b>;
}

// INVENTORY TABLE (§27-36) — full-width, row clickable, tanpa tombol Kelola per row.
export default function StockTable({ rows, selectedId, onSelect }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Produk</th>
            <th>Kategori</th>
            <th>Tersedia</th>
            <th>Dicadangkan</th>
            <th title="Item terjual dalam 30 hari terakhir">Terjual 30 Hari</th>
            <th>Nilai Stok Jual</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const h = HEALTH[p.stock_status] || HEALTH.ok;
            return (
              <tr key={p.id} className={`row-click ${selectedId === p.id ? 'row-active' : ''}`} onClick={() => onSelect(p.id)}>
                <td data-label="Produk">
                  <div className="stok-prod-name">{p.name_id}</div>
                  <div className="stok-prod-sub">
                    {stockTypeLabel(p.stock_type)}
                    {!p.active && <span className="badge st-expired stok-inactive-badge">Nonaktif</span>}
                  </div>
                </td>
                <td data-label="Kategori"><span className="badge st-muted">{p.category_name}</span></td>
                <td data-label="Tersedia"><AvailableCell p={p} /></td>
                <td data-label="Dicadangkan">
                  {p.reserved > 0 ? <b className="stok-num stok-reserved">{p.reserved}</b> : <span className="stok-dash">0</span>}
                </td>
                <td data-label="Terjual 30 Hari"><b>{p.sold_30d || 0}</b></td>
                <td data-label="Nilai Stok Jual">{formatIDR(p.inventory_value)}</td>
                <td data-label="Status"><span className={`badge ${h.cls}`}>{h.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
