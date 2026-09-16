import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../api/client.js';
import { styles } from '../styles.js';
import OpsCore, { TurnaroundBoard } from './OpsCore.jsx';

const STAFF_ROLES = ['ground_crew', 'security', 'medical', 'ops_manager', 'admin'];

export default function Dashboard() {
  const { user, token, logout } = useAuth();

  return (
    <main style={styles.main}>
      <nav style={styles.nav}>
        <div>
          <strong>{user.name}</strong>{' '}
          <span style={styles.badge}>{user.role}</span>
        </div>
        <button style={styles.buttonSecondary} onClick={logout}>Sign out</button>
      </nav>

      {user.role === 'passenger' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Welcome</h2>
          <p style={styles.muted}>
            Booking, check-in and baggage tracking land in Week 4+. For now this
            confirms your account and login are working end to end.
          </p>
        </div>
      )}

      {STAFF_ROLES.includes(user.role) && <MyShifts token={token} />}

      {user.role === 'ground_crew' && <TurnaroundBoard token={token} />}

      {(user.role === 'admin' || user.role === 'ops_manager') && (
        <ShiftScheduler token={token} isAdmin={user.role === 'admin'} />
      )}

      {user.role === 'admin' && <StaffManagement token={token} />}

      {(user.role === 'admin' || user.role === 'ops_manager') && (
        <OpsCore token={token} isAdmin={user.role === 'admin'} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------
// Any staff member: their own shifts + clock in/out
// ---------------------------------------------------------------------
function MyShifts({ token }) {
  const [shifts, setShifts] = useState([]);
  const [attendanceByShift, setAttendanceByShift] = useState({});
  const [error, setError] = useState(null);
  const [busyShiftId, setBusyShiftId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { shifts } = await apiFetch('/shifts/mine', { token });
      setShifts(shifts);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function clockIn(shiftId) {
    setBusyShiftId(shiftId);
    setError(null);
    try {
      const { attendance } = await apiFetch('/attendance/clock-in', {
        method: 'POST', token, body: { shift_id: shiftId },
      });
      setAttendanceByShift((prev) => ({ ...prev, [shiftId]: attendance }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  async function clockOut(shiftId) {
    const attendance = attendanceByShift[shiftId];
    if (!attendance) return;
    setBusyShiftId(shiftId);
    setError(null);
    try {
      const { attendance: updated } = await apiFetch('/attendance/clock-out', {
        method: 'POST', token, body: { attendance_id: attendance.id },
      });
      setAttendanceByShift((prev) => ({ ...prev, [shiftId]: updated }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>My shifts</h2>
      {error && <p style={styles.error}>{error}</p>}
      {shifts.length === 0 && <p style={styles.muted}>No shifts scheduled yet.</p>}
      {shifts.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Start</th>
              <th style={styles.th}>End</th>
              <th style={styles.th}>Area</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const a = attendanceByShift[s.id];
              const clockedIn = a && !a.clock_out;
              return (
                <tr key={s.id}>
                  <td style={styles.td}>{new Date(s.start_time).toLocaleString()}</td>
                  <td style={styles.td}>{new Date(s.end_time).toLocaleString()}</td>
                  <td style={styles.td}>{s.area_assigned || '—'}</td>
                  <td style={styles.td}>
                    {!clockedIn && (
                      <button
                        style={styles.buttonSecondary}
                        disabled={busyShiftId === s.id}
                        onClick={() => clockIn(s.id)}
                      >
                        Clock in
                      </button>
                    )}
                    {clockedIn && (
                      <button
                        style={styles.buttonSecondary}
                        disabled={busyShiftId === s.id}
                        onClick={() => clockOut(s.id)}
                      >
                        Clock out
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Admin + ops_manager: schedule shifts, see the conflict check live
// ---------------------------------------------------------------------
function ShiftScheduler({ token }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: '', start_time: '', end_time: '', area_assigned: '' });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/employees', { token }).then((d) => setEmployees(d.employees)).catch((err) => setError(err.message));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setConflicts([]);
    setSubmitting(true);
    try {
      const { shift } = await apiFetch('/shifts', {
        method: 'POST', token,
        body: {
          employee_id: Number(form.employee_id),
          start_time: form.start_time,
          end_time: form.end_time,
          area_assigned: form.area_assigned || undefined,
        },
      });
      setSuccess(`Shift #${shift.id} created.`);
      setForm({ employee_id: '', start_time: '', end_time: '', area_assigned: '' });
    } catch (err) {
      setError(err.message);
      // 409 responses include the conflicting shift rows — surface them
      // directly rather than making the admin guess why it failed.
      if (err.status === 409 && err.detail?.conflicts) {
        setConflicts(err.detail.conflicts);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Schedule a shift</h2>
      <form style={styles.form} onSubmit={handleSubmit}>
        <label style={styles.label}>
          Employee
          <select
            style={styles.select}
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            required
          >
            <option value="" disabled>Select an employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.role_title} ({e.department})
              </option>
            ))}
          </select>
        </label>
        <label style={styles.label}>
          Start time
          <input
            style={styles.input}
            type="datetime-local"
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            required
          />
        </label>
        <label style={styles.label}>
          End time
          <input
            style={styles.input}
            type="datetime-local"
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            required
          />
        </label>
        <label style={styles.label}>
          Area assigned (optional)
          <input
            style={styles.input}
            value={form.area_assigned}
            onChange={(e) => setForm({ ...form, area_assigned: e.target.value })}
            placeholder="e.g. Terminal 2, Gate B12"
          />
        </label>
        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}
        {conflicts.length > 0 && (
          <div>
            <p style={styles.error}>Conflicting shift(s) for this employee:</p>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id} style={styles.muted}>
                  #{c.id}: {new Date(c.start_time).toLocaleString()} – {new Date(c.end_time).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button style={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Scheduling...' : 'Schedule shift'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Admin only: create staff accounts, view roster
// ---------------------------------------------------------------------
function StaffManagement({ token }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    name: '', email: '', role: 'ground_crew', department: '', role_title: '', certification: '',
  });
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      const { employees } = await apiFetch('/employees', { token });
      setEmployees(employees);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setSubmitting(true);
    try {
      const result = await apiFetch('/employees', { method: 'POST', token, body: form });
      setCreated(result);
      setForm({ name: '', email: '', role: 'ground_crew', department: '', role_title: '', certification: '' });
      loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Staff management</h2>

      <form style={styles.form} onSubmit={handleSubmit}>
        <label style={styles.label}>
          Name
          <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Email
          <input style={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Role
          <select style={styles.select} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="ground_crew">Ground crew</option>
            <option value="security">Security</option>
            <option value="medical">Medical</option>
            <option value="ops_manager">Ops manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label style={styles.label}>
          Department
          <input style={styles.input} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Role title
          <input style={styles.input} value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Certification (optional)
          <input style={styles.input} value={form.certification} onChange={(e) => setForm({ ...form, certification: e.target.value })} />
        </label>
        {error && <p style={styles.error}>{error}</p>}
        {created && (
  <p style={styles.success}>
    Created {created.employee.user.name} ({created.employee.user.email}).{' '}
    {created.emailSent
      ? 'Login credentials were emailed to them.'
      : 'Email was NOT sent (SMTP not configured) — relay this temp password manually:'}{' '}
    {!created.emailSent && <code>{created.tempPassword}</code>}
  </p>
)}
        <button style={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create staff account'}
        </button>
      </form>

      <h3 style={{ ...styles.cardTitle, marginTop: '1.5rem' }}>Roster</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Role</th>
            <th style={styles.th}>Department</th>
            <th style={styles.th}>Title</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id}>
              <td style={styles.td}>{e.name}</td>
              <td style={styles.td}>{e.role}</td>
              <td style={styles.td}>{e.department}</td>
              <td style={styles.td}>{e.role_title}</td>
              <td style={styles.td}>{e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
