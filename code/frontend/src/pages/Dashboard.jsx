import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors, statusBadgeStyle } from '../styles.js';
import { TurnaroundBoard } from './OpsCore.jsx';
import AssistanceQueue from './AssistanceQueue.jsx';
import EmergencyBoard from './EmergencyBoard.jsx';
import SiteHeader from './SiteHeader.jsx';

const STAFF_ROLES = ['ground_crew', 'security', 'medical', 'ops_manager', 'admin'];

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();

  // Live Zulu Dispatch Time
  const [zuluTime, setZuluTime] = useState('');
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setZuluTime(`${h}:${m}:${s} Z`);
    }
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Quick search form state for passenger dashboard
  const [searchOrigin, setSearchOrigin] = useState('DEL');
  const [searchDest, setSearchDest] = useState('BOM');
  const [searchDate, setSearchDate] = useState('');

  function handleSwapAirports() {
    const temp = searchOrigin;
    setSearchOrigin(searchDest);
    setSearchDest(temp);
  }

  function handleQuickSearch(e) {
    e.preventDefault();
    navigate(`/book?origin=${encodeURIComponent(searchOrigin)}&dest=${encodeURIComponent(searchDest)}${searchDate ? `&date=${encodeURIComponent(searchDate)}` : ''}`);
  }

  // Passenger data
  const [recentBooking, setRecentBooking] = useState(null);
  useEffect(() => {
    if (user?.role === 'passenger' && token) {
      apiFetch('/bookings/mine', { token })
        .then((data) => {
          if (data.bookings && data.bookings.length > 0) {
            setRecentBooking(data.bookings[0]);
          }
        })
        .catch(() => {});
    }
  }, [user, token]);

  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      {/* Site Header for Passenger or Staff Header */}
      {user.role === 'passenger' ? (
        <SiteHeader />
      ) : (
        <header className="site-header">
          <div className="brand">
            <div className="brand-icon-circle">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                connecting_airports
              </span>
            </div>
            <div className="brand-text-wrap">
              <span className="brand-name">MERIDIAN OPS</span>
              <span className="brand-sub">{user.role.replace('_', ' ')} Console</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="zulu-timer-chip">
              <span className="pulse-radar-dot" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)' }}>
                  UTC Dispatch
                </span>
                <span style={{ fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }} className="telemetry">
                  {zuluTime}
                </span>
              </div>
            </div>
            <div className="header-user-pill">
              <div className="header-avatar-circle">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  badge
                </span>
              </div>
              <span style={{ fontWeight: 700, fontSize: '13px' }}>{user.name}</span>
            </div>
            <button
              onClick={logout}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                logout
              </span>
              <span>Sign Out</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, maxWidth: 1360, width: '100%', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        
        {/* ============================================================== */}
        {/* PASSENGER VIEW                                                 */}
        {/* ============================================================== */}
        {user.role === 'passenger' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Top Greeting & Live Zulu Dispatch Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                  <span className="dot-indicator green" />
                  Flight Operations Live Sync
                </div>
                <h1 style={{ fontSize: '2.4rem', fontWeight: 800, margin: '0', letterSpacing: '-0.025em', fontFamily: 'var(--font-display)' }}>
                  Welcome back, {user.name}
                </h1>
                <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1rem', marginTop: '4px', margin: 0 }}>
                  Your active itinerary and scheduled flight management portal.
                </p>
              </div>

              <div className="zulu-timer-chip">
                <span className="pulse-radar-dot" />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)' }}>
                    UTC Dispatch Time
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }} className="telemetry">
                    {zuluTime}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Flight Search Bar */}
            <div className="flight-search-bar">
              <form onSubmit={handleQuickSearch} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 50px repeat(auto-fit, minmax(200px, 1fr)) minmax(160px, 180px)', gap: '12px', alignItems: 'center' }}>
                <div className="search-field-module">
                  <span className="field-sublabel">
                    <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>flight_takeoff</span>
                    From Airport
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="iata-tag-bold">{searchOrigin}</span>
                    <input
                      className="field-input-naked"
                      value={searchOrigin}
                      onChange={(e) => setSearchOrigin(e.target.value.toUpperCase())}
                      placeholder="Origin Code"
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
                      transition: 'transform 0.2s',
                    }}
                    title="Swap trajectory"
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
                    <span className="iata-tag-bold" style={{ color: 'var(--color-secondary)' }}>{searchDest}</span>
                    <input
                      className="field-input-naked"
                      value={searchDest}
                      onChange={(e) => setSearchDest(e.target.value.toUpperCase())}
                      placeholder="Dest Code"
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
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn-primary-aero" style={{ height: '54px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
                  <span>Search Flights</span>
                </button>
              </form>
            </div>

            {/* Split Visual Deck */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', alignItems: 'stretch' }}>
              {/* Left Hero Card */}
              <div className="aero-hero-light" style={{ minHeight: '380px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div className="map-dots-ambient" />
                <div style={{ position: 'relative', zIndex: 2 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.7)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)' }}>
                    <span className="pulse-radar-dot" />
                    <span>Aviation Experience Reimagined</span>
                  </div>
                  <h2 style={{ fontSize: '2rem', fontWeight: 800, margin: '14px 0 8px', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                    Fly with effortless clarity across our global network.
                  </h2>
                  <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.95rem', maxWidth: 440, lineHeight: 1.5 }}>
                    Real-time radar flight status, live gate notifications, and personalized airport assistance right at your fingertips.
                  </p>
                </div>

                <div style={{ position: 'relative', zIndex: 2, display: 'flex', gap: '12px', marginTop: '20px' }}>
                  <Link to="/book" className="btn-primary-aero">
                    <span>Book a Flight</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
                  </Link>
                  <Link to="/my-flights" className="btn-secondary-aero">
                    <span>View My Flights</span>
                  </Link>
                </div>
              </div>

              {/* Right: Active Itinerary / Quick Status Card */}
              <div className="ticket-notch-card" style={{ padding: '28px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
                        airplane_ticket
                      </span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px' }}>
                        ACTIVE ITINERARY
                      </span>
                    </div>
                    {recentBooking && (
                      <span className="status-pill status-pill-green">
                        <span className="dot-indicator green" />
                        {recentBooking.flight_status || 'On Schedule'}
                      </span>
                    )}
                  </div>

                  {recentBooking ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '20px 0 10px' }}>
                        <div>
                          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                            {recentBooking.origin_code}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                            {new Date(recentBooking.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)' }}>
                            {recentBooking.flight_number}
                          </span>
                          <span className="material-symbols-outlined" style={{ color: 'var(--color-outline)', transform: 'rotate(90deg)', margin: '4px 0' }}>
                            flight
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--color-outline)' }}>Direct</span>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                            {recentBooking.dest_code}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                            {new Date(recentBooking.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '14px', background: 'var(--color-surface-low)', borderRadius: '14px', margin: '16px 0' }}>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)' }}>Seat</span>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                            {recentBooking.seat_number || '03A'}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)' }}>Booking Ref</span>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                            {recentBooking.booking_ref}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)' }}>Terminal</span>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                            T3 &middot; Gate 14B
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '8px' }}>
                        luggage
                      </span>
                      <p style={{ margin: '8px 0 0', fontWeight: 600 }}>No active flights booked yet.</p>
                      <p style={{ fontSize: '12px', margin: '4px 0 16px' }}>Ready for your next flight? Find great flights now.</p>
                      <Link to="/book" className="btn-primary-aero" style={{ padding: '8px 20px', fontSize: '13px' }}>
                        Book Flight Now
                      </Link>
                    </div>
                  )}
                </div>

                {recentBooking && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <Link to={`/track/${recentBooking.flight_id}`} className="btn-primary-aero" style={{ flex: 1, padding: '10px 16px', fontSize: '13px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>radar</span>
                      <span>Track Flight</span>
                    </Link>
                    <Link to="/my-flights" className="btn-secondary-aero" style={{ padding: '10px 16px', fontSize: '13px' }}>
                      <span>View Ticket</span>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ADMIN & OPS MANAGER VIEW                                       */}
        {/* ============================================================== */}
        {(user.role === 'admin' || user.role === 'ops_manager') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '24px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '32px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>admin_panel_settings</span>
                Authorized Administrative Access
              </div>
              <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>
                Airport Operations & Administration Hub
              </h1>
              <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1rem', maxWidth: 680, margin: '0 0 24px' }}>
                Central directory for managing flights, turnaround operations, terminal gates, emergency responses, and staff shift allocations.
              </p>
              <Link to="/admin" className="btn-primary-aero" style={{ fontSize: '15px', padding: '14px 32px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>grid_view</span>
                <span>Open Admin & Operations Hub &rarr;</span>
              </Link>
            </div>

            {/* Also render staff shifts */}
            <MyShifts token={token} />
          </div>
        )}

        {/* ============================================================== */}
        {/* GROUND CREW CONSOLE                                            */}
        {/* ============================================================== */}
        {user.role === 'ground_crew' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '24px 28px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                    <span className="dot-indicator green" />
                    Ramp & Apron Dispatch Live
                  </div>
                  <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, fontFamily: 'var(--font-display)' }}>
                    Ground Crew Turnaround Console
                  </h1>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span className="status-pill status-pill-green">
                    <span className="dot-indicator green" />
                    Apron Stand B4 Dispatch
                  </span>
                </div>
              </div>

              {/* 6-Step Turnaround Pipeline Display */}
              <div style={{ marginTop: '24px', padding: '20px', background: 'var(--color-surface-low)', borderRadius: '16px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.05em', display: 'block', marginBottom: '12px' }}>
                  Turnaround Milestones & Sequence
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                  <div style={{ padding: '12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: 'var(--color-on-surface-variant)' }}>
                      01. DEBOARD
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-success)' }}>check_circle</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-success)' }}>Completed</span>
                  </div>
                  <div style={{ padding: '12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: 'var(--color-on-surface-variant)' }}>
                      02. CLEAN
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-success)' }}>check_circle</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-success)' }}>Completed</span>
                  </div>
                  <div style={{ padding: '12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: 'var(--color-on-surface-variant)' }}>
                      03. FUEL
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-success)' }}>check_circle</span>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-success)' }}>Completed</span>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--color-surface-high)', borderRadius: '12px', border: '1.5px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)' }}>
                      04. CATERING
                      <span className="pulse-radar-dot" />
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-primary)' }}>In Progress</span>
                  </div>
                  <div style={{ padding: '12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', opacity: 0.7 }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-outline)' }}>05. BOARD</div>
                    <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>Queued</span>
                  </div>
                  <div style={{ padding: '12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', opacity: 0.7 }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-outline)' }}>06. PUSHBACK</div>
                    <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>Queued</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Real Turnaround board */}
            <TurnaroundBoard token={token} />
            <MyShifts token={token} />
            <AssistanceQueue token={token} />
            <EmergencyBoard token={token} />
          </div>
        )}

        {/* ============================================================== */}
        {/* MEDICAL CONSOLE                                                */}
        {/* ============================================================== */}
        {user.role === 'medical' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '24px 28px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>medical_services</span>
                    Medical Response Unit &middot; On-Duty
                  </div>
                  <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, fontFamily: 'var(--font-display)' }}>
                    Medical & Special Passenger Assistance Console
                  </h1>
                </div>
                <span className="status-pill status-pill-green">
                  <span className="dot-indicator green" />
                  Medical Unit Ready
                </span>
              </div>
            </div>

            <AssistanceQueue token={token} />
            <EmergencyBoard token={token} />
            <MyShifts token={token} />
          </div>
        )}

        {/* ============================================================== */}
        {/* SECURITY CONSOLE                                               */}
        {/* ============================================================== */}
        {user.role === 'security' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '24px 28px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-error)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>security</span>
                    Terminal Security Patrol &middot; Active
                  </div>
                  <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, fontFamily: 'var(--font-display)' }}>
                    Security Incident & Emergency Response Console
                  </h1>
                </div>
                <span className="status-pill status-pill-red">
                  <span className="dot-indicator red" />
                  Security Patrol Responding
                </span>
              </div>
            </div>

            <EmergencyBoard token={token} />
            <MyShifts token={token} />
          </div>
        )}

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Any staff member: their own shifts + clock in/out
// ---------------------------------------------------------------------
export function MyShifts({ token }) {
  const [shifts, setShifts] = useState([]);
  const [attendanceByShift, setAttendanceByShift] = useState({});
  const [error, setError] = useState(null);
  const [busyShiftId, setBusyShiftId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { shifts } = await apiFetch('/shifts/mine', { token });
      setShifts(shifts);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function clockIn(shiftId) {
    setBusyShiftId(shiftId);
    setError(null);
    try {
      const { attendance } = await apiFetch('/attendance/clock-in', {
        method: 'POST', token, body: { shift_id: shiftId },
      });
      setAttendanceByShift((prev) => ({ ...prev, [shiftId]: attendance }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  async function clockOut(shiftId) {
    const attendance = attendanceByShift[shiftId];
    if (!attendance) return;
    setBusyShiftId(shiftId);
    setError(null);
    try {
      const { attendance: updated } = await apiFetch('/attendance/clock-out', {
        method: 'POST', token, body: { attendance_id: attendance.id },
      });
      setAttendanceByShift((prev) => ({ ...prev, [shiftId]: updated }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
          schedule
        </span>
        <h2 style={{ ...styles.cardTitle, margin: 0 }}>My Scheduled Shifts & Duty Hours</h2>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {shifts.length === 0 && <p style={styles.muted}>No assigned shifts right now.</p>}
      {shifts.length > 0 && (
        <div className="aero-table-wrap">
          <table className="aero-table">
            <thead>
              <tr>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Assigned Zone / Area</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const a = attendanceByShift[s.id];
                const clockedIn = a && !a.clock_out;
                return (
                  <tr key={s.id}>
                    <td><strong>{new Date(s.start_time).toLocaleString()}</strong></td>
                    <td>{new Date(s.end_time).toLocaleString()}</td>
                    <td>
                      <span className="status-pill status-pill-blue">
                        {s.area_assigned || 'Terminal General'}
                      </span>
                    </td>
                    <td>
                      {!clockedIn && (
                        <button
                          className="btn-primary-aero"
                          style={{ padding: '6px 16px', fontSize: '12px' }}
                          disabled={busyShiftId === s.id}
                          onClick={() => clockIn(s.id)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>login</span>
                          <span>Clock In</span>
                        </button>
                      )}
                      {clockedIn && (
                        <button
                          className="btn-secondary-aero"
                          style={{ padding: '6px 16px', fontSize: '12px', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                          disabled={busyShiftId === s.id}
                          onClick={() => clockOut(s.id)}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>logout</span>
                          <span>Clock Out</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Admin + ops_manager: schedule shifts, see the conflict check live
// ---------------------------------------------------------------------
export function ShiftScheduler({ token }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: '', start_time: '', end_time: '', area_assigned: '' });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/employees', { token }).then((d) => setEmployees(d.employees)).catch((err) => setError(err.message));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setConflicts([]);
    setSubmitting(true);
    try {
      const { shift } = await apiFetch('/shifts', {
        method: 'POST', token,
        body: {
          employee_id: Number(form.employee_id),
          start_time: form.start_time,
          end_time: form.end_time,
          area_assigned: form.area_assigned || undefined,
        },
      });
      setSuccess(`Shift #${shift.id} successfully created and registered.`);
      setForm({ employee_id: '', start_time: '', end_time: '', area_assigned: '' });
    } catch (err) {
      setError(err.message);
      if (err.status === 409 && err.detail?.conflicts) {
        setConflicts(err.detail.conflicts);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--color-secondary)', fontSize: '24px' }}>
          more_time
        </span>
        <h2 style={{ ...styles.cardTitle, margin: 0 }}>Assign & Schedule Staff Shift</h2>
      </div>

      <form style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }} onSubmit={handleSubmit}>
        <label style={styles.label}>
          <span>Employee</span>
          <select
            style={styles.select}
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            required
          >
            <option value="" disabled>Select an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.role_title} ({e.department})
              </option>
            ))}
          </select>
        </label>
        <label style={styles.label}>
          <span>Start Time</span>
          <input
            style={styles.input}
            type="datetime-local"
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            required
          />
        </label>
        <label style={styles.label}>
          <span>End Time</span>
          <input
            style={styles.input}
            type="datetime-local"
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            required
          />
        </label>
        <label style={styles.label}>
          <span>Assigned Operational Area</span>
          <input
            style={styles.input}
            value={form.area_assigned}
            onChange={(e) => setForm({ ...form, area_assigned: e.target.value })}
            placeholder="e.g. Apron Stand B4 / Terminal 3"
          />
        </label>

        <div style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
          {error && <p style={styles.error}>{error}</p>}
          {success && <p style={styles.success}>{success}</p>}
          {conflicts.length > 0 && (
            <div style={{ padding: '14px', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', borderRadius: '12px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}>
                <span className="material-symbols-outlined">warning</span>
                <span>Real-Time Shift Overlap Conflict Detected!</span>
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '13px' }}>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    Shift #{c.id}: {new Date(c.start_time).toLocaleString()} – {new Date(c.end_time).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-primary-aero" type="submit" disabled={submitting}>
            <span className="material-symbols-outlined">schedule_send</span>
            <span>{submitting ? 'Registering Shift…' : 'Schedule Shift'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Admin only: create staff accounts, view roster
// ---------------------------------------------------------------------
export function StaffManagement({ token }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    name: '', email: '', role: 'ground_crew', department: '', role_title: '', certification: '',
  });
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      const { employees } = await apiFetch('/employees', { token });
      setEmployees(employees);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setSubmitting(true);
    try {
      const result = await apiFetch('/employees', { method: 'POST', token, body: form });
      setCreated(result);
      setForm({ name: '', email: '', role: 'ground_crew', department: '', role_title: '', certification: '' });
      loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Registration Card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
              person_add
            </span>
            <h2 style={{ ...styles.cardTitle, margin: 0 }}>Register New Airport Employee</h2>
          </div>
          <span style={{ padding: '4px 10px', borderRadius: '999px', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}>
            Admin Access Only
          </span>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <label style={styles.label}>
            <span>Employee Full Name</span>
            <input style={styles.input} placeholder="e.g. Robert Vance" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label style={styles.label}>
            <span>Operational Email Address</span>
            <input style={styles.input} type="email" placeholder="r.vance@meridianops.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label style={styles.label}>
            <span>Designation Role</span>
            <select style={styles.select} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="ground_crew">Ground Crew</option>
              <option value="security">Security</option>
              <option value="medical">Medical</option>
              <option value="ops_manager">Ops Manager</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <label style={styles.label}>
            <span>Department</span>
            <input style={styles.input} placeholder="e.g. Ground Operations / Medical Unit" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required />
          </label>
          <label style={styles.label}>
            <span>Role Title</span>
            <input style={styles.input} placeholder="e.g. Apron Marshaller Lead" value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} required />
          </label>
          <label style={styles.label}>
            <span>Operational Certification (optional)</span>
            <input style={styles.input} placeholder="e.g. CPR / First Aid, Basic Ramp" value={form.certification} onChange={(e) => setForm({ ...form, certification: e.target.value })} />
          </label>

          <div style={{ gridColumn: '1 / -1', marginTop: '6px' }}>
            {error && <p style={styles.error}>{error}</p>}
            {created && (
              <p style={styles.success}>
                Registered employee {created.employee.user.name} ({created.employee.user.email}).{' '}
                {created.emailSent
                  ? 'Credentials dispatched via email.'
                  : 'Generated temporary access key:'}{' '}
                {!created.emailSent && <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px' }}>{created.tempPassword}</code>}
              </p>
            )}
            <button className="btn-primary-aero" type="submit" disabled={submitting}>
              <span className="material-symbols-outlined">how_to_reg</span>
              <span>{submitting ? 'Registering…' : 'Register Staff Member'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Roster Table Card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
              groups
            </span>
            <h2 style={{ ...styles.cardTitle, margin: 0 }}>Registered Staff Directory & Roster</h2>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-outline)' }}>
            {employees.length} Staff Registered
          </span>
        </div>

        <div className="aero-table-wrap">
          <table className="aero-table">
            <thead>
              <tr>
                <th>Personnel Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Role Title</th>
                <th>Duty Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>
                    <span className="status-pill status-pill-blue">
                      {e.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{e.department}</td>
                  <td>{e.role_title}</td>
                  <td>
                    <span className="status-pill status-pill-green">
                      <span className="dot-indicator green" />
                      {e.status || 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-outline)' }}>
                    No staff members registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
