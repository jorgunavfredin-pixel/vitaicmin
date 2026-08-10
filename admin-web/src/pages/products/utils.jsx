export const formatIDR = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
export const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace('.', ':') + ' WIB' : '-';

export const STOCK_TYPES = [
  { id: 'email_pass', label: 'Email | Pass' },
  { id: 'email_pass_key', label: 'Email | Pass | 2FA' },
  { id: 'code', label: 'Code / Pin' },
  { id: 'vcc', label: 'Card | Exp | CVV' },
  { id: 'custom', label: 'Custom Text' }
];
export const stockTypeLabel = (t) => (STOCK_TYPES.find((s) => s.id === t)?.label || t);
