import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/utils/jwt.js';
import { connectionsRouter } from '../src/routes/connections.js';
import { generateSeatsForFlight } from '../src/services/seatService.js';

describe('Task 8: Rebooking Fare Difference, Refund, and Passenger Link Tests', () => {
  let server;
  let baseUrl;
  let passenger1Token;
  let passenger2Token;
  let adminToken;

  let user1;
  let user2;
  let adminUser;
  let passenger1Record;
  let passenger2Record;

  let airportDel;
  let airportBom;
  let airportBlr;
  let aircraftType;

  beforeAll(async () => {
    // 1. Setup ephemeral test server
    const app = express();
    app.use(express.json());
    app.use('/connections', connectionsRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Load reference airports and aircraft type
    const delRes = await pool.query("SELECT id FROM airport WHERE code = 'DEL'");
    const bomRes = await pool.query("SELECT id FROM airport WHERE code = 'BOM'");
    const blrRes = await pool.query("SELECT id FROM airport WHERE code = 'BLR'");
    airportDel = delRes.rows[0].id;
    airportBom = bomRes.rows[0].id;
    airportBlr = blrRes.rows[0].id;

    const atRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    aircraftType = atRes.rows[0].id;

    // 3. Create test users
    const u1Res = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('User Eight-One', 't8_p1_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email, role`
    );
    user1 = u1Res.rows[0];
    passenger1Token = signToken(user1);

    const u2Res = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('User Eight-Two', 't8_p2_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email, role`
    );
    user2 = u2Res.rows[0];
    passenger2Token = signToken(user2);

    const admRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Admin Eight', 't8_adm_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'admin')
       RETURNING id, name, email, role`
    );
    adminUser = admRes.rows[0];
    adminToken = signToken(adminUser);

    const p1Res = await pool.query(
      `INSERT INTO passenger (name, email)
       VALUES ($1, $2)
       RETURNING id`,
      [user1.name, user1.email]
    );
    passenger1Record = p1Res.rows[0];

    const p2Res = await pool.query(
      `INSERT INTO passenger (name, email)
       VALUES ($1, $2)
       RETURNING id`,
      [user2.name, user2.email]
    );
    passenger2Record = p2Res.rows[0];
  });

  afterAll(async () => {
    // Comprehensive test cleanup
    const uIds = [user1?.id, user2?.id, adminUser?.id].filter(Boolean);
    const pIds = [passenger1Record?.id, passenger2Record?.id].filter(Boolean);

    if (uIds.length > 0) {
      await pool.query(
        `DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE user_id = ANY($1))`,
        [uIds]
      );
      await pool.query(`DELETE FROM connection WHERE passenger_id = ANY($1)`, [uIds]);
      await pool.query(`DELETE FROM booking WHERE user_id = ANY($1)`, [uIds]);
      await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [uIds]);
    }
    if (pIds.length > 0) {
      await pool.query(`DELETE FROM passenger WHERE id = ANY($1)`, [pIds]);
    }

    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'T8-%'");

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Helper to create a flight with seats (flight_number max 10 chars)
  async function createTestFlight({ flightNumber, originId, destId, depOffsetHours, arrOffsetHours, basePriceCents, status = 'scheduled' }) {
    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, base_price_cents, status)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, now() + ($6 || ' hours')::interval, $7, $8)
       RETURNING *`,
      [flightNumber, aircraftType, originId, destId, depOffsetHours, arrOffsetHours, basePriceCents, status]
    );
    const flight = fRes.rows[0];
    await generateSeatsForFlight(flight.id, aircraftType, pool);
    return flight;
  }

  // Helper to create a confirmed booking + payment (booking_ref max 10 chars)
  async function createTestBooking({ userId, passengerId, flightId, priceCents, seatClass = 'economy', status = 'confirmed' }) {
    const seatRes = await pool.query(
      'SELECT id FROM seat WHERE flight_id = $1 AND class = $2 AND is_booked = false LIMIT 1',
      [flightId, seatClass]
    );
    const seatId = seatRes.rows[0]?.id;
    if (seatId) {
      await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);
    }

    const bRef = 'T8' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const bRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [bRef, userId, passengerId, flightId, seatId, status, priceCents]
    );
    const booking = bRes.rows[0];

    // Create payment row
    const pRes = await pool.query(
      `INSERT INTO payment (booking_id, amount, status, method)
       VALUES ($1, $2, 'success', 'mock_card')
       RETURNING *`,
      [booking.id, (priceCents / 100).toFixed(2)]
    );

    return { booking, payment: pRes.rows[0], seatId };
  }

  // Helper to create a connection record
  async function createTestConnection({ inboundFlightId, outboundFlightId, passengerId, inboundBookingId, outboundBookingId, mct = 45, status = 'missed' }) {
    const cRes = await pool.query(
      `INSERT INTO connection (inbound_flight_id, outbound_flight_id, passenger_id,
                               min_connection_minutes, actual_connection_minutes, status,
                               inbound_booking_id, outbound_booking_id)
       VALUES ($1, $2, $3, $4, 10, $5, $6, $7)
       RETURNING *`,
      [inboundFlightId, outboundFlightId, passengerId, mct, status, inboundBookingId, outboundBookingId]
    );
    return cRes.rows[0];
  }

  describe('Part A: Rebooking Fare Difference and Refund', () => {
    it('handles rebooking with higher fare: charges difference, sets status success, reconciles totals', async () => {
      // Old outbound price = ₹4,500 (450000 paise)
      // New flight base price = ₹6,000 (600000 paise)
      // Expected diff = +₹1,500 (+150000 paise)
      const flightIn = await createTestFlight({
        flightNumber: 'T8-HIN',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 20,
        arrOffsetHours: 22,
        basePriceCents: 500000,
      });

      const flightOutOld = await createTestFlight({
        flightNumber: 'T8-HOUT1',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 23,
        arrOffsetHours: 25,
        basePriceCents: 450000,
      });

      const flightOutNew = await createTestFlight({
        flightNumber: 'T8-HOUT2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 25,
        arrOffsetHours: 27,
        basePriceCents: 600000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOutOld, payment: payOld } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOutOld.id,
        priceCents: 450000,
      });

      const conn = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOutOld.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOutOld.id,
        status: 'missed',
      });

      // Check rebooking options first
      const optRes = await fetch(`${baseUrl}/connections/${conn.id}/rebooking-options`, {
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      expect(optRes.status).toBe(200);
      const optData = await optRes.json();
      expect(optData.options.length).toBeGreaterThan(0);
      const chosenOpt = optData.options.find((o) => o.id === flightOutNew.id);
      expect(chosenOpt).toBeDefined();
      expect(chosenOpt.old_fare_cents).toBe(450000);
      expect(chosenOpt.new_fare_cents).toBe(600000);
      expect(chosenOpt.fare_difference_cents).toBe(150000);

      // Select seat on new flight
      const sRes = await pool.query("SELECT id FROM seat WHERE flight_id = $1 AND class = 'economy' AND is_booked = false LIMIT 1", [flightOutNew.id]);
      const newSeatId = sRes.rows[0].id;

      // Execute rebooking
      const rebookRes = await fetch(`${baseUrl}/connections/${conn.id}/rebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          flight_id: flightOutNew.id,
          seat_id: newSeatId,
        }),
      });

      expect(rebookRes.status).toBe(200);
      const rebookData = await rebookRes.json();
      expect(rebookData.ok).toBe(true);
      expect(rebookData.fare_difference_cents).toBe(150000);
      expect(rebookData.payment_summary).toEqual(
        expect.objectContaining({
          action: 'charged',
          status: 'success',
          amount_cents: 150000,
          amount_rupees: 1500,
        })
      );
      expect(rebookData.newBooking.price_cents).toBe(600000);

      // Verify payment rows in database
      const { rows: payRows } = await pool.query(
        'SELECT amount, status FROM payment WHERE booking_id = $1',
        [rebookData.newBooking.id]
      );
      expect(payRows).toHaveLength(1);
      expect(payRows[0].status).toBe('success');
      expect(Number(payRows[0].amount)).toBe(1500);

      // Verify financial reconciliation across old and new booking:
      // money paid minus money refunded = new_fare
      const { rows: reconRows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::numeric AS total_paid,
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric AS total_refunded
         FROM payment
        WHERE booking_id IN ($1, $2)`,
        [bOutOld.id, rebookData.newBooking.id]
      );
      const netPaidRupees = Number(reconRows[0].total_paid) - Number(reconRows[0].total_refunded);
      expect(netPaidRupees).toBe(6000); // 4500 (old) + 1500 (new) - 0 = 6000
    });

    it('handles rebooking with lower fare: refunds difference, sets status refunded, reconciles totals', async () => {
      // Old outbound price = ₹5,500 (550000 paise)
      // New flight base price = ₹4,000 (400000 paise)
      // Expected diff = -₹1,500 (-150000 paise)
      const flightIn = await createTestFlight({
        flightNumber: 'T8-LIN',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 30,
        arrOffsetHours: 32,
        basePriceCents: 500000,
      });

      const flightOutOld = await createTestFlight({
        flightNumber: 'T8-LOUT1',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 33,
        arrOffsetHours: 35,
        basePriceCents: 550000,
      });

      const flightOutNew = await createTestFlight({
        flightNumber: 'T8-LOUT2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 35,
        arrOffsetHours: 37,
        basePriceCents: 400000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOutOld } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOutOld.id,
        priceCents: 550000,
      });

      const conn = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOutOld.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOutOld.id,
        status: 'missed',
      });

      // Rebooking options
      const optRes = await fetch(`${baseUrl}/connections/${conn.id}/rebooking-options`, {
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      const optData = await optRes.json();
      const chosenOpt = optData.options.find((o) => o.id === flightOutNew.id);
      expect(chosenOpt).toBeDefined();
      expect(chosenOpt.old_fare_cents).toBe(550000);
      expect(chosenOpt.new_fare_cents).toBe(400000);
      expect(chosenOpt.fare_difference_cents).toBe(-150000);

      const sRes = await pool.query("SELECT id FROM seat WHERE flight_id = $1 AND class = 'economy' AND is_booked = false LIMIT 1", [flightOutNew.id]);
      const newSeatId = sRes.rows[0].id;

      // Execute rebooking
      const rebookRes = await fetch(`${baseUrl}/connections/${conn.id}/rebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          flight_id: flightOutNew.id,
          seat_id: newSeatId,
        }),
      });

      expect(rebookRes.status).toBe(200);
      const rebookData = await rebookRes.json();
      expect(rebookData.ok).toBe(true);
      expect(rebookData.fare_difference_cents).toBe(-150000);
      expect(rebookData.payment_summary).toEqual(
        expect.objectContaining({
          action: 'refunded',
          status: 'refunded',
          amount_cents: 150000,
          amount_rupees: 1500,
        })
      );
      expect(rebookData.newBooking.price_cents).toBe(400000);

      // Verify refund payment row in database
      const { rows: payRows } = await pool.query(
        'SELECT amount, status FROM payment WHERE booking_id = $1',
        [rebookData.newBooking.id]
      );
      expect(payRows).toHaveLength(1);
      expect(payRows[0].status).toBe('refunded');
      expect(Number(payRows[0].amount)).toBe(1500);

      // Verify financial reconciliation:
      // money paid (5500) minus money refunded (1500) = 4000 = new_fare
      const { rows: reconRows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::numeric AS total_paid,
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric AS total_refunded
         FROM payment
        WHERE booking_id IN ($1, $2)`,
        [bOutOld.id, rebookData.newBooking.id]
      );
      const netPaidRupees = Number(reconRows[0].total_paid) - Number(reconRows[0].total_refunded);
      expect(netPaidRupees).toBe(4000);
    });

    it('handles rebooking with equal fare: creates no new payment row, reconciles totals', async () => {
      // Old outbound price = ₹4,500 (450000 paise)
      // New flight base price = ₹4,500 (450000 paise)
      // Expected diff = 0
      const flightIn = await createTestFlight({
        flightNumber: 'T8-EIN',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 40,
        arrOffsetHours: 42,
        basePriceCents: 500000,
      });

      const flightOutOld = await createTestFlight({
        flightNumber: 'T8-EOUT1',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 43,
        arrOffsetHours: 45,
        basePriceCents: 450000,
      });

      const flightOutNew = await createTestFlight({
        flightNumber: 'T8-EOUT2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 45,
        arrOffsetHours: 47,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOutOld } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOutOld.id,
        priceCents: 450000,
      });

      const conn = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOutOld.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOutOld.id,
        status: 'missed',
      });

      const sRes = await pool.query("SELECT id FROM seat WHERE flight_id = $1 AND class = 'economy' AND is_booked = false LIMIT 1", [flightOutNew.id]);
      const newSeatId = sRes.rows[0].id;

      const rebookRes = await fetch(`${baseUrl}/connections/${conn.id}/rebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          flight_id: flightOutNew.id,
          seat_id: newSeatId,
        }),
      });

      expect(rebookRes.status).toBe(200);
      const rebookData = await rebookRes.json();
      expect(rebookData.ok).toBe(true);
      expect(rebookData.fare_difference_cents).toBe(0);
      expect(rebookData.payment_summary).toEqual({
        action: 'none',
        amount_cents: 0,
        amount_rupees: 0,
        status: 'no_difference',
      });
      expect(rebookData.newBooking.price_cents).toBe(450000);

      // No new payment row created
      const { rows: payRows } = await pool.query(
        'SELECT * FROM payment WHERE booking_id = $1',
        [rebookData.newBooking.id]
      );
      expect(payRows).toHaveLength(0);

      // Financial reconciliation: total paid (4500) - refunded (0) = 4500
      const { rows: reconRows } = await pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::numeric AS total_paid,
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::numeric AS total_refunded
         FROM payment
        WHERE booking_id IN ($1, $2)`,
        [bOutOld.id, rebookData.newBooking.id]
      );
      expect(Number(reconRows[0].total_paid) - Number(reconRows[0].total_refunded)).toBe(4500);
    });

    it('refuses rebooking for someone else connection (403 Forbidden)', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-AIN',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 50,
        arrOffsetHours: 52,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-AOUT',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 53,
        arrOffsetHours: 55,
        basePriceCents: 450000,
      });

      const flightAlt = await createTestFlight({
        flightNumber: 'T8-AALT',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 55,
        arrOffsetHours: 57,
        basePriceCents: 500000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const connUser1 = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOut.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOut.id,
      });

      const sRes = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [flightAlt.id]);
      const newSeatId = sRes.rows[0].id;

      // User 2 tries to rebook User 1's connection
      const res = await fetch(`${baseUrl}/connections/${connUser1.id}/rebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger2Token}`,
        },
        body: JSON.stringify({
          flight_id: flightAlt.id,
          seat_id: newSeatId,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/permission/i);

      // User 2 also cannot view User 1's rebooking options
      const optRes = await fetch(`${baseUrl}/connections/${connUser1.id}/rebooking-options`, {
        headers: { Authorization: `Bearer ${passenger2Token}` },
      });
      expect(optRes.status).toBe(403);
    });
  });

  describe('Part B: Passenger Link and Unlink Connection Endpoints', () => {
    it('allows passenger to link their own valid confirmed bookings (POST /connections/mine)', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-PIN',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 60,
        arrOffsetHours: 62,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-POUT',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 64, // 2h layover vs 45m MCT
        arrOffsetHours: 66,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const res = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bIn.id,
          outbound_booking_id: bOut.id,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.connection).toBeDefined();
      expect(data.connection.passenger_id).toBe(user1.id);
      expect(data.connection.inbound_booking_id).toBe(bIn.id);
      expect(data.connection.outbound_booking_id).toBe(bOut.id);
      expect(data.connection.status).toBe('on_track');
    });

    it('refuses passenger linking someone else bookings (403 Forbidden)', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-FBD1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 70,
        arrOffsetHours: 72,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-FBD2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 74,
        arrOffsetHours: 76,
        basePriceCents: 450000,
      });

      // bIn belongs to user1, bOut belongs to user2
      const { booking: bInUser1 } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOutUser2 } = await createTestBooking({
        userId: user2.id,
        passengerId: passenger2Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      // User 1 attempts to link booking belonging to User 2
      const res = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bInUser1.id,
          outbound_booking_id: bOutUser2.id,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/own bookings/i);
    });

    it('rejects passenger linking non-existent booking with 404', async () => {
      const res = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: 999999,
          outbound_booking_id: 888888,
        }),
      });

      expect(res.status).toBe(404);
    });

    it('rejects passenger linking when route hub does not match with 400', async () => {
      // Inbound arrives at BOM, but outbound departs from DEL
      const flightIn = await createTestFlight({
        flightNumber: 'T8-W1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 80,
        arrOffsetHours: 82,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-W2',
        originId: airportDel, // Mismatch!
        destId: airportBlr,
        depOffsetHours: 84,
        arrOffsetHours: 86,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const res = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bIn.id,
          outbound_booking_id: bOut.id,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/match/i);
    });

    it('rejects passenger linking when outbound departs before inbound arrives with 400', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-T1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 90,
        arrOffsetHours: 94,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-T2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 92, // Departs at 92h, while inbound arrives at 94h!
        arrOffsetHours: 95,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const res = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bIn.id,
          outbound_booking_id: bOut.id,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/after/i);
    });

    it('rejects passenger linking duplicate connection with 409', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-D1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 100,
        arrOffsetHours: 102,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-D2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 104,
        arrOffsetHours: 106,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      // Link first time -> succeeds
      const res1 = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bIn.id,
          outbound_booking_id: bOut.id,
        }),
      });
      expect(res1.status).toBe(201);

      // Link second time -> 409 Conflict
      const res2 = await fetch(`${baseUrl}/connections/mine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passenger1Token}`,
        },
        body: JSON.stringify({
          inbound_booking_id: bIn.id,
          outbound_booking_id: bOut.id,
        }),
      });
      expect(res2.status).toBe(409);
    });

    it('allows passenger to unlink their own connection (DELETE /connections/mine/:id) leaving bookings intact', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-U1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 110,
        arrOffsetHours: 112,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-U2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 114,
        arrOffsetHours: 116,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const conn = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOut.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOut.id,
      });

      const res = await fetch(`${baseUrl}/connections/mine/${conn.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toMatch(/unlinked/i);

      // Verify connection row is gone
      const { rows: connCheck } = await pool.query('SELECT * FROM connection WHERE id = $1', [conn.id]);
      expect(connCheck).toHaveLength(0);

      // Verify individual bookings remain confirmed and untouched
      const { rows: bCheck } = await pool.query(
        'SELECT id, status FROM booking WHERE id IN ($1, $2)',
        [bIn.id, bOut.id]
      );
      expect(bCheck).toHaveLength(2);
      expect(bCheck[0].status).toBe('confirmed');
      expect(bCheck[1].status).toBe('confirmed');
    });

    it('refuses passenger unlinking someone else connection (403 Forbidden)', async () => {
      const flightIn = await createTestFlight({
        flightNumber: 'T8-UA1',
        originId: airportDel,
        destId: airportBom,
        depOffsetHours: 120,
        arrOffsetHours: 122,
        basePriceCents: 500000,
      });

      const flightOut = await createTestFlight({
        flightNumber: 'T8-UA2',
        originId: airportBom,
        destId: airportBlr,
        depOffsetHours: 124,
        arrOffsetHours: 126,
        basePriceCents: 450000,
      });

      const { booking: bIn } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightIn.id,
        priceCents: 500000,
      });

      const { booking: bOut } = await createTestBooking({
        userId: user1.id,
        passengerId: passenger1Record.id,
        flightId: flightOut.id,
        priceCents: 450000,
      });

      const conn = await createTestConnection({
        inboundFlightId: flightIn.id,
        outboundFlightId: flightOut.id,
        passengerId: user1.id,
        inboundBookingId: bIn.id,
        outboundBookingId: bOut.id,
      });

      // User 2 tries to unlink User 1's connection
      const res = await fetch(`${baseUrl}/connections/mine/${conn.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${passenger2Token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toMatch(/own connection/i);
    });

    it('returns 404 when unlinking non-existent connection', async () => {
      const res = await fetch(`${baseUrl}/connections/mine/999999`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${passenger1Token}` },
      });
      expect(res.status).toBe(404);
    });
  });
});
