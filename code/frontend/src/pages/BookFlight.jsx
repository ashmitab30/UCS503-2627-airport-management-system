import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';

const ASSISTANCE_OPTIONS = [
  { value: '', label: 'Standard Clearance', desc: 'No special assistance needed on ground or in cabin', icon: 'check_circle' },
  { value: 'wheelchair', label: 'Wheelchair Mobility', desc: 'Ramp buggy transfer and gate-to-aircraft boarding support', icon: 'accessible' },
  { value: 'medical', label: 'Medical & Oxygen Support', desc: 'Paramedic standby and supplemental cabin oxygen cylinder', icon: 'medical_services' },
  { value: 'visual', label: 'Visual Guidance', desc: 'Dedicated staff escort through check-in, TSA, and gate bridge', icon: 'visibility' },
  { value: 'hearing', label: 'Hearing Support', desc: 'Visual gate paging and priority SMS flight alerts', icon: 'hearing' },
  { value: 'elderly_support', label: 'Senior Support', desc: 'Dedicated ground agent for baggage and leisurely gate transit', icon: 'elderly' },
];

export default function BookFlight() {
  const { token } = useAuth();
  const location = useLocation();

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

  // Check URL query parameters for pre-filled search
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const originParam = params.get('origin');
    const destParam = params.get('dest');
    const dateParam = params.get('date');
    if (originParam) setOrigin(originParam);
    if (destParam) setDestination(destParam);
    if (dateParam) setDate(dateParam);

    if (originParam || destParam) {
      triggerSearch(originParam || origin, destParam || destination, dateParam || date);
    }
  }, [location.search]);

  async function triggerSearch(orig, dest, dt) {
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (orig) params.set('origin', orig);
      if (dest) params.set('destination', dest);
      if (dt) params.set('date', dt);
      const data = await apiFetch(`/bookings/search-flights?${params.toString()}`, { token });
      setFlights(data.flights);
      setStep('results');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    triggerSearch(origin, destination, date);
  }

  function handleSwapAirports() {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  }

  async function handleSelectFlight(flight) {
    setError(null);
    setSelectedFlight(flight);
    setSelectedSeat(null);
    setLoading(true);
    try {
      const data = await apiFetch(`/bookings/flights/${flight.id}/seats`, { token });
      setSeats(data.seats);
      // Auto-select first available seat if none selected
      const firstAvailable = data.seats.find((s) => s.is_available);
      if (firstAvailable) setSelectedSeat(firstAvailable);
      setStep('seat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBooking() {
    if (!selectedSeat) {
      setError('Please select an available seat from the aircraft map.');
      return;
    }
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

  // Format seat grid rows (e.g. rows 1 to 6 with columns A, B, C, D, E, F)
  const columns = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rowNumbers = [1, 2, 3, 4, 5, 6];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      {/* Hero Header */}
      <div className="aero-hero-light" style={{ borderRadius: 0, padding: '48px 32px 72px' }}>
        <div className="map-dots-ambient" />
        <div style={{ maxWidth: 840, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.85)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '14px' }}>
            <span className="pulse-radar-dot" />
            <span>Flight Booking & Passenger Dispatch</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.025em', fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }}>
            Where will you fly next?
          </h1>
          <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1.05rem', margin: '8px auto 0', maxWidth: 540 }}>
            Real-time flight schedule availability, interactive deck seating, and specialized passenger care.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 1200, width: '100%', margin: '-40px auto 4rem', padding: '0 24px', flex: 1, position: 'relative', zIndex: 10 }}>
        
        {/* ============================================================== */}
        {/* STEP 1: FLIGHT SEARCH BAR                                      */}
        {/* ============================================================== */}
        <div className="flight-search-bar" style={{ marginBottom: '24px' }}>
          <form onSubmit={handleSearch} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 44px repeat(auto-fit, minmax(200px, 1fr)) minmax(160px, 180px)', gap: '12px', alignItems: 'center' }}>
            <div className="search-field-module">
              <span className="field-sublabel">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>flight_takeoff</span>
                From Airport
              </span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="iata-tag-bold">{origin}</span>
                <input
                  className="field-input-naked"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                  placeholder="DEL"
                  maxLength={4}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={handleSwapAirports}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'var(--color-surface-high)',
                  color: 'var(--color-primary)',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Swap origin and destination"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>swap_horiz</span>
              </button>
            </div>

            <div className="search-field-module">
              <span className="field-sublabel">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-secondary)' }}>flight_land</span>
                To Airport
              </span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="iata-tag-bold" style={{ color: 'var(--color-secondary)' }}>{destination}</span>
                <input
                  className="field-input-naked"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.toUpperCase())}
                  placeholder="BOM"
                  maxLength={4}
                />
              </div>
            </div>

            <div className="search-field-module">
              <span className="field-sublabel">
                <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>calendar_month</span>
                Departure Date
              </span>
              <input
                type="date"
                className="field-input-naked"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary-aero" style={{ height: '54px' }} disabled={loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
              <span>{loading ? 'Searching…' : 'Find Flights'}</span>
            </button>
          </form>
        </div>

        {error && <p style={{ ...styles.error, marginBottom: '20px' }}>{error}</p>}

        {/* ============================================================== */}
        {/* STEP 2: SEARCH RESULTS                                         */}
        {/* ============================================================== */}
        {step === 'results' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', margin: 0 }}>
                Available Flights ({flights.length})
              </h2>
              <span style={{ fontSize: '13px', color: 'var(--color-slate)', fontWeight: 600 }}>
                {origin} &rarr; {destination}
              </span>
            </div>

            {flights.length === 0 ? (
              <div className="ticket-notch-card" style={{ padding: '36px', textAlign: 'center', color: 'var(--color-slate)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '8px' }}>
                  flight_takeoff
                </span>
                <p style={{ fontWeight: 700, fontSize: '16px', margin: '4px 0' }}>No flights found matching this route.</p>
                <p style={{ fontSize: '13px', margin: '0' }}>Try searching between popular hubs like DEL, BOM, or BLR.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {flights.map((f) => (
                  <div
                    key={f.id}
                    className="ticket-notch-card"
                    style={{ padding: '24px 28px', cursor: 'pointer' }}
                    onClick={() => handleSelectFlight(f)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div className="brand-icon-circle" style={{ width: '44px', height: '44px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>airlines</span>
                        </div>
                        <div>
                          <div style={{ fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                            {f.flight_number}
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>
                            {f.aircraft_model || 'Airbus A320neo'} &middot; Gate {f.gate_code || 'TBD'}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
                        <div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                            {f.origin_code}
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                            {new Date(f.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '90px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--color-outline)', fontWeight: 700 }}>2h 15m</span>
                          <div style={{ width: '100%', height: '2px', background: 'var(--color-outline-variant)', position: 'relative', margin: '6px 0' }}>
                            <span className="material-symbols-outlined" style={{ position: 'absolute', top: '-9px', left: '40%', fontSize: '18px', color: 'var(--color-primary)' }}>
                              flight
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--color-success)', fontWeight: 700 }}>Non-Stop</span>
                        </div>

                        <div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                            {f.dest_code}
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>
                            {new Date(f.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '11px', color: 'var(--color-outline)', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>From</span>
                          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                            ${f.base_price || 180}
                          </span>
                        </div>
                        <button className="btn-primary-aero" style={{ padding: '10px 22px' }}>
                          <span>Select Flight</span>
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 3: SEAT & ASSISTANCE SELECTION (SPLIT 7-COL / 5-COL)     */}
        {/* ============================================================== */}
        {step === 'seat' && selectedFlight && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '28px', alignItems: 'start' }}>
            
            {/* Left 7 Columns: Ticket Summary & Special Operations */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Selected Flight Ticket Summary Header */}
              <div className="ticket-notch-card">
                <div style={{ padding: '24px 28px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="status-pill status-pill-blue">
                        Flight #{selectedFlight.flight_number}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>
                        {selectedFlight.aircraft_model || 'A320neo'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep('results')}
                      style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      &larr; Change Flight
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {selectedFlight.origin_code}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                        {new Date(selectedFlight.scheduled_departure).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-outline)' }}>
                        flight_takeoff
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {selectedFlight.dest_code}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                        {new Date(selectedFlight.scheduled_arrival).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tear Perforation */}
                <div className="ticket-notch-row">
                  <div className="ticket-notch-left" />
                  <div className="ticket-perf-line" />
                  <div className="ticket-notch-right" />
                </div>

                {/* Bottom Ticket Telemetry Bar */}
                <div style={{ padding: '16px 28px', background: 'var(--color-surface-low)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>
                      Chosen Seat
                    </span>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                      {selectedSeat ? selectedSeat.seat_number : 'None'}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>
                      Cabin Tier
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                      Economy Plus
                    </span>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>
                      Total Fare
                    </span>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                      ${selectedFlight.base_price || 180}
                    </span>
                  </div>
                </div>
              </div>

              {/* Special Operations / Passenger Care Panel */}
              <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '24px 28px', boxShadow: 'var(--shadow-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
                    accessibility_new
                  </span>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.25rem', margin: 0 }}>
                    Ground & Cabin Passenger Care
                  </h2>
                </div>
                <p style={{ color: 'var(--color-slate)', fontSize: '0.9rem', margin: '0 0 18px', lineHeight: 1.5 }}>
                  Airport ground operations and cabin attendants arrange dedicated dispatch for your journey with zero added service charge.
                </p>

                {/* 6 Radio Cards Matrix */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  {ASSISTANCE_OPTIONS.map((opt) => {
                    const isSelected = assistanceType === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() => setAssistanceType(opt.value)}
                        style={{
                          padding: '14px 16px',
                          borderRadius: '14px',
                          background: isSelected ? 'var(--color-surface-container)' : 'var(--color-surface-low)',
                          border: isSelected ? '2px solid var(--color-primary)' : '2px solid transparent',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: '22px',
                            color: isSelected ? 'var(--color-primary)' : 'var(--color-outline)',
                            marginTop: '2px',
                          }}
                        >
                          {opt.icon}
                        </span>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                            {opt.label}
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--color-slate)', marginTop: '2px', lineHeight: 1.4 }}>
                            {opt.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Ground Dispatch Instructions Field */}
                {assistanceType && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-slate)' }}>
                      Special Operational Notes for Ramp & Attendant Team
                    </label>
                    <textarea
                      style={{
                        padding: '12px 16px',
                        borderRadius: '12px',
                        border: '1.5px solid rgba(194, 198, 216, 0.7)',
                        fontSize: '13px',
                        fontFamily: 'var(--font-body)',
                        background: 'var(--color-surface-low)',
                        outline: 'none',
                        resize: 'vertical',
                        minHeight: '70px',
                      }}
                      placeholder="e.g. Passenger brings foldable wheelchair with lithium battery, or requires gate bridge escort..."
                      value={assistanceNotes}
                      onChange={(e) => setAssistanceNotes(e.target.value)}
                    />
                  </div>
                )}

                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn-primary-aero"
                    onClick={handleConfirmBooking}
                    disabled={loading || !selectedSeat}
                    style={{ padding: '14px 32px', fontSize: '15px' }}
                  >
                    <span>{loading ? 'Confirming Booking…' : 'Proceed to Confirmation'}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                      verified
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right 5 Columns: Interactive Cockpit Fuselage */}
            <div className="cockpit-fuselage-wrap">
              {/* Nose Radome Visual */}
              <div className="cockpit-nose-radome">
                <span className="avionics-beacon" />
                <div className="cockpit-windshield-group">
                  <div className="cockpit-window-pane" />
                  <div className="cockpit-window-pane" />
                  <div className="cockpit-window-pane" />
                </div>
              </div>

              <div style={{ textAlign: 'center', margin: '14px 0 18px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.06em' }}>
                  Flight Deck &middot; Forward Cabin
                </span>
                <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '2px 0 0', fontFamily: 'var(--font-display)' }}>
                  Interactive Seat Map
                </h3>
              </div>

              {/* Legend Pill Bar */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '8px 16px', background: 'var(--color-surface-lowest)', borderRadius: '999px', margin: '0 auto 20px', width: 'fit-content', boxShadow: '0 1px 4px rgba(6, 27, 58, 0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#fff', border: '1px solid #c2c6d8' }} />
                  <span>Available</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'var(--color-surface-high)' }} />
                  <span>Booked</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'var(--color-primary)' }} />
                  <span>Selected</span>
                </div>
              </div>

              {/* Column Letter Headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 40px) 24px repeat(3, 40px)', gap: '6px', justifyContent: 'center', marginBottom: '8px', textAlign: 'center', fontWeight: 800, fontSize: '12px', color: 'var(--color-outline)' }}>
                <span>A</span>
                <span>B</span>
                <span>C</span>
                <span style={{ fontSize: '9px', textTransform: 'uppercase' }}>AISLE</span>
                <span>D</span>
                <span>E</span>
                <span>F</span>
              </div>

              {/* Fuselage Seat Grid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                {rowNumbers.map((row) => (
                  <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 40px) 24px repeat(3, 40px)', gap: '6px', alignItems: 'center', textAlign: 'center' }}>
                    {/* Left 3 seats (A, B, C) */}
                    {columns.slice(0, 3).map((col) => {
                      const seatCode = `${String(row).padStart(2, '0')}${col}`;
                      const seatObj = seats.find((s) => s.seat_number === seatCode);
                      const isAvail = seatObj ? seatObj.is_available : false;
                      const isSelected = selectedSeat && selectedSeat.seat_number === seatCode;

                      return (
                        <button
                          key={seatCode}
                          type="button"
                          disabled={!isAvail}
                          onClick={() => seatObj && setSelectedSeat(seatObj)}
                          className={`seat-btn ${isSelected ? 'active-seat' : ''} ${!isAvail ? 'occupied-seat' : ''}`}
                          title={`${seatCode} ${isAvail ? '(Available)' : '(Occupied)'}`}
                        >
                          {isSelected ? '✓' : !isAvail ? '×' : seatCode}
                        </button>
                      );
                    })}

                    {/* Aisle Row Number */}
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-outline)' }}>
                      {String(row).padStart(2, '0')}
                    </span>

                    {/* Right 3 seats (D, E, F) */}
                    {columns.slice(3, 6).map((col) => {
                      const seatCode = `${String(row).padStart(2, '0')}${col}`;
                      const seatObj = seats.find((s) => s.seat_number === seatCode);
                      const isAvail = seatObj ? seatObj.is_available : false;
                      const isSelected = selectedSeat && selectedSeat.seat_number === seatCode;

                      return (
                        <button
                          key={seatCode}
                          type="button"
                          disabled={!isAvail}
                          onClick={() => seatObj && setSelectedSeat(seatObj)}
                          className={`seat-btn ${isSelected ? 'active-seat' : ''} ${!isAvail ? 'occupied-seat' : ''}`}
                          title={`${seatCode} ${isAvail ? '(Available)' : '(Occupied)'}`}
                        >
                          {isSelected ? '✓' : !isAvail ? '×' : seatCode}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
                  {seats.filter((s) => s.is_available).length} Seats Available in Cabin
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* STEP 4: CONFIRMATION BOARDING PASS                             */}
        {/* ============================================================== */}
        {step === 'confirmed' && booking && (
          <div style={{ maxWidth: 640, margin: '20px auto 40px' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--color-success-bg)', color: 'var(--color-success-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
                  check_circle
                </span>
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', margin: 0 }}>
                Booking Confirmed!
              </h2>
              <p style={{ color: 'var(--color-slate)', marginTop: '4px' }}>
                Your electronic boarding pass has been issued.
              </p>
            </div>

            {/* Authentic Boarding Pass Card */}
            <div className="boarding-pass-hero">
              <div className="map-dots-dark" />
              <div style={{ padding: '32px 32px 20px', position: 'relative', zIndex: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>flight_takeoff</span>
                    <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                      MERIDIAN OPS
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.2)' }}>
                    BOARDING PASS
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 0' }}>
                  <div>
                    <div style={{ fontSize: '2.8rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {booking.origin_code}
                    </div>
                    <span style={{ fontSize: '13px', opacity: 0.85, marginTop: '6px', display: 'block' }}>
                      {new Date(booking.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {booking.flight_number}
                    </span>
                    <div style={{ width: '80px', height: '2px', background: 'rgba(255, 255, 255, 0.4)', margin: '6px 0', position: 'relative' }}>
                      <span className="material-symbols-outlined" style={{ position: 'absolute', top: '-11px', left: '32px', fontSize: '20px' }}>
                        flight
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>Non-Stop</span>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '2.8rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {booking.dest_code}
                    </div>
                    <span style={{ fontSize: '13px', opacity: 0.85, marginTop: '6px', display: 'block' }}>
                      {new Date(booking.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tear Perforation */}
              <div className="ticket-notch-row" style={{ background: 'transparent' }}>
                <div className="ticket-notch-left" />
                <div className="ticket-perf-line" style={{ borderTopColor: 'rgba(255, 255, 255, 0.4)' }} />
                <div className="ticket-notch-right" />
              </div>

              {/* Boarding Pass Bottom Telemetry */}
              <div style={{ padding: '24px 32px 32px', background: 'rgba(0, 20, 60, 0.25)', position: 'relative', zIndex: 2 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '16px' }}>
                  <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                      Passenger
                    </span>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px' }}>
                      {booking.passenger_name || 'Passenger'}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                      Booking Ref
                    </span>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: '#c4e7ff' }}>
                      {booking.booking_ref}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                      Seat
                    </span>
                    <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '2px' }}>
                      {booking.seat_number}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                      Terminal / Gate
                    </span>
                    <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px' }}>
                      T3 &middot; Gate 14B
                    </div>
                  </div>
                </div>

                {booking.assistance_type && (
                  <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.12)', borderRadius: '10px', fontSize: '12px' }}>
                    <span style={{ fontWeight: 800 }}>Assistance Dispatch:</span> {booking.assistance_type.replace('_', ' ')}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginTop: '28px' }}>
              <Link to={`/track/${booking.flight_id}`} className="btn-primary-aero" style={{ padding: '12px 28px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>radar</span>
                <span>Track This Flight</span>
              </Link>
              <Link to="/my-flights" className="btn-secondary-aero" style={{ padding: '12px 28px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>luggage</span>
                <span>View in My Flights</span>
              </Link>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
