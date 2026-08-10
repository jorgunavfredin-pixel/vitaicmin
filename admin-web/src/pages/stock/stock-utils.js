// Formatters & helpers khusus Stock (Inventory Control Center).
// Dipakai lintas komponen stock. TIDAK mengubah data model/backend.

export const formatIDR = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));
export const compact = (n) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).replace('.', ':') + ' WIB' : '-';

export const STOCK_TYPES = {
  email_pass: 'Email | Pass', email_pass_key: 'Email | Pass | 2FA',
  code: 'Code / Pin', vcc: 'Card | Exp | CVV', custom: 'Custom Text'
};
export const stockTypeLabel = (t) => STOCK_TYPES[t] || t;

// Daftar filter tipe stok untuk dropdown toolbar (§24)
export const STOCK_TYPE_OPTIONS = [
  { id: 'all', label: 'Semua Tipe' },
  { id: 'email_pass', label: 'Email | Pass' },
  { id: 'email_pass_key', label: 'Email | Pass | 2FA' },
  { id: 'code', label: 'Code / Pin' },
  { id: 'vcc', label: 'Card | Exp | CVV' },
  { id: 'custom', label: 'Custom Text' }
];

export const byName = (a, b) => (a.name_id || '').localeCompare(b.name_id || '', 'id', { sensitivity: 'base' });

// Placeholder textarea sesuai stock_type (UI guidance, §58)
export const stockPlaceholder = (type) => ({
  email_pass: 'email@mail.com|password',
  email_pass_key: 'email@mail.com|password|2FAKEY',
  code: 'CODE-12345',
  vcc: 'card|exp|cvv',
  custom: 'custom text'
}[type] || 'email@mail.com|password');

// Health status → label + class semantik (§34)
export const HEALTH = {
  ok: { label: 'Aman', cls: 'st-delivered' },
  low: { label: 'Menipis', cls: 'st-pending' },
  out: { label: 'Habis', cls: 'st-cancelled' }
};

// Health filter tabs (§9) — hanya 3: Semua / Menipis / Habis
export const HEALTH_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'low', label: 'Menipis' },
  { key: 'out', label: 'Habis' }
];

// Sort options (§26)
export const SORT_OPTIONS = [
  { key: 'name_asc', label: 'Nama A-Z' },
  { key: 'name_desc', label: 'Nama Z-A' },
  { key: 'available_desc', label: 'Stok Terbanyak' },
  { key: 'available_asc', label: 'Stok Tersedikit' },
  { key: 'sold_30d_desc', label: 'Terjual 30D Terbanyak' },
  { key: 'sold_30d_asc', label: 'Terjual 30D Tersedikit' },
  { key: 'inventory_value_desc', label: 'Nilai Stok Tertinggi' },
  { key: 'inventory_value_asc', label: 'Nilai Stok Terendah' }
];
