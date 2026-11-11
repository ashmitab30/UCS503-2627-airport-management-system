import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { gateCanHost } from '../services/sizeCompat.js';
import { computeGateWindow, checkGateConflict } from '../services/gateConflict.js';
import { suggestGate } from '../services/gateAssignment.js';
import { initTurnaroundChecklist } from '../services/turnaround.js';
import { generateSeatsForFlight } from '../services/seatService.js';
import { io } from '../index.js';
import {
  ADVISORY_LOCK_DOMAINS,
  ADMIN_OPS_ROLES,
  FLIGHT_STATUSES,
  ALLOWED_STATUS_TRANSITIONS,
} from '../constants/index.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

export const flightsRouter = Router();

const createFlightSchema = z.object({
  flight_number: z.string().min(2).max(10),
  aircraft_type_id: z.number().int().positive(),
  origin_id: z.number().int().positive(),
  dest_id: z.number().int().positive(),
  scheduled_departure: z.string().datetime({ offset: true }).or(z.string().min(1)),
  scheduled_arrival: z.string().datetime({ offset: true }).or(z.string().min(1)),
  gate_id: z.number().int().positive().optional().nullable(),
  base_price_cents: z.number().int().positive().optional().default(5000),
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
                              scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8)
         RETURNING id, flight_number, aircraft_type_id, origin_id, dest_id,
                   scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents`,
        [
          flight_number,
          aircraft_type_id,
          origin_id,
          dest_id,
          scheduled_departure,
          scheduled_arrival,
          resolvedGateId,
          base_price_cents || 5000,
        ]
      );
      const flight = rows[0];

      const checklist = await initTurnaroundChecklist(flight.id, sizeClass, client);

      // Pre-generate seats immediately inside the transaction
      await generateSeatsForFlight(flight.id, flight.aircraft_type_id, client);

      await client.query('COMMIT');

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
              f.gate_id, f.base_price_cents, g.code AS gate_code, at.model AS aircraft_model, at.size_class,
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

      if (io) {
        io.emit('flight:gate_reassigned', { flightId, gateId });
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
        const cancelledBookings = await client.query(
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

      if (io) {
        io.emit('flight:status_updated', {
          flightId,
          status,
          previousStatus: currentStatus,
          cascade: cascadeReport,
        });
        if (status === 'cancelled') {
          io.emit('flight:cancelled', { flightId, cascade: cascadeReport });
        }
      }

      res.json({ flight: updatedFlight, cascade: cascadeReport });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('update flight status error:', err.message);
      res.status(500).json({ error: 'Could not update flight status' });
    } finally {
      client.release();
    }
  }
);
