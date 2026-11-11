import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { SEAT_CLASS_MULTIPLIERS, ASSISTANCE_TYPES } from '../constants/index.js';

/**
 * Cryptographically random booking reference generator.
 * Format: 'BK' + 6 alphanumeric characters.
 */
export function generateBookingRef() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 Crockford-like (no 0/O, 1/I confusion)
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
 * Core transactional booking execution with concurrency locks.
 */
export async function executeBooking(
  {
    userId,
    flightId,
    seatId,
    assistanceType,
    assistanceNotes,
    passengerDetails,
  },
  dbClient = null
) {
  const client = dbClient || (await pool.connect());
  const ownsClient = !dbClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    // 1. Lock the seat row FOR UPDATE to prevent race conditions
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
        error: 'That seat has just been booked by someone else — pick another',
      };
    }

    // 2. Resolve passenger record
    let passengerId = null;
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
      passengerId = pRes.rows[0].id;
    } else {
      // Default to user profile info
      const uRes = await client.query('SELECT name, email FROM "user" WHERE id = $1', [userId]);
      const user = uRes.rows[0];
      const pRes = await client.query(
        `INSERT INTO passenger (name, email)
         VALUES ($1, $2)
         RETURNING id`,
        [user.name, user.email]
      );
      passengerId = pRes.rows[0].id;
    }

    // 3. Compute deterministic fare and snapshot it
    const priceCents = calculateSeatPriceCents(seat.base_price_cents, seat.class);
    const paymentAmount = (priceCents / 100).toFixed(2);

    // 4. Generate booking reference with collision retry
    let booking = null;
    let attempts = 0;
    while (!booking && attempts < 5) {
      attempts++;
      const bookingRef = generateBookingRef();
      try {
        const bRes = await client.query(
          `INSERT INTO booking (user_id, flight_id, seat_id, passenger_id, price_cents, status, booking_ref)
           VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
           RETURNING id, booking_ref, price_cents, status, created_at`,
          [userId, flightId, seatId, passengerId, priceCents, bookingRef]
        );
        booking = bRes.rows[0];
      } catch (err) {
        if (err.code === '23505' && err.constraint === 'booking_booking_ref_key') {
          continue; // retry reference collision
        }
        throw err;
      }
    }

    if (!booking) {
      throw new Error('Failed to generate a unique booking reference after multiple attempts');
    }

    // 5. Mark seat booked
    await client.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);

    // 6. Record payment snapshot with matching price
    const payRes = await client.query(
      `INSERT INTO payment (booking_id, amount, status, method)
       VALUES ($1, $2, 'success', 'mock_card')
       RETURNING id, amount, status, method`,
      [booking.id, paymentAmount]
    );

    // 7. Record assistance request if requested
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

    return {
      ok: true,
      booking: {
        ...booking,
        amount_paid: paymentAmount,
        seat_number: seat.seat_number,
        seat_class: seat.class,
      },
      payment: payRes.rows[0],
      assistance,
    };
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}
