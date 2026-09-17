import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors, statusBadgeStyle } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' };

export default function MyFlights() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch('/bookings/mine', { token })
      .then((data) => setBookings(data.bookings))
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <SiteHeader />
      <div className="book-hero" style={{ paddingBottom: '60px' }}>
        <div className="map-dots" />
        <div className="book-hero-inner">
          <h1>My flights</h1>
          <p>Your bookings, tickets, and assistance requests in one place.</p>
        </div>
      </div>

      <main style={styles.bookingWrap}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.2rem' }}>
          <Link to="/book" style={{ ...styles.buttonSecondary, textDecoration: 'none' }}>+ Book a flight</Link>
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {!error && bookings === null && <p style={styles.muted}>Loading…</p>}
        {bookings && bookings.length === 0 && (
          <div style={styles.card}>
            <p style={styles.muted}>No bookings yet. <Link to="/book" style={{ color: colors.accent }}>Book your first flight</Link>.</p>
          </div>
        )}

        {bookings && bookings.map((b) => (
          <div key={b.id} className="flight-card-notch" style={{ cursor: 'default' }}>
            <div style={{ padding: '1.1rem 1.3rem 0.9rem' }}>
              <div style={styles.flightCardTop}>
                <strong>{b.flight_number}</strong>
                <span style={statusBadgeStyle(b.flight_status)}>{b.flight_status}</span>
              </div>
              <div style={styles.routeLine}>
                <div>
                  <div style={styles.routeCode}>{b.origin_code}</div>
                  <div style={styles.routeTime}>{formatTime(b.scheduled_departure)}</div>
                </div>
                <div style={styles.routeArrow}>&rarr;</div>
                <div>
                  <div style={styles.routeCode}>{b.dest_code}</div>
                  <div style={styles.routeTime}>{formatTime(b.scheduled_arrival)}</div>
                </div>
                <div style={{ fontSize: '0.8rem', color: colors.muted }}>
                  Seat {b.seat_number || '—'} &middot; {b.booking_ref}
                </div>
              </div>
            </div>

            <div style={{ padding: '0 1.3rem 1rem' }}>
              <Link to={`/track/${b.flight_id}`} style={{ ...styles.buttonSecondary, textDecoration: 'none', display: 'inline-block' }}>
                Track this flight
              </Link>
            </div>

            {b.assistance_type && (
              <>
                <div className="flight-card-notch-row" />
                <div className="flight-card-perf" />
                <div style={{ padding: '0.9rem 1.3rem 1rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Assistance requested: {b.assistance_type.replace('_', ' ')}
                  </div>
                  <div style={styles.pipeline}>
                    {PIPELINE_STEPS.map((step, i) => {
                      const currentIndex = PIPELINE_STEPS.indexOf(b.assistance_status);
                      const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
                      const stepStyle =
                        state === 'done' ? styles.pipelineStepDone :
                        state === 'current' ? styles.pipelineStepCurrent : styles.pipelineStepPending;
                      return (
                        <span key={step} style={stepStyle}>
                          {PIPELINE_LABELS[step]}{i < PIPELINE_STEPS.length - 1 ? ' →' : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
