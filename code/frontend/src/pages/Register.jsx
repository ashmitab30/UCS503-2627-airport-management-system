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
      <div style={styles.authLeft}>
        <div style={styles.authLogoRow}>
          <div style={styles.authLogoBadge}>AM</div>
          <div>
            <div style={styles.authBrand}>Airport Ops</div>
            <div style={styles.authBrandSub}>OPERATIONS PLATFORM</div>
          </div>
        </div>

        <h1 style={styles.authHeadline}>
          Book, track, and manage your flight in one place.
        </h1>

        <div style={styles.authFootRow}>
          <span>Passenger accounts</span>
          <span>Week 3 build</span>
        </div>
      </div>

      <div style={styles.authRight}>
        <h2 style={styles.authHeading}>Create your account</h2>
        <p style={styles.authSubheading}>
          This form creates a passenger account. Staff accounts (ground crew, security,
          medical, ops manager, admin) are created by an admin.
        </p>

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }} onSubmit={handleSubmit}>
          <label style={styles.label}>
            Name
            <input style={styles.input} placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
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
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.authFullButton} type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={styles.authFootnote}>
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
