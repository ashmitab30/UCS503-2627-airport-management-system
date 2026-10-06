import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      <div className="aero-hero-light" style={{ borderRadius: 0, padding: '48px 32px 64px' }}>
        <div className="map-dots-ambient" />
        <div style={{ maxWidth: 840, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.85)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '14px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>flight</span>
            <span>Passenger Itinerary Hub</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.025em', fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }}>
            My Flights & Bookings
          </h1>
          <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1rem', margin: '8px auto 0', maxWidth: 500 }}>
            Your electronic tickets, gate assignments, live tracking, and assistance requests.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 960, width: '100%', margin: '-30px auto 4rem', padding: '0 24px', flex: 1, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
          <Link to="/book" className="btn-primary-aero" style={{ padding: '10px 22px', fontSize: '13.5px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
            <span>Book New Flight</span>
          </Link>
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {!error && bookings === null && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-slate)' }}>
            <p>Loading flight itineraries…</p>
          </div>
        )}

        {bookings && bookings.length === 0 && (
          <div className="ticket-notch-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '12px' }}>
              luggage
            </span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>
              No flight bookings found
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '14px' }}>
              You don't have any booked journeys right now. Ready to explore?
            </p>
            <Link to="/book" className="btn-primary-aero">
              Book a Flight Now
            </Link>
          </div>
        )}

        {bookings && bookings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {bookings.map((b) => (
              <div key={b.id} className="ticket-notch-card">
                <div style={{ padding: '24px 28px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="status-pill status-pill-blue">
                        Flight #{b.flight_number}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                        Ref {b.booking_ref}
                      </span>
                    </div>

                    <span className="status-pill status-pill-green">
                      <span className="dot-indicator green" />
                      {b.flight_status || 'Confirmed'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 16px' }}>
                    <div>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {b.origin_code}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                        {new Date(b.scheduled_departure).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span className="material-symbols-outlined" style={{ color: 'var(--color-outline)', transform: 'rotate(90deg)', fontSize: '24px' }}>
                        flight
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {b.dest_code}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                        {new Date(b.scheduled_arrival).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid rgba(241, 243, 255, 0.9)' }}>
                    <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
                      <span><strong>Seat:</strong> {b.seat_number || '—'}</span>
                      <span><strong>Terminal:</strong> T3 &middot; Gate 14B</span>
                    </div>

                    <Link to={`/track/${b.flight_id}`} className="btn-primary-aero" style={{ padding: '8px 20px', fontSize: '13px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>radar</span>
                      <span>Track Live</span>
                    </Link>
                  </div>
                </div>

                {/* Assistance Pipeline Bar */}
                {b.assistance_type && (
                  <>
                    <div className="ticket-notch-row">
                      <div className="ticket-notch-left" />
                      <div className="ticket-perf-line" />
                      <div className="ticket-notch-right" />
                    </div>

                    <div style={{ padding: '16px 28px 20px', background: 'var(--color-surface-low)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                            accessibility_new
                          </span>
                          <span>Requested Care: {b.assistance_type.replace('_', ' ')}</span>
                        </div>
                      </div>

                      <div className="stepper-container">
                        {PIPELINE_STEPS.map((step, i) => {
                          const currentIndex = PIPELINE_STEPS.indexOf(b.assistance_status);
                          const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
                          return (
                            <span key={step} className={`stepper-pill ${state}`}>
                              {state === 'done' && (
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                              )}
                              {state === 'active' && <span className="pulse-radar-dot" />}
                              <span>{PIPELINE_LABELS[step]}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
