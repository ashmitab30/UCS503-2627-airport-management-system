import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { gateCanHost } from '../services/sizeCompat.js';
import { computeGateWindow, checkGateConflict } from '../services/gateConflict.js';
import { suggestGate } from '../services/gateAssignment.js';
import { initTurnaroundChecklist } from '../services/turnaround.js';
import { generateSeatsForFlight } from '../services/seatService.js';
import { logFlightDelayAndCascade, IATA_REASON_CODES } from '../services/delayCascadeService.js';
import {
  ADVISORY_LOCK_DOMAINS,
  ADMIN_OPS_ROLES,
  FLIGHT_STATUSES,
  ALLOWED_STATUS_TRANSITIONS,
} from '../constants/index.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

const getIo = (req) => req?.app?.get?.('io');

export const flightsRouter = Router();

const createFlightSchema = z.object({
  flight_number: z.string().min(2).max(10),
  aircraft_type_id: z.number().int().positive(),
  origin_id: z.number().int().positive(),
  dest_id: z.number().int().positive(),
  scheduled_departure: z.string().datetime({ offset: true }).or(z.string().min(1)),
  scheduled_arrival: z.string().datetime({ offset: true }).or(z.string().min(1)),
  gate_id: z.number().int().positive().optional().nullable(),
  base_price_cents: z.number().int().positive().max(50000000).optional().default(500000),
  tail_number: z.string().trim().max(20).optional().nullable(),
}).refine(
  (data) => data.origin_id !== data.dest_id,
  { message: 'origin_id and dest_id must differ', path: ['dest_id'] }
).refine(
  (data) => new Date(data.scheduled_departure) < new Date(data.scheduled_arrival),
  { message: 'scheduled_arrival must be after scheduled_departure', path: ['scheduled_arrival'] }
);

// POST /flights — admin, ops_manager. Race-safe via pg_advisory_xact_lock on gate.
// Generates seats inside the flight-creation transaction.
flightsRouter.post(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ body: createFlightSchema }),
  async (req, res) => {
    const {
      flight_number,
      aircraft_type_id,
      origin_id,
      dest_id,
      scheduled_departure,
      scheduled_arrival,
      gate_id,
      base_price_cents,
      tail_number,
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const aircraftResult = await client.query(
        'SELECT size_class, capacity FROM aircraft_type WHERE id = $1',
        [aircraft_type_id]
      );
      if (aircraftResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'aircraft_type_id not found' });
      }
      const sizeClass = aircraftResult.rows[0].size_class;

      let resolvedGateId = gate_id || null;

      if (gate_id) {
        // Manual gate: lock gate advisory lock to prevent race condition
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          ADVISORY_LOCK_DOMAINS.GATE,
          gate_id,
        ]);

        const gateResult = await client.query(
          'SELECT id, airport_id, size_class, status FROM gate WHERE id = $1',
          [gate_id]
        );
        if (gateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'gate_id not found' });
        }
        const gate = gateResult.rows[0];
        if (gate.airport_id !== origin_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'gate_id does not belong to the origin airport' });
        }
        if (gate.status !== 'available') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Gate is currently ${gate.status}` });
        }
        if (!gateCanHost(sizeClass, gate.size_class)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `Aircraft size '${sizeClass}' is not compatible with gate size '${gate.size_class}'`,
          });
        }
        const { start, end } = computeGateWindow(scheduled_departure, sizeClass);
        const conflictResult = await checkGateConflict(gate_id, start, end, null, client);
        if (!conflictResult.ok) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: "Gate is already occupied during this flight's ground window",
            conflicts: conflictResult.conflicts,
          });
        }
      } else {
        // Auto-suggest path: iterate and lock candidate gate
        const { gate, reason } = await suggestGate(origin_id, sizeClass, scheduled_departure, null, client);
        if (!gate) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:
              reason === 'no_compatible_gate'
                ? 'No gate at the origin airport is large enough for this aircraft'
                : "All compatible gates are busy during this flight's ground window",
          });
        }
        resolvedGateId = gate.id;
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          ADVISORY_LOCK_DOMAINS.GATE,
          resolvedGateId,
        ]);
        // Re-check under lock
        const { start, end } = computeGateWindow(scheduled_departure, sizeClass);
        const doubleCheck = await checkGateConflict(resolvedGateId, start, end, null, client);
        if (!doubleCheck.ok) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: "All compatible gates are busy during this flight's ground window",
          });
        }
      }

      const { rows } = await client.query(
        `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                              scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents, tail_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8, $9)
         RETURNING id, flight_number, aircraft_type_id, origin_id, dest_id,
                   scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents, tail_number`,
        [
          flight_number,
          aircraft_type_id,
          origin_id,
          dest_id,
          scheduled_departure,
          scheduled_arrival,
          resolvedGateId,
          base_price_cents || 500000,
          tail_number ? String(tail_number).trim() : null,
        ]
      );
      const flight = rows[0];

      const checklist = await initTurnaroundChecklist(flight.id, sizeClass, client);

      // Pre-generate seats immediately inside the transaction
      await generateSeatsForFlight(flight.id, flight.aircraft_type_id, client);

      await client.query('COMMIT');

      const io = getIo(req);
      if (io) {
        io.emit('flight:created', { flight });
      }

      res.status(201).json({ flight, gate_auto_assigned: !gate_id, turnaround_checklist: checklist });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('create flight error:', err.message);
      res.status(500).json({ error: 'Could not create flight' });
    } finally {
      client.release();
    }
  }
);

const listFlightsQuerySchema = paginationQuerySchema().extend({
  status: z.string().optional(),
  origin_id: z.string().optional(),
  dest_id: z.string().optional(),
});

// GET /flights — public. Paginated.
flightsRouter.get('/', validate({ query: listFlightsQuerySchema }), async (req, res) => {
  const { status, origin_id, dest_id, limit, offset } = req.query;
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`f.status = $${params.length}`);
  }
  if (origin_id) {
    params.push(parseInt(origin_id, 10));
    conditions.push(`f.origin_id = $${params.length}`);
  }
  if (dest_id) {
    params.push(parseInt(dest_id, 10));
    conditions.push(`f.dest_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.flight_number, f.status, f.scheduled_departure, f.scheduled_arrival,
              f.estimated_departure, f.estimated_arrival, f.actual_departure, f.actual_arrival,
              f.gate_id, f.base_price_cents, f.tail_number, g.code AS gate_code, at.model AS aircraft_model, at.size_class,
              origin.code AS origin_code, origin.name AS origin_name,
              dest.code AS dest_code, dest.name AS dest_name
       FROM flight f
       JOIN aircraft_type at ON at.id = f.aircraft_type_id
       LEFT JOIN gate g ON g.id = f.gate_id
       JOIN airport origin ON origin.id = f.origin_id
       JOIN airport dest ON dest.id = f.dest_id
       ${where}
       ORDER BY f.scheduled_departure
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    res.json({ flights: rows, limit, offset });
  } catch (err) {
    console.error('list flights error:', err.message);
    res.status(500).json({ error: 'Could not list flights' });
  }
});

// GET /flights/:id — includes turnaround checklist.
flightsRouter.get('/:id', async (req, res) => {
  const flightId = parseInt(req.params.id, 10);
  if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

  try {
    const flightResult = await pool.query(
      `SELECT f.*, g.code AS gate_code, at.model AS aircraft_model, at.size_class,
              origin.code AS origin_code, origin.name AS origin_name,
              dest.code AS dest_code, dest.name AS dest_name
       FROM flight f
       JOIN aircraft_type at ON at.id = f.aircraft_type_id
       LEFT JOIN gate g ON g.id = f.gate_id
       JOIN airport origin ON origin.id = f.origin_id
       JOIN airport dest ON dest.id = f.dest_id
       WHERE f.id = $1`,
      [flightId]
    );
    if (flightResult.rows.length === 0) return res.status(404).json({ error: 'Flight not found' });

    const checklistResult = await pool.query(
      `SELECT id, step, status, assigned_team, est_duration, actual_duration
       FROM turnaround_checklist WHERE flight_id = $1
       ORDER BY id`,
      [flightId]
    );

    res.json({ flight: flightResult.rows[0], turnaround_checklist: checklistResult.rows });
  } catch (err) {
    console.error('get flight error:', err.message);
    res.status(500).json({ error: 'Could not fetch flight' });
  }
});

// PATCH /flights/:id — admin, ops_manager. Update flight fields such as tail_number.
flightsRouter.patch(
  '/:id',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

    const { tail_number } = req.body;
    try {
      const { rows } = await pool.query(
        'UPDATE flight SET tail_number = $1 WHERE id = $2 RETURNING *',
        [tail_number !== undefined ? (tail_number ? String(tail_number).trim() : null) : null, flightId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Flight not found' });
      res.json({ flight: rows[0] });
    } catch (err) {
      console.error('update flight error:', err.message);
      res.status(500).json({ error: 'Could not update flight' });
    }
  }
);

// PATCH /flights/:id/gate — admin, ops_manager. Reassign gate, race-safe via pg_advisory_xact_lock.
flightsRouter.patch(
  '/:id/gate',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    const gateId = parseInt(req.body.gate_id, 10);
    if (isNaN(flightId) || isNaN(gateId)) {
      return res.status(400).json({ error: 'flight_id and gate_id must be integers' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory lock on new gate
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        ADVISORY_LOCK_DOMAINS.GATE,
        gateId,
      ]);

      const flightResult = await client.query(
        `SELECT f.id, f.origin_id, f.scheduled_departure, at.size_class
         FROM flight f JOIN aircraft_type at ON at.id = f.aircraft_type_id
         WHERE f.id = $1`,
        [flightId]
      );
      if (flightResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Flight not found' });
      }
      const flight = flightResult.rows[0];

      const gateResult = await client.query(
        'SELECT id, airport_id, size_class, status FROM gate WHERE id = $1',
        [gateId]
      );
      if (gateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'gate_id not found' });
      }
      const gate = gateResult.rows[0];

      if (gate.airport_id !== flight.origin_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "gate_id does not belong to this flight's origin airport" });
      }
      if (!gateCanHost(flight.size_class, gate.size_class)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Aircraft size '${flight.size_class}' is not compatible with gate size '${gate.size_class}'`,
        });
      }

      const { start, end } = computeGateWindow(flight.scheduled_departure, flight.size_class);
      const conflictResult = await checkGateConflict(gateId, start, end, flight.id, client);
      if (!conflictResult.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Gate is occupied during this flight\'s ground window',
          conflicts: conflictResult.conflicts,
        });
      }

      const { rows } = await client.query(
        'UPDATE flight SET gate_id = $1 WHERE id = $2 RETURNING id, gate_id',
        [gateId, flightId]
      );

      await client.query('COMMIT');

      const io = getIo(req);
      if (io) {
        io.emit('flight:gate_reassigned', { flightId, gateId });
        io.to('ops_feed').emit('flight:gate_changed', { flightId, gateId, gateCode: gate.code });
        io.to(`flight:${flightId}`).emit('flight:gate_changed', { flightId, gateId, gateCode: gate.code });
      }

      res.json({ flight: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('reassign gate error:', err.message);
      res.status(500).json({ error: 'Could not reassign gate' });
    } finally {
      client.release();
    }
  }
);

// PATCH /flights/:id/status — admin, ops_manager. Enforces strict state machine & cancellation cascade.
flightsRouter.patch(
  '/:id/status',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });
    if (!FLIGHT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${FLIGHT_STATUSES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const flightRes = await client.query('SELECT id, status, gate_id FROM flight WHERE id = $1 FOR UPDATE', [
        flightId,
      ]);
      if (flightRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Flight not found' });
      }

      const currentStatus = flightRes.rows[0].status;
      if (currentStatus === status) {
        await client.query('ROLLBACK');
        return res.json({ flight: flightRes.rows[0], note: 'Status unchanged' });
      }

      const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowedTransitions.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Invalid transition: cannot transition flight from '${currentStatus}' to '${status}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
        });
      }

      // Execute status update
      const updateRes = await client.query(
        'UPDATE flight SET status = $1 WHERE id = $2 RETURNING id, status, gate_id',
        [status, flightId]
      );
      const updatedFlight = updateRes.rows[0];

      let cascadeReport = null;
      let cancelledBookings = { rows: [], rowCount: 0 };

      // Handle cancellation cascade
      if (status === 'cancelled') {
        // 1. Free gate assignment
        await client.query('UPDATE flight SET gate_id = NULL WHERE id = $1', [flightId]);
        updatedFlight.gate_id = null;

        // 2. Remove resource assignments
        const deletedResources = await client.query(
          'DELETE FROM resource_assignment WHERE flight_id = $1 RETURNING id',
          [flightId]
        );

        // 3. Cancel active bookings
        cancelledBookings = await client.query(
          `UPDATE booking SET status = 'cancelled'
           WHERE flight_id = $1 AND status NOT IN ('cancelled')
           RETURNING id, user_id`,
          [flightId]
        );

        // 4. Refund payments for those bookings
        const refundedPayments = await client.query(
          `UPDATE payment SET status = 'refunded'
           WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = $1)
             AND status = 'success'
           RETURNING id, booking_id, amount`,
          [flightId]
        );

        // 5. Free all seats on this flight
        await client.query('UPDATE seat SET is_booked = false WHERE flight_id = $1', [flightId]);

        cascadeReport = {
          resourcesFreed: deletedResources.rowCount,
          bookingsCancelled: cancelledBookings.rowCount,
          paymentsRefunded: refundedPayments.rowCount,
        };
      }

      await client.query('COMMIT');

      // Re-evaluate connecting passenger itineraries impacted by status change
      try {
        const { reEvaluateConnectionsForFlight } = await import('../services/connectionService.js');
        await reEvaluateConnectionsForFlight(flightId, { client: pool, io: getIo(req) });
      } catch (connErr) {
        console.error('Error re-evaluating connections after flight status change:', connErr.message);
      }

      const io = getIo(req);
      if (io) {
        io.emit('flight:status_updated', {
          flightId,
          status,
          previousStatus: currentStatus,
          cascade: cascadeReport,
        });
        if (status === 'cancelled') {
          io.emit('flight:cancelled', { flightId, cascade: cascadeReport });
          if (cascadeReport && cascadeReport.bookingsCancelled > 0) {
            for (const b of cancelledBookings.rows) {
              io.to(`user:${b.user_id}`).emit('booking:cancelled', {
                bookingId: b.id,
                flightId,
                reason: 'Flight cancelled by operations',
              });
            }
          }
        }
      }

      res.status(200).json({ flight: updatedFlight, cascade: cascadeReport });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('update flight status error:', err.message);
      res.status(500).json({ error: 'Could not update flight status' });
    } finally {
      client.release();
    }
  }
);

const delayFlightSchema = z.object({
  delay_minutes: z.number().int().positive('delay_minutes must be a positive integer'),
  reason_code: z.enum(['WX', 'TECH', 'ATC', 'LATE_INBOUND', 'GROUND', 'SEC', 'CREW']),
  notes: z.string().optional(),
});

// POST /flights/:id/delay — admin, ops_manager. Logs flight delay and triggers cascade.
flightsRouter.post(
  '/:id/delay',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ body: delayFlightSchema }),
  async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

    const { delay_minutes, reason_code, notes } = req.body;
    try {
      const result = await logFlightDelayAndCascade({
        flightId,
        delayMinutes: delay_minutes,
        reasonCode: reason_code,
        notes,
        loggedBy: req.user.id,
        io: getIo(req),
      });

      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error });
      }

      res.json(result);
    } catch (err) {
      console.error('delay flight error:', err.message);
      res.status(err.status || 500).json({ error: err.message || 'Could not log flight delay' });
    }
  }
);

// GET /flights/:id/delays — authenticated users. Returns delay audit logs for the flight.
flightsRouter.get('/:id/delays', authenticate, async (req, res) => {
  const flightId = parseInt(req.params.id, 10);
  if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.flight_id, dl.delay_minutes, dl.reason_code, dl.notes,
              dl.logged_by, dl.logged_at, dl.is_cascade, dl.caused_by_log_id,
              u.name AS logged_by_name
       FROM delay_log dl
       LEFT JOIN "user" u ON u.id = dl.logged_by
       WHERE dl.flight_id = $1
       ORDER BY dl.logged_at DESC, dl.id DESC`,
      [flightId]
    );
    res.json({ delay_logs: rows });
  } catch (err) {
    console.error('get flight delays error:', err.message);
    res.status(500).json({ error: 'Could not fetch delay logs' });
  }
});

// GET /flights/:id/boarding-queue — staff (ground_crew, ops_manager, admin).
// Lists checked-in and boarded passengers ordered by boarding group then check-in time / id.
flightsRouter.get(
  '/:id/boarding-queue',
  authenticate,
  requireRole('ground_crew', 'ops_manager', 'admin'),
  async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    if (isNaN(flightId)) return res.status(400).json({ error: 'Invalid flight ID' });

    try {
      const flightRes = await pool.query(
        `SELECT f.id, f.flight_number, f.status,
                o.code AS origin_code, d.code AS dest_code
         FROM flight f
         JOIN airport o ON o.id = f.origin_id
         JOIN airport d ON d.id = f.dest_id
         WHERE f.id = $1`,
        [flightId]
      );
      if (flightRes.rows.length === 0) {
        return res.status(404).json({ error: 'Flight not found' });
      }
      const flight = flightRes.rows[0];

      const { rows } = await pool.query(
        `SELECT b.id AS booking_id, b.booking_ref, b.status AS booking_status,
                b.boarding_group,
                (b.status = 'boarded') AS boarded,
                b.created_at,
                s.seat_number, s.class AS seat_class,
                COALESCE(p.name, u.name) AS passenger_name,
                ar.type AS assistance_type, ar.status AS assistance_status
         FROM booking b
         LEFT JOIN seat s ON s.id = b.seat_id
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN passenger p ON p.id = b.passenger_id
         LEFT JOIN assistance_request ar ON ar.booking_id = b.id AND ar.status IN ('requested', 'assigned', 'in_progress')
         WHERE b.flight_id = $1 AND b.status IN ('checked_in', 'boarded')
         ORDER BY b.boarding_group ASC NULLS LAST, b.id ASC`,
        [flightId]
      );

      res.json({
        flight,
        queue: rows,
        total: rows.length,
        boarded_count: rows.filter((r) => r.boarded).length,
      });
    } catch (err) {
      console.error('get boarding queue error:', err.message);
      res.status(500).json({ error: 'Could not load boarding queue' });
    }
  }
);
