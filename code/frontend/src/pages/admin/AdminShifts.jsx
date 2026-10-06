import { useAuth } from '../../context/AuthContext.jsx';
import { ShiftScheduler, MyShifts } from '../Dashboard.jsx';

export default function AdminShifts() {
  const { token, user } = useAuth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>schedule</span>
          Airport Personnel Shifts
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 800, margin: '2px 0 6px', letterSpacing: '-0.02em' }}>
          Shift Management & Conflict Detection
        </h1>
        <p style={{ color: 'var(--color-slate)', margin: 0, fontSize: '1rem' }}>
          Assign operational duty slots with automated real-time conflict detection and attendance tracking.
        </p>
      </div>

      <ShiftScheduler token={token} isAdmin={user.role === 'admin'} />
      <MyShifts token={token} />
    </div>
  );
}
