import { useEffect, useMemo, useRef, useState } from 'react';
import { bulkRestock } from '../../api.js';
import Icon from '../../components/Icons.jsx';
import { byName, stockTypeLabel, stockPlaceholder } from './stock-utils.js';

// Dark product picker (§55) — search + grup kategori A-Z, exclude selected.
function ProductPicker({ products, categories, excludeIds, onPick }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const groups = useMemo(() => {
    const q = search.toLowerCase().trim();
    const avail = products.filter((p) => !excludeIds.includes(p.id) &&
      (!q || p.name_id.toLowerCase().includes(q) || (p.name_en || '').toLowerCase().includes(q)));
    const result = [];
    for (const c of categories) {
      const items = avail.filter((p) => p.category_id === c.id).sort(byName);
      if (items.length) result.push({ id: c.id, name: c.name_id, items });
    }
    const noCat = avail.filter((p) => !categories.some((c) => c.id === p.category_id)).sort(byName);
    if (noCat.length) result.push({ id: '_none', name: 'Tanpa Kategori', items: noCat });
    return result;
  }, [products, categories, excludeIds, search]);

  return (
    <div className="picker stok-picker" ref={ref}>
      <button type="button" className="picker-trigger" onClick={() => setOpen((v) => !v)}>
        <span>+ Pilih produk untuk ditambahkan…</span>
        <Icon name="chevron" size={16} className={`chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="picker-panel">
          <div className="picker-search">
            <Icon name="search" size={15} />
            <input autoFocus placeholder="Cari produk…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="picker-list">
            {groups.length === 0 ? (
              <div className="picker-empty">Tidak ada produk.</div>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="picker-group">
                  <div className="picker-group-head">{g.name}</div>
                  {g.items.map((p) => (
                    <button key={p.id} type="button" className="picker-option"
                      onClick={() => { onPick(p); setOpen(false); setSearch(''); }}>
                      <span className="picker-opt-name">{p.name_id}</span>
                      <span className="picker-opt-stock">{stockTypeLabel(p.stock_type)}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const countLines = (val) => val.split('\n').map((l) => l.trim()).filter(Boolean).length;

// BULK RESTOCK (§53-60) — dark modal, logika port dari Stock.jsx lama (payload sama).
export default function BulkRestockDialog({ products, categories, onClose, toast, onDone }) {
  const [entries, setEntries] = useState([]); // { product_id, name_id, stock_type, lines }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addEntry = (p) => {
    if (entries.some((e) => e.product_id === p.id)) { toast('Produk sudah ada di daftar', 'err'); return; }
    setEntries((prev) => [...prev, { product_id: p.id, name_id: p.name_id, stock_type: p.stock_type, lines: '' }]);
  };
  const updateLines = (pid, val) => setEntries((prev) => prev.map((e) => e.product_id === pid ? { ...e, lines: val } : e));
  const removeEntry = (pid) => setEntries((prev) => prev.filter((e) => e.product_id !== pid));

  const totalLines = entries.reduce((sum, e) => sum + countLines(e.lines), 0);

  const submit = async () => {
    const payload = entries
      .map((e) => ({ product_id: e.product_id, lines: e.lines.split('\n').map((l) => l.trim()).filter(Boolean) }))
      .filter((e) => e.lines.length > 0);
    if (payload.length === 0) { toast('Isi minimal 1 baris stok di salah satu produk', 'err'); return; }
    setBusy(true);
    try {
      const r = await bulkRestock(payload);
      let msg = r.message || 'Restock selesai';
      if (Array.isArray(r.results) && r.results.length) {
        const added = r.results.reduce((s, x) => s + (x.added || x.count || 0), 0);
        if (added) msg = `${r.message || 'Restock selesai'}`;
      }
      toast(msg);
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim stok-bulk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="stok-bulk-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="stok-bulk-head">
          <h3 className="h3-icon"><Icon name="upload" size={18} /> Bulk Restock</h3>
          <button className="x" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="stok-bulk-body">
          <p className="stok-modal-note">
            Tambah stok ke beberapa produk sekaligus. Pilih produk (dikelompokkan per kategori), lalu tempel data stok (1 baris = 1 item).
          </p>

          <ProductPicker products={products} categories={categories}
            excludeIds={entries.map((e) => e.product_id)} onPick={addEntry} />

          {entries.length === 0 ? (
            <div className="empty stok-bulk-empty">Belum ada produk dipilih.</div>
          ) : (
            <div className="stok-bulk-entries">
              {entries.map((e) => {
                const n = countLines(e.lines);
                return (
                  <div key={e.product_id} className="stok-bulk-entry">
                    <div className="stok-bulk-entry-head">
                      <div>
                        <b>{e.name_id}</b>
                        <span className="stok-bulk-entry-type">{stockTypeLabel(e.stock_type)}</span>
                      </div>
                      <button className="ic-btn ic-danger" onClick={() => removeEntry(e.product_id)}><Icon name="trash" size={15} /></button>
                    </div>
                    <textarea rows={4} className="qty-field stok-bulk-textarea"
                      placeholder={stockPlaceholder(e.stock_type)}
                      value={e.lines} onChange={(ev) => updateLines(e.product_id, ev.target.value)} />
                    <div className="stok-bulk-count">{n} item terdeteksi</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="stok-bulk-foot">
          <div className="stok-bulk-summary">{entries.length} produk · {totalLines} item</div>
          <div className="stok-bulk-foot-btns">
            <button className="btn-ghost" onClick={onClose}>Batal</button>
            <button className="btn-add" onClick={submit} disabled={busy || totalLines === 0}>
              {busy ? 'Memproses…' : `Restock ${totalLines} Item`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
