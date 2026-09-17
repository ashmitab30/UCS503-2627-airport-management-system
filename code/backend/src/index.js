import express from 'express';
import cors from 'cors';
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

const app = express();
app.use(cors());
app.use(express.json());

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
  res.json({ message: 'Airport Management System API — Week 3: Ops Core (flights, gates, turnaround, resources)' });
});

// Central JSON error handler — catches anything a route didn't handle
// itself (e.g. malformed JSON body) instead of Express's default HTML
// error page, which would break every fetch() call on the frontend.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

// WebSocket layer is wired up here from Week 1 onward, even though it's
// not used until Week 5 (delay propagation) and Week 8 (emergency
// alerts). Setting up the transport early means later weeks only add
// event handlers, not plumbing.
export const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*' },
});

io.on('connection', (socket) => {
  console.log(`socket connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`socket disconnected: ${socket.id}`));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Airport Management backend listening on port ${PORT}`);
});
