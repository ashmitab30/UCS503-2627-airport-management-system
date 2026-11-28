import { pool } from '../src/db/pool.js';
import { hasDeparted, isCheckInAllowed } from '../src/services/flightTime.js';
import {
  searchFlights,
  holdSeat,
  confirmHeldBooking,
  checkInBooking,
} from '../src/services/bookingService.js';

describe('Task 1: Flight Time, Past Flight Filtering, Holds & Check-in Tests', () => {
  let passengerUser;
  let adminUser;
  let airportA;
  let airportB;
  let aircraftType;

  // Test entities tracked for cleanup
  let createdFlightIds = [];
  let createdUserIds = [];

  beforeAll(async () => {
    // 1. Reference airport & aircraft type
    const apRes = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 2');
    airportA = apRes.rows[0].id;
    airportB = apRes.rows[1].id;

    const actRes = await pool.query("SELECT id FROM aircraft_type WHERE size_class = 'medium' LIMIT 1");
    aircraftType = actRes.rows[0].id;

    // 2. Create passenger & admin users
    const pUserRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Test Passenger', 'p_test_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email, role`
    );
    passengerUser = pUserRes.rows[0];
    createdUserIds.push(passengerUser.id);

    const aUserRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Test Admin', 'a_test_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'admin')
       RETURNING id, name, email, role`
    );
    adminUser = aUserRes.rows[0];
    createdUserIds.push(adminUser.id);

    // Matching passenger row for FK constraints
    await pool.query(
      'INSERT INTO passenger (name, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [passengerUser.name, passengerUser.email]
    );
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
  });

  // Helper to insert test flight with seat
  async function createTestFlight({
    flightNumber,
    scheduledDeparture,
    scheduledArrival,
    status = 'scheduled',
    actualDeparture = null,
    actualArrival = null,
  }) {
    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status,
                           actual_departure, actual_arrival, base_price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5000)
       RETURNING id, flight_number, scheduled_departure, scheduled_arrival, status, actual_departure`,
      [
        flightNumber,
        aircraftType,
        airportA,
        airportB,
        scheduledDeparture,
        scheduledArrival,
        status,
        actualDeparture,
        actualArrival,
      ]
    );
    const flight = fRes.rows[0];
    createdFlightIds.push(flight.id);

    const sRes = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '1A', 'economy', false)
       RETURNING id, seat_number, class, is_booked`,
      [flight.id]
    );
    return { flight, seat: sRes.rows[0] };
  }

  // ── 1. hasDeparted boundary unit tests ──────────────────────────────────────
  describe('hasDeparted boundary unit tests', () => {
    test('returns false for null/undefined flight or missing schedule', () => {
      expect(hasDeparted(null)).toBe(false);
      expect(hasDeparted(undefined)).toBe(false);
      expect(hasDeparted({})).toBe(false);
      expect(hasDeparted({ scheduled_departure: 'invalid-date' })).toBe(false);
    });

    test('returns false when departure is strictly in the future', () => {
      const now = new Date('2026-11-23T12:00:00Z');
      const flightFuture = { scheduled_departure: '2026-11-23T12:00:01Z', status: 'scheduled' };
      expect(hasDeparted(flightFuture, now)).toBe(false);

      const flightOneHour = { scheduled_departure: '2026-11-23T13:00:00Z', status: 'scheduled' };
      expect(hasDeparted(flightOneHour, now)).toBe(false);
    });

    test('boundary: returns true when departure is exactly now (depTime <= now)', () => {
      const now = new Date('2026-11-23T12:00:00Z');
      const flightExact = { scheduled_departure: '2026-11-23T12:00:00Z', status: 'scheduled' };
      expect(hasDeparted(flightExact, now)).toBe(true);
    });

    test('returns true when departure is 1 second in the past', () => {
      const now = new Date('2026-11-23T12:00:00Z');
      const flightPast = { scheduled_departure: '2026-11-23T11:59:59Z', status: 'scheduled' };
      expect(hasDeparted(flightPast, now)).toBe(true);
    });

    test('actual_departure takes precedence over scheduled_departure', () => {
      const now = new Date('2026-11-23T12:00:00Z');

      // Scheduled was 30 mins ago, but actual departure delayed to 10 mins from now -> NOT departed
      const delayedFlight = {
        scheduled_departure: '2026-11-23T11:30:00Z',
        actual_departure: '2026-11-23T12:10:00Z',
        status: 'delayed',
      };
      expect(hasDeparted(delayedFlight, now)).toBe(false);

      // Scheduled is 30 mins in future, but early takeoff happened 5 mins ago -> HAS departed
      const earlyFlight = {
        scheduled_departure: '2026-11-23T12:30:00Z',
        actual_departure: '2026-11-23T11:55:00Z',
        status: 'departed',
      };
      expect(hasDeparted(earlyFlight, now)).toBe(true);
    });

    test('status departed, in_air, and landed always indicate departure', () => {
      const futureTime = new Date(Date.now() + 3600_000).toISOString();
      expect(hasDeparted({ scheduled_departure: futureTime, status: 'departed' })).toBe(true);
      expect(hasDeparted({ scheduled_departure: futureTime, status: 'in_air' })).toBe(true);
      expect(hasDeparted({ scheduled_departure: futureTime, status: 'landed' })).toBe(true);
      expect(hasDeparted({ scheduled_departure: futureTime, flight_status: 'departed' })).toBe(true);
    });

    test('isCheckInAllowed correctly combines departure and 24h window', () => {
      const now = new Date('2026-11-23T12:00:00Z');

      // 10 hours in future -> allowed
      expect(isCheckInAllowed({ scheduled_departure: '2026-11-23T22:00:00Z', status: 'scheduled' }, now).allowed).toBe(true);

      // 25 hours in future -> not allowed (> 24h)
      const resFuture = isCheckInAllowed({ scheduled_departure: '2026-11-24T13:00:00Z', status: 'scheduled' }, now);
      expect(resFuture.allowed).toBe(false);
      expect(resFuture.code).toBe('CHECK_IN_NOT_OPEN');

      // In the past -> departed
      const resPast = isCheckInAllowed({ scheduled_departure: '2026-11-23T11:00:00Z', status: 'scheduled' }, now);
      expect(resPast.allowed).toBe(false);
      expect(resPast.code).toBe('FLIGHT_DEPARTED');

      // Cancelled -> rejected
      const resCanc = isCheckInAllowed({ scheduled_departure: '2026-11-23T18:00:00Z', status: 'cancelled' }, now);
      expect(resCanc.allowed).toBe(false);
      expect(resCanc.code).toBe('FLIGHT_CANCELLED');
    });
  });

  // ── 2. search excludes past and cancelled flights ───────────────────────────
  describe('search excludes past and cancelled flights', () => {
    beforeAll(async () => {
      const now = new Date();
      await createTestFlight({
        flightNumber: 'T1-UPCOM',
        scheduledDeparture: new Date(now.getTime() + 6 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 8 * 3600_000).toISOString(),
        status: 'scheduled',
      });

      await createTestFlight({
        flightNumber: 'T1-PAST',
        scheduledDeparture: new Date(now.getTime() - 6 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() - 4 * 3600_000).toISOString(),
        status: 'scheduled',
      });

      await createTestFlight({
        flightNumber: 'T1-CANCL',
        scheduledDeparture: new Date(now.getTime() + 6 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 8 * 3600_000).toISOString(),
        status: 'cancelled',
      });

      await createTestFlight({
        flightNumber: 'T1-LANDD',
        scheduledDeparture: new Date(now.getTime() - 10 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() - 8 * 3600_000).toISOString(),
        status: 'landed',
      });
    });

    test('default search returns only upcoming non-cancelled flights', async () => {
      const result = await searchFlights({ userRole: 'passenger' }, pool);
      const numbers = result.flights.map((f) => f.flight_number);

      expect(numbers).toContain('T1-UPCOM');
      expect(numbers).not.toContain('T1-PAST');
      expect(numbers).not.toContain('T1-CANCL');
      expect(numbers).not.toContain('T1-LANDD');

      // Verify response shape: has_departed added, original fields preserved
      const item = result.flights.find((f) => f.flight_number === 'T1-UPCOM');
      expect(item.has_departed).toBe(false);
      expect(item.fare_cents).toBeDefined();
      expect(item.fare_formatted).toBeDefined();
      expect(item.origin_code).toBeDefined();
      expect(item.dest_code).toBeDefined();
    });

    test('passenger role cannot use includePast=true to view past flights', async () => {
      const result = await searchFlights({ includePast: true, userRole: 'passenger' }, pool);
      const numbers = result.flights.map((f) => f.flight_number);
      expect(numbers).not.toContain('T1-PAST');
      expect(numbers).not.toContain('T1-LANDD');
    });

    test('admin role with includePast=true includes past flights', async () => {
      const result = await searchFlights({ includePast: true, userRole: 'admin' }, pool);
      const numbers = result.flights.map((f) => f.flight_number);
      expect(numbers).toContain('T1-PAST');
      expect(numbers).toContain('T1-LANDD');
      expect(numbers).not.toContain('T1-CANCL'); // cancelled remains excluded
    });
  });

  // ── 3. hold on a departed flight returns 409 FLIGHT_DEPARTED ────────────────
  describe('hold on a departed flight returns 409 FLIGHT_DEPARTED', () => {
    let departedFlight;
    let departedSeat;
    let cancelledFlight;
    let cancelledSeat;

    beforeAll(async () => {
      const now = new Date();
      const dep = await createTestFlight({
        flightNumber: 'T1-HLDDEP',
        scheduledDeparture: new Date(now.getTime() - 2 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() - 3600_000).toISOString(),
        status: 'landed',
      });
      departedFlight = dep.flight;
      departedSeat = dep.seat;

      const cnc = await createTestFlight({
        flightNumber: 'T1-HLDCNC',
        scheduledDeparture: new Date(now.getTime() + 4 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 6 * 3600_000).toISOString(),
        status: 'cancelled',
      });
      cancelledFlight = cnc.flight;
      cancelledSeat = cnc.seat;
    });

    test('holdSeat rejects departed flight with 409 FLIGHT_DEPARTED inside transaction', async () => {
      const result = await holdSeat({
        userId: passengerUser.id,
        flightId: departedFlight.id,
        seatId: departedSeat.id,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(result.code).toBe('FLIGHT_DEPARTED');
      expect(result.error).toMatch(/departed/i);

      // Verify seat was NOT booked
      const seatCheck = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [departedSeat.id]);
      expect(seatCheck.rows[0].is_booked).toBe(false);
    });

    test('holdSeat rejects cancelled flight with 409 FLIGHT_CANCELLED', async () => {
      const result = await holdSeat({
        userId: passengerUser.id,
        flightId: cancelledFlight.id,
        seatId: cancelledSeat.id,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(result.code).toBe('FLIGHT_CANCELLED');
    });

    test('confirmHeldBooking rejects if flight departed since hold', async () => {
      // 1. Create flight departing in 1 minute
      const now = new Date();
      const soon = await createTestFlight({
        flightNumber: 'T1-HLDCONF',
        scheduledDeparture: new Date(now.getTime() + 60_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 7200_000).toISOString(),
        status: 'scheduled',
      });

      // 2. Successfully hold seat
      const holdRes = await holdSeat({
        userId: passengerUser.id,
        flightId: soon.flight.id,
        seatId: soon.seat.id,
      });
      expect(holdRes.ok).toBe(true);

      // 3. Simulate flight departing while hold is active
      await pool.query(
        "UPDATE flight SET scheduled_departure = now() - INTERVAL '10 minutes', status = 'departed' WHERE id = $1",
        [soon.flight.id]
      );

      // 4. Confirmation attempt must fail with 409 FLIGHT_DEPARTED
      const confirmRes = await confirmHeldBooking({
        bookingId: holdRes.booking.id,
        userId: passengerUser.id,
      });
      expect(confirmRes.ok).toBe(false);
      expect(confirmRes.status).toBe(409);
      expect(confirmRes.code).toBe('FLIGHT_DEPARTED');
    });
  });

  // ── 4. check-in on a departed flight is rejected ───────────────────────────
  describe('check-in on a departed flight is rejected', () => {
    let departedFlight;
    let departedBooking;

    beforeAll(async () => {
      const now = new Date();
      const dep = await createTestFlight({
        flightNumber: 'T1-CHKDEP',
        scheduledDeparture: new Date(now.getTime() - 90 * 60_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 30 * 60_000).toISOString(),
        status: 'departed',
      });
      departedFlight = dep.flight;

      const pRes = await pool.query('SELECT id FROM passenger WHERE email = $1', [passengerUser.email]);
      const passengerId = pRes.rows[0].id;

      const bRes = await pool.query(
        `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
         VALUES ('BK-T1DEP', $1, $2, $3, $4, 'confirmed', 5000)
         RETURNING id`,
        [passengerUser.id, passengerId, departedFlight.id, dep.seat.id]
      );
      departedBooking = bRes.rows[0];
    });

    test('checkInBooking rejects departed flight with 400 FLIGHT_DEPARTED', async () => {
      const result = await checkInBooking({
        bookingId: departedBooking.id,
        userId: passengerUser.id,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.code).toBe('FLIGHT_DEPARTED');
      expect(result.error).toBe('Flight has already departed');

      // Verify status remained confirmed
      const check = await pool.query('SELECT status FROM booking WHERE id = $1', [departedBooking.id]);
      expect(check.rows[0].status).toBe('confirmed');
    });
  });

  // ── 5. check-in just inside the window works ───────────────────────────────
  describe('check-in just inside the window works', () => {
    let windowFlight;
    let windowBooking;
    let outsideFlight;
    let outsideBooking;

    beforeAll(async () => {
      const now = new Date();

      // Flight departing in 23 hours (inside 24h window)
      const inWin = await createTestFlight({
        flightNumber: 'T1-WIN23H',
        scheduledDeparture: new Date(now.getTime() + 23 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 25 * 3600_000).toISOString(),
        status: 'scheduled',
      });
      windowFlight = inWin.flight;

      // Flight departing in 26 hours (outside 24h window)
      const outWin = await createTestFlight({
        flightNumber: 'T1-WIN26H',
        scheduledDeparture: new Date(now.getTime() + 26 * 3600_000).toISOString(),
        scheduledArrival: new Date(now.getTime() + 28 * 3600_000).toISOString(),
        status: 'scheduled',
      });
      outsideFlight = outWin.flight;

      const pRes = await pool.query('SELECT id FROM passenger WHERE email = $1', [passengerUser.email]);
      const passengerId = pRes.rows[0].id;

      const bWin = await pool.query(
        `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
         VALUES ('BK-T1WIN', $1, $2, $3, $4, 'confirmed', 5000)
         RETURNING id`,
        [passengerUser.id, passengerId, windowFlight.id, inWin.seat.id]
      );
      windowBooking = bWin.rows[0];

      const bOut = await pool.query(
        `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
         VALUES ('BK-T1OUT', $1, $2, $3, $4, 'confirmed', 5000)
         RETURNING id`,
        [passengerUser.id, passengerId, outsideFlight.id, outWin.seat.id]
      );
      outsideBooking = bOut.rows[0];
    });

    test('check-in just inside the 24h window succeeds', async () => {
      const result = await checkInBooking({
        bookingId: windowBooking.id,
        userId: passengerUser.id,
      });
      expect(result.ok).toBe(true);
      expect(result.booking.status).toBe('checked_in');

      // Verify status persisted in database
      const check = await pool.query('SELECT status FROM booking WHERE id = $1', [windowBooking.id]);
      expect(check.rows[0].status).toBe('checked_in');
    });

    test('check-in outside the 24h window (>24h) is rejected with CHECK_IN_NOT_OPEN', async () => {
      const result = await checkInBooking({
        bookingId: outsideBooking.id,
        userId: passengerUser.id,
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.code).toBe('CHECK_IN_NOT_OPEN');
      expect(result.error).toMatch(/opens 24 hours/i);
    });
  });
});
