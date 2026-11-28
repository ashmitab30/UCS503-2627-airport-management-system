import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { ADMIN_OPS_ROLES } from '../constants/index.js';
import {
  getAvailableLotsForWindow,
  createParkingBooking,
  cancelParkingBooking,
  getUserParkingBookings,
  getLotOccupancy,
  listParkingBookings,
  recordParkingEntry,
  recordParkingExit,
} from '../services/parkingService.js';

const getIo = (req) => req?.app?.get?.('io');

export const parkingRouter = Router();

// All parking endpoints require authentication
parkingRouter.use(authenticate);

// GET /parking/lots?airport_id=&from=&until= — available lots with free slots and cost estimate
parkingRouter.get('/lots', async (req, res) => {
  const { airport_id, from, until } = req.query;

  if (!airport_id) {
    return res.status(400).json({ error: 'airport_id query parameter is required' });
  }
  if (!from || !until) {
    return res.status(400).json({ error: 'Both from and until query parameters are required' });
  }

  try {
    const lots = await getAvailableLotsForWindow({
      airportId: airport_id,
      from,
      until,
    });
    res.json({ lots });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not fetch parking lots' });
  }
});

// GET /parking/bookings/mine — get current user's parking bookings
parkingRouter.get('/bookings/mine', async (req, res) => {
  try {
    const bookings = await getUserParkingBookings(req.user.id);
    res.json({ bookings });
  } catch (err) {
    console.error('get user parking bookings error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Could not retrieve parking bookings' });
  }
});

// POST /parking/bookings — book a parking slot
parkingRouter.post('/bookings', async (req, res) => {
  const { lot_id, vehicle_number, from, until } = req.body;

  if (!lot_id || !vehicle_number || !from || !until) {
    return res.status(400).json({
      error: 'lot_id, vehicle_number, from, and until are required',
    });
  }

  try {
    const booking = await createParkingBooking({
      userId: req.user.id,
      lotId: lot_id,
      vehicleNumber: vehicle_number,
      from,
      until,
      io: getIo(req),
    });
    res.status(201).json({ booking });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not create parking booking' });
  }
});

// POST /parking/bookings/:id/cancel — cancel parking reservation before start time
parkingRouter.post('/bookings/:id/cancel', async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) {
    return res.status(400).json({ error: 'Invalid booking ID' });
  }

  const isAdmin = ADMIN_OPS_ROLES.includes(req.user.role);

  try {
    const result = await cancelParkingBooking({
      bookingId,
      userId: req.user.id,
      isAdmin,
      io: getIo(req),
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not cancel parking booking' });
  }
});

// ── Admin and Ops Manager Endpoints ─────────────────────────────────────────

// GET /parking/bookings — list all parking bookings with filters and pagination
parkingRouter.get(
  '/bookings',
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const { status, lot_id, airport_id, vehicle_number, booking_ref, page = 1, limit = 20 } = req.query;

    try {
      const result = await listParkingBookings({
        status,
        lotId: lot_id,
        airportId: airport_id,
        vehicleNumber: vehicle_number,
        bookingRef: booking_ref,
        page,
        limit,
      });
      res.json(result);
    } catch (err) {
      console.error('list parking bookings error:', err.message);
      res.status(err.status || 500).json({ error: err.message || 'Could not list parking bookings' });
    }
  }
);

// GET /parking/lots/:id/occupancy — lot real-time occupancy and slot statuses
parkingRouter.get(
  '/lots/:id/occupancy',
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const lotId = parseInt(req.params.id, 10);
    if (isNaN(lotId)) {
      return res.status(400).json({ error: 'Invalid lot ID' });
    }

    try {
      const occupancy = await getLotOccupancy(lotId);
      res.json(occupancy);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Could not get lot occupancy' });
    }
  }
);

// POST /parking/bookings/:id/entry — record vehicle physical entry
parkingRouter.post(
  '/bookings/:id/entry',
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    try {
      const booking = await recordParkingEntry({
        bookingId,
        io: getIo(req),
      });
      res.json({ booking });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Could not record vehicle entry' });
    }
  }
);

// POST /parking/bookings/:id/exit — record vehicle physical exit
parkingRouter.post(
  '/bookings/:id/exit',
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    try {
      const booking = await recordParkingExit({
        bookingId,
        io: getIo(req),
      });
      res.json({ booking });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Could not record vehicle exit' });
    }
  }
);
