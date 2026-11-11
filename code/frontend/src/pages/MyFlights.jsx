import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

export default function MyFlights() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const loadBookings = () => {
    apiFetch('/bookings/mine', { token })
      .then((data) => setBookings(data.bookings))
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadBookings();
  }, [token]);

  const handleCheckIn = async (bookingId) => {
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      await apiFetch(`/bookings/${bookingId}/check-in`, { method: 'POST', token });
      setActionMessage('Web check-in successful! Your digital boarding pass is ready.');
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmHold = async (bookingId) => {
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      await apiFetch(`/bookings/${bookingId}/confirm-payment`, {
        method: 'POST',
        token,
        body: { payment_method: 'mock_card' },
      });
      setActionMessage('Seat reservation confirmed and mock payment processed successfully!');
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to cancel this booking? Any mock payment will be refunded.')) {
      return;
    }
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/bookings/${bookingId}/cancel`, { method: 'POST', token });
      setActionMessage(
        res.refund
          ? `Booking cancelled. Mock refund of $${res.refund.amount} processed.`
          : 'Booking cancelled successfully.'
      );
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

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

        {actionMessage && (
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#10b981', padding: '12px 18px', borderRadius: '12px', marginBottom: '20px', fontSize: '13px', fontWeight: 600 }}>
            {actionMessage}
          </div>
        )}

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
            {bookings.map((b) => {
              const isHeld = b.status === 'held';
              const isConfirmed = b.status === 'confirmed';
              const isCheckedIn = b.status === 'checked_in' || b.status === 'boarded';
              const isCancelled = b.status === 'cancelled';
              const isNoShow = b.status === 'no_show';

              return (
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

                      <div>
                        {isHeld && (
                          <span className="status-pill status-pill-amber">
                            <span className="dot-indicator amber" />
                            Seat Held (Pending Payment)
                          </span>
                        )}
                        {isConfirmed && (
                          <span className="status-pill status-pill-blue">
                            <span className="dot-indicator blue" />
                            Confirmed (Check-in Ready)
                          </span>
                        )}
                        {isCheckedIn && (
                          <span className="status-pill status-pill-green">
                            <span className="dot-indicator green" />
                            Checked In
                          </span>
                        )}
                        {isCancelled && (
                          <span className="status-pill status-pill-red">
                            <span className="dot-indicator red" />
                            Cancelled & Refunded
                          </span>
                        )}
                        {isNoShow && (
                          <span className="status-pill status-pill-red">
                            <span className="dot-indicator red" />
                            No-Show
                          </span>
                        )}
                      </div>
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
                        <span style={{ fontSize: '10.5px', color: 'var(--color-slate)', marginTop: '4px' }}>
                          ${(b.price_cents / 100).toFixed(2)}
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
                        <span><strong>Seat:</strong> {b.seat_number || '—'} ({b.seat_class || 'Economy'})</span>
                        <span><strong>Passenger:</strong> {b.passenger_name}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {isHeld && (
                          <button
                            onClick={() => handleConfirmHold(b.id)}
                            disabled={busyId === b.id}
                            className="btn-primary-aero"
                            style={{ padding: '8px 16px', fontSize: '12.5px', background: 'var(--color-primary)' }}
                          >
                            <span>Pay & Confirm</span>
                          </button>
                        )}

                        {isConfirmed && (
                          <button
                            onClick={() => handleCheckIn(b.id)}
                            disabled={busyId === b.id}
                            className="btn-primary-aero"
                            style={{ padding: '8px 18px', fontSize: '12.5px', background: '#10B981' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                            <span>Web Check-In</span>
                          </button>
                        )}

                        {(isCheckedIn || isConfirmed) && (
                          <>
                            <Link to={`/boarding-pass/${b.id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>qr_code</span>
                              <span>Boarding Pass</span>
                            </Link>
                            <a
                              href={`${API_URL}/bookings/${b.id}/boarding-pass.pdf`}
                              download
                              className="btn-glass"
                              style={{ padding: '8px 12px', fontSize: '12px', textDecoration: 'none' }}
                              title="Download PDF"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
                            </a>
                          </>
                        )}

                        {!isCancelled && !isNoShow && (
                          <button
                            onClick={() => handleCancelBooking(b.id)}
                            disabled={busyId === b.id}
                            className="btn-glass"
                            style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--color-critical)' }}
                            title="Cancel Booking & Refund"
                          >
                            Cancel
                          </button>
                        )}

                        <Link to={`/track/${b.flight_id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>radar</span>
                          <span>Track</span>
                        </Link>
                      </div>
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
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
