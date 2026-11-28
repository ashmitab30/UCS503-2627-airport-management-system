import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket, LiveStatusPill } from '../../context/SocketContext.jsx';
import { formatINR, formatDate, formatTime, dayOffsetLabel } from '../../utils/format.js';
import UnlinkConnectionModal from '../../components/connections/UnlinkConnectionModal.jsx';
import AddConnectionModal from '../../components/connections/AddConnectionModal.jsx';
import MctEditorModal from '../../components/connections/MctEditorModal.jsx';
import LogDelayModal from '../../components/flights/LogDelayModal.jsx';

export default function AdminConnections() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { socket } = useSocket();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({ monitored: 0, at_risk: 0, missed: 0, rebooked_today: 0 });
  const [connections, setConnections] = useState([]);
  const [hubs, setHubs] = useState([]);

  // Modals
  const [connectionToUnlink, setConnectionToUnlink] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMctModal, setShowMctModal] = useState(false);
  const [showDelayModal, setShowDelayModal] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'risk' | 'missed'
  const [hubFilter, setHubFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadConnections = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (hubFilter !== 'all') params.set('hub', hubFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const data = await apiFetch(`/connections/admin/at-risk?${params.toString()}`, { token });
      setMetrics(data.metrics || { monitored: 0, at_risk: 0, missed: 0, rebooked_today: 0 });
      setConnections(data.connections || []);
      setHubs(data.hubs || []);
    } catch (err) {
      setError(err.message || 'Failed to load connections at risk');
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, hubFilter, searchQuery]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Live WebSocket updates
  useEffect(() => {
    if (!socket) return;
    const onRefresh = () => loadConnections();

    socket.on('connection:status_changed', onRefresh);
    socket.on('flight:delayed', onRefresh);
    socket.on('delay:cascade', onRefresh);
    socket.on('flight:gate_changed', onRefresh);
    socket.on('flight:status_updated', onRefresh);

    return () => {
      socket.off('connection:status_changed', onRefresh);
      socket.off('flight:delayed', onRefresh);
      socket.off('delay:cascade', onRefresh);
      socket.off('flight:gate_changed', onRefresh);
      socket.off('flight:status_updated', onRefresh);
    };
  }, [socket, loadConnections]);

  return (
    <div className="flex flex-col w-full space-y-6">
      {/* Operational Alert Masthead */}
      <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 pb-2">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px] text-blue-600">security_update_warning</span>
            <span>Transit Concourse Telemetry</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight font-display">
            Connections at Risk
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Live hub transit buffer monitoring, minimum connection time (MCT) violations, and passenger connection status.
          </p>
        </div>

        {/* Actions & Refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <LiveStatusPill />
          <button
            onClick={() => setShowAddModal(true)}
            type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-xs text-xs font-bold"
            title="Create connecting itinerary"
          >
            <span className="material-symbols-outlined text-[16px]">add_link</span>
            <span>Add Connection</span>
          </button>
          <button
            onClick={() => setShowDelayModal(true)}
            type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all border border-slate-200 shadow-xs text-xs font-bold"
            title="Log operational flight delay"
          >
            <span className="material-symbols-outlined text-[16px] text-amber-600">schedule</span>
            <span>Log Delay</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowMctModal(true)}
              type="button"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all border border-slate-200 shadow-xs text-xs font-bold"
              title="Manage Airport Minimum Connection Time"
            >
              <span className="material-symbols-outlined text-[16px] text-blue-600">tune</span>
              <span>Hub MCT Standards</span>
            </button>
          )}
          <button
            onClick={() => {
              setLoading(true);
              loadConnections();
            }}
            type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all border border-slate-200 shadow-xs text-xs font-bold"
            title="Refresh feed"
          >
            <span className="material-symbols-outlined text-[16px] text-blue-600">refresh</span>
            <span>Refresh</span>
          </button>
        </div>
      </section>

      {/* High-Precision Telemetry Metrics Strip (KPIs) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Monitored Transfers */}
        <div className="rounded-xl bg-white p-5 shadow-xs border border-slate-200/80 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
              Monitored Transfers
            </span>
            <span className="material-symbols-outlined text-[20px] text-blue-600">swap_horiz</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 font-display">{metrics.monitored}</span>
            <span className="text-xs font-semibold text-slate-500">Active Itineraries</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
            <span>
              {hubs.length > 0
                ? `Hubs: ${hubs.map((h) => `${h.code} (${h.min_connection_minutes}m)`).join(', ')}`
                : 'Hubs: Transit Concourse Telemetry'}
            </span>
          </div>
        </div>

        {/* Card 2: At Risk (< MCT) */}
        <div className="rounded-xl bg-amber-50/70 p-5 shadow-xs border border-amber-200/70 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-900 tracking-wider uppercase">
              At Risk (&lt; MCT)
            </span>
            <span className="material-symbols-outlined text-[20px] text-amber-600">timelapse</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-950 font-display">{metrics.at_risk}</span>
            <span className="text-xs font-bold text-amber-700">Layover Deficit</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
              Below airport MCT threshold
            </span>
          </div>
        </div>

        {/* Card 3: Missed Connections (< 20m) */}
        <div className="rounded-xl bg-rose-50/70 p-5 shadow-xs border border-rose-200/70 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-900 tracking-wider uppercase">
              Missed Connections
            </span>
            <span className="material-symbols-outlined text-[20px] text-rose-600">warning</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-rose-700 font-display">{metrics.missed}</span>
            <span className="text-xs font-bold text-rose-700">Immediate Action</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
              Gate closed (&lt; 20m) or cancelled
            </span>
          </div>
        </div>

        {/* Card 4: Rebooked & Protected Today */}
        <div className="rounded-xl bg-emerald-50/70 p-5 shadow-xs border border-emerald-200/70 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-900 tracking-wider uppercase">
              Rebooked & Protected
            </span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">verified_user</span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-950 font-display">{metrics.rebooked_today}</span>
            <span className="text-xs font-bold text-emerald-700">Resolved Today</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
            <span>Zero-Fee Guarantee • Fare Difference Applied</span>
          </div>
        </div>
      </section>

      {/* Filter & Hub Selection Bar */}
      <section className="bg-white rounded-xl p-4 shadow-xs border border-slate-200/80 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Status Segmented Tabs */}
          <div className="inline-flex p-1 bg-slate-100 rounded-full self-start" role="tablist">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                statusFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              type="button"
            >
              All Alerts ({metrics.monitored})
            </button>
            <button
              onClick={() => setStatusFilter('risk')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                statusFilter === 'risk'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              type="button"
            >
              At Risk ({metrics.at_risk})
            </button>
            <button
              onClick={() => setStatusFilter('missed')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                statusFilter === 'missed'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              type="button"
            >
              Missed ({metrics.missed})
            </button>
          </div>

          {/* Hub Selector Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-full self-start lg:self-auto flex-wrap">
            {['all', ...(hubs.length > 0 ? hubs.map((h) => h.code) : ['BOM', 'DEL', 'BLR'])].map((hub) => (
              <button
                key={hub}
                onClick={() => setHubFilter(hub)}
                type="button"
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  hubFilter === hub
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {hub === 'all' ? 'All Hubs' : hub}
              </button>
            ))}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative w-full">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search passenger name, PNR (e.g. BK-...), or flight number..."
            className="w-full pl-10 pr-4 py-2 rounded-full bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none border border-slate-200 transition-all"
          />
        </div>
      </section>

      {/* Error callout */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] text-rose-600 shrink-0">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Connections Table Panel */}
      <section className="rounded-xl bg-white shadow-xs border border-slate-200/80 overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-medium">Loading connecting itineraries...</p>
          </div>
        ) : connections.length === 0 ? (
          /* Dedicated Clean Empty State View */
          <div className="p-12 text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-[32px]">check_circle</span>
            </div>
            <h3 className="text-base font-extrabold text-slate-900 font-display">
              No Connections Flagged
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              All monitored transfers matching the selected filters are operating within safe MCT buffers.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3 px-5">Passenger</th>
                  <th className="py-3 px-5">Inbound Flight</th>
                  <th className="py-3 px-5">Outbound Flight</th>
                  <th className="py-3 px-5">Transfer Hub</th>
                  <th className="py-3 px-5">Layover vs MCT</th>
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-slate-100">
                {connections.map((c) => {
                  const inArr = new Date(c.inbound_estimated_arrival || c.inbound_scheduled_arrival);
                  const outDep = new Date(c.outbound_estimated_departure || c.outbound_scheduled_departure);
                  const isAtRisk = c.status === 'at_risk';
                  const isMissed = c.status === 'missed';
                  const isOnTrack = c.status === 'on_track';
                  const deficit = c.min_connection_minutes - (c.actual_connection_minutes || 0);

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isMissed ? 'bg-rose-50/20' : isAtRisk ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Passenger */}
                      <td className="py-3.5 px-5">
                        <div className="flex flex-col">
                          <span className="font-extrabold text-slate-900 font-display text-sm">
                            {c.passenger_name}
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium">
                            PNR #{c.booking_ref}
                          </span>
                        </div>
                      </td>

                      {/* Inbound Flight */}
                      <td className="py-3.5 px-5">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <span className="material-symbols-outlined text-[15px] text-blue-600 rotate-45">
                              flight
                            </span>
                            <span>{c.inbound_flight_number}</span>
                            <span className="text-slate-400 font-normal">
                              ({c.inbound_origin_code} → {c.hub_code})
                            </span>
                          </div>
                          <span className="text-[11px] font-semibold text-blue-600">
                            {formatDate(c.inbound_departure)}
                          </span>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                            <span>Arr {formatTime(inArr)}</span>
                            {c.inbound_delay_minutes > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">
                                +{c.inbound_delay_minutes}m delay
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Outbound Flight */}
                      <td className="py-3.5 px-5">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <span className="material-symbols-outlined text-[15px] text-slate-400">
                              flight_takeoff
                            </span>
                            <span>{c.outbound_flight_number}</span>
                            <span className="text-slate-400 font-normal">
                              ({c.hub_code} → {c.outbound_dest_code})
                            </span>
                          </div>
                          <span className="text-[11px] font-semibold text-sky-600">
                            {formatDate(c.outbound_departure)}
                          </span>
                          <span className="text-[11px] text-slate-500 mt-0.5">
                            Dep {formatTime(outDep)} ({c.outbound_status})
                            {dayOffsetLabel(c.outbound_departure, c.outbound_arrival) && (
                              <span className="text-[10px] text-rose-600 font-bold ml-1">
                                {dayOffsetLabel(c.outbound_departure, c.outbound_arrival)}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>

                      {/* Transfer Hub */}
                      <td className="py-3.5 px-5">
                        <span className="px-2.5 py-1 rounded-md bg-slate-100 text-blue-700 font-extrabold text-xs">
                          {c.hub_code}
                        </span>
                      </td>

                      {/* Layover vs MCT */}
                      <td className="py-3.5 px-5">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">
                            {c.actual_connection_minutes}m{' '}
                            <span className="text-slate-400 font-normal">vs {c.min_connection_minutes}m MCT</span>
                          </span>
                          {deficit > 0 ? (
                            <span className="text-rose-600 font-bold text-[10px] flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[12px]">trending_down</span>
                              -{deficit}m deficit
                            </span>
                          ) : (
                            <span className="text-emerald-600 font-semibold text-[10px] flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[12px]">check</span>
                              +{Math.abs(deficit)}m safe buffer
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-5">
                        {isAtRisk && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            <span>At Risk</span>
                          </span>
                        )}
                        {isMissed && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-100 text-rose-900 font-bold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                            <span>Missed</span>
                          </span>
                        )}
                        {isOnTrack && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                            <span>On Track</span>
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => setConnectionToUnlink(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 font-semibold text-[11px] transition-colors"
                          title="Unlink connection (bookings remain confirmed)"
                        >
                          <span className="material-symbols-outlined text-[14px]">link_off</span>
                          <span>Unlink</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-blue-600">verified</span>
            <span>
              {hubs.length > 0
                ? `MCT Standards: ${hubs.map((h) => `${h.code} = ${h.min_connection_minutes}m`).join(' · ')}`
                : 'MCT Standards: BOM = 45m · DEL = 60m · BLR = 40m'}
            </span>
          </div>
          <div className="font-semibold text-slate-700">
            {connections.length} {connections.length === 1 ? 'record' : 'records'} active
          </div>
        </div>
      </section>

      {/* Admin Connection Dialogs */}
      <UnlinkConnectionModal
        isOpen={!!connectionToUnlink}
        connection={connectionToUnlink}
        onClose={() => setConnectionToUnlink(null)}
        onSuccess={loadConnections}
      />
      <AddConnectionModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={loadConnections}
      />
      <MctEditorModal
        isOpen={showMctModal}
        onClose={() => setShowMctModal(false)}
        onSuccess={loadConnections}
      />
      <LogDelayModal
        isOpen={showDelayModal}
        onClose={() => setShowDelayModal(false)}
        onSuccess={loadConnections}
      />
    </div>
  );
}
