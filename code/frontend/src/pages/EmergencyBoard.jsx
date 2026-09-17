import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { styles, colors } from '../styles.js';

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

  function load() {
    apiFetch('/emergencies?status=active', { token })
      .then((data) => setEmergencies(data.emergencies))
      .catch((err) => setError(err.message));
  }

  useEffect(load, [token]);

  async function handleDeclare(e) {
    e.preventDefault();
    if (!flightId && !gateId) {
      setError('Provide a flight ID or gate ID');
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
      <h2 style={styles.cardTitle}>Emergencies</h2>
      {error && <p style={styles.error}>{error}</p>}

      <form style={{ ...styles.form, marginBottom: '1.2rem' }} onSubmit={handleDeclare}>
        <div style={styles.searchRow}>
          <label style={styles.searchField}>
            Type
            <select style={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={styles.searchField}>
            Flight ID (optional)
            <input style={styles.input} value={flightId} onChange={(e) => setFlightId(e.target.value)} placeholder="e.g. 3" />
          </label>
          <label style={styles.searchField}>
            Gate ID (optional)
            <input style={styles.input} value={gateId} onChange={(e) => setGateId(e.target.value)} placeholder="e.g. 2" />
          </label>
          <label style={styles.searchField}>
            Notes
            <input style={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brief description" />
          </label>
          <button style={styles.button} type="submit" disabled={submitting}>
            {submitting ? 'Declaring…' : 'Declare emergency'}
          </button>
        </div>
      </form>

      {emergencies === null && <p style={styles.muted}>Loading…</p>}
      {emergencies && emergencies.length === 0 && <p style={styles.muted}>No active emergencies.</p>}

      {emergencies && emergencies.map((e) => (
        <div key={e.id} style={{
          padding: '0.9rem 1rem',
          borderLeft: `3px solid ${colors.danger}`,
          background: colors.dangerSoft,
          borderRadius: 8,
          marginBottom: '0.6rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
            <strong style={{ textTransform: 'capitalize' }}>{e.type} emergency</strong>
            <button style={styles.buttonSecondary} disabled={busyId === e.id} onClick={() => handleResolve(e.id)}>
              {busyId === e.id ? 'Resolving…' : 'Mark resolved'}
            </button>
          </div>
          <div style={{ fontSize: '0.82rem', color: colors.ink }}>
            {e.flight_number ? `Flight ${e.flight_number}` : ''}{e.flight_number && e.gate_code ? ' · ' : ''}{e.gate_code ? `Gate ${e.gate_code}` : ''}
          </div>
          {e.notes && <div style={{ fontSize: '0.8rem', color: colors.slate, marginTop: '0.2rem' }}>{e.notes}</div>}
          <div style={{ fontSize: '0.72rem', color: colors.muted, marginTop: '0.3rem' }}>
            Declared by {e.declared_by_name} &middot; {new Date(e.declared_at).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
