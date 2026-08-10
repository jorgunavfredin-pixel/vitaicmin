// Pagination: prev5 ‹‹ · prev ‹ · 1 2 3 4 5 … last · › next · ›› next5
export default function Pagination({ page, totalPages, onPage }) {
  const go = (p) => onPage(Math.min(totalPages, Math.max(1, p)));

  // Susun nomor halaman dengan ellipsis: selalu 1, last, dan window sekitar current
  const pages = [];
  const win = 2; // jumlah tetangga kiri-kanan
  const add = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };
  add(1);
  for (let p = page - win; p <= page + win; p++) add(p);
  add(totalPages);
  pages.sort((a, b) => a - b);
  // sisipkan ellipsis
  const items = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) items.push('…');
    items.push(p);
    prev = p;
  }

  return (
    <div className="pagination">
      <button className="pg-btn" disabled={page <= 1} onClick={() => go(page - 5)} title="Mundur 5 halaman" aria-label="Mundur 5 halaman">«</button>
      <button className="pg-btn" disabled={page <= 1} onClick={() => go(page - 1)} title="Sebelumnya" aria-label="Sebelumnya">‹</button>
      {items.map((it, i) =>
        it === '…'
          ? <span key={`e${i}`} className="pg-ellipsis">…</span>
          : <button key={it} className={`pg-num ${it === page ? 'active' : ''}`} onClick={() => go(it)}>{it}</button>
      )}
      <button className="pg-btn" disabled={page >= totalPages} onClick={() => go(page + 1)} title="Berikutnya" aria-label="Berikutnya">›</button>
      <button className="pg-btn" disabled={page >= totalPages} onClick={() => go(page + 5)} title="Maju 5 halaman" aria-label="Maju 5 halaman">»</button>
    </div>
  );
}
