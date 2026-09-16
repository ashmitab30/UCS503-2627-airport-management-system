import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProtectedRoute from './pages/ProtectedRoute.jsx';
import { styles } from './styles.js';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HealthCheck />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

// Kept from Week 1 as the landing page — still a useful "is the backend
// up" smoke test, now also links into the Week 2 auth flow.
function HealthCheck() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Airport Management System</h1>
      <p style={styles.subtitle}>Week 3 — Ops Core: flights, gates, turnaround, resources</p>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>API status</h2>
        {error && <p style={styles.error}>Could not reach backend: {error}</p>}
        {!error && !health && <p>Checking...</p>}
        {health && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Database connected</dt>
            <dd>{String(health.db?.connected)}</dd>
            {health.db?.error && <>
              <dt>DB note</dt>
              <dd>{health.db.error}</dd>
            </>}
          </dl>
        )}
      </div>

      <div style={styles.card}>
        {user ? (
          <p><Link to="/dashboard">Go to your dashboard</Link> (signed in as {user.email})</p>
        ) : (
          <p>
            <Link to="/login">Sign in</Link> or <Link to="/register">create a passenger account</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
