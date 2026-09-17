import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const NEXT_STATUS = { requested: 'assigned', assigned: 'in_progress', in_progress: 'completed' };
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed' };

// Staff-facing view of assistance requests, backed by the same
// /bookings/assistance/* endpoints used to build the passenger side —
// this is the "other end" of that same data, not a separate system.
export default function AssistanceQueue({ token }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    apiFetch('/bookings/assistance/all', { token })
      .then((data) => setRequests(data.requests))
      .catch((err) => setError(err.message));
  }

  useEffect(load, [token]);

  async function advance(req) {
    const next = NEXT_STATUS[req.status];
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

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Assistance requests</h2>
      {error && <p style={styles.error}>{error}</p>}
      {requests === null && <p style={styles.muted}>Loading…</p>}
      {requests && requests.length === 0 && <p style={styles.muted}>No assistance requests right now.</p>}

      {requests && requests.map((r) => (
        <div key={r.id} style={{ padding: '0.9rem 0', borderBottom: `1px solid ${colors.lineSoft}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <strong>{r.flight_number}</strong>
            <span style={styles.badge}>{r.type.replace('_', ' ')}</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: colors.muted, marginBottom: '0.5rem' }}>
            {r.passenger_name || 'Passenger'} &middot; {r.booking_ref}
            {r.notes ? ` — "${r.notes}"` : ''}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={styles.pipeline}>
              {PIPELINE_STEPS.map((step, i) => {
                const currentIndex = PIPELINE_STEPS.indexOf(r.status);
                const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
                const stepStyle =
                  state === 'done' ? styles.pipelineStepDone :
                  state === 'current' ? styles.pipelineStepCurrent : styles.pipelineStepPending;
                return (
                  <span key={step} style={stepStyle}>
                    {PIPELINE_LABELS[step]}{i < PIPELINE_STEPS.length - 1 ? ' →' : ''}
                  </span>
                );
              })}
            </div>
            {NEXT_STATUS[r.status] && (
              <button
                style={styles.buttonSecondary}
                disabled={busyId === r.id}
                onClick={() => advance(r)}
              >
                {busyId === r.id ? 'Updating…' : `Mark ${PIPELINE_LABELS[NEXT_STATUS[r.status]]}`}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
