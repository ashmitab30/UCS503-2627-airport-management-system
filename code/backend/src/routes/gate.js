import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { verifyBookingSignature, parseVerificationInput } from '../services/qrSignService.js';
import { hasDeparted } from '../services/flightTime.js';

export const gateRouter = Router();

// POST /gate/board — staff gate boarding
gateRouter.post(
  '/board',
  authenticate,
  requireRole('ground_crew', 'ops_manager', 'admin'),
  async (req, res) => {
    let { url, booking_ref, sig } = req.body || {};

    if (url) {
      const parsed = parseVerificationInput(url);
      if (parsed.bookingRef) booking_ref = parsed.bookingRef;
      if (parsed.sig) sig = parsed.sig;
    }

    if (!booking_ref) {
      return res.status(400).json({ error: 'Booking reference or scanned URL is required' });
    }

    booking_ref = String(booking_ref).trim().toUpperCase();

    // Verify signature
    if (!sig || !verifyBookingSignature(booking_ref, sig)) {
      return res.status(400).json({ error: 'Invalid or missing boarding pass signature' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT b.id, b.booking_ref, b.status AS booking_status, b.boarding_group,
                f.id AS flight_id, f.flight_number, f.status AS flight_status,
                f.scheduled_departure, f.actual_departure,
                s.seat_number,
                COALESCE(p.name, u.name) AS passenger_name
           FROM booking b
           JOIN flight f ON f.id = b.flight_id
           LEFT JOIN seat s ON s.id = b.seat_id
           LEFT JOIN "user" u ON u.id = b.user_id
           LEFT JOIN passenger p ON p.id = b.passenger_id
          WHERE b.booking_ref = $1
          FOR UPDATE OF b`,
        [booking_ref]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Booking ${booking_ref} not found` });
      }

      const b = rows[0];

      // 1. Check if already boarded -> return 409
      if (b.booking_status === 'boarded') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Booking ${booking_ref} has already been boarded`,
          booking_ref: b.booking_ref,
          passenger_name: b.passenger_name,
          flight_number: b.flight_number,
          seat_number: b.seat_number || 'TBD',
          status: 'boarded',
        });
      }

      // 2. Flight status check
      if (b.flight_status === 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Cannot board: flight ${b.flight_number} is cancelled` });
      }

      if (hasDeparted(b)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Cannot board: flight ${b.flight_number} has already departed` });
      }

      // 3. Status must be checked_in or boarding
      if (!['checked_in', 'boarding'].includes(b.booking_status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Cannot board passenger with status '${b.booking_status}'. Passenger must be checked in first.`,
        });
      }

      // 4. Mark as boarded
      await client.query(
        `UPDATE booking SET status = 'boarded' WHERE id = $1`,
        [b.id]
      );

      await client.query('COMMIT');

      const firstName = (b.passenger_name || 'Passenger').trim().split(/\s+/)[0];

      res.json({
        success: true,
        message: 'Passenger successfully boarded',
        booking_ref: b.booking_ref,
        passenger_name: b.passenger_name,
        first_name: firstName,
        flight_number: b.flight_number,
        seat_number: b.seat_number || 'TBD',
        status: 'boarded',
        boarding_group: b.boarding_group,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('gate boarding error:', err.message);
      res.status(500).json({ error: 'Gate boarding failed' });
    } finally {
      client.release();
    }
  }
);
