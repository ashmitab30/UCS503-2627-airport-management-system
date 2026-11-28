import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  ASSISTANCE_TYPES,
  ASSISTANCE_STAFF_ROLES,
  ADMIN_OPS_ROLES,
  BAGGAGE_STAFF_ROLES,
  BOARDING_GROUPS,
  OPEN_ASSISTANCE_STATUSES,
} from '../constants/index.js';
import {
  registerBaggage,
  getBookingBaggage,
} from '../services/baggageService.js';
import {
  executeBooking,
  holdSeat,
  confirmHeldBooking,
  checkInBooking,
  cancelBooking,
  flagNoShowsForFlight,
  calculateSeatPriceCents,
  cleanupExpiredHolds,
  searchFlights,
  recomputeBoardingGroup,
} from '../services/bookingService.js';
import { generateSeatsForFlight } from '../services/seatService.js';
import { streamBoardingPassPdf, generateQrCode } from '../services/boardingPassService.js';
import { buildVerificationUrl } from '../services/qrSignService.js';
import { hasDeparted } from '../services/flightTime.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

const getIo = (req) => req?.app?.get?.('io');

export const bookingsRouter = Router();

const searchFlightsQuerySchema = paginationQuerySchema().extend({
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  class: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
  includePast: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return undefined;
    }, z.boolean().optional())
    .optional(),
});

// GET /bookings/search-flights — search flights with real pricing and class filters.
bookingsRouter.get(
  '/search-flights',
  authenticate,
  validate({ query: searchFlightsQuerySchema }),
  async (req, res) => {
    try {
      const result = await searchFlights({
        ...req.query,
        userRole: req.user?.role,
      });
      res.json(result);
    } catch (err) {
      console.error('search flights error:', err.message);
      res.status(500).json({ error: 'Could not search flights' });
    }
  }
);

// GET /bookings/flights/:flightId/seats — loads seats and prices with expired hold cleanup.
bookingsRouter.get('/flights/:flightId/seats', authenticate, async (req, res) => {
  const flightId = parseInt(req.params.flightId, 10);
  if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

  try {
    // Release any expired holds first
    await cleanupExpiredHolds(pool);

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

const holdOrBookSchema = z.object({
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

// POST /bookings/hold — holds a seat with a timed expiration (10 min).
bookingsRouter.post(
  '/hold',
  authenticate,
  requireRole('passenger', 'admin'),
  validate({ body: holdOrBookSchema }),
  async (req, res) => {
    const { flight_id, seat_id, assistance_type, assistance_notes, passenger } = req.body;

    try {
      const result = await holdSeat({
        userId: req.user.id,
        flightId: flight_id,
        seatId: seat_id,
        assistanceType: assistance_type,
        assistanceNotes: assistance_notes,
        passengerDetails: passenger,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }

      const io = getIo(req);
      if (io) {
        io.emit('seat:held', {
          flightId: flight_id,
          seatId: seat_id,
          bookingId: result.booking.id,
        });
      }

      res.status(201).json({
        booking: result.booking,
        assistance: result.assistance,
      });
    } catch (err) {
      console.error('hold seat error:', err.message);
      res.status(500).json({ error: 'Could not hold seat' });
    }
  }
);

const confirmPaymentSchema = z.object({
  payment_method: z.string().optional().default('mock_card'),
});

// POST /bookings/:id/confirm-payment — confirms a held booking via mock payment.
bookingsRouter.post(
  '/:id/confirm-payment',
  authenticate,
  validate({ body: confirmPaymentSchema }),
  async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    try {
      const result = await confirmHeldBooking({
        bookingId,
        userId: req.user.id,
        paymentMethod: req.body.payment_method,
      });

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }

      const io = getIo(req);
      if (io) {
        io.emit('booking:confirmed', {
          bookingId: result.booking.id,
          bookingRef: result.booking.booking_ref,
        });
      }

      res.json({
        booking: result.booking,
        payment: result.payment,
      });
    } catch (err) {
      console.error('confirm payment error:', err.message);
      res.status(500).json({ error: 'Could not confirm payment' });
    }
  }
);

// POST /bookings — direct all-in-one booking (holds + confirms).
bookingsRouter.post(
  '/',
  authenticate,
  requireRole('passenger', 'admin'),
  validate({ body: holdOrBookSchema }),
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
        return res.status(result.status).json({ error: result.error, code: result.code });
      }

      const io = getIo(req);
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

// POST /bookings/:id/check-in — web check-in within 24h window.
bookingsRouter.post('/:id/check-in', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  const { seat_id } = req.body;
  const parsedSeatId = seat_id ? parseInt(seat_id, 10) : null;

  try {
    const result = await checkInBooking({
      bookingId,
      userId: req.user.id,
      seatId: parsedSeatId,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    const io = getIo(req);
    if (io) {
      io.emit('booking:checked_in', { bookingId });
    }

    res.json({ booking: result.booking });
  } catch (err) {
    console.error('check-in error:', err.message);
    res.status(500).json({ error: 'Could not complete check-in' });
  }
});

// POST /bookings/:id/cancel — cancels booking and issues refund.
bookingsRouter.post('/:id/cancel', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  const isAdmin = ADMIN_OPS_ROLES.includes(req.user.role);

  try {
    const result = await cancelBooking({
      bookingId,
      userId: req.user.id,
      isAdmin,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const io = getIo(req);
    if (io) {
      io.emit('booking:cancelled', { bookingId });
    }

    res.json({ booking: result.booking, refund: result.refund });
  } catch (err) {
    console.error('cancel booking error:', err.message);
    res.status(500).json({ error: 'Could not cancel booking' });
  }
});

// POST /bookings/flights/:flightId/flag-no-shows — admin/ops flags departed no-shows.
bookingsRouter.post(
  '/flights/:flightId/flag-no-shows',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const flightId = parseInt(req.params.flightId, 10);
    if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

    try {
      const result = await flagNoShowsForFlight({ flightId });
      res.json(result);
    } catch (err) {
      console.error('flag no-shows error:', err.message);
      res.status(500).json({ error: 'Could not flag no-shows' });
    }
  }
);

// GET /bookings/:id/boarding-pass — JSON view with QR Code data URL.
bookingsRouter.get('/:id/boarding-pass', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents, b.user_id, b.boarding_group,
              f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.actual_departure, f.status AS flight_status,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              g.code AS gate_code,
              s.seat_number, s.class AS seat_class,
              COALESCE(p.name, u.name) AS passenger_name,
              COALESCE(p.email, u.email) AS passenger_email,
              p.passport_number, p.nationality,
              ar.type AS assistance_type, ar.status AS assistance_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN passenger p ON p.id = b.passenger_id
       LEFT JOIN assistance_request ar ON ar.booking_id = b.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const isOwner = req.user.id === b.user_id;
    const isStaff = ASSISTANCE_STAFF_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    if (hasDeparted(b, now)) {
      return res.status(400).json({ error: 'Flight has already departed', code: 'FLIGHT_DEPARTED' });
    }
    const depTime = new Date(b.scheduled_departure).getTime();
    const diffHours = (depTime - now.getTime()) / (1000 * 3600);
    if (diffHours > 24) {
      return res.status(400).json({
        error: 'Boarding pass is available only within 24 hours of scheduled departure',
        code: 'CHECK_IN_NOT_OPEN',
      });
    }

    const verificationUrl = buildVerificationUrl(b.booking_ref);
    const qrDataUrl = await generateQrCode(verificationUrl);

    res.json({
      boarding_pass: {
        ...b,
        qr_code_data_url: qrDataUrl,
        verification_url: verificationUrl,
        priority_boarding: b.boarding_group === 1 || Boolean(b.assistance_type),
        boarding_group: b.boarding_group,
      },
    });
  } catch (err) {
    console.error('get boarding pass error:', err.message);
    res.status(500).json({ error: 'Could not load boarding pass' });
  }
});

// GET /bookings/:id/boarding-pass.pdf — PDF download stream with QR code.
bookingsRouter.get('/:id/boarding-pass.pdf', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const { rows } = await pool.query(
      `SELECT b.user_id, f.scheduled_departure, f.actual_departure, f.status AS flight_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const isOwner = req.user.id === b.user_id;
    const isStaff = ASSISTANCE_STAFF_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const now = new Date();
    if (hasDeparted(b, now)) {
      return res.status(400).json({ error: 'Flight has already departed', code: 'FLIGHT_DEPARTED' });
    }
    const depTime = new Date(b.scheduled_departure).getTime();
    const diffHours = (depTime - now.getTime()) / (1000 * 3600);
    if (diffHours > 24) {
      return res.status(400).json({
        error: 'Boarding pass is available only within 24 hours of scheduled departure',
        code: 'CHECK_IN_NOT_OPEN',
      });
    }

    await streamBoardingPassPdf(bookingId, res);
  } catch (err) {
    console.error('stream boarding pass pdf error:', err.message);
    res.status(500).json({ error: 'Could not stream boarding pass PDF' });
  }
});

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
        `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents, b.held_until, b.boarding_group,
                f.id AS flight_id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.actual_departure, f.status AS flight_status,
                o.code AS origin_code, o.name AS origin_name,
                d.code AS dest_code, d.name AS dest_name,
                s.seat_number, s.class AS seat_class,
                p.name AS passenger_name, p.email AS passenger_email,
                ar.id AS assistance_id, ar.type AS assistance_type, ar.status AS assistance_status, ar.notes AS assistance_notes,
                split_part(staff.name, ' ', 1) AS assigned_staff_first_name
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN LATERAL (
           SELECT id, type, status, notes, assigned_staff_id
           FROM assistance_request
           WHERE booking_id = b.id
           ORDER BY (status IN ('requested', 'assigned', 'in_progress')) DESC, id DESC
           LIMIT 1
         ) ar ON true
         LEFT JOIN "user" staff ON staff.id = ar.assigned_staff_id
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
      `SELECT b.id, b.booking_ref, b.status, b.created_at, b.user_id, b.price_cents, b.held_until, b.boarding_group,
              f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              g.code AS gate_code,
              s.seat_number, s.class AS seat_class,
              COALESCE(p.name, u.name) AS passenger_name,
              COALESCE(p.email, u.email) AS passenger_email,
              p.passport_number, p.nationality,
              pay.amount AS paid_amount, pay.status AS payment_status,
              ar.id AS assistance_id, ar.type AS assistance_type, ar.status AS assistance_status, ar.notes AS assistance_notes,
              split_part(staff.name, ' ', 1) AS assigned_staff_first_name
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN passenger p ON p.id = b.passenger_id
       LEFT JOIN payment pay ON pay.booking_id = b.id
       LEFT JOIN LATERAL (
         SELECT id, type, status, notes, assigned_staff_id
         FROM assistance_request
         WHERE booking_id = b.id
         ORDER BY (status IN ('requested', 'assigned', 'in_progress')) DESC, id DESC
         LIMIT 1
       ) ar ON true
       LEFT JOIN "user" staff ON staff.id = ar.assigned_staff_id
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

function emitAssistanceEvent(req, eventName, payload) {
  const io = getIo(req);
  if (!io) return;
  for (const role of ['ground_crew', 'medical', 'ops_manager', 'admin']) {
    io.to(`role:${role}`).emit(eventName, payload);
  }
  io.to('ops_feed').emit(eventName, payload);
  io.emit(eventName, payload);
}

const createAssistanceSchema = z.object({
  type: z.enum(ASSISTANCE_TYPES),
  notes: z.string().max(500, 'Notes must be 500 characters or less').optional().nullable(),
});

// POST /bookings/:id/assistance — passenger request assistance for confirmed or checked-in booking.
bookingsRouter.post(
  '/:id/assistance',
  authenticate,
  validate({ body: createAssistanceSchema }),
  async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    const { type, notes } = req.body;

    try {
      const { rows: bRows } = await pool.query(
        `SELECT b.id, b.user_id, b.status, f.status AS flight_status, f.scheduled_departure, f.actual_departure
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         WHERE b.id = $1`,
        [bookingId]
      );
      if (bRows.length === 0) return res.status(404).json({ error: 'Booking not found' });
      const b = bRows[0];

      const isOwner = req.user.id === b.user_id;
      const isStaff = ADMIN_OPS_ROLES.includes(req.user.role);
      if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

      if (!['confirmed', 'checked_in'].includes(b.status)) {
        return res.status(400).json({
          error: `Assistance can only be requested for confirmed or checked-in bookings (current status: ${b.status})`,
        });
      }

      if (hasDeparted(b) || b.flight_status === 'cancelled') {
        return res.status(400).json({
          error: 'Cannot request assistance for a flight that has already departed or been cancelled',
        });
      }

      // At most one open request per booking and type
      const { rows: openRows } = await pool.query(
        `SELECT id FROM assistance_request
         WHERE booking_id = $1 AND type = $2 AND status IN ('requested', 'assigned', 'in_progress')`,
        [bookingId, type]
      );
      if (openRows.length > 0) {
        return res.status(409).json({
          error: `An open assistance request of type '${type}' already exists for this booking`,
        });
      }

      const { rows: insRows } = await pool.query(
        `INSERT INTO assistance_request (booking_id, type, notes, status, created_at)
         VALUES ($1, $2, $3, 'requested', now())
         RETURNING id, booking_id, type, notes, status, created_at`,
        [bookingId, type, notes || null]
      );
      const request = insRows[0];

      // Recompute boarding group if booking is already checked in
      await recomputeBoardingGroup(bookingId, pool);

      emitAssistanceEvent(req, 'assistance:created', { request });

      res.status(201).json({ request });
    } catch (err) {
      console.error('create assistance request error:', err.message);
      res.status(500).json({ error: 'Could not create assistance request' });
    }
  }
);

// Helper for cancelling an assistance request (passenger or admin/ops)
const handleCancelAssistance = async (req, res) => {
  const assistId = parseInt(req.params.id, 10);
  if (isNaN(assistId)) return res.status(400).json({ error: 'Invalid assistance request ID' });

  try {
    const { rows: aRows } = await pool.query(
      `SELECT ar.id, ar.booking_id, ar.status, ar.type, b.user_id
       FROM assistance_request ar
       JOIN booking b ON b.id = ar.booking_id
       WHERE ar.id = $1`,
      [assistId]
    );
    if (aRows.length === 0) return res.status(404).json({ error: 'Assistance request not found' });
    const ar = aRows[0];

    const isOwner = req.user.id === ar.user_id;
    const isStaff = ADMIN_OPS_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    if (ar.status !== 'requested') {
      return res.status(409).json({
        error: `Cannot cancel an assistance request that is already ${ar.status}. Only requests in 'requested' status can be cancelled.`,
      });
    }

    const { rows: upRows } = await pool.query(
      `UPDATE assistance_request
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING id, booking_id, type, status`,
      [assistId]
    );
    const request = upRows[0];

    // Recompute boarding group for the booking (if checked in)
    await recomputeBoardingGroup(ar.booking_id, pool);

    emitAssistanceEvent(req, 'assistance:cancelled', { request });

    res.json({ message: 'Assistance request cancelled successfully', request });
  } catch (err) {
    console.error('cancel assistance error:', err.message);
    res.status(500).json({ error: 'Could not cancel assistance request' });
  }
};

// POST & DELETE /bookings/assistance/:id/cancel — passenger cancel own request while still requested
bookingsRouter.post('/assistance/:id/cancel', authenticate, handleCancelAssistance);
bookingsRouter.delete('/assistance/:id', authenticate, handleCancelAssistance);

// GET /bookings/:id/assistance — view all assistance requests for a booking
bookingsRouter.get('/:id/assistance', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const { rows: bRows } = await pool.query(
      `SELECT b.user_id FROM booking b WHERE b.id = $1`,
      [bookingId]
    );
    if (bRows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const isOwner = req.user.id === bRows[0].user_id;
    const isStaff = ASSISTANCE_STAFF_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query(
      `SELECT ar.id, ar.booking_id, ar.type, ar.status, ar.notes,
              ar.created_at, ar.assigned_at, ar.started_at, ar.completed_at,
              ar.assigned_staff_id,
              split_part(staff.name, ' ', 1) AS assigned_staff_first_name
       FROM assistance_request ar
       LEFT JOIN "user" staff ON staff.id = ar.assigned_staff_id
       WHERE ar.booking_id = $1
       ORDER BY ar.created_at DESC`,
      [bookingId]
    );

    res.json({ requests: rows });
  } catch (err) {
    console.error('get booking assistance error:', err.message);
    res.status(500).json({ error: 'Could not fetch assistance requests' });
  }
});

const listAssistanceSchema = paginationQuerySchema().extend({
  status: z.string().optional(),
  type: z.string().optional(),
  flight: z.string().optional(),
});

// GET /bookings/assistance/all — staff assistance queue & admin overview with filters
bookingsRouter.get(
  '/assistance/all',
  authenticate,
  requireRole(...ASSISTANCE_STAFF_ROLES),
  validate({ query: listAssistanceSchema }),
  async (req, res) => {
    const { limit, offset, status, type, flight } = req.query;
    try {
      const conditions = [];
      const params = [];

      if (status) {
        if (status === 'open') {
          conditions.push(`ar.status IN ('requested', 'assigned', 'in_progress')`);
        } else {
          params.push(status);
          conditions.push(`ar.status = $${params.length}`);
        }
      }

      if (type) {
        params.push(type);
        conditions.push(`ar.type = $${params.length}`);
      }

      if (flight) {
        params.push(`%${flight}%`);
        const pNum = params.length;
        conditions.push(`(f.flight_number ILIKE $${pNum} OR f.id::text = $${pNum})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      params.push(limit);
      const limitParam = params.length;
      params.push(offset);
      const offsetParam = params.length;

      const { rows } = await pool.query(
        `SELECT ar.id, ar.type, ar.status, ar.notes, ar.assigned_staff_id,
                ar.created_at, ar.assigned_at, ar.started_at, ar.completed_at,
                b.id AS booking_id, b.booking_ref, b.boarding_group,
                f.id AS flight_id, f.flight_number, f.scheduled_departure,
                o.code AS origin_code, d.code AS dest_code,
                s.seat_number, s.class AS seat_class,
                COALESCE(p.name, u.name) AS passenger_name,
                COALESCE(EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth))::int, null) AS passenger_age,
                staff.name AS assigned_staff_name,
                split_part(staff.name, ' ', 1) AS assigned_staff_first_name
         FROM assistance_request ar
         JOIN booking b ON b.id = ar.booking_id
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN "user" staff ON staff.id = ar.assigned_staff_id
         ${whereClause}
         ORDER BY
           CASE ar.status
             WHEN 'requested' THEN 1
             WHEN 'assigned' THEN 2
             WHEN 'in_progress' THEN 3
             WHEN 'completed' THEN 4
             ELSE 5
           END,
           ar.created_at ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params
      );
      res.json({ requests: rows, limit, offset });
    } catch (err) {
      console.error('list assistance requests error:', err.message);
      res.status(500).json({ error: 'Could not load assistance requests' });
    }
  }
);

// PATCH /bookings/assistance/:id/status — advance assistance request status.
// Transitions:
// requested -> assigned (take it; sets assigned_staff_id & assigned_at)
// assigned -> in_progress (start; only assigned staff member, ops_manager or admin)
// in_progress -> completed (complete; only assigned staff member, ops_manager or admin)
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
      const { rows: currRows } = await pool.query(
        `SELECT ar.id, ar.booking_id, ar.status, ar.assigned_staff_id, ar.type
         FROM assistance_request ar
         WHERE ar.id = $1`,
        [assistId]
      );
      if (currRows.length === 0) return res.status(404).json({ error: 'Assistance request not found' });
      const current = currRows[0];

      // Transition validation
      const validNextSteps = {
        requested: ['assigned'],
        assigned: ['in_progress'],
        in_progress: ['completed'],
        completed: [],
        cancelled: [],
      };

      const allowedNext = validNextSteps[current.status] || [];
      if (!allowedNext.includes(status)) {
        return res.status(409).json({
          error: `Cannot transition assistance request from '${current.status}' to '${status}'. Valid next step: ${allowedNext.join(', ') || 'none'}`,
        });
      }

      // Permission validation:
      // - 'assigned' ("take it"): any staff member in ASSISTANCE_STAFF_ROLES
      // - 'in_progress' or 'completed': only the assigned staff member, ops_manager or admin
      if (['in_progress', 'completed'].includes(status)) {
        const isAssignedStaff = current.assigned_staff_id === req.user.id;
        const isAdminOrOps = ADMIN_OPS_ROLES.includes(req.user.role);
        if (!isAssignedStaff && !isAdminOrOps) {
          return res.status(403).json({
            error: 'Only the assigned staff member, ops_manager or admin may advance this request',
          });
        }
      }

      let query;
      let params;

      if (status === 'assigned') {
        query = `
          UPDATE assistance_request
          SET status = $1,
              assigned_staff_id = $2,
              assigned_at = COALESCE(assigned_at, now())
          WHERE id = $3
          RETURNING id, booking_id, type, status, notes, assigned_staff_id, created_at, assigned_at, started_at, completed_at
        `;
        params = [status, req.user.id, assistId];
      } else if (status === 'in_progress') {
        query = `
          UPDATE assistance_request
          SET status = $1,
              started_at = COALESCE(started_at, now())
          WHERE id = $2
          RETURNING id, booking_id, type, status, notes, assigned_staff_id, created_at, assigned_at, started_at, completed_at
        `;
        params = [status, assistId];
      } else if (status === 'completed') {
        query = `
          UPDATE assistance_request
          SET status = $1,
              completed_at = COALESCE(completed_at, now())
          WHERE id = $2
          RETURNING id, booking_id, type, status, notes, assigned_staff_id, created_at, assigned_at, started_at, completed_at
        `;
        params = [status, assistId];
      }

      const { rows } = await pool.query(query, params);
      const updated = rows[0];

      // Recompute boarding group when completed (if no longer qualifying for priority)
      if (status === 'completed') {
        await recomputeBoardingGroup(current.booking_id, pool);
      }

      emitAssistanceEvent(req, 'assistance:updated', { request: updated });

      res.json({ request: updated });
    } catch (err) {
      console.error('update assistance status error:', err.message);
      res.status(500).json({ error: 'Could not update assistance request' });
    }
  }
);

// PATCH /bookings/assistance/:id/reassign — admin/ops_manager reassigns assistance request
bookingsRouter.patch(
  '/assistance/:id/reassign',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const assistId = parseInt(req.params.id, 10);
    const { staff_id } = req.body;

    if (isNaN(assistId)) return res.status(400).json({ error: 'Invalid assistance request ID' });
    const targetStaffId = parseInt(staff_id, 10);
    if (isNaN(targetStaffId)) return res.status(400).json({ error: 'Invalid staff_id' });

    try {
      // Verify target staff has an assistance-capable role
      const { rows: staffRows } = await pool.query(
        `SELECT id, name, role FROM "user" WHERE id = $1 AND role = ANY($2)`,
        [targetStaffId, ASSISTANCE_STAFF_ROLES]
      );
      if (staffRows.length === 0) {
        return res.status(400).json({
          error: 'Target staff member must have an assistance-capable role (ground_crew, medical, ops_manager, admin)',
        });
      }

      const { rows: curRows } = await pool.query(
        `SELECT id, booking_id, status FROM assistance_request WHERE id = $1`,
        [assistId]
      );
      if (curRows.length === 0) return res.status(404).json({ error: 'Assistance request not found' });
      const current = curRows[0];

      // If requested, moving to assigned upon reassign
      const nextStatus = current.status === 'requested' ? 'assigned' : current.status;

      const { rows } = await pool.query(
        `UPDATE assistance_request
         SET assigned_staff_id = $1,
             status = $2,
             assigned_at = COALESCE(assigned_at, now())
         WHERE id = $3
         RETURNING id, booking_id, type, status, notes, assigned_staff_id, created_at, assigned_at, started_at, completed_at`,
        [targetStaffId, nextStatus, assistId]
      );

      const updated = rows[0];
      emitAssistanceEvent(req, 'assistance:updated', { request: updated });

      res.json({ request: updated, assigned_staff: staffRows[0] });
    } catch (err) {
      console.error('reassign assistance error:', err.message);
      res.status(500).json({ error: 'Could not reassign assistance request' });
    }
  }
);

const listAllBookingsSchema = paginationQuerySchema(50, 500).extend({
  status: z.string().optional(),
});

// GET /bookings — admin/ops_manager.
bookingsRouter.get(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ query: listAllBookingsSchema }),
  async (req, res) => {
    const { limit, offset, status } = req.query;
    try {
      const conditions = [];
      const params = [];

      if (status) {
        params.push(status);
        conditions.push(`b.status = $${params.length}`);
      }

      params.push(limit);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT b.id, b.booking_ref, b.status, b.created_at, b.price_cents, b.held_until,
                b.user_id, b.passenger_id, b.flight_id,
                f.flight_number, f.scheduled_departure, f.scheduled_arrival,
                f.estimated_departure, f.estimated_arrival, f.actual_departure, f.actual_arrival,
                f.status AS flight_status,
                f.origin_id, f.dest_id,
                o.code AS origin_code, o.name AS origin_name,
                d.code AS dest_code, d.name AS dest_name,
                d.min_connection_minutes AS dest_mct,
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
         ${whereClause}
         ORDER BY b.created_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
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

// POST /bookings/:id/baggage — register bag for a checked-in booking (staff only)
bookingsRouter.post(
  '/:id/baggage',
  authenticate,
  requireRole(...BAGGAGE_STAFF_ROLES),
  async (req, res) => {
    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

    const { weight, location } = req.body;
    if (weight === undefined || weight === null || weight === '') {
      return res.status(400).json({ error: 'Weight is required' });
    }

    try {
      const bag = await registerBaggage({
        bookingId,
        weight,
        location,
        scannedBy: req.user.id,
        io: getIo(req),
      });
      res.status(201).json(bag);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Could not register baggage' });
    }
  }
);

// GET /bookings/:id/baggage — list bags for a booking with scan history (owner or staff)
bookingsRouter.get('/:id/baggage', authenticate, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const isStaff = BAGGAGE_STAFF_ROLES.includes(req.user.role);
    if (!isStaff) {
      const { rows } = await pool.query(
        'SELECT id, user_id FROM booking WHERE id = $1',
        [bookingId]
      );
      if (rows.length === 0 || rows[0].user_id !== req.user.id) {
        return res.status(404).json({ error: 'Booking not found' });
      }
    } else {
      const { rows } = await pool.query('SELECT id FROM booking WHERE id = $1', [bookingId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }
    }

    const baggage = await getBookingBaggage(bookingId);
    res.json({ baggage });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not retrieve baggage' });
  }
});

