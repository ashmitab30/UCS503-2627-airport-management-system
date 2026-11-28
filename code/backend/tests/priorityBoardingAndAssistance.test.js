import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import { flightsRouter } from '../src/routes/flights.js';
import { signToken } from '../src/utils/jwt.js';
import { BOARDING_GROUPS } from '../src/constants/index.js';

describe('Task 12: Priority Boarding tied to Check-In & Finishing Assistance Requests', () => {
  let server;
  let baseUrl;

  // Stub socket.io
  const emittedEvents = [];
  const stubIo = {
    to: () => stubIo,
    emit: (eventName, payload) => {
      emittedEvents.push({ eventName, payload });
    },
  };

  // Test users
  const passengerUser1 = { id: 881, role: 'passenger', email: 'ast_pass1@test.com' };
  const passengerUser2 = { id: 882, role: 'passenger', email: 'ast_pass2@test.com' };
  const groundCrew1 = { id: 883, role: 'ground_crew', email: 'ast_staff1@test.com' };
  const groundCrew2 = { id: 884, role: 'ground_crew', email: 'ast_staff2@test.com' };
  const opsManager = { id: 885, role: 'ops_manager', email: 'ast_ops@test.com' };
  const adminUser = { id: 886, role: 'admin', email: 'ast_admin@test.com' };

  let tokenPass1;
  let tokenPass2;
  let tokenStaff1;
  let tokenStaff2;
  let tokenOps;
  let tokenAdmin;

  let testOriginAirportId;
  let testDestAirportId;
  let testFlightId;
  let economySeat1;
  let economySeat2;
  let businessSeat1;
  let passengerRecord1;

  beforeAll(async () => {
    // 1. Setup Express test server with stub socket.io
    const app = express();
    app.use(express.json());
    app.set('io', stubIo);
    app.use('/bookings', bookingsRouter);
    app.use('/flights', flightsRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens
    tokenPass1 = signToken(passengerUser1);
    tokenPass2 = signToken(passengerUser2);
    tokenStaff1 = signToken(groundCrew1);
    tokenStaff2 = signToken(groundCrew2);
    tokenOps = signToken(opsManager);
    tokenAdmin = signToken(adminUser);

    // 3. Insert test users
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         (881, 'Pass One', 'ast_pass1@test.com', 'hash', 'passenger'),
         (882, 'Pass Two', 'ast_pass2@test.com', 'hash', 'passenger'),
         (883, 'Staff One', 'ast_staff1@test.com', 'hash', 'ground_crew'),
         (884, 'Staff Two', 'ast_staff2@test.com', 'hash', 'ground_crew'),
         (885, 'Ops User', 'ast_ops@test.com', 'hash', 'ops_manager'),
         (886, 'Admin User', 'ast_admin@test.com', 'hash', 'admin')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`
    );

    // 4. Insert passenger record with date of birth for age calculation test
    const pRes = await pool.query(
      `INSERT INTO passenger (name, email, date_of_birth)
       VALUES ('Pass One', 'ast_pass1@test.com', '1985-05-15')
       RETURNING id`
    );
    passengerRecord1 = pRes.rows[0].id;

    // 5. Test airports
    const origRes = await pool.query(
      `INSERT INTO airport (name, code, timezone) VALUES ('AST Origin', 'AOR', 'UTC')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    );
    testOriginAirportId = origRes.rows[0].id;

    const destRes = await pool.query(
      `INSERT INTO airport (name, code, timezone) VALUES ('AST Dest', 'ADS', 'UTC')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    );
    testDestAirportId = destRes.rows[0].id;

    // 6. Test aircraft type & flight (within 24 hours so check-in is open)
    const acRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    const acId = acRes.rows[0].id;

    const now = new Date();
    const dep = new Date(now.getTime() + 4 * 3600_000);
    const arr = new Date(now.getTime() + 6 * 3600_000);

    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id, scheduled_departure, scheduled_arrival, status)
       VALUES ('AST-100', $1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [acId, testOriginAirportId, testDestAirportId, dep.toISOString(), arr.toISOString()]
    );
    testFlightId = fRes.rows[0].id;

    // 7. Test seats (economy and business)
    const s1 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12A', 'economy', false) RETURNING id`,
      [testFlightId]
    );
    economySeat1 = s1.rows[0].id;

    const s2 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12B', 'economy', false) RETURNING id`,
      [testFlightId]
    );
    economySeat2 = s2.rows[0].id;

    const s3 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '02A', 'business', false) RETURNING id`,
      [testFlightId]
    );
    businessSeat1 = s3.rows[0].id;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    // Clean up created test data
    if (testFlightId) {
      await pool.query('DELETE FROM assistance_request WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = $1)', [testFlightId]);
      await pool.query('DELETE FROM booking WHERE flight_id = $1', [testFlightId]);
      await pool.query('DELETE FROM seat WHERE flight_id = $1', [testFlightId]);
      await pool.query('DELETE FROM flight WHERE id = $1', [testFlightId]);
    }
    if (testOriginAirportId) await pool.query('DELETE FROM airport WHERE id = $1', [testOriginAirportId]);
    if (testDestAirportId) await pool.query('DELETE FROM airport WHERE id = $1', [testDestAirportId]);
    if (passengerRecord1) await pool.query('DELETE FROM passenger WHERE id = $1', [passengerRecord1]);
    await pool.query('DELETE FROM "user" WHERE id IN (881, 882, 883, 884, 885, 886)');
  });

  // Helper to create booking directly in database
  async function createTestBooking({ ref, userId, seatId, status = 'confirmed', passengerId = null }) {
    const res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, seat_id, status, price_cents, passenger_id)
       VALUES ($1, $2, $3, $4, $5, 500000, $6)
       RETURNING id, booking_ref, status, boarding_group, seat_id`,
      [ref, userId, testFlightId, seatId, status, passengerId || passengerRecord1]
    );
    return res.rows[0];
  }

  describe('Part A: Priority Boarding Group Assignment at Check-In', () => {
    it('assigns Group 2 to Economy booking without assistance at check-in', async () => {
      const b = await createTestBooking({ ref: 'BK-T12-ECO', userId: passengerUser1.id, seatId: economySeat1 });

      const res = await fetch(`${baseUrl}/bookings/${b.id}/check-in`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.status).toBe('checked_in');
      expect(data.booking.boarding_group).toBe(BOARDING_GROUPS.GENERAL); // Group 2

      // Verify in DB
      const dbCheck = await pool.query('SELECT boarding_group, status FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck.rows[0].boarding_group).toBe(2);
    });

    it('assigns Group 1 (Priority) to Business class booking at check-in', async () => {
      const b = await createTestBooking({ ref: 'BK-T12-BIZ', userId: passengerUser1.id, seatId: businessSeat1 });

      const res = await fetch(`${baseUrl}/bookings/${b.id}/check-in`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.boarding_group).toBe(BOARDING_GROUPS.PRIORITY); // Group 1

      const dbCheck = await pool.query('SELECT boarding_group FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck.rows[0].boarding_group).toBe(1);
    });

    it('assigns Group 1 (Priority) to Economy booking with open assistance request at check-in', async () => {
      const b = await createTestBooking({ ref: 'BK-T12-AST', userId: passengerUser1.id, seatId: economySeat2 });

      // Add open assistance request prior to check-in
      await pool.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, 'wheelchair', 'requested', 'Need wheelchair')`,
        [b.id]
      );

      const res = await fetch(`${baseUrl}/bookings/${b.id}/check-in`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.boarding_group).toBe(BOARDING_GROUPS.PRIORITY); // Group 1
    });

    it('recomputes boarding group when assistance request is created or cancelled after check-in', async () => {
      // Create economy booking checked-in with no assistance -> group 2
      const b = await createTestBooking({ ref: 'BK-REC01', userId: passengerUser1.id, seatId: null, status: 'checked_in' });
      await pool.query('UPDATE booking SET boarding_group = 2 WHERE id = $1', [b.id]);

      // 1. Passenger requests assistance on already checked-in booking
      const createRes = await fetch(`${baseUrl}/bookings/${b.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'medical', notes: 'Need oxygen tank' }),
      });
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const assistId = createData.request.id;

      // Group should now be recomputed to 1 (Priority)
      const dbCheck1 = await pool.query('SELECT boarding_group FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck1.rows[0].boarding_group).toBe(1);

      // 2. Passenger cancels assistance request
      const cancelRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
        },
      });
      expect(cancelRes.status).toBe(200);

      // Group should now be recomputed back to 2 (General)
      const dbCheck2 = await pool.query('SELECT boarding_group FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck2.rows[0].boarding_group).toBe(2);
    });

    it('Task 12.1: completing an assistance request keeps Group 1 (Priority)', async () => {
      // 1. Create economy booking checked-in with open assistance -> Group 1
      const b = await createTestBooking({ ref: 'BK-CMP01', userId: passengerUser1.id, seatId: economySeat1, status: 'checked_in' });
      await pool.query('UPDATE booking SET boarding_group = 1 WHERE id = $1', [b.id]);

      const astRes = await pool.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, 'wheelchair', 'requested', 'Need wheelchair')
         RETURNING id`,
        [b.id]
      );
      const assistId = astRes.rows[0].id;

      // 2. Staff takes, starts, and completes the assistance request
      await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenStaff1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'assigned' }),
      });
      await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenStaff1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      const compRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${tokenStaff1}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(compRes.status).toBe(200);

      // 3. Boarding group must STILL be Group 1 (Priority)
      const dbCheck = await pool.query('SELECT boarding_group FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck.rows[0].boarding_group).toBe(BOARDING_GROUPS.PRIORITY); // Group 1
    });

    it('Task 12.1: a boarded booking keeps its group and is never recomputed', async () => {
      // Create a boarded booking in Group 2
      const b = await createTestBooking({ ref: 'BK-BRD01', userId: passengerUser1.id, seatId: economySeat1, status: 'boarded' });
      await pool.query('UPDATE booking SET boarding_group = 2 WHERE id = $1', [b.id]);

      // Insert an assistance request
      await pool.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, 'visual', 'requested', 'Visual guide')`,
        [b.id]
      );

      // Call recomputeBoardingGroup directly
      const { recomputeBoardingGroup } = await import('../src/services/bookingService.js');
      const res = await recomputeBoardingGroup(b.id, pool);
      expect(res).toBeNull(); // Boarded bookings are never recomputed

      // Group in DB must remain 2
      const dbCheck = await pool.query('SELECT boarding_group, status FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck.rows[0].boarding_group).toBe(2);
      expect(dbCheck.rows[0].status).toBe('boarded');
    });

    it('Task 12.1: business class booking stays Group 1 whatever happens', async () => {
      // Business class booking checked in
      const b = await createTestBooking({ ref: 'BK-BIZ01', userId: passengerUser1.id, seatId: businessSeat1, status: 'checked_in' });
      await pool.query('UPDATE booking SET boarding_group = 1 WHERE id = $1', [b.id]);

      // Add and then cancel an assistance request
      const astRes = await pool.query(
        `INSERT INTO assistance_request (booking_id, type, status, notes)
         VALUES ($1, 'hearing', 'requested', 'Hearing guide')
         RETURNING id`,
        [b.id]
      );
      const assistId = astRes.rows[0].id;

      const cancelRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenPass1}` },
      });
      expect(cancelRes.status).toBe(200);

      // Business class must STAY Group 1
      const dbCheck = await pool.query('SELECT boarding_group FROM booking WHERE id = $1', [b.id]);
      expect(dbCheck.rows[0].boarding_group).toBe(BOARDING_GROUPS.PRIORITY); // Group 1
    });

    it('returns boarding_group in GET /bookings/mine and GET /bookings/:id/boarding-pass', async () => {
      const b = await createTestBooking({ ref: 'BK-READ01', userId: passengerUser1.id, seatId: economySeat1, status: 'checked_in' });
      await pool.query('UPDATE booking SET boarding_group = 1 WHERE id = $1', [b.id]);

      // GET /bookings/mine
      const mineRes = await fetch(`${baseUrl}/bookings/mine`, {
        headers: { Authorization: `Bearer ${tokenPass1}` },
      });
      expect(mineRes.status).toBe(200);
      const mineData = await mineRes.json();
      const foundMine = mineData.bookings.find((item) => item.id === b.id);
      expect(foundMine).toBeDefined();
      expect(foundMine.boarding_group).toBe(1);

      // GET /bookings/:id/boarding-pass (JSON)
      const bpRes = await fetch(`${baseUrl}/bookings/${b.id}/boarding-pass`, {
        headers: { Authorization: `Bearer ${tokenPass1}` },
      });
      expect(bpRes.status).toBe(200);
      const bpData = await bpRes.json();
      expect(bpData.boarding_pass.boarding_group).toBe(1);
      expect(bpData.boarding_pass.priority_boarding).toBe(true);
    });
  });

  describe('Part A & B: Boarding Queue Endpoint & Permissions', () => {
    it('orders boarding queue by boarding_group ASC then check-in time / booking order', async () => {
      // Create passengers in flight: Group 1, Group 2, and Group 1
      const bG2 = await createTestBooking({ ref: 'BK-Q-GRP2', userId: passengerUser1.id, seatId: economySeat1, status: 'checked_in' });
      await pool.query('UPDATE booking SET boarding_group = 2 WHERE id = $1', [bG2.id]);

      const bG1 = await createTestBooking({ ref: 'BK-Q-GRP1', userId: passengerUser2.id, seatId: businessSeat1, status: 'boarded' });
      await pool.query('UPDATE booking SET boarding_group = 1 WHERE id = $1', [bG1.id]);

      const qRes = await fetch(`${baseUrl}/flights/${testFlightId}/boarding-queue`, {
        headers: { Authorization: `Bearer ${tokenStaff1}` },
      });
      expect(qRes.status).toBe(200);
      const qData = await qRes.json();

      expect(qData.queue).toBeDefined();
      expect(qData.queue.length).toBeGreaterThanOrEqual(2);

      // Find indices in returned queue
      const idxG1 = qData.queue.findIndex((p) => p.booking_id === bG1.id);
      const idxG2 = qData.queue.findIndex((p) => p.booking_id === bG2.id);

      // Group 1 must appear before Group 2 in the queue
      expect(idxG1).toBeLessThan(idxG2);

      // Boarded boolean verified
      const itemG1 = qData.queue[idxG1];
      expect(itemG1.boarded).toBe(true);
      const itemG2 = qData.queue[idxG2];
      expect(itemG2.boarded).toBe(false);
    });

    it('enforces role permissions on GET /flights/:id/boarding-queue', async () => {
      // Allowed for ground_crew, ops_manager, admin
      for (const token of [tokenStaff1, tokenOps, tokenAdmin]) {
        const res = await fetch(`${baseUrl}/flights/${testFlightId}/boarding-queue`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
      }

      // Forbidden for passenger
      const passRes = await fetch(`${baseUrl}/flights/${testFlightId}/boarding-queue`, {
        headers: { Authorization: `Bearer ${tokenPass1}` },
      });
      expect(passRes.status).toBe(403);
    });
  });

  describe('Part B: Assistance Requests Lifecycle, Roles, and Transitions', () => {
    let testBooking;
    let seq = 100;

    beforeEach(async () => {
      testBooking = await createTestBooking({
        ref: `BK-AS${seq++}`,
        userId: passengerUser1.id,
        seatId: economySeat1,
        status: 'confirmed',
      });
    });

    it('creates assistance request and prevents duplicate open requests of same type', async () => {
      // 1. Create first request
      const res1 = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'wheelchair', notes: 'Foldable wheelchair' }),
      });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      expect(data1.request.type).toBe('wheelchair');
      expect(data1.request.status).toBe('requested');
      expect(data1.request.created_at).toBeDefined();

      // Verify Socket.IO emitted assistance:created
      expect(emittedEvents.some((e) => e.eventName === 'assistance:created')).toBe(true);

      // 2. Duplicate open request of same type must return 409 Conflict
      const res2 = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'wheelchair', notes: 'Second request attempt' }),
      });
      expect(res2.status).toBe(409);
      const data2 = await res2.json();
      expect(data2.error).toContain('already exists');
    });

    it('enforces ownership checks on creating and cancelling assistance requests', async () => {
      // User 2 cannot request assistance for User 1's booking
      const res1 = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass2}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'visual', notes: 'Unauthorized' }),
      });
      expect(res1.status).toBe(403);

      // Create valid request as User 1
      const createRes = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'hearing', notes: 'Sign language guidance' }),
      });
      const assistId = (await createRes.json()).request.id;

      // User 2 cannot cancel User 1's assistance request
      const cancelOtherRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenPass2}` },
      });
      expect(cancelOtherRes.status).toBe(403);
    });

    it('allows passenger cancellation only while still in requested status', async () => {
      // 1. Create request
      const createRes = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'elderly_support', notes: 'Need escort' }),
      });
      const assistId = (await createRes.json()).request.id;

      // 2. Advance to assigned
      await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenStaff1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'assigned' }),
      });

      // 3. Passenger attempts to cancel -> rejected with 409
      const cancelRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenPass1}` },
      });
      expect(cancelRes.status).toBe(409);
      const cancelData = await cancelRes.json();
      expect(cancelData.error).toContain('assigned');
    });

    it('handles full lifecycle: take (requested -> assigned), start (assigned -> in_progress), complete (in_progress -> completed)', async () => {
      const createRes = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'wheelchair', notes: 'Full lifecycle test' }),
      });
      const assistId = (await createRes.json()).request.id;

      // Step 1: Take it (requested -> assigned). Sets assigned_staff_id & assigned_at
      const takeRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenStaff1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'assigned' }),
      });
      expect(takeRes.status).toBe(200);
      const takeData = await takeRes.json();
      expect(takeData.request.status).toBe('assigned');
      expect(takeData.request.assigned_staff_id).toBe(groundCrew1.id);
      expect(takeData.request.assigned_at).toBeDefined();

      // Step 2: Unassigned staff (Staff 2) tries to start -> rejected with 403
      const unauthorizedStart = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenStaff2}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      expect(unauthorizedStart.status).toBe(403);

      // Step 3: Assigned staff (Staff 1) starts service (assigned -> in_progress)
      const startRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenStaff1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      expect(startRes.status).toBe(200);
      const startData = await startRes.json();
      expect(startData.request.status).toBe('in_progress');
      expect(startData.request.started_at).toBeDefined();

      // Step 4: Admin/Ops manager can complete service (in_progress -> completed)
      const completeRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenOps}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(completeRes.status).toBe(200);
      const completeData = await completeRes.json();
      expect(completeData.request.status).toBe('completed');
      expect(completeData.request.completed_at).toBeDefined();

      // Verify all timestamps are preserved in DB
      const dbCheck = await pool.query('SELECT * FROM assistance_request WHERE id = $1', [assistId]);
      const row = dbCheck.rows[0];
      expect(row.created_at).toBeDefined();
      expect(row.assigned_at).toBeDefined();
      expect(row.started_at).toBeDefined();
      expect(row.completed_at).toBeDefined();
    });

    it('rejects invalid state transitions with 409 Conflict', async () => {
      const createRes = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'visual', notes: 'Transition test' }),
      });
      const assistId = (await createRes.json()).request.id;

      // Cannot jump from requested straight to completed (409)
      const invalidJump = await fetch(`${baseUrl}/bookings/assistance/${assistId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenStaff1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(invalidJump.status).toBe(409);
    });

    it('allows admin/ops_manager to reassign staff', async () => {
      const createRes = await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'elderly_support' }),
      });
      const assistId = (await createRes.json()).request.id;

      const reassignRes = await fetch(`${baseUrl}/bookings/assistance/${assistId}/reassign`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenAdmin}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ staff_id: groundCrew2.id }),
      });

      expect(reassignRes.status).toBe(200);
      const data = await reassignRes.json();
      expect(data.request.assigned_staff_id).toBe(groundCrew2.id);
      expect(data.request.status).toBe('assigned');
      expect(data.assigned_staff.name).toBe('Staff Two');
    });

    it('staff queue endpoint GET /bookings/assistance/all returns passenger age and route', async () => {
      await fetch(`${baseUrl}/bookings/${testBooking.id}/assistance`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPass1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'medical' }),
      });

      const listRes = await fetch(`${baseUrl}/bookings/assistance/all?flight=AST-100`, {
        headers: { Authorization: `Bearer ${tokenStaff1}` },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.requests.length).toBeGreaterThan(0);

      const item = listData.requests[0];
      expect(item.flight_number).toBe('AST-100');
      expect(item.origin_code).toBe('AOR');
      expect(item.dest_code).toBe('ADS');
      expect(item.passenger_age).toBeGreaterThan(0);
    });
  });
});
