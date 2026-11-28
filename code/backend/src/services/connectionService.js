import { pool } from '../db/pool.js';
import { ADVISORY_LOCK_DOMAINS, ADMIN_OPS_ROLES } from '../constants/index.js';
import { generateBookingRef, calculateSeatPriceCents } from './bookingService.js';
import { hasDeparted } from './flightTime.js';

export const CONNECTION_STATUSES = ['on_track', 'at_risk', 'missed'];
export const GATE_CLOSE_MINUTES = 20;

/**
 * Validates connection geometry (inbound dest == outbound origin),
 * booking status, flight times, and calculates MCT and initial status.
 */
export async function validateAndCreateConnection({
  inboundFlightId,
  outboundFlightId,
  passengerId,
  inboundBookingId = null,
  outboundBookingId = null,
  requireBookings = false,
  client = pool,
} = {}) {
  const isManagedTx = client === pool;
  const db = isManagedTx ? await pool.connect() : client;

  if (isManagedTx) {
    await db.query('BEGIN');
  }

  try {
    if (inboundFlightId === outboundFlightId) {
      const err = new Error('Inbound and outbound flights cannot be the same');
      err.status = 400;
      throw err;
    }

    // 1. Fetch inbound and outbound flights
    const { rows: flights } = await db.query(
      `SELECT f.id, f.dest_id, f.origin_id, f.status,
              f.scheduled_departure, f.scheduled_arrival,
              f.estimated_departure, f.estimated_arrival,
              f.actual_departure, f.actual_arrival,
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

    // Check departed or cancelled
    if (inbound.status === 'cancelled' || hasDeparted(inbound)) {
      const err = new Error('Inbound flight is cancelled or has already departed');
      err.status = 409;
      throw err;
    }

    if (outbound.status === 'cancelled' || hasDeparted(outbound)) {
      const err = new Error('Outbound flight is cancelled or has already departed');
      err.status = 409;
      throw err;
    }

    // 2. Enforce rule: inbound destination airport == outbound origin airport
    if (inbound.dest_id !== outbound.origin_id) {
      const err = new Error(
        `Invalid connection itinerary: inbound destination airport (${inbound.dest_id}) must match outbound origin airport (${outbound.origin_id})`
      );
      err.status = 400;
      throw err;
    }

    // 3. Outbound departure is after inbound arrival (use estimated arrival if set)
    const inArr = inbound.estimated_arrival ?? inbound.scheduled_arrival;
    const outDep = outbound.estimated_departure ?? outbound.scheduled_departure;
    const inArrTime = new Date(inArr).getTime();
    const outDepTime = new Date(outDep).getTime();

    if (isNaN(inArrTime) || isNaN(outDepTime) || outDepTime <= inArrTime) {
      const err = new Error('Outbound departure must be after inbound arrival');
      err.status = 400;
      throw err;
    }

    // 4. Bookings check
    if (requireBookings && (!inboundBookingId || !outboundBookingId)) {
      const err = new Error('Both inbound_booking_id and outbound_booking_id are required');
      err.status = 400;
      throw err;
    }

    let resolvedPassengerId = passengerId;

    if (inboundBookingId || outboundBookingId) {
      const bookingIds = [inboundBookingId, outboundBookingId].filter(Boolean);
      const { rows: bRows } = await db.query(
        'SELECT id, user_id, passenger_id, flight_id, status FROM booking WHERE id = ANY($1)',
        [bookingIds]
      );
      const bIn = bRows.find((b) => b.id === inboundBookingId);
      const bOut = bRows.find((b) => b.id === outboundBookingId);

      if (inboundBookingId && !bIn) {
        const err = new Error(`Inbound booking #${inboundBookingId} not found`);
        err.status = 404;
        throw err;
      }
      if (outboundBookingId && !bOut) {
        const err = new Error(`Outbound booking #${outboundBookingId} not found`);
        err.status = 404;
        throw err;
      }

      if (bIn && bIn.flight_id !== inboundFlightId) {
        const err = new Error(`Inbound booking #${inboundBookingId} does not match inbound flight #${inboundFlightId}`);
        err.status = 400;
        throw err;
      }
      if (bOut && bOut.flight_id !== outboundFlightId) {
        const err = new Error(`Outbound booking #${outboundBookingId} does not match outbound flight #${outboundFlightId}`);
        err.status = 400;
        throw err;
      }

      if (bIn && bOut) {
        const pIn = bIn.passenger_id ?? bIn.user_id;
        const pOut = bOut.passenger_id ?? bOut.user_id;
        if (pIn !== pOut) {
          const err = new Error('Inbound and outbound bookings must belong to the same passenger');
          err.status = 400;
          throw err;
        }
        if (bIn.status !== 'confirmed' || bOut.status !== 'confirmed') {
          const err = new Error('Both bookings must have status confirmed');
          err.status = 400;
          throw err;
        }
        resolvedPassengerId = resolvedPassengerId || bIn.user_id || bIn.passenger_id;
      }
    }

    // 5. The same connection is not created twice
    const dupQuery = `
      SELECT id FROM connection
       WHERE (inbound_flight_id = $1 AND outbound_flight_id = $2 AND passenger_id = $3)
          OR ($4::int IS NOT NULL AND $5::int IS NOT NULL AND inbound_booking_id = $4 AND outbound_booking_id = $5)
    `;
    const { rows: dupRows } = await db.query(dupQuery, [
      inboundFlightId,
      outboundFlightId,
      resolvedPassengerId,
      inboundBookingId,
      outboundBookingId,
    ]);

    if (dupRows.length > 0) {
      const err = new Error('Connection already exists for this itinerary');
      err.status = 409;
      throw err;
    }

    const mct = inbound.airport_mct || 60;
    const actualConnectionMinutes = Math.round((outDepTime - inArrTime) / 60_000);

    let status = 'on_track';
    if (actualConnectionMinutes < GATE_CLOSE_MINUTES) {
      status = 'missed';
    } else if (actualConnectionMinutes < mct) {
      status = 'at_risk';
    }

    const { rows: connRows } = await db.query(
      `INSERT INTO connection
         (inbound_flight_id, outbound_flight_id, passenger_id,
          min_connection_minutes, actual_connection_minutes, status,
          inbound_booking_id, outbound_booking_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        inboundFlightId,
        outboundFlightId,
        resolvedPassengerId,
        mct,
        actualConnectionMinutes,
        status,
        inboundBookingId,
        outboundBookingId,
      ]
    );

    if (isManagedTx) {
      await db.query('COMMIT');
    }

    return connRows[0];
  } catch (err) {
    if (isManagedTx) {
      await db.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (isManagedTx) {
      db.release();
    }
  }
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

    const updatedPayload = {
      id: c.id,
      connectionId: c.id,
      passengerId: c.passenger_id,
      previousStatus: prevStatus,
      status: newStatus,
      actualConnectionMinutes,
      actual_connection_minutes: actualConnectionMinutes,
    };
    io.to('role:ops_manager').emit('connection:updated', updatedPayload);
    if (c.passenger_id) {
      io.to(`user:${c.passenger_id}`).emit('connection:updated', updatedPayload);
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
export async function getRebookingOptions(connectionId, { client = pool, userId, userRole } = {}) {
  const { rows: conns } = await client.query(
    `SELECT c.*,
            inf.dest_id AS hub_id,
            inf.estimated_arrival AS in_est_arr,
            inf.scheduled_arrival AS in_sch_arr,
            outf.dest_id AS final_dest_id,
            hub.min_connection_minutes AS hub_mct,
            b.seat_id,
            b.price_cents AS old_price_cents,
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

  if (userRole && !ADMIN_OPS_ROLES.includes(userRole) && conn.passenger_id !== userId) {
    const err = new Error('You do not have permission to view rebooking options for this connection');
    err.status = 403;
    throw err;
  }

  const mct = conn.hub_mct || conn.min_connection_minutes || 60;
  const inArr = conn.in_est_arr ?? conn.in_sch_arr;
  const earliestDep = new Date(new Date(inArr).getTime() + mct * 60_000);
  const preferredClass = conn.passenger_class || 'economy';
  const oldFareCents = conn.old_price_cents || 0;

  const { rows: rawOptions } = await client.query(
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

  const options = rawOptions.map((opt) => {
    const newFareCents = calculateSeatPriceCents(opt.base_price_cents, preferredClass);
    const fareDiffCents = newFareCents - oldFareCents;
    return {
      ...opt,
      old_fare_cents: oldFareCents,
      new_fare_cents: newFareCents,
      fare_difference_cents: fareDiffCents,
    };
  });

  return {
    connectionId,
    hubAirportId: conn.hub_id,
    finalDestId: conn.final_dest_id,
    earliestViableDeparture: earliestDep,
    preferredClass,
    old_fare_cents: oldFareCents,
    options,
  };
}

/**
 * Rebooks a connection to a new outbound flight and seat.
 * Atomic transaction with pg_advisory_xact_lock on new seat.
 * Cancels old outbound booking only if new seat is secured.
 * Safe against double submission.
 */
export async function rebookConnection(connectionId, { newFlightId, newSeatId, userId, userRole, io } = {}) {
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

    // Authorization check: if role is neither admin nor ops_manager, user must own the connection
    if (userRole && !ADMIN_OPS_ROLES.includes(userRole) && conn.passenger_id !== userId) {
      await client.query('ROLLBACK');
      const err = new Error('You do not have permission to rebook this connection');
      err.status = 403;
      throw err;
    }

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
    let oldBookingPassengerId = null;
    let oldBookingUserId = null;
    let oldFareCents = 0;
    if (conn.outbound_booking_id) {
      const { rows: oldBooking } = await client.query(
        `UPDATE booking
            SET status = 'cancelled'
          WHERE id = $1
          RETURNING seat_id, passenger_id, user_id, price_cents`,
        [conn.outbound_booking_id]
      );
      if (oldBooking.length > 0) {
        if (oldBooking[0].seat_id) {
          await client.query('UPDATE seat SET is_booked = false WHERE id = $1', [oldBooking[0].seat_id]);
        }
        oldBookingPassengerId = oldBooking[0].passenger_id;
        oldBookingUserId = oldBooking[0].user_id;
        oldFareCents = oldBooking[0].price_cents || 0;
      }
    }

    if (!oldBookingPassengerId && conn.inbound_booking_id) {
      const { rows: inB } = await client.query(
        'SELECT passenger_id, user_id FROM booking WHERE id = $1',
        [conn.inbound_booking_id]
      );
      if (inB.length > 0) {
        oldBookingPassengerId = inB[0].passenger_id;
        if (!oldBookingUserId) oldBookingUserId = inB[0].user_id;
      }
    }

    // 5. Create new booking for the rebooked flight
    const bookingRef = generateBookingRef();
    const newFareCents = calculateSeatPriceCents(seat.base_price_cents, seat.class);
    const diffCents = newFareCents - oldFareCents;
    const resolvedUserId = userId || oldBookingUserId || conn.passenger_id;

    let resolvedPassengerId = oldBookingPassengerId;
    if (!resolvedPassengerId) {
      const uRes = await client.query('SELECT name, email FROM "user" WHERE id = $1', [resolvedUserId]);
      if (uRes.rows.length > 0) {
        const pRes = await client.query(
          'INSERT INTO passenger (name, email) VALUES ($1, $2) RETURNING id',
          [uRes.rows[0].name, uRes.rows[0].email]
        );
        resolvedPassengerId = pRes.rows[0].id;
      }
    }

    const { rows: newBookings } = await client.query(
      `INSERT INTO booking
         (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
       RETURNING *`,
      [bookingRef, resolvedUserId, resolvedPassengerId, newFlightId, newSeatId, newFareCents]
    );
    const newBooking = newBookings[0];

    // Fare difference & refund accounting (zero-fee rebooking):
    // diff > 0: mock payment row for difference, status 'success'
    // diff < 0: mock refund row for difference, status 'refunded'
    // diff = 0: no payment row created
    let paymentSummary = null;
    if (diffCents > 0) {
      const amountStr = (diffCents / 100).toFixed(2);
      const { rows: payRows } = await client.query(
        `INSERT INTO payment (booking_id, amount, status, method)
         VALUES ($1, $2, 'success', 'mock_card')
         RETURNING id, amount, status, method`,
        [newBooking.id, amountStr]
      );
      paymentSummary = {
        action: 'charged',
        amount_cents: diffCents,
        amount_rupees: diffCents / 100,
        status: 'success',
        payment_id: payRows[0]?.id,
      };
    } else if (diffCents < 0) {
      const refundCents = Math.abs(diffCents);
      const amountStr = (refundCents / 100).toFixed(2);
      const { rows: payRows } = await client.query(
        `INSERT INTO payment (booking_id, amount, status, method)
         VALUES ($1, $2, 'refunded', 'mock_card')
         RETURNING id, amount, status, method`,
        [newBooking.id, amountStr]
      );
      paymentSummary = {
        action: 'refunded',
        amount_cents: refundCents,
        amount_rupees: refundCents / 100,
        status: 'refunded',
        payment_id: payRows[0]?.id,
      };
    } else {
      paymentSummary = {
        action: 'none',
        amount_cents: 0,
        amount_rupees: 0,
        status: 'no_difference',
      };
    }

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
      fare_difference_cents: diffCents,
      payment_summary: paymentSummary,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
