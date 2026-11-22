import { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function RebookConnectionModal({ connection, isOpen, onClose, onSuccess }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rebookingData, setRebookingData] = useState(null);
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [selectedSeatId, setSelectedSeatId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !connection) return;

    setLoading(true);
    setError(null);
    setSelectedFlightId(null);
    setSelectedSeatId(null);

    apiFetch(`/connections/${connection.id}/rebooking-options`, { token })
      .then((data) => {
        setRebookingData(data);
        if (data.options && data.options.length > 0) {
          // Default select the first available option
          const first = data.options[0];
          setSelectedFlightId(first.id);
          // Load or pick first available seat for this flight
          loadSeatsForFlight(first.id, data.preferredClass);
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load rebooking options');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, connection, token]);

  const loadSeatsForFlight = async (flightId, preferredClass) => {
    try {
      const seatRes = await apiFetch(`/flights/${flightId}/seats`, { token });
      const availableSeats = (seatRes.seats || []).filter((s) => !s.is_booked);
      const matchClass = availableSeats.find((s) => s.class === preferredClass);
      const chosenSeat = matchClass || availableSeats[0];
      if (chosenSeat) {
        setSelectedSeatId(chosenSeat.id);
      }
    } catch (err) {
      console.warn('Could not auto-fetch seats for flight:', err.message);
    }
  };

  const handleSelectFlight = (flight) => {
    setSelectedFlightId(flight.id);
    loadSeatsForFlight(flight.id, rebookingData?.preferredClass);
  };

  const handleConfirmRebooking = async () => {
    if (!selectedFlightId || !selectedSeatId) {
      setError('Please select an alternative flight and seat.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch(`/connections/${connection.id}/rebook`, {
        method: 'POST',
        token,
        body: {
          flight_id: selectedFlightId,
          seat_id: selectedSeatId,
        },
      });

      if (onSuccess) onSuccess(res);
      onClose();
    } catch (err) {
      setError(
        err.message || 'Could not secure seat on selected flight. Another passenger may have booked it. Please try another option.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !connection) return null;

  const options = rebookingData?.options || [];
  const selectedOption = options.find((o) => o.id === selectedFlightId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto animate-fadeIn">
      <div className="w-full max-w-4xl mx-auto rounded-2xl bg-white shadow-2xl overflow-hidden my-8 border border-slate-200">
        {/* Top Status Strip */}
        <div className="w-full bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 px-6 py-2.5 flex items-center justify-between text-white text-xs font-semibold">
          <div className="flex items-center gap-2 tracking-wide uppercase">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Meridian Disruption Recovery Portal</span>
            <span className="opacity-60">•</span>
            <span>Seamless Re-Issuance</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/15 px-3 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]">shield</span>
            <span>Zero Penalty Protection Active</span>
          </div>
        </div>

        {/* Modal Header */}
        <div className="px-8 pt-6 pb-4 flex items-start justify-between gap-6 border-b border-slate-100">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-[24px]">published_with_changes</span>
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight font-display">
                  Rebook Missed Connection
                </h2>
                <p className="text-xs font-bold text-blue-600">
                  {connection.hub_name || connection.hub_code} ({connection.hub_code}) → {connection.destination_name || connection.destination_code} ({connection.destination_code})
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl leading-relaxed">
              Your inbound flight arrival exceeds the minimum connection buffer at {connection.hub_code}. Select a protected alternative flight to your destination at no penalty under the Meridian Protection Guarantee.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
            aria-label="Close modal"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="px-8 py-6 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
          {/* SECTION 1: Original Outbound Booking (To be cancelled) */}
          <div className="w-full rounded-xl bg-slate-50 p-5 flex flex-col gap-3 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                <span className="text-xs uppercase tracking-wider font-bold text-slate-600">
                  Original Outbound Booking (To be cancelled)
                </span>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">
                <span className="material-symbols-outlined text-[13px]">timer_off</span>
                <span>Missed / Ineligible Transfer</span>
              </span>
            </div>

            {/* Micro Ticket Card */}
            <div className="bg-white rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200 shadow-xs">
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Flight</span>
                  <span className="text-sm font-extrabold text-slate-900 font-display">
                    {connection.outbound_flight_number}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <span className="text-lg font-black text-slate-900 font-display">{connection.hub_code}</span>
                    <span className="text-[11px] text-slate-500">{connection.hub_name || 'Transit Hub'}</span>
                  </div>
                  <span className="material-symbols-outlined text-rose-500 text-[18px]">flight_takeoff</span>
                  <div className="flex flex-col">
                    <span className="text-lg font-black text-slate-900 font-display">{connection.destination_code}</span>
                    <span className="text-[11px] text-slate-500">{connection.destination_name || 'Destination'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 sm:border-l sm:border-slate-100 sm:pl-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scheduled Window</span>
                  <span className="text-xs font-semibold text-slate-800 line-through decoration-rose-500 decoration-2">
                    {new Date(connection.outbound_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(connection.outbound_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned Seat</span>
                  <span className="text-xs font-bold text-slate-800">
                    {connection.outbound_seat_number || 'N/A'} ({connection.outbound_class || 'Economy'})
                  </span>
                </div>
              </div>
            </div>

            {/* Warning Callout */}
            <div className="flex items-start gap-2 text-xs text-slate-600 bg-amber-50/70 border border-amber-200/60 p-2.5 rounded-lg">
              <span className="material-symbols-outlined text-[16px] text-amber-600 shrink-0 mt-0.5">warning</span>
              <span>
                Selecting an alternative flight will immediately cancel <strong>{connection.outbound_flight_number}</strong> and reissue your seat on the chosen flight under ₹0 protection.
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] text-rose-600 shrink-0">error</span>
              <div className="flex-1">
                <strong className="block font-bold">Rebooking Conflict:</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* SECTION 2: Rebooking Options */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 font-display">
                  Available Alternative Flights
                </h3>
                {!loading && options.length > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                    {options.length} Protected Slots
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-blue-600">verified</span>
                Verified against {connection.hub_name || connection.hub_code} MCT ({connection.min_connection_minutes}m)
              </span>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
                <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-medium">Scanning live departures from {connection.hub_code}...</p>
              </div>
            ) : options.length === 0 ? (
              /* Empty State: No alternative flights found */
              <div className="py-10 px-6 rounded-xl bg-slate-50 border border-slate-200 text-center flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-slate-200/80 text-slate-500 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[28px]">flight_takeoff</span>
                </div>
                <h4 className="text-sm font-bold text-slate-900">No Direct Alternative Flights Found Today</h4>
                <p className="text-xs text-slate-600 max-w-md">
                  No scheduled alternative flights have available seats today on the {connection.hub_code} → {connection.destination_code} sector meeting the {connection.min_connection_minutes}-minute minimum connection time. Please visit the Meridian Transfer Desk at {connection.hub_code} for staff assistance.
                </p>
              </div>
            ) : (
              /* Options List */
              <div className="flex flex-col gap-3" role="radiogroup">
                {options.map((opt, idx) => {
                  const isSelected = selectedFlightId === opt.id;
                  const dep = new Date(opt.estimated_departure || opt.scheduled_departure);
                  const arr = new Date(opt.estimated_arrival || opt.scheduled_arrival);
                  const durationMins = Math.round((arr.getTime() - dep.getTime()) / 60_000);
                  const hours = Math.floor(durationMins / 60);
                  const mins = durationMins % 60;

                  return (
                    <label
                      key={opt.id}
                      onClick={() => handleSelectFlight(opt)}
                      className={`relative block cursor-pointer rounded-xl p-4 transition-all border ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/40 shadow-sm ring-2 ring-blue-500/20'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="rebook-flight"
                        className="sr-only"
                        checked={isSelected}
                        onChange={() => handleSelectFlight(opt)}
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Left: Radio bullet + Flight details */}
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-5 h-5 rounded-full border mt-1 flex items-center justify-center transition-colors ${
                              isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <span className="w-2 h-2 rounded-full bg-white"></span>}
                          </div>

                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-extrabold text-blue-700 font-display">
                                {opt.flight_number}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span className="text-xs text-slate-600 font-medium">{opt.aircraft_model}</span>
                              {idx === 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                  Earliest Departure
                                </span>
                              )}
                              {opt.gate_code && (
                                <span className="text-xs text-slate-500 font-medium">Gate {opt.gate_code}</span>
                              )}
                            </div>

                            {/* Timings */}
                            <div className="flex items-center gap-4 mt-1">
                              <div className="flex flex-col">
                                <span className="text-base font-bold text-slate-900 font-display">
                                  {dep.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-[11px] text-slate-500">{opt.origin_code}</span>
                              </div>

                              <div className="flex flex-col items-center px-2">
                                <span className="text-[10px] text-slate-400 font-medium">
                                  {hours > 0 ? `${hours}h ` : ''}{mins}m nonstop
                                </span>
                                <div className="flex items-center gap-1 text-blue-600">
                                  <span className="w-8 h-0.5 bg-blue-200 rounded-full"></span>
                                  <span className="material-symbols-outlined text-[14px]">flight</span>
                                  <span className="w-8 h-0.5 bg-blue-200 rounded-full"></span>
                                </div>
                              </div>

                              <div className="flex flex-col">
                                <span className="text-base font-bold text-slate-900 font-display">
                                  {arr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-[11px] text-slate-500">{opt.dest_code}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Right: Seats & Pricing */}
                        <div className="flex flex-col sm:items-end justify-center gap-1 sm:border-l sm:border-slate-100 sm:pl-4">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                            <span className="material-symbols-outlined text-[16px] text-blue-600">airline_seat_recline_extra</span>
                            <span>{rebookingData?.preferredClass || 'Economy'}</span>
                            <span className="text-slate-400">
                              ({opt.preferred_seats_available || opt.total_seats_available} seats left)
                            </span>
                          </div>
                          <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200/60">
                            ₹0 <span className="text-[10px] font-normal opacity-90">(Complimentary protection)</span>
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="material-symbols-outlined text-[16px] text-blue-600">verified_user</span>
            <span>Zero penalty protection • Automatic ticket re-issue</span>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-5 py-2.5 rounded-full bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmRebooking}
              disabled={submitting || !selectedFlightId || options.length === 0}
              className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Rebooking Ticket...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">airline_stops</span>
                  <span>
                    Confirm Rebooking {selectedOption ? `(${selectedOption.flight_number})` : ''}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
