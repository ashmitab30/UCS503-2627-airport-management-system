import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';

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
    // Refresh every 30s so the progress bar/ETA update while the page is
    // open — still derived from schedule, not a live feed (see backend
    // comment), just re-computed periodically.
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [flightId, token]);

  return (
    <main style={styles.bookingWrap}>
      <nav style={{ ...styles.nav, border: 'none', marginBottom: '1.2rem' }}>
        <Link to="/my-flights" style={{ fontSize: '0.85rem', color: colors.accent }}>&larr; Back</Link>
      </nav>
      <h1 style={styles.title}>Live flight tracking</h1>
      {error && <p style={styles.error}>{error}</p>}
      {!error && !data && <p style={styles.muted}>Loading…</p>}

      {data && (
        <>
          <div className="track-map-card">
            <div className="tm-dots" />
            <span className="track-status-pill">
              {data.flight.flight_number} &middot; {phaseLabel(data.tracking.phase)}
              {data.tracking.eta_minutes != null ? ` · arriving in ${data.tracking.eta_minutes}m` : ''}
            </span>
            <div style={{ position: 'relative', zIndex: 2, marginTop: '1.4rem' }}>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${data.tracking.progress_pct}%`,
                  background: '#fff', borderRadius: 99, transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8rem', color: '#fff' }}>
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{data.flight.origin_code}</div>
                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)' }}>
                    {formatTime(data.flight.scheduled_departure)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{data.flight.dest_code}</div>
                  <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)' }}>
                    ETA {formatTime(data.flight.scheduled_arrival)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem', marginTop: '1rem' }}>
            <div style={styles.card}>
              <div style={{ fontSize: '0.7rem', color: colors.muted, textTransform: 'uppercase' }}>Altitude (est.)</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                {data.tracking.estimated_altitude_ft != null ? `${data.tracking.estimated_altitude_ft.toLocaleString()} ft` : '—'}
              </div>
            </div>
            <div style={styles.card}>
              <div style={{ fontSize: '0.7rem', color: colors.muted, textTransform: 'uppercase' }}>Speed (est.)</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                {data.tracking.estimated_speed_kmh != null ? `${data.tracking.estimated_speed_kmh} km/h` : '—'}
              </div>
            </div>
            <div style={styles.card}>
              <div style={{ fontSize: '0.7rem', color: colors.muted, textTransform: 'uppercase' }}>Status</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, textTransform: 'capitalize' }}>{data.flight.status}</div>
            </div>
          </div>

          <div style={{ ...styles.card, marginTop: '1rem' }}>
            <h3 style={styles.cardTitle}>Flight info</h3>
            <p style={{ fontSize: '0.85rem', margin: '0.3rem 0' }}>Aircraft: {data.flight.aircraft_model}</p>
            <p style={{ fontSize: '0.85rem', margin: '0.3rem 0' }}>Gate: {data.flight.gate_code || 'Not yet assigned'}</p>
          </div>

          <p style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '1rem' }}>
            Position, altitude, and speed are estimated from the flight's schedule, not a live tracking feed.
          </p>
        </>
      )}
    </main>
  );
}

function phaseLabel(phase) {
  return { scheduled: 'Scheduled', in_air: 'Airborne', landed: 'Landed', cancelled: 'Cancelled', diverted: 'Diverted' }[phase] || phase;
}
function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}
