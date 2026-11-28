import { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate } from '../../utils/format.js';

/**
 * UnlinkConnectionModal
 * Confirmation dialog for unlinking a connecting itinerary.
 * Informs admin that the individual bookings remain untouched and confirmed.
 */
export default function UnlinkConnectionModal({ isOpen, connection, onClose, onSuccess, passengerMode = false }) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    function handleKeyDown(e) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen || !connection) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = passengerMode
        ? `/connections/mine/${connection.id}`
        : `/connections/${connection.id}`;
      await apiFetch(endpoint, {
        method: 'DELETE',
        token,
      });
      if (onSuccess) onSuccess(connection.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to unlink connection');
    } finally {
      setSubmitting(false);
    }
  };

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
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlink-modal-title"
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
            background: 'var(--color-warning-container, #fef3c7)',
            color: 'var(--color-on-warning-container, #92400e)',
            borderBottom: '1px solid rgba(217, 119, 6, 0.2)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'rgba(217, 119, 6, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#b45309' }}>
              link_off
            </span>
          </div>
          <div>
            <h2
              id="unlink-modal-title"
              style={{
                margin: 0,
                fontSize: '1.15rem',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                color: '#92400e',
                lineHeight: 1.2,
              }}
            >
              Unlink Connection
            </h2>
            <span style={{ fontSize: '12px', color: '#b45309', opacity: 0.9 }}>
              Bookings will stay as they are
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
            {passengerMode ? (
              <>
                Are you sure you want to unlink this connecting itinerary? Both of your individual flight bookings will remain confirmed and unchanged.
              </>
            ) : (
              <>
                Are you sure you want to unlink this connecting itinerary for passenger{' '}
                <strong>{connection.passenger_name}</strong>?
              </>
            )}
          </p>

          {/* Connection Summary Card */}
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
              <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-primary, #0052cc)' }}>
                {connection.inbound_origin_code} → {connection.hub_code} → {connection.destination_code || connection.outbound_dest_code}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-slate, #424656)' }}>
                Transfer Hub: {connection.hub_code}
              </span>
            </div>
            <div style={{ color: 'var(--color-slate, #424656)', fontSize: '12px' }}>
              <strong>Inbound:</strong> {connection.inbound_flight_number} (PNR #{connection.inbound_booking_ref || connection.booking_ref}) · {formatDate(connection.inbound_departure)}
            </div>
            <div style={{ color: 'var(--color-slate, #424656)', fontSize: '12px' }}>
              <strong>Outbound:</strong> {connection.outbound_flight_number} (PNR #{connection.outbound_booking_ref || '—'}) · {formatDate(connection.outbound_departure)}
            </div>
            <div style={{ color: 'var(--color-success-text, #065f46)', fontSize: '11.5px', fontWeight: 600, marginTop: '2px' }}>
              ✓ Individual bookings stay confirmed and active for this passenger
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
              disabled={submitting}
              className="btn-secondary-aero"
              style={{ padding: '9px 20px', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="btn-primary-aero"
              style={{
                padding: '9px 22px',
                fontSize: '13px',
                background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                boxShadow: '0 4px 14px rgba(217, 119, 6, 0.35)',
              }}
            >
              {submitting ? (
                <span>Unlinking…</span>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    link_off
                  </span>
                  <span>Unlink connection</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
