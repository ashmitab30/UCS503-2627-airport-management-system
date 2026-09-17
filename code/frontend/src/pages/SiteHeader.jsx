import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Shared top nav for the passenger area (Home/Book/My Flights), matching
// the website-style header from the approved mockup — used by BookFlight,
// MyFlights, and FlightTracking instead of each page having its own
// simple "back to dashboard" link.
export default function SiteHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="site-header">
      <NavLink to="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
        <span className="mark">✈️</span> Meridian Ops
      </NavLink>
      <nav className="site-nav">
        <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
        <NavLink to="/book" className={navClass}>Book a flight</NavLink>
        <NavLink to="/my-flights" className={navClass}>My flights</NavLink>
      </nav>
      <div className="site-header-right">
        <span style={{ fontSize: '0.8rem', color: '#57647D' }}>{user?.name}</span>
        <button
          onClick={logout}
          style={{
            fontSize: '0.78rem', fontWeight: 600, padding: '6px 12px', borderRadius: 7,
            border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: '#0F172A',
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function navClass({ isActive }) {
  return isActive ? 'active' : undefined;
}
