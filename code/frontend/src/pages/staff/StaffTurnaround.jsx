import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket, LiveStatusPill } from '../../context/SocketContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles } from '../../styles.js';

const STEP_ORDER = ['deboard', 'clean', 'fuel', 'catering', 'board', 'pushback'];
const STEP_LABELS = { deboard: 'Deboard', clean: 'Clean', fuel: 'Fuel', catering: 'Catering', board: 'Board', pushback: 'Pushback' };

const STATUS_LABEL = { pending: 'Queued', in_progress: 'In progress', done: 'Completed', skipped: 'Skipped' };
const STATUS_PILL = { pending: '', in_progress: 'status-pill-blue', done: 'status-pill-green', skipped: 'status-pill-amber' };

function MilestoneStrip({ steps }) {
  const byStep = Object.fromEntries(steps.map((s) => [s.step, s]));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', margin: '12px 0 16px' }}>
      {STEP_ORDER.map((name, i) => {
        const st = byStep[name]?.status || 'pending';
        const active = st === 'in_progress';
        return (
          <div
            key={name}
            style={{
              padding: '10px 12px',
              borderRadius: '12px',
              border: `1px solid ${active ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.9)'}`,
              background: active ? 'var(--color-primary-fixed)' : st === 'done' ? '#ecfdf5' : 'var(--color-surface-low)',
              opacity: st === 'pending' ? 0.75 : 1,
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-slate)' }}>
              {String(i + 1).padStart(2, '0')} {STEP_LABELS[name]}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px', color: st === 'done' ? '#065f46' : active ? 'var(--color-primary)' : 'var(--color-slate)' }}>
              {STATUS_LABEL[st]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StaffTurnaround() {
  const { token } = useAuth();
  const { socket } = useSocket();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { turnaround_checklist } = await apiFetch('/turnaround?active=true', { token });
      setRows(turnaround_checklist);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = () => load();
    socket.on('turnaround:step_updated', onUpdate);
    socket.on('flight:delayed', onUpdate);
    socket.on('delay:cascade', onUpdate);
    socket.on('flight:gate_changed', onUpdate);
    return () => {
      socket.off('turnaround:step_updated', onUpdate);
      socket.off('flight:delayed', onUpdate);
      socket.off('delay:cascade', onUpdate);
      socket.off('flight:gate_changed', onUpdate);
    };
  }, [socket, load]);

  async function setStatus(step, status) {
    setBusyId(step.id);
    setError(null);
    try {
      await apiFetch(`/turnaround/${step.id}/status`, { method: 'PATCH', token, body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const flights = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((r) => {
      if (!map.has(r.flight_id)) map.set(r.flight_id, { info: r, steps: [] });
      map.get(r.flight_id).steps.push(r);
    });
    return [...map.values()];
  }, [rows]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h1 style={{ ...styles.title, margin: 0 }}>Turnaround tasks</h1>
        <LiveStatusPill />
      </div>
      <p style={styles.subtitle}>Work through each flight’s ground steps in order. Only flights that haven’t left yet are shown.</p>
      {error && <p style={styles.error}>{error}</p>}
      {!rows && !error && <p style={styles.muted}>Loading…</p>}
      {rows && flights.length === 0 && (
        <div style={styles.card}><p style={{ ...styles.muted, margin: 0 }}>No flights are waiting on the ground right now.</p></div>
      )}

      {flights.map(({ info, steps }) => (
        <div key={info.flight_id} style={{ ...styles.card, marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h2 style={{ ...styles.cardTitle, margin: 0 }}>{info.flight_number}</h2>
              <div style={styles.muted}>
                {info.origin_code} → {info.dest_code} · departs {new Date(info.scheduled_departure).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="status-pill status-pill-blue">Gate {info.gate_code || 'unassigned'}</span>
              <span className="status-pill">{info.flight_status}</span>
            </div>
          </div>

          <MilestoneStrip steps={steps} />

          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Step</th><th style={styles.th}>Status</th><th style={styles.th} /></tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}><strong>{STEP_LABELS[s.step] || s.step}</strong></td>
                  <td style={styles.td}><span className={`status-pill ${STATUS_PILL[s.status]}`}>{STATUS_LABEL[s.status]}</span></td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      {s.status === 'pending' && (
                        <>
                          <button className="btn-secondary-aero" disabled={busyId === s.id} onClick={() => setStatus(s, 'in_progress')}>Start</button>
                          <button className="btn-secondary-aero" disabled={busyId === s.id} onClick={() => setStatus(s, 'skipped')}>Skip</button>
                        </>
                      )}
                      {s.status === 'in_progress' && (
                        <button className="btn-primary-aero" disabled={busyId === s.id} onClick={() => setStatus(s, 'done')}>Mark done</button>
                      )}
                      {(s.status === 'done' || s.status === 'skipped') && (
                        <button className="btn-secondary-aero" disabled={busyId === s.id} onClick={() => setStatus(s, 'pending')}>Reopen</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
