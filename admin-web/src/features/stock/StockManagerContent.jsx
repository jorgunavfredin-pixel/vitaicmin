import { useEffect, useState, useCallback } from 'react';
import { fetchStock, addStock, deleteStockItem, clearStock } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { stockTypeLabel, fmtDate } from '../../pages/products/utils.jsx';
import ConfirmDeleteModal from '../../pages/products/modals/ConfirmDeleteModal.jsx';

/**
 * Isi manajemen stok TANPA scrim/aside — dipakai:
 *  - ProductWorkspace mode "stock" (embed langsung di dock)
 *  - StockDrawer.jsx (wrapper scrim+aside lama, untuk halaman Stock)
 * Logika/endpoint SAMA PERSIS dengan StockDrawer lama. Confirm clear/delItem
 * tetap modal (destruktif — §4 spec).
 * props: prod, toast, onChanged
 */
export default function StockManagerContent({ prod, toast, onChanged }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('available');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('list'); // 'list' | 'add'
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchStock(prod.id, { filter, q })
      .then((d) => { setData(d); setErr(''); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [prod.id, filter, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const refresh = () => { load(); onChanged?.(); };

  const doAdd = async () => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return toast('Masukkan minimal 1 baris data stok', 'err');
    setBusy(true);
    try {
      const r = await addStock(prod.id, lines);
      toast(r.message);
      setBulkText('');
      setMode('list');
      setFilter('available');
      refresh();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  const doDeleteItem = async (stockId) => {
    setBusy(true);
    try { const r = await deleteStockItem(prod.id, stockId); toast(r.message); refresh(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); setConfirm(null); }
  };

  const doClear = async () => {
    setBusy(true);
    try { const r = await clearStock(prod.id); toast(r.message); refresh(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); setConfirm(null); }
  };

  const c = data?.counts || {};

  return (
    <>
      {/* Stock summary — 4 compact horizontal cards */}
      <div className="stock-summary sm-cards">
        <div className="ss-item"><span className="ss-val" style={{ color: 'var(--green)' }}>{c.available ?? 0}</span><span className="ss-lbl">Available</span></div>
        <div className="ss-item"><span className="ss-val" style={{ color: 'var(--amber)' }}>{c.reserved ?? 0}</span><span className="ss-lbl">Reserved</span></div>
        <div className="ss-item"><span className="ss-val" style={{ color: 'var(--brand)' }}>{c.sold ?? 0}</span><span className="ss-lbl">Sold</span></div>
        <div className="ss-item"><span className="ss-val">{c.all ?? 0}</span><span className="ss-lbl">Total</span></div>
      </div>

      {mode === 'list' && (
        <div className="stock-actions">
          <button className="a-btn a-green btn-icon" onClick={() => setMode('add')}><Icon name="plus" size={15} /> Tambah Stok</button>
          <button className="a-btn a-red btn-icon" onClick={() => setConfirm({ type: 'clear' })} disabled={!c.available}><Icon name="trash" size={15} /> Kosongkan</button>
        </div>
      )}

      {mode === 'add' && (
        <div className="stock-form">
          <div className="sm-subhead">
            <button className="dock-back" onClick={() => { setMode('list'); setBulkText(''); }} aria-label="Kembali ke daftar stok"><Icon name="arrow-back" size={16} /></button>
            <span>Tambah Stok</span>
          </div>
          <label className="field-label">Tempel data stok (1 baris = 1 item)</label>
          <textarea rows={8} className="qty-field" style={{ resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }}
            placeholder={"email@mail.com|password123\nemail2@mail.com|password456"}
            value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            {bulkText.split('\n').map((l) => l.trim()).filter(Boolean).length} baris siap ditambahkan
          </div>
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn-ghost" onClick={() => { setMode('list'); setBulkText(''); }}>Batal</button>
            <button className="btn-primary" onClick={doAdd} disabled={busy}>{busy ? 'Memproses...' : 'Tambah Stok'}</button>
          </div>
        </div>
      )}

      {mode === 'list' && (
        <>
          <div className="stock-filter-bar">
            <div className="chips">
              {[['available', `Tersedia (${c.available ?? 0})`], ['reserved', `Reserve (${c.reserved ?? 0})`], ['sold', `Terjual (${c.sold ?? 0})`], ['all', `Semua (${c.all ?? 0})`]].map(([k, lbl]) => (
                <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{lbl}</button>
              ))}
            </div>
            <div className="search" style={{ marginTop: 10, maxWidth: '100%' }}>
              <span className="search-icon"><Icon name="search" size={15} /></span>
              <input placeholder="Cari data stok..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {err && <div className="empty error-panel">{err}</div>}
          {loading && !data ? (
            <div className="empty">Memuat stok...</div>
          ) : data && data.items.length === 0 ? (
            <div className="empty">Tidak ada item stok pada filter ini.</div>
          ) : (
            <div className="stock-list">
              {data?.items.map((s) => (
                <div key={s.id} className={`stock-item ${s.sold ? 'sold' : s.reserved_by ? 'reserved' : ''}`}>
                  <div className="stock-item-main">
                    <code className="stock-data">{s.data}</code>
                    <div className="stock-item-meta">
                      {s.sold ? (
                        <span className="badge st-paid badge-icon"><Icon name="coin" size={12} /> Terjual{s.order_id ? ` · ${s.order_id}` : ''}</span>
                      ) : s.reserved_by ? (
                        <span className="badge st-pending badge-icon"><Icon name="clock" size={12} /> Reserved · {s.reserved_by}</span>
                      ) : (
                        <span className="badge st-delivered badge-icon"><Icon name="check" size={12} /> Tersedia</span>
                      )}
                      <span className="stock-date"><Icon name="clock" size={12} /> {fmtDate(s.added_at)}</span>
                    </div>
                  </div>
                  {!s.sold && (
                    <button className="ic-btn ic-danger" title="Hapus item"
                      onClick={() => setConfirm({ type: 'delItem', id: s.id, data: s.data })}><Icon name="trash" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {confirm?.type === 'clear' && (
        <ConfirmDeleteModal
          title="Kosongkan Semua Stok Tersedia?"
          message={`${c.available} item stok yang belum terjual akan dihapus permanen. Stok terjual tidak terpengaruh.`}
          onClose={() => setConfirm(null)}
          onConfirm={doClear}
        />
      )}
      {confirm?.type === 'delItem' && (
        <ConfirmDeleteModal
          title="Hapus Item Stok Ini?"
          message={confirm.data}
          onClose={() => setConfirm(null)}
          onConfirm={() => doDeleteItem(confirm.id)}
        />
      )}
    </>
  );
}
