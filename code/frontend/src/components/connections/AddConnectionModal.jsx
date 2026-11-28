import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatTime } from '../../utils/format.js';
import { validateConnectionForm } from '../../utils/connectionValidation.js';

/**
 * AddConnectionModal
 * Allows admin and ops_manager to link two confirmed upcoming bookings of a passenger
 * into a monitored connecting itinerary.
 */
export default function AddConnectionModal({ isOpen, onClose, onSuccess }) {
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [airports, setAirports] = useState([]);

  // Form selections
  const [selectedPassengerId, setSelectedPassengerId] = useState('');
  const [selectedInboundId, setSelectedInboundId] = useState('');
  const [selectedOutboundId, setSelectedOutboundId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  // Load bookings and airports when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setLoadError(null);
    setServerError(null);
    setSelectedPassengerId('');
    setSelectedInboundId('');
    setSelectedOutboundId('');

    Promise.all([
      apiFetch('/bookings?status=confirmed&limit=200', { token }),
      apiFetch('/airports'),
    ])
      .then(([bData, aData]) => {
        setBookings(bData.bookings || []);
        setAirports(aData.airports || []);
      })
      .catch((err) => {
        setLoadError(err.message || 'Failed to load bookings');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, token]);

  // Group upcoming confirmed bookings by passenger
  const passengers = useMemo(() => {
    const now = Date.now();
    const map = new Map();

    for (const b of bookings) {
      if (b.status !== 'confirmed') continue;
      if (b.flight_status === 'cancelled' || b.flight_status === 'departed') continue;

      const depTime = new Date(b.estimated_departure || b.scheduled_departure).getTime();
      // Only upcoming or active flights
      if (!isNaN(depTime) && depTime < now - 3600000) continue;

      const pId = b.user_id || b.passenger_id || b.id;
      if (!map.has(pId)) {
        map.set(pId, {
          id: pId,
          userId: b.user_id,
          name: b.passenger_name || 'Passenger #' + pId,
          email: b.passenger_email || '',
          bookings: [],
        });
      }
      map.get(pId).bookings.push(b);
    }

    return Array.from(map.values());
  }, [bookings]);

  // Selected passenger's bookings
  const passengerBookings = useMemo(() => {
    if (!selectedPassengerId) return [];
    const p = passengers.find((item) => String(item.id) === String(selectedPassengerId));
    return p ? p.bookings : [];
  }, [passengers, selectedPassengerId]);

  const selectedInboundBooking = useMemo(() => {
    return passengerBookings.find((b) => String(b.id) === String(selectedInboundId)) || null;
  }, [passengerBookings, selectedInboundId]);

  const selectedOutboundBooking = useMemo(() => {
    return passengerBookings.find((b) => String(b.id) === String(selectedOutboundId)) || null;
  }, [passengerBookings, selectedOutboundId]);

  // Determine Hub MCT
  const hubMct = useMemo(() => {
    if (!selectedInboundBooking) return 60;
    const destCode = selectedInboundBooking.dest_code;
    const ap = airports.find((a) => a.code === destCode || a.id === selectedInboundBooking.dest_id);
    return ap?.min_connection_minutes || selectedInboundBooking.dest_mct || 60;
  }, [selectedInboundBooking, airports]);

  // Form validation
  const validation = useMemo(() => {
    return validateConnectionForm({
      passengerId: selectedPassengerId,
      inboundBooking: selectedInboundBooking,
      outboundBooking: selectedOutboundBooking,
      hubMct,
    });
  }, [selectedPassengerId, selectedInboundBooking, selectedOutboundBooking, hubMct]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validation.valid || submitting) return;

    setSubmitting(true);
    setServerError(null);

    const passengerObj = passengers.find((p) => String(p.id) === String(selectedPassengerId));
    const resolvedUserId = selectedInboundBooking.user_id || passengerObj?.userId || Number(selectedPassengerId);

    try {
      await apiFetch('/connections', {
        method: 'POST',
        token,
        body: {
          inbound_flight_id: selectedInboundBooking.flight_id,
          outbound_flight_id: selectedOutboundBooking.flight_id,
          inbound_booking_id: selectedInboundBooking.id,
          outbound_booking_id: selectedOutboundBooking.id,
          passenger_id: resolvedUserId,
        },
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setServerError(err.message || 'Failed to create connection');
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
        aria-labelledby="add-connection-title"
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          background: 'var(--color-surface-lowest, #ffffff)',
          borderRadius: 'var(--radius-lg, 20px)',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: 'var(--shadow-elevated, 0 16px 40px rgba(6, 27, 58, 0.16))',
          overflowY: 'auto',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        {/* Header Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.25rem 1.75rem',
            background: 'var(--color-surface-low, #f1f3ff)',
            borderBottom: '1px solid rgba(226, 232, 240, 0.9)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(0, 82, 204, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary, #0052cc)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                add_link
              </span>
            </div>
            <div>
              <h2
                id="add-connection-title"
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--color-on-surface, #0f172a)',
                }}
              >
                Create Connecting Itinerary
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--color-slate, #64748b)' }}>
                Link two confirmed passenger bookings into a monitored connection
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-slate, #64748b)',
              padding: '4px',
              borderRadius: '6px',
            }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.75rem' }}>
          {loading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <p style={{ fontSize: '13px' }}>Loading confirmed bookings and passengers…</p>
            </div>
          ) : loadError ? (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                background: '#fee2e2',
                color: '#991b1b',
                fontSize: '13px',
              }}
            >
              {loadError}
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Field 1: Passenger Selection */}
              <div>
                <label
                  htmlFor="connection-passenger-select"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                >
                  Select Passenger *
                </label>
                <select
                  id="connection-passenger-select"
                  value={selectedPassengerId}
                  onChange={(e) => {
                    setSelectedPassengerId(e.target.value);
                    setSelectedInboundId('');
                    setSelectedOutboundId('');
                    setServerError(null);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose a passenger ({passengers.length} available) --</option>
                  {passengers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.email ? `(${p.email})` : ''} · {p.bookings.length} confirmed flight{p.bookings.length === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
                {validation.errors.passengerId && (
                  <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                    {validation.errors.passengerId}
                  </span>
                )}
              </div>

              {selectedPassengerId && (
                <>
                  {/* Field 2: Inbound Booking Selection */}
                  <div>
                    <label
                      htmlFor="connection-inbound-select"
                      style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                    >
                      Inbound Flight Booking *
                    </label>
                    <select
                      id="connection-inbound-select"
                      value={selectedInboundId}
                      onChange={(e) => {
                        setSelectedInboundId(e.target.value);
                        setServerError(null);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Choose inbound flight --</option>
                      {passengerBookings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.flight_number} · {b.origin_code} → {b.dest_code} · {formatDate(b.scheduled_departure)} (PNR #{b.booking_ref})
                        </option>
                      ))}
                    </select>
                    {validation.errors.inboundBooking && (
                      <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                        {validation.errors.inboundBooking}
                      </span>
                    )}
                  </div>

                  {/* Field 3: Outbound Booking Selection */}
                  <div>
                    <label
                      htmlFor="connection-outbound-select"
                      style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                    >
                      Outbound Flight Booking *
                    </label>
                    <select
                      id="connection-outbound-select"
                      value={selectedOutboundId}
                      onChange={(e) => {
                        setSelectedOutboundId(e.target.value);
                        setServerError(null);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Choose outbound flight --</option>
                      {passengerBookings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.flight_number} · {b.origin_code} → {b.dest_code} · {formatDate(b.scheduled_departure)} (PNR #{b.booking_ref})
                        </option>
                      ))}
                    </select>
                    {validation.errors.outboundBooking && (
                      <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                        {validation.errors.outboundBooking}
                      </span>
                    )}
                  </div>

                  {/* Route & Timing Inline Errors */}
                  {validation.errors.route && (
                    <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fee2e2', color: '#991b1b', fontSize: '12px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>
                        error
                      </span>
                      {validation.errors.route}
                    </div>
                  )}

                  {validation.errors.timing && (
                    <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#fee2e2', color: '#991b1b', fontSize: '12px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>
                        schedule
                      </span>
                      {validation.errors.timing}
                    </div>
                  )}

                  {/* Route & Layover Summary Preview */}
                  {validation.summary && (
                    <div
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        background: validation.summary.isAtRisk ? '#fffbeb' : '#f0fdf4',
                        border: `1px solid ${validation.summary.isAtRisk ? '#fde68a' : '#bbf7d0'}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        fontSize: '12.5px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, fontFamily: 'var(--font-display)', color: '#0f172a', fontSize: '14px' }}>
                          {validation.summary.route}
                        </span>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: validation.summary.isAtRisk ? '#fef3c7' : '#dcfce7',
                            color: validation.summary.isAtRisk ? '#92400e' : '#166534',
                          }}
                        >
                          {validation.summary.isAtRisk ? 'Layover < MCT (At Risk)' : 'Safe Transfer Buffer'}
                        </span>
                      </div>

                      <div style={{ color: '#475569', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div>
                          <strong>Leg 1:</strong> {validation.summary.inboundFlight} arrives at {validation.summary.hubCode} on{' '}
                          {formatDate(selectedInboundBooking.scheduled_departure)} at {formatTime(selectedInboundBooking.scheduled_arrival)}
                        </div>
                        <div>
                          <strong>Leg 2:</strong> {validation.summary.outboundFlight} departs from {validation.summary.hubCode} on{' '}
                          {formatDate(selectedOutboundBooking.scheduled_departure)} at {formatTime(selectedOutboundBooking.scheduled_departure)}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          borderTop: `1px solid ${validation.summary.isAtRisk ? '#fef08a' : '#dcfce7'}`,
                          paddingTop: '6px',
                          marginTop: '2px',
                        }}
                      >
                        <span style={{ fontWeight: 700, color: '#1e293b' }}>
                          Layover: {validation.summary.layoverMinutes}m
                        </span>
                        <span style={{ color: '#64748b' }}>vs {validation.summary.mct}m MCT</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: validation.summary.isAtRisk ? '#b45309' : '#15803d',
                          }}
                        >
                          {validation.summary.isAtRisk
                            ? `-${validation.summary.deficit}m deficit`
                            : `+${Math.abs(validation.summary.deficit)}m safe buffer`}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Server Error Message */}
              {serverError && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: '#fee2e2',
                    color: '#991b1b',
                    fontSize: '12.5px',
                    fontWeight: 600,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>
                    error
                  </span>
                  {serverError}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.75rem' }}>
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
                  type="submit"
                  disabled={!validation.valid || submitting}
                  className="btn-primary-aero"
                  style={{
                    padding: '9px 22px',
                    fontSize: '13px',
                    opacity: !validation.valid || submitting ? 0.5 : 1,
                    cursor: !validation.valid || submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? (
                    <span>Linking Connection…</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        link
                      </span>
                      <span>Link Connection</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
