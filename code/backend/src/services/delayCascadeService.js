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
import { reEvaluateConnectionsForFlight } from './connectionService.js';

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
    const err = new Error(`Invalid reason code: ${reasonCode}`);
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(delayMinutes) || delayMinutes <= 0) {
    const err = new Error('delayMinutes must be a positive integer');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and fetch the primary flight
    const { rows: flightRows } = await client.query(
      `SELECT id, flight_number, aircraft_type_id, gate_id, origin_id, dest_id, tail_number,
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

    // 5. Log the primary delay (populating both legacy columns minutes/timestamp and new delay_minutes/logged_at)
    const { rows: logRows } = await client.query(
      `INSERT INTO delay_log
         (flight_id, minutes, delay_minutes, reason_code, notes, logged_by, timestamp, logged_at, is_cascade)
       VALUES ($1, $2, $2, $3, $4, $5, now(), now(), FALSE)
       RETURNING id`,
      [flightId, delayMinutes, reasonCode, notes ?? null, loggedBy ?? null]
    );
    const primaryLogId = logRows[0].id;

    // 6. Find downstream flights (same aircraft rotation by tail_number OR same gate) within turnaround buffer
    const cascadeResults = [];
    const visited = new Set([flightId]);
    const queue = [
      {
        flightId,
        flightNumber: flight.flight_number,
        tailNumber: flight.tail_number,
        destId: flight.dest_id,
        gateId: flight.gate_id,
        delayMinutes,
        prevEstArr,
        newEstArr,
        causedByLogId: primaryLogId,
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      const currentWindowEnd = new Date(new Date(current.newEstArr).getTime() + TURNAROUND_BUFFER_MINUTES * 60_000);

      const { rows: downstreamFlights } = await client.query(
        `SELECT id, flight_number, tail_number, origin_id, dest_id, gate_id,
                estimated_departure, estimated_arrival, scheduled_departure, scheduled_arrival, status
           FROM flight
          WHERE id <> $1
            AND status NOT IN ('cancelled', 'landed')
            AND COALESCE(estimated_departure, scheduled_departure) >= $2
            AND COALESCE(estimated_departure, scheduled_departure) <= $3
            AND (
              ($4::varchar IS NOT NULL AND tail_number = $4 AND origin_id = $5)
              OR
              ($6::int IS NOT NULL AND gate_id = $6)
            )
          ORDER BY COALESCE(estimated_departure, scheduled_departure) ASC
          FOR UPDATE`,
        [
          current.flightId,
          current.prevEstArr,
          currentWindowEnd,
          current.tailNumber || null,
          current.destId,
          current.gateId || null,
        ]
      );

      for (const downstream of downstreamFlights) {
        if (visited.has(downstream.id)) continue;

        const dstEstDep = downstream.estimated_departure ?? downstream.scheduled_departure;
        const slack = (new Date(dstEstDep).getTime() - new Date(current.prevEstArr).getTime()) / 60_000;
        const bleedthrough = Math.round(Math.max(0, current.delayMinutes - slack));
        if (bleedthrough <= 0) continue;

        visited.add(downstream.id);

        const newDstDep = new Date(new Date(dstEstDep).getTime() + bleedthrough * 60_000);
        const dstEstArr = downstream.estimated_arrival ?? downstream.scheduled_arrival;
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
             (flight_id, minutes, delay_minutes, reason_code, notes, logged_by, timestamp, logged_at, is_cascade, caused_by_log_id)
           VALUES ($1, $2, $2, 'LATE_INBOUND', $3, $4, now(), now(), TRUE, $5)
           RETURNING id`,
          [downstream.id, bleedthrough, `Cascade from ${current.flightNumber}`, loggedBy ?? null, current.causedByLogId]
        );

        const cascadeLogId = cascadeLogRows[0].id;

        cascadeResults.push({
          flightId: downstream.id,
          flightNumber: downstream.flight_number,
          bleedthroughMinutes: bleedthrough,
          logId: cascadeLogId,
        });

        // Chain onward the same way
        queue.push({
          flightId: downstream.id,
          flightNumber: downstream.flight_number,
          tailNumber: downstream.tail_number,
          destId: downstream.dest_id,
          gateId: downstream.gate_id,
          delayMinutes: bleedthrough,
          prevEstArr: dstEstArr,
          newEstArr: newDstArr,
          causedByLogId: cascadeLogId,
        });
      }
    }

    // 7. Re-evaluate connecting passenger itineraries impacted by primary or cascaded delays
    // Collect emits during the transaction and flush only after COMMIT succeeds.
    const pendingConnectionEmits = [];
    const deferredIo = io
      ? {
          emit(event, payload) {
            pendingConnectionEmits.push({ room: null, event, payload });
          },
          to(room) {
            return {
              emit(event, payload) {
                pendingConnectionEmits.push({ room, event, payload });
              },
            };
          },
        }
      : undefined;

    const impactedFlightIds = [flightId, ...cascadeResults.map((c) => c.flightId)];
    const connectionUpdates = [];
    for (const fId of impactedFlightIds) {
      const updated = await reEvaluateConnectionsForFlight(fId, { client, io: deferredIo });
      connectionUpdates.push(...updated);
    }

    await client.query('COMMIT');

    // 8. Emit Socket.IO events after COMMIT (best-effort: do not throw if io is absent)
    if (io) {
      for (const item of pendingConnectionEmits) {
        if (item.room) {
          io.to(item.room).emit(item.event, item.payload);
        } else {
          io.emit(item.event, item.payload);
        }
      }
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

