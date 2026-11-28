import express from 'express';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/utils/jwt.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import {
  assertNoPassengerConflict,
  holdSeat,
  confirmHeldBooking,
  executeBooking,
  cancelBooking,
} from '../src/services/bookingService.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/bookings', bookingsRouter);
  return app;
}

describe('Passenger Booking Integrity: Duplicate & Time Conflict Prevention', () => {
  const app = createTestApp();
  let user1;
  let user2;
  let user1Token;
  let airports = {};
  let aircraftTypeId;
  const createdFlightIds = [];
  const createdUserIds = [];

  async function createFlightWithSeats({
    flightNumber,
    originId,
    destId,
    depHoursFromNow,
    arrHoursFromNow,
    estDepHoursFromNow = null,
    estArrHoursFromNow = null,
    seatCount = 3,
  }) {
    const fRes = await pool.query(
      `INSERT INTO flight (
         flight_number, aircraft_type_id, origin_id, dest_id,
         scheduled_departure, scheduled_arrival,
         estimated_departure, estimated_arrival,
         status, base_price_cents
       )
       VALUES (
         $1, $2, $3, $4,
         now() + ($5 || ' hours')::interval,
         now() + ($6 || ' hours')::interval,
         CASE WHEN $7::numeric IS NOT NULL THEN now() + ($7 || ' hours')::interval ELSE NULL END,
         CASE WHEN $8::numeric IS NOT NULL THEN now() + ($8 || ' hours')::interval ELSE NULL END,
         'scheduled', 5000
       )
       RETURNING *`,
      [
        flightNumber,
        aircraftTypeId,
        originId,
        destId,
        depHoursFromNow,
        arrHoursFromNow,
        estDepHoursFromNow,
        estArrHoursFromNow,
      ]
    );
    const flight = fRes.rows[0];
    createdFlightIds.push(flight.id);

    const seats = [];
    for (let i = 1; i <= seatCount; i++) {
      const sRes = await pool.query(
        `INSERT INTO seat (flight_id, seat_number, class, is_booked)
         VALUES ($1, $2, 'economy', false)
         RETURNING *`,
        [flight.id, `${i}A`]
      );
      seats.push(sRes.rows[0]);
    }
    return { flight, seats };
  }

  async function cleanupUserBookings(userId) {
    await pool.query(
      'DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE user_id = $1)',
      [userId]
    );
    await pool.query(
      'DELETE FROM assistance_request WHERE booking_id IN (SELECT id FROM booking WHERE user_id = $1)',
      [userId]
    );
    await pool.query('DELETE FROM booking WHERE user_id = $1', [userId]);
    await pool.query(
      'UPDATE seat SET is_booked = false WHERE flight_id = ANY($1::int[])',
      [createdFlightIds]
    );
  }

  beforeAll(async () => {
    const apRes = await pool.query(
      "SELECT id, code, min_connection_minutes FROM airport WHERE code IN ('DEL', 'BOM', 'BLR', 'MAA')"
    );
    for (const row of apRes.rows) {
      airports[row.code] = row;
    }

    const actRes = await pool.query("SELECT id FROM aircraft_type WHERE size_class = 'medium' LIMIT 1");
    aircraftTypeId = actRes.rows[0].id;

    const u1 = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Conflict Test User 1', 'conflict_u1_' || gen_random_uuid() || '@example.com', 'hash', 'passenger')
       RETURNING id, name, email, role`
    );
    user1 = u1.rows[0];
    createdUserIds.push(user1.id);
    user1Token = signToken(user1);

    const u2 = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Conflict Test User 2', 'conflict_u2_' || gen_random_uuid() || '@example.com', 'hash', 'passenger')
       RETURNING id, name, email, role`
    );
    user2 = u2.rows[0];
    createdUserIds.push(user2.id);
  });

  afterEach(async () => {
    await cleanupUserBookings(user1.id);
    await cleanupUserBookings(user2.id);
  });

  afterAll(async () => {
    if (createdFlightIds.length > 0) {
      await pool.query(
        'DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = ANY($1::int[]))',
        [createdFlightIds]
      );
      await pool.query('DELETE FROM booking WHERE flight_id = ANY($1::int[])', [createdFlightIds]);
      await pool.query('DELETE FROM seat WHERE flight_id = ANY($1::int[])', [createdFlightIds]);
      await pool.query('DELETE FROM flight WHERE id = ANY($1::int[])', [createdFlightIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::int[])', [createdUserIds]);
    }
    await pool.end();
  });

  test('rejects duplicate booking on the same flight across hold, direct create, and confirm-payment with 409 DUPLICATE_BOOKING', async () => {
    const { flight, seats } = await createFlightWithSeats({
      flightNumber: 'TST-DUP1',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 48,
      arrHoursFromNow: 50,
    });

    // 1. Direct create succeeds on seat 0
    const res1 = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ flight_id: flight.id, seat_id: seats[0].id });
    expect(res1.status).toBe(201);

    // 2. Hold on seat 1 of the same flight fails with 409 DUPLICATE_BOOKING
    const resHold = await request(app)
      .post('/bookings/hold')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ flight_id: flight.id, seat_id: seats[1].id });
    expect(resHold.status).toBe(409);
    expect(resHold.body.code).toBe('DUPLICATE_BOOKING');
    expect(resHold.body.conflicting_flight_number).toBe('TST-DUP1');
    expect(resHold.body.error).toContain('TST-DUP1');

    // 3. Direct create on seat 2 of the same flight fails with 409 DUPLICATE_BOOKING
    const resDirect = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ flight_id: flight.id, seat_id: seats[2].id });
    expect(resDirect.status).toBe(409);
    expect(resDirect.body.code).toBe('DUPLICATE_BOOKING');

    // 4. confirmHeldBooking path: if a held booking exists alongside another active booking on same flight,
    // confirm-payment rejects with 409 DUPLICATE_BOOKING
    const pRes = await pool.query(
      "INSERT INTO passenger (name, email) VALUES ('Dup', 'dup@example.com') RETURNING id"
    );
    const heldRow = await pool.query(
      `INSERT INTO booking (user_id, flight_id, seat_id, passenger_id, price_cents, status, booking_ref, held_until)
       VALUES ($1, $2, $3, $4, 5000, 'held', 'BKDUP123', now() + INTERVAL '10 minutes')
       RETURNING id`,
      [user1.id, flight.id, seats[1].id, pRes.rows[0].id]
    );
    const resConfirm = await request(app)
      .post(`/bookings/${heldRow.rows[0].id}/confirm-payment`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ payment_method: 'mock_card' });
    expect(resConfirm.status).toBe(409);
    expect(resConfirm.body.code).toBe('DUPLICATE_BOOKING');
    expect(resConfirm.body.conflicting_flight_number).toBe('TST-DUP1');
  });

  test('rejects overlapping flight windows with 409 TIME_CONFLICT (including estimated times fallback)', async () => {
    // Flight A: DEL -> BOM, dep +60h, arr +62h
    const fA = await createFlightWithSeats({
      flightNumber: 'TST-OVLA',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 60,
      arrHoursFromNow: 62,
    });

    // Flight B: BLR -> MAA (arrives/departs elsewhere), dep +61h, arr +63h (overlaps A)
    const fB = await createFlightWithSeats({
      flightNumber: 'TST-OVLB',
      originId: airports.BLR.id,
      destId: airports.MAA.id,
      depHoursFromNow: 61,
      arrHoursFromNow: 63,
    });

    // Flight C: scheduled +70h..+72h (no scheduled overlap), BUT estimated +60.5h..+62.5h (overlaps A!)
    const fC = await createFlightWithSeats({
      flightNumber: 'TST-OVLC',
      originId: airports.BLR.id,
      destId: airports.MAA.id,
      depHoursFromNow: 70,
      arrHoursFromNow: 72,
      estDepHoursFromNow: 60.5,
      estArrHoursFromNow: 62.5,
    });

    // Book Flight A
    const bookA = await executeBooking({
      userId: user1.id,
      flightId: fA.flight.id,
      seatId: fA.seats[0].id,
    });
    expect(bookA.ok).toBe(true);

    // Attempt to hold Flight B -> 409 TIME_CONFLICT
    const holdB = await request(app)
      .post('/bookings/hold')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ flight_id: fB.flight.id, seat_id: fB.seats[0].id });
    expect(holdB.status).toBe(409);
    expect(holdB.body.code).toBe('TIME_CONFLICT');
    expect(holdB.body.conflicting_flight_number).toBe('TST-OVLA');

    // Attempt to book Flight C (estimated time overlap) -> 409 TIME_CONFLICT
    const bookC = await executeBooking({
      userId: user1.id,
      flightId: fC.flight.id,
      seatId: fC.seats[0].id,
    });
    expect(bookC.ok).toBe(false);
    expect(bookC.status).toBe(409);
    expect(bookC.code).toBe('TIME_CONFLICT');
  });

  test('allows valid connection (>= airport MCT) and rejects tight connection (< airport MCT)', async () => {
    // BOM has min_connection_minutes = 45 (from migration 006)
    // Inbound: DEL -> BOM, dep +80h, arr +82h
    const inbound = await createFlightWithSeats({
      flightNumber: 'TST-IN1',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 80,
      arrHoursFromNow: 82,
    });

    // Valid outbound: BOM -> BLR, dep +83h (60 min gap >= 45 min BOM MCT)
    const validOutbound = await createFlightWithSeats({
      flightNumber: 'TST-OUTOK',
      originId: airports.BOM.id,
      destId: airports.BLR.id,
      depHoursFromNow: 83,
      arrHoursFromNow: 85,
    });

    // Tight outbound: BOM -> MAA, dep +82.25h (15 min gap < 45 min BOM MCT)
    const tightOutbound = await createFlightWithSeats({
      flightNumber: 'TST-TIGHT',
      originId: airports.BOM.id,
      destId: airports.MAA.id,
      depHoursFromNow: 82.25,
      arrHoursFromNow: 84.25,
    });

    const resIn = await executeBooking({
      userId: user1.id,
      flightId: inbound.flight.id,
      seatId: inbound.seats[0].id,
    });
    expect(resIn.ok).toBe(true);

    // Tight connection should be rejected
    const resTight = await executeBooking({
      userId: user1.id,
      flightId: tightOutbound.flight.id,
      seatId: tightOutbound.seats[0].id,
    });
    expect(resTight.ok).toBe(false);
    expect(resTight.status).toBe(409);
    expect(resTight.code).toBe('TIME_CONFLICT');

    // Valid connection should succeed
    const resValid = await executeBooking({
      userId: user1.id,
      flightId: validOutbound.flight.id,
      seatId: validOutbound.seats[0].id,
    });
    expect(resValid.ok).toBe(true);
  });

  test('cancelled booking does not block rebooking the same flight or overlapping flights', async () => {
    const f1 = await createFlightWithSeats({
      flightNumber: 'TST-CANC1',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 90,
      arrHoursFromNow: 92,
    });

    const first = await executeBooking({
      userId: user1.id,
      flightId: f1.flight.id,
      seatId: f1.seats[0].id,
    });
    expect(first.ok).toBe(true);

    const cancelled = await cancelBooking({
      bookingId: first.booking.id,
      userId: user1.id,
    });
    expect(cancelled.ok).toBe(true);

    // Rebooking the same flight should now succeed
    const second = await executeBooking({
      userId: user1.id,
      flightId: f1.flight.id,
      seatId: f1.seats[1].id,
    });
    expect(second.ok).toBe(true);
  });

  test('expired hold does not block booking the same flight or overlapping flights', async () => {
    const f1 = await createFlightWithSeats({
      flightNumber: 'TST-EXP1',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 100,
      arrHoursFromNow: 102,
    });

    const hold1 = await holdSeat({
      userId: user1.id,
      flightId: f1.flight.id,
      seatId: f1.seats[0].id,
    });
    expect(hold1.ok).toBe(true);

    // Backdate held_until so the hold is expired
    await pool.query(
      "UPDATE booking SET held_until = now() - INTERVAL '5 minutes' WHERE id = $1",
      [hold1.booking.id]
    );

    // assertNoPassengerConflict should also ignore expired holds even before cleanupExpiredHolds runs
    const client = await pool.connect();
    try {
      const check = await assertNoPassengerConflict(client, user1.id, f1.flight.id);
      expect(check.ok).toBe(true);
    } finally {
      client.release();
    }

    // Booking the same flight (even the same seat after cleanup) should succeed
    const hold2 = await executeBooking({
      userId: user1.id,
      flightId: f1.flight.id,
      seatId: f1.seats[0].id,
    });
    expect(hold2.ok).toBe(true);
  });

  test('concurrent requests for the same user (different seats on same flight & overlapping flights) do not both succeed', async () => {
    const f1 = await createFlightWithSeats({
      flightNumber: 'TST-CONC1',
      originId: airports.DEL.id,
      destId: airports.BOM.id,
      depHoursFromNow: 120,
      arrHoursFromNow: 122,
      seatCount: 4,
    });

    // 1. Concurrent bookings for different seats on the SAME flight
    const sameFlightResults = await Promise.all([
      request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ flight_id: f1.flight.id, seat_id: f1.seats[0].id }),
      request(app)
        .post('/bookings')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ flight_id: f1.flight.id, seat_id: f1.seats[1].id }),
      request(app)
        .post('/bookings/hold')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ flight_id: f1.flight.id, seat_id: f1.seats[2].id }),
    ]);

    const sameFlightSuccesses = sameFlightResults.filter((r) => r.status === 201);
    const sameFlightConflicts = sameFlightResults.filter(
      (r) => r.status === 409 && r.body.code === 'DUPLICATE_BOOKING'
    );
    expect(sameFlightSuccesses.length).toBe(1);
    expect(sameFlightConflicts.length).toBe(2);

    // 2. Concurrent bookings for two OVERLAPPING flights by user2
    const f2 = await createFlightWithSeats({
      flightNumber: 'TST-CONC2',
      originId: airports.BLR.id,
      destId: airports.MAA.id,
      depHoursFromNow: 120.5,
      arrHoursFromNow: 122.5,
    });
    const f3 = await createFlightWithSeats({
      flightNumber: 'TST-CONC3',
      originId: airports.MAA.id,
      destId: airports.DEL.id,
      depHoursFromNow: 121,
      arrHoursFromNow: 123,
    });

    const overlapResults = await Promise.all([
      executeBooking({ userId: user2.id, flightId: f2.flight.id, seatId: f2.seats[0].id }),
      executeBooking({ userId: user2.id, flightId: f3.flight.id, seatId: f3.seats[0].id }),
    ]);

    const overlapSuccesses = overlapResults.filter((r) => r.ok === true);
    const overlapConflicts = overlapResults.filter(
      (r) => r.ok === false && r.status === 409 && r.code === 'TIME_CONFLICT'
    );
    expect(overlapSuccesses.length).toBe(1);
    expect(overlapConflicts.length).toBe(1);
  });
});
