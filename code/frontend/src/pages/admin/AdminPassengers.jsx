import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles, colors } from '../../styles.js';

export default function AdminPassengers() {
  const { token } = useAuth();
  const [passengers, setPassengers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/bookings/passengers/all', { token })
      .then((d) => setPassengers(d.passengers))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <h1 style={styles.title}>Passengers</h1>
      {error && <p style={styles.error}>{error}</p>}
      {!error && passengers === null && <p style={styles.muted}>Loading…</p>}
      {passengers && (
        <div style={styles.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `1px solid ${colors.line}` }}>
                <th style={{ padding: '0.5rem' }}>Name</th>
                <th style={{ padding: '0.5rem' }}>Email</th>
                <th style={{ padding: '0.5rem' }}>Bookings</th>
                <th style={{ padding: '0.5rem' }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {passengers.map((p) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${colors.lineSoft}` }}>
                  <td style={{ padding: '0.5rem' }}>{p.name}</td>
                  <td style={{ padding: '0.5rem' }}>{p.email}</td>
                  <td style={{ padding: '0.5rem' }}>{p.booking_count}</td>
                  <td style={{ padding: '0.5rem' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {passengers.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '1rem', color: colors.muted }}>No passenger accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
