import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, resetPasswordToEnv, setToken, fetchBranding } from '../api.js';
import Icon from '../components/Icons.jsx';

function PasswordField({ label, value, onChange, autoFocus = false }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-input">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••" autoFocus={autoFocus} autoComplete="off" />
        <button type="button" className="eye" onClick={() => setShow((v) => !v)}>
          <Icon name={show ? 'eye-off' : 'eye'} size={17} />
        </button>
      </div>
    </label>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [branding, setBranding] = useState({ store_name: 'VITAICMIN', admin_label: 'STORE ADMIN' });

  useEffect(() => {
    fetchBranding().then((data) => setBranding({
      store_name: data?.store_name || 'VITAICMIN',
      admin_label: data?.admin_label || 'STORE ADMIN'
    })).catch(() => {});
  }, []);

  const submitLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { token } = await login(password);
      setToken(token); navigate('/', { replace: true });
    } catch (err) { setError(err.message || 'Login gagal'); }
    finally { setLoading(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true);
    try {
      const result = await resetPasswordToEnv(recovery);
      setSuccess(result.message); setRecovery('');
      setTimeout(() => { setMode('login'); setSuccess(''); }, 1500);
    } catch (err) { setError(err.message || 'Reset password gagal'); }
    finally { setLoading(false); }
  };

  const switchMode = (nextMode) => {
    setMode(nextMode); setError(''); setSuccess(''); setPassword(''); setRecovery('');
  };

  return (
    <div className="login-wrap">
      <div className="login-glow" />
      <div className="login-glow login-glow--b" />
      <form className="login-card" onSubmit={mode === 'login' ? submitLogin : submitReset}>
        <div className="login-logo"><Icon name={mode === 'login' ? 'flash' : 'shield'} size={26} stroke={2.2} /></div>
        <h1 className="login-title">{mode === 'login' ? branding.store_name : 'Reset Password'}</h1>
        <p className="login-sub">{mode === 'login'
          ? `${branding.admin_label} · Masuk untuk mengelola toko kamu`
          : 'Password custom database akan dihapus dan login kembali memakai ADMIN_PANEL_PASSWORD dari .env.'}</p>

        {mode === 'login' ? <>
          <PasswordField label="Password Admin" value={password} onChange={setPassword} autoFocus />
          <button type="button" className="login-link" onClick={() => switchMode('reset')}>Reset password</button>
        </> : <>
          <div className="settings-note hint-icon login-reset-note">
            <Icon name="warning" size={14} /> Masukkan ADMIN_PANEL_PASSWORD dari .env untuk mengonfirmasi reset. Semua sesi lama akan dicabut.
          </div>
          <PasswordField label="Password dari .env" value={recovery} onChange={setRecovery} autoFocus />
        </>}

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        <button className="btn-primary" disabled={loading || (mode === 'login' ? !password : !recovery)}>
          {loading ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Konfirmasi Reset'}
        </button>
        {mode === 'reset' &&
          <button type="button" className="login-link login-link-center" onClick={() => switchMode('login')}>Batal, kembali ke login</button>}
      </form>
    </div>
  );
}
