import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { SEAT_CLASS_MULTIPLIERS, ASSISTANCE_TYPES, ADMIN_OPS_ROLES, BOARDING_GROUPS, ADVISORY_LOCK_DOMAINS } from '../constants/index.js';
import { hasDeparted } from './flightTime.js';

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
 * Searches flights with origin/destination/date/class filters,
 * automatically excluding past, cancelled, departed, and landed flights
 * unless includePast=true is requested by an admin/ops_manager role.
 */
export async function searchFlights(
  { origin, destination, date, class: seatClass, limit = 50, offset = 0, includePast = false, userRole = 'passenger' } = {},
  dbClient = pool
) {
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

  const canIncludePast = includePast === true && ADMIN_OPS_ROLES.includes(userRole);
  if (canIncludePast) {
    conditions.push(`f.status <> 'cancelled'`);
  } else {
    conditions.push(`f.scheduled_departure > now()`);
    conditions.push(`f.status NOT IN ('cancelled', 'departed', 'landed')`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const { rows } = await dbClient.query(
    `SELECT f.id, f.flight_number, f.scheduled_departure, f.scheduled_arrival, f.actual_departure, f.status,
            f.base_price_cents,
            o.code AS origin_code, o.name AS origin_name,
            d.code AS dest_code, d.name AS dest_name,
            at.model AS aircraft_model, at.size_class,
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

  const formatted = rows.map((flight) => {
    const targetClass = seatClass || 'economy';
    const priceCents = calculateSeatPriceCents(flight.base_price_cents, targetClass);
    return {
      ...flight,
      has_departed: hasDeparted(flight),
      selected_class: targetClass,
      fare_cents: priceCents,
      fare_formatted: (priceCents / 100).toFixed(2),
    };
  });

  return { flights: formatted, limit, offset };
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
 * Ensures the user has no duplicate or time-conflicting active booking
 * for the target flight. Must be called inside a transaction holding
 * pg_advisory_xact_lock(ADVISORY_LOCK_DOMAINS.PASSENGER_BOOKING, userId).
 *
 * @param {import('pg').PoolClient} client
 * @param {number} userId
 * @param {number} flightId
 * @param {number|null} [excludeBookingId=null] - Booking ID to exclude (when confirming an existing hold)
 * @returns {Promise<{ ok: true } | { ok: false, status: number, code?: string, error: string, conflicting_flight_number?: string }>}
 */
export async function assertNoPassengerConflict(client, userId, flightId, excludeBookingId = null) {
  const targetRes = await client.query(
    `SELECT f.id, f.flight_number, f.origin_id, f.dest_id,
            f.scheduled_departure, f.scheduled_arrival,
            f.estimated_departure, f.estimated_arrival,
            COALESCE(orig.min_connection_minutes, 60) AS origin_mct,
            COALESCE(dest.min_connection_minutes, 60) AS dest_mct
     FROM flight f
     LEFT JOIN airport orig ON orig.id = f.origin_id
     LEFT JOIN airport dest ON dest.id = f.dest_id
     WHERE f.id = $1`,
    [flightId]
  );

  if (targetRes.rows.length === 0) {
    return { ok: false, status: 404, error: 'Flight not found' };
  }

  const target = targetRes.rows[0];
  const targetDep = new Date(target.estimated_departure ?? target.scheduled_departure).getTime();
  const targetArr = new Date(target.estimated_arrival ?? target.scheduled_arrival).getTime();

  const activeRes = await client.query(
    `SELECT b.id AS booking_id, b.flight_id, b.status AS booking_status,
            f.flight_number, f.origin_id, f.dest_id,
            f.scheduled_departure, f.scheduled_arrival,
            f.estimated_departure, f.estimated_arrival,
            COALESCE(dest.min_connection_minutes, 60) AS dest_mct
     FROM booking b
     JOIN flight f ON f.id = b.flight_id
     LEFT JOIN airport dest ON dest.id = f.dest_id
     WHERE b.user_id = $1
       AND ($2::int IS NULL OR b.id <> $2)
       AND (
         b.status IN ('confirmed', 'checked_in', 'boarded')
         OR (b.status = 'held' AND (b.held_until IS NULL OR b.held_until >= now()))
       )`,
    [userId, excludeBookingId]
  );

  const duplicate = activeRes.rows.find((b) => b.flight_id === flightId);
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      code: 'DUPLICATE_BOOKING',
      error: `You already have an active booking on flight ${duplicate.flight_number}.`,
      conflicting_flight_number: duplicate.flight_number,
    };
  }

  for (const existing of activeRes.rows) {
    const exDep = new Date(existing.estimated_departure ?? existing.scheduled_departure).getTime();
    const exArr = new Date(existing.estimated_arrival ?? existing.scheduled_arrival).getTime();

    if (Number.isNaN(targetDep) || Number.isNaN(targetArr) || Number.isNaN(exDep) || Number.isNaN(exArr)) {
      continue;
    }

    // Existing flight arrives at target's origin airport (existing -> target connection)
    if (existing.dest_id === target.origin_id && exDep <= targetDep) {
      const gapMinutes = (targetDep - exArr) / 60_000;
      const mct = Number(existing.dest_mct) || 60;
      if (gapMinutes < mct) {
        return {
          ok: false,
          status: 409,
          code: 'TIME_CONFLICT',
          error: `Flight ${target.flight_number} conflicts with your booking on flight ${existing.flight_number} (minimum connection time is ${mct} minutes).`,
          conflicting_flight_number: existing.flight_number,
        };
      }
      continue;
    }

    // Target flight arrives at existing flight's origin airport (target -> existing connection)
    if (target.dest_id === existing.origin_id && targetDep <= exDep) {
      const gapMinutes = (exDep - targetArr) / 60_000;
      const mct = Number(target.dest_mct) || 60;
      if (gapMinutes < mct) {
        return {
          ok: false,
          status: 409,
          code: 'TIME_CONFLICT',
          error: `Flight ${target.flight_number} conflicts with your booking on flight ${existing.flight_number} (minimum connection time is ${mct} minutes).`,
          conflicting_flight_number: existing.flight_number,
        };
      }
      continue;
    }

    // Non-connecting flights: overlap if windows intersect
    if (exDep < targetArr && targetDep < exArr) {
      return {
        ok: false,
        status: 409,
        code: 'TIME_CONFLICT',
        error: `Flight ${target.flight_number} overlaps with your existing booking on flight ${existing.flight_number}.`,
        conflicting_flight_number: existing.flight_number,
      };
    }
  }

  return { ok: true };
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

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ADVISORY_LOCK_DOMAINS.PASSENGER_BOOKING,
      userId,
    ]);

    // Clean up expired holds first
    await cleanupExpiredHolds(client);

    // Lock seat row FOR UPDATE
    const seatResult = await client.query(
      `SELECT s.id, s.seat_number, s.class, s.is_booked,
              f.id AS flight_id, f.base_price_cents, f.status AS flight_status,
              f.scheduled_departure, f.actual_departure
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
      return {
        ok: false,
        status: 409,
        error: 'This flight is cancelled and cannot be booked',
        code: 'FLIGHT_CANCELLED',
      };
    }

    if (hasDeparted(seat)) {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: 'Flight has already departed and cannot be booked',
        code: 'FLIGHT_DEPARTED',
      };
    }

    const conflict = await assertNoPassengerConflict(client, userId, flightId);
    if (!conflict.ok) {
      if (ownsClient) await client.query('ROLLBACK');
      return conflict;
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

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ADVISORY_LOCK_DOMAINS.PASSENGER_BOOKING,
      userId,
    ]);

    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.flight_id, b.seat_id, b.status, b.held_until, b.price_cents, b.booking_ref,
              f.scheduled_departure, f.actual_departure, f.status AS flight_status
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

    if (booking.flight_status === 'cancelled') {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: 'This flight was cancelled and cannot be confirmed',
        code: 'FLIGHT_CANCELLED',
      };
    }

    if (hasDeparted(booking)) {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        error: 'Flight has already departed',
        code: 'FLIGHT_DEPARTED',
      };
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

    const conflict = await assertNoPassengerConflict(client, userId, booking.flight_id, bookingId);
    if (!conflict.ok) {
      if (ownsClient) await client.query('ROLLBACK');
      return conflict;
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
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const holdRes = await holdSeat(params, client);
    if (!holdRes.ok) {
      if (ownsClient) await client.query('ROLLBACK');
      return holdRes;
    }

    const confirmRes = await confirmHeldBooking(
      { bookingId: holdRes.booking.id, userId: params.userId },
      client
    );
    if (!confirmRes.ok) {
      if (ownsClient) await client.query('ROLLBACK');
      return confirmRes;
    }

    if (ownsClient) await client.query('COMMIT');

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
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
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
              f.scheduled_departure, f.actual_departure, f.status AS flight_status
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
      return { ok: false, status: 400, error: 'Flight is cancelled', code: 'FLIGHT_CANCELLED' };
    }

    // Departure and window check
    const now = new Date();
    if (hasDeparted(b, now)) {
      if (ownsClient) await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Flight has already departed', code: 'FLIGHT_DEPARTED' };
    }

    const depTime = new Date(b.scheduled_departure).getTime();
    const diffHours = (depTime - now.getTime()) / (1000 * 3600);

    if (diffHours > 24) {
      if (ownsClient) await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        error: 'Web check-in opens 24 hours before scheduled departure',
        code: 'CHECK_IN_NOT_OPEN',
      };
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

    // Boarding group assignment inside the existing check-in transaction:
    // Group 1 = priority boarding for passengers who have ANY assistance request that is not cancelled
    //           (requested, assigned, in_progress, completed) or who flew in business or first class;
    // Group 2 = everyone else.
    const seatClassRes = await client.query('SELECT class FROM seat WHERE id = $1', [finalSeatId]);
    const seatClass = seatClassRes.rows[0]?.class || 'economy';
    const isPremium = ['business', 'first'].includes(seatClass);

    const aRes = await client.query(
      `SELECT 1 FROM assistance_request
       WHERE booking_id = $1 AND status != 'cancelled'
       LIMIT 1`,
      [bookingId]
    );
    const hasQualifyingAssistance = aRes.rows.length > 0;

    const boardingGroup = (isPremium || hasQualifyingAssistance)
      ? BOARDING_GROUPS.PRIORITY
      : BOARDING_GROUPS.GENERAL;

    const updateRes = await client.query(
      `UPDATE booking
       SET status = 'checked_in', seat_id = $1, boarding_group = $2
       WHERE id = $3
       RETURNING id, booking_ref, status, seat_id, boarding_group`,
      [finalSeatId, boardingGroup, bookingId]
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
 * Recomputes the boarding group for a checked-in booking when an assistance request
 * is created, updated, or cancelled.
 * Group 1: Priority boarding (assistance request or business/first class)
 * Group 2: General boarding (all other passengers)
 */
export async function recomputeBoardingGroup(bookingId, dbClient = null) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;
  try {
    const bRes = await client.query(
      `SELECT b.id, b.status, s.class AS seat_class
       FROM booking b
       LEFT JOIN seat s ON s.id = b.seat_id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (bRes.rows.length === 0) return null;
    const b = bRes.rows[0];

    // Only checked_in bookings have their boarding group recomputed.
    // A booking that is already boarded keeps its group; never recompute it.
    if (b.status !== 'checked_in') {
      return null;
    }

    const isPremium = ['business', 'first'].includes(b.seat_class);

    // Group 1 if business/first OR ANY assistance request that is not cancelled
    // (requested, assigned, in_progress, completed).
    const aRes = await client.query(
      `SELECT 1 FROM assistance_request
       WHERE booking_id = $1 AND status != 'cancelled'
       LIMIT 1`,
      [bookingId]
    );
    const hasQualifyingAssistance = aRes.rows.length > 0;

    const newGroup = (isPremium || hasQualifyingAssistance)
      ? BOARDING_GROUPS.PRIORITY
      : BOARDING_GROUPS.GENERAL;

    await client.query(
      `UPDATE booking SET boarding_group = $1 WHERE id = $2`,
      [newGroup, bookingId]
    );

    return newGroup;
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
