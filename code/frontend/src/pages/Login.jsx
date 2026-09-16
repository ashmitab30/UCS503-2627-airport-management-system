import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { styles } from '../styles.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      <div style={styles.authLeft}>
        <div style={styles.authLogoRow}>
          <div style={styles.authLogoBadge}>AM</div>
          <div>
            <div style={styles.authBrand}>Airport Ops</div>
            <div style={styles.authBrandSub}>OPERATIONS PLATFORM</div>
          </div>
        </div>

        <h1 style={styles.authHeadline}>
          One system for gates, flights, and ground crew.
        </h1>

        
      </div>

      <div style={styles.authRight}>
        <h2 style={styles.authHeading}>Sign in</h2>
        <p style={styles.authSubheading}>Enter your credentials to reach your dashboard.</p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }} onSubmit={handleSubmit}>
          <label style={styles.label}>
            Email address
            <input
              style={styles.input}
              type="email"
              placeholder="you@airport.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.authFullButton} type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={styles.authFootnote}>
          No account? <Link to="/register">Register as a passenger</Link>. Staff accounts are created by an admin.
        </p>
      </div>
    </div>
  );
}
