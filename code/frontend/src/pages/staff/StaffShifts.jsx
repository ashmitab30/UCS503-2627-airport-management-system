import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles } from '../../styles.js';
import { formatDateTime } from '../../utils/format.js';

function hoursBetween(a, b) {
  if (!a || !b) return '—';
  const h = (new Date(b) - new Date(a)) / 36e5;
  return `${h.toFixed(1)} h`;
}

export default function StaffShifts() {
  const { token } = useAuth();
  const [shifts, setShifts] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [openAttendance, setOpenAttendance] = useState(null);
  const [error, setError] = useState(null);
  const [busyShiftId, setBusyShiftId] = useState(null);

  // Loads shifts AND the real attendance state from the server, so a page
  // refresh no longer forgets that you are already clocked in.
  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        apiFetch('/shifts/mine', { token }),
        apiFetch('/attendance/mine', { token }),
      ]);
      setShifts(s.shifts);
      setAttendance(a.attendance);
      setOpenAttendance(a.open_attendance);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function clockIn(shiftId) {
    setBusyShiftId(shiftId);
    setError(null);
    try {
      await apiFetch('/attendance/clock-in', { method: 'POST', token, body: { shift_id: shiftId } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  async function clockOut(shiftId) {
    if (!openAttendance) return;
    setBusyShiftId(shiftId);
    setError(null);
    try {
      await apiFetch('/attendance/clock-out', { method: 'POST', token, body: { attendance_id: openAttendance.id } });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  const completedShiftIds = new Set(attendance.filter((a) => a.clock_out).map((a) => a.shift_id));

  return (
    <div>
      <h1 style={styles.title}>Shifts & attendance</h1>
      <p style={styles.subtitle}>Clock in when your shift starts and clock out when it ends.</p>
      {error && <p style={styles.error}>{error}</p>}

      <div style={{ ...styles.card, marginBottom: '16px' }}>
        <h2 style={styles.cardTitle}>My scheduled shifts</h2>
        {!shifts && !error && <p style={styles.muted}>Loading…</p>}
        {shifts && shifts.length === 0 && <p style={styles.muted}>No assigned shifts right now.</p>}
        {shifts && shifts.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Start</th><th style={styles.th}>End</th><th style={styles.th}>Area</th>
                <th style={styles.th}>Status</th><th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const isOpen = openAttendance && openAttendance.shift_id === s.id;
                const done = completedShiftIds.has(s.id);
                const busy = busyShiftId === s.id;
                return (
                  <tr key={s.id}>
                    <td style={styles.td}><strong>{formatDateTime(s.start_time)}</strong></td>
                    <td style={styles.td}>{formatDateTime(s.end_time)}</td>
                    <td style={styles.td}>{s.area_assigned || '—'}</td>
                    <td style={styles.td}>
                      {isOpen && <span className="status-pill status-pill-green">Clocked in</span>}
                      {!isOpen && done && <span className="status-pill status-pill-blue">Completed</span>}
                      {!isOpen && !done && <span className="status-pill">Not started</span>}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      {isOpen && <button className="btn-primary-aero" disabled={busy} onClick={() => clockOut(s.id)}>Clock out</button>}
                      {!isOpen && !done && (
                        <button className="btn-secondary-aero" disabled={busy || !!openAttendance} onClick={() => clockIn(s.id)}>Clock in</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Attendance history</h2>
        {attendance.length === 0 ? (
          <p style={styles.muted}>No clock-ins recorded yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Clock in</th><th style={styles.th}>Clock out</th><th style={styles.th}>Hours</th><th style={styles.th}>Area</th></tr>
            </thead>
            <tbody>
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td style={styles.td}>{formatDateTime(a.clock_in)}</td>
                  <td style={styles.td}>{a.clock_out ? formatDateTime(a.clock_out) : <span className="status-pill status-pill-green">On duty</span>}</td>
                  <td style={styles.td}>{hoursBetween(a.clock_in, a.clock_out)}</td>
                  <td style={styles.td}>{a.area_assigned || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
