import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Server } from 'socket.io';
import 'dotenv/config';

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

// Production safety verification: refuse to start with missing or default secret
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'my_local_dev_secret_123' || secret.includes('placeholder')) {
    console.error('FATAL: Refusing to start in production with missing or default JWT_SECRET');
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

app.get('/', (req, res) => {
  res.json({
    message: 'Airport Management System API',
    status: 'operational',
    version: '0.2.0',
    modules: ['auth', 'ops_core', 'booking', 'emergencies', 'tracking'],
  });
});

// Central JSON error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log(`socket connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`socket disconnected: ${socket.id}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Airport Management backend listening on port ${PORT}`);
});
