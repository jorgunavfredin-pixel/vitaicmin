import { useEffect, useState, useCallback } from 'react';
import {
  fetchProducts, fetchCategories, fetchProductStats,
  deleteCategory
} from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { formatIDR, compact, stockTypeLabel } from './utils.jsx';
import { StockPill, ProdStat } from './ProductCard.jsx';
import ProductWorkspace from './ProductWorkspace.jsx';
import CategoryFormModal from './modals/CategoryFormModal.jsx';
import ConfirmDeleteModal from './modals/ConfirmDeleteModal.jsx';

export default function Products() {
  const [activeTab, setActiveTab] = useState('products'); // 'products' | 'categories'
  const [categories, setCategories] = useState([]);
  const [productsData, setProductsData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  // Filters
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [catSearch, setCatSearch] = useState('');

  // ---- SINGLE PRODUCT WORKSPACE (§46) ----
  const [selectedProd, setSelectedProd] = useState(null); // id produk terpilih
  const [workspaceMode, setWorkspaceMode] = useState('detail'); // detail|edit|stock|flash|bulk|create
  const workspaceOpen = selectedProd != null || workspaceMode === 'create';

  // Kategori tetap modal (§41)
  const [categoryModal, setCategoryModal] = useState(null);
  const [deleteCatModal, setDeleteCatModal] = useState(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchCategories(),
      fetchProducts({ category_id: catFilter, status: statusFilter, q: searchQuery }),
      fetchProductStats().catch(() => null)
    ])
      .then(([cats, prods, st]) => {
        const byName = (a, b) => (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' });
        setCategories([...cats].sort(byName));
        if (prods && Array.isArray(prods.products)) {
          prods.products = [...prods.products].sort(byName);
        }
        setProductsData(prods);
        if (st) setStats(st);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [catFilter, statusFilter, searchQuery]);

  useEffect(() => {
    const t = setTimeout(loadData, searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadData, searchQuery]);

  useEffect(() => {
    const handleUpdate = () => loadData();
    window.addEventListener('product_updated', handleUpdate);
    return () => window.removeEventListener('product_updated', handleUpdate);
  }, [loadData]);

  // ---- Workspace helpers ----
  const openProduct = (id) => { setSelectedProd(id); setWorkspaceMode('detail'); };
  const openCreate = () => { setSelectedProd(null); setWorkspaceMode('create'); };
  const closeWorkspace = () => { setSelectedProd(null); setWorkspaceMode('detail'); };

  const counts = productsData?.counts || {};

  // Sort client-side (tampilan; backend sudah filter). TODO: pindah ke server untuk ordering global.
  const sortedProducts = productsData?.products ? [...productsData.products].sort((a, b) => {
    if (sort === 'price_high') return (b.price_idr || 0) - (a.price_idr || 0);
    if (sort === 'price_low') return (a.price_idr || 0) - (b.price_idr || 0);
    if (sort === 'stock_high') return (b.available_stock || 0) - (a.available_stock || 0);
    if (sort === 'sold_high') return (b.sold_stock || 0) - (a.sold_stock || 0);
    return (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' });
  }) : [];

  const selectedProduct = productsData?.products.find((p) => p.id === selectedProd) || null;

  // Ganti tab → tutup workspace (§8, §72)
  const switchTab = (tab) => { setActiveTab(tab); if (tab !== 'products') closeWorkspace(); };

  return (
    <div className={`products-workspace ${workspaceOpen ? 'dock-open' : ''}`}>
      <div className="products-main">
      {/* Header */}
      <div className="page-head">
        <div className="page-head-titles">
          <h2 className="page-title">Products</h2>
          <p className="page-sub">Kelola produk dan kategori toko</p>
        </div>
        {activeTab === 'products' ? (
          <button className="btn-add" onClick={openCreate}><Icon name="plus" size={15} /> Tambah Produk</button>
        ) : (
          <button className="btn-add" onClick={() => setCategoryModal({ mode: 'add' })}><Icon name="plus" size={15} /> Tambah Kategori</button>
        )}
      </div>

      {/* Sub-tabs underline */}
      <div className="ptabs">
        <button className={`ptab ${activeTab === 'products' ? 'active' : ''}`} onClick={() => switchTab('products')}>Produk</button>
        <button className={`ptab ${activeTab === 'categories' ? 'active' : ''}`} onClick={() => switchTab('categories')}>Kategori</button>
      </div>

      {/* Stat Cards */}
      {stats && activeTab === 'products' && (
        <div className="prod-stat-grid">
          <ProdStat icon="package" accent="blue" label="Total Produk" value={stats.totalProducts}
            sub={`${stats.activeProducts} aktif · ${stats.pausedProducts} paused`} />
          <ProdStat icon="check" accent="green" label="Produk Aktif" value={stats.activeProducts}
            sub={stats.totalProducts ? `${Math.round(stats.activeProducts / stats.totalProducts * 100)}% dari total` : '—'} />
          <ProdStat icon="box" accent="blue" label="Total Stok" value={compact(stats.totalStock)}
            sub={`${stats.totalSold} terjual (30h)`} />
          <ProdStat icon="warning" accent={stats.outOfStockCount > 0 ? 'red' : 'amber'} label="Stok Menipis"
            value={stats.lowStockCount + stats.outOfStockCount}
            sub={`${stats.outOfStockCount} habis · ${stats.lowStockCount} menipis`} />
        </div>
      )}

      {activeTab === 'products' && (
        <>
          {/* Toolbar: search + kategori + status + sort + view (§36) */}
          <div className="prod-toolbar">
            <div className="search prod-search">
              <span className="search-icon"><Icon name="search" size={15} /></span>
              <input placeholder="Cari produk…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <select className="select-field" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="all">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name_id} ({c.product_count})</option>
              ))}
            </select>
            <select className="select-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="paused">Nonaktif</option>
              <option value="flash">Flash Sale</option>
              <option value="outofstock">Stok Habis</option>
            </select>
            <select className="select-field" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Nama A-Z</option>
              <option value="price_high">Harga ↑</option>
              <option value="price_low">Harga ↓</option>
              <option value="stock_high">Stok Terbanyak</option>
              <option value="sold_high">Terlaris</option>
            </select>
          </div>

          {/* Content */}
          {error ? (
            <div className="panel"><div className="empty error-panel">{error}</div></div>
          ) : loading && !productsData ? (
            <div className="prod-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton-card" style={{ height: 190 }} />)}</div>
          ) : productsData && productsData.products.length === 0 ? (
            <div className="panel"><div className="empty">Tidak ada produk ditemukan</div></div>
          ) : (
            <div className="panel no-pad">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produk</th>
                      <th>Kategori</th>
                      <th>Harga</th>
                      <th>Stok</th>
                      <th title="Jumlah item terjual dalam 30 hari terakhir">Terjual</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((p) => (
                      <tr key={p.id} className={`row-click ${selectedProd === p.id ? 'row-active' : ''}`} onClick={() => openProduct(p.id)}>
                        <td data-label="Produk">
                          <div className="pt-name">{p.name_id}</div>
                          {p.name_en && <div className="pt-sub">{p.name_en}</div>}
                        </td>
                        <td data-label="Kategori"><span className="badge st-muted">{p.category_name_id}</span></td>
                        <td data-label="Harga">
                          {p.is_flash_active ? (
                            <div className="pt-price">
                              <span className="pt-price-was">{formatIDR(p.price_idr)}</span>
                              <b className="pt-price-flash">{formatIDR(p.flash_price)}</b>
                            </div>
                          ) : (
                            <b>{formatIDR(p.price_idr)}</b>
                          )}
                        </td>
                        <td data-label="Stok">
                          <StockPill count={p.available_stock} />
                        </td>
                        <td data-label="Terjual"><b>{p.sold_stock || 0}</b></td>
                        <td data-label="Status">
                          <span className={`badge status-dot ${p.active ? 'st-delivered' : 'st-expired'}`}>{p.active ? 'Aktif' : 'Nonaktif'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mobile product cards (clickable → full-screen workspace) */}
          {!error && sortedProducts.length > 0 && (
            <div className="pm-mobile-list">
              {sortedProducts.map((p) => (
                <div key={p.id} className={`pm-card ${selectedProd === p.id ? 'active' : ''}`} onClick={() => openProduct(p.id)}>
                  <div className="pm-card-thumb">{(p.name_id || '?').charAt(0).toUpperCase()}</div>
                  <div className="pm-card-body">
                    <div className="pm-card-top">
                      <div className="pm-card-name">{p.name_id}</div>
                      <span className={`badge ${p.active ? 'st-delivered' : 'st-expired'}`}>{p.active ? 'Aktif' : 'Off'}</span>
                    </div>
                    <div className="pm-card-cat">{p.category_name_id}</div>
                    <div className="pm-card-meta">
                      <b className="pm-card-price">{p.is_flash_active ? formatIDR(p.flash_price) : formatIDR(p.price_idr)}</b>
                      <span className="pm-card-stock">Stok: {p.available_stock}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'categories' && (() => {
        const totalProd = categories.reduce((s, c) => s + (c.product_count || 0), 0);
        const biggest = categories.reduce((m, c) => (c.product_count || 0) > (m?.product_count || 0) ? c : m, null);
        const filteredCats = catSearch.trim()
          ? categories.filter((c) => `${c.name_id} ${c.name_en || ''}`.toLowerCase().includes(catSearch.toLowerCase()))
          : categories;
        return (
          <>
            <div className="prod-stat-grid cat-stat-grid">
              <ProdStat icon="category" accent="blue" label="Total Kategori" value={categories.length} sub="Semua kategori" />
              <ProdStat icon="package" accent="green" label="Total Produk" value={totalProd} sub="Terkelompok" />
              <ProdStat icon="grid" accent="amber" label="Kategori Terbesar" value={biggest?.product_count || 0} sub={biggest?.name_id || '-'} />
            </div>

            <div className="prod-toolbar">
              <div className="search prod-search">
                <span className="search-icon"><Icon name="search" size={15} /></span>
                <input placeholder="Cari kategori…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} />
              </div>
            </div>

            <div className="panel no-pad orders-table-card">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kategori</th><th>Nama (EN)</th>
                      <th>Jumlah Produk</th><th>Produk Aktif</th><th style={{ textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCats.length === 0 ? (
                      <tr><td colSpan={5} className="empty">{catSearch ? 'Kategori tidak ditemukan.' : 'Belum ada kategori.'}</td></tr>
                    ) : (
                      filteredCats.map((c) => (
                        <tr key={c.id}>
                          <td data-label="Kategori">
                            <div className="cat-cell">
                              <span className="cat-cell-ico"><Icon name="category" size={16} /></span>
                              <b>{c.name_id}</b>
                            </div>
                          </td>
                          <td data-label="Nama (EN)" className="muted-cell">{c.name_en || '-'}</td>
                          <td data-label="Jumlah Produk"><b>{c.product_count}</b> produk</td>
                          <td data-label="Produk Aktif"><span className="badge st-delivered">{c.active_product_count} aktif</span></td>
                          <td data-label="Aksi" style={{ textAlign: 'right' }}>
                            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="ic-btn" onClick={() => setCategoryModal({ mode: 'edit', cat: c })} title="Edit"><Icon name="edit" /></button>
                              <button className="ic-btn ic-danger" onClick={() => setDeleteCatModal(c)} title="Hapus"><Icon name="trash" /></button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile category cards */}
            <div className="pm-mobile-list">
              {filteredCats.length === 0 ? (
                <div className="empty">{catSearch ? 'Kategori tidak ditemukan.' : 'Belum ada kategori.'}</div>
              ) : filteredCats.map((c) => (
                <div key={c.id} className="pm-card pm-cat-card">
                  <div className="pm-card-thumb pm-cat-thumb"><Icon name="category" size={17} /></div>
                  <div className="pm-card-body">
                    <div className="pm-card-top">
                      <div className="pm-card-name">{c.name_id}</div>
                      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="ic-btn" onClick={() => setCategoryModal({ mode: 'edit', cat: c })} title="Edit"><Icon name="edit" /></button>
                        <button className="ic-btn ic-danger" onClick={() => setDeleteCatModal(c)} title="Hapus"><Icon name="trash" /></button>
                      </div>
                    </div>
                    <div className="pm-card-cat">{c.product_count} produk · {c.active_product_count} aktif</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* MODALS — hanya kategori (§41) & destruktif kategori (§4) */}
      {categoryModal && (
        <CategoryFormModal data={categoryModal.cat} onClose={() => setCategoryModal(null)}
          onSaved={(msg) => { showToast(msg); setCategoryModal(null); loadData(); }} />
      )}
      {deleteCatModal && (
        <ConfirmDeleteModal
          title={`Hapus Kategori ${deleteCatModal.name_id}?`}
          message={deleteCatModal.product_count > 0
            ? `Kategori masih memiliki ${deleteCatModal.product_count} produk. Pindahkan produknya terlebih dahulu; kategori tidak akan dihapus.`
            : 'Kategori kosong ini akan dihapus permanen.'}
          onClose={() => setDeleteCatModal(null)}
          onConfirm={async () => {
            try { const r = await deleteCategory(deleteCatModal.id); showToast(r.message); setDeleteCatModal(null); loadData(); }
            catch (e) { showToast(e.message, 'err'); }
          }}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
      </div>{/* /products-main */}

      {/* SINGLE PRODUCT WORKSPACE (desktop dock / mobile full-screen) */}
      <aside className="product-detail-dock" aria-hidden={!workspaceOpen}>
        {workspaceOpen && (
          <ProductWorkspace
            product={selectedProduct}
            mode={workspaceMode}
            categories={categories}
            setMode={setWorkspaceMode}
            toast={showToast}
            reload={loadData}
            onClose={closeWorkspace}
            onDeleted={() => { closeWorkspace(); loadData(); }}
          />
        )}
      </aside>
    </div>
  );
}
