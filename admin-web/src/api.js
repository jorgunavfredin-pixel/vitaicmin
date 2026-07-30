// Tiny API client (fetch + JWT in localStorage) — no extra deps.

const TOKEN_KEY = 'admin_token';
const BASE = '/api/admin';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const isAuthed = () => {
  const token = getToken();
  if (!token) return false;
  try {
    const segment = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = segment.padEnd(Math.ceil(segment.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      clearToken();
      return false;
    }
    return true;
  } catch {
    clearToken();
    return false;
  }
};

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    if (!location.pathname.endsWith('/login')) location.href = '/admin/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request gagal (${res.status})`);
  return data;
}

export const login = (password) =>
  apiFetch('/login', { method: 'POST', body: JSON.stringify({ password }) });
export const resetPasswordToEnv = (recoveryPassword) =>
  apiFetch('/forgot-password', { method: 'POST', body: JSON.stringify({ recoveryPassword }) });

export const fetchDashboard = () => apiFetch('/dashboard');

export const toggleBanner = (enabled) => apiFetch('/settings/banner/toggle', { method: 'PATCH', body: JSON.stringify({ enabled }) });
export const uploadBanner = (data_url) => apiFetch('/settings/banner', { method: 'POST', body: JSON.stringify({ data_url }) });
export const deleteBanner = () => apiFetch('/settings/banner', { method: 'DELETE' });
export async function fetchBannerBlob() {
  const res = await fetch(BASE + '/settings/banner/file', { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('Preview banner gagal dimuat');
  return res.blob();
}

// ---- Orders ----
export const fetchOrders = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch('/orders' + (qs ? `?${qs}` : ''));
};
export const fetchOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}`);
export const redeliverOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}/redeliver`, { method: 'POST' });
export const replaceOrder = (id, count = 1) => apiFetch(`/orders/${encodeURIComponent(id)}/replace`, { method: 'POST', body: JSON.stringify({ count }) });
export const refundOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}/refund`, { method: 'POST' });
export const deleteOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });

export async function downloadOrdersCsv() {
  const res = await fetch(BASE + '/orders/export.csv', {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (!res.ok) throw new Error('Export gagal');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Categories ----
export const fetchCategories = () => apiFetch('/categories');
export const createCategory = (data) => apiFetch('/categories', { method: 'POST', body: JSON.stringify(data) });
export const updateCategory = (id, data) => apiFetch(`/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteCategory = (id) => apiFetch(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---- Products ----
export const fetchProducts = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch('/products' + (qs ? `?${qs}` : ''));
};
export const fetchProduct = (id) => apiFetch(`/products/${encodeURIComponent(id)}`);
export const createProduct = (data) => apiFetch('/products', { method: 'POST', body: JSON.stringify(data) });
export const updateProduct = (id, data) => apiFetch(`/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const toggleActiveProduct = (id) => apiFetch(`/products/${encodeURIComponent(id)}/toggle-active`, { method: 'PATCH' });
export const setFlashSale = (id, data) => apiFetch(`/products/${encodeURIComponent(id)}/flash-sale`, { method: 'POST', body: JSON.stringify(data) });
export const clearFlashSale = (id) => apiFetch(`/products/${encodeURIComponent(id)}/flash-sale`, { method: 'DELETE' });
export const setBulkDiscount = (id, tiers) => apiFetch(`/products/${encodeURIComponent(id)}/bulk-discount`, { method: 'POST', body: JSON.stringify({ tiers }) });
export const deleteProduct = (id) => apiFetch(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---- Product Stats (overview cards) ----
export const fetchProductStats = () => apiFetch('/products-stats');

// ---- Stock Management ----
export const fetchStock = (productId, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/products/${encodeURIComponent(productId)}/stock` + (qs ? `?${qs}` : ''));
};
export const addStock = (productId, lines) => apiFetch(`/products/${encodeURIComponent(productId)}/stock`, { method: 'POST', body: JSON.stringify({ lines }) });
export const deleteStockItem = (productId, stockId) => apiFetch(`/products/${encodeURIComponent(productId)}/stock/${encodeURIComponent(stockId)}`, { method: 'DELETE' });
export const removeLastStock = (productId, count) => apiFetch(`/products/${encodeURIComponent(productId)}/stock/remove-last`, { method: 'POST', body: JSON.stringify({ count }) });
export const clearStock = (productId) => apiFetch(`/products/${encodeURIComponent(productId)}/stock`, { method: 'DELETE' });
export const removeStockByData = (productId, lines) => apiFetch(`/products/${encodeURIComponent(productId)}/stock/remove-by-data`, { method: 'POST', body: JSON.stringify({ lines }) });

// ---- Stock Control Center ----
export const fetchStockOverview = () => apiFetch('/stock/overview');
export const fetchReservedDetail = (productId) => apiFetch(`/stock/${encodeURIComponent(productId)}/reserved`);
export const bulkRestock = (items) => apiFetch('/stock/bulk-restock', { method: 'POST', body: JSON.stringify({ items }) });

export async function downloadStockCsv() {
  const res = await fetch(BASE + '/stock/export.csv', {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (!res.ok) throw new Error('Export gagal');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stock_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Users & Balance ----
export const fetchUsers = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch('/users' + (qs ? `?${qs}` : ''));
};
export const fetchUserDetail = (id) => apiFetch(`/users/${encodeURIComponent(id)}`);
export const toggleBanUser = (id) => apiFetch(`/users/${encodeURIComponent(id)}/ban`, { method: 'PATCH' });
export const adjustUserBalance = (id, action, amount, note) =>
  apiFetch(`/users/${encodeURIComponent(id)}/balance`, { method: 'POST', body: JSON.stringify({ action, amount, note }) });

// ---- Vouchers ----
export const fetchVouchers = () => apiFetch('/vouchers');
export const createVoucher = (data) => apiFetch('/vouchers', { method: 'POST', body: JSON.stringify(data) });
export const deleteVoucher = (id) => apiFetch(`/vouchers/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---- Broadcast ----
export const fetchBroadcastTargets = () => apiFetch('/broadcast/targets');
export const previewBroadcast = (target, categoryId) =>
  apiFetch('/broadcast/preview', { method: 'POST', body: JSON.stringify({ target, categoryId }) });
export const startBroadcast = (payload) =>
  apiFetch('/broadcast', { method: 'POST', body: JSON.stringify(payload) });
export const fetchBroadcastStatus = (jobId) => apiFetch(`/broadcast/status/${encodeURIComponent(jobId)}`);

// ---- Settings ----
export const fetchSettings = () => apiFetch('/settings');

// ---- QRIS Custom ----
export const fetchQrisCustom = () => apiFetch('/qris-custom');
export const saveQrisCustom = (payload) => apiFetch('/qris-custom', { method: 'PUT', body: JSON.stringify(payload) });
export const uploadQrisCustom = (image) => apiFetch('/qris-custom/upload', { method: 'POST', body: JSON.stringify({ image }) });
export async function fetchAdminImage(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...options, headers });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Gagal memuat gambar'); }
  return URL.createObjectURL(await res.blob());
}
export const previewQrisCustom = (payload) => fetchAdminImage('/qris-custom/preview', { method: 'POST', body: JSON.stringify(payload) });
export const toggleSetting = (key, value) =>
  apiFetch('/settings/toggle', { method: 'PATCH', body: JSON.stringify({ key, value }) });
export const changeAdminPassword = (currentPassword, newPassword) =>
  apiFetch('/settings/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
export const updateStoreInfo = (data) =>
  apiFetch('/settings/store', { method: 'PUT', body: JSON.stringify(data) });

// ---- Payment Gateways ----
export const fetchGateways = () => apiFetch('/gateways');
export const createGateway = (data) => apiFetch('/gateways', { method: 'POST', body: JSON.stringify(data) });
export const updateGateway = (id, data) => apiFetch(`/gateways/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const checkGatewayDelete = (id) => apiFetch(`/gateways/${encodeURIComponent(id)}/delete-check`);
export const deleteGateway = (id) => apiFetch(`/gateways/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
export const testGateway = (id, creds) => apiFetch(`/gateways/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify(creds || {}) });


export async function downloadBackup() {
  const res = await fetch(BASE + '/settings/backup', {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (!res.ok) throw new Error('Backup gagal');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_${new Date().toISOString().slice(0, 10)}.db`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
