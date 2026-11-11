/**
 * BookingHoldModal — timed hold checkout panel.
 * Shows a 10-minute countdown, mock payment form, and confirm button.
 * When the hold expires it shows an expired state with a re-search prompt.
 */
import { useState, useEffect, useRef } from 'react';

const ASSISTANCE_OPTIONS = [
  { value: '', label: 'Standard Clearance', desc: 'No special assistance needed', icon: 'check_circle' },
  { value: 'wheelchair', label: 'Wheelchair Mobility', desc: 'Ramp buggy and gate-to-aircraft boarding support', icon: 'accessible' },
  { value: 'medical', label: 'Medical & Oxygen Support', desc: 'Paramedic standby and supplemental cabin oxygen', icon: 'medical_services' },
  { value: 'visual', label: 'Visual Guidance', desc: 'Dedicated escort through check-in, security, and gate', icon: 'visibility' },
  { value: 'hearing', label: 'Hearing Support', desc: 'Visual gate paging and priority SMS flight alerts', icon: 'hearing' },
  { value: 'elderly_support', label: 'Senior Support', desc: 'Dedicated ground agent for baggage and gate transit', icon: 'elderly' },
];

export default function BookingHoldModal({
  flight,
  seat,
  assistanceType,
  assistanceNotes,
  heldUntil,          // ISO string from API — when the hold expires
  onAssistanceChange,
  onNotesChange,
  onConfirm,          // () => void — user clicks "Confirm & Pay"
  onExpired,          // () => void — hold expired, start over
  loading,
  error,
}) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!heldUntil) return;
    const expiry = new Date(heldUntil).getTime();

    function tick() {
      const diff = Math.floor((expiry - Date.now()) / 1000);
      if (diff <= 0) {
        setSecondsLeft(0);
        clearInterval(timerRef.current);
        onExpired?.();
      } else {
        setSecondsLeft(diff);
      }
    }

    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [heldUntil, onExpired]);

  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : '—';
  const secs = secondsLeft !== null ? String(secondsLeft % 60).padStart(2, '0') : '--';
  const isExpired = secondsLeft === 0;
  const isWarning = secondsLeft !== null && secondsLeft < 90;

  const priceCents = seat?.price_cents ?? 0;
  const priceFormatted = (priceCents / 100).toFixed(2);

  if (isExpired) {
    return (
      <div className="ticket-notch-card" style={{ padding: '36px', textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-error)', marginBottom: '8px' }}>
          timer_off
        </span>
        <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, margin: '8px 0 4px' }}>Hold Expired</h3>
        <p style={{ color: 'var(--color-slate)', fontSize: '14px', margin: '0 0 20px' }}>
          Your 10-minute seat hold has expired and the seat has been released. Please search again to book.
        </p>
        <button className="btn-primary-aero" onClick={onExpired} style={{ padding: '12px 28px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>search</span>
          <span>Search Again</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hold Timer Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 20px',
        borderRadius: '14px',
        background: isWarning ? 'rgba(239, 68, 68, 0.08)' : 'rgba(29, 99, 255, 0.07)',
        border: `1.5px solid ${isWarning ? 'rgba(239,68,68,0.3)' : 'rgba(29,99,255,0.2)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined" style={{ color: isWarning ? 'var(--color-error)' : 'var(--color-primary)', fontSize: '20px' }}>
            timer
          </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: isWarning ? 'var(--color-error)' : 'var(--color-primary)' }}>
            Seat held for
          </span>
        </div>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.6rem',
          color: isWarning ? 'var(--color-error)' : 'var(--color-primary)',
          letterSpacing: '0.04em',
        }}>
          {mins}:{secs}
        </span>
      </div>

      {/* Booking Summary */}
      <div className="ticket-notch-card">
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem' }}>
              {flight.flight_number}
            </span>
            <span className="status-pill status-pill-blue">{seat?.class?.replace('_', ' ')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>From</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>{flight.origin_code}</div>
              <div style={{ fontSize: '11px', color: 'var(--color-slate)' }}>
                {new Date(flight.scheduled_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ textAlign: 'center', paddingTop: '12px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '24px', color: 'var(--color-outline)' }}>flight_takeoff</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--color-slate)', textTransform: 'uppercase', fontWeight: 700 }}>To</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)' }}>{flight.dest_code}</div>
              <div style={{ fontSize: '11px', color: 'var(--color-slate)' }}>
                {new Date(flight.scheduled_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        </div>
        <div className="ticket-notch-row">
          <div className="ticket-notch-left" />
          <div className="ticket-perf-line" />
          <div className="ticket-notch-right" />
        </div>
        <div style={{ padding: '14px 24px', background: 'var(--color-surface-low)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>Seat</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>{seat?.seat_number}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-outline)', display: 'block' }}>Total Fare</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>₹{priceFormatted}</span>
          </div>
        </div>
      </div>

      {/* Assistance Selection */}
      <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>accessibility_new</span>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', margin: 0 }}>
            Ground & Cabin Passenger Care
          </h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '14px' }}>
          {ASSISTANCE_OPTIONS.map((opt) => {
            const isSelected = assistanceType === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => onAssistanceChange(opt.value)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: isSelected ? 'var(--color-surface-container)' : 'var(--color-surface-low)',
                  border: isSelected ? '2px solid var(--color-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onAssistanceChange(opt.value)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: isSelected ? 'var(--color-primary)' : 'var(--color-outline)', marginTop: '1px' }}>
                  {opt.icon}
                </span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '13px', fontFamily: 'var(--font-display)' }}>{opt.label}</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-slate)', marginTop: '2px', lineHeight: 1.4 }}>{opt.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
        {assistanceType && (
          <div>
            <label style={{ fontSize: '12px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-slate)', display: 'block', marginBottom: '6px' }}>
              Special Notes for Ground Crew
            </label>
            <textarea
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1.5px solid rgba(194, 198, 216, 0.7)',
                fontSize: '13px',
                fontFamily: 'var(--font-body)',
                background: 'var(--color-surface-low)',
                outline: 'none',
                resize: 'vertical',
                minHeight: '64px',
                boxSizing: 'border-box',
              }}
              placeholder="e.g. Passenger brings foldable wheelchair with lithium battery..."
              value={assistanceNotes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Mock Payment + Confirm */}
      <div style={{ background: 'var(--color-surface-lowest)', borderRadius: '20px', border: '1px solid rgba(226, 232, 240, 0.9)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>credit_card</span>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', margin: 0 }}>
            Payment <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-slate)', textTransform: 'uppercase' }}>[Simulated — no real charges]</span>
          </h3>
        </div>
        <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface-low)', border: '1.5px solid rgba(194,198,216,0.5)', fontSize: '14px', color: 'var(--color-slate)', marginBottom: '16px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>lock</span>
          Mock Visa •••• 4242 — ₹{priceFormatted}
        </div>
        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: '13px', marginBottom: '12px', fontWeight: 600 }}>{error}</p>
        )}
        <button
          className="btn-primary-aero"
          onClick={onConfirm}
          disabled={loading}
          style={{ width: '100%', padding: '14px', fontSize: '15px', justifyContent: 'center' }}
        >
          <span>{loading ? 'Processing Payment…' : `Confirm & Pay ₹${priceFormatted}`}</span>
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>verified</span>
        </button>
      </div>
    </div>
  );
}

