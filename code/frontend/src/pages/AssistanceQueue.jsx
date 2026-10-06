import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';

const PIPELINE_STEPS = ['requested', 'assigned', 'in_progress', 'completed'];
const NEXT_STATUS = { requested: 'assigned', assigned: 'in_progress', in_progress: 'completed' };
const PIPELINE_LABELS = { requested: 'Submitted', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '26px' }}>
            accessible
          </span>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>Special Passenger Assistance & Care Queue</h2>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate)' }}>
          {requests ? `${requests.length} Requests` : 'Loading…'}
        </span>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {requests === null && <p style={styles.muted}>Loading assistance requests…</p>}
      {requests && requests.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-slate)', background: 'var(--color-surface-low)', borderRadius: '14px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--color-success)', marginBottom: '4px' }}>
            task_alt
          </span>
          <p style={{ margin: 0, fontWeight: 700 }}>No pending passenger assistance requests.</p>
        </div>
      )}

      {requests && requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {requests.map((r) => (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className="status-pill status-pill-blue">
                      Flight #{r.flight_number}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>
                      Mission #AST-{r.id}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>
                      Ref {r.booking_ref}
                    </span>
                  </div>

                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                    {r.passenger_name || 'Passenger'} &middot;{' '}
                    <span style={{ textTransform: 'capitalize', color: 'var(--color-primary)' }}>
                      {r.type.replace('_', ' ')}
                    </span>
                  </div>
                  {r.notes && (
                    <div style={{ fontSize: '13px', color: 'var(--color-slate)', marginTop: '4px', fontStyle: 'italic' }}>
                      "{r.notes}"
                    </div>
                  )}
                </div>

                {NEXT_STATUS[r.status] && (
                  <button
                    className="btn-primary-aero"
                    style={{ padding: '8px 18px', fontSize: '13px' }}
                    disabled={busyId === r.id}
                    onClick={() => advance(r)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>check</span>
                    <span>{busyId === r.id ? 'Updating…' : `Advance to ${PIPELINE_LABELS[NEXT_STATUS[r.status]]}`}</span>
                  </button>
                )}
              </div>

              {/* Progress Stepper */}
              <div className="stepper-container" style={{ paddingTop: '8px', borderTop: '1px solid rgba(241, 243, 255, 0.9)' }}>
                {PIPELINE_STEPS.map((step, i) => {
                  const currentIndex = PIPELINE_STEPS.indexOf(r.status);
                  const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
                  return (
                    <span key={step} className={`stepper-pill ${state}`}>
                      {state === 'done' && <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>}
                      {state === 'active' && <span className="pulse-radar-dot" />}
                      <span>{PIPELINE_LABELS[step]}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
