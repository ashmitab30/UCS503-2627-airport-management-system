import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket, LiveStatusPill } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import SiteHeader from './SiteHeader.jsx';
import RebookConnectionModal from '../components/connections/RebookConnectionModal.jsx';
import LinkConnectionModal from '../components/connections/LinkConnectionModal.jsx';
import UnlinkConnectionModal from '../components/connections/UnlinkConnectionModal.jsx';
import CancelBookingModal from '../components/booking/CancelBookingModal.jsx';
import { findValidConnectionPartners } from '../utils/connectionValidation.js';
import { formatINR, formatDate, formatTime, dayOffsetLabel } from '../utils/format.js';
import { BAGGAGE_STATUS_LABELS, getStatusBadgeStyle } from '../utils/baggageValidation.js';
import {
  validateAssistanceInput,
  ASSISTANCE_TYPE_LABELS,
  getBoardingGroupInfo,
} from '../utils/assistanceValidation.js';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

// Departure & Check-In helpers
export const isBookingDeparted = (b, now = Date.now()) => {
  if (!b) return false;
  if (['departed', 'in_air', 'landed'].includes(b.flight_status)) return true;
  const depTime = b.actual_departure || b.scheduled_departure;
  return depTime ? new Date(depTime).getTime() <= now : false;
};

export const isConnectionDeparted = (c, now = Date.now()) => {
  if (!c) return false;
  if (['departed', 'in_air', 'landed'].includes(c.outbound_status)) return true;
  const outDep = c.outbound_estimated_departure || c.outbound_departure;
  return outDep ? new Date(outDep).getTime() <= now : false;
};

export const isCheckInOpen = (b, now = Date.now()) => {
  if (!b || b.status !== 'confirmed') return false;
  if (isBookingDeparted(b, now)) return false;
  const dep = b.actual_departure || b.scheduled_departure;
  if (!dep) return false;
  const depTime = new Date(dep).getTime();
  if (Number.isNaN(depTime)) return false;
  const diffHours = (depTime - now) / (1000 * 3600);
  return diffHours <= 24 && diffHours >= 0;
};

export default function MyFlights({
  initialBookings = null,
  initialConnections = null,
  initialBaggage = {},
  initialActiveTab = 'upcoming',
} = {}) {
  let token = null;
  try {
    const auth = useAuth();
    token = auth?.token;
  } catch {
    // In test harness or unauthenticated fallback
  }

  let socket = null;
  try {
    const sockCtx = useSocket();
    socket = sockCtx?.socket;
  } catch {
    // In test harness
  }
  const [bookings, setBookings] = useState(initialBookings);
  const [connections, setConnections] = useState(initialConnections);
  const [airports, setAirports] = useState([]);
  const [rebookTarget, setRebookTarget] = useState(null);
  const [linkTargetBooking, setLinkTargetBooking] = useState(null);
  const [unlinkTargetConnection, setUnlinkTargetConnection] = useState(null);
  const [cancelModalBooking, setCancelModalBooking] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [activeTab, setActiveTab] = useState(initialActiveTab); // 'upcoming' | 'past'
  const [baggageByBooking, setBaggageByBooking] = useState(initialBaggage);

  // Assistance request modal state
  const [assistanceModalBooking, setAssistanceModalBooking] = useState(null);
  const [assistanceType, setAssistanceType] = useState('wheelchair');
  const [assistanceNotes, setAssistanceNotes] = useState('');
  const [assistanceBusy, setAssistanceBusy] = useState(false);
  const [assistanceError, setAssistanceError] = useState(null);
  const [cancelAssistanceBusyId, setCancelAssistanceBusyId] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const loadBaggage = async (bookingList) => {
    if (!bookingList || !token) return;
    const map = {};
    await Promise.all(
      bookingList.map(async (b) => {
        try {
          const res = await apiFetch(`/bookings/${b.id}/baggage`, { token });
          if (res.baggage && res.baggage.length > 0) {
            map[b.id] = res.baggage;
          }
        } catch {
          // ignore error for no baggage or non-owner
        }
      })
    );
    setBaggageByBooking((prev) => ({ ...prev, ...map }));
  };

  const loadBookings = () => {
    apiFetch('/bookings/mine', { token })
      .then((data) => {
        setBookings(data.bookings);
        loadBaggage(data.bookings);
      })
      .catch((err) => setError(err.message));
  };

  const loadConnections = () => {
    apiFetch('/connections/mine', { token })
      .then((data) => setConnections(data.connections || []))
      .catch((err) => console.warn('Could not load connections:', err.message));
  };

  useEffect(() => {
    if (!token) return;
    loadBookings();
    loadConnections();
    apiFetch('/airports')
      .then((data) => setAirports(data.airports || []))
      .catch((err) => console.warn('Could not load airports:', err.message));
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
    socket.on('baggage_updated', onEvent);
    socket.on('baggage_registered', onEvent);
    socket.on('assistance:created', onEvent);
    socket.on('assistance:updated', onEvent);
    socket.on('assistance:cancelled', onEvent);

    return () => {
      socket.off('booking:cancelled', onEvent);
      socket.off('flight:delayed', onEvent);
      socket.off('delay:cascade', onEvent);
      socket.off('flight:gate_changed', onEvent);
      socket.off('flight:status_updated', onEvent);
      socket.off('connection:status_changed', onEvent);
      socket.off('baggage_updated', onEvent);
      socket.off('baggage_registered', onEvent);
      socket.off('assistance:created', onEvent);
      socket.off('assistance:updated', onEvent);
      socket.off('assistance:cancelled', onEvent);
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
      if (err.detail?.code === 'FLIGHT_DEPARTED' || err.message?.includes('departed')) {
        setError('This flight has already departed and check-in is closed.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAssistance = async (e) => {
    if (e) e.preventDefault();
    if (!assistanceModalBooking) return;

    const validation = validateAssistanceInput(assistanceType, assistanceNotes);
    if (!validation.valid) {
      setAssistanceError(validation.error);
      return;
    }

    setAssistanceBusy(true);
    setAssistanceError(null);
    try {
      await apiFetch(`/bookings/${assistanceModalBooking.id}/assistance`, {
        method: 'POST',
        token,
        body: {
          type: assistanceType,
          notes: assistanceNotes.trim() || undefined,
        },
      });
      setActionMessage('Special assistance request submitted successfully. You have been assigned Priority Boarding (Group 1).');
      setAssistanceModalBooking(null);
      setAssistanceType('wheelchair');
      setAssistanceNotes('');
      loadBookings();
    } catch (err) {
      setAssistanceError(err.message || 'Could not submit assistance request');
    } finally {
      setAssistanceBusy(false);
    }
  };

  const handleCancelAssistance = async (booking) => {
    if (!booking?.assistance_id) return;
    setCancelAssistanceBusyId(booking.id);
    setActionMessage(null);
    setError(null);
    try {
      await apiFetch(`/bookings/assistance/${booking.assistance_id}/cancel`, {
        method: 'POST',
        token,
      });
      setActionMessage('Special assistance request cancelled successfully.');
      loadBookings();
    } catch (err) {
      setError(err.message || 'Could not cancel assistance request');
    } finally {
      setCancelAssistanceBusyId(null);
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
      if (err.detail?.code === 'FLIGHT_DEPARTED' || err.message?.includes('departed')) {
        setError('This flight departed while your seat was held and can no longer be confirmed.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenCancelModal = (booking) => {
    setCancelModalBooking(booking);
    setCancelError(null);
  };

  const handleCloseCancelModal = () => {
    if (cancelLoading) return;
    setCancelModalBooking(null);
    setCancelError(null);
  };

  const handleConfirmCancel = async () => {
    if (!cancelModalBooking || cancelLoading) return;
    const bookingId = cancelModalBooking.id;
    setCancelLoading(true);
    setCancelError(null);
    setBusyId(bookingId);
    setActionMessage(null);
    setError(null);
    try {
      const res = await apiFetch(`/bookings/${bookingId}/cancel`, { method: 'POST', token });
      setActionMessage(
        res.refund
          ? `Booking cancelled. Mock refund of ${formatINR(Math.round(Number(res.refund.amount) * 100))} processed.`
          : 'Booking cancelled successfully.'
      );
      setCancelModalBooking(null);
      loadBookings();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel booking.');
    } finally {
      setCancelLoading(false);
      setBusyId(null);
    }
  };

  const upcomingBookings = bookings ? bookings.filter((b) => !isBookingDeparted(b)) : [];
  const pastBookings = bookings ? bookings.filter((b) => isBookingDeparted(b)) : [];

  const upcomingConnections = connections ? connections.filter((c) => !isConnectionDeparted(c)) : [];
  const pastConnections = connections ? connections.filter((c) => isConnectionDeparted(c)) : [];

  const currentBookings = activeTab === 'upcoming' ? upcomingBookings : pastBookings;
  const currentConnections = activeTab === 'upcoming' ? upcomingConnections : pastConnections;

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
            My Flights &amp; Bookings
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

        {/* Tab Selection: Upcoming vs Past */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', borderBottom: '1px solid rgba(226, 232, 240, 0.8)', paddingBottom: '12px' }}>
          <button
            type="button"
            onClick={() => {
              setActiveTab('upcoming');
              setError(null);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 20px',
              borderRadius: '999px',
              border: 'none',
              background: activeTab === 'upcoming' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.8)',
              color: activeTab === 'upcoming' ? '#ffffff' : 'var(--color-slate)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'upcoming' ? '0 2px 8px rgba(29, 99, 255, 0.25)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>flight_takeoff</span>
            <span>Upcoming Flights ({bookings ? upcomingBookings.length + upcomingConnections.length : 0})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('past');
              setError(null);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 20px',
              borderRadius: '999px',
              border: 'none',
              background: activeTab === 'past' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.8)',
              color: activeTab === 'past' ? '#ffffff' : 'var(--color-slate)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: activeTab === 'past' ? '0 2px 8px rgba(29, 99, 255, 0.25)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>history</span>
            <span>Past Flights ({bookings ? pastBookings.length + pastConnections.length : 0})</span>
          </button>
        </div>

        {actionMessage && (
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#10b981', padding: '12px 18px', borderRadius: '12px', marginBottom: '20px', fontSize: '13px', fontWeight: 600 }}>
            {actionMessage}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid #ef4444', color: '#b91c1c', padding: '12px 18px', borderRadius: '12px', marginBottom: '20px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
            <span>{error}</span>
          </div>
        )}

        {!error && bookings === null && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-slate)' }}>
            <p>Loading flight itineraries…</p>
          </div>
        )}

        {/* Connecting Flight Itineraries Section */}
        {currentConnections && currentConnections.length > 0 && (
          <div className="mb-8 flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[18px]">connecting_airports</span>
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 font-display">
                    {activeTab === 'upcoming' ? 'Connecting Flight Itineraries' : 'Past Connecting Journeys'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {activeTab === 'upcoming'
                      ? 'Multi-segment transfers with real-time MCT buffer tracking & zero-penalty protection.'
                      : 'Completed multi-segment itineraries.'}
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200/60">
                {currentConnections.length} {currentConnections.length === 1 ? 'Connection' : 'Connections'}
              </span>
            </div>

            {currentConnections.map((c) => {
              const isAtRisk = c.status === 'at_risk';
              const isMissed = c.status === 'missed';
              const isOnTrack = c.status === 'on_track';
              const inDep = c.inbound_departure ? new Date(c.inbound_departure) : null;
              const inArr = (c.inbound_estimated_arrival || c.inbound_arrival) ? new Date(c.inbound_estimated_arrival || c.inbound_arrival) : null;
              const outDep = (c.outbound_estimated_departure || c.outbound_departure) ? new Date(c.outbound_estimated_departure || c.outbound_departure) : null;
              const outArr = c.outbound_arrival ? new Date(c.outbound_arrival) : null;
              const deficit = (c.min_connection_minutes || 0) - (c.actual_connection_minutes || 0);

              return (
                <div key={c.id} className="flex flex-col gap-3">
                  {/* Top Dynamic Status Banner — only for upcoming connections */}
                  {activeTab === 'upcoming' && isAtRisk && (
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

                  {activeTab === 'upcoming' && isMissed && (
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
                            Inbound flight <strong>{c.inbound_flight_number}</strong> arrival leaves <strong className="text-rose-700">{c.actual_connection_minutes} minutes</strong> at {c.hub_code}, which is below the 20-minute gate closing threshold. You are eligible for immediate {formatINR(0)} rebooking under the Passenger Protection Guarantee.
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

                  {activeTab === 'upcoming' && isOnTrack && (
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
                        {activeTab === 'past' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                            <span>Journey Completed</span>
                          </span>
                        ) : (
                          <>
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
                          </>
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
                              <span className="text-[11px] text-blue-600 font-bold">{formatDate(c.inbound_departure)}</span>
                              <span className="text-[11px] text-slate-400">• Inbound Segment • {c.inbound_origin_code} to {c.hub_code}</span>
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
                              <span>{activeTab === 'past' ? 'Departed' : 'On Schedule'}</span>
                            </span>
                          )}
                        </div>

                        {/* Segment Telemetry Bar */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <div className="md:col-span-4 flex flex-col">
                            <span className="text-2xl font-black text-slate-900 font-display">{c.inbound_origin_code}</span>
                            <span className="text-xs font-bold text-slate-800">
                              {formatTime(inDep)}
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
                              {formatTime(inArr)}{dayOffsetLabel(inDep, inArr) ? ` (${dayOffsetLabel(inDep, inArr)})` : ''}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.hub_name || 'Transit Hub'}</span>
                            {c.inbound_delay_minutes > 0 && (
                              <span className="text-[10px] text-amber-700 font-semibold mt-0.5">
                                Est: {formatTime(inArr)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Action Button — only for upcoming */}
                      {activeTab === 'upcoming' && c.inbound_booking_id && (
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
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-sky-600 font-bold">{formatDate(c.outbound_departure)}</span>
                                <span className="text-[11px] text-slate-400">• Outbound Segment • {c.hub_code} to {c.destination_code}</span>
                              </div>
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
                              {formatTime(outDep)}
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
                              {formatTime(outArr)}{dayOffsetLabel(outDep, outArr) ? ` (${dayOffsetLabel(outDep, outArr)})` : ''}
                            </span>
                            <span className="text-[10px] text-slate-400">{c.destination_name || 'Destination Airport'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Quick Action Button — only for upcoming */}
                      {activeTab === 'upcoming' && c.outbound_booking_id && (
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
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-600">
                          Ref: {c.outbound_booking_ref || c.inbound_booking_ref || `CON-${c.id}`}
                        </span>
                        {activeTab === 'upcoming' && (
                          <button
                            type="button"
                            onClick={() => setUnlinkTargetConnection(c)}
                            className="px-2.5 py-1 rounded-full bg-slate-200/80 hover:bg-rose-50 text-slate-700 hover:text-rose-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                            title="Unlink this connection"
                          >
                            <span className="material-symbols-outlined text-[14px]">link_off</span>
                            <span>Unlink</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Regular Single-Segment Bookings */}
        {bookings && currentBookings.length === 0 && (!currentConnections || currentConnections.length === 0) && (
          <div className="ticket-notch-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--color-slate)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-outline-variant)', marginBottom: '12px' }}>
              {activeTab === 'upcoming' ? 'luggage' : 'history'}
            </span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>
              {activeTab === 'upcoming' ? 'No upcoming flight bookings found' : 'No past flight journeys found'}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '14px' }}>
              {activeTab === 'upcoming'
                ? "You don't have any upcoming journeys right now. Ready to explore?"
                : 'Your historical flights and past booking records will appear here.'}
            </p>
            {activeTab === 'upcoming' && (
              <Link to="/book" className="btn-primary-aero">
                Book a Flight Now
              </Link>
            )}
          </div>
        )}

        {currentBookings && currentBookings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {currentBookings.map((b) => {
              const isHeld = b.status === 'held';
              const isConfirmed = b.status === 'confirmed';
              const isCheckedIn = b.status === 'checked_in' || b.status === 'boarded';
              const isCancelled = b.status === 'cancelled';
              const isNoShow = b.status === 'no_show';
              const isDeparted = isBookingDeparted(b);
              const checkInReady = isCheckInOpen(b);
              const validPartners = activeTab === 'upcoming' && isConfirmed && !isDeparted
                ? findValidConnectionPartners(b, upcomingBookings, airports, upcomingConnections)
                : [];
              const canLink = validPartners.length > 0;

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
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
                          {formatDate(b.scheduled_departure)}
                        </span>
                      </div>

                      <div>
                        {activeTab === 'past' ? (
                          // Past bookings: status only
                          <>
                            {isCheckedIn && (
                              <span className="status-pill status-pill-green">
                                <span className="dot-indicator green" />
                                Completed (Checked In)
                              </span>
                            )}
                            {isConfirmed && (
                              <span className="status-pill status-pill-slate">
                                <span className="dot-indicator slate" />
                                Departed
                              </span>
                            )}
                            {isCancelled && (
                              <span className="status-pill status-pill-red">
                                <span className="dot-indicator red" />
                                Cancelled &amp; Refunded
                              </span>
                            )}
                            {isNoShow && (
                              <span className="status-pill status-pill-red">
                                <span className="dot-indicator red" />
                                No-Show
                              </span>
                            )}
                            {isHeld && (
                              <span className="status-pill status-pill-amber">
                                <span className="dot-indicator amber" />
                                Expired Hold
                              </span>
                            )}
                          </>
                        ) : (
                          // Upcoming bookings
                          <>
                            {isHeld && (
                              <span className="status-pill status-pill-amber">
                                <span className="dot-indicator amber" />
                                Seat Held (Pending Payment)
                              </span>
                            )}
                            {isConfirmed && checkInReady && (
                              <span className="status-pill status-pill-green">
                                <span className="dot-indicator green" />
                                Confirmed (Check-In Ready)
                              </span>
                            )}
                            {isConfirmed && !checkInReady && (
                              <span className="status-pill status-pill-blue">
                                <span className="dot-indicator blue" />
                                Confirmed
                              </span>
                            )}
                            {isCheckedIn && (
                              <span className="status-pill status-pill-green">
                                <span className="dot-indicator green" />
                                Checked In
                              </span>
                            )}
                            {b.boarding_group === 1 && (
                              <span className="status-pill status-pill-cyan" style={{ fontWeight: 800 }}>
                                ★ Priority Boarding (Group 1)
                              </span>
                            )}
                            {b.boarding_group === 2 && (
                              <span className="status-pill status-pill-blue">
                                Boarding Group 2
                              </span>
                            )}
                            {isCancelled && (
                              <span className="status-pill status-pill-red">
                                <span className="dot-indicator red" />
                                Cancelled &amp; Refunded
                              </span>
                            )}
                            {isNoShow && (
                              <span className="status-pill status-pill-red">
                                <span className="dot-indicator red" />
                                No-Show
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '14px 0 16px' }}>
                      <div>
                        <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                          {b.origin_code}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                          {formatDate(b.scheduled_departure)}, {formatTime(b.scheduled_departure)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span className="material-symbols-outlined" style={{ color: 'var(--color-outline)', transform: 'rotate(90deg)', fontSize: '24px' }}>
                          flight
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-slate)', marginTop: '4px' }}>
                          {formatINR(b.price_cents)}
                        </span>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--color-secondary)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                          {b.dest_code}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px', display: 'block' }}>
                          {formatTime(b.scheduled_arrival)}{dayOffsetLabel(b.scheduled_departure, b.scheduled_arrival) ? ` (${dayOffsetLabel(b.scheduled_departure, b.scheduled_arrival)})` : ''}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid rgba(241, 243, 255, 0.9)' }}>
                      <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
                        <span><strong>Seat:</strong> {b.seat_number || '—'} ({b.seat_class || 'Economy'})</span>
                        <span><strong>Passenger:</strong> {b.passenger_name}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {activeTab === 'past' ? (
                          // Past bookings show status only, with no action buttons (no check-in, cancel, rebook)
                          <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>
                            {isCancelled ? 'Booking Cancelled' : isCheckedIn ? 'Travel Completed' : 'Historical Flight'}
                          </span>
                        ) : (
                          // Upcoming action buttons
                          <>
                            {isHeld && (
                              <button
                                onClick={() => handleConfirmHold(b.id)}
                                disabled={busyId === b.id}
                                className="btn-primary-aero"
                                style={{ padding: '8px 16px', fontSize: '12.5px', background: 'var(--color-primary)' }}
                              >
                                <span>Pay &amp; Confirm</span>
                              </button>
                            )}

                            {isConfirmed && checkInReady && (
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

                            {isConfirmed && !checkInReady && !isDeparted && (
                              <span style={{ fontSize: '11.5px', color: 'var(--color-slate)', fontWeight: 600, padding: '4px 8px', background: 'rgba(241, 245, 249, 0.9)', borderRadius: '6px' }}>
                                Check-in opens 24h prior
                              </span>
                            )}

                            {(isCheckedIn || (isConfirmed && checkInReady)) && (
                              <>
                                <Link to={`/boarding-pass/${b.id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>qr_code</span>
                                  <span>Boarding Pass</span>
                                </Link>
                                <a
                                  href={`${API_URL}/bookings/${b.id}/boarding-pass.pdf${token ? `?token=${encodeURIComponent(token)}` : ''}`}
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
                                type="button"
                                onClick={() => handleOpenCancelModal(b)}
                                disabled={busyId === b.id}
                                className="btn-destructive-aero"
                                title="Cancel Booking &amp; Refund"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                                  cancel
                                </span>
                                <span>Cancel</span>
                              </button>
                            )}

                            <Link to={`/track/${b.flight_id}`} className="btn-glass" style={{ padding: '8px 14px', fontSize: '12px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>radar</span>
                              <span>Track</span>
                            </Link>

                            {canLink && (
                              <button
                                type="button"
                                onClick={() => setLinkTargetBooking(b)}
                                className="btn-glass"
                                style={{ padding: '8px 14px', fontSize: '12px', borderColor: 'rgba(37, 99, 235, 0.4)', color: 'var(--color-primary)' }}
                                title="Link this flight with a connecting journey"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>link</span>
                                <span>Link as connection</span>
                              </button>
                            )}

                            {(isConfirmed || isCheckedIn) && !isDeparted && (!b.assistance_type || ['completed', 'cancelled'].includes(b.assistance_status)) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAssistanceModalBooking(b);
                                  setAssistanceType('wheelchair');
                                  setAssistanceNotes('');
                                  setAssistanceError(null);
                                }}
                                className="btn-glass"
                                style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--color-primary)' }}
                                title="Request special passenger assistance (wheelchair, medical, visual, etc.)"
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>accessible</span>
                                <span>Request Assistance</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Assistance Pipeline Bar */}
                  {b.assistance_type && b.assistance_status !== 'cancelled' && (
                    <>
                      <div className="ticket-notch-row">
                        <div className="ticket-notch-left" />
                        <div className="ticket-perf-line" />
                        <div className="ticket-notch-right" />
                      </div>

                      <div style={{ padding: '16px 28px 20px', background: 'var(--color-surface-low)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                              accessibility_new
                            </span>
                            <span>Requested Care: {ASSISTANCE_TYPE_LABELS[b.assistance_type] || b.assistance_type?.replace(/_/g, ' ') || 'Special Assistance'}</span>
                            {b.assigned_staff_first_name && (
                              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate)', marginLeft: '4px' }}>
                                &middot; Assigned to: <strong style={{ color: 'var(--color-on-surface)' }}>{b.assigned_staff_first_name}</strong>
                              </span>
                            )}
                          </div>

                          {b.assistance_status === 'requested' && (
                            <button
                              type="button"
                              onClick={() => handleCancelAssistance(b)}
                              disabled={cancelAssistanceBusyId === b.id}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--color-danger)',
                                color: 'var(--color-danger)',
                                borderRadius: '8px',
                                padding: '4px 10px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                              <span>{cancelAssistanceBusyId === b.id ? 'Cancelling…' : 'Cancel Assistance'}</span>
                            </button>
                          )}
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

                  {/* Checked Baggage Section */}
                  {baggageByBooking[b.id] && baggageByBooking[b.id].length > 0 && (
                    <>
                      <div className="ticket-notch-row">
                        <div className="ticket-notch-left" />
                        <div className="ticket-perf-line" />
                        <div className="ticket-notch-right" />
                      </div>

                      <div style={{ padding: '16px 28px 20px', background: 'var(--color-surface-low)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>
                              luggage
                            </span>
                            <span>
                              Checked Baggage ({baggageByBooking[b.id].length} {baggageByBooking[b.id].length === 1 ? 'bag' : 'bags'})
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {baggageByBooking[b.id].map((bag) => {
                            const isLost = bag.status === 'lost';
                            const BAGGAGE_PIPELINE = ['checked_in', 'loaded', 'in_transit', 'arrived'];
                            const currentStepIdx = BAGGAGE_PIPELINE.indexOf(bag.status);

                            return (
                              <div
                                key={bag.id}
                                style={{
                                  background: '#ffffff',
                                  borderRadius: '12px',
                                  border: '1px solid rgba(226, 232, 240, 0.9)',
                                  padding: '14px 18px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13.5px', color: 'var(--color-primary)' }}>
                                      TAG #{bag.tag_number}
                                    </span>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
                                      {bag.weight != null ? bag.weight : '—'} kg
                                    </span>
                                  </div>
                                  <span
                                    style={{
                                      padding: '3px 10px',
                                      borderRadius: '999px',
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      textTransform: 'uppercase',
                                      ...getStatusBadgeStyle(bag.status),
                                    }}
                                  >
                                    {BAGGAGE_STATUS_LABELS[bag.status] || bag.status}
                                  </span>
                                </div>

                                {!isLost && (
                                  <div className="stepper-container" style={{ marginBottom: '10px' }}>
                                    {BAGGAGE_PIPELINE.map((step, idx) => {
                                      const state = idx < currentStepIdx ? 'done' : idx === currentStepIdx ? 'active' : 'pending';
                                      return (
                                        <span key={step} className={`stepper-pill ${state}`}>
                                          {state === 'done' && (
                                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                                          )}
                                          {state === 'active' && <span className="pulse-radar-dot" />}
                                          <span>{BAGGAGE_STATUS_LABELS[step]}</span>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {isLost && (
                                  <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#b91c1c', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>warning</span>
                                    <span>Baggage irregularity reported. Please contact staff or visit the Baggage Desk.</span>
                                  </div>
                                )}

                                {bag.scans && bag.scans.length > 0 && (
                                  <div style={{ borderTop: '1px solid rgba(226, 232, 240, 0.7)', paddingTop: '8px', marginTop: '4px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-slate)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                                      Status History
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {bag.scans.map((scan, sIdx) => (
                                        <div key={scan.id || sIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--color-on-surface)' }}>
                                          <span>
                                            <strong style={{ color: 'var(--color-primary)' }}>{BAGGAGE_STATUS_LABELS[scan.status] || scan.status}</strong> — {scan.location || 'Airport'}
                                          </span>
                                          <span style={{ color: 'var(--color-slate)', fontSize: '11px' }}>
                                            {formatDate(scan.scanned_at)} {formatTime(scan.scanned_at)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
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

        {/* Cancel Booking Confirmation Modal */}
        <CancelBookingModal
          isOpen={Boolean(cancelModalBooking)}
          booking={cancelModalBooking}
          onClose={handleCloseCancelModal}
          onConfirm={handleConfirmCancel}
          loading={cancelLoading}
          error={cancelError}
        />

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

        {/* Link Connection Modal */}
        <LinkConnectionModal
          isOpen={Boolean(linkTargetBooking)}
          sourceBooking={linkTargetBooking}
          allBookings={upcomingBookings}
          airports={airports}
          existingConnections={upcomingConnections}
          onClose={() => setLinkTargetBooking(null)}
          onSuccess={() => {
            setActionMessage('Flights successfully linked as a connection! You can now view and monitor the full itinerary above.');
            loadBookings();
            loadConnections();
          }}
        />

        {/* Unlink Connection Modal */}
        <UnlinkConnectionModal
          isOpen={Boolean(unlinkTargetConnection)}
          connection={unlinkTargetConnection}
          passengerMode={true}
          onClose={() => setUnlinkTargetConnection(null)}
          onSuccess={() => {
            setActionMessage('Connection unlinked successfully. Your flight bookings remain confirmed and active.');
            loadBookings();
            loadConnections();
          }}
        />

        {/* Request Special Passenger Assistance Modal */}
        {assistanceModalBooking && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ ...styles.card, maxWidth: '480px', width: '100%', padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>
                  accessible
                </span>
                <h3 style={{ ...styles.cardTitle, margin: 0, fontSize: '18px' }}>
                  Request Special Assistance
                </h3>
              </div>
              <p style={{ ...styles.subtitle, marginBottom: '16px' }}>
                Flight #{assistanceModalBooking.flight_number} ({assistanceModalBooking.origin_code} &rarr; {assistanceModalBooking.dest_code}). Passengers with an active assistance request automatically receive <strong>Priority Boarding (Group 1)</strong>.
              </p>

              {assistanceError && <p style={styles.error}>{assistanceError}</p>}

              <form onSubmit={handleCreateAssistance} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>Service Type:</span>
                  <select
                    value={assistanceType}
                    onChange={(e) => setAssistanceType(e.target.value)}
                    style={styles.input}
                    required
                  >
                    {Object.entries(ASSISTANCE_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>Special Requirements / Notes:</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-outline)' }}>{assistanceNotes.length}/500</span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={assistanceNotes}
                    onChange={(e) => setAssistanceNotes(e.target.value)}
                    placeholder="e.g. Electric wheelchair transport, escort through security, or oxygen assistance requirements (optional)"
                    style={{ ...styles.input, resize: 'vertical' }}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                  <button
                    type="button"
                    className="btn-glass"
                    onClick={() => {
                      setAssistanceModalBooking(null);
                      setAssistanceError(null);
                    }}
                    disabled={assistanceBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary-aero"
                    disabled={assistanceBusy}
                  >
                    {assistanceBusy ? 'Submitting…' : 'Submit Assistance Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
