import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import { baggageRouter } from '../src/routes/baggage.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 10: Baggage Tracking & Status Pipeline Integration Tests', () => {
  let server;
  let baseUrl;

  // Test users
  let passengerUser1;
  let passengerUser2;
  let groundCrewUser;
  let opsManagerUser;
  let adminUser;

  // Auth tokens
  let passenger1Token;
  let passenger2Token;
  let groundCrewToken;
  let opsManagerToken;
  let adminToken;

  // Test reference data
  let testFlightActive;
  let testFlightCancelled;
  let testFlightDeparted;
  let testBookingCheckedIn1;
  let testBookingCheckedIn2;
  let testBookingConfirmed;
  let testBookingCancelledFlight;
  let testBookingDepartedFlight;

  beforeAll(async () => {
    // 1. Setup Express test server
    const app = express();
    app.use(express.json());
    app.use('/bookings', bookingsRouter);
    app.use('/baggage', baggageRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens with distinct IDs
    passenger1Token = signToken({ id: 881, role: 'passenger', email: 'bag_pass1@test.com' });
    passenger2Token = signToken({ id: 882, role: 'passenger', email: 'bag_pass2@test.com' });
    groundCrewToken = signToken({ id: 883, role: 'ground_crew', email: 'bag_crew@test.com' });
    opsManagerToken = signToken({ id: 884, role: 'ops_manager', email: 'bag_ops@test.com' });
    adminToken = signToken({ id: 885, role: 'admin', email: 'bag_admin@test.com' });

    // 3. Insert users
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         (881, 'Bag Passenger 1', 'bag_pass1@test.com', 'hash', 'passenger'),
         (882, 'Bag Passenger 2', 'bag_pass2@test.com', 'hash', 'passenger'),
         (883, 'Bag Crew', 'bag_crew@test.com', 'hash', 'ground_crew'),
         (884, 'Bag Ops', 'bag_ops@test.com', 'hash', 'ops_manager'),
         (885, 'Bag Admin', 'bag_admin@test.com', 'hash', 'admin')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`
    );

    // 4. Passenger records
    const p1Res = await pool.query(
      `INSERT INTO passenger (name, email) VALUES ('Bag Passenger 1', 'bag_pass1@test.com') RETURNING id`
    );
    const p2Res = await pool.query(
      `INSERT INTO passenger (name, email) VALUES ('Bag Passenger 2', 'bag_pass2@test.com') RETURNING id`
    );
    passengerUser1 = { id: 881, passengerId: p1Res.rows[0].id };
    passengerUser2 = { id: 882, passengerId: p2Res.rows[0].id };

    // 5. Airports and Aircraft
    const airRes = await pool.query("SELECT id, code FROM airport WHERE code IN ('DEL', 'BOM') ORDER BY code");
    const delId = airRes.rows.find((a) => a.code === 'DEL').id;
    const bomId = airRes.rows.find((a) => a.code === 'BOM').id;
    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    const actId = actRes.rows[0].id;

    // 6. Flights
    const fActRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('BG-ACT', $1, $2, $3, now() + INTERVAL '10 hours', now() + INTERVAL '12 hours', 'scheduled', 500000)
       RETURNING id, flight_number`,
      [actId, delId, bomId]
    );
    testFlightActive = fActRes.rows[0];

    const fCanRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('BG-CAN', $1, $2, $3, now() + INTERVAL '8 hours', now() + INTERVAL '10 hours', 'cancelled', 500000)
       RETURNING id, flight_number`,
      [actId, delId, bomId]
    );
    testFlightCancelled = fCanRes.rows[0];

    const fDepRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, actual_departure, status, base_price_cents)
       VALUES ('BG-DEP', $1, $2, $3, now() - INTERVAL '3 hours', now() - INTERVAL '1 hour', now() - INTERVAL '3 hours', 'departed', 500000)
       RETURNING id, flight_number`,
      [actId, delId, bomId]
    );
    testFlightDeparted = fDepRes.rows[0];

    // 7. Seats
    const sRes = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12A', 'economy', true) RETURNING id`,
      [testFlightActive.id]
    );
    const seatId = sRes.rows[0].id;

    // 8. Bookings
    const b1Res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BK-BGCHK1', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [passengerUser1.id, passengerUser1.passengerId, testFlightActive.id, seatId]
    );
    testBookingCheckedIn1 = b1Res.rows[0];

    const b2Res = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BK-BGCHK2', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [passengerUser2.id, passengerUser2.passengerId, testFlightActive.id, seatId]
    );
    testBookingCheckedIn2 = b2Res.rows[0];

    const bConfRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BK-BGCONF', $1, $2, $3, $4, 'confirmed', 500000)
       RETURNING id, booking_ref`,
      [passengerUser1.id, passengerUser1.passengerId, testFlightActive.id, seatId]
    );
    testBookingConfirmed = bConfRes.rows[0];

    const bCanRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BK-BGCAN', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [passengerUser1.id, passengerUser1.passengerId, testFlightCancelled.id, seatId]
    );
    testBookingCancelledFlight = bCanRes.rows[0];

    const bDepRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BK-BGDEP', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [passengerUser1.id, passengerUser1.passengerId, testFlightDeparted.id, seatId]
    );
    testBookingDepartedFlight = bDepRes.rows[0];
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up test rows
    await pool.query("DELETE FROM baggage WHERE booking_id IN (SELECT id FROM booking WHERE booking_ref LIKE 'BK-BG%')");
    await pool.query("DELETE FROM booking WHERE booking_ref LIKE 'BK-BG%'");
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'BG-%'");
    await pool.query('DELETE FROM passenger WHERE email LIKE \'bag_%@test.com\'');
    await pool.query('DELETE FROM "user" WHERE id IN (881, 882, 883, 884, 885)');
  });

  describe('1. Baggage Registration (POST /bookings/:id/baggage)', () => {
    it('successfully registers baggage for a checked-in booking by ground_crew (201)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({
          weight: 18.5,
          location: 'DEL Check-in Counter 04',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.booking_id).toBe(testBookingCheckedIn1.id);
      expect(data.status).toBe('checked_in');
      expect(parseFloat(data.weight)).toBe(18.5);
      expect(data.last_scanned_location).toBe('DEL Check-in Counter 04');
      // Tag is a 10-digit numeric string
      expect(data.tag_number).toMatch(/^\d{10}$/);

      // Verify scan record was created
      expect(data.scans).toHaveLength(1);
      expect(data.scans[0].status).toBe('checked_in');
      expect(data.scans[0].location).toBe('DEL Check-in Counter 04');
      expect(data.scans[0].scanned_by).toBe(883);
    });

    it('rejects weights outside the allowed range [0.1, 32.0] kg (400)', async () => {
      // 0 kg
      const resZero = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 0 }),
      });
      expect(resZero.status).toBe(400);

      // Negative weight
      const resNeg = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: -5.0 }),
      });
      expect(resNeg.status).toBe(400);

      // Overweight (> 32 kg)
      const resOver = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 32.1 }),
      });
      expect(resOver.status).toBe(400);
      const err = await resOver.json();
      expect(err.error).toContain('Weight must be between');
    });

    it('rejects registration when booking is not checked_in (409)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingConfirmed.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 15.0 }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Booking must be checked in');
    });

    it('rejects registration when flight is cancelled (409)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCancelledFlight.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 15.0 }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Cannot register baggage for departed or cancelled flight');
    });

    it('rejects registration when flight has departed (409)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingDepartedFlight.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 15.0 }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Cannot register baggage for departed or cancelled flight');
    });

    it('enforces maximum 3 bags limit per booking (409 on 4th bag)', async () => {
      // testBookingCheckedIn1 already has 1 bag. Register bag 2 and bag 3.
      const res2 = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 12.0 }),
      });
      expect(res2.status).toBe(201);

      const res3 = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 20.0 }),
      });
      expect(res3.status).toBe(201);

      // Attempting 4th bag must fail
      const res4 = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 10.0 }),
      });
      expect(res4.status).toBe(409);
      const err = await res4.json();
      expect(err.error).toContain('Maximum 3 bags allowed');
    });

    it('rejects registration by passenger role (403)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn2.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({ weight: 14.0 }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('2. Baggage Status Pipeline (PATCH /baggage/:id/status)', () => {
    let testBagId;
    let testBagTag;

    beforeAll(async () => {
      // Create a fresh bag on testBookingCheckedIn2 for testing transitions
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn2.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opsManagerToken}`,
        },
        body: JSON.stringify({
          weight: 22.0,
          location: 'DEL Baggage Induction',
        }),
      });
      const data = await res.json();
      testBagId = data.id;
      testBagTag = data.tag_number;
    });

    it('advances checked_in -> loaded with required location (200)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({
          status: 'loaded',
          location: 'DEL Gate 4 Ramp Area',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('loaded');
      expect(data.last_scanned_location).toBe('DEL Gate 4 Ramp Area');
      expect(data.scan.status).toBe('loaded');
      expect(data.scan.scanned_by).toBe(883);
    });

    it('advances loaded -> in_transit (200)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({
          status: 'in_transit',
          location: 'Aircraft Hold BG-ACT',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('in_transit');
      expect(data.last_scanned_location).toBe('Aircraft Hold BG-ACT');
    });

    it('advances in_transit -> arrived (200)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          status: 'arrived',
          location: 'BOM Baggage Carousel 2',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('arrived');
      expect(data.last_scanned_location).toBe('BOM Baggage Carousel 2');
    });

    it('rejects transitions out of terminal state arrived (409)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({
          status: 'loaded',
          location: 'Ramp',
        }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Cannot transition baggage status from "arrived" to "loaded"');
    });

    it('allows transition to lost from loaded state', async () => {
      // Create another bag on booking 2
      const createRes = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn2.id}/baggage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ weight: 15.0 }),
      });
      const bag = await createRes.json();

      // checked_in -> loaded
      await fetch(`${baseUrl}/baggage/${bag.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ status: 'loaded', location: 'Gate Ramp' }),
      });

      // loaded -> lost
      const lostRes = await fetch(`${baseUrl}/baggage/${bag.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opsManagerToken}`,
        },
        body: JSON.stringify({
          status: 'lost',
          location: 'Apron Inspection - Missing Tag',
        }),
      });

      expect(lostRes.status).toBe(200);
      const data = await lostRes.json();
      expect(data.status).toBe('lost');

      // Cannot transition out of terminal state lost
      const reviveRes = await fetch(`${baseUrl}/baggage/${bag.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ status: 'checked_in', location: 'Counter' }),
      });
      expect(reviveRes.status).toBe(409);
    });

    it('requires location for status transition (400)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({
          status: 'loaded',
          location: '',
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('3. Read Endpoints & Authorization', () => {
    let testBagTag;

    beforeAll(async () => {
      const { rows } = await pool.query(
        'SELECT tag_number FROM baggage WHERE booking_id = $1 LIMIT 1',
        [testBookingCheckedIn1.id]
      );
      testBagTag = rows[0].tag_number;
    });

    it('allows staff to lookup full baggage details & scan history by tag (GET /baggage/:tag)', async () => {
      const res = await fetch(`${baseUrl}/baggage/${testBagTag}`, {
        headers: { Authorization: `Bearer ${groundCrewToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tag_number).toBe(testBagTag);
      expect(data.booking_ref).toBe(testBookingCheckedIn1.booking_ref);
      expect(data.flight_number).toBe(testFlightActive.flight_number);
      expect(Array.isArray(data.scans)).toBe(true);
      expect(data.scans.length).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent tag (GET /baggage/:tag)', async () => {
      const res = await fetch(`${baseUrl}/baggage/9999999999`, {
        headers: { Authorization: `Bearer ${groundCrewToken}` },
      });
      expect(res.status).toBe(404);
    });

    it('allows passenger to list bags for their own booking (GET /bookings/:id/baggage)', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.baggage)).toBe(true);
      expect(data.baggage.length).toBeGreaterThan(0);
      expect(data.baggage[0].scans).toBeDefined();
    });

    it('returns 404 when passenger requests bags for another passenger booking', async () => {
      // Passenger 2 requests Passenger 1's booking
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        headers: { Authorization: `Bearer ${passenger2Token}` },
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Booking not found');
    });

    it('allows staff to view bags for any booking', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn1.id}/baggage`, {
        headers: { Authorization: `Bearer ${groundCrewToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.baggage.length).toBeGreaterThan(0);
    });

    it('allows staff to list baggage with filters & pagination (GET /baggage)', async () => {
      const res = await fetch(`${baseUrl}/baggage?status=all&limit=10&page=1`, {
        headers: { Authorization: `Bearer ${opsManagerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.total).toBe('number');
      expect(data.page).toBe(1);
    });

    it('rejects unauthorized passenger access to staff endpoints (403)', async () => {
      const resList = await fetch(`${baseUrl}/baggage`, {
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      expect(resList.status).toBe(403);

      const resTag = await fetch(`${baseUrl}/baggage/${testBagTag}`, {
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      expect(resTag.status).toBe(403);
    });
  });
});
