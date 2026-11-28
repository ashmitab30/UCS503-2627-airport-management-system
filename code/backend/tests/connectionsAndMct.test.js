import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/utils/jwt.js';
import { connectionsRouter } from '../src/routes/connections.js';
import { airportsRouter } from '../src/routes/airports.js';

describe('Task 6A: Connections & MCT Endpoints and Validation Tests', () => {
  let server;
  let baseUrl;
  let adminToken;
  let opsToken;
  let passengerToken;

  let testAirportA; // DEL
  let testAirportB; // BOM (Hub)
  let testAirportC; // BLR
  let testAircraftTypeId;

  let testUser1;
  let testUser2;

  let flightIn1;
  let flightOut1;
  let flightOutLate;
  let flightCancelled;
  let flightDeparted;
  let flightWrongDest;

  let bookingIn1;
  let bookingOut1;
  let bookingOutLate;
  let bookingUser2;
  let bookingPending;

  beforeAll(async () => {
    // 1. Setup ephemeral test server
    const app = express();
    app.use(express.json());
    app.use('/connections', connectionsRouter);
    app.use('/airports', airportsRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens
    adminToken = signToken({ id: 1, role: 'admin', email: 'admin@meridian.test' });
    opsToken = signToken({ id: 2, role: 'ops_manager', email: 'ops@meridian.test' });

    // 3. Airports (DEL, BOM hub, BLR)
    const apRes = await pool.query("SELECT id, code, min_connection_minutes FROM airport WHERE code IN ('DEL', 'BOM', 'BLR') ORDER BY code");
    testAirportBLR = apRes.rows.find((a) => a.code === 'BLR');
    testAirportBOM = apRes.rows.find((a) => a.code === 'BOM');
    testAirportDEL = apRes.rows.find((a) => a.code === 'DEL');

    testAirportA = testAirportDEL.id;
    testAirportB = testAirportBOM.id;
    testAirportC = testAirportBLR.id;

    // Aircraft type
    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    testAircraftTypeId = actRes.rows[0].id;

    // 4. Test Users
    const uRes1 = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('T6A User 1', 't6a_u1_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, role, email`
    );
    testUser1 = uRes1.rows[0];
    passengerToken = signToken({ id: testUser1.id, role: 'passenger', email: testUser1.email });

    const uRes2 = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('T6A User 2', 't6a_u2_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, role, email`
    );
    testUser2 = uRes2.rows[0];

    // Clean up any old T6A- flights
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'T6A-%'");

    // 5. Test Flights
    // Inbound: DEL -> BOM, departs 5 days from now, arrives 2h later
    const fInRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T6A-IN1', $1, $2, $3, now() + INTERVAL '5 days', now() + INTERVAL '5 days 2 hours', 'scheduled', 500000)
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportA, testAirportB]
    );
    flightIn1 = fInRes.rows[0];

    // Outbound: BOM -> BLR, departs 3h after inbound arrival
    const fOutRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T6A-OUT1', $1, $2, $3, now() + INTERVAL '5 days 5 hours', now() + INTERVAL '5 days 7 hours', 'scheduled', 450000)
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportB, testAirportC]
    );
    flightOut1 = fOutRes.rows[0];

    // Outbound chronologically impossible (departs before inbound arrives)
    const fOutLateRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T6A-OUT2', $1, $2, $3, now() + INTERVAL '5 days 1 hours', now() + INTERVAL '5 days 3 hours', 'scheduled', 450000)
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportB, testAirportC]
    );
    flightOutLate = fOutLateRes.rows[0];

    // Cancelled flight
    const fCanRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T6A-CAN', $1, $2, $3, now() + INTERVAL '5 days', now() + INTERVAL '5 days 2 hours', 'cancelled', 500000)
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportA, testAirportB]
    );
    flightCancelled = fCanRes.rows[0];

    // Departed flight (past)
    const fDepRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents, actual_departure)
       VALUES ('T6A-DEP', $1, $2, $3, now() - INTERVAL '10 hours', now() - INTERVAL '8 hours', 'departed', 500000, now() - INTERVAL '10 hours')
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportA, testAirportB]
    );
    flightDeparted = fDepRes.rows[0];

    // Flight with wrong destination (DEL -> DEL or DEL -> BLR, not connecting at BOM)
    const fWrongRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T6A-WRONG', $1, $2, $3, now() + INTERVAL '5 days', now() + INTERVAL '5 days 2 hours', 'scheduled', 500000)
       RETURNING id, flight_number`,
      [testAircraftTypeId, testAirportA, testAirportC] // dest is BLR, but outbound starts at BOM
    );
    flightWrongDest = fWrongRes.rows[0];

    // 6. Test Bookings
    const bIn1Res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, status, price_cents)
       VALUES ('T6ABIN1', $1, $2, 'confirmed', 500000)
       RETURNING id`,
      [testUser1.id, flightIn1.id]
    );
    bookingIn1 = bIn1Res.rows[0];

    const bOut1Res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, status, price_cents)
       VALUES ('T6ABOUT1', $1, $2, 'confirmed', 450000)
       RETURNING id`,
      [testUser1.id, flightOut1.id]
    );
    bookingOut1 = bOut1Res.rows[0];

    const bOutLateRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, status, price_cents)
       VALUES ('T6ABOUTL', $1, $2, 'confirmed', 450000)
       RETURNING id`,
      [testUser1.id, flightOutLate.id]
    );
    bookingOutLate = bOutLateRes.rows[0];

    const bU2Res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, status, price_cents)
       VALUES ('T6ABU2', $1, $2, 'confirmed', 450000)
       RETURNING id`,
      [testUser2.id, flightOut1.id]
    );
    bookingUser2 = bU2Res.rows[0];

    const bPendRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, flight_id, status, price_cents)
       VALUES ('T6ABPEND', $1, $2, 'held', 450000)
       RETURNING id`,
      [testUser1.id, flightOut1.id]
    );
    bookingPending = bPendRes.rows[0];
  });

  let testAirportBLR, testAirportBOM, testAirportDEL;

  afterAll(async () => {
    // Cleanup
    if (testUser1?.id || testUser2?.id) {
      const uIds = [testUser1?.id, testUser2?.id].filter(Boolean);
      await pool.query('DELETE FROM connection WHERE passenger_id = ANY($1)', [uIds]);
      await pool.query('DELETE FROM booking WHERE user_id = ANY($1)', [uIds]);
      await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [uIds]);
    }
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'T6A-%'");

    // Restore BOM MCT
    await pool.query("UPDATE airport SET min_connection_minutes = 45 WHERE code = 'BOM'");

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('POST /connections (HTTP route)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects passenger users with 403', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passengerToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('creates a connecting itinerary when called by admin (201)', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.connection).toBeDefined();
      expect(data.connection.inbound_flight_id).toBe(flightIn1.id);
      expect(data.connection.outbound_flight_id).toBe(flightOut1.id);
      expect(data.connection.inbound_booking_id).toBe(bookingIn1.id);
      expect(data.connection.outbound_booking_id).toBe(bookingOut1.id);
    });

    it('rejects duplicate connection with 409', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/already exists/i);
    });

    it('rejects non-existent flight with 404', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: 999999,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(404);
    });

    it('rejects cancelled flight with 409', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightCancelled.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/cancelled or has already departed/i);
    });

    it('rejects departed flight with 409', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightDeparted.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/cancelled or has already departed/i);
    });

    it('rejects route mismatch (inbound dest != outbound origin) with 400', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightWrongDest.id, // dest is BLR, but outbound origin is BOM
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/must match outbound origin/i);
    });

    it('rejects outbound flight departing before or at inbound arrival with 400', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOutLate.id, // departs before inbound arrives
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingOutLate.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/must be after inbound arrival/i);
    });

    it('rejects non-existent booking with 404', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: 999999,
          outbound_booking_id: bookingOut1.id,
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(404);
    });

    it('rejects booking belonging to different passenger with 400', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id, // User 1
          outbound_booking_id: bookingUser2.id, // User 2
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/same passenger/i);
    });

    it('rejects unconfirmed booking with 400', async () => {
      const res = await fetch(`${baseUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          inbound_flight_id: flightIn1.id,
          outbound_flight_id: flightOut1.id,
          inbound_booking_id: bookingIn1.id,
          outbound_booking_id: bookingPending.id, // held, not confirmed
          passenger_id: testUser1.id,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/confirmed/i);
    });
  });

  describe('DELETE /connections/:id (unlink)', () => {
    let connectionToUnlinkId;

    beforeAll(async () => {
      // Find the connection created in the previous test
      const cRes = await pool.query(
        'SELECT id FROM connection WHERE inbound_flight_id = $1 AND outbound_flight_id = $2',
        [flightIn1.id, flightOut1.id]
      );
      connectionToUnlinkId = cRes.rows[0].id;
    });

    it('rejects passenger with 403', async () => {
      const res = await fetch(`${baseUrl}/connections/${connectionToUnlinkId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${passengerToken}`,
        },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 for unknown connection id', async () => {
      const res = await fetch(`${baseUrl}/connections/999999`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      expect(res.status).toBe(404);
    });

    it('unlinks connection successfully without cancelling either booking (200)', async () => {
      const res = await fetch(`${baseUrl}/connections/${connectionToUnlinkId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${opsToken}`, // ops_manager is also allowed
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.unlinked_connection_id).toBe(connectionToUnlinkId);

      // Verify connection row is gone
      const connCheck = await pool.query('SELECT id FROM connection WHERE id = $1', [connectionToUnlinkId]);
      expect(connCheck.rows.length).toBe(0);

      // Verify both bookings STILL exist with status confirmed
      const bCheck = await pool.query('SELECT id, status FROM booking WHERE id IN ($1, $2)', [
        bookingIn1.id,
        bookingOut1.id,
      ]);
      expect(bCheck.rows.length).toBe(2);
      expect(bCheck.rows[0].status).toBe('confirmed');
      expect(bCheck.rows[1].status).toBe('confirmed');
    });
  });

  describe('PATCH /airports/:id/mct (MCT Editor)', () => {
    it('rejects non-admin (e.g. passenger) with 403', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passengerToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 50 }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects ops_manager with 403 (admin only)', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opsToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 50 }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects MCT < 15 with 400', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 10 }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects MCT > 240 with 400', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 300 }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects non-integer MCT with 400', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 45.5 }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects unknown airport with 404', async () => {
      const res = await fetch(`${baseUrl}/airports/999999/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 55 }),
      });
      expect(res.status).toBe(404);
    });

    it('successfully updates MCT and returns updated airport (200)', async () => {
      const res = await fetch(`${baseUrl}/airports/${testAirportB}/mct`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ min_connection_minutes: 75 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.airport).toBeDefined();
      expect(data.airport.min_connection_minutes).toBe(75);

      const dbCheck = await pool.query('SELECT min_connection_minutes FROM airport WHERE id = $1', [testAirportB]);
      expect(dbCheck.rows[0].min_connection_minutes).toBe(75);
    });
  });

  describe('GET /airports', () => {
    it('returns min_connection_minutes on airport objects', async () => {
      const res = await fetch(`${baseUrl}/airports`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.airports)).toBe(true);
      expect(data.airports.length).toBeGreaterThan(0);
      const first = data.airports[0];
      expect(first).toHaveProperty('min_connection_minutes');
      expect(typeof first.min_connection_minutes).toBe('number');
    });
  });

  describe('GET /connections/admin/at-risk', () => {
    it('returns hubs array alongside metrics and connections', async () => {
      const res = await fetch(`${baseUrl}/connections/admin/at-risk`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics).toBeDefined();
      expect(data.connections).toBeDefined();
      expect(Array.isArray(data.hubs)).toBe(true);

      // Verify hub shape
      if (data.hubs.length > 0) {
        const hub = data.hubs[0];
        expect(hub).toHaveProperty('id');
        expect(hub).toHaveProperty('code');
        expect(hub).toHaveProperty('name');
        expect(hub).toHaveProperty('min_connection_minutes');
      }
    });
  });
});
