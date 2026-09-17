import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles, colors, statusBadgeStyle } from '../../styles.js';

export default function AdminBookings() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/bookings', { token })
      .then((d) => setBookings(d.bookings))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <h1 style={styles.title}>Bookings</h1>
      {error && <p style={styles.error}>{error}</p>}
      {!error && bookings === null && <p style={styles.muted}>Loading…</p>}
      {bookings && (
        <div style={styles.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `1px solid ${colors.line}` }}>
                <th style={{ padding: '0.5rem' }}>Ref</th>
                <th style={{ padding: '0.5rem' }}>Passenger</th>
                <th style={{ padding: '0.5rem' }}>Flight</th>
                <th style={{ padding: '0.5rem' }}>Route</th>
                <th style={{ padding: '0.5rem' }}>Seat</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Assistance</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} style={{ borderBottom: `1px solid ${colors.lineSoft}` }}>
                  <td style={{ padding: '0.5rem' }}>{b.booking_ref}</td>
                  <td style={{ padding: '0.5rem' }}>{b.passenger_name || '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{b.flight_number}</td>
                  <td style={{ padding: '0.5rem' }}>{b.origin_code} → {b.dest_code}</td>
                  <td style={{ padding: '0.5rem' }}>{b.seat_number || '—'}</td>
                  <td style={{ padding: '0.5rem' }}><span style={statusBadgeStyle(b.status)}>{b.status}</span></td>
                  <td style={{ padding: '0.5rem' }}>
                    {b.assistance_type ? `${b.assistance_type.replace('_', ' ')} (${b.assistance_status})` : '—'}
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '1rem', color: colors.muted }}>No bookings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
