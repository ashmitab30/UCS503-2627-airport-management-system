import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import SiteHeader from './SiteHeader.jsx';

export default function BoardingPass() {
  const { id } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/bookings/${id}/boarding-pass`, { token })
      .then((res) => setData(res.boarding_pass))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, token]);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
        <SiteHeader />
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--color-slate)' }}>
          <p>Generating digital boarding pass…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
        <SiteHeader />
        <main style={{ maxWidth: 640, margin: '3rem auto', padding: '0 24px', textAlign: 'center' }}>
          <div className="ticket-notch-card" style={{ padding: '32px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-critical)' }}>
              error_outline
            </span>
            <h2 style={{ fontFamily: 'var(--font-display)', margin: '12px 0 8px' }}>Could not load boarding pass</h2>
            <p style={{ color: 'var(--color-slate)', marginBottom: '24px' }}>{error || 'Booking not found'}</p>
            <Link to="/my-flights" className="btn-primary-aero">
              Back to My Flights
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const depDate = new Date(data.scheduled_departure);
  const boardingTime = new Date(depDate.getTime() - 40 * 60_000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const depTimeStr = depDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      <main style={{ maxWidth: 760, width: '100%', margin: '2rem auto 4rem', padding: '0 24px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <Link to="/my-flights" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-slate)', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
            Back to Itineraries
          </Link>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => window.print()}
              className="btn-glass"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>print</span>
              Print Pass
            </button>
            <a
              href={`${API_URL}/bookings/${id}/boarding-pass.pdf`}
              download
              className="btn-primary-aero"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px', textDecoration: 'none' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>download</span>
              Download PDF
            </a>
          </div>
        </div>

        {/* Boarding Pass Artifact matching Stitch Reference 8e1fe92a31c14d089ef9b4c1275dbbfd */}
        <div className="ticket-notch-card" style={{ background: 'var(--color-surface-container)', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,8,20,0.45)' }}>
          {/* Header Banner */}
          <div style={{ background: 'linear-gradient(135deg, #1D63FF 0%, #0052CC 100%)', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>airlines</span>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>MERIDIAN AIR</div>
                <div style={{ fontSize: '11px', opacity: 0.85, letterSpacing: '0.06em' }}>OFFICIAL BOARDING PASS</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="status-pill" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                <span className="dot-indicator green" />
                {data.status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Pass Body */}
          <div style={{ padding: '28px 32px' }}>
            {/* Route IATA and Flight Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Departing</span>
                <div style={{ fontSize: '2.8rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1, margin: '4px 0' }}>
                  {data.origin_code}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>{data.origin_name}</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="status-pill status-pill-blue" style={{ marginBottom: '6px' }}>{data.flight_number}</span>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '28px' }}>
                  flight_takeoff
                </span>
                <span style={{ fontSize: '10px', color: 'var(--color-slate)', marginTop: '4px' }}>NON-STOP</span>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Arriving</span>
                <div style={{ fontSize: '2.8rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1, margin: '4px 0' }}>
                  {data.dest_code}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>{data.dest_name}</div>
              </div>
            </div>

            {/* Grid Telemetry */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: 'var(--color-surface-low)', padding: '16px 20px', borderRadius: '16px', marginBottom: '24px' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Passenger</div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)', marginTop: '4px' }}>{data.passenger_name}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Gate</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-secondary)', marginTop: '2px' }}>{data.gate_code || 'TBD'}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Seat</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-primary)', marginTop: '2px' }}>{data.seat_number || 'TBD'}</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Class</div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)', marginTop: '4px', textTransform: 'capitalize' }}>
                  {data.seat_class || 'Economy'}
                </div>
              </div>
            </div>

            {/* Boarding and Departure Times */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(29, 99, 255, 0.08)', padding: '12px 18px', borderRadius: '12px', borderLeft: '3px solid var(--color-primary)' }}>
                <span style={{ fontSize: '10.5px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Boarding Starts</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-on-surface)', marginTop: '2px' }}>{boardingTime}</div>
              </div>
              <div style={{ background: 'rgba(56, 189, 248, 0.08)', padding: '12px 18px', borderRadius: '12px', borderLeft: '3px solid var(--color-secondary)' }}>
                <span style={{ fontSize: '10.5px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>Scheduled Departure</span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-on-surface)', marginTop: '2px' }}>{depTimeStr}</div>
              </div>
            </div>

            {data.priority_boarding && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(2, 132, 199, 0.15)', color: '#38bdf8', padding: '6px 14px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, marginBottom: '20px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>star</span>
                PRIORITY BOARDING ASSISTANCE ACTIVE ({data.assistance_type?.toUpperCase()})
              </div>
            )}
          </div>

          {/* Perforated Tear Line with Notches */}
          <div className="ticket-notch-row">
            <div className="ticket-notch-left" />
            <div className="ticket-perf-line" />
            <div className="ticket-notch-right" />
          </div>

          {/* QR Code and Verification Stub */}
          <div style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-surface-low)' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-slate)', letterSpacing: '0.05em' }}>SECURITY VERIFICATION & TSA QR</div>
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                Present at terminal checkpoint scanner and gate boarding bridge.
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-slate)', marginTop: '8px' }}>
                Booking Ref: <strong style={{ color: 'var(--color-primary)' }}>{data.booking_ref}</strong> &middot; E-Ticket #ETK-{data.id}892
              </div>
            </div>

            {data.qr_code_data_url && (
              <div style={{ background: '#fff', padding: '6px', borderRadius: '10px', display: 'inline-flex' }}>
                <img src={data.qr_code_data_url} alt="Boarding Pass QR Code" style={{ width: '100px', height: '100px' }} />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

