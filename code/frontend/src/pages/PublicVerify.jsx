import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';
import { formatDateTime } from '../utils/format.js';

export default function PublicVerify() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const sig = searchParams.get('sig');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!ref || !sig) {
        setError('Missing booking reference or security signature.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await apiFetch(`/verify/${encodeURIComponent(ref)}?sig=${encodeURIComponent(sig)}`);
        if (active) {
          setData(res);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Invalid or expired verification link');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [ref, sig]);

  return (
    <div style={{ minHeight: '100vh', background: colors.background, padding: '40px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Top Brand Logo */}
      <div style={{ marginBottom: '24px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: '18px' }}>
            M
          </div>
          <span style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-display)', color: colors.ink, letterSpacing: '-0.02em' }}>
            MERIDIAN AIR
          </span>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: colors.slate, letterSpacing: '0.05em', marginTop: '4px' }}>
          OFFICIAL PASSENGER VERIFICATION PORTAL
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: '520px' }}>
        {loading ? (
          <div style={{ ...styles.card, textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '15px', color: colors.slate, fontWeight: 600 }}>
              Verifying cryptographic signature…
            </div>
          </div>
        ) : error ? (
          <div style={{ ...styles.card, borderTop: `4px solid ${colors.danger}`, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: colors.dangerBg, color: colors.dangerText, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>gpp_bad</span>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: colors.ink, margin: '0 0 8px' }}>
              Boarding Pass Not Verified
            </h2>
            <p style={{ fontSize: '13px', color: colors.slate, margin: '0 0 20px', lineHeight: 1.5 }}>
              The digital signature is invalid, has been tampered with, or refers to an unconfirmed reservation.
            </p>
            <div style={{ padding: '12px', background: colors.surfaceLow, borderRadius: '8px', fontSize: '12px', color: colors.muted }}>
              Error: {error}
            </div>
            <div style={{ marginTop: '24px' }}>
              <Link to="/login" className="btn-secondary-aero" style={{ textDecoration: 'none', display: 'inline-block' }}>
                Sign In to Meridian
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ ...styles.card, borderTop: `4px solid ${colors.success}`, padding: '0', overflow: 'hidden' }}>
            {/* Header banner */}
            <div style={{ background: colors.successBg, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="material-symbols-outlined" style={{ color: colors.successText, fontSize: '28px' }}>
                verified
              </span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: colors.successText, letterSpacing: '0.02em' }}>
                  VALID BOARDING PASS
                </div>
                <div style={{ fontSize: '11px', color: colors.successText }}>
                  Cryptographically signed & verified with Meridian Air authority
                </div>
              </div>
            </div>

            {/* Flight Route Visual */}
            <div style={{ padding: '24px', borderBottom: `1px solid ${colors.lineSoft}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 900, color: colors.primary, fontFamily: 'var(--font-display)' }}>
                    {data.origin}
                  </div>
                  <div style={{ fontSize: '12px', color: colors.slate }}>{data.origin_city || 'Origin'}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: colors.slate }}>{data.flight_number}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '32px', height: '2px', background: colors.line }}></div>
                    <span className="material-symbols-outlined" style={{ color: colors.primary, fontSize: '18px' }}>flight</span>
                    <div style={{ width: '32px', height: '2px', background: colors.line }}></div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '28px', fontWeight: 900, color: colors.primary, fontFamily: 'var(--font-display)' }}>
                    {data.destination}
                  </div>
                  <div style={{ fontSize: '12px', color: colors.slate }}>{data.dest_city || 'Destination'}</div>
                </div>
              </div>
            </div>

            {/* Passenger & Flight Details */}
            <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: '#fff' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: colors.muted, textTransform: 'uppercase' }}>Passenger</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginTop: '2px' }}>{data.passenger_name}</div>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: colors.muted, textTransform: 'uppercase' }}>Booking Ref</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: colors.primary, marginTop: '2px', letterSpacing: '0.04em' }}>{data.booking_ref}</div>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: colors.muted, textTransform: 'uppercase' }}>Seat / Class</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginTop: '2px' }}>
                  {data.seat_number} <span style={{ fontSize: '12px', color: colors.slate, fontWeight: 600 }}>({data.seat_class})</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: colors.muted, textTransform: 'uppercase' }}>Boarding Status</div>
                <div style={{ marginTop: '2px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    background: data.booking_status === 'boarded' ? colors.successBg : colors.primaryFixed,
                    color: data.booking_status === 'boarded' ? colors.successText : colors.primary,
                  }}>
                    {data.booking_status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: colors.muted, textTransform: 'uppercase' }}>Departure Time</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: colors.slate, marginTop: '2px' }}>
                  {data.departure_date ? formatDateTime(data.departure_date) : 'Scheduled'}
                </div>
              </div>
            </div>

            {/* Security notice footer */}
            <div style={{ padding: '14px 24px', background: colors.surfaceLow, borderTop: `1px solid ${colors.lineSoft}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: colors.muted }}>lock</span>
              <span style={{ fontSize: '11px', color: colors.muted, lineHeight: 1.4 }}>
                Tamper-evident verification token validated against Meridian Air core reservation ledger.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
