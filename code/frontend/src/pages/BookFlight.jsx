import { useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from './SiteHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors, statusBadgeStyle } from '../styles.js';

const ASSISTANCE_OPTIONS = [
  { value: '', label: 'No assistance needed' },
  { value: 'wheelchair', label: 'Wheelchair assistance' },
  { value: 'medical', label: 'Medical assistance' },
  { value: 'visual', label: 'Visual assistance' },
  { value: 'hearing', label: 'Hearing assistance' },
  { value: 'elderly_support', label: 'Elderly passenger support' },
];

// Single page, multi-step flow (search -> results -> seat -> assistance ->
// confirm) rather than five separate routes, since it's one continuous
// transaction and the booking only becomes real at the final POST.
export default function BookFlight() {
  const { token } = useAuth();
  const [step, setStep] = useState('search');
  const [origin, setOrigin] = useState('DEL');
  const [destination, setDestination] = useState('BOM');
  const [date, setDate] = useState('');
  const [flights, setFlights] = useState([]);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [seats, setSeats] = useState([]);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [assistanceType, setAssistanceType] = useState('');
  const [assistanceNotes, setAssistanceNotes] = useState('');
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (origin) params.set('origin', origin);
      if (destination) params.set('destination', destination);
      if (date) params.set('date', date);
      const data = await apiFetch(`/bookings/search-flights?${params.toString()}`, { token });
      setFlights(data.flights);
      setStep('results');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectFlight(flight) {
    setError(null);
    setSelectedFlight(flight);
    setSelectedSeat(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/bookings/flights/${flight.id}/seats`, { token });
      setSeats(data.seats);
      setStep('seat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBooking() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch('/bookings', {
        method: 'POST',
        token,
        body: {
          flight_id: selectedFlight.id,
          seat_id: selectedSeat.id,
          assistance_type: assistanceType || undefined,
          assistance_notes: assistanceNotes || undefined,
        },
      });
      setBooking(data.booking);
      setStep('confirmed');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <SiteHeader />
      <div className="book-hero">
        <div className="map-dots" />
        <div className="book-hero-inner">
          <h1>Where will you fly next?</h1>
          <p>Search, compare and book flights in seconds, with assistance built right in.</p>
        </div>
      </div>

      {step === 'search' && (
        <form className="book-search-card" onSubmit={handleSearch}>
          <div style={{ ...styles.searchRow, marginBottom: 0 }}>
            <label style={styles.searchField}>
              From
              <input style={styles.input} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="DEL" />
            </label>
            <label style={styles.searchField}>
              To
              <input style={styles.input} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="BOM" />
            </label>
            <label style={styles.searchField}>
              Date (optional)
              <input style={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <button style={styles.button} type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Search flights'}
            </button>
          </div>
        </form>
      )}

      <main style={styles.bookingWrap}>
        {error && <p style={styles.error}>{error}</p>}

        {step === 'results' && (
          <>
            <button style={styles.buttonSecondary} onClick={() => setStep('search')}>&larr; New search</button>
            <div style={{ marginTop: '1rem' }}>
              {flights.length === 0 && <p style={styles.muted}>No flights found for that route/date.</p>}
              {flights.map((f) => (
                <div key={f.id} className="flight-card-notch" onClick={() => handleSelectFlight(f)}>
                  <div style={{ padding: '1.1rem 1.3rem 0.9rem' }}>
                    <div style={styles.flightCardTop}>
                      <strong>{f.flight_number}</strong>
                      <span style={statusBadgeStyle(f.status)}>{f.status}</span>
                    </div>
                    <div style={styles.routeLine}>
                      <div>
                        <div style={styles.routeCode}>{f.origin_code}</div>
                        <div style={styles.routeTime}>{formatTime(f.scheduled_departure)}</div>
                      </div>
                      <div style={styles.routeArrow}>{f.aircraft_model} &rarr;</div>
                      <div>
                        <div style={styles.routeCode}>{f.dest_code}</div>
                        <div style={styles.routeTime}>{formatTime(f.scheduled_arrival)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="flight-card-notch-row" />
                  <div className="flight-card-perf" />
                  <div style={{ padding: '0.9rem 1.3rem 1rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={styles.priceTag}>${(f.mock_price_cents / 100).toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'seat' && selectedFlight && (
          <>
            <button style={styles.buttonSecondary} onClick={() => setStep('results')}>&larr; Back to results</button>
            <h2 style={styles.cardTitle}>Select your seat — {selectedFlight.flight_number}</h2>
            <div className="seat-map-card">
              <div className="seat-map-arch" />
              <div style={styles.seatGrid}>
                {seats.map((s) => {
                  const isSelected = selectedSeat?.id === s.id;
                  const style = {
                    ...styles.seatBase,
                    ...(s.is_booked ? styles.seatBooked : {}),
                    ...(isSelected ? styles.seatSelected : {}),
                  };
                  return (
                    <button
                      key={s.id}
                      type="button"
                      style={style}
                      disabled={s.is_booked}
                      onClick={() => setSelectedSeat(s)}
                      title={s.class}
                    >
                      {s.seat_number}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              style={{ ...styles.button, marginTop: '1.2rem' }}
              disabled={!selectedSeat}
              onClick={() => setStep('assistance')}
            >
              Continue with seat {selectedSeat?.seat_number || '…'}
            </button>
          </>
        )}

        {step === 'assistance' && (
          <>
            <button style={styles.buttonSecondary} onClick={() => setStep('seat')}>&larr; Back</button>
            <h2 style={styles.cardTitle}>Assistance (optional)</h2>
            <div style={styles.form}>
              <label style={styles.label}>
                Assistance type
                <select style={styles.select} value={assistanceType} onChange={(e) => setAssistanceType(e.target.value)}>
                  {ASSISTANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {assistanceType && (
                <label style={styles.label}>
                  Additional notes
                  <textarea
                    style={{ ...styles.input, minHeight: 80, fontFamily: 'inherit' }}
                    value={assistanceNotes}
                    onChange={(e) => setAssistanceNotes(e.target.value)}
                    placeholder="Anything ground/medical staff should know"
                  />
                </label>
              )}
              <button style={styles.button} onClick={handleConfirmBooking} disabled={loading}>
                {loading ? 'Booking…' : 'Confirm booking'}
              </button>
            </div>
          </>
        )}

        {step === 'confirmed' && booking && (
          <>
            <h2 style={styles.cardTitle}>Booking confirmed 🎉</h2>
            <div className="boarding-pass-card">
              <div style={{ padding: '1.3rem 1.4rem 1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>
                  MERIDIAN AIR &middot; {selectedFlight.flight_number}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.9rem 0' }}>
                  <div style={styles.ticketCode}>{selectedFlight.origin_code}</div>
                  <div style={{ color: 'rgba(255,255,255,0.7)' }}>&#9992;</div>
                  <div style={styles.ticketCode}>{selectedFlight.dest_code}</div>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)' }}>
                  Ref: {booking.booking_ref}
                </div>
              </div>
              <div className="boarding-pass-notch-row" />
              <div className="boarding-pass-perf" />
              <div style={styles.ticketBottom}>
                <div>
                  <div style={styles.ticketKey}>Seat</div>
                  <div style={styles.ticketVal}>{selectedSeat.seat_number}</div>
                </div>
                <div>
                  <div style={styles.ticketKey}>Class</div>
                  <div style={styles.ticketVal}>{selectedSeat.class}</div>
                </div>
                <div>
                  <div style={styles.ticketKey}>Status</div>
                  <div style={styles.ticketVal}>{booking.status}</div>
                </div>
              </div>
            </div>
            <p style={{ marginTop: '1.5rem' }}>
              <Link to="/my-flights" style={{ color: colors.accent, fontWeight: 600 }}>View all my flights &rarr;</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
