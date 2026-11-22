import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import { styles } from '../../styles.js';

const ROLE_TITLES = {
  ground_crew: 'Ground Crew Console',
  security: 'Security Console',
  medical: 'Medical Console',
};

const OPEN_ASSISTANCE = ['requested', 'assigned', 'in_progress'];

function StatCard({ icon, label, value, hint, to, tone }) {
  const toneColor = tone === 'alert' ? 'var(--color-error)' : tone === 'good' ? '#065f46' : 'var(--color-primary)';
  const card = (
    <div style={{ ...styles.card, margin: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: toneColor }}>
        <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>{icon}</span>
        <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-display)', margin: '10px 0 4px', color: 'var(--color-on-surface)' }}>
        {value}
      </div>
      {hint && <div style={styles.muted}>{hint}</div>}
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{card}</Link> : card;
}

export default function StaffHome() {
  const { user, token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const wantsTurnaround = user.role === 'ground_crew';
    const wantsAssistance = user.role === 'ground_crew' || user.role === 'medical';
    const results = await Promise.allSettled([
      apiFetch('/attendance/mine', { token }),
      apiFetch('/shifts/mine', { token }),
      apiFetch('/emergencies?status=active&limit=100', { token }),
      wantsTurnaround ? apiFetch('/turnaround?active=true', { token }) : Promise.resolve(null),
      wantsAssistance ? apiFetch('/bookings/assistance/all?limit=100', { token }) : Promise.resolve(null),
    ]);
    const [att, shifts, emergencies, turnaround, assistance] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));

    if (results[0].status === 'rejected' && /No employee record/i.test(results[0].reason?.message || '')) {
      setError('Your account is not linked to an employee record yet. Please ask an administrator to fix this.');
    }

    const now = Date.now();
    const upcoming = (shifts?.shifts || []).filter((s) => new Date(s.end_time).getTime() > now);
    const steps = turnaround?.turnaround_checklist || [];
    const openSteps = steps.filter((t) => t.status === 'pending' || t.status === 'in_progress');

    setData({
      openAttendance: att?.open_attendance || null,
      nextShift: upcoming[0] || null,
      activeEmergencies: emergencies?.emergencies?.length ?? 0,
      openSteps: wantsTurnaround ? openSteps.length : null,
      flightsInTurnaround: wantsTurnaround ? new Set(steps.map((t) => t.flight_id)).size : null,
      openAssistance: wantsAssistance
        ? (assistance?.requests || []).filter((r) => OPEN_ASSISTANCE.includes(r.status)).length
        : null,
    });
  }, [token, user.role]);

  useEffect(() => { load(); }, [load]);

  const shiftInProgress = !!data?.nextShift && new Date(data.nextShift.start_time).getTime() <= Date.now();
  const fmtTime = (v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = (v) => new Date(v).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-secondary)' }}>
          {ROLE_TITLES[user.role] || 'Staff Console'}
        </div>
        <h1 style={styles.title}>Welcome back, {user.name}</h1>
        <p style={styles.subtitle}>Your live status, tasks and alerts in one place.</p>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {!data && !error && <p style={styles.muted}>Loading…</p>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <StatCard
            icon="how_to_reg"
            label="Duty status"
            tone={data.openAttendance ? 'good' : undefined}
            value={data.openAttendance ? 'On duty' : 'Off duty'}
            hint={data.openAttendance ? `Clocked in at ${fmtTime(data.openAttendance.clock_in)}` : 'Clock in from your shifts page'}
            to="/staff/shifts"
          />
          <StatCard
            icon="schedule"
            label={shiftInProgress ? 'Current shift' : 'Next shift'}
            value={data.nextShift ? (shiftInProgress ? `Until ${fmtTime(data.nextShift.end_time)}` : fmtTime(data.nextShift.start_time)) : 'None'}
            hint={
              data.nextShift
                ? shiftInProgress
                  ? `In progress · ${data.nextShift.area_assigned || 'No area set'}`
                  : `${fmtDateTime(data.nextShift.start_time)} · ${data.nextShift.area_assigned || 'No area set'}`
                : 'No upcoming shifts assigned'
            }
            to="/staff/shifts"
          />
          {data.openSteps !== null && (
            <StatCard
              icon="flight_takeoff"
              label="Open turnaround steps"
              value={data.openSteps}
              hint={`Across ${data.flightsInTurnaround} flight${data.flightsInTurnaround === 1 ? '' : 's'} on the ground`}
              to="/staff/turnaround"
            />
          )}
          {data.openAssistance !== null && (
            <StatCard
              icon="accessible"
              label="Assistance requests"
              value={data.openAssistance}
              hint="Open requests awaiting action"
              to="/staff/assistance"
            />
          )}
          <StatCard
            icon="warning"
            label="Active emergencies"
            tone={data.activeEmergencies > 0 ? 'alert' : 'good'}
            value={data.activeEmergencies}
            hint={data.activeEmergencies > 0 ? 'Review and acknowledge now' : 'All sectors normal'}
            to="/staff/emergencies"
          />
        </div>
      )}
    </div>
  );
}
