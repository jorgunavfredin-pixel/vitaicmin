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
