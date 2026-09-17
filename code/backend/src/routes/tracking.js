import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

export const trackingRouter = Router();

// GET /tracking/:flightId — any authenticated user (passengers track their
// own booked flights; staff track any flight).
//
// IMPORTANT HONESTY NOTE: there is no real position feed (no ADS-B/radar
// data source in this system). Progress, "altitude" and "speed" below are
// computed/estimated from the flight's own scheduled and actual times —
// this is a reasonable simulation for a student project, not live
// aircraft telemetry. That distinction is worth calling out explicitly
// in your report rather than presenting it as real tracking data.
trackingRouter.get('/:flightId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.flight_number, f.status, f.scheduled_departure, f.scheduled_arrival,
              f.actual_departure, f.actual_arrival,
              o.code AS origin_code, o.name AS origin_name,
              d.code AS dest_code, d.name AS dest_name,
              g.code AS gate_code,
              at.model AS aircraft_model
       FROM flight f
       JOIN airport o ON o.id = f.origin_id
       JOIN airport d ON d.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       JOIN aircraft_type at ON at.id = f.aircraft_type_id
       WHERE f.id = $1`,
      [req.params.flightId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Flight not found' });

    const f = rows[0];
    const now = new Date();
    const depTime = new Date(f.actual_departure || f.scheduled_departure);
    const arrTime = new Date(f.scheduled_arrival);
    const totalMs = arrTime - depTime;
    const elapsedMs = now - depTime;

    let progressPct = 0;
    let phase = 'scheduled';
    if (['cancelled', 'diverted'].includes(f.status)) {
      phase = f.status;
    } else if (now < depTime) {
      phase = 'scheduled';
    } else if (f.status === 'landed' || now >= arrTime) {
      phase = 'landed';
      progressPct = 100;
    } else {
      phase = 'in_air';
      progressPct = Math.max(0, Math.min(100, Math.round((elapsedMs / totalMs) * 100)));
    }

    const remainingMs = Math.max(0, arrTime - now);
    const remainingMinutes = Math.round(remainingMs / 60000);

    res.json({
      flight: {
        flight_number: f.flight_number,
        status: f.status,
        origin_code: f.origin_code,
        origin_name: f.origin_name,
        dest_code: f.dest_code,
        dest_name: f.dest_name,
        gate_code: f.gate_code,
        aircraft_model: f.aircraft_model,
        scheduled_departure: f.scheduled_departure,
        scheduled_arrival: f.scheduled_arrival,
      },
      tracking: {
        phase,
        progress_pct: progressPct,
        eta_minutes: phase === 'in_air' ? remainingMinutes : null,
        // Estimated, not measured — see note above.
        estimated_altitude_ft: phase === 'in_air' ? estimateAltitude(progressPct) : null,
        estimated_speed_kmh: phase === 'in_air' ? 830 : null,
        is_estimated: true,
      },
    });
  } catch (err) {
    console.error('track flight error:', err.message);
    res.status(500).json({ error: 'Could not load tracking info' });
  }
});

function estimateAltitude(progressPct) {
  // Simple climb/cruise/descend curve: climbs for the first 15%, cruises
  // at 36,000ft through the middle, descends for the last 15%.
  if (progressPct < 15) return Math.round((progressPct / 15) * 36000);
  if (progressPct > 85) return Math.round(((100 - progressPct) / 15) * 36000);
  return 36000;
}
