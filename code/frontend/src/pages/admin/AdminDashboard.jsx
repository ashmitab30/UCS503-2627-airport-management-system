import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { styles } from '../../styles.js';

// Deliberately not a stats dashboard yet — building fake numbers here
// would be worse than admitting analytics is a separate, not-yet-built
// piece of work. This is an honest navigation hub to every real page.
export default function AdminDashboard() {
  const { user } = useAuth();

  const sections = [
    { to: '/admin/flights', title: 'Flights', desc: 'Schedule flights, assign gates, view status' },
    { to: '/admin/gates', title: 'Gates', desc: 'Manage gates and reference data (airports, aircraft)' },
    { to: '/admin/resources', title: 'Resources', desc: 'Fuel trucks, baggage carts, crew assignments' },
    { to: '/admin/emergencies', title: 'Emergencies', desc: 'Active emergencies, declare and resolve' },
    ...(user.role === 'admin' ? [{ to: '/admin/employees', title: 'Employees', desc: 'Create and manage staff accounts' }] : []),
    { to: '/admin/shifts', title: 'Shifts', desc: 'Schedule employee shifts' },
    { to: '/admin/passengers', title: 'Passengers', desc: 'Registered passenger accounts' },
    { to: '/admin/assistance', title: 'Assistance requests', desc: 'Wheelchair, medical and other passenger requests' },
    { to: '/admin/bookings', title: 'Bookings', desc: 'Every flight booking across all passengers' },
  ];

  return (
    <div>
      <h1 style={styles.title}>Admin dashboard</h1>
      <p style={styles.subtitle}>Welcome, {user.name}. Pick a section to manage.</p>
      <div className="admin-card-grid">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className="admin-nav-card">
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
