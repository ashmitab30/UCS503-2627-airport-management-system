import { useEffect } from 'react';
import { formatINR, formatDate } from '../../utils/format.js';

/**
 * CancelBookingModal
 * Styled confirmation dialog replacing native window.confirm for booking cancellation.
 * Displays clear cancellation details, mock refund terms, keyboard Esc handling,
 * and double-submission protection.
 */
export default function CancelBookingModal({
  isOpen,
  booking,
  onClose,
  onConfirm,
  loading = false,
  error = null,
}) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !booking) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        backgroundColor: 'rgba(10, 25, 47, 0.65)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--color-surface-lowest, #ffffff)',
          borderRadius: 'var(--radius-lg, 20px)',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: 'var(--shadow-elevated, 0 16px 40px rgba(6, 27, 58, 0.16))',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        {/* Header alert strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '1.25rem 1.5rem',
            background: 'var(--color-error-container, #ffdad6)',
            color: 'var(--color-on-error-container, #93000a)',
            borderBottom: '1px solid rgba(186, 26, 26, 0.2)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'rgba(186, 26, 26, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#ba1a1a' }}>
              warning
            </span>
          </div>
          <div>
            <h2
              id="cancel-modal-title"
              style={{
                margin: 0,
                fontSize: '1.15rem',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                color: '#93000a',
                lineHeight: 1.2,
              }}
            >
              Cancel Booking
            </h2>
            <span style={{ fontSize: '12px', color: '#93000a', opacity: 0.9 }}>
              This action cannot be undone
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.5rem' }}>
          <p
            style={{
              margin: '0 0 1rem',
              fontSize: '13.5px',
              lineHeight: 1.5,
              color: 'var(--color-on-surface-variant, #424656)',
            }}
          >
            Are you sure you want to cancel this booking? Any mock payment will be refunded to your original payment method.
          </p>

          {/* Flight Summary Card */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: 'var(--color-surface-low, #f1f3ff)',
              border: '1px solid rgba(194, 198, 216, 0.6)',
              marginBottom: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '12.5px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
                {booking.flight_number} · {booking.origin_code} → {booking.dest_code}
              </span>
              <span style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                {formatINR(booking.price_cents)}
              </span>
            </div>
            <div style={{ color: 'var(--color-slate, #424656)', fontSize: '12px' }}>
              Departure: {formatDate(booking.scheduled_departure)} · Seat: {booking.seat_number || '—'} ({booking.seat_class || 'Economy'})
            </div>
            <div style={{ color: 'var(--color-success-text, #065f46)', fontSize: '11.5px', fontWeight: 600 }}>
              ✓ Full mock refund of {formatINR(booking.price_cents)} will be processed
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'var(--color-error-container, #ffdad6)',
                color: 'var(--color-on-error-container, #93000a)',
                fontSize: '12px',
                fontWeight: 600,
                marginBottom: '1rem',
              }}
            >
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary-aero"
              style={{ padding: '9px 20px', fontSize: '13px' }}
            >
              Keep booking
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="btn-primary-aero"
              style={{
                padding: '9px 22px',
                fontSize: '13px',
                background: 'linear-gradient(135deg, #ba1a1a 0%, #dc2626 100%)',
                boxShadow: '0 4px 14px rgba(186, 26, 26, 0.35)',
              }}
            >
              {loading ? (
                <span>Cancelling…</span>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    delete_forever
                  </span>
                  <span>Cancel booking</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
