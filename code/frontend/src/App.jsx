import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import BookFlight from './pages/BookFlight.jsx';
import MyFlights from './pages/MyFlights.jsx';
import FlightTracking from './pages/FlightTracking.jsx';
import BoardingPass from './pages/BoardingPass.jsx';
import ProtectedRoute from './pages/ProtectedRoute.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminFlights from './pages/admin/AdminFlights.jsx';
import AdminGates from './pages/admin/AdminGates.jsx';
import AdminResources from './pages/admin/AdminResources.jsx';
import AdminEmployees from './pages/admin/AdminEmployees.jsx';
import AdminShifts from './pages/admin/AdminShifts.jsx';
import AdminAssistance from './pages/admin/AdminAssistance.jsx';
import AdminEmergencies from './pages/admin/AdminEmergencies.jsx';
import AdminBookings from './pages/admin/AdminBookings.jsx';
import AdminPassengers from './pages/admin/AdminPassengers.jsx';
import AdminConnections from './pages/admin/AdminConnections.jsx';
import StaffLayout from './pages/staff/StaffLayout.jsx';
import StaffHome from './pages/staff/StaffHome.jsx';
import StaffTurnaround from './pages/staff/StaffTurnaround.jsx';
import StaffShifts from './pages/staff/StaffShifts.jsx';
import StaffAssistance from './pages/staff/StaffAssistance.jsx';
import StaffEmergencies from './pages/staff/StaffEmergencies.jsx';
import StaffPassword from './pages/staff/StaffPassword.jsx';
import StaffGate from './pages/staff/StaffGate.jsx';
import StaffBaggage from './pages/staff/StaffBaggage.jsx';
import StaffSecurity from './pages/staff/StaffSecurity.jsx';
import PassengerParking from './pages/PassengerParking.jsx';
import Facilities from './pages/Facilities.jsx';
import AdminParking from './pages/admin/AdminParking.jsx';
import AdminSecurity from './pages/admin/AdminSecurity.jsx';
import AdminFacilities from './pages/admin/AdminFacilities.jsx';
import PassengerLayout from './pages/PassengerLayout.jsx';
import SupportConsole from './pages/support/SupportConsole.jsx';
import PublicVerify from './pages/PublicVerify.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { styles } from './styles.js';
import { getRoleDashboardPath, STAFF_PORTAL_ROLES } from './utils/navigation.js';

// "/" redirects to /login when not logged in, and to the user's role dashboard when logged in.
function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={getRoleDashboardPath(user)} replace />;
}

// /dashboard sends staff-portal roles to /staff; everyone else keeps the existing dashboard.
function DashboardRoute() {
  const { user } = useAuth();
  if (user && STAFF_PORTAL_ROLES.includes(user.role)) return <Navigate to="/staff" replace />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/status" element={<HealthCheck />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute><PassengerLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardRoute />} />
            <Route path="/book" element={<BookFlight />} />
            <Route path="/my-flights" element={<MyFlights />} />
            <Route path="/track/:flightId" element={<FlightTracking />} />
            <Route path="/boarding-pass/:id" element={<BoardingPass />} />
            <Route path="/parking" element={<PassengerParking />} />
            <Route path="/facilities" element={<Facilities />} />
          </Route>
          <Route path="/verify/:ref" element={<PublicVerify />} />
          <Route
            path="/staff"
            element={
              <ProtectedRoute roles={[...STAFF_PORTAL_ROLES, 'ops_manager', 'admin']}>
                <StaffLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StaffHome />} />
            <Route
              path="gate"
              element={
                <ProtectedRoute roles={['ground_crew', 'ops_manager', 'admin']}>
                  <StaffGate />
                </ProtectedRoute>
              }
            />
            <Route
              path="turnaround"
              element={
                <ProtectedRoute roles={['ground_crew']}>
                  <StaffTurnaround />
                </ProtectedRoute>
              }
            />
            <Route
              path="assistance"
              element={
                <ProtectedRoute roles={['ground_crew', 'medical']}>
                  <StaffAssistance />
                </ProtectedRoute>
              }
            />
            <Route path="emergencies" element={<StaffEmergencies />} />
            <Route path="shifts" element={<StaffShifts />} />
            <Route
              path="baggage"
              element={
                <ProtectedRoute roles={['ground_crew', 'ops_manager', 'admin']}>
                  <StaffBaggage />
                </ProtectedRoute>
              }
            />
            <Route
              path="security"
              element={
                <ProtectedRoute roles={['security', 'ops_manager', 'admin']}>
                  <StaffSecurity />
                </ProtectedRoute>
              }
            />
            <Route
              path="support"
              element={
                <ProtectedRoute roles={['ground_crew', 'ops_manager', 'admin']}>
                  <SupportConsole />
                </ProtectedRoute>
              }
            />
            <Route path="password" element={<StaffPassword />} />
          </Route>
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin', 'ops_manager']}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="flights" element={<AdminFlights />} />
            <Route path="gates" element={<AdminGates />} />
            <Route path="gate" element={<StaffGate />} />
            <Route path="baggage" element={<StaffBaggage />} />
            <Route path="parking" element={<AdminParking />} />
            <Route path="security" element={<AdminSecurity />} />
            <Route path="resources" element={<AdminResources />} />
            <Route path="emergencies" element={<AdminEmergencies />} />
            <Route
              path="employees"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminEmployees />
                </ProtectedRoute>
              }
            />
            <Route path="shifts" element={<AdminShifts />} />
            <Route path="passengers" element={<AdminPassengers />} />
            <Route path="assistance" element={<AdminAssistance />} />
            <Route path="bookings" element={<AdminBookings />} />
            <Route path="connections" element={<AdminConnections />} />
            <Route path="facilities" element={<AdminFacilities />} />
            <Route path="support" element={<SupportConsole />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
          </ErrorBoundary>
      </BrowserRouter>
    </SocketProvider>
  </AuthProvider>
  );
}

// Kept from Week 1 as the landing page — still a useful "is the backend
// up" smoke test, now also links into the Week 2 auth flow.
function HealthCheck() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Airport Management System</h1>
      <p style={styles.subtitle}>Week 3 — Ops Core: flights, gates, turnaround, resources</p>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>API status</h2>
        {error && <p style={styles.error}>Could not reach backend: {error}</p>}
        {!error && !health && <p>Checking...</p>}
        {health && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Database connected</dt>
            <dd>{String(health.db?.connected)}</dd>
            {health.db?.error && <>
              <dt>DB note</dt>
              <dd>{health.db.error}</dd>
            </>}
          </dl>
        )}
      </div>

      <div style={styles.card}>
        {user ? (
          <p><Link to={getRoleDashboardPath(user)}>Go to your dashboard</Link> (signed in as {user.email})</p>
        ) : (
          <p>
            <Link to="/login">Sign in</Link> or <Link to="/register">create a passenger account</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
