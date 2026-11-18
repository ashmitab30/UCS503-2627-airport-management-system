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
import StaffLayout from './pages/staff/StaffLayout.jsx';
import StaffHome from './pages/staff/StaffHome.jsx';
import StaffTurnaround from './pages/staff/StaffTurnaround.jsx';
import StaffShifts from './pages/staff/StaffShifts.jsx';
import StaffAssistance from './pages/staff/StaffAssistance.jsx';
import StaffEmergencies from './pages/staff/StaffEmergencies.jsx';
import StaffPassword from './pages/staff/StaffPassword.jsx';
import { styles } from './styles.js';

// Roles that use the staff portal (admin / ops_manager use /admin instead).
const STAFF_PORTAL_ROLES = ['ground_crew', 'security', 'medical'];

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
        <Routes>
          <Route path="/" element={<HealthCheck />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/book"
            element={
              <ProtectedRoute>
                <BookFlight />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-flights"
            element={
              <ProtectedRoute>
                <MyFlights />
              </ProtectedRoute>
            }
          />
          <Route
            path="/track/:flightId"
            element={
              <ProtectedRoute>
                <FlightTracking />
              </ProtectedRoute>
            }
          />
          <Route
            path="/boarding-pass/:id"
            element={
              <ProtectedRoute>
                <BoardingPass />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff"
            element={
              <ProtectedRoute roles={STAFF_PORTAL_ROLES}>
                <StaffLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StaffHome />} />
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
          <p><Link to="/dashboard">Go to your dashboard</Link> (signed in as {user.email})</p>
        ) : (
          <p>
            <Link to="/login">Sign in</Link> or <Link to="/register">create a passenger account</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
