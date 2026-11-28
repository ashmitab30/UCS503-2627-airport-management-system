import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { facilitiesRouter } from '../src/routes/facilities.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 16a: Facilities Directory Integration Tests', () => {
  let server;
  let baseUrl;

  // Test users and tokens
  const passengerUser = { id: 881, role: 'passenger', email: 'fac_passenger@test.com' };
  const groundCrewUser = { id: 882, role: 'ground_crew', email: 'fac_crew@test.com' };
  const opsUser = { id: 883, role: 'ops_manager', email: 'fac_ops@test.com' };
  const adminUser = { id: 884, role: 'admin', email: 'fac_admin@test.com' };

  let passengerToken;
  let groundCrewToken;
  let opsToken;
  let adminToken;

  let testAirportId;
  let createdFacilityIds = [];

  beforeAll(async () => {
    // 1. Setup Express test server
    const app = express();
    app.use(express.json());
    app.use('/facilities', facilitiesRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Auth tokens
    passengerToken = signToken(passengerUser);
    groundCrewToken = signToken(groundCrewUser);
    opsToken = signToken(opsUser);
    adminToken = signToken(adminUser);

    // 3. Insert test users into airport_test database
    await pool.query(
      `INSERT INTO "user" (id, name, email, password_hash, role)
       VALUES
         (881, 'Fac Passenger', 'fac_passenger@test.com', 'hash', 'passenger'),
         (882, 'Fac GroundCrew', 'fac_crew@test.com', 'hash', 'ground_crew'),
         (883, 'Fac OpsManager', 'fac_ops@test.com', 'hash', 'ops_manager'),
         (884, 'Fac Admin', 'fac_admin@test.com', 'hash', 'admin')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`
    );

    // 4. Fetch an airport
    const airRes = await pool.query("SELECT id FROM airport WHERE code = 'DEL' LIMIT 1");
    if (airRes.rows.length > 0) {
      testAirportId = airRes.rows[0].id;
    } else {
      const ins = await pool.query(
        "INSERT INTO airport (code, name, timezone, city) VALUES ('TEST_DEL', 'Test Delhi Airport', 'Asia/Kolkata', 'Delhi') RETURNING id"
      );
      testAirportId = ins.rows[0].id;
    }

    // 5. Seed a few test facilities
    const f1 = await pool.query(
      `INSERT INTO facility (airport_id, name, type, location_terminal, location_gate_proximity, status)
       VALUES ($1, 'Alpha Lounge Express', 'lounge', 'Terminal 1', 'Near Gate 4', 'open')
       RETURNING id`,
      [testAirportId]
    );
    const f2 = await pool.query(
      `INSERT INTO facility (airport_id, name, type, location_terminal, location_gate_proximity, status)
       VALUES ($1, 'Beta Bistro Cafe', 'restaurant', 'Terminal 2', 'Near Gate 12', 'closed')
       RETURNING id`,
      [testAirportId]
    );
    const f3 = await pool.query(
      `INSERT INTO facility (airport_id, name, type, location_terminal, location_gate_proximity, status)
       VALUES ($1, 'Gamma Travel Store', 'shop', 'Terminal 1', 'Near Gate 8', 'open')
       RETURNING id`,
      [testAirportId]
    );

    createdFacilityIds.push(f1.rows[0].id, f2.rows[0].id, f3.rows[0].id);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up created facilities
    if (createdFacilityIds.length > 0) {
      await pool.query('DELETE FROM facility WHERE id = ANY($1)', [createdFacilityIds]);
    }
    // Clean up users
    await pool.query('DELETE FROM "user" WHERE id IN (881, 882, 883, 884)');
  });

  describe('1. GET /facilities (List, Filters & Pagination)', () => {
    it('requires authentication (401 without token)', async () => {
      const res = await fetch(`${baseUrl}/facilities`);
      expect(res.status).toBe(401);
    });

    it('allows passenger to read facilities list (200)', async () => {
      const res = await fetch(`${baseUrl}/facilities?airport_id=${testAirportId}`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.facilities)).toBe(true);
      expect(data.facilities.length).toBeGreaterThanOrEqual(3);
      expect(typeof data.total).toBe('number');
      expect(data.limit).toBeDefined();
      expect(data.offset).toBeDefined();
    });

    it('filters by category type (e.g. type=lounge)', async () => {
      const res = await fetch(`${baseUrl}/facilities?airport_id=${testAirportId}&type=lounge`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facilities.length).toBeGreaterThanOrEqual(1);
      data.facilities.forEach((f) => expect(f.type).toBe('lounge'));
    });

    it('filters by status (e.g. status=closed)', async () => {
      const res = await fetch(`${baseUrl}/facilities?airport_id=${testAirportId}&status=closed`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facilities.length).toBeGreaterThanOrEqual(1);
      data.facilities.forEach((f) => expect(f.status).toBe('closed'));
    });

    it('filters by name query q (case-insensitive substring search)', async () => {
      const res = await fetch(`${baseUrl}/facilities?airport_id=${testAirportId}&q=bistro`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facilities.length).toBe(1);
      expect(data.facilities[0].name).toContain('Bistro');
    });

    it('paginates results with limit and offset', async () => {
      const res = await fetch(`${baseUrl}/facilities?airport_id=${testAirportId}&limit=1&offset=0`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facilities.length).toBe(1);
      expect(data.limit).toBe(1);
      expect(data.offset).toBe(0);
      expect(data.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('2. GET /facilities/:id', () => {
    it('returns facility details for valid id (200)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facility.id).toBe(targetId);
      expect(data.facility.name).toBe('Alpha Lounge Express');
      expect(data.facility.airport_code).toBeDefined();
    });

    it('returns 404 for non-existent facility id', async () => {
      const res = await fetch(`${baseUrl}/facilities/999999`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Facility not found');
    });

    it('returns 400 for malformed facility id', async () => {
      const res = await fetch(`${baseUrl}/facilities/abc`, {
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('3. POST /facilities (Creation & Permissions)', () => {
    it('prevents passengers from creating facilities (403)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${passengerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'Unauthorized Cafe',
          type: 'restaurant',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('prevents ground_crew from creating facilities (403)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groundCrewToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'Unauthorized Crew Cafe',
          type: 'restaurant',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects input with name shorter than 2 characters (400)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'A',
          type: 'lounge',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects input with name exceeding 80 characters (400)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'X'.repeat(81),
          type: 'lounge',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid facility type (400)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'Invalid Type Place',
          type: 'casino_gambling',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects unknown airport_id (400)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: 999999,
          name: 'Airport Not Found Place',
          type: 'restaurant',
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Airport not found');
    });

    it('allows ops_manager to create a valid facility (201)', async () => {
      const res = await fetch(`${baseUrl}/facilities`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opsToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          airport_id: testAirportId,
          name: 'Ops Charging Lounge',
          type: 'charging_station',
          location_terminal: 'Terminal 3',
          location_gate_proximity: 'Near Gate 19',
          status: 'open',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.facility.id).toBeDefined();
      expect(data.facility.name).toBe('Ops Charging Lounge');
      expect(data.facility.type).toBe('charging_station');
      createdFacilityIds.push(data.facility.id);
    });
  });

  describe('4. PATCH /facilities/:id (Edit & Permissions)', () => {
    it('prevents passenger from editing facility (403)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${passengerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Hacked Name' }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when updating non-existent facility', async () => {
      const res = await fetch(`${baseUrl}/facilities/999999`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'New Name' }),
      });
      expect(res.status).toBe(404);
    });

    it('allows admin to edit facility details (200)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Alpha VIP Lounge Express',
          location_gate_proximity: 'Gate 4 Concourse',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facility.name).toBe('Alpha VIP Lounge Express');
      expect(data.facility.location_gate_proximity).toBe('Gate 4 Concourse');
    });
  });

  describe('5. PATCH /facilities/:id/status (Status Pipeline & Ground Crew Access)', () => {
    it('prevents passenger from updating status (403)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${passengerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'closed' }),
      });
      expect(res.status).toBe(403);
    });

    it('allows ground_crew to update facility status to closed (200)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${groundCrewToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'closed' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facility.status).toBe('closed');
    });

    it('allows admin to toggle facility status back to open (200)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'open' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.facility.status).toBe('open');
    });

    it('rejects invalid status value (400)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'broken' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('6. DELETE /facilities/:id (Deletion & Permissions)', () => {
    it('prevents passenger from deleting facility (403)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${passengerToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('prevents ground_crew from deleting facility (403)', async () => {
      const targetId = createdFacilityIds[0];
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${groundCrewToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when deleting non-existent facility', async () => {
      const res = await fetch(`${baseUrl}/facilities/999999`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
    });

    it('allows admin to delete facility (200)', async () => {
      const targetId = createdFacilityIds.pop();
      const res = await fetch(`${baseUrl}/facilities/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toContain('deleted');

      // Verify deletion from db
      const check = await pool.query('SELECT id FROM facility WHERE id = $1', [targetId]);
      expect(check.rows.length).toBe(0);
    });
  });
});
