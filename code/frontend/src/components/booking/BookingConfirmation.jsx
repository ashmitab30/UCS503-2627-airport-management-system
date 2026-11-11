/**
 * BookingConfirmation — post-payment confirmation screen showing the
 * issued boarding pass card and quick-action links.
 */
import { Link } from 'react-router-dom';

export default function BookingConfirmation({ booking }) {
  return (
    <div style={{ maxWidth: 640, margin: '20px auto 40px' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--color-success-bg)', color: 'var(--color-success-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>check_circle</span>
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', margin: 0 }}>Booking Confirmed!</h2>
        <p style={{ color: 'var(--color-slate)', marginTop: '4px' }}>Your electronic boarding pass has been issued.</p>
      </div>

      <div className="boarding-pass-hero">
        <div className="map-dots-dark" />
        <div style={{ padding: '32px 32px 20px', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>flight_takeoff</span>
              <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>MERIDIAN OPS</span>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px', borderRadius: '999px', background: 'rgba(255,255,255,0.2)' }}>
              BOARDING PASS
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 0' }}>
            <div>
              <div style={{ fontSize: '2.8rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{booking.origin_code}</div>
              <span style={{ fontSize: '13px', opacity: 0.85, marginTop: '6px', display: 'block' }}>
                {new Date(booking.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em' }}>{booking.flight_number}</span>
              <div style={{ width: '80px', height: '2px', background: 'rgba(255,255,255,0.4)', margin: '6px 0', position: 'relative' }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', top: '-11px', left: '32px', fontSize: '20px' }}>flight</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '2.8rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{booking.dest_code}</div>
              <span style={{ fontSize: '13px', opacity: 0.85, marginTop: '6px', display: 'block' }}>
                {new Date(booking.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>

        <div className="ticket-notch-row" style={{ background: 'transparent' }}>
          <div className="ticket-notch-left" />
          <div className="ticket-perf-line" style={{ borderTopColor: 'rgba(255,255,255,0.4)' }} />
          <div className="ticket-notch-right" />
        </div>

        <div style={{ padding: '24px 32px 32px', background: 'rgba(0,20,60,0.25)', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '16px' }}>
            {[
              { label: 'Passenger', value: booking.passenger_name || 'Passenger' },
              { label: 'Booking Ref', value: booking.booking_ref, highlight: true },
              { label: 'Seat', value: booking.seat_number },
              { label: 'Gate', value: booking.gate_code || 'TBD' },
            ].map(({ label, value, highlight }) => (
              <div key={label}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>{label}</span>
                <div style={{ fontSize: '14px', fontWeight: 800, marginTop: '2px', color: highlight ? '#c4e7ff' : undefined }}>{value}</div>
              </div>
            ))}
          </div>
          {booking.assistance_type && (
            <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(255,255,255,0.12)', borderRadius: '10px', fontSize: '12px' }}>
              <span style={{ fontWeight: 800 }}>Assistance Dispatch:</span> {booking.assistance_type.replace('_', ' ')}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', marginTop: '28px', flexWrap: 'wrap' }}>
        <Link to={`/boarding-pass/${booking.id}`} className="btn-primary-aero" style={{ padding: '12px 28px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>qr_code</span>
          <span>View Boarding Pass</span>
        </Link>
        <Link to="/my-flights" className="btn-secondary-aero" style={{ padding: '12px 28px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>luggage</span>
          <span>My Flights</span>
        </Link>
      </div>
    </div>
  );
}
