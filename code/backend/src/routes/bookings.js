import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  ASSISTANCE_TYPES,
  ASSISTANCE_STAFF_ROLES,
  ADMIN_OPS_ROLES,
} from '../constants/index.js';
import {
  executeBooking,
  calculateSeatPriceCents,
} from '../services/bookingService.js';
import { generateSeatsForFlight } from '../services/seatService.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';
import { io } from '../index.js';

export const bookingsRouter = Router();

const searchFlightsQuerySchema = paginationQuerySchema().extend({
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  class: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
});

// GET /bookings/search-flights — any authenticated user. Real fares per flight & class.
bookingsRouter.get(
  '/search-flights',
  authenticate,
  validate({ query: searchFlightsQuerySchema }),
  async (req, res) => {
    const { origin, destination, date, class: seatClass, limit, offset } = req.query;
    const conditions = [];
    const params = [];

    if (origin) {
      params.push(origin.toUpperCase());
      conditions.push(`o.code = $${params.length}`);
    }
    if (destination) {
      params.push(destination.toUpperCase());
      conditions.push(`d.code = $${params.length}`);
    }
    if (date) {
      params.push(date);
      conditions.push(`f.scheduled_departure::date = $${params.length}`);
    }
    conditions.push(`f.status <> 'cancelled'`);
    const where = `WHERE ${conditions.join(' AND ')}`;

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    try {
      const { rows } = await pool.query(
        `SELECT f.id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status,
                f.base_price_cents,
                o.code AS origin_code, o.name AS origin_name,
                d.code AS dest_code, d.name AS dest_name,
                at.model AS aircraft_model, at.size_class,
                -- Legacy alias for compatibility with existing UI
                f.base_price_cents AS mock_price_cents,
                ROUND(f.base_price_cents * 1.0) AS economy_price_cents,
                ROUND(f.base_price_cents * 1.4) AS premium_economy_price_cents,
                ROUND(f.base_price_cents * 2.2) AS business_price_cents,
                ROUND(f.base_price_cents * 3.5) AS first_price_cents
         FROM flight f
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         JOIN aircraft_type at ON at.id = f.aircraft_type_id
         ${where}
         ORDER BY f.scheduled_departure
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );

      // If user filtered by class, compute price for that class
      const formatted = rows.map((flight) => {
        const targetClass = seatClass || 'economy';
        const priceCents = calculateSeatPriceCents(flight.base_price_cents, targetClass);
        return {
          ...flight,
          selected_class: targetClass,
          fare_cents: priceCents,
          fare_formatted: (priceCents / 100).toFixed(2),
        };
      });

      res.json({ flights: formatted, limit, offset });
    } catch (err) {
      console.error('search flights error:', err.message);
      res.status(500).json({ error: 'Could not search flights' });
    }
  }
);

// GET /bookings/flights/:flightId/seats — loads seats and prices. Pre-generates if missing.
bookingsRouter.get('/flights/:flightId/seats', authenticate, async (req, res) => {
  const flightId = parseInt(req.params.flightId, 10);
  if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

  try {
    const flightCheck = await pool.query(
      'SELECT id, aircraft_type_id, base_price_cents, status FROM flight WHERE id = $1',
      [flightId]
    );
    if (flightCheck.rows.length === 0) return res.status(404).json({ error: 'Flight not found' });
    const flight = flightCheck.rows[0];

    let existing = await pool.query(
      `SELECT id, seat_number, class, is_booked
       FROM seat WHERE flight_id = $1
       ORDER BY
         CAST(SUBSTRING(seat_number FROM '^[0-9]+') AS INTEGER),
         SUBSTRING(seat_number FROM '[A-Z]+')`,
      [flightId]
    );

    // If seats are missing, generate them now using the aircraft type capacity
    if (existing.rows.length === 0) {
      await generateSeatsForFlight(flightId, flight.aircraft_type_id, pool);
      existing = await pool.query(
        `SELECT id, seat_number, class, is_booked
         FROM seat WHERE flight_id = $1
         ORDER BY
           CAST(SUBSTRING(seat_number FROM '^[0-9]+') AS INTEGER),
           SUBSTRING(seat_number FROM '[A-Z]+')`,
        [flightId]
      );
    }

    const seatsWithFares = existing.rows.map((s) => {
      const priceCents = calculateSeatPriceCents(flight.base_price_cents, s.class);
      return {
        ...s,
        price_cents: priceCents,
        price_formatted: (priceCents / 100).toFixed(2),
        is_available: !s.is_booked,
      };
    });

    res.json({ seats: seatsWithFares, base_price_cents: flight.base_price_cents });
  } catch (err) {
    console.error('get seats error:', err.message);
    res.status(500).json({ error: 'Could not load seats' });
  }
});

const createBookingSchema = z.object({
  flight_id: z.number().int().positive('flight_id must be a positive integer'),
  seat_id: z.number().int().positive('seat_id must be a positive integer'),
  assistance_type: z.enum(ASSISTANCE_TYPES).optional().nullable(),
  assistance_notes: z.string().optional().nullable(),
  passenger: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      passport_number: z.string().optional(),
      nationality: z.string().optional(),
      date_of_birth: z.string().optional(),
    })
    .optional(),
});

// POST /bookings — validated integers, concurrency-safe locking on seat, snapshot fare.
bookingsRouter.post(
  '/',
  authenticate,
  requireRole('passenger', 'admin'),
  validate({ body: createBookingSchema }),
  async (req, res) => {
    const { flight_id, seat_id, assistance_type, assistance_notes, passenger } = req.body;

    try {
      const result = await executeBooking({
        userId: req.user.id,
        flightId: flight_id,
        seatId: seat_id,
        assistanceType: assistance_type,
        assistanceNotes: assistance_notes,
        passengerDetails: passenger,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }

      if (io) {
        io.emit('booking:created', {
          flightId: flight_id,
          seatId: seat_id,
          bookingId: result.booking.id,
        });
      }

      res.status(201).json({
        booking: result.booking,
        payment: result.payment,
        assistance: result.assistance,
      });
    } catch (err) {
      console.error('create booking error:', err.message);
      res.status(500).json({ error: 'Could not create booking' });
    }
  }
);

const listMyBookingsSchema = paginationQuerySchema();

// GET /bookings/mine — logged in passenger's bookings.
bookingsRouter.get(
  '/mine',
  authenticate,
  validate({ query: listMyBookingsSchema }),
  async (req, res) => {
    const { limit, offset } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents,
                f.id AS flight_id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
                o.code AS origin_code, o.name AS origin_name,
                d.code AS dest_code, d.name AS dest_name,
                s.seat_number, s.class AS seat_class,
                p.name AS passenger_name, p.email AS passenger_email,
                ar.type AS assistance_type, ar.status AS assistance_status
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN assistance_request ar ON ar.booking_id = b.id
         WHERE b.user_id = $1
         ORDER BY f.scheduled_departure DESC
         LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      );
      res.json({ bookings: rows, limit, offset });
    } catch (err) {
      console.error('list my bookings error:', err.message);
      res.status(500).json({ error: 'Could not load bookings' });
    }
  }
);

// GET /bookings/:id — full ticket detail.
bookingsRouter.get('/:id', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.booking_ref, b.status, b.created_at, b.user_id, b.price_cents,
              f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              g.code AS gate_code,
              s.seat_number, s.class AS seat_class,
              COALESCE(p.name, u.name) AS passenger_name,
              COALESCE(p.email, u.email) AS passenger_email,
              p.passport_number, p.nationality,
              pay.amount AS paid_amount, pay.status AS payment_status,
              ar.id AS assistance_id, ar.type AS assistance_type, ar.status AS assistance_status, ar.notes AS assistance_notes
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN passenger p ON p.id = b.passenger_id
       LEFT JOIN payment pay ON pay.booking_id = b.id
       LEFT JOIN assistance_request ar ON ar.booking_id = b.id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const booking = rows[0];
    const isOwner = req.user.id === booking.user_id;
    const isStaff = ASSISTANCE_STAFF_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ booking });
  } catch (err) {
    console.error('get booking error:', err.message);
    res.status(500).json({ error: 'Could not fetch booking' });
  }
});

const listAssistanceSchema = paginationQuerySchema();

// GET /bookings/assistance/all — staff assistance queue.
bookingsRouter.get(
  '/assistance/all',
  authenticate,
  requireRole(...ASSISTANCE_STAFF_ROLES),
  validate({ query: listAssistanceSchema }),
  async (req, res) => {
    const { limit, offset } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT ar.id, ar.type, ar.status, ar.notes, ar.assigned_staff_id,
                b.booking_ref, f.flight_number, f.scheduled_departure,
                COALESCE(p.name, u.name) AS passenger_name,
                staff.name AS assigned_staff_name
         FROM assistance_request ar
         JOIN booking b ON b.id = ar.booking_id
         JOIN flight f ON f.id = b.flight_id
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN "user" staff ON staff.id = ar.assigned_staff_id
         ORDER BY ar.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      res.json({ requests: rows, limit, offset });
    } catch (err) {
      console.error('list assistance requests error:', err.message);
      res.status(500).json({ error: 'Could not load assistance requests' });
    }
  }
);

// PATCH /bookings/assistance/:id/status — sets assigned_staff_id ONLY on 'assigned'.
bookingsRouter.patch(
  '/assistance/:id/status',
  authenticate,
  requireRole(...ASSISTANCE_STAFF_ROLES),
  async (req, res) => {
    const assistId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const valid = ['requested', 'assigned', 'in_progress', 'completed'];

    if (isNaN(assistId)) return res.status(400).json({ error: 'Invalid assistance request ID' });
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
    }

    try {
      let query;
      let params;

      if (status === 'assigned') {
        // Explicitly set assigned staff to current user if assigning
        query = `
          UPDATE assistance_request
          SET status = $1, assigned_staff_id = $2
          WHERE id = $3
          RETURNING id, status, assigned_staff_id
        `;
        params = [status, req.user.id, assistId];
      } else {
        // Do NOT overwrite existing assigned staff on subsequent transitions (in_progress, completed)
        query = `
          UPDATE assistance_request
          SET status = $1, assigned_staff_id = COALESCE(assigned_staff_id, $2)
          WHERE id = $3
          RETURNING id, status, assigned_staff_id
        `;
        params = [status, req.user.id, assistId];
      }

      const { rows } = await pool.query(query, params);
      if (rows.length === 0) return res.status(404).json({ error: 'Assistance request not found' });
      res.json({ request: rows[0] });
    } catch (err) {
      console.error('update assistance status error:', err.message);
      res.status(500).json({ error: 'Could not update assistance request' });
    }
  }
);

const listAllBookingsSchema = paginationQuerySchema(50, 200);

// GET /bookings — admin/ops_manager.
bookingsRouter.get(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ query: listAllBookingsSchema }),
  async (req, res) => {
    const { limit, offset } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents,
                f.flight_number, f.scheduled_departure, f.status AS flight_status,
                o.code AS origin_code, d.code AS dest_code,
                s.seat_number, s.class AS seat_class,
                COALESCE(p.name, u.name) AS passenger_name,
                COALESCE(p.email, u.email) AS passenger_email,
                ar.type AS assistance_type, ar.status AS assistance_status
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN assistance_request ar ON ar.booking_id = b.id
         ORDER BY b.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      res.json({ bookings: rows, limit, offset });
    } catch (err) {
      console.error('list all bookings error:', err.message);
      res.status(500).json({ error: 'Could not list bookings' });
    }
  }
);

const listPassengersSchema = paginationQuerySchema(50, 200);

// GET /bookings/passengers/all — passenger registry.
bookingsRouter.get(
  '/passengers/all',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ query: listPassengersSchema }),
  async (req, res) => {
    const { limit, offset } = req.query;
    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.email, p.phone, p.passport_number, p.nationality, p.date_of_birth, p.created_at,
                COUNT(b.id) AS booking_count
         FROM passenger p
         LEFT JOIN booking b ON b.passenger_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      res.json({ passengers: rows, limit, offset });
    } catch (err) {
      console.error('list passengers error:', err.message);
      res.status(500).json({ error: 'Could not list passengers' });
    }
  }
);
