import Icon from '../../components/Icons.jsx';
import { stockTypeLabel } from '../../pages/products/utils.jsx';
import StockManagerContent from './StockManagerContent.jsx';

// ---- STOCK MANAGEMENT DRAWER (wrapper) ----
// Isi asli sudah dipindah ke StockManagerContent.jsx supaya bisa dipakai ulang
// di dalam Product Workspace (dock) tanpa duplikasi logika. Wrapper ini menjaga
// perilaku lama untuk halaman Stock (scrim + aside kanan).
export default function StockDrawer({ prod, onClose, toast, onChanged }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer drawer-wide">
        <div className="drawer-head">
          <div>
            <h3 className="h3-icon"><Icon name="box" size={18} /> Kelola Stok</h3>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{prod.name_id} · {stockTypeLabel(prod.stock_type)}</div>
          </div>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="drawer-body">
          <StockManagerContent prod={prod} toast={toast} onChanged={onChanged} />
        </div>
      </aside>
    </>
  );
}
