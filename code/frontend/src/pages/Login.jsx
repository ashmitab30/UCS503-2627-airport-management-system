import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { styles } from '../styles.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.authShell}>
      {/* Left visual avionics brand column */}
      <div style={styles.authLeft}>
        <div className="map-dots-dark" />
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={styles.authLogoRow}>
            <div style={styles.authLogoBadge}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>
                flight_takeoff
              </span>
            </div>
            <div>
              <div style={styles.authBrand}>Meridian Ops</div>
              <div style={styles.authBrandSub}>AERONAUTICAL OPERATIONS PLATFORM</div>
            </div>
          </div>

          <div style={{ marginTop: '5rem' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '999px',
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                backdropFilter: 'blur(10px)',
                color: '#c4e7ff',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '1.2rem',
              }}
            >
              <span className="pulse-radar-dot" />
              <span>Avionics Live Sync</span>
            </div>
            <h1 style={styles.authHeadline}>
              High-altitude clarity and precision airport operations.
            </h1>
            <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '1rem', marginTop: '1.2rem', maxWidth: 440, lineHeight: 1.6 }}>
              A unified system for air traffic dispatch, turnaround management, gate allocations, and passenger flight booking.
            </p>
          </div>
        </div>

        <div style={{ ...styles.authFootRow, position: 'relative', zIndex: 2 }}>
          <span>Meridian Aviation Group &middot; Release v3.0</span>
          <span>AeroSphere Precision HUD</span>
        </div>
      </div>

      {/* Right sign-in card */}
      <div style={styles.authRight}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
          <span
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              fontSize: '12px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              letterSpacing: '0.03em',
            }}
          >
            SIGN IN
          </span>
          <Link
            to="/register"
            style={{
              padding: '6px 16px',
              borderRadius: '999px',
              backgroundColor: 'var(--color-surface-low)',
              color: 'var(--color-on-surface-variant)',
              fontSize: '12px',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
          >
            CREATE ACCOUNT
          </Link>
        </div>

        <h2 style={styles.authHeading}>Welcome back</h2>
        <p style={styles.authSubheading}>Enter your credentials to access your dispatch dashboard.</p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} onSubmit={handleSubmit}>
          <div>
            <label style={styles.label}>
              <span>Email Address</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    position: 'absolute',
                    left: '14px',
                    color: 'var(--color-outline)',
                    fontSize: '20px',
                    pointerEvents: 'none',
                  }}
                >
                  mail
                </span>
                <input
                  style={{ ...styles.input, width: '100%', paddingLeft: '44px' }}
                  type="email"
                  placeholder="passenger@meridianops.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </label>
          </div>

          <div>
            <label style={styles.label}>
              <span>Access Key / Password</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    position: 'absolute',
                    left: '14px',
                    color: 'var(--color-outline)',
                    fontSize: '20px',
                    pointerEvents: 'none',
                  }}
                >
                  lock
                </span>
                <input
                  style={{ ...styles.input, width: '100%', paddingLeft: '44px', paddingRight: '44px' }}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-outline)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                  }}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </label>
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button style={styles.authFullButton} type="submit" disabled={submitting}>
            <span>{submitting ? 'Authenticating…' : 'Sign In'}</span>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              arrow_forward
            </span>
          </button>
        </form>

        <p style={styles.authFootnote}>
          Need a passenger account? <Link to="/register" style={{ fontWeight: 700 }}>Register here</Link>. Staff credentials are provisioned by airport administrators.
        </p>
      </div>
    </div>
  );
}
