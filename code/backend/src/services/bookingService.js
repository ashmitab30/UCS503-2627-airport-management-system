import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { SEAT_CLASS_MULTIPLIERS, ASSISTANCE_TYPES } from '../constants/index.js';

export const HOLD_EXPIRY_MINUTES = 10;

/**
 * Cryptographically random booking reference generator.
 * Format: 'BK' + 6 alphanumeric characters.
 */
export function generateBookingRef() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  let ref = 'BK';
  for (let i = 0; i < 6; i++) {
    ref += chars[bytes[i] % chars.length];
  }
  return ref;
}

/**
 * Calculates final price in cents for a given base price and seat class.
 */
export function calculateSeatPriceCents(basePriceCents, seatClass) {
  const multiplier = SEAT_CLASS_MULTIPLIERS[seatClass] ?? 1.0;
  return Math.round(basePriceCents * multiplier);
}

/**
 * Releases any expired seat holds (held_until < now()).
 */
export async function cleanupExpiredHolds(dbClient = pool) {
  const { rows: expiredBookings } = await dbClient.query(
    `UPDATE booking
     SET status = 'cancelled'
     WHERE status = 'held' AND held_until < now()
     RETURNING id, seat_id, flight_id`
  );

  if (expiredBookings.length > 0) {
    const seatIds = expiredBookings.map((b) => b.seat_id).filter(Boolean);
    if (seatIds.length > 0) {
      await dbClient.query(
        `UPDATE seat SET is_booked = false
         WHERE id = ANY($1::int[])
           AND NOT EXISTS (
             SELECT 1 FROM booking
             WHERE seat_id = seat.id
               AND (status IN ('confirmed', 'checked_in', 'boarded')
                    OR (status = 'held' AND held_until >= now()))
           )`,
        [seatIds]
      );
    }
  }

  return expiredBookings.length;
}

/**
 * Helper to resolve or create a passenger record.
 */
async function resolvePassengerId(client, userId, passengerDetails) {
  if (passengerDetails && passengerDetails.name && passengerDetails.email) {
    const pRes = await client.query(
      `INSERT INTO passenger (name, email, phone, passport_number, nationality, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        passengerDetails.name,
        passengerDetails.email,
        passengerDetails.phone || null,
        passengerDetails.passport_number || null,
        passengerDetails.nationality || null,
        passengerDetails.date_of_birth || null,
      ]
    );
    return pRes.rows[0].id;
  }

  const uRes = await client.query('SELECT name, email FROM "user" WHERE id = $1', [userId]);
  const user = uRes.rows[0];
  const pRes = await client.query(
    `INSERT INTO passenger (name, email)
     VALUES ($1, $2)
     RETURNING id`,
    [user.name, user.email]
  );
  return pRes.rows[0].id;
}

/**
 * STEP 1: Hold a seat with a timed expiration (e.g. 10 minutes).
 */
export async function holdSeat(
  { userId, flightId, seatId, assistanceType, assistanceNotes, passengerDetails },
  dbClient = null
) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    // Clean up expired holds first
    await cleanupExpiredHolds(client);

    // Lock seat row FOR UPDATE
    const seatResult = await client.query(
      `SELECT s.id, s.seat_number, s.class, s.is_booked,
              f.id AS flight_id, f.base_price_cents, f.status AS flight_status
       FROM seat s
       JOIN flight f ON f.id = s.flight_id
       WHERE s.id = $1 AND s.flight_id = $2
       FOR UPDATE`,
      [seatId, flightId]
    );

    if (seatResult.rows.length === 0) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Seat not found on this flight' };
    }

    const seat = seatResult.rows[0];

    if (seat.flight_status === 'cancelled') {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'This flight is cancelled and cannot be booked' };
    }

    if (seat.is_booked) {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: 'That seat is already reserved or booked by someone else — pick another',
      };
    }

    const passengerId = await resolvePassengerId(client, userId, passengerDetails);
    const priceCents = calculateSeatPriceCents(seat.base_price_cents, seat.class);
    const bookingRef = generateBookingRef();

    // Insert booking in 'held' state with held_until = now() + 10 minutes
    const bRes = await client.query(
      `INSERT INTO booking (user_id, flight_id, seat_id, passenger_id, price_cents, status, booking_ref, held_until)
       VALUES ($1, $2, $3, $4, $5, 'held', $6, now() + INTERVAL '${HOLD_EXPIRY_MINUTES} minutes')
       RETURNING id, booking_ref, price_cents, status, held_until, created_at`,
      [userId, flightId, seatId, passengerId, priceCents, bookingRef]
    );
    const booking = bRes.rows[0];

    // Mark seat as booked (temporarily locked for hold duration)
    await client.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);

    // Record pending payment row
    await client.query(
      `INSERT INTO payment (booking_id, amount, status, method)
       VALUES ($1, $2, 'pending', 'mock_card')`,
      [booking.id, (priceCents / 100).toFixed(2)]
    );

    let assistance = null;
    if (assistanceType && ASSISTANCE_TYPES.includes(assistanceType)) {
      const aRes = await client.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, $2, 'requested', $3)
         RETURNING id, type, status, notes`,
        [booking.id, assistanceType, assistanceNotes || null]
      );
      assistance = aRes.rows[0];
    }

    if (ownsClient) await client.query('COMMIT');

    const heldUntilDate = new Date(booking.held_until);
    const remainingSeconds = Math.max(0, Math.floor((heldUntilDate.getTime() - Date.now()) / 1000));

    return {
      ok: true,
      booking: {
        ...booking,
        seat_number: seat.seat_number,
        seat_class: seat.class,
        remaining_seconds: remainingSeconds,
      },
      assistance,
    };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * STEP 2: Confirm a held seat with mock payment.
 */
export async function confirmHeldBooking({ bookingId, userId, paymentMethod = 'mock_card' }, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.flight_id, b.seat_id, b.status, b.held_until, b.price_cents, b.booking_ref,
              f.scheduled_departure, f.status AS flight_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (bRes.rows.length === 0) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Booking not found' };
    }

    const booking = bRes.rows[0];
    if (booking.user_id !== userId) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (booking.status === 'confirmed') {
      if (ownsClient) await client.query('COMMIT');
      return { ok: true, booking, note: 'Already confirmed' };
    }

    if (booking.status !== 'held') {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: `Cannot confirm booking in '${booking.status}' status` };
    }

    // Check expiration
    if (booking.held_until && new Date(booking.held_until) < new Date()) {
      await client.query("UPDATE booking SET status = 'cancelled' WHERE id = $1", [bookingId]);
      await client.query('UPDATE seat SET is_booked = false WHERE id = $1', [booking.seat_id]);
      await client.query("UPDATE payment SET status = 'failed' WHERE booking_id = $1", [bookingId]);
      if (ownsClient) await client.query('COMMIT');
      return {
        ok: false,
        status: 410,
        error: 'Seat hold has expired. Please select a seat again.',
      };
    }

    // Confirm booking
    const updateRes = await client.query(
      `UPDATE booking
       SET status = 'confirmed', held_until = NULL
       WHERE id = $1
       RETURNING id, booking_ref, status, price_cents, created_at`,
      [bookingId]
    );

    // Update payment to success
    await client.query(
      `UPDATE payment
       SET status = 'success', method = $1
       WHERE booking_id = $2`,
      [paymentMethod, bookingId]
    );

    if (ownsClient) await client.query('COMMIT');

    return {
      ok: true,
      booking: updateRes.rows[0],
      payment: {
        status: 'success',
        amount: (booking.price_cents / 100).toFixed(2),
        method: paymentMethod,
      },
    };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * Direct all-in-one booking execution (backward compatible with Step 0).
 */
export async function executeBooking(params, dbClient = null) {
  const holdRes = await holdSeat(params, dbClient);
  if (!holdRes.ok) return holdRes;

  const confirmRes = await confirmHeldBooking(
    { bookingId: holdRes.booking.id, userId: params.userId },
    dbClient
  );
  if (!confirmRes.ok) return confirmRes;

  return {
    ok: true,
    booking: {
      ...holdRes.booking,
      status: 'confirmed',
      amount_paid: (holdRes.booking.price_cents / 100).toFixed(2),
    },
    payment: confirmRes.payment,
    assistance: holdRes.assistance,
  };
}

/**
 * Web Check-in: validates check-in window (within 24h of departure), transitions status to 'checked_in'.
 */
export async function checkInBooking({ bookingId, userId, seatId = null }, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.flight_id, b.seat_id, b.status, b.booking_ref,
              f.scheduled_departure, f.status AS flight_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (bRes.rows.length === 0) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Booking not found' };
    }

    const b = bRes.rows[0];
    if (b.user_id !== userId) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (b.status === 'checked_in' || b.status === 'boarded') {
      if (ownsClient) await client.query('COMMIT');
      return { ok: true, booking: b, note: 'Already checked in' };
    }

    if (b.status !== 'confirmed') {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: `Cannot check in booking with status '${b.status}'` };
    }

    if (b.flight_status === 'cancelled') {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Flight is cancelled' };
    }

    // Window check: within 24 hours of scheduled departure and before departure
    const now = Date.now();
    const depTime = new Date(b.scheduled_departure).getTime();
    const diffHours = (depTime - now) / (1000 * 3600);

    if (diffHours > 24) {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        error: 'Web check-in opens 24 hours before scheduled departure',
      };
    }

    if (diffHours < -1) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Flight has already departed' };
    }

    let finalSeatId = b.seat_id;

    // Optional seat change during check-in
    if (seatId && seatId !== b.seat_id) {
      const seatCheck = await client.query(
        'SELECT id, is_booked FROM seat WHERE id = $1 AND flight_id = $2 FOR UPDATE',
        [seatId, b.flight_id]
      );
      if (seatCheck.rows.length === 0 || seatCheck.rows[0].is_booked) {
        if (ownsClient) await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'Requested seat is not available' };
      }
      // Release old seat
      await client.query('UPDATE seat SET is_booked = false WHERE id = $1', [b.seat_id]);
      // Grab new seat
      await client.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);
      finalSeatId = seatId;
    }

    const updateRes = await client.query(
      `UPDATE booking
       SET status = 'checked_in', seat_id = $1
       WHERE id = $2
       RETURNING id, booking_ref, status, seat_id`,
      [finalSeatId, bookingId]
    );

    if (ownsClient) await client.query('COMMIT');

    return { ok: true, booking: updateRes.rows[0] };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * Passenger or Admin cancellation & automated refund.
 */
export async function cancelBooking({ bookingId, userId, isAdmin = false }, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.flight_id, b.seat_id, b.status, b.price_cents,
              f.scheduled_departure, f.status AS flight_status
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (bRes.rows.length === 0) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Booking not found' };
    }

    const b = bRes.rows[0];

    if (!isAdmin && b.user_id !== userId) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (b.status === 'cancelled') {
      if (ownsClient) await client.query('COMMIT');
      return { ok: true, booking: b, note: 'Already cancelled' };
    }

    if (b.status === 'boarded' || b.status === 'no_show') {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: `Cannot cancel booking with status '${b.status}'` };
    }

    // If passenger cancellation, must be > 2 hours before departure
    if (!isAdmin) {
      const now = Date.now();
      const depTime = new Date(b.scheduled_departure).getTime();
      const hoursToDep = (depTime - now) / (1000 * 3600);
      if (hoursToDep < 2) {
        if (ownsClient) await client.query('ROLLBACK');
        return {
          ok: false,
          status: 400,
          error: 'Cancellations within 2 hours of departure require Airport Operations assistance',
        };
      }
    }

    // Cancel booking & release seat
    const updateRes = await client.query(
      "UPDATE booking SET status = 'cancelled' WHERE id = $1 RETURNING id, booking_ref, status",
      [bookingId]
    );

    if (b.seat_id) {
      await client.query('UPDATE seat SET is_booked = false WHERE id = $1', [b.seat_id]);
    }

    // Refund payment
    const payRes = await client.query(
      `UPDATE payment
       SET status = 'refunded'
       WHERE booking_id = $1 AND status = 'success'
       RETURNING id, amount, status`,
      [bookingId]
    );

    if (ownsClient) await client.query('COMMIT');

    return {
      ok: true,
      booking: updateRes.rows[0],
      refund: payRes.rows[0] || null,
    };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * Flag all unboarded passengers on departed flights as 'no_show'.
 */
export async function flagNoShowsForFlight({ flightId }, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE booking
       SET status = 'no_show'
       WHERE flight_id = $1 AND status IN ('confirmed', 'checked_in')
       RETURNING id, booking_ref, status`,
      [flightId]
    );

    if (ownsClient) await client.query('COMMIT');
    return { ok: true, flagged_count: rows.length, bookings: rows };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}
