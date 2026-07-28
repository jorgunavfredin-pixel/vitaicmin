import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, resetForgottenPassword, setToken } from '../api.js';
import Icon from '../components/Icons.jsx';

function PasswordField({ label, value, onChange, placeholder = '••••••••', autoFocus = false }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-input">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" />
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
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submitLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { token } = await login(password);
      setToken(token); navigate('/', { replace: true });
    } catch (err) { setError(err.message || 'Login gagal'); }
    finally { setLoading(false); }
  };

  const submitRecovery = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    if (next.length < 10) return setError('Password baru minimal 10 karakter');
    if (next !== confirm) return setError('Konfirmasi password tidak cocok');
    setLoading(true);
    try {
      const result = await resetForgottenPassword(recovery, next);
      setSuccess(result.message); setRecovery(''); setNext(''); setConfirm('');
      setTimeout(() => { setMode('login'); setSuccess(''); }, 1500);
    } catch (err) { setError(err.message || 'Reset password gagal'); }
    finally { setLoading(false); }
  };

  const switchMode = (nextMode) => {
    setMode(nextMode); setError(''); setSuccess(''); setPassword('');
  };

  return (
    <div className="login-wrap">
      <div className="login-glow" />
      <form className="login-card" onSubmit={mode === 'login' ? submitLogin : submitRecovery}>
        <div className="login-logo"><Icon name={mode === 'login' ? 'flash' : 'shield'} size={28} stroke={2.2} /></div>
        <h1 className="login-title">{mode === 'login' ? 'Store Admin' : 'Pulihkan Password'}</h1>
        <p className="login-sub">{mode === 'login'
          ? 'Masuk untuk mengelola toko kamu'
          : 'Gunakan recovery password ADMIN_PANEL_PASSWORD dari .env'}</p>

        {mode === 'login' ? <>
          <PasswordField label="Password Admin" value={password} onChange={setPassword} autoFocus />
          <button type="button" className="login-link" onClick={() => switchMode('recovery')}>Lupa password?</button>
        </> : <div className="login-recovery-fields">
          <PasswordField label="Recovery Password (.env)" value={recovery} onChange={setRecovery} autoFocus />
          <PasswordField label="Password Baru (min. 10 karakter)" value={next} onChange={setNext} />
          <PasswordField label="Konfirmasi Password Baru" value={confirm} onChange={setConfirm} />
        </div>}

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        <button className="btn-primary" disabled={loading || (mode === 'login' ? !password : !recovery || !next || !confirm)}>
          {loading ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Reset Password'}
        </button>
        {mode === 'recovery' &&
          <button type="button" className="login-link login-link-center" onClick={() => switchMode('login')}>Kembali ke login</button>}
      </form>
    </div>
  );
}
