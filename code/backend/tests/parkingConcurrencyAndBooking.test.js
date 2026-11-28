import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { parkingRouter } from '../src/routes/parking.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 11: Parking with Concurrency-Safe Booking Tests', () => {
  let server;
  let baseUrl;

  // Users and tokens
  const passenger1 = { id: 771, role: 'passenger', email: 'pk_pass1@test.com' };
  const passenger2 = { id: 772, role: 'passenger', email: 'pk_pass2@test.com' };
  const adminUser = { id: 773, role: 'admin', email: 'pk_admin@test.com' };
  const opsUser = { id: 774, role: 'ops_manager', email: 'pk_ops@test.com' };

  let pass1Token;
  let pass2Token;
  let adminToken;
  let opsToken;

  // Test airport and lots
  let testAirportId;
  let concurrencyLotId;
  let singleSlotLotId;

  beforeAll(async () => {
    // 1. Setup Express test server
    const app = express();
    app.use(express.json());
    app.use('/parking', parkingRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens
    pass1Token = signToken(passenger1);
    pass2Token = signToken(passenger2);
    adminToken = signToken(adminUser);
    opsToken = signToken(opsUser);

    // 3. Insert test users
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         (771, 'Park Pass 1', 'pk_pass1@test.com', 'hash', 'passenger'),
         (772, 'Park Pass 2', 'pk_pass2@test.com', 'hash', 'passenger'),
         (773, 'Park Admin', 'pk_admin@test.com', 'hash', 'admin'),
         (774, 'Park Ops', 'pk_ops@test.com', 'hash', 'ops_manager')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`
    );

    // 4. Fetch an airport
    const airRes = await pool.query("SELECT id FROM airport WHERE code = 'DEL' LIMIT 1");
    testAirportId = airRes.rows[0].id;

    // 5. Create Concurrency Test Lot with exactly 3 slots
    const lotRes = await pool.query(
      `INSERT INTO parking_lot (airport_id, name, total_slots, hourly_rate)
       VALUES ($1, 'TEST-CONCURRENCY-LOT', 3, 50.00)
       RETURNING id`,
      [testAirportId]
    );
    concurrencyLotId = lotRes.rows[0].id;

    await pool.query(
      `INSERT INTO parking_slot (lot_id, slot_number, status)
       VALUES ($1, 'C-01', 'free'), ($1, 'C-02', 'free'), ($1, 'C-03', 'free')`,
      [concurrencyLotId]
    );

    // 6. Create Single Slot Lot for overlap & back-to-back boundary tests
    const singleRes = await pool.query(
      `INSERT INTO parking_lot (airport_id, name, total_slots, hourly_rate)
       VALUES ($1, 'TEST-SINGLE-SLOT-LOT', 1, 60.00)
       RETURNING id`,
      [testAirportId]
    );
    singleSlotLotId = singleRes.rows[0].id;

    await pool.query(
      `INSERT INTO parking_slot (lot_id, slot_number, status)
       VALUES ($1, 'S-01', 'free')`,
      [singleSlotLotId]
    );
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up test data
    if (concurrencyLotId || singleSlotLotId) {
      await pool.query(
        'DELETE FROM parking_booking WHERE slot_id IN (SELECT id FROM parking_slot WHERE lot_id IN ($1, $2))',
        [concurrencyLotId, singleSlotLotId]
      );
      await pool.query('DELETE FROM parking_slot WHERE lot_id IN ($1, $2)', [concurrencyLotId, singleSlotLotId]);
      await pool.query('DELETE FROM parking_lot WHERE id IN ($1, $2)', [concurrencyLotId, singleSlotLotId]);
    }
    await pool.query('DELETE FROM "user" WHERE id IN (771, 772, 773, 774)');
  });

  describe('1. Concurrency Safety (Key Requirement)', () => {
    it('fires 10 parallel booking requests at a 3-slot lot for the exact same window: exactly 3 succeed, 7 get 409, and no slot is double-booked', async () => {
      const startTime = new Date(Date.now() + 48 * 3600_000).toISOString();
      const endTime = new Date(Date.now() + 52 * 3600_000).toISOString();

      // Vehicle plates for 10 concurrent requests
      const vehicles = [
        'MH12AB1001', 'MH12AB1002', 'MH12AB1003', 'MH12AB1004', 'MH12AB1005',
        'DL1CAB2001', 'DL1CAB2002', 'DL1CAB2003', 'DL1CAB2004', 'DL1CAB2005',
      ];

      // Fire 10 simultaneous requests
      const responses = await Promise.all(
        vehicles.map((veh) =>
          fetch(`${baseUrl}/parking/bookings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${pass1Token}`,
            },
            body: JSON.stringify({
              lot_id: concurrencyLotId,
              vehicle_number: veh,
              from: startTime,
              until: endTime,
            }),
          })
        )
      );

      const statusCounts = { 201: 0, 409: 0, other: 0 };
      const successBodies = [];

      for (const res of responses) {
        if (res.status === 201) {
          statusCounts[201]++;
          const body = await res.json();
          successBodies.push(body.booking);
        } else if (res.status === 409) {
          statusCounts[409]++;
          const body = await res.json();
          expect(body.error).toContain('No parking slots available');
        } else {
          statusCounts.other++;
        }
      }

      // Assert exactly 3 successes and 7 409s
      expect(statusCounts[201]).toBe(3);
      expect(statusCounts[409]).toBe(7);
      expect(statusCounts.other).toBe(0);

      // Verify in database: all 3 assigned slots must be distinct
      const assignedSlotIds = successBodies.map((b) => b.slot_id);
      const uniqueSlotIds = new Set(assignedSlotIds);
      expect(uniqueSlotIds.size).toBe(3);

      // Verify no double bookings in DB
      const dbCheck = await pool.query(
        `SELECT slot_id, count(*)
         FROM parking_booking
         WHERE slot_id IN ($1, $2, $3) AND status != 'cancelled'
         GROUP BY slot_id`,
        [...uniqueSlotIds]
      );
      expect(dbCheck.rows).toHaveLength(3);
      dbCheck.rows.forEach((row) => {
        expect(parseInt(row.count, 10)).toBe(1);
      });
    });
  });

  describe('2. Overlap & Back-to-Back Window Logic', () => {
    it('allows back-to-back bookings on the same slot (one ends exactly when next starts)', async () => {
      const t1Start = new Date(Date.now() + 72 * 3600_000).toISOString();
      const t1End = new Date(Date.now() + 76 * 3600_000).toISOString();
      const t2Start = t1End; // exact boundary!
      const t2End = new Date(Date.now() + 80 * 3600_000).toISOString();

      // Booking 1 on single slot lot
      const res1 = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB3001',
          from: t1Start,
          until: t1End,
        }),
      });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      expect(data1.booking.slot_number).toBe('S-01');

      // Booking 2 starts exactly when Booking 1 ends -> must SUCCEED on same slot S-01
      const res2 = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass2Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'KA05MB9001',
          from: t2Start,
          until: t2End,
        }),
      });
      expect(res2.status).toBe(201);
      const data2 = await res2.json();
      expect(data2.booking.slot_number).toBe('S-01');
    });

    it('rejects an overlapping booking window on a full lot (409)', async () => {
      // Overlaps Booking 1 (from t1Start + 1 hr to t1End + 1 hr)
      const overlapStart = new Date(Date.now() + 73 * 3600_000).toISOString();
      const overlapEnd = new Date(Date.now() + 77 * 3600_000).toISOString();

      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'MH12AB5555',
          from: overlapStart,
          until: overlapEnd,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('No parking slots available');
    });

    it('allows a third booking in a completely separate window on the same slot', async () => {
      const t3Start = new Date(Date.now() + 85 * 3600_000).toISOString();
      const t3End = new Date(Date.now() + 88 * 3600_000).toISOString();

      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: '22BH1234AA',
          from: t3Start,
          until: t3End,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.booking.slot_number).toBe('S-01');
    });
  });

  describe('3. Cancellation & Slot Re-availability', () => {
    let cancelableBookingId;
    const windowStart = new Date(Date.now() + 100 * 3600_000).toISOString();
    const windowEnd = new Date(Date.now() + 104 * 3600_000).toISOString();

    beforeAll(async () => {
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB7777',
          from: windowStart,
          until: windowEnd,
        }),
      });
      const data = await res.json();
      cancelableBookingId = data.booking.id;
    });

    it('forbids passenger 2 from cancelling passenger 1 booking (403)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${cancelableBookingId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass2Token}` },
      });
      expect(res.status).toBe(403);
    });

    it('allows owner passenger 1 to cancel before the window starts (200)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${cancelableBookingId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.status).toBe('cancelled');
      expect(data.refund.status).toBe('refunded');
      expect(parseFloat(data.refund.amount_refunded)).toBeGreaterThan(0);
    });

    it('rejects duplicate cancellation of an already cancelled booking (409)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${cancelableBookingId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('already cancelled');
    });

    it('frees the slot so a new booking for the same window now succeeds (201)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass2Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'MH12AB8888',
          from: windowStart,
          until: windowEnd,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.booking.slot_number).toBe('S-01');
    });
  });

  describe('4. Input Validation (Never 500)', () => {
    it('rejects start time in the past (400)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB1234',
          from: new Date(Date.now() - 3600_000).toISOString(),
          until: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('start time must be in the future');
    });

    it('rejects end time earlier than or equal to start time (400)', async () => {
      const start = new Date(Date.now() + 3600_000).toISOString();
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB1234',
          from: start,
          until: start,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('end time must be after start time');
    });

    it('rejects duration exceeding 30 days (400)', async () => {
      const from = new Date(Date.now() + 3600_000).toISOString();
      const until = new Date(Date.now() + 35 * 24 * 3600_000).toISOString();
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB1234',
          from,
          until,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('cannot exceed 30 days');
    });

    it('rejects invalid or garbage vehicle plate format (400)', async () => {
      const from = new Date(Date.now() + 3600_000).toISOString();
      const until = new Date(Date.now() + 7200_000).toISOString();
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'INVALID_CAR_123',
          from,
          until,
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid Indian vehicle registration');
    });

    it('rejects unknown lot_id with 404', async () => {
      const from = new Date(Date.now() + 3600_000).toISOString();
      const until = new Date(Date.now() + 7200_000).toISOString();
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: 999999,
          vehicle_number: 'DL1CAB1234',
          from,
          until,
        }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('Parking lot not found');
    });
  });

  describe('5. Pricing (Rounding UP rule)', () => {
    it('rounds up partial hours (e.g. 1 hour and 10 minutes = 2 hours charge)', async () => {
      const from = new Date(Date.now() + 120 * 3600_000).toISOString();
      const until = new Date(Date.now() + (120 * 3600_000) + (70 * 60_000)).toISOString(); // 1 hr 10m

      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'MH12AB9999',
          from,
          until,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.booking.hours).toBe(2);
      expect(parseFloat(data.booking.amount_paid)).toBe(120.00); // 2 hrs * ₹60/hr
    });
  });

  describe('6. Entry & Exit Physical Status Progression (Admin / Ops Manager)', () => {
    let testBookingId;
    let testSlotId;

    beforeAll(async () => {
      const from = new Date(Date.now() + 150 * 3600_000).toISOString();
      const until = new Date(Date.now() + 155 * 3600_000).toISOString();
      const res = await fetch(`${baseUrl}/parking/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pass1Token}`,
        },
        body: JSON.stringify({
          lot_id: singleSlotLotId,
          vehicle_number: 'DL1CAB4444',
          from,
          until,
        }),
      });
      const data = await res.json();
      testBookingId = data.booking.id;
      testSlotId = data.booking.slot_id;
    });

    it('rejects passenger attempting to record entry or exit (403)', async () => {
      const resEntry = await fetch(`${baseUrl}/parking/bookings/${testBookingId}/entry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(resEntry.status).toBe(403);

      const resExit = await fetch(`${baseUrl}/parking/bookings/${testBookingId}/exit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(resExit.status).toBe(403);
    });

    it('records vehicle entry: updates booking to active and slot to occupied (200)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${testBookingId}/entry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.status).toBe('active');
      expect(data.booking.entry_time).toBeDefined();

      // Check slot status
      const slotCheck = await pool.query('SELECT status FROM parking_slot WHERE id = $1', [testSlotId]);
      expect(slotCheck.rows[0].status).toBe('occupied');
    });

    it('rejects duplicate entry recording on active booking (409)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${testBookingId}/entry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(409);
    });

    it('records vehicle exit: updates booking to completed and slot to free (200)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/${testBookingId}/exit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.booking.status).toBe('completed');
      expect(data.booking.exit_time).toBeDefined();

      // Check slot status
      const slotCheck = await pool.query('SELECT status FROM parking_slot WHERE id = $1', [testSlotId]);
      expect(slotCheck.rows[0].status).toBe('free');
    });
  });

  describe('7. Read Endpoints & Staff Views', () => {
    it('GET /parking/lots returns lots with free slots count and cost estimates', async () => {
      const from = new Date(Date.now() + 200 * 3600_000).toISOString();
      const until = new Date(Date.now() + 205 * 3600_000).toISOString();
      const res = await fetch(
        `${baseUrl}/parking/lots?airport_id=${testAirportId}&from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}`,
        { headers: { Authorization: `Bearer ${pass1Token}` } }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.lots)).toBe(true);
      expect(data.lots.length).toBeGreaterThan(0);
      expect(data.lots[0].free_slots).toBeDefined();
      expect(data.lots[0].estimated_cost).toBeDefined();
    });

    it('GET /parking/bookings/mine returns authenticated user bookings', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings/mine`, {
        headers: { Authorization: `Bearer ${pass1Token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.bookings)).toBe(true);
      expect(data.bookings.length).toBeGreaterThan(0);
    });

    it('GET /parking/lots/:id/occupancy returns lot summary and slots (Admin / Ops)', async () => {
      const res = await fetch(`${baseUrl}/parking/lots/${concurrencyLotId}/occupancy`, {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_slots).toBe(3);
      expect(Array.isArray(data.slots)).toBe(true);
      expect(data.slots).toHaveLength(3);
    });

    it('GET /parking/bookings lists all bookings with pagination (Admin / Ops)', async () => {
      const res = await fetch(`${baseUrl}/parking/bookings?status=all&limit=10`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.total).toBe('number');
    });
  });
});
