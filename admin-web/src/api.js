// Tiny API client (fetch + JWT in localStorage) — no extra deps.

const TOKEN_KEY = 'admin_token';
const BASE = '/api/admin';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
export const isAuthed = () => !!getToken();

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

export const fetchDashboard = () => apiFetch('/dashboard');

// ---- Orders ----
export const fetchOrders = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return apiFetch('/orders' + (qs ? `?${qs}` : ''));
};
export const fetchOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}`);
export const redeliverOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}/redeliver`, { method: 'POST' });
export const replaceOrder = (id) => apiFetch(`/orders/${encodeURIComponent(id)}/replace`, { method: 'POST' });
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
