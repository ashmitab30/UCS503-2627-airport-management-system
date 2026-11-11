/**
 * delayCascadeService.js
 *
 * Logs a flight delay and cascades it forward to downstream flights that share
 * the same aircraft or gate within their turnaround window.
 *
 * Cascade formula:
 *   For each downstream flight whose estimated_departure falls within
 *   [inbound.estimated_arrival, inbound.estimated_arrival + turnaround_buffer]:
 *     slack = downstream.estimated_departure - inbound.estimated_arrival
 *     extra = delay_minutes - slack   (how much of the delay bleeds through)
 *     if extra > 0: shift downstream by extra minutes, log LATE_INBOUND
 *
 * Turnaround buffer (time the aircraft must have on ground): 90 minutes.
 * This is an engineering constant; not user-configurable in this phase.
 */

import { pool } from '../db/pool.js';
import { FLIGHT_STATUS_TRANSITIONS } from '../constants/index.js';

export const IATA_REASON_CODES = ['WX', 'TECH', 'ATC', 'LATE_INBOUND', 'GROUND', 'SEC', 'CREW'];
const TURNAROUND_BUFFER_MINUTES = 90;

/**
 * @param {object} opts
 * @param {number}  opts.flightId       — flight being delayed
 * @param {number}  opts.delayMinutes   — positive integer minutes of delay
 * @param {string}  opts.reasonCode     — one of IATA_REASON_CODES
 * @param {string}  [opts.notes]        — optional free-text note
 * @param {number}  [opts.loggedBy]     — user id of the ops manager logging this
 * @param {object}  [opts.io]           — socket.io server instance for broadcasts
 * @returns {{ primaryLog, cascadeResults }}
 */
export async function logFlightDelayAndCascade({ flightId, delayMinutes, reasonCode, notes, loggedBy, io } = {}) {
  if (!IATA_REASON_CODES.includes(reasonCode)) {
    throw new Object.assign(new Error(`Invalid reason code: ${reasonCode}`), { status: 400 });
  }
  if (!Number.isInteger(delayMinutes) || delayMinutes <= 0) {
    throw new Object.assign(new Error('delayMinutes must be a positive integer'), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and fetch the primary flight
    const { rows: flightRows } = await client.query(
      `SELECT id, flight_number, aircraft_type_id, gate_id,
              status, scheduled_departure, scheduled_arrival,
              estimated_departure, estimated_arrival
         FROM flight WHERE id = $1 FOR UPDATE`,
      [flightId]
    );
    if (flightRows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Flight not found' };
    }
    const flight = flightRows[0];

    // 2. Validate status allows delay
    const allowedStatuses = ['scheduled', 'delayed', 'boarding'];
    if (!allowedStatuses.includes(flight.status)) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `Cannot delay a flight with status '${flight.status}'` };
    }

    // 3. Compute new estimated times for primary flight
    const prevEstDep = flight.estimated_departure ?? flight.scheduled_departure;
    const prevEstArr = flight.estimated_arrival ?? flight.scheduled_arrival;
    const newEstDep = new Date(new Date(prevEstDep).getTime() + delayMinutes * 60_000);
    const newEstArr = new Date(new Date(prevEstArr).getTime() + delayMinutes * 60_000);

    // 4. Update primary flight status to 'delayed'
    await client.query(
      `UPDATE flight
          SET status = 'delayed',
              estimated_departure = $1,
              estimated_arrival   = $2
        WHERE id = $3`,
      [newEstDep, newEstArr, flightId]
    );

    // 5. Log the primary delay
    const { rows: logRows } = await client.query(
      `INSERT INTO delay_log
         (flight_id, delay_minutes, reason_code, notes, logged_by, logged_at, is_cascade)
       VALUES ($1, $2, $3, $4, $5, now(), FALSE)
       RETURNING id`,
      [flightId, delayMinutes, reasonCode, notes ?? null, loggedBy ?? null]
    );
    const primaryLogId = logRows[0].id;

    // 6. Find downstream flights (same aircraft OR same gate) within the turnaround window
    const windowEnd = new Date(newEstArr.getTime() + TURNAROUND_BUFFER_MINUTES * 60_000);
    const { rows: downstreamFlights } = await client.query(
      `SELECT id, flight_number, estimated_departure, estimated_arrival, status
         FROM flight
        WHERE id <> $1
          AND status NOT IN ('cancelled', 'arrived')
          AND estimated_departure > $2
          AND estimated_departure < $3
          AND (aircraft_type_id = $4 OR gate_id = $5)
        ORDER BY estimated_departure ASC
        FOR UPDATE`,
      [flightId, newEstArr, windowEnd, flight.aircraft_type_id, flight.gate_id]
    );

    const cascadeResults = [];

    for (const downstream of downstreamFlights) {
      const dstEstDep = downstream.estimated_departure ?? downstream.scheduled_departure;
      const slack = (new Date(dstEstDep).getTime() - newEstArr.getTime()) / 60_000; // minutes
      const bleedthrough = Math.max(0, delayMinutes - slack);
      if (bleedthrough <= 0) continue;

      const newDstDep = new Date(new Date(dstEstDep).getTime() + bleedthrough * 60_000);
      const dstEstArr = downstream.estimated_arrival;
      const newDstArr = new Date(new Date(dstEstArr).getTime() + bleedthrough * 60_000);

      await client.query(
        `UPDATE flight
            SET status = 'delayed',
                estimated_departure = $1,
                estimated_arrival   = $2
          WHERE id = $3`,
        [newDstDep, newDstArr, downstream.id]
      );

      const { rows: cascadeLogRows } = await client.query(
        `INSERT INTO delay_log
           (flight_id, delay_minutes, reason_code, notes, logged_by, logged_at, is_cascade, caused_by_log_id)
         VALUES ($1, $2, 'LATE_INBOUND', $3, $4, now(), TRUE, $5)
         RETURNING id`,
        [downstream.id, bleedthrough, `Cascade from ${flight.flight_number}`, loggedBy ?? null, primaryLogId]
      );

      cascadeResults.push({
        flightId: downstream.id,
        flightNumber: downstream.flight_number,
        bleedthroughMinutes: bleedthrough,
        logId: cascadeLogRows[0].id,
      });
    }

    await client.query('COMMIT');

    // 7. Emit Socket.IO events (best-effort: do not throw if io is absent)
    if (io) {
      io.to('ops_feed').emit('flight:delayed', {
        flightId,
        flightNumber: flight.flight_number,
        delayMinutes,
        reasonCode,
        newEstimatedDeparture: newEstDep,
      });
      io.to(`flight:${flightId}`).emit('flight:delayed', {
        flightId,
        delayMinutes,
        reasonCode,
        newEstimatedDeparture: newEstDep,
      });
      for (const cascade of cascadeResults) {
        io.to('ops_feed').emit('delay:cascade', cascade);
        io.to(`flight:${cascade.flightId}`).emit('delay:cascade', cascade);
      }
    }

    return {
      ok: true,
      primaryLog: { id: primaryLogId, flightId, delayMinutes, reasonCode },
      cascadeResults,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates turnaround step timestamps when status changes.
 * - in_progress → sets started_at = now()
 * - done        → sets completed_at = now(), computes actual_duration_seconds
 *
 * Returns updated row or null if not found.
 */
export async function updateTurnaroundStepTiming(stepId, newStatus, client = pool) {
  if (newStatus === 'in_progress') {
    const { rows } = await client.query(
      `UPDATE turnaround_checklist
          SET status = $1, started_at = now()
        WHERE id = $2
        RETURNING *`,
      ['in_progress', stepId]
    );
    return rows[0] ?? null;
  }

  if (newStatus === 'done') {
    const { rows } = await client.query(
      `UPDATE turnaround_checklist
          SET status = 'done',
              completed_at = now(),
              actual_duration_seconds =
                CASE
                  WHEN started_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                  ELSE NULL
                END
        WHERE id = $1
        RETURNING *`,
      [stepId]
    );
    return rows[0] ?? null;
  }

  // Other status transitions just update status
  const { rows } = await client.query(
    `UPDATE turnaround_checklist SET status = $1 WHERE id = $2 RETURNING *`,
    [newStatus, stepId]
  );
  return rows[0] ?? null;
}

