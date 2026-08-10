export function TimelineItem({ label, time, ok, danger, last }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  return (
    <div className={`tl-item ${last ? 'tl-last' : ''}`}>
      <span className={`tl-dot ${ok ? 'ok' : ''} ${danger ? 'danger' : ''}`} />
      <div className="tl-content">
        <span className="tl-label">{label}</span>
        <span className="tl-time">{fmt(time)}</span>
      </div>
    </div>
  );
}
