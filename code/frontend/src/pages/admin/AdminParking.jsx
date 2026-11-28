import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles, colors } from '../../styles.js';
import { formatINR, formatDate, formatTime } from '../../utils/format.js';
import { getParkingStatusBadgeStyle } from '../../utils/parkingValidation.js';

export default function AdminParking() {
  const { token } = useAuth();
  const { socket } = useSocket();

  // Lots state
  const [airports, setAirports] = useState([]);
  const [selectedAirportId, setSelectedAirportId] = useState('');
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(true);

  // Selected lot details / slots occupancy modal
  const [occupancyModalLotId, setOccupancyModalLotId] = useState(null);
  const [occupancyData, setOccupancyData] = useState(null);
  const [occupancyLoading, setOccupancyLoading] = useState(false);

  // Bookings list state
  const [bookings, setBookings] = useState([]);
  const [totalBookings, setTotalBookings] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bookingsLoading, setBookingsLoading] = useState(true);

  // Global inline feedback
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Load airports
  useEffect(() => {
    apiFetch('/airports', { token })
      .then((data) => {
        const list = data.airports || [];
        setAirports(list);
        if (list.length > 0) {
          setSelectedAirportId(list[0].id);
        }
      })
      .catch((err) => console.warn('Could not load airports:', err.message));
  }, [token]);

  // Load lots for selected airport
  const loadLots = async () => {
    if (!selectedAirportId) return;
    setLotsLoading(true);
    try {
      // Use current window to query lots & free slots
      const now = new Date();
      const inOneHour = new Date(now.getTime() + 3600_000);
      const params = new URLSearchParams({
        airport_id: selectedAirportId,
        from: now.toISOString(),
        until: inOneHour.toISOString(),
      });
      const data = await apiFetch(`/parking/lots?${params.toString()}`, { token });
      setLots(data.lots || []);
    } catch (err) {
      console.warn('Could not load lots:', err.message);
    } finally {
      setLotsLoading(false);
    }
  };

  useEffect(() => {
    loadLots();
  }, [selectedAirportId, token]);

  // Load bookings list with filters
  const loadBookings = async () => {
    setBookingsLoading(true);
    setActionError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery.trim()) {
        if (/^PK-/i.test(searchQuery.trim())) {
          params.set('booking_ref', searchQuery.trim());
        } else {
          params.set('vehicle_number', searchQuery.trim());
        }
      }
      params.set('limit', '50');

      const data = await apiFetch(`/parking/bookings?${params.toString()}`, { token });
      setBookings(data.items || []);
      setTotalBookings(data.total || 0);
    } catch (err) {
      setActionError(err.message || 'Failed to load bookings');
    } finally {
      setBookingsLoading(false);
    }
  };

  useEffect(() => {
    loadBookings();
  }, [statusFilter, searchQuery, token]);

  // Socket live updates
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      loadLots();
      loadBookings();
      if (occupancyModalLotId) {
        handleViewOccupancy(occupancyModalLotId);
      }
    };
    socket.on('parking:updated', handleUpdate);
    socket.on('parking:booking_created', handleUpdate);
    socket.on('parking:cancelled', handleUpdate);
    return () => {
      socket.off('parking:updated', handleUpdate);
      socket.off('parking:booking_created', handleUpdate);
      socket.off('parking:cancelled', handleUpdate);
    };
  }, [socket, selectedAirportId, occupancyModalLotId]);

  // Load lot slots occupancy
  async function handleViewOccupancy(lotId) {
    setOccupancyModalLotId(lotId);
    setOccupancyLoading(true);
    try {
      const data = await apiFetch(`/parking/lots/${lotId}/occupancy`, { token });
      setOccupancyData(data);
    } catch (err) {
      setActionError(err.message || 'Could not fetch lot occupancy');
    } finally {
      setOccupancyLoading(false);
    }
  }

  // Handle entry
  async function handleRecordEntry(bookingId) {
    setBusyId(bookingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await apiFetch(`/parking/bookings/${bookingId}/entry`, {
        method: 'POST',
        token,
      });
      setActionSuccess(`Vehicle entry recorded for booking ${res.booking.booking_ref} (Slot ${res.booking.slot_number})`);
      setTimeout(() => setActionSuccess(null), 4000);
      loadBookings();
      loadLots();
    } catch (err) {
      setActionError(err.message || 'Could not record vehicle entry');
    } finally {
      setBusyId(null);
    }
  }

  // Handle exit
  async function handleRecordExit(bookingId) {
    setBusyId(bookingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await apiFetch(`/parking/bookings/${bookingId}/exit`, {
        method: 'POST',
        token,
      });
      setActionSuccess(`Vehicle exit recorded for booking ${res.booking.booking_ref} (Slot ${res.booking.slot_number} is now free)`);
      setTimeout(() => setActionSuccess(null), 4000);
      loadBookings();
      loadLots();
    } catch (err) {
      setActionError(err.message || 'Could not record vehicle exit');
    } finally {
      setBusyId(null);
    }
  }

  // Handle admin cancel
  async function handleAdminCancel(bookingId) {
    setBusyId(bookingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await apiFetch(`/parking/bookings/${bookingId}/cancel`, {
        method: 'POST',
        token,
      });
      setActionSuccess(`Reservation cancelled. Refund of ${formatINR(res.refund.amount_refunded * 100)} processed.`);
      setTimeout(() => setActionSuccess(null), 4000);
      loadBookings();
      loadLots();
    } catch (err) {
      setActionError(err.message || 'Could not cancel reservation');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={styles.title}>Parking Operations &amp; Management</h1>
          <p style={styles.subtitle}>
            Monitor apron parking lots, manage real-time slot occupancy, and process vehicle entry and exit.
          </p>
        </div>

        {/* Airport switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700, color: colors.ink }}>Airport:</label>
          <select
            value={selectedAirportId}
            onChange={(e) => setSelectedAirportId(e.target.value)}
            style={{ ...styles.input, padding: '7px 12px', fontSize: '13px' }}
          >
            {airports.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.city || a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#047857', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined">check_circle</span>
          <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div style={{ ...styles.card, padding: '12px 18px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#b91c1c', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined">error</span>
          <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{actionError}</span>
        </div>
      )}

      {/* Lots Overview Cards */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginBottom: '14px' }}>
          Airport Lots Overview
        </div>

        {lotsLoading ? (
          <div style={{ ...styles.card, padding: '24px', textAlign: 'center', color: colors.muted }}>
            Loading lot occupancy…
          </div>
        ) : lots.length === 0 ? (
          <div style={{ ...styles.card, padding: '24px', textAlign: 'center', color: colors.muted }}>
            No parking lots found for this airport.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {lots.map((lot) => {
              const occupiedCount = lot.total_slots - lot.free_slots;
              const percent = Math.round((occupiedCount / lot.total_slots) * 100);

              return (
                <div key={lot.id} style={{ ...styles.card, padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: colors.ink }}>
                        {lot.name}
                      </div>
                      <div style={{ fontSize: '12px', color: colors.slate, marginTop: '2px' }}>
                        Rate: <strong>{formatINR(lot.hourly_rate * 100)} / hr</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleViewOccupancy(lot.id)}
                      className="btn-glass"
                      style={{ padding: '6px 12px', fontSize: '11.5px' }}
                    >
                      View Slots
                    </button>
                  </div>

                  <div style={{ margin: '12px 0 6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>
                      <span>Occupancy: {occupiedCount} / {lot.total_slots}</span>
                      <span>{percent}%</span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: 'rgba(226, 232, 240, 0.8)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${percent}%`,
                          height: '100%',
                          background: percent > 90 ? '#ef4444' : percent > 70 ? '#f59e0b' : '#10b981',
                          borderRadius: '999px',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ fontSize: '11.5px', color: colors.muted, textAlign: 'right' }}>
                    {lot.free_slots} slots available right now
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bookings Table with Filters */}
      <div style={{ ...styles.card, padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(226, 232, 240, 0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ fontSize: '15px', fontWeight: 800, color: colors.ink }}>
            Parking Bookings Registry ({totalBookings})
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search Ref or Plate (e.g. PK-ACT101 or MH12)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...styles.input, width: '240px', padding: '6px 12px', fontSize: '12.5px', fontFamily: 'monospace' }}
            />
            <button
              onClick={loadBookings}
              disabled={bookingsLoading}
              className="btn-glass"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Status Filters */}
        <div style={{ display: 'flex', gap: '8px', padding: '12px 20px', borderBottom: '1px solid rgba(226, 232, 240, 0.6)', overflowX: 'auto' }}>
          {['all', 'reserved', 'active', 'completed', 'cancelled'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className="btn-glass"
              style={{
                padding: '6px 14px',
                fontSize: '11.5px',
                textTransform: 'capitalize',
                backgroundColor: statusFilter === st ? 'var(--color-primary)' : undefined,
                color: statusFilter === st ? '#fff' : undefined,
              }}
            >
              {st}
            </button>
          ))}
        </div>

        {bookingsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.muted }}>
            Loading bookings…
          </div>
        ) : bookings.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.muted }}>
            No parking bookings found matching the filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface-low)', borderBottom: '1px solid rgba(226, 232, 240, 0.8)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Booking Ref</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Passenger</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Lot &amp; Airport</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Slot #</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Vehicle Plate</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Reserved Window</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800 }}>Paid</th>
                  <th style={{ padding: '12px 16px', fontWeight: 800, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const isReserved = b.status === 'reserved';
                  const isActive = b.status === 'active';
                  const canCancel = isReserved && new Date(b.reserved_from) > new Date();

                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid rgba(226, 232, 240, 0.6)' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 800, color: colors.primary }}>
                        {b.booking_ref}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{b.user_name || 'Passenger'}</div>
                        <div style={{ fontSize: '11px', color: colors.muted }}>{b.user_email}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div>{b.lot_name}</div>
                        <div style={{ fontSize: '11px', color: colors.muted }}>{b.airport_code}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '6px', background: 'rgba(2, 132, 199, 0.08)', color: '#0284c7', fontWeight: 700 }}>
                          {b.slot_number}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 700 }}>
                        {b.vehicle_number}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '11.5px', color: colors.slate }}>
                        <div>{formatDate(b.reserved_from)} {formatTime(b.reserved_from)}</div>
                        <div style={{ color: colors.muted }}>→ {formatDate(b.reserved_until)} {formatTime(b.reserved_until)}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', ...getParkingStatusBadgeStyle(b.status) }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                        {formatINR(parseFloat(b.amount_paid) * 100)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                          {isReserved && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleRecordEntry(b.id)}
                                disabled={busyId === b.id}
                                className="btn-primary-aero"
                                style={{ padding: '4px 10px', fontSize: '11.5px' }}
                                title="Record vehicle entry"
                              >
                                Record Entry
                              </button>
                              {canCancel && (
                                <button
                                  type="button"
                                  onClick={() => handleAdminCancel(b.id)}
                                  disabled={busyId === b.id}
                                  className="btn-destructive-aero"
                                  style={{ padding: '4px 8px', fontSize: '11.5px' }}
                                  title="Cancel reservation & refund"
                                >
                                  Cancel
                                </button>
                              )}
                            </>
                          )}

                          {isActive && (
                            <button
                              type="button"
                              onClick={() => handleRecordExit(b.id)}
                              disabled={busyId === b.id}
                              className="btn-primary-aero"
                              style={{ padding: '4px 10px', fontSize: '11.5px', backgroundColor: '#10b981' }}
                              title="Record vehicle exit"
                            >
                              Record Exit
                            </button>
                          )}

                          {!isReserved && !isActive && (
                            <span style={{ fontSize: '11px', color: colors.muted, fontStyle: 'italic', paddingRight: '4px' }}>
                              Completed
                            </span>
                          )}
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

      {/* ================= LOT OCCUPANCY MODAL ================= */}
      {occupancyModalLotId && occupancyData && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '22px', color: colors.primary }}>
                  local_parking
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: colors.ink }}>
                  {occupancyData.lot.name} — Real-time Slots
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOccupancyModalLotId(null);
                  setOccupancyData(null);
                }}
                className="btn-glass"
                style={{ padding: '4px 8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', fontSize: '12px' }}>
              <span style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 700 }}>
                {occupancyData.free_slots} Free
              </span>
              <span style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontWeight: 700 }}>
                {occupancyData.occupied_slots} Occupied
              </span>
              <span style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(2, 132, 199, 0.1)', color: '#0284c7', fontWeight: 700 }}>
                Total: {occupancyData.total_slots}
              </span>
            </div>

            {/* Slots Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', maxHeight: '380px', overflowY: 'auto' }}>
              {(occupancyData.slots || []).map((slot) => {
                const isOccupied = slot.status === 'occupied';
                return (
                  <div
                    key={slot.id}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '8px',
                      background: isOccupied ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                      border: isOccupied ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 800, color: colors.ink }}>
                      {slot.slot_number}
                    </div>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', color: isOccupied ? '#ef4444' : '#10b981', margin: '2px 0' }}>
                      {slot.status}
                    </div>
                    {slot.vehicle_number && (
                      <div style={{ fontSize: '10px', fontFamily: 'monospace', color: colors.slate, fontWeight: 700 }}>
                        {slot.vehicle_number}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => {
                  setOccupancyModalLotId(null);
                  setOccupancyData(null);
                }}
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
