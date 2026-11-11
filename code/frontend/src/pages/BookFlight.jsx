/**
 * BookFlight — orchestrator for the 4-step booking flow:
 *   search → results → seat+hold → confirmed
 *
 * Step 2 uses POST /bookings/hold (timed 10-min hold).
 * Step 3 uses POST /bookings/:id/confirm-payment (mock payment).
 * UI subcomponents match Stitch screens c5c9a568520849df9dfbead3d474cfc6
 * and 43f3c451383540d481c4f25bf8ae6b61.
 */
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import FlightSearchFilters from '../components/booking/FlightSearchFilters.jsx';
import FlightSearchResults from '../components/booking/FlightSearchResults.jsx';
import SeatDeckMap from '../components/booking/SeatDeckMap.jsx';
import BookingHoldModal from '../components/booking/BookingHoldModal.jsx';
import BookingConfirmation from '../components/booking/BookingConfirmation.jsx';

export default function BookFlight() {
  const { token } = useAuth();
  const location = useLocation();

  // ── Search state ──────────────────────────────────────────────────────────
  const [origin, setOrigin] = useState('DEL');
  const [destination, setDestination] = useState('BOM');
  const [date, setDate] = useState('');
  const [seatClass, setSeatClass] = useState('economy');
  const [flights, setFlights] = useState([]);

  // ── Seat selection state ──────────────────────────────────────────────────
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [seats, setSeats] = useState([]);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [assistanceType, setAssistanceType] = useState('');
  const [assistanceNotes, setAssistanceNotes] = useState('');

  // ── Hold state ────────────────────────────────────────────────────────────
  const [heldBooking, setHeldBooking] = useState(null); // { id, held_until, ... }

  // ── Confirmation state ────────────────────────────────────────────────────
  const [confirmedBooking, setConfirmedBooking] = useState(null);

  // ── Shared UI state ───────────────────────────────────────────────────────
  const [step, setStep] = useState('search'); // search | results | seat | hold | confirmed
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Pre-fill search from query params (e.g. from FlightTracking link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const originParam = params.get('origin');
    const destParam = params.get('dest');
    const dateParam = params.get('date');
    if (originParam) setOrigin(originParam);
    if (destParam) setDestination(destParam);
    if (dateParam) setDate(dateParam);
    if (originParam || destParam) {
      runSearch(originParam || origin, destParam || destination, dateParam || date, seatClass);
    }
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function runSearch(orig, dest, dt, cls) {
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (orig) params.set('origin', orig);
      if (dest) params.set('destination', dest);
      if (dt) params.set('date', dt);
      if (cls) params.set('class', cls);
      const data = await apiFetch(`/bookings/search-flights?${params.toString()}`, { token });
      setFlights(data.flights);
      setStep('results');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    runSearch(origin, destination, date, seatClass);
  }

  function handleSwap() {
    setOrigin(destination);
    setDestination(origin);
  }

  async function handleSelectFlight(flight, cls) {
    setError(null);
    setSelectedFlight(flight);
    setSelectedSeat(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/bookings/flights/${flight.id}/seats`, { token });
      // Filter to selected class (or show all if no filter)
      const filtered = cls ? data.seats.filter((s) => s.class === cls) : data.seats;
      setSeats(filtered.length > 0 ? filtered : data.seats);
      const firstAvail = data.seats.find((s) => s.is_available && (!cls || s.class === cls));
      if (firstAvail) setSelectedSeat(firstAvail);
      setStep('seat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleHoldSeat() {
    if (!selectedSeat) {
      setError('Please select a seat from the cabin map.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch('/bookings/hold', {
        method: 'POST',
        token,
        body: {
          flight_id: selectedFlight.id,
          seat_id: selectedSeat.id,
          assistance_type: assistanceType || undefined,
          assistance_notes: assistanceNotes || undefined,
        },
      });
      setHeldBooking(data.booking);
      setStep('hold');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmPayment() {
    if (!heldBooking) return;
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/bookings/${heldBooking.id}/confirm-payment`, {
        method: 'POST',
        token,
        body: { payment_method: 'mock_card' },
      });
      setConfirmedBooking({ ...data.booking, payment: data.payment });
      setStep('confirmed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleHoldExpired() {
    setHeldBooking(null);
    setSelectedSeat(null);
    setStep('search');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      {/* Hero */}
      <div className="aero-hero-light" style={{ borderRadius: 0, padding: '48px 32px 72px' }}>
        <div className="map-dots-ambient" />
        <div style={{ maxWidth: 840, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '999px', background: 'rgba(255,255,255,0.85)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '14px' }}>
            <span className="pulse-radar-dot" />
            <span>Flight Booking &amp; Passenger Dispatch</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.025em', fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }}>
            Where will you fly next?
          </h1>
          <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1.05rem', margin: '8px auto 0', maxWidth: 540 }}>
            Real-time flight schedule availability, interactive deck seating, and specialised passenger care.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 1200, width: '100%', margin: '-40px auto 4rem', padding: '0 24px', flex: 1, position: 'relative', zIndex: 10 }}>

        {/* Step 1 — always visible search bar */}
        <FlightSearchFilters
          origin={origin}
          destination={destination}
          date={date}
          seatClass={seatClass}
          loading={loading}
          onOriginChange={setOrigin}
          onDestinationChange={setDestination}
          onDateChange={setDate}
          onClassChange={setSeatClass}
          onSwap={handleSwap}
          onSubmit={handleSearch}
        />

        {error && <p style={{ ...styles.error, marginBottom: '20px' }}>{error}</p>}

        {/* Step 2 — results */}
        {step === 'results' && (
          <FlightSearchResults
            flights={flights}
            origin={origin}
            destination={destination}
            seatClass={seatClass}
            onSelectFlight={handleSelectFlight}
          />
        )}

        {/* Step 3 — seat selection */}
        {step === 'seat' && selectedFlight && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '28px', alignItems: 'start' }}>
            {/* Left: flight summary + proceed CTA */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="ticket-notch-card">
                <div style={{ padding: '20px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span className="status-pill status-pill-blue">Flight {selectedFlight.flight_number}</span>
                    <button type="button" onClick={() => setStep('results')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      ← Change Flight
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{selectedFlight.origin_code}</div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>{new Date(selectedFlight.scheduled_departure).toLocaleString()}</span>
                    </div>
                    <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-outline)' }}>flight_takeoff</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{selectedFlight.dest_code}</div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>{new Date(selectedFlight.scheduled_arrival).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="ticket-notch-row"><div className="ticket-notch-left" /><div className="ticket-perf-line" /><div className="ticket-notch-right" /></div>
                <div style={{ padding: '12px 24px', background: 'var(--color-surface-low)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>Selected Seat</span>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>{selectedSeat?.seat_number ?? 'None'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>Total Fare</span>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                      {selectedSeat ? `₹${(selectedSeat.price_cents / 100).toFixed(0)}` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                className="btn-primary-aero"
                onClick={handleHoldSeat}
                disabled={loading || !selectedSeat}
                style={{ padding: '14px 32px', fontSize: '15px' }}
              >
                <span>{loading ? 'Holding Seat…' : 'Hold Seat & Continue'}</span>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>lock_clock</span>
              </button>
            </div>

            {/* Right: seat map */}
            <SeatDeckMap
              seats={seats}
              selectedSeat={selectedSeat}
              onSelectSeat={setSelectedSeat}
            />
          </div>
        )}

        {/* Step 4 — hold checkout */}
        {step === 'hold' && heldBooking && selectedFlight && (
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            <BookingHoldModal
              flight={selectedFlight}
              seat={selectedSeat}
              assistanceType={assistanceType}
              assistanceNotes={assistanceNotes}
              heldUntil={heldBooking.held_until}
              onAssistanceChange={setAssistanceType}
              onNotesChange={setAssistanceNotes}
              onConfirm={handleConfirmPayment}
              onExpired={handleHoldExpired}
              loading={loading}
              error={error}
            />
          </div>
        )}

        {/* Step 5 — confirmed */}
        {step === 'confirmed' && confirmedBooking && (
          <BookingConfirmation booking={confirmedBooking} />
        )}

      </main>
    </div>
  );
}
