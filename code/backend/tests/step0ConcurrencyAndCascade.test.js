import { pool } from '../src/db/pool.js';
import { executeBooking } from '../src/services/bookingService.js';
import { ADVISORY_LOCK_DOMAINS } from '../src/constants/index.js';
import { checkShiftConflict } from '../src/services/shiftConflict.js';
import { checkResourceConflict } from '../src/services/resourceConflict.js';

describe('Step 0 Concurrency, State Machine & Permissions Tests (against local PostgreSQL)', () => {
  let testUser;
  let testFlight;
  let testSeat;
  let testEmployee;
  let testResource;

  beforeAll(async () => {
    // 1. Setup test user
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Step0 Test User', 'step0_test_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email`
    );
    testUser = uRes.rows[0];

    // 2. Setup test employee
    const staffUser = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Staff User', 'staff_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'ground_crew')
       RETURNING id`
    );
    const empRes = await pool.query(
      `INSERT INTO employee (user_id, department, role_title)
       VALUES ($1, 'Ramp Operations', 'Ramp Agent')
       RETURNING id`,
      [staffUser.rows[0].id]
    );
    testEmployee = empRes.rows[0];

    // 3. Setup test airports & aircraft type
    const apRes = await pool.query('SELECT id FROM airport LIMIT 2');
    const actRes = await pool.query('SELECT id FROM aircraft_type WHERE size_class = \'medium\' LIMIT 1');

    // 4. Create test flight
    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('TEST-CONC', $1, $2, $3, now() + INTERVAL '10 days', now() + INTERVAL '10 days 2 hours', 'scheduled', 6000)
       RETURNING id, base_price_cents`,
      [actRes.rows[0].id, apRes.rows[0].id, apRes.rows[1].id]
    );
    testFlight = fRes.rows[0];

    // 5. Create test seat
    const sRes = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '99Z', 'business', false)
       RETURNING id, flight_id, seat_number, class`,
      [testFlight.id]
    );
    testSeat = sRes.rows[0];

    // 6. Setup test resource
    const rRes = await pool.query(
      `INSERT INTO resource (airport_id, type, status)
       VALUES ($1, 'fuel_truck', 'available')
       RETURNING id`,
      [apRes.rows[0].id]
    );
    testResource = rRes.rows[0];
  });

  afterAll(async () => {
    if (testFlight) {
      await pool.query('DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = $1)', [testFlight.id]);
      await pool.query('DELETE FROM booking WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM seat WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM flight WHERE id = $1', [testFlight.id]);
    }
    if (testEmployee) {
      await pool.query('DELETE FROM shift WHERE employee_id = $1', [testEmployee.id]);
      await pool.query('DELETE FROM employee WHERE id = $1', [testEmployee.id]);
    }
    if (testResource) {
      await pool.query('DELETE FROM resource_assignment WHERE resource_id = $1', [testResource.id]);
      await pool.query('DELETE FROM resource WHERE id = $1', [testResource.id]);
    }
    if (testUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
    await pool.end();
  });

  test('Race-safe seat booking: 5 parallel requests for the exact same seat -> exactly 1 succeeds, 4 receive 409', async () => {
    const attempts = Array.from({ length: 5 }, () =>
      executeBooking({
        userId: testUser.id,
        flightId: testFlight.id,
        seatId: testSeat.id,
      })
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.ok === true);
    const conflicts = results.filter((r) => r.ok === false && r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(4);

    // Verify seat is now booked
    const check = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeat.id]);
    expect(check.rows[0].is_booked).toBe(true);

    // Verify snapshot price
    expect(successes[0].booking.price_cents).toBe(13200); // 6000 * 2.2 for business
    expect(successes[0].payment.amount).toBe('132.00');
  });

  test('Race-safe shift conflict: 2 parallel conflicting shift inserts -> exactly 1 succeeds, 1 rejected', async () => {
    const startTime = new Date(Date.now() + 86400_000).toISOString();
    const endTime = new Date(Date.now() + 86400_000 + 4 * 3600_000).toISOString();

    const insertShiftWithLock = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          ADVISORY_LOCK_DOMAINS.EMPLOYEE,
          testEmployee.id,
        ]);
        const conflict = await checkShiftConflict(testEmployee.id, startTime, endTime, null, client);
        if (!conflict.ok) {
          await client.query('ROLLBACK');
          return { ok: false, status: 409 };
        }
        const ins = await client.query(
          `INSERT INTO shift (employee_id, start_time, end_time, area_assigned)
           VALUES ($1, $2, $3, 'Ramp A') RETURNING id`,
          [testEmployee.id, startTime, endTime]
        );
        await client.query('COMMIT');
        return { ok: true, id: ins.rows[0].id };
      } catch (err) {
        await client.query('ROLLBACK');
        return { ok: false, error: err.message };
      } finally {
        client.release();
      }
    };

    const results = await Promise.all([insertShiftWithLock(), insertShiftWithLock()]);
    const successes = results.filter((r) => r.ok === true);
    const conflicts = results.filter((r) => r.ok === false && r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);
  });

  test('Race-safe resource assignment: 2 parallel conflicting assignments -> exactly 1 succeeds, 1 rejected', async () => {
    const startTime = new Date(Date.now() + 172800_000).toISOString();
    const endTime = new Date(Date.now() + 172800_000 + 2 * 3600_000).toISOString();

    const assignResourceWithLock = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          ADVISORY_LOCK_DOMAINS.RESOURCE,
          testResource.id,
        ]);
        const conflict = await checkResourceConflict(testResource.id, startTime, endTime, null, client);
        if (!conflict.ok) {
          await client.query('ROLLBACK');
          return { ok: false, status: 409 };
        }
        const ins = await client.query(
          `INSERT INTO resource_assignment (resource_id, flight_id, start_time, end_time)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [testResource.id, testFlight.id, startTime, endTime]
        );
        await client.query('COMMIT');
        return { ok: true, id: ins.rows[0].id };
      } catch (err) {
        await client.query('ROLLBACK');
        return { ok: false, error: err.message };
      } finally {
        client.release();
      }
    };

    const results = await Promise.all([assignResourceWithLock(), assignResourceWithLock()]);
    const successes = results.filter((r) => r.ok === true);
    const conflicts = results.filter((r) => r.ok === false && r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(1);
  });
});
