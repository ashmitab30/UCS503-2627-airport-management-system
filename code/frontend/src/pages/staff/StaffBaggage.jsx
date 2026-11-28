import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles, colors } from '../../styles.js';
import { formatDate, formatTime } from '../../utils/format.js';
import {
  BAGGAGE_STATUSES,
  BAGGAGE_STATUS_LABELS,
  BAGGAGE_TRANSITIONS,
  validateWeight,
  getNextStatuses,
  getStatusBadgeStyle,
} from '../../utils/baggageValidation.js';

export default function StaffBaggage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();

  const [baggageList, setBaggageList] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Filters & search
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Scanned bag card from direct tag search
  const [tagLookupResult, setTagLookupResult] = useState(null);
  const [tagLookupLoading, setTagLookupLoading] = useState(false);
  const [tagLookupError, setTagLookupError] = useState(null);

  // Modals state
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [regBookingRef, setRegBookingRef] = useState('');
  const [regBookingData, setRegBookingData] = useState(null);
  const [regBookingError, setRegBookingError] = useState(null);
  const [regBookingLoading, setRegBookingLoading] = useState(false);
  const [regWeight, setRegWeight] = useState('');
  const [regLocation, setRegLocation] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState(null);

  // Status transition modal
  const [statusModalTarget, setStatusModalTarget] = useState(null); // { bag, targetStatus }
  const [statusModalLocation, setStatusModalLocation] = useState('');
  const [statusModalError, setStatusModalError] = useState(null);
  const [statusModalSubmitting, setStatusModalSubmitting] = useState(false);

  // Scan history modal
  const [historyModalBag, setHistoryModalBag] = useState(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadBaggage = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) {
        // If 10 digits, search by tag; otherwise search by bookingRef
        if (/^\d{5,10}$/.test(debouncedSearch)) {
          params.set('tag', debouncedSearch);
        } else {
          params.set('booking_ref', debouncedSearch);
        }
      }
      params.set('limit', '50');

      const data = await apiFetch(`/baggage?${params.toString()}`, { token });
      setBaggageList(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load baggage list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBaggage();
  }, [statusFilter, debouncedSearch, token]);

  // Listen to live socket events
  useEffect(() => {
    if (!socket) return;
    const handleBaggageEvent = () => {
      loadBaggage();
      if (tagLookupResult) {
        handleLookupTag(tagLookupResult.tag_number);
      }
    };
    socket.on('baggage_updated', handleBaggageEvent);
    socket.on('baggage_registered', handleBaggageEvent);
    return () => {
      socket.off('baggage_updated', handleBaggageEvent);
      socket.off('baggage_registered', handleBaggageEvent);
    };
  }, [socket, tagLookupResult]);

  // Lookup single tag directly
  async function handleLookupTag(tag) {
    if (!tag || !tag.trim()) return;
    setTagLookupLoading(true);
    setTagLookupError(null);
    try {
      const data = await apiFetch(`/baggage/${encodeURIComponent(tag.trim())}`, { token });
      setTagLookupResult(data);
    } catch (err) {
      setTagLookupResult(null);
      setTagLookupError(err.message || 'Baggage tag not found');
    } finally {
      setTagLookupLoading(false);
    }
  }

  // Find booking for register modal
  async function handleFindBooking() {
    if (!regBookingRef.trim()) {
      setRegBookingError('Please enter a booking reference (e.g. BK-IN101)');
      return;
    }
    setRegBookingLoading(true);
    setRegBookingError(null);
    setRegBookingData(null);
    try {
      const res = await apiFetch(`/bookings?search=${encodeURIComponent(regBookingRef.trim())}&limit=5`, { token });
      const found = (res.bookings || []).find(
        (b) => b.booking_ref.toLowerCase() === regBookingRef.trim().toLowerCase()
      );
      if (!found) {
        setRegBookingError(`No booking found with reference "${regBookingRef.trim()}"`);
        return;
      }
      if (found.status !== 'checked_in') {
        setRegBookingError(
          `Booking ${found.booking_ref} is currently "${found.status}". Passenger must complete web check-in before baggage can be registered.`
        );
        return;
      }
      setRegBookingData(found);
      // Pre-fill location with origin code if available
      if (found.origin_code && !regLocation) {
        setRegLocation(`${found.origin_code} Check-in Counter`);
      }
    } catch (err) {
      setRegBookingError(err.message || 'Failed to find booking');
    } finally {
      setRegBookingLoading(false);
    }
  }

  // Submit new baggage registration
  async function handleRegisterSubmit(e) {
    e.preventDefault();
    if (!regBookingData) {
      setRegError('Please verify the booking reference first.');
      return;
    }
    const weightValidation = validateWeight(regWeight);
    if (!weightValidation.valid) {
      setRegError(weightValidation.error);
      return;
    }

    setRegSubmitting(true);
    setRegError(null);
    try {
      const newBag = await apiFetch(`/bookings/${regBookingData.id}/baggage`, {
        method: 'POST',
        token,
        body: {
          weight: weightValidation.numeric,
          location: regLocation.trim() || undefined,
        },
      });

      setSuccessMessage(`Baggage registered successfully! Tag #${newBag.tag_number}`);
      setTimeout(() => setSuccessMessage(null), 5000);
      setRegisterModalOpen(false);
      setRegBookingRef('');
      setRegBookingData(null);
      setRegWeight('');
      setRegLocation('');
      loadBaggage();
    } catch (err) {
      setRegError(err.message || 'Failed to register baggage');
    } finally {
      setRegSubmitting(false);
    }
  }

  // Open status transition modal
  function handleOpenStatusModal(bag, targetStatus) {
    setStatusModalTarget({ bag, targetStatus });
    setStatusModalError(null);

    // Provide sensible default location
    let defaultLoc = '';
    if (targetStatus === 'loaded') {
      defaultLoc = `${bag.origin_code || 'Ramp'} Loading Bay / Gate Ramp`;
    } else if (targetStatus === 'in_transit') {
      defaultLoc = `Aircraft Cargo Hold (${bag.flight_number || 'En Route'})`;
    } else if (targetStatus === 'arrived') {
      defaultLoc = `${bag.destination_code || 'Arrival'} Baggage Carousel`;
    } else if (targetStatus === 'lost') {
      defaultLoc = 'Baggage Service Office - Irregularity Report';
    }
    setStatusModalLocation(defaultLoc);
  }

  // Submit status update
  async function handleStatusSubmit(e) {
    e.preventDefault();
    if (!statusModalLocation.trim()) {
      setStatusModalError('Scan location is required for all status transitions.');
      return;
    }

    setStatusModalSubmitting(true);
    setStatusModalError(null);
    try {
      await apiFetch(`/baggage/${statusModalTarget.bag.id}/status`, {
        method: 'PATCH',
        token,
        body: {
          status: statusModalTarget.targetStatus,
          location: statusModalLocation.trim(),
        },
      });

      setSuccessMessage(
        `Bag #${statusModalTarget.bag.tag_number} updated to "${BAGGAGE_STATUS_LABELS[statusModalTarget.targetStatus]}"`
      );
      setTimeout(() => setSuccessMessage(null), 4000);
      setStatusModalTarget(null);
      loadBaggage();
      if (tagLookupResult && tagLookupResult.id === statusModalTarget.bag.id) {
        handleLookupTag(statusModalTarget.bag.tag_number);
      }
    } catch (err) {
      setStatusModalError(err.message || 'Failed to update baggage status');
    } finally {
      setStatusModalSubmitting(false);
    }
  }

  // Fetch full history for bag modal
  async function handleOpenHistoryModal(bag) {
    try {
      const data = await apiFetch(`/baggage/${bag.tag_number}`, { token });
      setHistoryModalBag(data);
    } catch (err) {
      setError(err.message || 'Could not load scan history');
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={styles.title}>Baggage Tracking &amp; Pipeline</h1>
          <p style={styles.subtitle}>
            Manage baggage check-in, apron loading, in-transit status, and arrival routing across all flights.
          </p>
        </div>
        <button
          onClick={() => {
            setRegisterModalOpen(true);
            setRegError(null);
            setRegBookingError(null);
          }}
          className="btn-primary-aero"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          <span>Register Bag</span>
        </button>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#047857', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined">check_circle</span>
          <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{successMessage}</span>
        </div>
      )}

      {error && (
        <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#b91c1c', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined">error</span>
          <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* Quick Tag Scanner Card */}
      <div style={{ ...styles.card, padding: '20px', marginBottom: '24px' }}>
        <div style={{ fontSize: '13.5px', fontWeight: 800, color: colors.ink, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '20px', color: colors.primary }}>qr_code_scanner</span>
          <span>Quick Tag Scanner &amp; Verification</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Scan or enter 10-digit Tag Number (e.g. 1000001001)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...styles.input, flex: '1 1 300px', fontFamily: 'monospace' }}
          />
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm('');
                setTagLookupResult(null);
                setTagLookupError(null);
              }}
              className="btn-glass"
              style={{ padding: '8px 16px', fontSize: '12px' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Tag direct lookup result if available */}
        {tagLookupResult && (
          <div style={{ marginTop: '16px', padding: '16px', background: 'var(--color-surface-low)', borderRadius: '12px', border: '1px solid rgba(226, 232, 240, 0.9)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '16px', color: 'var(--color-primary)' }}>
                    TAG #{tagLookupResult.tag_number}
                  </span>
                  <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', ...getStatusBadgeStyle(tagLookupResult.status) }}>
                    {BAGGAGE_STATUS_LABELS[tagLookupResult.status] || tagLookupResult.status}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
                    {tagLookupResult.weight} kg
                  </span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--color-on-surface)', marginTop: '4px' }}>
                  Booking: <strong>{tagLookupResult.booking_ref}</strong> • Passenger: <strong>{tagLookupResult.passenger_name || 'Passenger'}</strong> • Flight: <strong>{tagLookupResult.flight_number}</strong> ({tagLookupResult.origin_code} → {tagLookupResult.destination_code})
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--color-slate)', marginTop: '2px' }}>
                  Last scanned: <strong>{tagLookupResult.last_scanned_location || 'N/A'}</strong> at {tagLookupResult.last_scanned_at ? `${formatDate(tagLookupResult.last_scanned_at)} ${formatTime(tagLookupResult.last_scanned_at)}` : 'N/A'}
                </div>
              </div>

              {/* Action buttons on lookup card */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {getNextStatuses(tagLookupResult.status).map((nxt) => (
                  <button
                    key={nxt}
                    onClick={() => handleOpenStatusModal(tagLookupResult, nxt)}
                    className={nxt === 'lost' ? 'btn-destructive-aero' : 'btn-primary-aero'}
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                  >
                    {nxt === 'lost' ? 'Report Lost' : `Advance to ${BAGGAGE_STATUS_LABELS[nxt]}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Scans timeline inside lookup card */}
            {tagLookupResult.scans && tagLookupResult.scans.length > 0 && (
              <div style={{ marginTop: '14px', borderTop: '1px solid rgba(226, 232, 240, 0.8)', paddingTop: '12px' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-slate)', marginBottom: '8px' }}>
                  Scan Audit Trail ({tagLookupResult.scans.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {tagLookupResult.scans.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: '#fff', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(226, 232, 240, 0.6)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                        {BAGGAGE_STATUS_LABELS[s.status] || s.status} — {s.location}
                      </span>
                      <span style={{ color: 'var(--color-slate)', fontSize: '11px' }}>
                        {formatDate(s.scanned_at)} {formatTime(s.scanned_at)} {s.scanned_by_email ? `(${s.scanned_by_email})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
        <button
          onClick={() => setStatusFilter('all')}
          className="btn-glass"
          style={{
            padding: '8px 16px',
            fontSize: '12px',
            backgroundColor: statusFilter === 'all' ? 'var(--color-primary)' : undefined,
            color: statusFilter === 'all' ? '#fff' : undefined,
          }}
        >
          All Baggage ({totalCount})
        </button>
        {BAGGAGE_STATUSES.map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className="btn-glass"
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              backgroundColor: statusFilter === st ? 'var(--color-primary)' : undefined,
              color: statusFilter === st ? '#fff' : undefined,
            }}
          >
            {BAGGAGE_STATUS_LABELS[st]}
          </button>
        ))}
      </div>

      {/* Baggage Table Card */}
      <div style={{ ...styles.card, padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(226, 232, 240, 0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink }}>
            Active Baggage Items ({baggageList.length})
          </div>
          <button
            onClick={loadBaggage}
            disabled={loading}
            className="btn-glass"
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>refresh</span>
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.muted }}>
            Loading baggage records…
          </div>
        ) : baggageList.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.muted }}>
            No baggage found matching the filter criteria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-low)', borderBottom: '1px solid rgba(226, 232, 240, 0.8)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Tag #</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Booking Ref</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Flight</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Weight</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Last Location</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink }}>Last Scanned</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, color: colors.ink, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {baggageList.map((bag) => {
                  const nextStatuses = getNextStatuses(bag.status);
                  return (
                    <tr key={bag.id} style={{ borderBottom: '1px solid rgba(226, 232, 240, 0.6)' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 700, color: colors.primary }}>
                        {bag.tag_number}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {bag.booking_ref}
                        {bag.passenger_name && (
                          <div style={{ fontSize: '11px', color: colors.muted }}>{bag.passenger_name}</div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {bag.flight_number || '—'}
                        {bag.origin_code && bag.destination_code && (
                          <div style={{ fontSize: '11px', color: colors.muted }}>
                            {bag.origin_code} → {bag.destination_code}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {bag.weight} kg
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', ...getStatusBadgeStyle(bag.status) }}>
                          {BAGGAGE_STATUS_LABELS[bag.status] || bag.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: colors.ink }}>
                        {bag.last_scanned_location || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '11.5px', color: colors.muted }}>
                        {bag.last_scanned_at ? `${formatDate(bag.last_scanned_at)} ${formatTime(bag.last_scanned_at)}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', alignItems: 'center' }}>
                          {nextStatuses.map((nxt) => (
                            <button
                              key={nxt}
                              onClick={() => handleOpenStatusModal(bag, nxt)}
                              className={nxt === 'lost' ? 'btn-destructive-aero' : 'btn-primary-aero'}
                              style={{ padding: '4px 10px', fontSize: '11.5px' }}
                              title={`Move status to ${BAGGAGE_STATUS_LABELS[nxt]}`}
                            >
                              {nxt === 'lost' ? 'Lost' : BAGGAGE_STATUS_LABELS[nxt]}
                            </button>
                          ))}
                          {nextStatuses.length === 0 && (
                            <span style={{ fontSize: '11px', color: colors.muted, fontStyle: 'italic', paddingRight: '4px' }}>
                              Completed
                            </span>
                          )}
                          <button
                            onClick={() => handleOpenHistoryModal(bag)}
                            className="btn-glass"
                            style={{ padding: '4px 8px', fontSize: '11.5px' }}
                            title="View Scan History"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>history</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= REGISTER BAGGAGE MODAL ================= */}
      {registerModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '24px', color: colors.primary }}>
                  luggage
                </span>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: colors.ink }}>
                  Register Checked Baggage
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="btn-glass"
                style={{ padding: '4px 8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit}>
              {/* Step 1: Booking Ref lookup */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                  Booking Reference *
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={regBookingRef}
                    onChange={(e) => setRegBookingRef(e.target.value)}
                    placeholder="e.g. BK-IN101"
                    style={{ ...styles.input, flex: 1, textTransform: 'uppercase', fontFamily: 'monospace' }}
                    disabled={regBookingLoading || regSubmitting}
                  />
                  <button
                    type="button"
                    onClick={handleFindBooking}
                    disabled={regBookingLoading || !regBookingRef.trim()}
                    className="btn-glass"
                    style={{ padding: '8px 16px', fontSize: '12px' }}
                  >
                    {regBookingLoading ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
                {regBookingError && (
                  <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '6px', fontWeight: 600 }}>
                    {regBookingError}
                  </div>
                )}
              </div>

              {/* Verified Booking Card */}
              {regBookingData && (
                <div style={{ padding: '12px 14px', background: 'rgba(2, 132, 199, 0.08)', borderRadius: '10px', border: '1px solid rgba(2, 132, 199, 0.2)', marginBottom: '16px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 800, color: colors.primary, marginBottom: '2px' }}>
                    ✓ Booking Verified ({regBookingData.booking_ref})
                  </div>
                  <div>Flight: <strong>{regBookingData.flight_number}</strong> • Status: <strong style={{ color: '#0284c7' }}>{regBookingData.status}</strong></div>
                  <div>Passenger: {regBookingData.passenger_name || 'Checked-in Passenger'}</div>
                </div>
              )}

              {/* Weight Input */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                  Baggage Weight (0.1 to 32.0 kg) *
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="32.0"
                    value={regWeight}
                    onChange={(e) => setRegWeight(e.target.value)}
                    placeholder="e.g. 18.5"
                    style={{ ...styles.input, width: '100%', paddingRight: '40px' }}
                    disabled={regSubmitting}
                    required
                  />
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: colors.muted, fontWeight: 700 }}>
                    kg
                  </span>
                </div>
              </div>

              {/* Initial Scan Location */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                  Check-in Desk / Location
                </label>
                <input
                  type="text"
                  value={regLocation}
                  onChange={(e) => setRegLocation(e.target.value)}
                  placeholder="e.g. DEL Check-in Counter 04"
                  style={{ ...styles.input, width: '100%' }}
                  disabled={regSubmitting}
                />
              </div>

              {regError && (
                <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: '8px', fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                  {regError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="btn-glass"
                  disabled={regSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-aero"
                  disabled={regSubmitting || !regBookingData || !regWeight}
                >
                  {regSubmitting ? 'Registering…' : 'Generate Tag & Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= STATUS TRANSITION MODAL ================= */}
      {statusModalTarget && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '22px', color: statusModalTarget.targetStatus === 'lost' ? '#ef4444' : colors.primary }}>
                  {statusModalTarget.targetStatus === 'lost' ? 'report_problem' : 'sync_alt'}
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: colors.ink }}>
                  {statusModalTarget.targetStatus === 'lost' ? 'Report Baggage as Lost' : `Update Status: ${BAGGAGE_STATUS_LABELS[statusModalTarget.targetStatus]}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStatusModalTarget(null)}
                className="btn-glass"
                style={{ padding: '4px 8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            <div style={{ padding: '12px', background: 'var(--color-surface-low)', borderRadius: '10px', marginBottom: '16px', fontSize: '12.5px' }}>
              <div>Tag: <strong style={{ fontFamily: 'monospace' }}>#{statusModalTarget.bag.tag_number}</strong></div>
              <div>Current Status: <strong>{BAGGAGE_STATUS_LABELS[statusModalTarget.bag.status] || statusModalTarget.bag.status}</strong></div>
              <div>Target Status: <strong style={{ color: statusModalTarget.targetStatus === 'lost' ? '#ef4444' : colors.primary }}>{BAGGAGE_STATUS_LABELS[statusModalTarget.targetStatus]}</strong></div>
            </div>

            <form onSubmit={handleStatusSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                  Scan Location (Required) *
                </label>
                <input
                  type="text"
                  value={statusModalLocation}
                  onChange={(e) => setStatusModalLocation(e.target.value)}
                  placeholder="e.g. Ramp Bay 4, Cargo Hold, Carousel 2"
                  style={{ ...styles.input, width: '100%' }}
                  disabled={statusModalSubmitting}
                  autoFocus
                  required
                />
              </div>

              {statusModalError && (
                <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: '8px', fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                  {statusModalError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setStatusModalTarget(null)}
                  className="btn-glass"
                  disabled={statusModalSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={statusModalTarget.targetStatus === 'lost' ? 'btn-destructive-aero' : 'btn-primary-aero'}
                  disabled={statusModalSubmitting || !statusModalLocation.trim()}
                >
                  {statusModalSubmitting ? 'Recording…' : 'Confirm Status Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= SCAN HISTORY MODAL ================= */}
      {historyModalBag && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '22px', color: colors.primary }}>
                  history
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: colors.ink }}>
                  Scan History: Tag #{historyModalBag.tag_number}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalBag(null)}
                className="btn-glass"
                style={{ padding: '4px 8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            <div style={{ marginBottom: '16px', fontSize: '12.5px', color: colors.slate }}>
              Booking: <strong>{historyModalBag.booking_ref}</strong> • Weight: <strong>{historyModalBag.weight} kg</strong> • Current: <strong style={{ textTransform: 'uppercase' }}>{BAGGAGE_STATUS_LABELS[historyModalBag.status] || historyModalBag.status}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
              {(historyModalBag.scans || []).map((scan, index) => (
                <div
                  key={scan.id || index}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'var(--color-surface-low)',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', ...getStatusBadgeStyle(scan.status) }}>
                        {BAGGAGE_STATUS_LABELS[scan.status] || scan.status}
                      </span>
                      <strong style={{ color: colors.ink }}>{scan.location}</strong>
                    </div>
                    {scan.scanned_by_email && (
                      <div style={{ fontSize: '11px', color: colors.muted, marginTop: '2px' }}>
                        Staff: {scan.scanned_by_email} {scan.scanned_by_role ? `(${scan.scanned_by_role})` : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '11px', color: colors.muted }}>
                    <div>{formatDate(scan.scanned_at)}</div>
                    <div>{formatTime(scan.scanned_at)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setHistoryModalBag(null)}
                className="btn-glass"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
