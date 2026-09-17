import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { styles } from '../../styles.js';

// Deliberately not a stats dashboard yet — building fake numbers here
// would be worse than admitting analytics is a separate, not-yet-built
// piece of work. This is an honest navigation hub to every real page.
export default function AdminDashboard() {
  const { user } = useAuth();

  const sections = [
    { to: '/admin/flights', icon: '✈️', color: '#2F5CF5', title: 'Flights', desc: 'Schedule flights, assign gates, view status' },
    { to: '/admin/gates', icon: '🚪', color: '#2F5CF5', title: 'Gates', desc: 'Manage gates and reference data (airports, aircraft)' },
    { to: '/admin/resources', icon: '🧰', color: '#2F5CF5', title: 'Resources', desc: 'Fuel trucks, baggage carts, crew assignments' },
    { to: '/admin/emergencies', icon: '🚨', color: '#B91C1C', title: 'Emergencies', desc: 'Active emergencies, declare and resolve' },
    ...(user.role === 'admin' ? [{ to: '/admin/employees', icon: '👥', color: '#15803D', title: 'Employees', desc: 'Create and manage staff accounts' }] : []),
    { to: '/admin/shifts', icon: '🕒', color: '#15803D', title: 'Shifts', desc: 'Schedule employee shifts' },
    { to: '/admin/passengers', icon: '🧑‍✈️', color: '#15803D', title: 'Passengers', desc: 'Registered passenger accounts' },
    { to: '/admin/assistance', icon: '♿', color: '#B4740E', title: 'Assistance requests', desc: 'Wheelchair, medical and other passenger requests' },
    { to: '/admin/bookings', icon: '🎟️', color: '#B4740E', title: 'Bookings', desc: 'Every flight booking across all passengers' },
  ];

  return (
    <div>
      <h1 style={styles.title}>Admin dashboard</h1>
      <p style={styles.subtitle}>Welcome, {user.name}. Pick a section to manage.</p>
      <div className="admin-card-grid">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className="admin-nav-card" style={{ '--accent-bar': s.color }}>
            <span className="icon">{s.icon}</span>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
