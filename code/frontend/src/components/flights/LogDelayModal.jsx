import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDate, formatTime } from '../../utils/format.js';
import { validateDelayForm, DELAY_REASON_CODES } from '../../utils/connectionValidation.js';

/**
 * LogDelayModal
 * Form for admin and ops_manager to log flight delays and trigger cascading updates.
 */
export default function LogDelayModal({ isOpen, onClose, onSuccess, preselectedFlightId = null }) {
  const { token } = useAuth();

  const [loadingFlights, setLoadingFlights] = useState(true);
  const [flights, setFlights] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [flightId, setFlightId] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('');
  const [reasonCode, setReasonCode] = useState('LATE_INBOUND');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    setFlightId(preselectedFlightId ? String(preselectedFlightId) : '');
    setDelayMinutes('');
    setReasonCode('LATE_INBOUND');
    setNotes('');
    setServerError(null);
    setResult(null);
    setLoadingFlights(true);

    apiFetch('/flights?limit=200')
      .then((data) => {
        setFlights(data.flights || []);
      })
      .catch((err) => {
        setLoadError(err.message || 'Failed to load flights');
      })
      .finally(() => {
        setLoadingFlights(false);
      });
  }, [isOpen, preselectedFlightId]);

  // Filter for active, non-cancelled, non-departed flights
  const activeFlights = useMemo(() => {
    const now = Date.now();
    return flights.filter((f) => {
      if (f.status === 'cancelled' || f.status === 'departed') return false;
      const depTime = new Date(f.actual_departure || f.estimated_departure || f.scheduled_departure).getTime();
      // Only upcoming or recently active flights (not departed in the past)
      if (!isNaN(depTime) && depTime < now - 3600000) return false;
      return true;
    });
  }, [flights]);

  const validation = useMemo(() => {
    return validateDelayForm({
      flightId: flightId ? Number(flightId) : null,
      delayMinutes,
      reasonCode,
    });
  }, [flightId, delayMinutes, reasonCode]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validation.valid || submitting) return;

    setSubmitting(true);
    setServerError(null);
    setResult(null);

    try {
      const res = await apiFetch(`/flights/${flightId}/delay`, {
        method: 'POST',
        token,
        body: {
          delay_minutes: Number(delayMinutes),
          reason_code: reasonCode,
          notes: notes.trim() || undefined,
        },
      });

      setResult(res);
      if (onSuccess) onSuccess(res);
    } catch (err) {
      setServerError(err.message || 'Failed to log flight delay');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedFlightObj = flights.find((f) => String(f.id) === String(flightId));

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
        aria-labelledby="delay-modal-title"
        style={{
          width: '100%',
          maxWidth: 560,
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
                background: 'rgba(217, 119, 6, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#b45309',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                schedule
              </span>
            </div>
            <div>
              <h2
                id="delay-modal-title"
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--color-on-surface, #0f172a)',
                }}
              >
                Log Flight Delay
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--color-slate, #64748b)' }}>
                Record operational delay and evaluate connection cascade impacts
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
          {/* Result view if submitted successfully */}
          {result ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
                  <span className="material-symbols-outlined" style={{ color: '#16a34a' }}>
                    check_circle
                  </span>
                  <span>Delay Logged Successfully</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '13px', lineHeight: 1.5 }}>
                  Logged <strong>+{delayMinutes} minutes</strong> delay for flight{' '}
                  <strong>{selectedFlightObj?.flight_number}</strong> ({reasonCode}).
                </p>
                {result.cascadeReport && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#15803d' }}>
                    • Downstream flights affected: {result.cascadeReport.downstreamAffected || 0}
                    <br />
                    • Connections evaluated: {result.cascadeReport.connectionsEvaluated || result.cascadeReport.connectionsAtRisk || 0}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-primary-aero"
                  style={{ padding: '9px 22px', fontSize: '13px' }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Flight Dropdown */}
              <div>
                <label
                  htmlFor="delay-flight-select"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                >
                  Flight *
                </label>
                {loadingFlights ? (
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Loading active flights…</div>
                ) : (
                  <select
                    id="delay-flight-select"
                    value={flightId}
                    onChange={(e) => {
                      setFlightId(e.target.value);
                      setServerError(null);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="">-- Choose active flight ({activeFlights.length} available) --</option>
                    {activeFlights.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.flight_number} · {f.origin_code} → {f.dest_code} · {formatDate(f.scheduled_departure)}, {formatTime(f.scheduled_departure)}
                      </option>
                    ))}
                  </select>
                )}
                {validation.errors.flightId && (
                  <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                    {validation.errors.flightId}
                  </span>
                )}
              </div>

              {/* Delay Minutes */}
              <div>
                <label
                  htmlFor="delay-minutes-input"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                >
                  Delay Minutes * (1 to 1440)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    id="delay-minutes-input"
                    type="number"
                    min="1"
                    max="1440"
                    placeholder="e.g. 45"
                    value={delayMinutes}
                    onChange={(e) => {
                      setDelayMinutes(e.target.value);
                      setServerError(null);
                    }}
                    className="w-36 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                  <span style={{ fontSize: '12px', color: '#64748b' }}>minutes</span>
                </div>
                {validation.errors.delayMinutes && (
                  <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                    {validation.errors.delayMinutes}
                  </span>
                )}
              </div>

              {/* Reason Code Dropdown */}
              <div>
                <label
                  htmlFor="delay-reason-select"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                >
                  IATA Reason Code *
                </label>
                <select
                  id="delay-reason-select"
                  value={reasonCode}
                  onChange={(e) => {
                    setReasonCode(e.target.value);
                    setServerError(null);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DELAY_REASON_CODES.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {validation.errors.reasonCode && (
                  <span style={{ display: 'block', color: '#b91c1c', fontSize: '11px', marginTop: '4px' }}>
                    {validation.errors.reasonCode}
                  </span>
                )}
              </div>

              {/* Optional Notes */}
              <div>
                <label
                  htmlFor="delay-notes-input"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                >
                  Operational Notes (Optional)
                </label>
                <input
                  id="delay-notes-input"
                  type="text"
                  placeholder="e.g. Ground handling congestion or weather holdover"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Server Error */}
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
                    background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                    boxShadow: '0 4px 14px rgba(217, 119, 6, 0.35)',
                  }}
                >
                  {submitting ? (
                    <span>Logging Delay…</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        warning
                      </span>
                      <span>Log Delay</span>
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
