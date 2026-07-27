import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from '../api.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { label: 'Orders', icon: '🧾', soon: true },
  { label: 'Produk', icon: '📦', soon: true },
  { label: 'Stok', icon: '🧰', soon: true },
  { label: 'Users', icon: '👥', soon: true },
  { label: 'Saldo', icon: '💰', soon: true },
  { label: 'Voucher', icon: '🎟️', soon: true },
  { label: 'Broadcast', icon: '📣', soon: true },
  { label: 'Settings', icon: '⚙️', soon: true }
];

export default function Layout() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-logo">⚡</span>
          <span className="brand-name">Store Admin</span>
        </div>
        <nav className="nav">
          {NAV.map((item) =>
            item.soon ? (
              <span key={item.label} className="nav-item disabled" title="Segera hadir">
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
                <span className="soon-badge">soon</span>
              </span>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>
        <button className="logout" onClick={logout}>
          <span className="nav-icon">⏻</span> Keluar
        </button>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu">☰</button>
          <div className="topbar-title">Dashboard</div>
          <div className="topbar-right">
            <span className="dot" /> Online
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
