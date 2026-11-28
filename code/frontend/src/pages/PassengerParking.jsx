import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';
import SiteHeader from './SiteHeader.jsx';
import AirportSelect from '../components/common/AirportSelect.jsx';
import DateTimePicker from '../components/common/DateTimePicker.jsx';
import { styles, colors } from '../styles.js';
import { formatINR, formatDate, formatTime } from '../utils/format.js';
import {
  validateVehiclePlate,
  calculateParkingPrice,
  getParkingStatusBadgeStyle,
} from '../utils/parkingValidation.js';

// Default initial date-time strings: tomorrow 10:00 to tomorrow 18:00
function getTomorrowDateTime(hours = 10, minutes = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hours, minutes, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PassengerParking() {
  const { token, user } = useAuth();
  const { socket } = useSocket();

  // Search form
  const [selectedAirportId, setSelectedAirportId] = useState('');
  const [fromDateTime, setFromDateTime] = useState(getTomorrowDateTime(10, 0));
  const [untilDateTime, setUntilDateTime] = useState(getTomorrowDateTime(18, 0));
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [availableLots, setAvailableLots] = useState(null);

  // Booking modal
  const [bookingModalLot, setBookingModalLot] = useState(null);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleError, setVehicleError] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('mock_card');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState(null);

  // Booking success confirmation
  const [confirmationData, setConfirmationData] = useState(null);

  // User bookings list ("My Parking")
  const [myBookings, setMyBookings] = useState([]);
  const [myBookingsLoading, setMyBookingsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Cancel modal
  const [cancelTargetBooking, setCancelTargetBooking] = useState(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  const loadMyBookings = async () => {
    if (!token) return;
    setMyBookingsLoading(true);
    try {
      const data = await apiFetch('/parking/bookings/mine', { token });
      setMyBookings(data.bookings || []);
    } catch (err) {
      console.warn('Could not load parking bookings:', err.message);
    } finally {
      setMyBookingsLoading(false);
    }
  };

  useEffect(() => {
    loadMyBookings();
  }, [token]);

  // Socket updates
  useEffect(() => {
    if (!socket) return;
    const handleParkingUpdate = () => {
      loadMyBookings();
      if (selectedAirportId && availableLots) {
        handleSearchLots();
      }
    };
    socket.on('parking:updated', handleParkingUpdate);
    socket.on('parking:booking_created', handleParkingUpdate);
    socket.on('parking:cancelled', handleParkingUpdate);
    return () => {
      socket.off('parking:updated', handleParkingUpdate);
      socket.off('parking:booking_created', handleParkingUpdate);
      socket.off('parking:cancelled', handleParkingUpdate);
    };
  }, [socket, selectedAirportId, availableLots]);

  // Search available lots
  async function handleSearchLots(e) {
    if (e) e.preventDefault();
    if (!selectedAirportId) {
      setSearchError('Please select an airport');
      return;
    }
    if (!fromDateTime || !untilDateTime) {
      setSearchError('Please select both entry and exit dates & times');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        airport_id: selectedAirportId,
        from: fromDateTime,
        until: untilDateTime,
      });
      const data = await apiFetch(`/parking/lots?${params.toString()}`, { token });
      setAvailableLots(data.lots || []);
    } catch (err) {
      setSearchError(err.message || 'Failed to search parking lots');
      setAvailableLots(null);
    } finally {
      setSearchLoading(false);
    }
  }

  // Open booking modal
  function handleOpenBookingModal(lot) {
    setBookingModalLot(lot);
    setBookingError(null);
    setVehicleNumber('');
    setVehicleError(null);
  }

  // Handle vehicle number change with inline validation
  function handleVehicleChange(val) {
    setVehicleNumber(val);
    if (!val.trim()) {
      setVehicleError('Vehicle registration number is required');
      return;
    }
    const valRes = validateVehiclePlate(val);
    if (!valRes.valid) {
      setVehicleError(valRes.error);
    } else {
      setVehicleError(null);
    }
  }

  // Submit booking
  async function handleConfirmBooking(e) {
    e.preventDefault();
    const valRes = validateVehiclePlate(vehicleNumber);
    if (!valRes.valid) {
      setVehicleError(valRes.error);
      return;
    }

    setBookingSubmitting(true);
    setBookingError(null);
    try {
      const data = await apiFetch('/parking/bookings', {
        method: 'POST',
        token,
        body: {
          lot_id: bookingModalLot.id,
          vehicle_number: valRes.plate,
          from: fromDateTime,
          until: untilDateTime,
        },
      });

      setConfirmationData(data.booking);
      setBookingModalLot(null);
      loadMyBookings();
      handleSearchLots();
    } catch (err) {
      setBookingError(err.message || 'Failed to complete parking reservation');
    } finally {
      setBookingSubmitting(false);
    }
  }

  // Cancel reservation
  async function handleConfirmCancel() {
    if (!cancelTargetBooking) return;
    setCancelSubmitting(true);
    setCancelError(null);
    try {
      const res = await apiFetch(`/parking/bookings/${cancelTargetBooking.id}/cancel`, {
        method: 'POST',
        token,
      });
      setActionMessage(
        `Reservation ${cancelTargetBooking.booking_ref} cancelled successfully. Full refund of ${formatINR(
          res.refund.amount_refunded * 100
        )} processed.`
      );
      setTimeout(() => setActionMessage(null), 6000);
      setCancelTargetBooking(null);
      loadMyBookings();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel reservation');
    } finally {
      setCancelSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <SiteHeader />

      <main style={{ maxWidth: '1120px', margin: '0 auto', padding: '32px 20px 80px' }}>
        {/* Banner */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-primary)' }}>
              local_parking
            </span>
            <h1 style={{ ...styles.title, margin: 0 }}>Airport Parking Reservation</h1>
          </div>
          <p style={{ ...styles.subtitle, margin: 0 }}>
            Reserve guaranteed, safe airport parking spaces in advance across all major Meridian terminals.
          </p>
        </div>

        {/* Global Notifications */}
        {actionMessage && (
          <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#047857', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined">check_circle</span>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{actionMessage}</span>
          </div>
        )}

        {actionError && (
          <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#b91c1c', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined">error</span>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{actionError}</span>
          </div>
        )}

        {/* Search Card */}
        <div style={{ ...styles.card, padding: '24px', marginBottom: '32px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginBottom: '16px' }}>
            Find Available Parking Lots
          </div>

          <form onSubmit={handleSearchLots}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '18px' }}>
              <div>
                <AirportSelect
                  label="Select Airport *"
                  value={selectedAirportId}
                  onChange={(val) => {
                    setSelectedAirportId(val);
                    setSearchError(null);
                  }}
                  valueKey="id"
                  required
                />
              </div>

              <div>
                <DateTimePicker
                  label="Entry Date &amp; Time *"
                  value={fromDateTime}
                  onChange={(val) => {
                    setFromDateTime(val);
                    setSearchError(null);
                  }}
                  required
                />
              </div>

              <div>
                <DateTimePicker
                  label="Exit Date &amp; Time *"
                  value={untilDateTime}
                  onChange={(val) => {
                    setUntilDateTime(val);
                    setSearchError(null);
                  }}
                  required
                />
              </div>
            </div>

            {searchError && (
              <div style={{ fontSize: '12.5px', color: '#b91c1c', fontWeight: 600, marginBottom: '14px' }}>
                {searchError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn-primary-aero"
                disabled={searchLoading || !selectedAirportId}
                style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>search</span>
                <span>{searchLoading ? 'Checking Availability…' : 'Check Lots &amp; Rates'}</span>
              </button>
            </div>
          </form>

          {/* Results section */}
          {availableLots && (
            <div style={{ marginTop: '28px', borderTop: '1px solid rgba(226, 232, 240, 0.8)', paddingTop: '20px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 800, color: colors.ink, marginBottom: '16px' }}>
                Available Parking Lots ({availableLots.length})
              </div>

              {availableLots.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: colors.muted, fontSize: '13px' }}>
                  No parking lots found for this airport.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                  {availableLots.map((lot) => {
                    const isFull = lot.free_slots === 0;
                    return (
                      <div
                        key={lot.id}
                        style={{
                          background: 'var(--color-surface-low)',
                          borderRadius: '14px',
                          border: '1px solid rgba(226, 232, 240, 0.9)',
                          padding: '18px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 800, color: colors.ink }}>
                              {lot.name}
                            </div>
                            <span
                              style={{
                                padding: '3px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: 800,
                                backgroundColor: isFull ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                color: isFull ? '#ef4444' : '#10b981',
                                border: isFull ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                              }}
                            >
                              {isFull ? 'FULL' : `${lot.free_slots} / ${lot.total_slots} Slots Free`}
                            </span>
                          </div>

                          <div style={{ fontSize: '12.5px', color: colors.slate, marginBottom: '12px' }}>
                            {lot.airport_code} • {lot.airport_name}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px', padding: '10px 12px', background: '#fff', borderRadius: '10px', border: '1px solid rgba(226, 232, 240, 0.8)' }}>
                            <div>
                              <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700, textTransform: 'uppercase' }}>Hourly Rate</div>
                              <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink }}>
                                {formatINR(lot.hourly_rate * 100)} / hr
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700, textTransform: 'uppercase' }}>
                                Total ({lot.hours} hrs)
                              </div>
                              <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-primary)' }}>
                                {formatINR(lot.estimated_cost * 100)}
                              </div>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenBookingModal(lot)}
                          disabled={isFull}
                          className="btn-primary-aero"
                          style={{
                            width: '100%',
                            padding: '9px 16px',
                            fontSize: '13px',
                            justifyContent: 'center',
                            opacity: isFull ? 0.6 : 1,
                          }}
                        >
                          {isFull ? 'Lot Fully Booked' : 'Reserve Parking Space'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ================= SECTION: MY PARKING RESERVATIONS ================= */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: colors.ink, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '22px', color: colors.primary }}>
                bookmark
              </span>
              <span>My Parking Reservations ({myBookings.length})</span>
            </div>
            <button
              onClick={loadMyBookings}
              disabled={myBookingsLoading}
              className="btn-glass"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {myBookingsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {myBookingsLoading ? (
            <div style={{ ...styles.card, padding: '36px', textAlign: 'center', color: colors.muted }}>
              Loading parking reservations…
            </div>
          ) : myBookings.length === 0 ? (
            <div style={{ ...styles.card, padding: '36px', textAlign: 'center', color: colors.muted }}>
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: colors.muted, marginBottom: '8px' }}>
                directions_car
              </span>
              <p style={{ margin: 0, fontWeight: 600 }}>No parking reservations yet.</p>
              <p style={{ fontSize: '12px', color: colors.muted, margin: '4px 0 0' }}>
                Find an available lot above and reserve your spot before your flight.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {myBookings.map((b) => {
                const isUpcoming = b.status === 'reserved';
                const canCancel = isUpcoming && new Date(b.reserved_from) > new Date();

                return (
                  <div
                    key={b.id}
                    style={{
                      ...styles.card,
                      padding: '20px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '15px', color: 'var(--color-primary)' }}>
                          {b.booking_ref}
                        </span>
                        <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', ...getParkingStatusBadgeStyle(b.status) }}>
                          {b.status}
                        </span>
                        <span style={{ padding: '2px 8px', background: 'rgba(2, 132, 199, 0.08)', borderRadius: '6px', fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>
                          Slot {b.slot_number}
                        </span>
                      </div>

                      <div style={{ fontSize: '13.5px', fontWeight: 700, color: colors.ink }}>
                        {b.lot_name} • {b.airport_code} ({b.airport_name})
                      </div>

                      <div style={{ fontSize: '12.5px', color: colors.slate }}>
                        Vehicle: <strong style={{ fontFamily: 'monospace' }}>{b.vehicle_number}</strong> • Reserved: {formatDate(b.reserved_from)} {formatTime(b.reserved_from)} → {formatDate(b.reserved_until)} {formatTime(b.reserved_until)}
                      </div>

                      {b.entry_time && (
                        <div style={{ fontSize: '11.5px', color: '#047857', fontWeight: 600 }}>
                          Actual Entry: {formatDate(b.entry_time)} {formatTime(b.entry_time)}
                          {b.exit_time && ` • Exit: ${formatDate(b.exit_time)} ${formatTime(b.exit_time)}`}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: colors.ink }}>
                        {formatINR(parseFloat(b.amount_paid) * 100)}
                      </div>

                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => setCancelTargetBooking(b)}
                          className="btn-destructive-aero"
                          style={{ padding: '6px 14px', fontSize: '12px' }}
                        >
                          Cancel Reservation
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ================= BOOKING & PAYMENT MODAL ================= */}
        {bookingModalLot && (
          <div className="modal-backdrop">
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '22px', color: colors.primary }}>
                    local_parking
                  </span>
                  <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: colors.ink }}>
                    Confirm Parking Reservation
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setBookingModalLot(null)}
                  className="btn-glass"
                  style={{ padding: '4px 8px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
                </button>
              </div>

              {/* Summary */}
              <div style={{ padding: '14px', background: 'var(--color-surface-low)', borderRadius: '10px', marginBottom: '16px', fontSize: '12.5px' }}>
                <div>Lot: <strong>{bookingModalLot.name}</strong> ({bookingModalLot.airport_code})</div>
                <div>Window: <strong>{formatDate(fromDateTime)} {formatTime(fromDateTime)}</strong> → <strong>{formatDate(untilDateTime)} {formatTime(untilDateTime)}</strong></div>
                <div>Duration: <strong>{bookingModalLot.hours} hours</strong> (rounded up)</div>
                <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 800, color: 'var(--color-primary)' }}>
                  Total to Pay: {formatINR(bookingModalLot.estimated_cost * 100)}
                </div>
              </div>

              <form onSubmit={handleConfirmBooking}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                    Vehicle Registration Number *
                  </label>
                  <input
                    type="text"
                    value={vehicleNumber}
                    onChange={(e) => handleVehicleChange(e.target.value)}
                    placeholder="e.g. MH12AB1234 or DL1CAB1234"
                    style={{ ...styles.input, width: '100%', textTransform: 'uppercase', fontFamily: 'monospace' }}
                    autoFocus
                    required
                  />
                  {vehicleError && (
                    <div style={{ fontSize: '11.5px', color: '#b91c1c', marginTop: '4px', fontWeight: 600 }}>
                      {vehicleError}
                    </div>
                  )}
                  {!vehicleError && vehicleNumber.trim() && (
                    <div style={{ fontSize: '11.5px', color: '#047857', marginTop: '4px', fontWeight: 600 }}>
                      ✓ Valid Indian vehicle registration number
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: colors.ink, marginBottom: '6px' }}>
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    style={{ ...styles.input, width: '100%' }}
                  >
                    <option value="mock_card">Credit / Debit Card (Mock Guarantee)</option>
                    <option value="upi">UPI / Net Banking</option>
                  </select>
                </div>

                {bookingError && (
                  <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: '8px', fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                    {bookingError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setBookingModalLot(null)}
                    className="btn-glass"
                    disabled={bookingSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary-aero"
                    disabled={bookingSubmitting || !vehicleNumber.trim() || Boolean(vehicleError)}
                  >
                    {bookingSubmitting ? 'Processing…' : `Pay ${formatINR(bookingModalLot.estimated_cost * 100)} & Reserve`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================= SUCCESS CONFIRMATION MODAL ================= */}
        {confirmationData && (
          <div className="modal-backdrop">
            <div className="modal-content" style={{ maxWidth: '480px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>check_circle</span>
              </div>

              <h2 style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 6px', color: colors.ink }}>
                Parking Space Reserved!
              </h2>
              <p style={{ fontSize: '13px', color: colors.slate, margin: '0 0 20px' }}>
                Your parking slot has been guaranteed. Present your booking reference upon arrival.
              </p>

              <div style={{ padding: '16px', background: 'var(--color-surface-low)', borderRadius: '12px', textAlign: 'left', marginBottom: '20px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: colors.muted }}>Booking Ref:</span>
                  <strong style={{ fontFamily: 'monospace', color: 'var(--color-primary)' }}>{confirmationData.booking_ref}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: colors.muted }}>Assigned Slot:</span>
                  <strong style={{ color: '#0284c7' }}>Slot {confirmationData.slot_number}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: colors.muted }}>Vehicle:</span>
                  <strong style={{ fontFamily: 'monospace' }}>{confirmationData.vehicle_number}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: colors.muted }}>Location:</span>
                  <strong>{confirmationData.lot_name} ({confirmationData.airport_code})</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: colors.muted }}>Window:</span>
                  <span>{formatDate(confirmationData.reserved_from)} {formatTime(confirmationData.reserved_from)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setConfirmationData(null)}
                className="btn-primary-aero"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* ================= CANCEL CONFIRMATION DIALOG ================= */}
        {cancelTargetBooking && (
          <div className="modal-backdrop">
            <div className="modal-content" style={{ maxWidth: '440px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#ef4444' }}>
                  cancel
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: colors.ink }}>
                  Cancel Parking Reservation?
                </h2>
              </div>

              <p style={{ fontSize: '13px', color: colors.slate, lineHeight: 1.5, margin: '0 0 16px' }}>
                Are you sure you want to cancel reservation <strong>{cancelTargetBooking.booking_ref}</strong> for vehicle{' '}
                <strong>{cancelTargetBooking.vehicle_number}</strong>?
                <br />
                A full refund of <strong>{formatINR(parseFloat(cancelTargetBooking.amount_paid) * 100)}</strong> will be credited to your account.
              </p>

              {cancelError && (
                <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderRadius: '8px', fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                  {cancelError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCancelTargetBooking(null)}
                  className="btn-glass"
                  disabled={cancelSubmitting}
                >
                  Keep Reservation
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  className="btn-destructive-aero"
                  disabled={cancelSubmitting}
                >
                  {cancelSubmitting ? 'Cancelling…' : 'Yes, Cancel & Refund'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
