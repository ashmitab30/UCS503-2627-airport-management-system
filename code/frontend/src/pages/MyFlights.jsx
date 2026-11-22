import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket, LiveStatusPill } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';
import RebookConnectionModal from '../components/connections/RebookConnectionModal.jsx';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

export default function MyFlights() {
  const { token } = useAuth();
  const { socket } = useSocket();
  const [bookings, setBookings] = useState(null);
  const [connections, setConnections] = useState(null);
  const [rebookTarget, setRebookTarget] = useState(null);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const loadBookings = () => {
    apiFetch('/bookings/mine', { token })
      .then((data) => setBookings(data.bookings))
      .catch((err) => setError(err.message));
  };

  const loadConnections = () => {
    apiFetch('/connections/mine', { token })
      .then((data) => setConnections(data.connections || []))
      .catch((err) => console.warn('Could not load connections:', err.message));
  };

  useEffect(() => {
    loadBookings();
    loadConnections();
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const onEvent = () => {
      loadBookings();
      loadConnections();
    };
    socket.on('booking:cancelled', onEvent);
    socket.on('flight:delayed', onEvent);
    socket.on('delay:cascade', onEvent);
    socket.on('flight:gate_changed', onEvent);
    socket.on('flight:status_updated', onEvent);
    socket.on('connection:status_changed', onEvent);

    return () => {
      socket.off('booking:cancelled', onEvent);
      socket.off('flight:delayed', onEvent);
      socket.off('delay:cascade', onEvent);
      socket.off('flight:gate_changed', onEvent);
      socket.off('flight:status_updated', onEvent);
      socket.off('connection:status_changed', onEvent);
    };
  }, [socket]);

  const handleCheckIn = async (bookingId) => {
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      await apiFetch(`/bookings/${bookingId}/check-in`, { method: 'POST', token });
      setActionMessage('Web check-in successful! Your digital boarding pass is ready.');
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmHold = async (bookingId) => {
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      await apiFetch(`/bookings/${bookingId}/confirm-payment`, {
        method: 'POST',
        token,
        body: { payment_method: 'mock_card' },
      });
      setActionMessage('Seat reservation confirmed and mock payment processed successfully!');
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelBooking = async (bookingId) => {
    if (!window.confirm('Are you sure you want to cancel this booking? Any mock payment will be refunded.')) {
      return;
    }
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/bookings/${bookingId}/cancel`, { method: 'POST', token });
      setActionMessage(
        res.refund
          ? `Booking cancelled. Mock refund of $${res.refund.amount} processed.`
          : 'Booking cancelled successfully.'
      );
      loadBookings();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-background)' }}>
      <SiteHeader />

      <div className="aero-hero-light" style={{ borderRadius: 0, padding: '48px 32px 64px' }}>
        <div className="map-dots-ambient" />
        <div style={{ maxWidth: 840, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderRadius: '999px', background: 'rgba(255, 255, 255, 0.85)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '14px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>flight</span>
            <span>Passenger Itinerary Hub</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.025em', fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }}>
            My Flights & Bookings
          </h1>
          <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '1rem', margin: '8px auto 0', maxWidth: 500 }}>
            Your electronic tickets, gate assignments, live tracking, and assistance requests.
          </p>
        </div>
      </div>

      <main style={{ maxWidth: 960, width: '100%', margin: '-30px auto 4rem', padding: '0 24px', flex: 1, position: 'relative', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <LiveStatusPill />
          <Link to="/book" className="btn-primary-aero" style={{ padding: '10px 22px', fontSize: '13.5px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
            <span>Book New Flight</span>
          </Link>
        </div>

        {actionMessage && (
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#10b981', padding: '12px 18px', borderRadius: '12px', marginBottom: '20px', fontSize: '13px', fontWeight: 600 }}>
            {actionMessage}
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}

        {!error && bookings === null && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-slate)' }}>
            <p>Loading flight itineraries…</p>
          </div>
        )}

        {/* Connecting Flight Itineraries Section (Week 6 Stitch Design) */}
        {connections && connections.length > 0 && (
          <div className="mb-8 flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[18px]">connecting_airports</span>
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 font-display">
                    Connecting Flight Itineraries
                  </h2>
                  <p className="text-xs text-slate-500">
                    Multi-segment transfers with real-time MCT buffer tracking & zero-penalty protection.
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200/60">
                {connections.length} {connections.length === 1 ? 'Connection' : 'Connections'} Monitored
              </span>
            </div>

            {connections.map((c) => {
              const isAtRisk = c.status === 'at_risk';
              const isMissed = c.status === 'missed';
              const isOnTrack = c.status === 'on_track';
              const inDep = new Date(c.inbound_departure);
              const inArr = new Date(c.inbound_estimated_arrival || c.inbound_arrival);
              const outDep = new Date(c.outbound_estimated_departure || c.outbound_departure);
              const outArr = new Date(c.outbound_arrival);
              const deficit = c.min_connection_minutes - (c.actual_connection_minutes || 0);

              return (
                <div key={c.id} className="flex flex-col gap-3">
                  {/* Top Dynamic Status Banner */}
                  {isAtRisk && (
                    <div className="w-full bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-white p-5 rounded-2xl border border-amber-300 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-800 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[24px]">warning</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm font-display">
                              Connection At Risk: {c.hub_code} Layover Under Minimum Buffer
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold uppercase tracking-wider">
                              Critical Buffer Alert
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                            Inbound flight <strong>{c.inbound_flight_number}</strong> from {c.inbound_origin_name || c.inbound_origin_code} is delayed by <strong>{c.inbound_delay_minutes} mins</strong>. Your transfer window at {c.hub_name || c.hub_code} ({c.hub_code}) is now <strong className="text-amber-800">{c.actual_connection_minutes} minutes</strong>, which is below the required <strong>{c.min_connection_minutes}-minute Minimum Connection Time (MCT)</strong>.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRebookTarget(c)}
                        className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/25 transition-all flex items-center gap-1.5 shrink-0"
                      >
                        <span>View Rebooking Options</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </button>
                    </div>
                  )}

                  {isMissed && (
                    <div className="w-full bg-gradient-to-r from-rose-500/15 via-rose-500/5 to-white p-5 rounded-2xl border border-rose-300 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[24px]">timer_off</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-sm font-display">
                              Connection Missed: Minimum Transfer Threshold Exceeded
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 text-[10px] font-bold uppercase tracking-wider">
                              Missed Transfer Alert
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                            Inbound flight <strong>{c.inbound_flight_number}</strong> arrival leaves <strong className="text-rose-700">{c.actual_connection_minutes} minutes</strong> at {c.hub_code}, which is below the 20-minute gate closing threshold. You are eligible for immediate ₹0 rebooking under the Passenger Protection Guarantee.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRebookTarget(c)}
                        className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-500/25 transition-all flex items-center gap-1.5 shrink-0"
                      >
                        <span>Rebook Flight Now</span>
                        <span className="material-symbols-outlined text-[16px]">airline_stops</span>
                      </button>
                    </div>
                  )}

                  {isOnTrack && (
                    <div className="w-full bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-white p-4 rounded-2xl border border-emerald-200 shadow-xs flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        </div>
                        <div>
                          <span className="font-bold text-slate-800 text-xs font-display">
                            Connection On Track ({c.actual_connection_minutes}m layover vs {c.min_connection_minutes}m MCT)
                          </span>
                          <p className="text-[11px] text-slate-500">
                            Transfer window at {c.hub_name || c.hub_code} comfortably exceeds standard buffer.
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-bold border border-emerald-200/60">
                        +{Math.abs(deficit)}m Safe Buffer
                      </span>
                    </div>
                  )}

                  {/* Authentic Notched Ticket Container */}
                  <div className="w-full bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                    {/* Ticket Header Bar */}
                    <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-4">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Itinerary Route</span>
                          <span className="text-base font-extrabold text-slate-900 font-display">
                            {c.inbound_origin_name || c.inbound_origin_code} ({c.inbound_origin_code}) → {c.destination_name || c.destination_code} ({c.destination_code})
                          </span>
                        </div>
                        <span className="hidden md:inline-block text-slate-300">|</span>
                        <div className="hidden md:block">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Transfer Hub</span>
                          <span className="text-xs font-bold text-slate-700">{c.hub_name || c.hub_code} ({c.hub_code})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {isAtRisk && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-900 text-xs font-bold border border-amber-200">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                            <span>Connection At Risk</span>
                          </span>
                        )}
                        {isMissed && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-900 text-xs font-bold border border-rose-200">
                            <span className="w-2 h-2 rounded-full bg-rose-600"></span>
                            <span>Connection Missed</span>
                          </span>
                        )}
                        {isOnTrack && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-900 text-xs font-bold border border-emerald-200">
                            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                            <span>On Track</span>
                          </span>
                        )}
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                          2 Segments
                        </span>
                      </div>
                    </div>

                    {/* SEGMENT 1: Inbound */}
                    <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex-1 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-extrabold text-xs flex items-center justify-center">
                              1
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-base font-bold text-slate-900 font-display">
                                  {c.inbound_flight_number}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold">
                                  {c.inbound_class || 'Economy'} ({c.inbound_seat_number || 'Seat Assigned'})
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400">Inbound Segment • {c.inbound_origin_code} to {c.hub_code}</span>
                            </div>
                          </div>

                          {c.inbound_delay_minutes > 0 ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]">schedule</span>
                              <span>+{c.inbound_delay_minutes}m Delayed</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]">check</span>
                              <span>On Schedule</span>
                            </span>
                          )}
                        </div>

                        {/* Segment Telemetry Bar */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <div className="md:col-span-4 flex flex-col">
                            <span className="text-2xl font-black text-slate-900 font-display">{c.inbound_origin_code}</span>
                            <span className="text-xs font-bold text-slate-800">
                              {inDep.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.inbound_origin_name || 'Origin Airport'}</span>
                          </div>

                          <div className="md:col-span-4 flex flex-col items-center justify-center py-1">
                            <div className="w-full flex items-center gap-1 my-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0"></div>
                              <div className="flex-1 border-t-2 border-dashed border-blue-300 relative">
                                <span className="material-symbols-outlined text-blue-600 text-[16px] absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-50 rounded-full">
                                  flight
                                </span>
                              </div>
                              <div className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0"></div>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Flight Segment 1</span>
                          </div>

                          <div className="md:col-span-4 flex flex-col md:text-right">
                            <span className="text-2xl font-black text-slate-900 font-display">{c.hub_code}</span>
                            <span className="text-xs font-bold text-slate-800">
                              {inArr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.hub_name || 'Transit Hub'}</span>
                            {c.inbound_delay_minutes > 0 && (
                              <span className="text-[10px] text-amber-700 font-semibold mt-0.5">
                                Est: {inArr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Action Button */}
                      {c.inbound_booking_id && (
                        <div className="md:border-l md:border-slate-100 md:pl-6 flex md:flex-col justify-end gap-2 shrink-0">
                          <Link
                            to={`/boarding-pass/${c.inbound_booking_id}`}
                            className="px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px] text-blue-600">qr_code</span>
                            <span>Segment 1 Pass</span>
                          </Link>
                        </div>
                      )}
                    </div>

                    {/* NOTCHED TICKET PERFORATION & LAYOVER CONNECTOR */}
                    <div className="relative w-full my-1">
                      <div className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 shadow-inner"></div>
                      <div className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 shadow-inner"></div>
                      <div className="mx-6 border-t-2 border-dashed border-slate-200"></div>
                    </div>

                    {/* LAYOVER INSPECTOR CONNECTOR NODE */}
                    <div className="px-6 py-4 bg-slate-50/60">
                      <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isMissed ? 'bg-rose-100 text-rose-700' : isAtRisk ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            <span className="material-symbols-outlined text-[22px]">transfer_within_a_station</span>
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-extrabold text-slate-900 font-display">
                                Layover at {c.hub_name || c.hub_code} ({c.hub_code})
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                isMissed ? 'bg-rose-100 text-rose-900' : isAtRisk ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
                              }`}>
                                {c.actual_connection_minutes} mins actual
                              </span>
                              <span className="text-xs text-slate-400 font-medium">
                                MCT Standard: {c.min_connection_minutes} mins
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 mt-0.5">
                              Direct hub transfer • Checked baggage auto-routed to destination
                            </span>
                          </div>
                        </div>

                        {/* Layover Telemetry & Rebook Action */}
                        <div className="flex items-center gap-3 justify-end shrink-0">
                          <div className="text-right hidden sm:block">
                            {deficit > 0 ? (
                              <>
                                <span className="text-xs font-bold text-rose-600 block">-{deficit} mins</span>
                                <span className="text-[10px] text-slate-400">Under standard MCT</span>
                              </>
                            ) : (
                              <>
                                <span className="text-xs font-bold text-emerald-600 block">+{Math.abs(deficit)} mins</span>
                                <span className="text-[10px] text-slate-400">Safe connection buffer</span>
                              </>
                            )}
                          </div>

                          {(isAtRisk || isMissed) && (
                            <button
                              type="button"
                              onClick={() => setRebookTarget(c)}
                              className={`px-4 py-2 rounded-full text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 ${
                                isMissed ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-500 hover:bg-amber-600'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px]">airline_stops</span>
                              <span>Rebook Connection</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NOTCHED TICKET PERFORATION BOTTOM */}
                    <div className="relative w-full my-1">
                      <div className="absolute -left-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 shadow-inner"></div>
                      <div className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-100 shadow-inner"></div>
                      <div className="mx-6 border-t-2 border-dashed border-slate-200"></div>
                    </div>

                    {/* SEGMENT 2: Outbound */}
                    <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex-1 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 font-extrabold text-xs flex items-center justify-center">
                              2
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-base font-bold text-slate-900 font-display">
                                  {c.outbound_flight_number}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 text-xs font-semibold">
                                  {c.outbound_class || 'Economy'} ({c.outbound_seat_number || 'Seat Assigned'})
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400">Outbound Segment • {c.hub_code} to {c.destination_code}</span>
                            </div>
                          </div>

                          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold uppercase">
                            {c.outbound_status}
                          </span>
                        </div>

                        {/* Segment Telemetry Bar */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <div className="md:col-span-4 flex flex-col">
                            <span className="text-2xl font-black text-slate-900 font-display">{c.hub_code}</span>
                            <span className="text-xs font-bold text-slate-800">
                              {outDep.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.hub_name || 'Transit Hub'}</span>
                          </div>

                          <div className="md:col-span-4 flex flex-col items-center justify-center py-1">
                            <div className="w-full flex items-center gap-1 my-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-sky-600 shrink-0"></div>
                              <div className="flex-1 border-t-2 border-dashed border-sky-300 relative">
                                <span className="material-symbols-outlined text-sky-600 text-[16px] absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-50 rounded-full">
                                  flight
                                </span>
                              </div>
                              <div className="h-1.5 w-1.5 rounded-full bg-sky-600 shrink-0"></div>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Flight Segment 2</span>
                          </div>

                          <div className="md:col-span-4 flex flex-col md:text-right">
                            <span className="text-2xl font-black text-slate-900 font-display">{c.destination_code}</span>
                            <span className="text-xs font-bold text-slate-800">
                              {outArr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.destination_name || 'Destination Airport'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Quick Action Button */}
                      {c.outbound_booking_id && (
                        <div className="md:border-l md:border-slate-100 md:pl-6 flex md:flex-col justify-end gap-2 shrink-0">
                          <Link
                            to={`/boarding-pass/${c.outbound_booking_id}`}
                            className="px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px] text-sky-600">qr_code</span>
                            <span>Segment 2 Pass</span>
                          </Link>
                        </div>
                      )}
                    </div>

                    {/* Ticket Footer */}
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-blue-600">verified_user</span>
                        <span>
                          <strong>Meridian Seamless Connect™ Guarantee:</strong> Zero-fee rebooking protection included.
                        </span>
                      </div>
                      <span className="font-bold text-slate-600">
                        Ref: {c.outbound_booking_ref || c.inbound_booking_ref || `CON-${c.id}`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Regular Single-Segment Bookings */}
        {bookings && bookings.length === 0 && (!connections || connections.length === 0) && (
          <div className="ticket-notch-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '12px' }}>
              luggage
            </span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>
              No flight bookings found
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '14px' }}>
              You don't have any booked journeys right now. Ready to explore?
            </p>
            <Link to="/book" className="btn-primary-aero">
              Book a Flight Now
            </Link>
          </div>
        )}

        {bookings && bookings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {bookings.map((b) => {
              const isHeld = b.status === 'held';
              const isConfirmed = b.status === 'confirmed';
              const isCheckedIn = b.status === 'checked_in' || b.status === 'boarded';
              const isCancelled = b.status === 'cancelled';
              const isNoShow = b.status === 'no_show';

              return (
                <div key={b.id} className="ticket-notch-card">
                  <div style={{ padding: '24px 28px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="status-pill status-pill-blue">
                          Flight #{b.flight_number}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                          Ref {b.booking_ref}
                        </span>
                      </div>

                      <div>
                        {isHeld && (
                          <span className="status-pill status-pill-amber">
                            <span className="dot-indicator amber" />
                            Seat Held (Pending Payment)
                          </span>
                        )}
                        {isConfirmed && (
                          <span className="status-pill status-pill-blue">
                            <span className="dot-indicator blue" />
                            Confirmed (Check-in Ready)
                          </span>
                        )}
                        {isCheckedIn && (
                          <span className="status-pill status-pill-green">
                            <span className="dot-indicator green" />
                            Checked In
                          </span>
                        )}
                        {isCancelled && (
                          <span className="status-pill status-pill-red">
                            <span className="dot-indicator red" />
                            Cancelled & Refunded
                          </span>
                        )}
                        {isNoShow && (
                          <span className="status-pill status-pill-red">
                            <span className="dot-indicator red" />
                            No-Show
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 16px' }}>
                      <div>
                        <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                          {b.origin_code}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                          {new Date(b.scheduled_departure).toLocaleString()}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span className="material-symbols-outlined" style={{ color: 'var(--color-outline)', transform: 'rotate(90deg)', fontSize: '24px' }}>
                          flight
                        </span>
                        <span style={{ fontSize: '10.5px', color: 'var(--color-slate)', marginTop: '4px' }}>
                          ${(b.price_cents / 100).toFixed(2)}
                        </span>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                          {b.dest_code}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                          {new Date(b.scheduled_arrival).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid rgba(241, 243, 255, 0.9)' }}>
                      <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
                        <span><strong>Seat:</strong> {b.seat_number || '—'} ({b.seat_class || 'Economy'})</span>
                        <span><strong>Passenger:</strong> {b.passenger_name}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {isHeld && (
                          <button
                            onClick={() => handleConfirmHold(b.id)}
                            disabled={busyId === b.id}
                            className="btn-primary-aero"
                            style={{ padding: '8px 16px', fontSize: '12.5px', background: 'var(--color-primary)' }}
                          >
                            <span>Pay & Confirm</span>
                          </button>
                        )}

                        {isConfirmed && (
                          <button
                            onClick={() => handleCheckIn(b.id)}
                            disabled={busyId === b.id}
                            className="btn-primary-aero"
                            style={{ padding: '8px 18px', fontSize: '12.5px', background: '#10B981' }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
                            <span>Web Check-In</span>
                          </button>
                        )}

                        {(isCheckedIn || isConfirmed) && (
                          <>
                            <Link to={`/boarding-pass/${b.id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>qr_code</span>
                              <span>Boarding Pass</span>
                            </Link>
                            <a
                              href={`${API_URL}/bookings/${b.id}/boarding-pass.pdf`}
                              download
                              className="btn-glass"
                              style={{ padding: '8px 12px', fontSize: '12px', textDecoration: 'none' }}
                              title="Download PDF"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
                            </a>
                          </>
                        )}

                        {!isCancelled && !isNoShow && (
                          <button
                            onClick={() => handleCancelBooking(b.id)}
                            disabled={busyId === b.id}
                            className="btn-glass"
                            style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--color-critical)' }}
                            title="Cancel Booking & Refund"
                          >
                            Cancel
                          </button>
                        )}

                        <Link to={`/track/${b.flight_id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>radar</span>
                          <span>Track</span>
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Assistance Pipeline Bar */}
                  {b.assistance_type && (
                    <>
                      <div className="ticket-notch-row">
                        <div className="ticket-notch-left" />
                        <div className="ticket-perf-line" />
                        <div className="ticket-notch-right" />
                      </div>

                      <div style={{ padding: '16px 28px 20px', background: 'var(--color-surface-low)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                              accessibility_new
                            </span>
                            <span>Requested Care: {b.assistance_type.replace('_', ' ')}</span>
                          </div>
                        </div>

                        <div className="stepper-container">
                          {PIPELINE_STEPS.map((step, i) => {
                            const currentIndex = PIPELINE_STEPS.indexOf(b.assistance_status);
                            const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
                            return (
                              <span key={step} className={`stepper-pill ${state}`}>
                                {state === 'done' && (
                                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                                )}
                                {state === 'active' && <span className="pulse-radar-dot" />}
                                <span>{PIPELINE_LABELS[step]}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Rebook Connection Modal */}
        <RebookConnectionModal
          connection={rebookTarget}
          isOpen={Boolean(rebookTarget)}
          onClose={() => setRebookTarget(null)}
          onSuccess={() => {
            setActionMessage('Connection rebooked successfully! Your updated itinerary is now active.');
            loadBookings();
            loadConnections();
          }}
        />
      </main>
    </div>
  );
}
