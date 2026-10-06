import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { styles } from '../styles.js';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
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
      await register(name, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.authShell}>
      {/* Left visual column */}
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
              <span>Passenger Network</span>
            </div>
            <h1 style={styles.authHeadline}>
              Seamless flight booking & real-time passenger care.
            </h1>
            <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '1rem', marginTop: '1.2rem', maxWidth: 440, lineHeight: 1.6 }}>
              Register your passenger account to search schedules, pick your seat on our interactive aircraft deck, and track turnaround dispatches.
            </p>
          </div>
        </div>

        <div style={{ ...styles.authFootRow, position: 'relative', zIndex: 2 }}>
          <span>Passenger Clearance Portal</span>
          <span>Meridian Aviation Group</span>
        </div>
      </div>

      {/* Right form card */}
      <div style={styles.authRight}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
          <Link
            to="/login"
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
            SIGN IN
          </Link>
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
            CREATE ACCOUNT
          </span>
        </div>

        <h2 style={styles.authHeading}>Create Passenger ID</h2>
        <p style={styles.authSubheading}>
          Register to book seamless travel across our aviation network.
        </p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} onSubmit={handleSubmit}>
          <div>
            <label style={styles.label}>
              <span>Full Name</span>
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
                  badge
                </span>
                <input
                  style={{ ...styles.input, width: '100%', paddingLeft: '44px' }}
                  placeholder="e.g. Alex Vance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </label>
          </div>

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
                  placeholder="alex.vance@meridianops.com"
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
              <span>Create Secure Password</span>
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
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
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
            <span>{submitting ? 'Registering Passenger…' : 'Register Account'}</span>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              arrow_forward
            </span>
          </button>
        </form>

        <p style={styles.authFootnote}>
          Already registered? <Link to="/login" style={{ fontWeight: 700 }}>Sign in</Link>. Staff accounts are provisioned via the Admin Hub.
        </p>
      </div>
    </div>
  );
}
