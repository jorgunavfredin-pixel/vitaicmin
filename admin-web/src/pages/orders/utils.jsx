export const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '-';
// Waktu ringkas untuk card mobile: "25 Jul, 09.09"
export const fmtTimeShort = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
}) : '-';

export const STATUS = {
  pending: { label: 'Pending', cls: 'st-pending' },
  paid: { label: 'Dibayar', cls: 'st-paid' },
  delivered: { label: 'Terkirim', cls: 'st-delivered' },
  cancelled: { label: 'Batal', cls: 'st-cancelled' },
  expired: { label: 'Kadaluarsa', cls: 'st-expired' },
  refunded: { label: 'Refund', cls: 'st-cancelled' },
  init: { label: 'Draft', cls: 'st-muted' },
  processing: { label: 'Proses', cls: 'st-pending' }
};
export const badge = (s) => {
  const m = STATUS[s] || { label: s, cls: 'st-muted' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
};

export const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'pending', label: 'Pending' },
  { key: 'delivered', label: 'Terkirim' },
  { key: 'expired', label: 'Kadaluarsa' },
  { key: 'cancelled', label: 'Batal' },
  { key: 'refunded', label: 'Refund' }
];
