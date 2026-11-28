import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles, colors } from '../../styles.js';
import { getBoardingGroupInfo } from '../../utils/assistanceValidation.js';

export default function StaffGate() {
  const { token } = useAuth();
  const [inputVal, setInputVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Boarding queue state
  const [flights, setFlights] = useState([]);
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [queueData, setQueueData] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(null);

  useEffect(() => {
    if (!token) return;
    apiFetch('/flights?limit=50', { token })
      .then((data) => {
        const flightList = data.flights || [];
        setFlights(flightList);
        if (flightList.length > 0 && !selectedFlightId) {
          setSelectedFlightId(flightList[0].id);
        }
      })
      .catch((err) => console.warn('Could not load flights for gate queue:', err.message));
  }, [token]);

  const loadQueue = (flightId) => {
    if (!flightId || !token) return;
    setQueueLoading(true);
    setQueueError(null);
    apiFetch(`/flights/${flightId}/boarding-queue`, { token })
      .then((data) => {
        setQueueData(data);
      })
      .catch((err) => {
        setQueueError(err.message || 'Could not load boarding queue');
      })
      .finally(() => {
        setQueueLoading(false);
      });
  };

  useEffect(() => {
    if (selectedFlightId) {
      loadQueue(selectedFlightId);
    }
  }, [selectedFlightId, token]);

  async function handleBoard(e) {
    if (e) e.preventDefault();
    if (!inputVal.trim()) {
      setError('Please enter a booking reference or paste a scanned QR code URL.');
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch('/gate/board', {
        method: 'POST',
        token,
        body: { url: inputVal.trim() },
      });

      setSuccess(res);
      setInputVal('');
      if (selectedFlightId) {
        loadQueue(selectedFlightId);
      }
    } catch (err) {
      setError(err.message || 'Gate boarding rejected');
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setInputVal('');
    setError(null);
    setSuccess(null);
  }

  return (
    <div style={{ maxWidth: '800px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={styles.title}>Gate Boarding Scanner</h1>
        <p style={styles.subtitle}>
          Scan digital boarding pass QR codes or enter passenger booking references to authorize aircraft boarding.
        </p>
      </div>

      {/* Scanner & Input Card */}
      <div style={{ ...styles.card, padding: '24px', marginBottom: '24px' }}>
        <form onSubmit={handleBoard} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: colors.ink }}>
              Scanned QR Code URL or Booking Reference
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Paste scanned URL (http://.../verify/BK... or BK-XXXXX)"
                autoFocus
                style={{ ...styles.input, flex: 1, fontFamily: 'monospace', fontSize: '13px' }}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn-primary-aero"
                disabled={busy || !inputVal.trim()}
                style={{ minWidth: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>how_to_reg</span>
                <span>{busy ? 'Verifying…' : 'Mark as Boarded'}</span>
              </button>
            </div>
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', color: colors.muted }}>
              Supports direct hardware barcode scanner input, pasted verification URLs, or manual booking references.
            </div>
            {(inputVal || error || success) && (
              <button
                type="button"
                onClick={handleReset}
                style={{ background: 'none', border: 'none', color: colors.primary, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
              >
                Clear Scanner
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Success Banner */}
      {success && (
        <div style={{
          ...styles.card,
          borderLeft: `6px solid ${colors.success}`,
          background: '#fff',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: colors.successBg, color: colors.successText, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>done_all</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 800, color: colors.successText }}>
                  Passenger Successfully Boarded
                </span>
                <span style={{
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: colors.successBg,
                  color: colors.successText,
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}>
                  {success.status}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '14px', background: colors.surfaceLow, padding: '14px', borderRadius: '8px', marginTop: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700 }}>PASSENGER</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginTop: '2px' }}>{success.passenger_name}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700 }}>FLIGHT</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: colors.primary, marginTop: '2px' }}>{success.flight_number}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700 }}>SEAT</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: colors.ink, marginTop: '2px' }}>{success.seat_number}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700 }}>REF</div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: colors.slate, marginTop: '2px', fontFamily: 'monospace' }}>{success.booking_ref}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: colors.muted, fontWeight: 700 }}>BOARDING GROUP</div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: success.boarding_group === 1 ? '#0284c7' : colors.ink, marginTop: '2px' }}>
                    {success.boarding_group === 1 ? '★ Group 1 (Priority)' : success.boarding_group === 2 ? 'Group 2' : 'Unassigned'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error / Refusal Banner */}
      {error && (
        <div style={{
          ...styles.card,
          borderLeft: `6px solid ${colors.danger}`,
          background: '#fff',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: '0 4px 12px rgba(186, 26, 26, 0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: colors.dangerBg, color: colors.dangerText, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>block</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '16px', fontWeight: 800, color: colors.dangerText, marginBottom: '6px' }}>
                Boarding Refused
              </div>
              <div style={{ fontSize: '14px', color: colors.ink, lineHeight: 1.5 }}>
                {error}
              </div>
              <div style={{ fontSize: '12px', color: colors.muted, marginTop: '10px' }}>
                Please direct passenger to customer service or check-in assistance desk.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flight Boarding Queue Panel */}
      <div style={{ ...styles.card, padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined" style={{ color: colors.primary, fontSize: '24px' }}>
              format_list_numbered
            </span>
            <h2 style={{ ...styles.cardTitle, margin: 0, fontSize: '18px' }}>Flight Boarding Queue</h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: colors.ink }}>
              <span>Flight:</span>
              <select
                value={selectedFlightId}
                onChange={(e) => setSelectedFlightId(e.target.value)}
                style={{ ...styles.input, padding: '6px 12px', fontSize: '13px', minWidth: '160px' }}
              >
                {flights.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.flight_number} ({f.origin_code || 'DEL'} &rarr; {f.dest_code || 'BOM'})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => selectedFlightId && loadQueue(selectedFlightId)}
              className="btn-glass"
              disabled={queueLoading}
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Refresh Queue"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
              <span>{queueLoading ? 'Loading…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {queueError && <p style={styles.error}>{queueError}</p>}

        {queueLoading && !queueData && (
          <p style={{ color: colors.muted, fontSize: '13px', margin: '12px 0' }}>Loading boarding queue…</p>
        )}

        {queueData && (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'center' }}>
              <span className="status-pill status-pill-blue">
                Checked In: {queueData.total || 0}
              </span>
              <span className="status-pill status-pill-green">
                Boarded: {queueData.boarded_count || 0} / {queueData.total || 0}
              </span>
              <span style={{ fontSize: '11px', color: colors.muted, marginLeft: 'auto' }}>
                Display only &middot; Ordered by Group then Check-in time
              </span>
            </div>

            {queueData.queue && queueData.queue.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: colors.muted, background: colors.surfaceLow, borderRadius: '12px' }}>
                No passengers checked in for flight #{queueData.flight?.flight_number || ''} yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${colors.line}`, textAlign: 'left', color: colors.muted }}>
                      <th style={{ padding: '10px 12px', fontWeight: 800, fontSize: '11px' }}>GROUP</th>
                      <th style={{ padding: '10px 12px', fontWeight: 800, fontSize: '11px' }}>PASSENGER</th>
                      <th style={{ padding: '10px 12px', fontWeight: 800, fontSize: '11px' }}>SEAT &amp; CLASS</th>
                      <th style={{ padding: '10px 12px', fontWeight: 800, fontSize: '11px' }}>REF</th>
                      <th style={{ padding: '10px 12px', fontWeight: 800, fontSize: '11px' }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueData.queue?.map((p) => {
                      const groupInfo = getBoardingGroupInfo(p.boarding_group);
                      return (
                        <tr
                          key={p.booking_id}
                          style={{
                            borderBottom: `1px solid ${colors.line}`,
                            background: p.boarded ? 'rgba(16, 185, 129, 0.04)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '12px' }}>
                            <span
                              className={`status-pill ${p.boarding_group === 1 ? 'status-pill-cyan' : 'status-pill-blue'}`}
                              style={{ fontWeight: 800 }}
                            >
                              {p.boarding_group === 1 ? '★ Group 1' : p.boarding_group === 2 ? 'Group 2' : 'Unassigned'}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 800, color: colors.ink }}>{p.passenger_name}</div>
                            {p.assistance_type && (
                              <div style={{ fontSize: '11px', color: colors.primary, display: 'inline-flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>accessible</span>
                                <span>{p.assistance_type.replace('_', ' ')}</span>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px', color: colors.ink }}>
                            <span style={{ fontWeight: 800 }}>{p.seat_number || 'TBD'}</span>
                            <span style={{ color: colors.muted, fontSize: '11px', marginLeft: '6px', textTransform: 'capitalize' }}>
                              ({p.seat_class || 'economy'})
                            </span>
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'monospace', color: colors.slate }}>
                            {p.booking_ref}
                          </td>
                          <td style={{ padding: '12px' }}>
                            {p.boarded ? (
                              <span className="status-pill status-pill-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                                Boarded
                              </span>
                            ) : (
                              <span className="status-pill" style={{ background: colors.surfaceLow, color: colors.slate }}>
                                Waiting
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Protocol Guidelines */}
      <div style={{ ...styles.card, padding: '20px 24px', background: 'transparent', border: `1px dashed ${colors.line}` }}>
        <div style={{ fontSize: '12px', fontWeight: 800, color: colors.slate, textTransform: 'uppercase', marginBottom: '8px' }}>
          Boarding Bridge Protocol
        </div>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: colors.slate, lineHeight: 1.6 }}>
          <li>Passenger must be in status <strong>CHECKED IN</strong> before boarding.</li>
          <li>Digital QR signature verifies that the ticket has not been forged or duplicated.</li>
          <li>Already boarded bookings will trigger a duplicate boarding alert (HTTP 409).</li>
          <li>Boarding automatically locks if the flight has departed or has been cancelled.</li>
        </ul>
      </div>
    </div>
  );
}
