import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles } from '../../styles.js';

export default function StaffPassword() {
  const { token } = useAuth();
  const [codeRequested, setCodeRequested] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [requestingCode, setRequestingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [cooldown]);

  async function handleRequestCode() {
    setError(null);
    setSuccess(null);
    setRequestingCode(true);
    try {
      const res = await apiFetch('/auth/change-password/request', {
        method: 'POST',
        token,
      });
      setCodeRequested(true);
      setMaskedEmail(res.masked_email || res.message || 'your registered email');
      setSuccess(res.message || 'Confirmation code sent.');
      setCooldown(60);
    } catch (err) {
      setError(err.message || 'Could not send confirmation code.');
    } finally {
      setRequestingCode(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!code || code.trim().length !== 6) {
      return setError('Please enter the 6-digit confirmation code.');
    }
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('New password and confirmation do not match.');
    if (next === current) return setError('New password must be different from your current one.');
    setBusy(true);
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        token,
        body: { current_password: current, new_password: next, code: code.trim() },
      });
      setSuccess(res.message || 'Password changed successfully.');
      setCurrent('');
      setNext('');
      setConfirm('');
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.title}>Change password</h1>
      <p style={styles.subtitle}>
        For your security, a 6-digit confirmation code must be verified via your registered email before changing your password.
      </p>

      <div style={{ ...styles.card, maxWidth: '520px' }}>
        {!codeRequested ? (
          <div>
            <p style={{ fontSize: '14px', color: 'var(--color-slate)', marginBottom: '18px', lineHeight: 1.5 }}>
              Click below to send a single-use verification code to your operational email address.
            </p>
            {error && <p style={{ ...styles.error, marginBottom: '16px' }}>{error}</p>}
            {success && <p style={{ color: '#065f46', fontWeight: 700, marginBottom: '16px' }}>{success}</p>}
            <button
              type="button"
              onClick={handleRequestCode}
              className="btn-primary-aero"
              disabled={requestingCode}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
              <span>{requestingCode ? 'Sending verification code…' : 'Send confirmation code to my email'}</span>
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '12px 14px', background: 'rgba(29, 99, 255, 0.08)', borderRadius: '10px', borderLeft: '3px solid var(--color-primary)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                Verification code dispatched
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '2px' }}>
                A 6-digit code was sent to <strong style={{ color: 'var(--color-primary)' }}>{maskedEmail}</strong>. Valid for 10 minutes.
              </div>
            </div>

            <label style={styles.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Confirmation Code</span>
                <button
                  type="button"
                  onClick={handleRequestCode}
                  disabled={cooldown > 0 || requestingCode}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: cooldown > 0 ? 'var(--color-outline)' : 'var(--color-primary)',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: cooldown > 0 ? 'default' : 'pointer',
                    padding: 0,
                  }}
                >
                  {requestingCode ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
              <input
                style={{ ...styles.input, letterSpacing: '4px', fontWeight: 800, fontSize: '1.1rem' }}
                type="text"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>

            <label style={styles.label}>
              <span>Current password</span>
              <input
                style={styles.input}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>

            <label style={styles.label}>
              <span>New password</span>
              <input
                style={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </label>

            <label style={styles.label}>
              <span>Confirm new password</span>
              <input
                style={styles.input}
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </label>

            {error && <p style={{ ...styles.error, margin: 0 }}>{error}</p>}
            {success && <p style={{ margin: 0, color: '#065f46', fontWeight: 700 }}>{success}</p>}

            <button type="submit" className="btn-primary-aero" disabled={busy}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>lock_reset</span>
              <span>{busy ? 'Saving…' : 'Update password'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
