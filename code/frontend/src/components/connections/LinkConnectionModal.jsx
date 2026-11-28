import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatTime } from '../../utils/format.js';
import { findValidConnectionPartners } from '../../utils/connectionValidation.js';

/**
 * LinkConnectionModal
 * Allows a passenger to link a confirmed booking with a matching partner booking
 * to create a monitored connecting itinerary with zero-fee disruption protection.
 */
export default function LinkConnectionModal({
  isOpen,
  sourceBooking,
  allBookings = [],
  airports = [],
  existingConnections = [],
  onClose,
  onSuccess,
}) {
  const { token } = useAuth();
  const [selectedPartnerIndex, setSelectedPartnerIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const partners = useMemo(() => {
    if (!isOpen || !sourceBooking) return [];
    return findValidConnectionPartners(sourceBooking, allBookings, airports, existingConnections);
  }, [isOpen, sourceBooking, allBookings, airports, existingConnections]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSelectedPartnerIndex(0);

    function handleKeyDown(e) {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen || !sourceBooking) return null;

  const selectedPartner = partners[selectedPartnerIndex] || partners[0] || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPartner || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await apiFetch('/connections/mine', {
        method: 'POST',
        token,
        body: {
          inbound_booking_id: selectedPartner.inboundBooking.id,
          outbound_booking_id: selectedPartner.outboundBooking.id,
        },
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to link connection');
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
        aria-labelledby="link-connection-modal-title"
        style={{
          width: '100%',
          maxWidth: 580,
          background: '#ffffff',
          borderRadius: '20px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: '0 16px 40px rgba(6, 27, 58, 0.16)',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#ffffff' }}>
              connecting_airports
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <h2
              id="link-connection-modal-title"
              style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                lineHeight: 1.2,
                color: '#ffffff',
              }}
            >
              Link as Connection
            </h2>
            <span style={{ fontSize: '12px', opacity: 0.9 }}>
              Combine flights into a monitored itinerary with Zero-Fee Protection
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
                color: '#b91c1c',
                fontSize: '12.5px',
                fontWeight: 600,
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
              <span>{error}</span>
            </div>
          )}

          <p style={{ margin: '0 0 1rem', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
            You have selected booking <strong>Ref {sourceBooking.booking_ref}</strong> (Flight {sourceBooking.flight_number}, {sourceBooking.origin_code} → {sourceBooking.dest_code}). Select an eligible partner flight from your confirmed upcoming bookings to link together:
          </p>

          {partners.length === 0 ? (
            <div
              style={{
                padding: '24px',
                borderRadius: '12px',
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '13px',
              }}
            >
              No eligible partner bookings found that connect with this flight through a shared transit hub.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1.25rem' }}>
              {partners.map((p, idx) => {
                const isSelected = selectedPartnerIndex === idx;
                const inDepTime = p.inboundBooking.scheduled_departure;
                const inArrTime = p.inboundBooking.estimated_arrival || p.inboundBooking.scheduled_arrival;
                const outDepTime = p.outboundBooking.estimated_departure || p.outboundBooking.scheduled_departure;
                const outArrTime = p.outboundBooking.scheduled_arrival;

                return (
                  <label
                    key={`${p.inboundBooking.id}-${p.outboundBooking.id}`}
                    onClick={() => setSelectedPartnerIndex(idx)}
                    style={{
                      display: 'block',
                      padding: '14px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      background: isSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(37, 99, 235, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <input
                        type="radio"
                        name="partner-booking"
                        checked={isSelected}
                        onChange={() => setSelectedPartnerIndex(idx)}
                        style={{ marginTop: '3px' }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-display)' }}>
                            {p.route}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: p.isAtRisk ? '#fef3c7' : '#dcfce7',
                              color: p.isAtRisk ? '#92400e' : '#166534',
                            }}
                          >
                            {p.layoverMinutes}m Layover (MCT: {p.hubMct}m)
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#475569', marginTop: '6px' }}>
                          <div>
                            <span style={{ fontWeight: 700, color: '#1e293b' }}>Inbound: #{p.inboundFlight}</span>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {formatDate(inDepTime)}, Arr {formatTime(inArrTime)}
                            </div>
                          </div>
                          <div>
                            <span style={{ fontWeight: 700, color: '#1e293b' }}>Outbound: #{p.outboundFlight}</span>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {formatDate(outDepTime)}, Dep {formatTime(outDepTime)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Guarantee Note */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: '11.5px',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#2563eb' }}>
              verified_user
            </span>
            <span>
              Linking ensures active transit monitoring, gate connection telemetry, and Meridian Zero-Fee Rebooking Protection if your inbound flight is delayed.
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '9px 18px',
                borderRadius: '999px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedPartner}
              style={{
                padding: '9px 20px',
                borderRadius: '999px',
                border: 'none',
                background: '#2563eb',
                color: '#ffffff',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: submitting || !selectedPartner ? 'not-allowed' : 'pointer',
                opacity: submitting || !selectedPartner ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
              }}
            >
              {submitting ? (
                <>
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: '2px solid #ffffff',
                      borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span>Linking...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>link</span>
                  <span>Link as Connection</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
