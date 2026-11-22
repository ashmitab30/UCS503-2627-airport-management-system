import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles } from '../../styles.js';

export default function StaffPassword() {
  const { token } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('New password and confirmation do not match.');
    if (next === current) return setError('New password must be different from your current one.');
    setBusy(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        token,
        body: { current_password: current, new_password: next },
      });
      setSuccess('Password changed successfully.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Change password</h1>
      <p style={styles.subtitle}>If an administrator gave you a temporary password, please replace it with your own.</p>
      <div style={{ ...styles.card, maxWidth: '480px' }}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={styles.label}>
            Current password
            <input style={styles.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label style={styles.label}>
            New password
            <input style={styles.input} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Confirm new password
            <input style={styles.input} type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {error && <p style={{ ...styles.error, margin: 0 }}>{error}</p>}
          {success && <p style={{ margin: 0, color: '#065f46', fontWeight: 700 }}>{success}</p>}
          <button type="submit" className="btn-primary-aero" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
        </form>
      </div>
    </div>
  );
}
