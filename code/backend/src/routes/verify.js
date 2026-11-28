import { Router } from 'express';
import { pool } from '../db/pool.js';
import { verifyBookingSignature } from '../services/qrSignService.js';

export const verifyRouter = Router();

function formatMaskedName(fullName) {
  if (!fullName) return 'Passenger';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0].toUpperCase() + '.';
  return `${firstName} ${lastInitial}`;
}

// GET /verify/:ref?sig=... (public verification, no login required)
verifyRouter.get('/:ref', async (req, res) => {
  const bookingRef = req.params.ref ? req.params.ref.trim().toUpperCase() : '';
  const signature = req.query.sig ? String(req.query.sig).trim() : '';

  // Generic 404 for missing/bad signature or unknown ref to prevent enumeration
  if (!bookingRef || !signature || !verifyBookingSignature(bookingRef, signature)) {
    return res.status(404).json({
      error: 'Invalid or expired verification link',
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT b.booking_ref, b.status AS booking_status,
              f.flight_number, f.scheduled_departure,
              o.code AS origin_code, o.city AS origin_city,
              d.code AS dest_code, d.city AS dest_city,
              s.seat_number, s.class AS seat_class,
              COALESCE(p.name, u.name) AS passenger_name
         FROM booking b
         JOIN flight f ON f.id = b.flight_id
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
        WHERE b.booking_ref = $1`,
      [bookingRef]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Invalid or expired verification link',
      });
    }

    const b = rows[0];

    // Return limited details only — no email, no user id, no sensitive personal data
    res.json({
      valid: true,
      booking_ref: b.booking_ref,
      passenger_name: formatMaskedName(b.passenger_name),
      flight_number: b.flight_number,
      route: `${b.origin_code} → ${b.dest_code}`,
      origin: b.origin_code,
      destination: b.dest_code,
      origin_city: b.origin_city,
      dest_city: b.dest_city,
      departure_date: b.scheduled_departure,
      seat_number: b.seat_number || 'TBD',
      seat_class: (b.seat_class || 'economy').toUpperCase(),
      booking_status: b.booking_status,
    });
  } catch (err) {
    console.error('verify booking error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});
