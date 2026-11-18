import { pool } from '../db/pool.js';
import { ADVISORY_LOCK_DOMAINS } from '../constants/index.js';
import { generateBookingRef, calculateSeatPriceCents } from './bookingService.js';

export const CONNECTION_STATUSES = ['on_track', 'at_risk', 'missed'];
export const GATE_CLOSE_MINUTES = 20;

/**
 * Validates connection geometry (inbound dest == outbound origin)
 * and calculates MCT and initial status.
 */
export async function validateAndCreateConnection({
  inboundFlightId,
  outboundFlightId,
  passengerId,
  inboundBookingId = null,
  outboundBookingId = null,
  client = pool,
} = {}) {
  if (inboundFlightId === outboundFlightId) {
    const err = new Error('Inbound and outbound flights cannot be the same');
    err.status = 400;
    throw err;
  }

  // Fetch inbound and outbound flights
  const { rows: flights } = await client.query(
    `SELECT f.id, f.dest_id, f.origin_id, f.status,
            f.scheduled_departure, f.scheduled_arrival,
            f.estimated_departure, f.estimated_arrival,
            dest.min_connection_minutes AS airport_mct
       FROM flight f
       LEFT JOIN airport dest ON dest.id = f.dest_id
      WHERE f.id IN ($1, $2)`,
    [inboundFlightId, outboundFlightId]
  );

  const inbound = flights.find((f) => f.id === inboundFlightId);
  const outbound = flights.find((f) => f.id === outboundFlightId);

  if (!inbound || !outbound) {
    const err = new Error('Inbound or outbound flight not found');
    err.status = 404;
    throw err;
  }

  // Enforce rule: inbound destination airport == outbound origin airport
  if (inbound.dest_id !== outbound.origin_id) {
    const err = new Error(
      `Invalid connection itinerary: inbound destination airport (${inbound.dest_id}) must match outbound origin airport (${outbound.origin_id})`
    );
    err.status = 400;
    throw err;
  }

  const mct = inbound.airport_mct || 60;
  const inArr = inbound.estimated_arrival ?? inbound.scheduled_arrival;
  const outDep = outbound.estimated_departure ?? outbound.scheduled_departure;
  const actualConnectionMinutes = Math.round((new Date(outDep).getTime() - new Date(inArr).getTime()) / 60_000);

  let status = 'on_track';
  if (actualConnectionMinutes < GATE_CLOSE_MINUTES) {
    status = 'missed';
  } else if (actualConnectionMinutes < mct) {
    status = 'at_risk';
  }

  const { rows: connRows } = await client.query(
    `INSERT INTO connection
       (inbound_flight_id, outbound_flight_id, passenger_id,
        min_connection_minutes, actual_connection_minutes, status,
        inbound_booking_id, outbound_booking_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      inboundFlightId,
      outboundFlightId,
      passengerId,
      mct,
      actualConnectionMinutes,
      status,
      inboundBookingId,
      outboundBookingId,
    ]
  );

  return connRows[0];
}

/**
 * Re-evaluates connection status based on current flight estimated times.
 */
export async function evaluateConnectionStatus(connectionId, { client = pool, io } = {}) {
  const { rows: conns } = await client.query(
    `SELECT c.*,
            inf.estimated_arrival AS in_est_arr, inf.scheduled_arrival AS in_sch_arr,
            inf.status AS in_status,
            outf.estimated_departure AS out_est_dep, outf.scheduled_departure AS out_sch_dep,
            outf.status AS out_status,
            hub.min_connection_minutes AS hub_mct
       FROM connection c
       JOIN flight inf ON inf.id = c.inbound_flight_id
       JOIN flight outf ON outf.id = c.outbound_flight_id
       LEFT JOIN airport hub ON hub.id = inf.dest_id
      WHERE c.id = $1`,
    [connectionId]
  );

  if (conns.length === 0) return null;
  const c = conns[0];

  const mct = c.hub_mct || c.min_connection_minutes || 60;
  const inArr = c.in_est_arr ?? c.in_sch_arr;
  const outDep = c.out_est_dep ?? c.out_sch_dep;
  const actualConnectionMinutes = Math.round((new Date(outDep).getTime() - new Date(inArr).getTime()) / 60_000);

  let newStatus = 'on_track';
  if (c.in_status === 'cancelled' || c.out_status === 'cancelled' || actualConnectionMinutes < GATE_CLOSE_MINUTES) {
    newStatus = 'missed';
  } else if (actualConnectionMinutes < mct) {
    newStatus = 'at_risk';
  }

  const prevStatus = c.status;
  const { rows: updated } = await client.query(
    `UPDATE connection
        SET actual_connection_minutes = $1,
            status = $2,
            min_connection_minutes = $3
      WHERE id = $4
      RETURNING *`,
    [actualConnectionMinutes, newStatus, mct, connectionId]
  );

  const updatedConn = updated[0];

  if (io && prevStatus !== newStatus) {
    io.to('ops_feed').emit('connection:status_changed', {
      connectionId: c.id,
      passengerId: c.passenger_id,
      previousStatus: prevStatus,
      status: newStatus,
      actualConnectionMinutes,
    });
    if (c.passenger_id) {
      io.to(`user:${c.passenger_id}`).emit('connection:status_changed', {
        connectionId: c.id,
        status: newStatus,
        actualConnectionMinutes,
      });
    }
  }

  return updatedConn;
}

/**
 * Re-evaluates all connections linked to a specific flight (as inbound or outbound).
 */
export async function reEvaluateConnectionsForFlight(flightId, { client = pool, io } = {}) {
  const { rows } = await client.query(
    `SELECT id FROM connection WHERE inbound_flight_id = $1 OR outbound_flight_id = $1`,
    [flightId]
  );

  const results = [];
  for (const r of rows) {
    const updated = await evaluateConnectionStatus(r.id, { client, io });
    if (updated) results.push(updated);
  }
  return results;
}

/**
 * Finds up to 3 viable rebooking options from hub to destination.
 * Rules:
 * - Hub airport = inbound.dest_id
 * - Destination airport = outbound.dest_id
 * - Departure >= inbound.estimated_arrival + hub.mct
 * - Excludes cancelled and arrived flights
 * - Has at least 1 available seat
 * - Pre-sorts by cabin class match and soonest estimated departure
 */
export async function getRebookingOptions(connectionId, { client = pool } = {}) {
  const { rows: conns } = await client.query(
    `SELECT c.*,
            inf.dest_id AS hub_id,
            inf.estimated_arrival AS in_est_arr,
            inf.scheduled_arrival AS in_sch_arr,
            outf.dest_id AS final_dest_id,
            hub.min_connection_minutes AS hub_mct,
            b.seat_id,
            s.class AS passenger_class
       FROM connection c
       JOIN flight inf ON inf.id = c.inbound_flight_id
       JOIN flight outf ON outf.id = c.outbound_flight_id
       LEFT JOIN airport hub ON hub.id = inf.dest_id
       LEFT JOIN booking b ON b.id = c.outbound_booking_id
       LEFT JOIN seat s ON s.id = b.seat_id
      WHERE c.id = $1`,
    [connectionId]
  );

  if (conns.length === 0) {
    const err = new Error('Connection not found');
    err.status = 404;
    throw err;
  }

  const conn = conns[0];
  const mct = conn.hub_mct || conn.min_connection_minutes || 60;
  const inArr = conn.in_est_arr ?? conn.in_sch_arr;
  const earliestDep = new Date(new Date(inArr).getTime() + mct * 60_000);
  const preferredClass = conn.passenger_class || 'economy';

  const { rows: options } = await client.query(
    `SELECT f.id, f.flight_number, f.status, f.base_price_cents,
            f.scheduled_departure, f.scheduled_arrival,
            f.estimated_departure, f.estimated_arrival,
            at.model AS aircraft_model,
            g.code AS gate_code,
            orig.code AS origin_code, dest.code AS dest_code,
            COUNT(s.id) FILTER (WHERE s.is_booked = false AND s.class = $4) AS preferred_seats_available,
            COUNT(s.id) FILTER (WHERE s.is_booked = false) AS total_seats_available
       FROM flight f
       JOIN aircraft_type at ON at.id = f.aircraft_type_id
       JOIN airport orig ON orig.id = f.origin_id
       JOIN airport dest ON dest.id = f.dest_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN seat s ON s.flight_id = f.id
      WHERE f.origin_id = $1
        AND f.dest_id = $2
        AND f.id <> $3
        AND f.status IN ('scheduled', 'delayed')
        AND COALESCE(f.estimated_departure, f.scheduled_departure) >= $5
      GROUP BY f.id, at.model, g.code, orig.code, dest.code
      HAVING COUNT(s.id) FILTER (WHERE s.is_booked = false) > 0
      ORDER BY
        (COUNT(s.id) FILTER (WHERE s.is_booked = false AND s.class = $4) > 0) DESC,
        COALESCE(f.estimated_departure, f.scheduled_departure) ASC
      LIMIT 3`,
    [conn.hub_id, conn.final_dest_id, conn.outbound_flight_id, preferredClass, earliestDep]
  );

  return {
    connectionId,
    hubAirportId: conn.hub_id,
    finalDestId: conn.final_dest_id,
    earliestViableDeparture: earliestDep,
    preferredClass,
    options,
  };
}

/**
 * Rebooks a connection to a new outbound flight and seat.
 * Atomic transaction with pg_advisory_xact_lock on new seat.
 * Cancels old outbound booking only if new seat is secured.
 * Safe against double submission.
 */
export async function rebookConnection(connectionId, { newFlightId, newSeatId, userId, io } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and load the connection record
    const { rows: conns } = await client.query(
      `SELECT c.*,
              inf.dest_id AS hub_id,
              inf.estimated_arrival AS in_est_arr,
              inf.scheduled_arrival AS in_sch_arr,
              hub.min_connection_minutes AS hub_mct
         FROM connection c
         JOIN flight inf ON inf.id = c.inbound_flight_id
         LEFT JOIN airport hub ON hub.id = inf.dest_id
        WHERE c.id = $1
        FOR UPDATE OF c`,
      [connectionId]
    );

    if (conns.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Connection not found');
      err.status = 404;
      throw err;
    }

    const conn = conns[0];

    // Check if already rebooked to this flight
    if (conn.outbound_flight_id === newFlightId) {
      await client.query('ROLLBACK');
      const err = new Error('Connection is already booked on this flight');
      err.status = 409;
      throw err;
    }

    // 2. Lock the new seat via advisory lock domain 5 (SEAT)
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ADVISORY_LOCK_DOMAINS.SEAT,
      newSeatId,
    ]);

    // 3. Verify new flight and seat
    const { rows: seatRows } = await client.query(
      `SELECT s.id, s.flight_id, s.seat_number, s.class, s.is_booked,
              f.origin_id, f.dest_id, f.status AS flight_status, f.base_price_cents,
              f.scheduled_departure, f.estimated_departure
         FROM seat s
         JOIN flight f ON f.id = s.flight_id
        WHERE s.id = $1 FOR UPDATE`,
      [newSeatId]
    );

    if (seatRows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Seat not found');
      err.status = 404;
      throw err;
    }

    const seat = seatRows[0];

    if (seat.flight_id !== newFlightId) {
      await client.query('ROLLBACK');
      const err = new Error('Seat does not belong to the selected flight');
      err.status = 400;
      throw err;
    }

    if (seat.is_booked) {
      await client.query('ROLLBACK');
      const err = new Error('Selected seat is already booked');
      err.status = 409;
      throw err;
    }

    if (!['scheduled', 'delayed'].includes(seat.flight_status)) {
      await client.query('ROLLBACK');
      const err = new Error(`Cannot rebook onto flight with status '${seat.flight_status}'`);
      err.status = 409;
      throw err;
    }

    // Verify departure is from the hub airport
    if (seat.origin_id !== conn.hub_id) {
      await client.query('ROLLBACK');
      const err = new Error('New flight must depart from the transit hub airport');
      err.status = 400;
      throw err;
    }

    // 4. Cancel old outbound booking and free its seat if exists
    if (conn.outbound_booking_id) {
      const { rows: oldBooking } = await client.query(
        `UPDATE booking
            SET status = 'cancelled'
          WHERE id = $1
          RETURNING seat_id`,
        [conn.outbound_booking_id]
      );
      if (oldBooking.length > 0 && oldBooking[0].seat_id) {
        await client.query('UPDATE seat SET is_booked = false WHERE id = $1', [oldBooking[0].seat_id]);
      }
    }

    // 5. Create new booking for the rebooked flight
    const bookingRef = generateBookingRef();
    const priceCents = calculateSeatPriceCents(seat.base_price_cents, seat.class);
    const resolvedUserId = userId || conn.passenger_id;

    const { rows: newBookings } = await client.query(
      `INSERT INTO booking
         (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
       RETURNING *`,
      [bookingRef, resolvedUserId, conn.passenger_id, newFlightId, newSeatId, priceCents]
    );
    const newBooking = newBookings[0];

    // Create payment record snapshot for zero-fee IRROPS rebooking
    await client.query(
      `INSERT INTO payment (booking_id, amount, status)
       VALUES ($1, 0, 'success')`,
      [newBooking.id]
    );

    // 6. Mark new seat as booked
    await client.query('UPDATE seat SET is_booked = true WHERE id = $1', [newSeatId]);

    // 7. Update connection record with new outbound flight and recalculate status
    const inArr = conn.in_est_arr ?? conn.in_sch_arr;
    const newOutDep = seat.estimated_departure ?? seat.scheduled_departure;
    const actualConnectionMinutes = Math.round((new Date(newOutDep).getTime() - new Date(inArr).getTime()) / 60_000);
    const mct = conn.hub_mct || conn.min_connection_minutes || 60;

    let updatedStatus = 'on_track';
    if (actualConnectionMinutes < GATE_CLOSE_MINUTES) {
      updatedStatus = 'missed';
    } else if (actualConnectionMinutes < mct) {
      updatedStatus = 'at_risk';
    }

    const { rows: updatedConnRows } = await client.query(
      `UPDATE connection
          SET outbound_flight_id = $1,
              outbound_booking_id = $2,
              actual_connection_minutes = $3,
              status = $4
        WHERE id = $5
        RETURNING *`,
      [newFlightId, newBooking.id, actualConnectionMinutes, updatedStatus, connectionId]
    );

    await client.query('COMMIT');

    const updatedConn = updatedConnRows[0];

    if (io) {
      io.to('ops_feed').emit('connection:status_changed', {
        connectionId,
        status: updatedStatus,
        rebooked: true,
        newFlightId,
      });
      if (conn.passenger_id) {
        io.to(`user:${conn.passenger_id}`).emit('connection:status_changed', {
          connectionId,
          status: updatedStatus,
          rebooked: true,
          newFlightId,
        });
      }
    }

    return {
      ok: true,
      connection: updatedConn,
      newBooking,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
