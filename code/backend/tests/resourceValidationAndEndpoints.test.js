import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/utils/jwt.js';
import { resourcesRouter } from '../src/routes/resources.js';
import { resourceAssignmentsRouter } from '../src/routes/resourceAssignments.js';

describe('Task 4: Resource & Assignment Validation and Endpoints Tests', () => {
  let server;
  let baseUrl;
  let adminToken;

  let testAirportId;
  let testAircraftTypeId;
  let testResource;
  let testFutureFlight;
  let testCancelledFlight;
  let testDepartedFlight;

  beforeAll(async () => {
    // 1. Setup ephemeral test Express app
    const app = express();
    app.use(express.json());
    app.use('/resources', resourcesRouter);
    app.use('/resource-assignments', resourceAssignmentsRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Generate valid admin token
    adminToken = signToken({ id: 1, role: 'admin', email: 'admin@meridian.test' });

    // 3. Setup test reference data
    const apRes = await pool.query("SELECT id FROM airport WHERE code IN ('DEL', 'BOM') ORDER BY code");
    testAirportId = apRes.rows[0].id;
    const testDestAirportId = apRes.rows[1].id;

    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    testAircraftTypeId = actRes.rows[0].id;

    // Create a dedicated test resource
    const rRes = await pool.query(
      `INSERT INTO resource (airport_id, type, status)
       VALUES ($1, 'fuel_truck', 'available')
       RETURNING id, airport_id, type, status`,
      [testAirportId]
    );
    testResource = rRes.rows[0];

    // Create future flight (assignable)
    const fFuture = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T4-FUT', $1, $2, $3, now() + INTERVAL '2 days', now() + INTERVAL '2 days 2 hours', 'scheduled', 500000)
       RETURNING id, flight_number, status`,
      [testAircraftTypeId, testAirportId, testDestAirportId]
    );
    testFutureFlight = fFuture.rows[0];

    // Create cancelled flight
    const fCancelled = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('T4-CAN', $1, $2, $3, now() + INTERVAL '2 days', now() + INTERVAL '2 days 2 hours', 'cancelled', 500000)
       RETURNING id, flight_number, status`,
      [testAircraftTypeId, testAirportId, testDestAirportId]
    );
    testCancelledFlight = fCancelled.rows[0];

    // Create departed flight (in past)
    const fDeparted = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents,
                           actual_departure)
       VALUES ('T4-DEP', $1, $2, $3, now() - INTERVAL '5 hours', now() - INTERVAL '3 hours', 'departed', 500000,
               now() - INTERVAL '5 hours')
       RETURNING id, flight_number, status`,
      [testAircraftTypeId, testAirportId, testDestAirportId]
    );
    testDepartedFlight = fDeparted.rows[0];
  });

  afterAll(async () => {
    // Cleanup test data
    if (testResource?.id) {
      await pool.query('DELETE FROM resource_assignment WHERE resource_id = $1', [testResource.id]);
      await pool.query('DELETE FROM resource WHERE id = $1', [testResource.id]);
    }
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'T4-%'");
    await pool.query("DELETE FROM resource WHERE type = 'crew' AND airport_id = $1 AND status = 'available' AND id NOT IN (SELECT id FROM resource_assignment)", [testAirportId]);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('POST /resource-assignments', () => {
    it('rejects negative flight_id with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: -1,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    it('rejects 0 as flight_id with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: 0,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects decimal flight_id with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: 1.5,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing fields with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
      expect(data.details.length).toBeGreaterThanOrEqual(4);
    });

    it('rejects garbage date string with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testFutureFlight.id,
          start_time: 'not-a-valid-date-garbage',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects when end_time is before start_time with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testFutureFlight.id,
          start_time: '2026-11-28T16:00',
          end_time: '2026-11-28T14:00',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.details[0].message).toContain('after start_time');
    });

    it('rejects when end_time is equal to start_time with 400', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testFutureFlight.id,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T14:00',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.details[0].message).toContain('after start_time');
    });

    it('returns 404 for non-existent flight', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: 999999,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Flight not found');
    });

    it('returns 409 when assigning to a cancelled flight', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testCancelledFlight.id,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('cancelled flight');
    });

    it('returns 409 when assigning to a departed flight', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testDepartedFlight.id,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('departed flight');
    });

    it('accepts a valid request and returns 201 with created assignment', async () => {
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testFutureFlight.id,
          start_time: '2026-11-28T14:00',
          end_time: '2026-11-28T15:00',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('resource_assignment');
      expect(data.resource_assignment.resource_id).toBe(testResource.id);
      expect(data.resource_assignment.flight_id).toBe(testFutureFlight.id);
    });

    it('rejects overlapping assignment with 409', async () => {
      // Overlaps with the assignment created in previous test (14:00 to 15:00)
      const res = await fetch(`${baseUrl}/resource-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          resource_id: testResource.id,
          flight_id: testFutureFlight.id,
          start_time: '2026-11-28T14:30',
          end_time: '2026-11-28T15:30',
        }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('already assigned during this window');
      expect(Array.isArray(data.conflicts)).toBe(true);
    });
  });

  describe('POST /resources', () => {
    it('rejects negative airport_id with 400', async () => {
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airport_id: -1,
          type: 'fuel_truck',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    it('rejects invalid resource type with 400', async () => {
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          type: 'submarine',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    const wrongTypes = ['gate', 'baggage_carousel', 'checkin_counter', 'security_lane'];
    wrongTypes.forEach((wrongType) => {
      it(`rejects wrong type "${wrongType}" with 400, never 500`, async () => {
        const res = await fetch(`${baseUrl}/resources`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            airport_id: testAirportId,
            type: wrongType,
          }),
        });
        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
        const data = await res.json();
        expect(data.error).toBe('Validation failed');
        expect(data.details[0].field).toBe('type');
      });
    });

    it('returns 404 if airport does not exist', async () => {
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airport_id: 999999,
          type: 'fuel_truck',
        }),
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Airport not found');
    });

    it('creates resource with 201 for valid input', async () => {
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          type: 'crew',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('resource');
      expect(data.resource.airport_id).toBe(testAirportId);
      expect(data.resource.type).toBe('crew');
      expect(data.resource.status).toBe('available');
    });
  });
});
