import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../api/client.js';
import EmergencyBanner from '../../components/EmergencyBanner.jsx';

// Role-specific wording and menu entries for the staff portal.
const ROLE_META = {
  ground_crew: { console: 'Ground Crew Console', unit: 'Ramp & Apron Operations' },
  security: { console: 'Security Console', unit: 'Terminal Security' },
  medical: { console: 'Medical Console', unit: 'Medical Response Unit' },
};

export default function StaffLayout() {
  const { user, token, logout } = useAuth();
  const location = useLocation();
  const meta = ROLE_META[user.role] || { console: 'Staff Console', unit: 'Airport Staff' };
  const canSeeTurnaround = user.role === 'ground_crew';
  const canSeeAssistance = user.role === 'ground_crew' || user.role === 'medical';
  const canSeeGate = ['ground_crew', 'ops_manager', 'admin'].includes(user.role);
  const canSeeBaggage = ['ground_crew', 'ops_manager', 'admin'].includes(user.role);
  const canSeeSecurity = ['security', 'ops_manager', 'admin'].includes(user.role);
  const canSeeSupport = ['ground_crew', 'ops_manager', 'admin'].includes(user.role);

  // Quick Declare Emergency modal state
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emType, setEmType] = useState('medical');
  const [emFlight, setEmFlight] = useState('');
  const [emGate, setEmGate] = useState('');
  const [emNotes, setEmNotes] = useState('');
  const [emError, setEmError] = useState(null);
  const [emSuccess, setEmSuccess] = useState(null);
  const [emSubmitting, setEmSubmitting] = useState(false);

  async function handleQuickDeclare(e) {
    e.preventDefault();
    if (!emFlight && !emGate) {
      setEmError('Provide a Flight ID or Gate ID for dispatch.');
      return;
    }
    setEmSubmitting(true);
    setEmError(null);
    try {
      await apiFetch('/emergencies', {
        method: 'POST',
        token,
        body: {
          type: emType,
          flight_id: emFlight || undefined,
          gate_id: emGate || undefined,
          notes: emNotes || undefined,
        },
      });
      setEmSuccess('Emergency successfully dispatched.');
      setEmFlight('');
      setEmGate('');
      setEmNotes('');
      setTimeout(() => {
        setEmergencyOpen(false);
        setEmSuccess(null);
      }, 1200);
    } catch (err) {
      setEmError(err.message);
    } finally {
      setEmSubmitting(false);
    }
  }

  // Derive current page title for breadcrumbs
  const path = location.pathname;
  let pageTitle = 'Overview';
  if (path.includes('turnaround')) pageTitle = 'Turnaround Tasks';
  else if (path.includes('assistance')) pageTitle = 'Assistance Queue';
  else if (path.includes('emergencies')) pageTitle = 'Emergencies';
  else if (path.includes('shifts')) pageTitle = 'My Shifts & Attendance';
  else if (path.includes('password')) pageTitle = 'Change Password';
  else if (path.includes('gate')) pageTitle = 'Gate Boarding';
  else if (path.includes('baggage')) pageTitle = 'Baggage Handling';
  else if (path.includes('security')) pageTitle = 'Security Console';
  else if (path.includes('support')) pageTitle = 'Support Chat & Escalations';

  return (
    <div className="admin-shell">
      {/* 280px / 72-unit Navigation Sidebar */}
      <aside className="admin-sidebar">
        <div>
          {/* Brand header */}
          <div className="admin-sidebar-brand">
            <div className="brand-icon-circle">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                connecting_airports
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em', color: 'var(--color-on-surface)' }}>
                MERIDIAN OPS
              </span>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-secondary)', letterSpacing: '0.06em' }}>
                {meta.unit}
              </span>
            </div>
          </div>

          {/* Role selector card */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '14px',
              backgroundColor: 'var(--color-surface-low)',
              border: '1px solid rgba(226, 232, 240, 0.8)',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)', fontFamily: 'var(--font-display)' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-slate)', fontWeight: 600 }}>
                  {meta.console}
                </div>
              </div>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '999px',
                  backgroundColor: 'var(--color-primary-fixed)',
                  color: 'var(--color-on-primary-fixed)',
                  fontSize: '10px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                {user.role.replace('_', ' ')}
              </span>
            </div>
          </div>

          {['admin', 'ops_manager'].includes(user.role) && (
            <div style={{ marginBottom: '16px' }}>
              <Link
                to="/admin"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(29, 99, 255, 0.08)',
                  color: 'var(--color-primary)',
                  textDecoration: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: '1px solid rgba(29, 99, 255, 0.2)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
                <span>Back to Admin Dashboard</span>
              </Link>
            </div>
          )}

          {/* Nav Categories */}
          <nav>
            <div className="admin-nav-category">Overview</div>
            <NavLink to="/staff" end className={navClass}>
              <span className="material-symbols-outlined">dashboard</span>
              <span>Overview</span>
            </NavLink>

            <div className="admin-nav-category">My Work</div>
            {canSeeTurnaround && (
              <NavLink to="/staff/turnaround" className={navClass}>
                <span className="material-symbols-outlined">flight_takeoff</span>
                <span>Turnaround Tasks</span>
              </NavLink>
            )}
            {canSeeAssistance && (
              <NavLink to="/staff/assistance" className={navClass}>
                <span className="material-symbols-outlined">accessible</span>
                <span>Assistance Queue</span>
              </NavLink>
            )}
            {canSeeGate && (
              <NavLink to="/staff/gate" className={navClass}>
                <span className="material-symbols-outlined">qr_code_scanner</span>
                <span>Gate Boarding</span>
              </NavLink>
            )}
            {canSeeBaggage && (
              <NavLink to="/staff/baggage" className={navClass}>
                <span className="material-symbols-outlined">luggage</span>
                <span>Baggage Handling</span>
              </NavLink>
            )}
            {canSeeSecurity && (
              <NavLink to="/staff/security" className={navClass}>
                <span className="material-symbols-outlined">shield</span>
                <span>Security Console</span>
              </NavLink>
            )}
            {canSeeSupport && (
              <NavLink to="/staff/support" className={navClass}>
                <span className="material-symbols-outlined">support_agent</span>
                <span>Support Chat</span>
              </NavLink>
            )}
            <NavLink to="/staff/emergencies" className={navClass}>
              <span className="material-symbols-outlined">warning</span>
              <span>Emergencies</span>
            </NavLink>

            <div className="admin-nav-category">Me</div>
            <NavLink to="/staff/shifts" className={navClass}>
              <span className="material-symbols-outlined">schedule</span>
              <span>Shifts & Attendance</span>
            </NavLink>
            <NavLink to="/staff/password" className={navClass}>
              <span className="material-symbols-outlined">lock</span>
              <span>Change Password</span>
            </NavLink>
          </nav>
        </div>

        {/* System section at bottom */}
        <div style={{ paddingTop: '16px', borderTop: '1px solid rgba(226, 232, 240, 0.8)' }}>
          <div className="admin-nav-category" style={{ padding: '0 12px 6px' }}>System</div>
          <button
            onClick={logout}
            className="admin-nav-item"
            style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span className="material-symbols-outlined" style={{ color: 'var(--color-error)' }}>logout</span>
            <span style={{ color: 'var(--color-error)' }}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace with Top Chrome */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Sticky Top Chrome Header */}
        <header className="admin-top-chrome">
          {/* Breadcrumbs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            <span style={{ color: 'var(--color-secondary)' }}>Staff Portal</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-outline)' }}>
              chevron_right
            </span>
            <span style={{ color: 'var(--color-on-surface)' }}>{pageTitle}</span>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              type="button"
              onClick={() => setEmergencyOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 16px',
                borderRadius: '999px',
                backgroundColor: 'var(--color-error-container)',
                color: 'var(--color-on-error-container)',
                border: '1px solid rgba(186, 26, 26, 0.25)',
                fontSize: '12px',
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(186, 26, 26, 0.15)',
                transition: 'all 0.15s ease',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>emergency</span>
              <span>Declare Emergency</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '14px', borderLeft: '1px solid #e2e8f0' }}>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-on-surface)' }}>
                  {user.name}
                </span>
                <span style={{ fontSize: '10.5px', color: 'var(--color-slate)', fontWeight: 600 }}>
                  {meta.console}
                </span>
              </div>
              <div className="header-avatar-circle" style={{ width: '36px', height: '36px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>person</span>
              </div>
            </div>
          </div>
        </header>

        {/* Content Outlet */}
        <main className="admin-main-viewport">
          <EmergencyBanner />
          <Outlet />
        </main>
      </div>

      {/* Quick Emergency Declaration Modal */}
      {emergencyOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            backgroundColor: 'rgba(6, 27, 58, 0.55)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '24px',
              padding: '32px',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 24px 60px rgba(6, 27, 58, 0.25)',
              border: '2px solid var(--color-error)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--color-error-container)', color: 'var(--color-on-error-container)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>emergency</span>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-error)' }}>
                    Declare Airport Emergency
                  </h3>
                  <span style={{ fontSize: '12px', color: 'var(--color-slate)' }}>High-Priority Operational Incident</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEmergencyOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-outline)' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleQuickDeclare} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700 }}>
                <span>Incident Type</span>
                <select
                  value={emType}
                  onChange={(e) => setEmType(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #c2c6d8', background: '#f8fafc' }}
                >
                  <option value="medical">MEDICAL EMERGENCY</option>
                  <option value="security">SECURITY BREACH / UNATTENDED BAGGAGE</option>
                  <option value="technical">TECHNICAL / AVIONICS FAILURE</option>
                  <option value="weather">SEVERE WEATHER / LOW VISIBILITY</option>
                  <option value="fire">FIRE / HAZMAT INCIDENT</option>
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700 }}>
                  <span>Flight ID (optional)</span>
                  <input
                    placeholder="e.g. 3"
                    value={emFlight}
                    onChange={(e) => setEmFlight(e.target.value)}
                    style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #c2c6d8', background: '#f8fafc' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700 }}>
                  <span>Gate ID (optional)</span>
                  <input
                    placeholder="e.g. 2"
                    value={emGate}
                    onChange={(e) => setEmGate(e.target.value)}
                    style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #c2c6d8', background: '#f8fafc' }}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700 }}>
                <span>Dispatcher Notes</span>
                <textarea
                  rows={2}
                  placeholder="Describe location, personnel dispatched, severity..."
                  value={emNotes}
                  onChange={(e) => setEmNotes(e.target.value)}
                  style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid #c2c6d8', background: '#f8fafc', resize: 'vertical' }}
                />
              </label>

              {emError && <p style={{ color: 'var(--color-error)', fontSize: '12px', margin: 0, fontWeight: 700 }}>{emError}</p>}
              {emSuccess && <p style={{ color: 'var(--color-success)', fontSize: '12px', margin: 0, fontWeight: 700 }}>{emSuccess}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEmergencyOpen(false)}
                  style={{ padding: '10px 18px', borderRadius: '999px', border: '1px solid #c2c6d8', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={emSubmitting}
                  className="btn-primary-aero"
                  style={{ background: 'var(--color-error)', padding: '10px 24px', fontSize: '13px' }}
                >
                  {emSubmitting ? 'Dispatching…' : 'Dispatch Emergency Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function navClass({ isActive }) {
  return `admin-nav-item${isActive ? ' active' : ''}`;
}
