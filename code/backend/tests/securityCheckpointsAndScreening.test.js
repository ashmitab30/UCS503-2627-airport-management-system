import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { securityRouter } from '../src/routes/security.js';
import { hashPassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 14: Security Module Integration Tests (Checkpoints & Screening Log)', () => {
  let server;
  let baseUrl;
  let stubIo;
  let capturedEmits = [];

  let adminUser, adminToken;
  let opsUser, opsToken;
  let secUser, secToken;
  let crewUser, crewToken;
  let passUser, passToken;

  let delAirportId, bomAirportId;
  let aircraftTypeId;

  let activeFlightId, cancelledFlightId, departedFlightId;
  let confirmedBookingId, confirmedBookingRef;
  let checkedInBookingId, checkedInBookingRef;
  let cancelledBookingId, cancelledBookingRef;
  let departedFlightBookingId, departedFlightBookingRef;
  let cancelledFlightBookingId, cancelledFlightBookingRef;

  let openCheckpointId, closedCheckpointId, delayedCheckpointId;
  let createdCheckpointIds = [];
  let createdScreeningIds = [];
  let createdBookingIds = [];
  let createdFlightIds = [];
  let createdUserIds = [];

  beforeAll(async () => {
    // 1. Setup mock socket.io stub that enforces room targeting
    stubIo = {
      to: (rooms) => ({
        emit: (event, data) => {
          capturedEmits.push({
            rooms: Array.isArray(rooms) ? rooms : [rooms],
            event,
            data,
          });
        },
      }),
      emit: () => {
        throw new Error('VIOLATION: global io.emit must not be called for security events!');
      },
    };

    const app = express();
    app.set('io', stubIo);
    app.use(express.json());
    app.use('/security', securityRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Create test users in test database (airport_test)
    const passHash = await hashPassword('Pass123!');
    async function createTestUser(name, role) {
      const email = `sec_test_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@meridian.com`;
      const res = await pool.query(
        `INSERT INTO "user" (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role`,
        [name, email, passHash, role]
      );
      createdUserIds.push(res.rows[0].id);
      return res.rows[0];
    }

    adminUser = await createTestUser('Sec Admin', 'admin');
    adminToken = signToken(adminUser);

    opsUser = await createTestUser('Sec Ops Manager', 'ops_manager');
    opsToken = signToken(opsUser);

    secUser = await createTestUser('Sec Officer Vikram', 'security');
    secToken = signToken(secUser);

    crewUser = await createTestUser('Sec Ground Crew', 'ground_crew');
    crewToken = signToken(crewUser);

    passUser = await createTestUser('Sec Passenger Priya', 'passenger');
    passToken = signToken(passUser);

    // 3. Resolve airports & aircraft type
    const airRes = await pool.query("SELECT id, code FROM airport WHERE code IN ('DEL', 'BOM')");
    delAirportId = airRes.rows.find((a) => a.code === 'DEL').id;
    bomAirportId = airRes.rows.find((a) => a.code === 'BOM').id;

    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    aircraftTypeId = actRes.rows[0].id;

    // 4. Create Flights
    const fActive = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('SEC-101', $1, $2, $3, now() + INTERVAL '4 hours', now() + INTERVAL '6 hours', 'scheduled', 450000)
       RETURNING id`,
      [aircraftTypeId, delAirportId, bomAirportId]
    );
    activeFlightId = fActive.rows[0].id;
    createdFlightIds.push(activeFlightId);

    const fCancelled = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('SEC-999', $1, $2, $3, now() + INTERVAL '2 hours', now() + INTERVAL '4 hours', 'cancelled', 450000)
       RETURNING id`,
      [aircraftTypeId, delAirportId, bomAirportId]
    );
    cancelledFlightId = fCancelled.rows[0].id;
    createdFlightIds.push(cancelledFlightId);

    const fDeparted = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, actual_departure, status, base_price_cents)
       VALUES ('SEC-888', $1, $2, $3, now() - INTERVAL '2 hours', now() + INTERVAL '1 hour', now() - INTERVAL '2 hours', 'departed', 450000)
       RETURNING id`,
      [aircraftTypeId, delAirportId, bomAirportId]
    );
    departedFlightId = fDeparted.rows[0].id;
    createdFlightIds.push(departedFlightId);

    // 5. Create Seats & Bookings
    const sRes1 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12A', 'economy', true) RETURNING id`,
      [activeFlightId]
    );
    const seatId1 = sRes1.rows[0].id;

    const sRes2 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12B', 'economy', true) RETURNING id`,
      [activeFlightId]
    );
    const seatId2 = sRes2.rows[0].id;

    const sRes3 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12C', 'economy', true) RETURNING id`,
      [activeFlightId]
    );
    const seatId3 = sRes3.rows[0].id;

    const sRes4 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '14A', 'economy', true) RETURNING id`,
      [cancelledFlightId]
    );
    const seatId4 = sRes4.rows[0].id;

    const sRes5 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '15A', 'economy', true) RETURNING id`,
      [departedFlightId]
    );
    const seatId5 = sRes5.rows[0].id;

    const rnd = Math.floor(1000 + Math.random() * 9000);
    confirmedBookingRef = `SC-C${rnd}`.slice(0, 10);
    const bConf = await pool.query(
      `INSERT INTO booking (booking_ref, flight_id, user_id, seat_id, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING id`,
      [confirmedBookingRef, activeFlightId, passUser.id, seatId1]
    );
    confirmedBookingId = bConf.rows[0].id;
    createdBookingIds.push(confirmedBookingId);

    checkedInBookingRef = `SC-K${rnd}`.slice(0, 10);
    const bChkd = await pool.query(
      `INSERT INTO booking (booking_ref, flight_id, user_id, seat_id, status)
       VALUES ($1, $2, $3, $4, 'checked_in')
       RETURNING id`,
      [checkedInBookingRef, activeFlightId, passUser.id, seatId2]
    );
    checkedInBookingId = bChkd.rows[0].id;
    createdBookingIds.push(checkedInBookingId);

    cancelledBookingRef = `SC-X${rnd}`.slice(0, 10);
    const bCncl = await pool.query(
      `INSERT INTO booking (booking_ref, flight_id, user_id, seat_id, status)
       VALUES ($1, $2, $3, $4, 'cancelled')
       RETURNING id`,
      [cancelledBookingRef, activeFlightId, passUser.id, seatId3]
    );
    cancelledBookingId = bCncl.rows[0].id;
    createdBookingIds.push(cancelledBookingId);

    cancelledFlightBookingRef = `SC-F${rnd}`.slice(0, 10);
    const bFcnc = await pool.query(
      `INSERT INTO booking (booking_ref, flight_id, user_id, seat_id, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING id`,
      [cancelledFlightBookingRef, cancelledFlightId, passUser.id, seatId4]
    );
    cancelledFlightBookingId = bFcnc.rows[0].id;
    createdBookingIds.push(cancelledFlightBookingId);

    departedFlightBookingRef = `SC-D${rnd}`.slice(0, 10);
    const bFdep = await pool.query(
      `INSERT INTO booking (booking_ref, flight_id, user_id, seat_id, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING id`,
      [departedFlightBookingRef, departedFlightId, passUser.id, seatId5]
    );
    departedFlightBookingId = bFdep.rows[0].id;
    createdBookingIds.push(departedFlightBookingId);

    // 6. Create Checkpoints
    const cpOpenRes = await pool.query(
      `INSERT INTO security_checkpoint (airport_id, name, location, status)
       VALUES ($1, 'Test Checkpoint North (Open)', 'Terminal 3 Gates 1-15', 'open')
       RETURNING id`,
      [delAirportId]
    );
    openCheckpointId = cpOpenRes.rows[0].id;
    createdCheckpointIds.push(openCheckpointId);

    const cpClosedRes = await pool.query(
      `INSERT INTO security_checkpoint (airport_id, name, location, status, status_reason)
       VALUES ($1, 'Test Checkpoint South (Closed)', 'Terminal 3 Gates 16-30', 'closed', 'Maintenance overhaul')
       RETURNING id`,
      [delAirportId]
    );
    closedCheckpointId = cpClosedRes.rows[0].id;
    createdCheckpointIds.push(closedCheckpointId);

    const cpDelayedRes = await pool.query(
      `INSERT INTO security_checkpoint (airport_id, name, location, status, status_reason)
       VALUES ($1, 'Test Checkpoint West (Delayed)', 'Terminal 1 Pier B', 'delayed', 'Scanner calibration')
       RETURNING id`,
      [bomAirportId]
    );
    delayedCheckpointId = cpDelayedRes.rows[0].id;
    createdCheckpointIds.push(delayedCheckpointId);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Clean up created test data
    if (createdScreeningIds.length > 0) {
      await pool.query('DELETE FROM screening_log WHERE id = ANY($1)', [createdScreeningIds]);
    }
    if (createdCheckpointIds.length > 0) {
      await pool.query('DELETE FROM screening_log WHERE checkpoint_id = ANY($1)', [createdCheckpointIds]);
      await pool.query('DELETE FROM security_checkpoint WHERE id = ANY($1)', [createdCheckpointIds]);
    }
    if (createdBookingIds.length > 0) {
      await pool.query('DELETE FROM screening_log WHERE booking_id = ANY($1)', [createdBookingIds]);
      await pool.query('DELETE FROM booking WHERE id = ANY($1)', [createdBookingIds]);
    }
    if (createdFlightIds.length > 0) {
      await pool.query('DELETE FROM flight WHERE id = ANY($1)', [createdFlightIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [createdUserIds]);
    }
  });

  beforeEach(() => {
    capturedEmits = [];
  });

  describe('1. Access Control & Checkpoint Management', () => {
    it('allows admin and ops_manager to create a checkpoint (POST /security/checkpoints)', async () => {
      const res = await fetch(`${baseUrl}/security/checkpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airport_id: delAirportId,
          name: 'Security Checkpoint Express Lane',
          location: 'Terminal 3 Concourse C',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.checkpoint).toHaveProperty('id');
      expect(data.checkpoint.name).toBe('Security Checkpoint Express Lane');
      expect(data.checkpoint.status).toBe('open');
      createdCheckpointIds.push(data.checkpoint.id);

      // Verify socket event emitted to ops and security roles
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:checkpoint_created');
      expect(capturedEmits[0].rooms).toContain('role:ops_manager');
      expect(capturedEmits[0].rooms).toContain('role:security');
    });

    it('denies security officer from creating a checkpoint (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/security/checkpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          airport_id: delAirportId,
          name: 'Unauthorized Checkpoint',
          location: 'Terminal 2',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('denies passenger and ground crew from accessing security endpoints (403 Forbidden)', async () => {
      const resPass = await fetch(`${baseUrl}/security/checkpoints`, {
        headers: { Authorization: `Bearer ${passToken}` },
      });
      expect(resPass.status).toBe(403);

      const resCrew = await fetch(`${baseUrl}/security/checkpoints`, {
        headers: { Authorization: `Bearer ${crewToken}` },
      });
      expect(resCrew.status).toBe(403);
    });

    it('lists checkpoints with status and throughput stats (GET /security/checkpoints)', async () => {
      const res = await fetch(`${baseUrl}/security/checkpoints?airport=DEL`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.checkpoints)).toBe(true);

      const openCp = data.checkpoints.find((c) => c.id === openCheckpointId);
      expect(openCp).toBeDefined();
      expect(openCp.status).toBe('open');
      expect(openCp).toHaveProperty('screened_last_hour');
      expect(openCp).toHaveProperty('flagged_last_hour');
      expect(openCp).toHaveProperty('secondary_last_hour');
      expect(openCp).toHaveProperty('screened_today');
    });
  });

  describe('2. Checkpoint Status Transitions & Socket Notifications', () => {
    it('allows security officer to update checkpoint status with reason', async () => {
      const res = await fetch(`${baseUrl}/security/checkpoints/${openCheckpointId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          status: 'delayed',
          status_reason: 'Queue spillover, lane 2 scanner calibration',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.checkpoint.status).toBe('delayed');
      expect(data.checkpoint.status_reason).toBe('Queue spillover, lane 2 scanner calibration');

      // Check socket broadcast
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:checkpoint_status');
      expect(capturedEmits[0].data.checkpoint.status).toBe('delayed');
      expect(capturedEmits[0].rooms).toContain('role:security');
      expect(capturedEmits[0].rooms).toContain('role:ops_manager');
      expect(capturedEmits[0].rooms).toContain('role:admin');

      // Reset back to open
      await pool.query("UPDATE security_checkpoint SET status = 'open', status_reason = NULL WHERE id = $1", [openCheckpointId]);
    });

    it('rejects invalid checkpoint status values with 400', async () => {
      const res = await fetch(`${baseUrl}/security/checkpoints/${openCheckpointId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({ status: 'offline' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('3. Booking Lookup Endpoint (GET /security/lookup-booking)', () => {
    it('returns passenger, flight and seat details for screener verification', async () => {
      const res = await fetch(`${baseUrl}/security/lookup-booking?ref=${confirmedBookingRef}`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking).toBeDefined();
      expect(data.booking.booking_ref).toBe(confirmedBookingRef);
      expect(data.booking.booking_reference).toBe(confirmedBookingRef);
      expect(data.booking.passenger_name).toBe(passUser.name);
      expect(data.booking.flight_number).toBe('SEC-101');
      expect(data.booking.seat_number).toBe('12A');
    });

    it('returns 404 for non-existent booking reference', async () => {
      const res = await fetch(`${baseUrl}/security/lookup-booking?ref=UNKNOWN-REF-999`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('4. Passenger Screening Validation & Recording (POST /security/screenings)', () => {
    it('records cleared screening on a confirmed booking and resolves passenger_id strictly from booking', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: confirmedBookingRef,
          result: 'cleared',
          notes: 'Standard carry-on check passed',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.screening).toHaveProperty('id');
      expect(data.screening.checkpoint_id).toBe(openCheckpointId);
      expect(data.screening.booking_id).toBe(confirmedBookingId);
      expect(data.screening.result).toBe('cleared');
      expect(data.screening.screened_by).toBe(secUser.id);
      expect(data.passenger.id).toBe(passUser.id);
      createdScreeningIds.push(data.screening.id);

      // Verify DB record has passenger_id matching booking.user_id
      const dbRow = await pool.query('SELECT passenger_id, screened_by FROM screening_log WHERE id = $1', [data.screening.id]);
      expect(dbRow.rows[0].passenger_id).toBe(passUser.id);
      expect(dbRow.rows[0].screened_by).toBe(secUser.id);

      // Verify WebSocket notification emitted to security and ops rooms only
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:screening');
      expect(capturedEmits[0].rooms).toEqual(['role:security', 'role:ops_manager', 'role:admin']);
      expect(capturedEmits[0].data.screening.id).toBe(data.screening.id);
    });

    it('refuses screening if checkpoint is closed (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: closedCheckpointId,
          booking_ref: checkedInBookingRef,
          result: 'cleared',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/closed/i);
    });

    it('refuses screening if booking is cancelled (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: cancelledBookingRef,
          result: 'cleared',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/cancelled/i);
    });

    it('refuses screening if flight is cancelled (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: cancelledFlightBookingRef,
          result: 'cleared',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/cancelled/i);
    });

    it('refuses screening if flight has departed (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: departedFlightBookingRef,
          result: 'cleared',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/departed/i);
    });

    it('strictly requires notes when result is flagged (400 Bad Request if missing)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: checkedInBookingRef,
          result: 'flagged',
          notes: '   ',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/notes are strictly required/i);
    });

    it('strictly requires notes when result is secondary_screening (400 Bad Request if missing)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: checkedInBookingRef,
          result: 'secondary_screening',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/notes are strictly required/i);
    });

    it('successfully records flagged screening when notes are provided', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: openCheckpointId,
          booking_ref: checkedInBookingRef,
          result: 'flagged',
          notes: 'Scissors exceeding 6cm found in hand baggage',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.screening.result).toBe('flagged');
      expect(data.screening.notes).toBe('Scissors exceeding 6cm found in hand baggage');
      createdScreeningIds.push(data.screening.id);
    });

    it('successfully records secondary_screening when notes are provided', async () => {
      const res = await fetch(`${baseUrl}/security/screenings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secToken}`,
        },
        body: JSON.stringify({
          checkpoint_id: delayedCheckpointId,
          booking_ref: checkedInBookingRef,
          result: 'secondary_screening',
          notes: 'Random swab explosive trace detection procedure conducted',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.screening.result).toBe('secondary_screening');
      createdScreeningIds.push(data.screening.id);
    });
  });

  describe('5. Screenings Log Feed & Telemetry Stats', () => {
    it('supports listing screenings with filters and pagination (GET /security/screenings)', async () => {
      const res = await fetch(`${baseUrl}/security/screenings?result=flagged&limit=5&offset=0`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.screenings)).toBe(true);
      expect(typeof data.total).toBe('number');
      data.screenings.forEach((s) => {
        expect(s.result).toBe('flagged');
      });
    });

    it('returns 24-hour summary and per-checkpoint statistics (GET /security/stats)', async () => {
      const res = await fetch(`${baseUrl}/security/stats`, {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('summary');
      expect(data.summary).toHaveProperty('total_24h');
      expect(data.summary).toHaveProperty('cleared_24h');
      expect(data.summary).toHaveProperty('flagged_24h');
      expect(data.summary).toHaveProperty('secondary_24h');
      expect(Array.isArray(data.checkpoints)).toBe(true);
    });
  });
});
