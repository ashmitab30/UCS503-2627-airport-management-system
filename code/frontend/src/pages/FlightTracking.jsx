import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';

export default function FlightTracking() {
  const { flightId } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      apiFetch(`/tracking/${flightId}`, { token })
        .then((d) => { if (!cancelled) setData(d); })
        .catch((err) => { if (!cancelled) setError(err.message); });
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [flightId, token]);

  function phaseLabel(phase) {
    if (!phase) return 'Scheduled';
    return phase.replace('_', ' ').toUpperCase();
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      <main style={{ maxWidth: 960, width: '100%', margin: '2rem auto 4rem', padding: '0 24px', flex: 1 }}>
        <div style={{ marginBottom: '20px' }}>
          <Link
            to="/my-flights"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--color-primary)',
              textDecoration: 'none',
              marginBottom: '12px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
            <span>Back to My Flights</span>
          </Link>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 800, margin: '4px 0 0', letterSpacing: '-0.02em' }}>
            Live Flight Radar & Tracking
          </h1>
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {!error && !data && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-slate)' }}>
            <p>Acquiring live avionics telemetry…</p>
          </div>
        )}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Live Track HUD Card */}
            <div className="boarding-pass-hero" style={{ padding: '32px' }}>
              <div className="map-dots-dark" />
              <div style={{ position: 'relative', zIndex: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255, 255, 255, 0.3)', color: '#fff', fontSize: '12px', fontWeight: 800 }}>
                    <span className="pulse-radar-dot" />
                    <span>Flight #{data.flight.flight_number} &middot; {phaseLabel(data.tracking.phase)}</span>
                  </div>

                  {data.tracking.eta_minutes != null && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#c4e7ff' }}>
                      Estimated arrival in {data.tracking.eta_minutes}m
                    </span>
                  )}
                </div>

                {/* Progress Arc / Bar */}
                <div style={{ marginTop: '20px' }}>
                  <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.25)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(5, data.tracking.progress_pct || 0))}%`,
                        background: 'linear-gradient(90deg, #38bdf8 0%, #ffffff 100%)',
                        borderRadius: '999px',
                        transition: 'width 0.6s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
                    <div>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {data.flight.origin_code}
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.8)', marginTop: '4px' }}>
                        Departed {formatTime(data.flight.scheduled_departure)}
                      </div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#38bdf8' }}>
                        radar
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                        {data.flight.dest_code}
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.8)', marginTop: '4px' }}>
                        ETA {formatTime(data.flight.scheduled_arrival)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Telemetry Metric Tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <div className="ticket-notch-card" style={{ padding: '20px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.04em' }}>
                  Estimated Altitude
                </span>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', marginTop: '4px' }} className="telemetry">
                  {data.tracking.estimated_altitude_ft != null ? `${data.tracking.estimated_altitude_ft.toLocaleString()} FT` : '—'}
                </div>
              </div>

              <div className="ticket-notch-card" style={{ padding: '20px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.04em' }}>
                  Estimated Speed
                </span>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', marginTop: '4px' }} className="telemetry">
                  {data.tracking.estimated_speed_kmh != null ? `${data.tracking.estimated_speed_kmh} KM/H` : '—'}
                </div>
              </div>

              <div className="ticket-notch-card" style={{ padding: '20px' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', letterSpacing: '0.04em' }}>
                  Flight Status
                </span>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)', marginTop: '4px', textTransform: 'capitalize' }}>
                  {data.flight.status}
                </div>
              </div>
            </div>

            {/* Aircraft & Gate Info */}
            <div className="ticket-notch-card" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 14px', fontFamily: 'var(--font-display)' }}>
                Aircraft Equipment & Gate Allocation
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-outline)', textTransform: 'uppercase' }}>Aircraft Model</span>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)', marginTop: '2px' }}>
                    {data.flight.aircraft_model || 'Airbus A320neo'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-outline)', textTransform: 'uppercase' }}>Gate Assignment</span>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)', marginTop: '2px' }}>
                    {data.flight.gate_code ? `Gate ${data.flight.gate_code}` : 'Pending Runway Cleared'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-outline)', textTransform: 'uppercase' }}>Passenger Cabin</span>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)', marginTop: '2px' }}>
                    Terminal 3 &middot; Pier South
                  </div>
                </div>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--color-slate)', margin: '0', textAlign: 'center' }}>
              Position, altitude, and ground speed are calculated from the active dispatch flight schedule and waypoint tracking engine.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
