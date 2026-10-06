import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';

const TYPES = ['medical', 'security', 'weather', 'technical', 'fire'];

export default function EmergencyBoard({ token }) {
  const [emergencies, setEmergencies] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Declare-new form state
  const [type, setType] = useState('medical');
  const [flightId, setFlightId] = useState('');
  const [gateId, setGateId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  function load() {
    apiFetch('/emergencies?status=active', { token })
      .then((data) => setEmergencies(data.emergencies))
      .catch((err) => setError(err.message));
  }

  useEffect(load, [token]);

  async function handleDeclare(e) {
    e.preventDefault();
    if (!flightId && !gateId) {
      setError('Please provide at least a Flight ID or Gate ID for dispatch.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/emergencies', {
        method: 'POST',
        token,
        body: {
          type,
          flight_id: flightId || undefined,
          gate_id: gateId || undefined,
          notes: notes || undefined,
        },
      });
      setFlightId('');
      setGateId('');
      setNotes('');
      setFormOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve(id) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/emergencies/${id}/resolve`, { method: 'PATCH', token });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-error)', fontSize: '26px' }}>
            warning
          </span>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>Active Emergency & Incident Dispatch</h2>
        </div>

        <button
          type="button"
          onClick={() => setFormOpen(!formOpen)}
          className="btn-primary-aero"
          style={{
            background: formOpen ? 'var(--color-surface-low)' : 'var(--color-error)',
            color: formOpen ? 'var(--color-on-surface)' : '#fff',
            boxShadow: formOpen ? 'none' : '0 4px 14px rgba(186, 26, 26, 0.35)',
            padding: '8px 18px',
            fontSize: '13px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            {formOpen ? 'close' : 'emergency'}
          </span>
          <span>{formOpen ? 'Close Form' : 'Declare Emergency'}</span>
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {/* Declare Emergency Form */}
      {formOpen && (
        <form
          onSubmit={handleDeclare}
          style={{
            padding: '20px',
            background: 'var(--color-error-container)',
            borderRadius: '16px',
            marginBottom: '20px',
            border: '1px solid rgba(186, 26, 26, 0.2)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <label style={styles.label}>
              <span>Incident Type</span>
              <select style={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t.toUpperCase()}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              <span>Flight ID (optional)</span>
              <input style={styles.input} placeholder="e.g. 3" value={flightId} onChange={(e) => setFlightId(e.target.value)} />
            </label>

            <label style={styles.label}>
              <span>Gate ID (optional)</span>
              <input style={styles.input} placeholder="e.g. 2" value={gateId} onChange={(e) => setGateId(e.target.value)} />
            </label>

            <label style={{ ...styles.label, gridColumn: '1 / -1' }}>
              <span>Dispatcher Dispatch Notes</span>
              <input style={styles.input} placeholder="Brief operational description of the incident" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary-aero"
              style={{ background: 'var(--color-error)', padding: '10px 24px', fontSize: '13.5px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>emergency</span>
              <span>{submitting ? 'Declaring…' : 'Dispatch Emergency Team'}</span>
            </button>
          </div>
        </form>
      )}

      {/* List of active emergencies */}
      {emergencies === null && <p style={styles.muted}>Loading active incident queue…</p>}
      {emergencies && emergencies.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-slate)', background: 'var(--color-surface-low)', borderRadius: '14px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: 'var(--color-success)', marginBottom: '4px' }}>
            check_circle
          </span>
          <p style={{ margin: 0, fontWeight: 700 }}>No active airport emergencies reported.</p>
          <span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>All sectors normal and operational.</span>
        </div>
      )}

      {emergencies && emergencies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {emergencies.map((em) => (
            <div
              key={em.id}
              style={{
                padding: '18px 22px',
                borderRadius: '14px',
                background: 'var(--color-surface-lowest)',
                border: '1.5px solid var(--color-error)',
                boxShadow: '0 4px 16px rgba(186, 26, 26, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '14px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className="status-pill status-pill-red">
                    <span className="dot-indicator red" />
                    {em.type.toUpperCase()} EMERGENCY
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-outline)' }}>
                    Incident #{em.id}
                  </span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {em.notes || 'Emergency dispatched by airport operations team.'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-slate)', marginTop: '4px' }}>
                  {em.flight_number && <span>Flight {em.flight_number} &middot; </span>}
                  {em.gate_code && <span>Gate {em.gate_code} &middot; </span>}
                  <span>Reported {new Date(em.created_at).toLocaleTimeString()}</span>
                </div>
              </div>

              <button
                className="btn-primary-aero"
                style={{ background: 'var(--color-success)', padding: '8px 18px', fontSize: '12.5px' }}
                disabled={busyId === em.id}
                onClick={() => handleResolve(em.id)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>task_alt</span>
                <span>{busyId === em.id ? 'Resolving…' : 'Mark Resolved'}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
