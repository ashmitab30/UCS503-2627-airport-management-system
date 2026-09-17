import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const bookingsRouter = Router();

const ASSISTANCE_TYPES = ['wheelchair', 'medical', 'visual', 'hearing', 'elderly_support'];
const STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'medical'];

// GET /bookings/search-flights — any authenticated user. Passenger-facing
// flight search. Filters are all optional so the same endpoint covers a
// broad "show me everything today" query and a narrow origin+destination
// search without needing two routes.
bookingsRouter.get('/search-flights', authenticate, async (req, res) => {
  const { origin, destination, date } = req.query;
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
  // Cancelled flights aren't bookable — filter them out unconditionally
  // rather than trusting the caller to add this themselves.
  conditions.push(`f.status <> 'cancelled'`);
  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              at.model AS aircraft_model,
              -- No fare column exists in the schema yet, so price is a
              -- deterministic mock derived from flight id — good enough
              -- for a working demo, clearly not real pricing logic.
              (3000 + (f.id * 137) % 6000) AS mock_price_cents
       FROM flight f
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       JOIN aircraft_type at ON at.id = f.aircraft_type_id
       ${where}
       ORDER BY f.scheduled_departure
       LIMIT 50`,
      params
    );
    res.json({ flights: rows });
  } catch (err) {
    console.error('search flights error:', err.message);
    res.status(500).json({ error: 'Could not search flights' });
  }
});

// GET /bookings/flights/:flightId/seats — lazily generates a standard
// economy layout (rows 1-20, A-F) the first time a flight's seats are
// requested, since the seed script only creates airports/gates/aircraft,
// not per-flight seat maps.
bookingsRouter.get('/flights/:flightId/seats', authenticate, async (req, res) => {
  const { flightId } = req.params;
  try {
    const flightCheck = await pool.query('SELECT id FROM flight WHERE id = $1', [flightId]);
    if (flightCheck.rows.length === 0) return res.status(404).json({ error: 'Flight not found' });

    const existing = await pool.query(
      'SELECT id, seat_number, class, is_booked FROM seat WHERE flight_id = $1 ORDER BY seat_number',
      [flightId]
    );
    if (existing.rows.length > 0) return res.json({ seats: existing.rows });

    const rowsLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const values = [];
    const params = [];
    let i = 1;
    for (let row = 1; row <= 20; row++) {
      for (const letter of rowsLetters) {
        params.push(flightId, `${row}${letter}`, row <= 3 ? 'business' : 'economy');
        values.push(`($${i++}, $${i++}, $${i++})`);
      }
    }
    const inserted = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class) VALUES ${values.join(',')}
       RETURNING id, seat_number, class, is_booked`,
      params
    );
    res.json({ seats: inserted.rows });
  } catch (err) {
    console.error('get seats error:', err.message);
    res.status(500).json({ error: 'Could not load seats' });
  }
});

// POST /bookings — any authenticated user books for themselves. Wraps
// booking + seat lock + optional assistance request in one transaction:
// a seat marked booked with no booking row (or vice versa) would corrupt
// the seat map for everyone else searching that flight.
bookingsRouter.post('/', authenticate, requireRole('passenger', 'admin'), async (req, res) => {
  const { flight_id, seat_id, assistance_type, assistance_notes } = req.body;
  if (!flight_id || !seat_id) {
    return res.status(400).json({ error: 'flight_id and seat_id are required' });
  }
  if (assistance_type && !ASSISTANCE_TYPES.includes(assistance_type)) {
    return res.status(400).json({ error: `assistance_type must be one of: ${ASSISTANCE_TYPES.join(', ')}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the seat row so two simultaneous bookings can't both grab it —
    // FOR UPDATE holds the row until commit/rollback.
    const seatResult = await client.query(
      'SELECT id, is_booked FROM seat WHERE id = $1 AND flight_id = $2 FOR UPDATE',
      [seat_id, flight_id]
    );
    if (seatResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Seat not found on this flight' });
    }
    if (seatResult.rows[0].is_booked) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That seat has just been booked by someone else — pick another' });
    }

    const bookingRef = generateBookingRef();
    const bookingResult = await client.query(
      `INSERT INTO booking (user_id, flight_id, seat_id, status, booking_ref)
       VALUES ($1, $2, $3, 'confirmed', $4)
       RETURNING id, booking_ref, status, created_at`,
      [req.user.id, flight_id, seat_id, bookingRef]
    );
    const booking = bookingResult.rows[0];

    await client.query('UPDATE seat SET is_booked = true WHERE id = $1', [seat_id]);

    // Mock payment — no real payment integration, but recording a row
    // keeps the data model consistent with the schema's intent.
    await client.query(
      `INSERT INTO payment (booking_id, amount, status, method) VALUES ($1, $2, 'success', 'mock_card')`,
      [booking.id, 45 + (flight_id % 60)]
    );

    let assistance = null;
    if (assistance_type) {
      const assistResult = await client.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, $2, 'requested', $3)
         RETURNING id, type, status, notes`,
        [booking.id, assistance_type, assistance_notes || null]
      );
      assistance = assistResult.rows[0];
    }

    await client.query('COMMIT');
    res.status(201).json({ booking, assistance });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('create booking error:', err.message);
    res.status(500).json({ error: 'Could not create booking' });
  } finally {
    client.release();
  }
});

// GET /bookings/mine — the logged-in passenger's own bookings, newest first.
bookingsRouter.get('/mine', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.booking_ref, b.status, b.created_at,
              f.id AS flight_id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
              o.code AS origin_code, d.code AS dest_code,
              s.seat_number, s.class AS seat_class,
              ar.type AS assistance_type, ar.status AS assistance_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN assistance_request ar ON ar.booking_id = b.id
       WHERE b.user_id = $1
       ORDER BY f.scheduled_departure DESC`,
      [req.user.id]
    );
    res.json({ bookings: rows });
  } catch (err) {
    console.error('list my bookings error:', err.message);
    res.status(500).json({ error: 'Could not load bookings' });
  }
});

// GET /bookings/:id — full ticket detail. Owner can always view; staff
// roles can view any booking since assistance coordination needs it.
bookingsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.booking_ref, b.status, b.created_at, b.user_id,
              f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.status AS flight_status,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              g.code AS gate_code,
              s.seat_number, s.class AS seat_class,
              u.name AS passenger_name, u.email AS passenger_email,
              ar.id AS assistance_id, ar.type AS assistance_type, ar.status AS assistance_status, ar.notes AS assistance_notes
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN assistance_request ar ON ar.booking_id = b.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const booking = rows[0];
    const isOwner = req.user.id === booking.user_id;
    const isStaff = STAFF_ROLES.includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ booking });
  } catch (err) {
    console.error('get booking error:', err.message);
    res.status(500).json({ error: 'Could not fetch booking' });
  }
});

// GET /bookings/assistance/all — staff view across all bookings, for the
// Ground/Medical/Admin assistance queue.
bookingsRouter.get('/assistance/all', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ar.id, ar.type, ar.status, ar.notes,
              b.booking_ref, f.flight_number,
              u.name AS passenger_name
       FROM assistance_request ar
       JOIN booking b ON b.id = ar.booking_id
       JOIN flight f ON f.id = b.flight_id
       LEFT JOIN "user" u ON u.id = b.user_id
       ORDER BY ar.id DESC`
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error('list assistance requests error:', err.message);
    res.status(500).json({ error: 'Could not load assistance requests' });
  }
});

// PATCH /bookings/assistance/:id/status — staff update the pipeline
// (requested -> assigned -> in_progress -> completed).
bookingsRouter.patch('/assistance/:id/status', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  const { status } = req.body;
  const valid = ['requested', 'assigned', 'in_progress', 'completed'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE assistance_request SET status = $1, assigned_staff_id = $2 WHERE id = $3
       RETURNING id, status, assigned_staff_id`,
      [status, req.user.id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Assistance request not found' });
    res.json({ request: rows[0] });
  } catch (err) {
    console.error('update assistance status error:', err.message);
    res.status(500).json({ error: 'Could not update assistance request' });
  }
});

// GET /bookings — admin/ops_manager only. Every booking across every
// passenger, for the admin Bookings page (distinct from /mine, which is
// scoped to the requesting user).
bookingsRouter.get('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.booking_ref, b.status, b.created_at,
              f.flight_number, f.scheduled_departure, f.status AS flight_status,
              o.code AS origin_code, d.code AS dest_code,
              s.seat_number,
              u.name AS passenger_name, u.email AS passenger_email,
              ar.type AS assistance_type, ar.status AS assistance_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN seat s ON s.id = b.seat_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN assistance_request ar ON ar.booking_id = b.id
       ORDER BY b.created_at DESC
       LIMIT 200`
    );
    res.json({ bookings: rows });
  } catch (err) {
    console.error('list all bookings error:', err.message);
    res.status(500).json({ error: 'Could not list bookings' });
  }
});

// GET /bookings/passengers/all — admin/ops_manager only. Passenger-role
// users with a lightweight booking count, for the admin Passengers page.
bookingsRouter.get('/passengers/all', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at,
              COUNT(b.id) AS booking_count
       FROM "user" u
       LEFT JOIN booking b ON b.user_id = u.id
       WHERE u.role = 'passenger'
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json({ passengers: rows });
  } catch (err) {
    console.error('list passengers error:', err.message);
    res.status(500).json({ error: 'Could not list passengers' });
  }
});

function generateBookingRef() {
  return 'BK' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
