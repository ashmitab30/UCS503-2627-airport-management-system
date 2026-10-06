import { useAuth } from '../../context/AuthContext.jsx';
import { StaffManagement } from '../Dashboard.jsx';

export default function AdminEmployees() {
  const { token } = useAuth();

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>admin_panel_settings</span>
          ADMIN ONLY
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 800, margin: '2px 0 6px', letterSpacing: '-0.02em' }}>
          Airport Employees & Staff Directory
        </h1>
        <p style={{ color: 'var(--color-slate)', margin: 0, fontSize: '1rem' }}>
          Register new ground staff, security, medical personnel, and airport managers.
        </p>
      </div>

      <StaffManagement token={token} />
    </div>
  );
}
