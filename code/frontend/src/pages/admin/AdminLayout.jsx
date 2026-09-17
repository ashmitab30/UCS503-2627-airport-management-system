import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

// Every admin functionality gets its own route/page here instead of being
// crammed onto one Dashboard — this shell just provides the persistent
// sidebar and renders whichever page is active via <Outlet/>.
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand">Meridian Ops — Admin</div>

        <div className="admin-nav-label">Overview</div>
        <NavLink to="/admin" end className={navClass}>Dashboard</NavLink>

        <div className="admin-nav-label">Operations</div>
        <NavLink to="/admin/flights" className={navClass}>Flights</NavLink>
        <NavLink to="/admin/gates" className={navClass}>Gates</NavLink>
        <NavLink to="/admin/resources" className={navClass}>Resources</NavLink>
        <NavLink to="/admin/emergencies" className={navClass}>Emergencies</NavLink>

        <div className="admin-nav-label">People</div>
        {isAdmin && <NavLink to="/admin/employees" className={navClass}>Employees</NavLink>}
        <NavLink to="/admin/shifts" className={navClass}>Shifts</NavLink>
        <NavLink to="/admin/passengers" className={navClass}>Passengers</NavLink>

        <div className="admin-nav-label">Services</div>
        <NavLink to="/admin/assistance" className={navClass}>Assistance</NavLink>
        <NavLink to="/admin/bookings" className={navClass}>Bookings</NavLink>

        <div className="admin-nav-label">System</div>
        <Link to="/dashboard" className="admin-nav-item">Back to old dashboard</Link>
        <button
          onClick={logout}
          className="admin-nav-item"
          style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

function navClass({ isActive }) {
  return `admin-nav-item${isActive ? ' active' : ''}`;
}
