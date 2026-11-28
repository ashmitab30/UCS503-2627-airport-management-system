import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';
import {
  canAdvanceAssistance,
  getNextAssistanceStatus,
  ASSISTANCE_TYPE_LABELS,
  ASSISTANCE_STATUS_LABELS,
} from '../utils/assistanceValidation.js';
import { formatTime, formatDate } from '../utils/format.js';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];

export default function AssistanceQueue({ token: tokenProp }) {
  const { user, token: authContextToken } = useAuth();
  const token = tokenProp || authContextToken;
  const { socket } = useSocket();

  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [flightSearch, setFlightSearch] = useState('');

  // Reassign state for Admin / Ops Manager
  const [reassignTarget, setReassignTarget] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState(null);

  const isAdminOrOps = user && ['admin', 'ops_manager'].includes(user.role);

  const load = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    if (typeFilter) params.append('type', typeFilter);
    if (flightSearch.trim()) params.append('flight', flightSearch.trim());

    apiFetch(`/bookings/assistance/all?${params.toString()}`, { token })
      .then((data) => setRequests(data.requests || []))
      .catch((err) => setError(err.message));
  }, [token, statusFilter, typeFilter, flightSearch]);

  useEffect(() => {
    load();
  }, [load]);

  // Load available assistance staff for reassign modal if admin/ops
  useEffect(() => {
    if (!token || !isAdminOrOps) return;
    apiFetch('/employees', { token })
      .then((data) => {
        const staff = (data.employees || []).filter((e) =>
          ['ground_crew', 'medical', 'ops_manager', 'admin'].includes(e.role || e.department)
        );
        setStaffList(staff);
      })
      .catch(() => {});
  }, [token, isAdminOrOps]);

  // Real-time socket updates
  useEffect(() => {
    if (!socket) return;
    const onAssistanceEvent = () => {
      load();
    };

    socket.on('assistance:created', onAssistanceEvent);
    socket.on('assistance:updated', onAssistanceEvent);
    socket.on('assistance:cancelled', onAssistanceEvent);

    return () => {
      socket.off('assistance:created', onAssistanceEvent);
      socket.off('assistance:updated', onAssistanceEvent);
      socket.off('assistance:cancelled', onAssistanceEvent);
    };
  }, [socket, load]);

  async function advance(req) {
    const next = getNextAssistanceStatus(req.status);
    if (!next) return;
    setBusyId(req.id);
    setError(null);
    try {
      await apiFetch(`/bookings/assistance/${req.id}/status`, {
        method: 'PATCH',
        token,
        body: { status: next },
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReassignSubmit(e) {
    if (e) e.preventDefault();
    if (!selectedStaffId || !reassignTarget) return;

    setReassignBusy(true);
    setReassignError(null);
    try {
      await apiFetch(`/bookings/assistance/${reassignTarget.id}/reassign`, {
        method: 'PATCH',
        token,
        body: { staff_id: parseInt(selectedStaffId, 10) },
      });
      setReassignTarget(null);
      setSelectedStaffId('');
      load();
    } catch (err) {
      setReassignError(err.message || 'Could not reassign staff member');
    } finally {
      setReassignBusy(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '26px' }}>
            accessible
          </span>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>Special Passenger Assistance &amp; Care Queue</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
            {requests ? `${requests.length} Requests` : 'Loading…'}
          </span>
          <button
            type="button"
            onClick={load}
            className="btn-glass"
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Refresh Queue"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          background: 'var(--color-surface-low)',
          padding: '12px 16px',
          borderRadius: '12px',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>
          <span>Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ ...styles.input, padding: '6px 10px', fontSize: '13px', width: 'auto' }}
          >
            <option value="">All Statuses</option>
            <option value="open">All Open (Active)</option>
            <option value="requested">Submitted (Requested)</option>
            <option value="assigned">Staff Assigned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>
          <span>Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ ...styles.input, padding: '6px 10px', fontSize: '13px', width: 'auto' }}
          >
            <option value="">All Service Types</option>
            {Object.entries(ASSISTANCE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>
          <span>Flight:</span>
          <input
            type="text"
            value={flightSearch}
            onChange={(e) => setFlightSearch(e.target.value)}
            placeholder="Search flight #..."
            style={{ ...styles.input, padding: '6px 10px', fontSize: '13px', width: '130px' }}
          />
        </label>

        {(statusFilter || typeFilter || flightSearch) && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('');
              setTypeFilter('');
              setFlightSearch('');
            }}
            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', marginLeft: 'auto' }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {requests === null && <p style={styles.muted}>Loading assistance requests…</p>}
      {requests && requests.length === 0 && (
        <div style={{ padding: '28px', textAlign: 'center', color: 'var(--color-slate)', background: 'var(--color-surface-low)', borderRadius: '14px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--color-success)', marginBottom: '6px' }}>
            task_alt
          </span>
          <p style={{ margin: 0, fontWeight: 700 }}>No matching passenger assistance requests.</p>
        </div>
      )}

      {requests && requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {requests.map((r) => {
            const nextStatus = getNextAssistanceStatus(r.status);
            const canAdvance = canAdvanceAssistance(r, user);
            const isAssignedToOther = r.status !== 'requested' && r.assigned_staff_id && user && r.assigned_staff_id !== user.id && !isAdminOrOps;

            return (
              <div
                key={r.id}
                style={{
                  padding: '20px 24px',
                  borderRadius: '16px',
                  background: 'var(--color-surface-lowest)',
                  border: '1px solid rgba(226, 232, 240, 0.9)',
                  boxShadow: 'var(--shadow-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span className="status-pill status-pill-blue">
                        Flight #{r.flight_number}
                      </span>
                      {r.origin_code && r.dest_code && (
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
                          {r.origin_code} &rarr; {r.dest_code}
                        </span>
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                        #AST-{r.id}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--color-outline)', fontFamily: 'monospace' }}>
                        Ref {r.booking_ref}
                      </span>
                      {r.boarding_group === 1 && (
                        <span className="status-pill status-pill-cyan" style={{ fontSize: '11px', fontWeight: 800 }}>
                          ★ Priority (Group 1)
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span>{r.passenger_name || 'Passenger'}</span>
                      {r.passenger_age && (
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate)' }}>
                          ({r.passenger_age} yrs)
                        </span>
                      )}
                      <span>&middot;</span>
                      <span style={{ color: 'var(--color-primary)' }}>
                        {ASSISTANCE_TYPE_LABELS[r.type] || r.type}
                      </span>
                      {r.seat_number && (
                        <span style={{ fontSize: '12px', color: 'var(--color-slate)', fontWeight: 600 }}>
                          &middot; Seat {r.seat_number} ({r.seat_class || 'economy'})
                        </span>
                      )}
                    </div>

                    {r.notes && (
                      <div style={{ fontSize: '13px', color: 'var(--color-slate)', marginTop: '4px', fontStyle: 'italic', background: 'var(--color-surface-low)', padding: '6px 12px', borderRadius: '8px' }}>
                        "{r.notes}"
                      </div>
                    )}

                    {/* Assigned staff info & timestamps */}
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', color: 'var(--color-slate)', marginTop: '8px', flexWrap: 'wrap' }}>
                      <span>
                        <strong>Assigned Staff:</strong>{' '}
                        {r.assigned_staff_name ? (
                          <span style={{ color: 'var(--color-ink)', fontWeight: 700 }}>{r.assigned_staff_name}</span>
                        ) : (
                          <span style={{ color: 'var(--color-muted)' }}>Unassigned (Open)</span>
                        )}
                      </span>
                      {r.created_at && <span>Created: {formatTime(r.created_at)}</span>}
                      {r.assigned_at && <span>Assigned: {formatTime(r.assigned_at)}</span>}
                      {r.started_at && <span>Started: {formatTime(r.started_at)}</span>}
                      {r.completed_at && <span>Completed: {formatTime(r.completed_at)}</span>}
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {isAdminOrOps && (
                      <button
                        type="button"
                        className="btn-glass"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => {
                          setReassignTarget(r);
                          setSelectedStaffId(r.assigned_staff_id || '');
                          setReassignError(null);
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>person_add</span>
                        <span>Reassign</span>
                      </button>
                    )}

                    {nextStatus && (
                      <button
                        className="btn-primary-aero"
                        style={{ padding: '8px 18px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        disabled={busyId === r.id || !canAdvance}
                        title={isAssignedToOther ? `Assigned to ${r.assigned_staff_name || 'another staff member'}` : ''}
                        onClick={() => advance(r)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                          {r.status === 'requested' ? 'front_hand' : r.status === 'assigned' ? 'play_arrow' : 'done'}
                        </span>
                        <span>
                          {busyId === r.id
                            ? 'Updating…'
                            : r.status === 'requested'
                            ? 'Take Request'
                            : r.status === 'assigned'
                            ? 'Start Service'
                            : 'Complete Service'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Stepper Progress */}
                <div className="stepper-container" style={{ paddingTop: '8px', borderTop: '1px solid rgba(241, 243, 255, 0.9)' }}>
                  {PIPELINE_STEPS.map((step, i) => {
                    const currentIndex = PIPELINE_STEPS.indexOf(r.status);
                    const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
                    return (
                      <span key={step} className={`stepper-pill ${state}`}>
                        {state === 'done' && <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>}
                        {state === 'active' && <span className="pulse-radar-dot" />}
                        <span>{ASSISTANCE_STATUS_LABELS[step]}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Admin Reassign Modal */}
      {reassignTarget && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ ...styles.card, maxWidth: '440px', width: '100%', padding: '24px' }}>
            <h3 style={{ ...styles.cardTitle, marginBottom: '8px' }}>
              Reassign Assistance Mission #{reassignTarget.id}
            </h3>
            <p style={{ ...styles.subtitle, marginBottom: '16px' }}>
              Select a ground crew, medical, or operations staff member to assign this request to.
            </p>

            {reassignError && <p style={styles.error}>{reassignError}</p>}

            <form onSubmit={handleReassignSubmit}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-slate)' }}>Assign To:</span>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  required
                  style={styles.input}
                >
                  <option value="">-- Choose Staff Member --</option>
                  {staffList.map((s) => (
                    <option key={s.user_id || s.id} value={s.user_id || s.id}>
                      {s.name || `User #${s.user_id}`} ({s.role || s.department})
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-glass"
                  onClick={() => setReassignTarget(null)}
                  disabled={reassignBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-aero"
                  disabled={reassignBusy || !selectedStaffId}
                >
                  {reassignBusy ? 'Reassigning…' : 'Confirm Reassignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
