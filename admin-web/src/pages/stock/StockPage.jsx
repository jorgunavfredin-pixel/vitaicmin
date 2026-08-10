import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  fetchStockOverview, fetchCategories, downloadStockCsv
} from '../../api.js';
import StockManagerContent from '../../features/stock/StockManagerContent.jsx';
import Icon from '../../components/Icons.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import {
  byName, HEALTH_FILTERS, STOCK_TYPE_OPTIONS, SORT_OPTIONS
} from './stock-utils.js';
import StockStats from './StockStats.jsx';
import StockTable from './StockTable.jsx';
import MobileStockList from './MobileStockList.jsx';
import StockDetail from './StockDetail.jsx';
import ReservedModal from './ReservedModal.jsx';
import BulkRestockDialog from './BulkRestockDialog.jsx';
import './stock.css';

// Health count per chip — hitung dari data.products.
function healthCount(products, key) {
  if (key === 'all') return products.length;
  return products.filter((p) => p.stock_status === key).length;
}

export default function StockPage() {
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filters & sort
  const [healthFilter, setHealthFilter] = useState('all');
  const [reservedView, setReservedView] = useState(false); // yellow strip → tampilkan hanya produk dicadangkan (§30 Option A)
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockTypeFilter, setStockTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name_asc');

  // Selection & panels
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [detailMode, setDetailMode] = useState('detail'); // detail | manage
  const [bulkRestockOpen, setBulkRestockOpen] = useState(false);
  const [reservedModalProduct, setReservedModalProduct] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchStockOverview(), fetchCategories().catch(() => [])])
      .then(([ov, cats]) => { setData(ov); setCategories(cats); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh saat product_updated — JANGAN tutup dock.
  useEffect(() => {
    const h = () => load();
    window.addEventListener('product_updated', h);
    return () => window.removeEventListener('product_updated', h);
  }, [load]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' })),
    [categories]
  );

  const products = data?.products || [];
  const reservedProductCount = products.filter((p) => p.reserved > 0).length;

  const rows = useMemo(() => {
    let r = [...products];
    // Reserved-only view (dari yellow strip, §30)
    if (reservedView) r = r.filter((p) => p.reserved > 0);
    // Health filter (§9) — hanya low/out (chip); 'all' = semua
    if (healthFilter !== 'all') r = r.filter((p) => p.stock_status === healthFilter);
    // Kategori
    if (categoryFilter !== 'all') r = r.filter((p) => p.category_id === categoryFilter);
    // Tipe stok
    if (stockTypeFilter !== 'all') r = r.filter((p) => p.stock_type === stockTypeFilter);
    // Search (name_id / name_en / id)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      r = r.filter((p) => p.name_id.toLowerCase().includes(q)
        || (p.name_en || '').toLowerCase().includes(q)
        || String(p.id).toLowerCase().includes(q));
    }
    // Sort
    const num = (v) => (v == null ? -1 : v);
    switch (sort) {
      case 'name_desc': r.sort((a, b) => byName(b, a)); break;
      case 'available_desc': r.sort((a, b) => num(b.available) - num(a.available)); break;
      case 'available_asc': r.sort((a, b) => num(a.available) - num(b.available)); break;
      case 'sold_30d_desc': r.sort((a, b) => (b.sold_30d || 0) - (a.sold_30d || 0)); break;
      case 'sold_30d_asc': r.sort((a, b) => (a.sold_30d || 0) - (b.sold_30d || 0)); break;
      case 'inventory_value_desc': r.sort((a, b) => (b.inventory_value || 0) - (a.inventory_value || 0)); break;
      case 'inventory_value_asc': r.sort((a, b) => (a.inventory_value || 0) - (b.inventory_value || 0)); break;
      default: r.sort(byName);
    }
    return r;
  }, [products, reservedView, healthFilter, categoryFilter, stockTypeFilter, search, sort]);

  const selectedProduct = products.find((p) => p.id === selectedProductId) || null;
  const dockOpen = selectedProduct != null;
  const openDetail = (id) => { setSelectedProductId(id); setDetailMode('detail'); };
  const closeDetail = () => { setSelectedProductId(null); setDetailMode('detail'); };

  if (error) return <div className="panel error-panel hint-icon"><Icon name="warning" size={16} /> {error}</div>;

  const stats = data?.stats;

  return (
    <div className={`stock-workspace ${dockOpen ? 'dock-open' : ''}`}>
      <div className="stock-main">
        {/* HEADER (§12) */}
        <div className="page-head">
          <div className="page-head-titles">
            <h2 className="page-title">Stock</h2>
            <p className="page-sub">Kontrol stok, pencadangan, dan restock seluruh produk</p>
          </div>
          <div className="stok-head-actions">
            <button className="btn-secondary" onClick={() => downloadStockCsv().catch((e) => showToast(e.message, 'err'))}>
              <Icon name="download" size={15} /> Export CSV
            </button>
            <button className="btn-add" onClick={() => setBulkRestockOpen(true)}>
              <Icon name="upload" size={15} /> Bulk Restock
            </button>
          </div>
        </div>

        {/* KPI (§14-16) */}
        <StockStats stats={stats} />

        {/* HEALTH TABS (§9) — hanya Semua / Menipis / Habis */}
        <div className="chips stok-health-tabs">
          {HEALTH_FILTERS.map((f) => (
            <button key={f.key} className={`chip ${!reservedView && healthFilter === f.key ? 'active' : ''}`}
              onClick={() => { setReservedView(false); setHealthFilter(f.key); }}>
              {f.label} <span className="chip-count">{healthCount(products, f.key)}</span>
            </button>
          ))}
        </div>

        {/* ATTENTION STRIPS (§10) — red (habis) lalu yellow (dicadangkan), stacked */}
        {stats && stats.outOfStockCount > 0 && (
          <div className="stok-strip stok-strip-red">
            <span className="stok-strip-text"><Icon name="warning" size={15} /> {stats.outOfStockCount} produk kehabisan stok</span>
            <button className="stok-strip-link" onClick={() => { setReservedView(false); setHealthFilter('out'); }}>Lihat Produk</button>
          </div>
        )}
        {stats && stats.totalReserved > 0 && (
          <div className="stok-strip stok-strip-yellow">
            <span className="stok-strip-text"><Icon name="clock" size={15} /> {reservedProductCount} produk memiliki stok dicadangkan</span>
            <button className="stok-strip-link" onClick={() => { setHealthFilter('all'); setReservedView(true); }}>Lihat Produk</button>
          </div>
        )}
        {reservedView && (
          <div className="stok-reserved-view-note">
            <span>Menampilkan produk dengan stok dicadangkan</span>
            <button className="stok-strip-link" onClick={() => setReservedView(false)}>Tampilkan semua</button>
          </div>
        )}

        {/* TOOLBAR (§21-26) */}
        <div className="prod-toolbar">
          <div className="search prod-search">
            <span className="search-icon"><Icon name="search" size={15} /></span>
            <input placeholder="Cari produk / ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select-field" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">Semua Kategori</option>
            {sortedCategories.map((c) => <option key={c.id} value={c.id}>{c.name_id}</option>)}
          </select>
          <select className="select-field" value={stockTypeFilter} onChange={(e) => setStockTypeFilter(e.target.value)}>
            {STOCK_TYPE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className="select-field" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>

        {/* INVENTORY TABLE (desktop) */}
        {loading && !data ? (
          <div className="panel no-pad"><SkeletonTable rows={8} cols={7} /></div>
        ) : rows.length === 0 ? (
          <div className="panel"><div className="empty">Tidak ada produk pada filter ini.</div></div>
        ) : (
          <>
            <div className="panel no-pad stok-table-card">
              <StockTable rows={rows} selectedId={selectedProductId} onSelect={openDetail} />
            </div>
            {/* MOBILE cards */}
            <MobileStockList rows={rows} selectedId={selectedProductId} onSelect={openDetail} />
          </>
        )}
      </div>

      {/* STOCK DETAIL DOCK (§37-49) */}
      <aside className="stock-detail-dock" aria-hidden={!dockOpen}>
        {dockOpen && detailMode === 'detail' && (
          <StockDetail
            product={selectedProduct}
            onClose={closeDetail}
            onManageStock={() => setDetailMode('manage')}
            onViewReserved={() => setReservedModalProduct(selectedProduct)}
          />
        )}
        {dockOpen && detailMode === 'manage' && (
          <div className="dock-panel">
            <div className="dock-head">
              <button className="dock-back" onClick={() => setDetailMode('detail')} aria-label="Kembali ke detail stok">
                <Icon name="arrow-back" />
              </button>
              <h3>Kelola Stok</h3>
              <button className="x" onClick={closeDetail} aria-label="Tutup kelola stok"><Icon name="x" /></button>
            </div>
            <div className="dock-body">
              <div className="stok-manage-context">{selectedProduct.name_id}</div>
              <StockManagerContent prod={selectedProduct} toast={showToast} onChanged={load} />
            </div>
          </div>
        )}
      </aside>

      {/* RESERVED MODAL (Lihat Semua) */}
      {reservedModalProduct && (
        <ReservedModal product={reservedModalProduct} onClose={() => setReservedModalProduct(null)} />
      )}

      {/* BULK RESTOCK */}
      {bulkRestockOpen && (
        <BulkRestockDialog products={products} categories={sortedCategories}
          onClose={() => setBulkRestockOpen(false)} toast={showToast}
          onDone={() => { setBulkRestockOpen(false); load(); }} />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
