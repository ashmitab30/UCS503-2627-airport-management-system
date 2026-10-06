import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';

  const categories = [
    {
      name: 'Overview',
      icon: 'dashboard_customize',
      items: [
        {
          to: '/admin',
          icon: 'dashboard',
          color: 'var(--color-primary)',
          title: 'Operations Dashboard',
          desc: 'Operational command overview, module status, and dispatch controls.',
          actionText: 'Open Dashboard',
        },
      ],
    },
    {
      name: 'Operations',
      icon: 'flight',
      items: [
        {
          to: '/admin/flights',
          icon: 'flight_takeoff',
          color: 'var(--color-primary)',
          title: 'Flights',
          desc: 'Create and manage flights, schedules, routes, aircraft, and gate assignments.',
          actionText: 'Manage Flights',
        },
        {
          to: '/admin/gates',
          icon: 'door_front',
          color: 'var(--color-secondary-cyan)',
          title: 'Gates & Reference Data',
          desc: 'Gate registry, airport codes, aircraft types, size classes, and apron stands.',
          actionText: 'Manage Gates',
        },
        {
          to: '/admin/resources',
          icon: 'precision_manufacturing',
          color: 'var(--color-tertiary)',
          title: 'Resources Registry',
          desc: 'Resource types, ground equipment status, flight allocations, and conflict logs.',
          actionText: 'Manage Resources',
        },
        {
          to: '/admin/emergencies',
          icon: 'warning',
          color: 'var(--color-error)',
          title: 'Emergencies',
          desc: 'Declare, monitor, coordinate, and resolve live airport emergency incidents.',
          actionText: 'Open Emergencies',
        },
      ],
    },
    {
      name: 'People',
      icon: 'groups',
      items: [
        ...(isAdmin
          ? [
              {
                to: '/admin/employees',
                icon: 'badge',
                color: 'var(--color-primary)',
                title: 'Employees Roster',
                desc: 'Maintain authorized personnel records, roles, departments, and certifications.',
                actionText: 'Manage Employees',
                badge: 'ADMIN ONLY',
              },
            ]
          : []),
        {
          to: '/admin/shifts',
          icon: 'schedule',
          color: 'var(--color-secondary)',
          title: 'Shift Schedules',
          desc: 'Schedule operational shifts with real-time overlap conflict detection.',
          actionText: 'Manage Shifts',
        },
        {
          to: '/admin/passengers',
          icon: 'groups',
          color: 'var(--color-secondary-cyan)',
          title: 'Passenger Directory',
          desc: 'Registered passenger accounts, loyalty profiles, and booking histories.',
          actionText: 'View Passengers',
        },
      ],
    },
    {
      name: 'Services',
      icon: 'room_service',
      items: [
        {
          to: '/admin/assistance',
          icon: 'accessible',
          color: 'var(--color-warn)',
          title: 'Assistance Requests',
          desc: 'Passenger special care requests: wheelchairs, visual, hearing, and medical oxygen.',
          actionText: 'Manage Assistance',
        },
        {
          to: '/admin/bookings',
          icon: 'confirmation_number',
          color: 'var(--color-primary-container)',
          title: 'Bookings Registry',
          desc: 'Every scheduled flight booking across all passengers with electronic ticket numbers.',
          actionText: 'View All Bookings',
        },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Hero Banner Header */}
      <div
        style={{
          background: 'var(--color-surface-lowest)',
          borderRadius: '24px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          padding: '36px',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--color-primary)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>grid_view</span>
          <span>Central Operations Directory</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Admin & Operations Hub
        </h1>
        <p style={{ color: 'var(--color-slate)', fontSize: '1.05rem', margin: 0, maxWidth: 640 }}>
          Central access directory for airport ground management, runway flight control, emergency dispatch, and staff allocations.
        </p>
      </div>

      {/* Categories */}
      {categories.map((cat) => (
        <section key={cat.name}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '10px', borderBottom: '1.5px solid rgba(226, 232, 240, 0.8)', marginBottom: '18px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
              {cat.icon}
            </span>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, color: 'var(--color-on-surface)' }}>
              {cat.name}
            </h2>
          </div>

          <div className="admin-card-grid" style={{ marginTop: 0 }}>
            {cat.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="admin-directory-card"
                style={{ '--accent-bar': item.color }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '12px',
                        background: 'var(--color-surface-low)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-primary)',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
                        {item.icon}
                      </span>
                    </div>

                    {item.badge && (
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: '999px',
                          background: 'var(--color-error-container)',
                          color: 'var(--color-on-error-container)',
                          fontSize: '10px',
                          fontWeight: 800,
                          letterSpacing: '0.05em',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>

                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>
                    {item.title}
                  </h3>
                  <p style={{ color: 'var(--color-slate)', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                    {item.desc}
                  </p>
                </div>

                <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: '1px solid rgba(241, 243, 255, 0.9)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary)', fontWeight: 700, fontSize: '13px' }}>
                  <span>{item.actionText}</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    arrow_forward
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
