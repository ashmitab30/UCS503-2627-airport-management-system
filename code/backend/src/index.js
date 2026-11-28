import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import 'dotenv/config';

import { pool } from './db/pool.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { shiftsRouter } from './routes/shifts.js';
import { attendanceRouter } from './routes/attendance.js';
import { airportsRouter } from './routes/airports.js';
import { aircraftTypesRouter } from './routes/aircraftTypes.js';
import { gatesRouter } from './routes/gates.js';
import { flightsRouter } from './routes/flights.js';
import { turnaroundRouter } from './routes/turnaround.js';
import { resourcesRouter } from './routes/resources.js';
import { resourceAssignmentsRouter } from './routes/resourceAssignments.js';
import { bookingsRouter } from './routes/bookings.js';
import { emergenciesRouter } from './routes/emergencies.js';
import { trackingRouter } from './routes/tracking.js';
import { connectionsRouter } from './routes/connections.js';
import { verifyRouter } from './routes/verify.js';
import { gateRouter } from './routes/gate.js';
import { baggageRouter } from './routes/baggage.js';
import { parkingRouter } from './routes/parking.js';
import { securityRouter } from './routes/security.js';
import { facilitiesRouter } from './routes/facilities.js';
import { chatRouter } from './routes/chat.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

// Startup verification: refuse to start in any environment if JWT_SECRET is missing
if (!process.env.JWT_SECRET) {
  console.error('FATAL: Refusing to start because JWT_SECRET is missing');
  process.exit(1);
}

// Production safety verification: refuse to start with default secret
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET;
  if (secret === 'my_local_dev_secret_123' || secret.includes('placeholder')) {
    console.error('FATAL: Refusing to start in production with default JWT_SECRET');
    process.exit(1);
  }
  const qrSecret = process.env.QR_SIGNING_SECRET;
  if (!qrSecret || qrSecret.includes('change_me') || qrSecret.includes('placeholder')) {
    console.error('FATAL: Refusing to start in production with missing or default QR_SIGNING_SECRET');
    process.exit(1);
  }
}

const app = express();

// Security headers
app.use(helmet());

// CORS configuration restricted to FRONTEND_URL in production, localhost in development
const allowedOrigin = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']
  : '*';

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

app.use(express.json());

// Global rate limiter: 1000 requests per 15 minutes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(apiLimiter);

// Strict rate limiter on authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/change-password', authLimiter);

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/employees', employeesRouter);
app.use('/shifts', shiftsRouter);
app.use('/attendance', attendanceRouter);
app.use('/airports', airportsRouter);
app.use('/aircraft-types', aircraftTypesRouter);
app.use('/gates', gatesRouter);
app.use('/flights', flightsRouter);
app.use('/turnaround', turnaroundRouter);
app.use('/resources', resourcesRouter);
app.use('/resource-assignments', resourceAssignmentsRouter);
app.use('/bookings', bookingsRouter);
app.use('/emergencies', emergenciesRouter);
app.use('/tracking', trackingRouter);
app.use('/connections', connectionsRouter);
app.use('/verify', verifyRouter);
app.use('/gate', gateRouter);
app.use('/baggage', baggageRouter);
app.use('/parking', parkingRouter);
app.use('/security', securityRouter);
app.use('/facilities', facilitiesRouter);
app.use('/chat', chatRouter);

app.get('/', (req, res) => {
  res.json({
    message: 'Airport Management System API',
    status: 'operational',
    version: pkg.version,
    modules: [
      'health',
      'auth',
      'employees',
      'shifts',
      'attendance',
      'airports',
      'aircraft-types',
      'gates',
      'flights',
      'turnaround',
      'resources',
      'resource-assignments',
      'bookings',
      'emergencies',
      'tracking',
      'connections',
      'verify',
      'gate',
      'baggage',
      'parking',
      'security',
      'facilities',
      'chat',
    ],
  });
});

// Test-only route to verify error handling behavior
if (process.env.NODE_ENV === 'test') {
  app.get('/test-error-trigger', (req, res, next) => {
    next(new Error('Sensitive database leak: secret_pass_123'));
  });
}

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central JSON error handler: logs real error server-side, returns generic message + errorId
app.use((err, req, res, next) => {
  const errorId = crypto.randomUUID();
  console.error(`[Unhandled Error ${errorId}]:`, err);
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: 'Internal server error',
    errorId,
  });
});

export const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
});
app.set('io', io);

// Authenticated Socket.IO middleware — verifies JWT from handshake.auth.token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('unauthorized'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = { id: payload.sub ?? payload.id, role: payload.role, email: payload.email };
    next();
  } catch {
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  const userId = user?.id ?? user?.sub;
  if (userId) {
    socket.join(`user:${userId}`);
  }
  if (user?.role) {
    socket.join(`role:${user.role}`);
    if (['ops_manager', 'admin', 'ground_crew', 'security', 'medical'].includes(user.role)) {
      socket.join('ops_feed');
    }
  }

  socket.on('subscribe_flight', async (flightId) => {
    if (!flightId) return;
    try {
      const { rows } = await pool.query('SELECT id FROM flight WHERE id = $1', [flightId]);
      if (rows.length > 0) {
        socket.join(`flight:${flightId}`);
      }
    } catch (err) {
      console.error(`Error subscribing to flight ${flightId}:`, err.message);
    }
  });

  socket.on('unsubscribe_flight', (flightId) => {
    if (flightId) socket.leave(`flight:${flightId}`);
  });

  socket.on('disconnect', () => {
    // client disconnected
  });
});

export { app };

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Airport Management backend listening on port ${PORT}`);
  });
}
