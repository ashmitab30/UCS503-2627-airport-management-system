import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function SiteHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="site-header">
      {/* Brand logo & title */}
      <NavLink to="/dashboard" className="brand">
        <div className="brand-icon-circle">
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
            flight_takeoff
          </span>
        </div>
        <div className="brand-text-wrap">
          <span className="brand-name">MERIDIAN</span>
          <span className="brand-sub">Passenger Ops</span>
        </div>
      </NavLink>

      {/* Nav pill group */}
      <nav className="site-nav-pill-group">
        <NavLink to="/dashboard" className={navClass}>
          Dashboard
        </NavLink>
        <NavLink to="/book" className={navClass}>
          Book Flight
        </NavLink>
        <NavLink to="/my-flights" className={navClass}>
          My Flights
        </NavLink>
      </nav>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Terminal indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '999px',
            backgroundColor: 'var(--color-surface-low)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            fontSize: '11px',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            color: 'var(--color-secondary)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span className="dot-indicator green" />
          <span>Passenger Terminal • T3</span>
        </div>

        {/* User Pill */}
        {user && (
          <div className="header-user-pill">
            <div className="header-avatar-circle">
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                person
              </span>
            </div>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '13px',
                color: 'var(--color-on-surface)',
              }}
            >
              {user.name}
            </span>
          </div>
        )}

        {/* Sign Out Button */}
        <button
          onClick={logout}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '13px',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            color: 'var(--color-on-surface-variant)',
            padding: '6px 10px',
            borderRadius: '8px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-error)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-on-surface-variant)')}
          title="Sign out of passenger portal"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            logout
          </span>
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
}

function navClass({ isActive }) {
  return `site-nav-link${isActive ? ' active' : ''}`;
}
