import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, setToken } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await login(password);
      setToken(token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-glow" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">⚡</div>
        <h1 className="login-title">Store Admin</h1>
        <p className="login-sub">Masuk untuk mengelola toko kamu</p>

        <label className="field">
          <span className="field-label">Password Admin</span>
          <div className="field-input">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
            />
            <button type="button" className="eye" onClick={() => setShow((v) => !v)}>
              {show ? '🙈' : '👁️'}
            </button>
          </div>
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="btn-primary" disabled={loading || !password}>
          {loading ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
