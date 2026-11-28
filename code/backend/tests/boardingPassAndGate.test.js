import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import { verifyRouter } from '../src/routes/verify.js';
import { gateRouter } from '../src/routes/gate.js';
import {
  signBookingRef,
  verifyBookingSignature,
  buildVerificationUrl,
  parseVerificationInput,
} from '../src/services/qrSignService.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 7: Signed Boarding Pass, Public Verification & Gate Boarding Tests', () => {
  let server;
  let baseUrl;

  let testUser;
  let testPassenger;
  let testFlight;
  let testSeat;
  let testBookingConfirmed;
  let testBookingCheckedIn;
  let testBookingBoarded;
  let testCancelledFlight;
  let testBookingCancelledFlight;
  let testDepartedFlight;
  let testBookingDepartedFlight;

  let passengerToken;
  let groundCrewToken;
  let opsManagerToken;
  let adminToken;

  beforeAll(async () => {
    // 1. Setup ephemeral Express test server
    const app = express();
    app.use(express.json());
    app.use('/bookings', bookingsRouter);
    app.use('/verify', verifyRouter);
    app.use('/gate', gateRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens
    passengerToken = signToken({ id: 991, role: 'passenger', email: 't7_pass@meridian.test' });
    groundCrewToken = signToken({ id: 992, role: 'ground_crew', email: 't7_crew@meridian.test' });
    opsManagerToken = signToken({ id: 993, role: 'ops_manager', email: 't7_ops@meridian.test' });
    adminToken = signToken({ id: 994, role: 'admin', email: 't7_admin@meridian.test' });

    // 3. Create test user and passenger
    const uRes = await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES (991, 'Alexander Wright', 't7_pass@meridian.test', 'hash', 'passenger')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email`
    );
    testUser = uRes.rows[0];

    const pRes = await pool.query(
      `INSERT INTO passenger (name, email)
       VALUES ('Alexander Wright', 't7_pass@meridian.test')
       RETURNING id`
    );
    testPassenger = pRes.rows[0];

    // 4. Fetch reference airports and aircraft type
    const apRes = await pool.query("SELECT id FROM airport WHERE code IN ('DEL', 'BOM') ORDER BY code");
    const originId = apRes.rows[0].id;
    const destId = apRes.rows[1].id;

    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    const actId = actRes.rows[0].id;

    // 5. Create test flights
    // Active scheduled flight (departure in 4 hours)
    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T7-101', $1, $2, $3, now() + INTERVAL '4 hours', now() + INTERVAL '6 hours', 'scheduled', 500000)
       RETURNING id, flight_number`,
      [actId, originId, destId]
    );
    testFlight = fRes.rows[0];

    // Cancelled flight
    const fCanRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T7-CAN', $1, $2, $3, now() + INTERVAL '4 hours', now() + INTERVAL '6 hours', 'cancelled', 500000)
       RETURNING id, flight_number`,
      [actId, originId, destId]
    );
    testCancelledFlight = fCanRes.rows[0];

    // Departed flight
    const fDepRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, actual_departure, status, base_price_cents)
       VALUES ('T7-DEP', $1, $2, $3, now() - INTERVAL '3 hours', now() - INTERVAL '1 hour', now() - INTERVAL '3 hours', 'departed', 500000)
       RETURNING id, flight_number`,
      [actId, originId, destId]
    );
    testDepartedFlight = fDepRes.rows[0];

    // 6. Create seats
    const sRes = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '04F', 'business', true)
       RETURNING id`,
      [testFlight.id]
    );
    testSeat = sRes.rows[0];

    // 7. Create bookings with different statuses
    // Confirmed booking (not checked in yet)
    const bConfRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('T7CONF1', $1, $2, $3, $4, 'confirmed', 500000)
       RETURNING id, booking_ref`,
      [testUser.id, testPassenger.id, testFlight.id, testSeat.id]
    );
    testBookingConfirmed = bConfRes.rows[0];

    // Checked-in booking (ready for boarding)
    const bChkRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('T7CHKD1', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [testUser.id, testPassenger.id, testFlight.id, testSeat.id]
    );
    testBookingCheckedIn = bChkRes.rows[0];

    // Already boarded booking
    const bBrdRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('T7BRDD1', $1, $2, $3, $4, 'boarded', 500000)
       RETURNING id, booking_ref`,
      [testUser.id, testPassenger.id, testFlight.id, testSeat.id]
    );
    testBookingBoarded = bBrdRes.rows[0];

    // Booking on cancelled flight
    const bCanRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('T7BGCAN', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [testUser.id, testPassenger.id, testCancelledFlight.id, testSeat.id]
    );
    testBookingCancelledFlight = bCanRes.rows[0];

    // Booking on departed flight
    const bDepRes = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('T7BGDEP', $1, $2, $3, $4, 'checked_in', 500000)
       RETURNING id, booking_ref`,
      [testUser.id, testPassenger.id, testDepartedFlight.id, testSeat.id]
    );
    testBookingDepartedFlight = bDepRes.rows[0];
  });

  afterAll(async () => {
    // Clean up all created test data
    await pool.query("DELETE FROM booking WHERE booking_ref LIKE 'T7%'");
    await pool.query("DELETE FROM seat WHERE flight_id IN (SELECT id FROM flight WHERE flight_number LIKE 'T7-%')");
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'T7-%'");
    if (testPassenger) {
      await pool.query('DELETE FROM passenger WHERE id = $1', [testPassenger.id]);
    }
    if (testUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. QR Signing Service Unit Tests', () => {
    it('computes consistent HMAC-SHA256 signature and verification URL', () => {
      const sig = signBookingRef('T7CHKD1');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);

      const url = buildVerificationUrl('T7CHKD1', undefined, 'http://localhost:5173');
      expect(url).toBe(`http://localhost:5173/verify/T7CHKD1?sig=${sig}`);
    });

    it('validates a correct signature using timingSafeEqual', () => {
      const sig = signBookingRef('T7CHKD1');
      expect(verifyBookingSignature('T7CHKD1', sig)).toBe(true);
    });

    it('rejects tampered booking reference', () => {
      const sig = signBookingRef('T7CHKD1');
      expect(verifyBookingSignature('T7TAMPERED', sig)).toBe(false);
    });

    it('rejects tampered signature', () => {
      const sig = signBookingRef('T7CHKD1');
      const tamperedSig = sig.substring(0, sig.length - 2) + '00';
      expect(verifyBookingSignature('T7CHKD1', tamperedSig)).toBe(false);
    });

    it('rejects signature computed with wrong secret', () => {
      const wrongSecretSig = signBookingRef('T7CHKD1', 'wrong_secret_12345');
      expect(verifyBookingSignature('T7CHKD1', wrongSecretSig)).toBe(false);
    });

    it('parseVerificationInput parses full URLs and query strings', () => {
      const sig = signBookingRef('T7CHKD1');
      const fullUrl = `http://localhost:5173/verify/T7CHKD1?sig=${sig}`;
      const parsed = parseVerificationInput(fullUrl);
      expect(parsed.bookingRef).toBe('T7CHKD1');
      expect(parsed.sig).toBe(sig);

      const parsedQuery = parseVerificationInput(`ref=T7CHKD1&sig=${sig}`);
      expect(parsedQuery.bookingRef).toBe('T7CHKD1');
      expect(parsedQuery.sig).toBe(sig);
    });
  });

  describe('2. Boarding Pass Endpoints (JSON & PDF)', () => {
    it('GET /bookings/:id/boarding-pass includes verification_url and qr_code_data_url', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn.id}/boarding-pass`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.boarding_pass).toBeDefined();
      expect(body.boarding_pass.booking_ref).toBe('T7CHKD1');
      expect(body.boarding_pass.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
      expect(body.boarding_pass.verification_url).toMatch(/\/verify\/T7CHKD1\?sig=[0-9a-f]{64}$/);
    });

    it('GET /bookings/:id/boarding-pass.pdf returns 200 with application/pdf', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn.id}/boarding-pass.pdf`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      const buffer = await res.arrayBuffer();
      const headerStr = Buffer.from(buffer.slice(0, 5)).toString('utf-8');
      expect(headerStr).toBe('%PDF-');
    });

    it('GET /bookings/:id/boarding-pass.pdf with query token returns 200 and %PDF-', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn.id}/boarding-pass.pdf?token=${encodeURIComponent(passengerToken)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      const buffer = await res.arrayBuffer();
      const headerStr = Buffer.from(buffer.slice(0, 5)).toString('utf-8');
      expect(headerStr).toBe('%PDF-');
    });

    it('GET /bookings/:id/boarding-pass.pdf without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn.id}/boarding-pass.pdf`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Authentication required');
    });

    it('GET /bookings/:id/boarding-pass without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/bookings/${testBookingCheckedIn.id}/boarding-pass`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Authentication required');
    });
  });

  describe('3. Public Verification Endpoint (GET /verify/:ref)', () => {
    it('returns limited details for valid booking reference and signature (no personal data)', async () => {
      const sig = signBookingRef('T7CHKD1');
      const res = await fetch(`${baseUrl}/verify/T7CHKD1?sig=${sig}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.booking_ref).toBe('T7CHKD1');
      expect(body.flight_number).toBe('T7-101');
      expect(body.passenger_name).toBe('Alexander W.'); // First name + last initial
      expect(body.route).toContain('→');
      expect(body.seat_number).toBe('04F');
      expect(body.booking_status).toBe('checked_in');

      // Ensure sensitive personal information is NEVER leaked
      expect(body.email).toBeUndefined();
      expect(body.user_id).toBeUndefined();
      expect(body.price_cents).toBeUndefined();
    });

    it('returns generic 404 for tampered signature', async () => {
      const res = await fetch(`${baseUrl}/verify/T7CHKD1?sig=bad_signature_value`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Invalid or expired verification link');
    });

    it('returns generic 404 for unknown booking reference even with signature', async () => {
      const sig = signBookingRef('T7UNKNOWN');
      const res = await fetch(`${baseUrl}/verify/T7UNKNOWN?sig=${sig}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Invalid or expired verification link');
    });

    it('returns generic 404 when signature parameter is missing', async () => {
      const res = await fetch(`${baseUrl}/verify/T7CHKD1`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Invalid or expired verification link');
    });
  });

  describe('4. Staff Gate Boarding Endpoint (POST /gate/board)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const sig = signBookingRef('T7CHKD1');
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_ref: 'T7CHKD1', sig }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects passenger role with 403', async () => {
      const sig = signBookingRef('T7CHKD1');
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${passengerToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7CHKD1', sig }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects invalid or missing signature with 400', async () => {
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7CHKD1', sig: 'invalid_sig' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid or missing/i);
    });

    it('rejects boarding when passenger is not checked in (status confirmed) with 400', async () => {
      const sig = signBookingRef('T7CONF1');
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7CONF1', sig }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/must be checked in/i);
    });

    it('rejects boarding on cancelled flight with 400', async () => {
      const sig = signBookingRef('T7BGCAN');
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7BGCAN', sig }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/cancelled/i);
    });

    it('rejects boarding on departed flight with 400', async () => {
      const sig = signBookingRef('T7BGDEP');
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7BGDEP', sig }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/already departed/i);
    });

    it('successfully boards a checked_in booking and accepts scanned URL', async () => {
      const sig = signBookingRef('T7CHKD1');
      const scannedUrl = `http://localhost:5173/verify/T7CHKD1?sig=${sig}`;

      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groundCrewToken}`,
        },
        body: JSON.stringify({ url: scannedUrl }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.status).toBe('boarded');
      expect(body.passenger_name).toBe('Alexander Wright');
      expect(body.first_name).toBe('Alexander');
      expect(body.flight_number).toBe('T7-101');
      expect(body.seat_number).toBe('04F');

      // Verify status updated in database
      const dbCheck = await pool.query('SELECT status, seat_id, passenger_id, user_id, price_cents FROM booking WHERE booking_ref = $1', ['T7CHKD1']);
      expect(dbCheck.rows[0].status).toBe('boarded');
      // Boarded booking must keep all existing associations intact
      expect(dbCheck.rows[0].seat_id).toBe(testSeat.id);
      expect(dbCheck.rows[0].passenger_id).toBe(testPassenger.id);
      expect(dbCheck.rows[0].user_id).toBe(testUser.id);
      expect(dbCheck.rows[0].price_cents).toBe(500000);
    });

    it('returns 409 when boarding an already boarded passenger (no double write)', async () => {
      const sig = signBookingRef('T7CHKD1'); // already boarded in test above
      const res = await fetch(`${baseUrl}/gate/board`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opsManagerToken}`,
        },
        body: JSON.stringify({ booking_ref: 'T7CHKD1', sig }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/already been boarded/i);
    });
  });
});
