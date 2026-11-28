import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { securityRouter } from '../src/routes/security.js';
import { hashPassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Task 15: Security Module Integration Tests (Incidents & Restricted Zones)', () => {
  let server;
  let baseUrl;
  let stubIo;
  let capturedEmits = [];

  let adminUser, adminToken, adminEmpId;
  let opsUser, opsToken, opsEmpId;
  let secUser, secToken, secEmpId;
  let crewUser, crewToken, crewEmpId;
  let medUser, medToken, medEmpId;
  let passUser, passToken;

  let createdIncidentIds = [];
  let createdAccessLogIds = [];
  let createdUserIds = [];
  let createdEmployeeIds = [];

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

    // 2. Create test users and matching employee records in test database (airport_test)
    const passHash = await hashPassword('Pass123!');
    async function createStaffWithEmployee(name, role, department, roleTitle) {
      const email = `sec15_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@meridian.com`;
      const uRes = await pool.query(
        `INSERT INTO "user" (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role`,
        [name, email, passHash, role]
      );
      const user = uRes.rows[0];
      createdUserIds.push(user.id);

      if (role !== 'passenger') {
        const eRes = await pool.query(
          `INSERT INTO employee (user_id, department, role_title, status)
           VALUES ($1, $2, $3, 'active')
           RETURNING id`,
          [user.id, department, roleTitle]
        );
        createdEmployeeIds.push(eRes.rows[0].id);
        user.employeeId = eRes.rows[0].id;
      }
      return user;
    }

    adminUser = await createStaffWithEmployee('Admin S15', 'admin', 'Administration', 'Director');
    adminToken = signToken(adminUser);
    adminEmpId = adminUser.employeeId;

    opsUser = await createStaffWithEmployee('Ops S15', 'ops_manager', 'Operations', 'Manager');
    opsToken = signToken(opsUser);
    opsEmpId = opsUser.employeeId;

    secUser = await createStaffWithEmployee('Officer S15', 'security', 'Security', 'Officer');
    secToken = signToken(secUser);
    secEmpId = secUser.employeeId;

    crewUser = await createStaffWithEmployee('Crew S15', 'ground_crew', 'Ramp Ops', 'Handler');
    crewToken = signToken(crewUser);
    crewEmpId = crewUser.employeeId;

    medUser = await createStaffWithEmployee('Medic S15', 'medical', 'Health Care', 'Paramedic');
    medToken = signToken(medUser);
    medEmpId = medUser.employeeId;

    passUser = await createStaffWithEmployee('Passenger S15', 'passenger', '', '');
    passToken = signToken(passUser);

    // 3. Ensure standard restricted zones exist
    const zones = [
      { code: 'AIRSIDE_APRON', name: 'Airside Apron & Ramp', allowed: ['ground_crew', 'security', 'medical', 'ops_manager', 'admin'] },
      { code: 'BAGGAGE_HALL', name: 'Baggage Handling Hall', allowed: ['ground_crew', 'security', 'ops_manager', 'admin'] },
      { code: 'FUEL_FARM', name: 'Aviation Fuel Depot & Farm', allowed: ['ground_crew', 'ops_manager', 'admin'] },
      { code: 'CARGO_TERMINAL', name: 'Air Cargo & Freight Terminal', allowed: ['ground_crew', 'security', 'ops_manager', 'admin'] },
      { code: 'CONTROL_TOWER', name: 'Air Traffic Control Tower & Technical Core', allowed: ['ops_manager', 'admin'] },
      { code: 'SERVER_ROOM', name: 'Airfield IT & Telecom Server Room', allowed: ['admin'] },
    ];

    for (const z of zones) {
      await pool.query(
        `INSERT INTO restricted_zone (code, name, description, allowed_roles)
         VALUES ($1, $2, 'Test Zone Description', $3)
         ON CONFLICT (code) DO UPDATE SET allowed_roles = EXCLUDED.allowed_roles`,
        [z.code, z.name, z.allowed]
      );
    }
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (createdAccessLogIds.length > 0) {
      await pool.query('DELETE FROM restricted_zone_access WHERE id = ANY($1)', [createdAccessLogIds]);
    }
    if (createdIncidentIds.length > 0) {
      await pool.query('DELETE FROM security_incident_update WHERE incident_id = ANY($1)', [createdIncidentIds]);
      await pool.query('DELETE FROM security_incident WHERE id = ANY($1)', [createdIncidentIds]);
    }
    if (createdEmployeeIds.length > 0) {
      await pool.query('DELETE FROM employee WHERE id = ANY($1)', [createdEmployeeIds]);
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [createdUserIds]);
    }
  });

  beforeEach(() => {
    capturedEmits = [];
  });

  describe('1. Role-Based Access Control (403 for unauthorized roles)', () => {
    it('denies passenger from reporting or listing incidents (403)', async () => {
      const resPost = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${passToken}` },
        body: JSON.stringify({ location: 'Gate 5', type: 'other', severity: 'low' }),
      });
      expect(resPost.status).toBe(403);

      const resGet = await fetch(`${baseUrl}/security/incidents`, {
        headers: { Authorization: `Bearer ${passToken}` },
      });
      expect(resGet.status).toBe(403);
    });

    it('denies ground crew and medical from security incidents and zone access endpoints (403)', async () => {
      const resCrew = await fetch(`${baseUrl}/security/incidents`, {
        headers: { Authorization: `Bearer ${crewToken}` },
      });
      expect(resCrew.status).toBe(403);

      const resMed = await fetch(`${baseUrl}/security/zone-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${medToken}` },
        body: JSON.stringify({ zone: 'AIRSIDE_APRON', employee: crewUser.email }),
      });
      expect(resMed.status).toBe(403);
    });

    it('allows security, ops_manager and admin users to access endpoints (200)', async () => {
      const resSec = await fetch(`${baseUrl}/security/incidents`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(resSec.status).toBe(200);

      const resOps = await fetch(`${baseUrl}/security/zones`, {
        headers: { Authorization: `Bearer ${opsToken}` },
      });
      expect(resOps.status).toBe(200);
    });
  });

  describe('2. Incident Reporting, Validation & Socket Broadcasting', () => {
    it('validates required fields on incident creation (400 if invalid)', async () => {
      const resMissing = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ location: '', type: 'other', severity: 'low' }),
      });
      expect(resMissing.status).toBe(400);

      const resBadType = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ location: 'Gate 2', type: 'alien_invasion', severity: 'low' }),
      });
      expect(resBadType.status).toBe(400);

      const resBadSev = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ location: 'Gate 2', type: 'other', severity: 'extreme' }),
      });
      expect(resBadSev.status).toBe(400);

      const resLongDesc = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ location: 'Gate 2', type: 'other', severity: 'low', description: 'a'.repeat(1001) }),
      });
      expect(resLongDesc.status).toBe(400);
    });

    it('creates low/medium incident, writes timeline row, and emits to security rooms', async () => {
      const res = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({
          location: 'Terminal 1 Pier B Gate 9',
          type: 'unattended_baggage',
          severity: 'medium',
          description: 'Dark blue backpack left on charging seat bench',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.incident).toBeDefined();
      expect(data.incident.status).toBe('open');
      expect(data.incident.reported_by).toBe(secUser.id);
      createdIncidentIds.push(data.incident.id);

      // Verify timeline row created in DB
      const timeRows = await pool.query(
        'SELECT action, note, actor_user_id FROM security_incident_update WHERE incident_id = $1',
        [data.incident.id]
      );
      expect(timeRows.rows.length).toBe(1);
      expect(timeRows.rows[0].action).toBe('created');
      expect(timeRows.rows[0].actor_user_id).toBe(secUser.id);

      // Verify socket emission targeted to security, ops, admin rooms
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:incident');
      expect(capturedEmits[0].rooms).toEqual(['role:security', 'role:ops_manager', 'role:admin']);
    });

    it('creates critical incident and emits to security rooms AND ops_feed', async () => {
      const res = await fetch(`${baseUrl}/security/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opsToken}` },
        body: JSON.stringify({
          location: 'Airside Fuel Depot Perimeter',
          type: 'unauthorized_access',
          severity: 'critical',
          description: 'Fence motion detector triggered at outer fuel farm perimeter',
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      createdIncidentIds.push(data.incident.id);

      // Verify socket emission includes ops_feed
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:incident');
      expect(capturedEmits[0].rooms).toContain('ops_feed');
      expect(capturedEmits[0].rooms).toContain('role:security');
      expect(capturedEmits[0].rooms).toContain('role:ops_manager');
      expect(capturedEmits[0].rooms).toContain('role:admin');
    });
  });

  describe('3. Incident Status Progression & Workflow Guard (open -> investigating -> closed)', () => {
    let testIncId;

    beforeEach(async () => {
      const res = await pool.query(
        `INSERT INTO security_incident (location, type, severity, status, description, reported_by, "timestamp", updated_at)
         VALUES ('Test Concourse A', 'suspicious_behavior', 'high', 'open', 'Individual pacing repeatedly', $1, now(), now())
         RETURNING id`,
        [secUser.id]
      );
      testIncId = res.rows[0].id;
      createdIncidentIds.push(testIncId);
    });

    it('advances open -> investigating successfully and writes timeline row (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ status: 'investigating' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.incident.status).toBe('investigating');

      // Timeline row
      const tRes = await pool.query(
        "SELECT action, note FROM security_incident_update WHERE incident_id = $1 AND action = 'status_change'",
        [testIncId]
      );
      expect(tRes.rows.length).toBe(1);
      expect(tRes.rows[0].note).toMatch(/advanced from open to investigating/i);

      // Socket event
      expect(capturedEmits.length).toBe(1);
      expect(capturedEmits[0].event).toBe('security:incident_updated');
    });

    it('rejects jumping straight from open to closed (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ status: 'closed', resolution_notes: 'Premature close attempt' }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toMatch(/Cannot transition incident status from "open" to "closed"/i);
    });

    it('refuses closing without resolution_notes (400 Bad Request)', async () => {
      // First advance to investigating
      await pool.query("UPDATE security_incident SET status = 'investigating' WHERE id = $1", [testIncId]);

      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ status: 'closed', resolution_notes: '   ' }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/resolution_notes is required/i);
    });

    it('closes incident when resolution_notes are provided and stores closed_at (200 OK)', async () => {
      await pool.query("UPDATE security_incident SET status = 'investigating' WHERE id = $1", [testIncId]);

      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({
          status: 'closed',
          resolution_notes: 'Passenger identified as transit passenger looking for gate; cleared without incident.',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.incident.status).toBe('closed');
      expect(data.incident.closed_at).toBeTruthy();
      expect(data.incident.resolution_notes).toContain('transit passenger looking for gate');

      // Timeline row
      const tRes = await pool.query(
        "SELECT action, note FROM security_incident_update WHERE incident_id = $1 AND action = 'status_change'",
        [testIncId]
      );
      expect(tRes.rows.length).toBe(1);
      expect(tRes.rows[0].note).toContain('Incident closed. Resolution:');
    });

    it('rejects transitioning backwards from investigating -> open (409 Conflict)', async () => {
      await pool.query("UPDATE security_incident SET status = 'investigating' WHERE id = $1", [testIncId]);

      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ status: 'open' }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects reopening a closed incident (409 Conflict)', async () => {
      await pool.query("UPDATE security_incident SET status = 'closed', closed_at = now() WHERE id = $1", [testIncId]);

      const res = await fetch(`${baseUrl}/security/incidents/${testIncId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ status: 'investigating' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('4. Assignment & Timeline Notes', () => {
    let incId;

    beforeEach(async () => {
      const res = await pool.query(
        `INSERT INTO security_incident (location, type, severity, status, description, reported_by, "timestamp", updated_at)
         VALUES ('Duty Free North', 'theft', 'medium', 'open', 'Perfume tester bottle missing', $1, now(), now())
         RETURNING id`,
        [secUser.id]
      );
      incId = res.rows[0].id;
      createdIncidentIds.push(incId);
    });

    it('assigns to officer (or self if omitted) and writes timeline row', async () => {
      // Self assign
      const resSelf = await fetch(`${baseUrl}/security/incidents/${incId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({}),
      });
      expect(resSelf.status).toBe(200);
      const dataSelf = await resSelf.json();
      expect(dataSelf.incident.assigned_to).toBe(secUser.id);

      // Verify timeline row
      const tRes = await pool.query(
        "SELECT action, note FROM security_incident_update WHERE incident_id = $1 AND action = 'assigned'",
        [incId]
      );
      expect(tRes.rows.length).toBe(1);
      expect(tRes.rows[0].note).toContain(secUser.name);

      // Assign to Ops Manager
      const resOps = await fetch(`${baseUrl}/security/incidents/${incId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ assigned_to: opsUser.id }),
      });
      expect(resOps.status).toBe(200);
      const dataOps = await resOps.json();
      expect(dataOps.incident.assigned_to).toBe(opsUser.id);
    });

    it('rejects assigning to non-security/non-admin user (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/security/incidents/${incId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ assigned_to: passUser.id }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/Assignee must be an active security, ops_manager, or admin/i);
    });

    it('appends notes to incident timeline', async () => {
      const res = await fetch(`${baseUrl}/security/incidents/${incId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ note: 'Reviewed CCTV camera feed between 14:00 and 14:30.' }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.update.note).toBe('Reviewed CCTV camera feed between 14:00 and 14:30.');
      expect(data.update.actor_user_id).toBe(secUser.id);

      // Fetch incident details to verify timeline inclusion
      const getRes = await fetch(`${baseUrl}/security/incidents/${incId}`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(getRes.status).toBe(200);
      const detail = await getRes.json();
      expect(Array.isArray(detail.incident.timeline)).toBe(true);
      expect(detail.incident.timeline.some((t) => t.note.includes('Reviewed CCTV'))).toBe(true);
    });
  });

  describe('5. Restricted Zones & Clearance Decision Matrix', () => {
    it('returns list of restricted zones (GET /security/zones)', async () => {
      const res = await fetch(`${baseUrl}/security/zones`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.zones)).toBe(true);
      const codes = data.zones.map((z) => z.code);
      expect(codes).toContain('AIRSIDE_APRON');
      expect(codes).toContain('CONTROL_TOWER');
      expect(codes).toContain('SERVER_ROOM');
    });

    it('returns 404 for unknown employee or unknown zone', async () => {
      const resBadZone = await fetch(`${baseUrl}/security/zone-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ zone: 'UNKNOWN_ZONE_CODE', employee: crewUser.email }),
      });
      expect(resBadZone.status).toBe(404);

      const resBadEmp = await fetch(`${baseUrl}/security/zone-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ zone: 'AIRSIDE_APRON', employee: 'nonexistent@nowhere.com' }),
      });
      expect(resBadEmp.status).toBe(404);
    });

    it('correctly evaluates all role and zone permissions', async () => {
      const cases = [
        // Ground crew: allowed AIRSIDE_APRON, BAGGAGE_HALL, FUEL_FARM, CARGO_TERMINAL; denied CONTROL_TOWER, SERVER_ROOM
        { emp: crewUser.email, zone: 'AIRSIDE_APRON', expected: true },
        { emp: crewUser.email, zone: 'BAGGAGE_HALL', expected: true },
        { emp: crewUser.email, zone: 'FUEL_FARM', expected: true },
        { emp: crewUser.email, zone: 'CARGO_TERMINAL', expected: true },
        { emp: crewUser.email, zone: 'CONTROL_TOWER', expected: false },
        { emp: crewUser.email, zone: 'SERVER_ROOM', expected: false },

        // Security: allowed AIRSIDE_APRON, BAGGAGE_HALL, CARGO_TERMINAL; denied FUEL_FARM, CONTROL_TOWER, SERVER_ROOM
        { emp: secUser.email, zone: 'AIRSIDE_APRON', expected: true },
        { emp: secUser.email, zone: 'BAGGAGE_HALL', expected: true },
        { emp: secUser.email, zone: 'CARGO_TERMINAL', expected: true },
        { emp: secUser.email, zone: 'FUEL_FARM', expected: false },
        { emp: secUser.email, zone: 'CONTROL_TOWER', expected: false },
        { emp: secUser.email, zone: 'SERVER_ROOM', expected: false },

        // Medical: allowed AIRSIDE_APRON; denied BAGGAGE_HALL, SERVER_ROOM
        { emp: medUser.email, zone: 'AIRSIDE_APRON', expected: true },
        { emp: medUser.email, zone: 'BAGGAGE_HALL', expected: false },
        { emp: medUser.email, zone: 'SERVER_ROOM', expected: false },

        // Ops Manager: allowed CONTROL_TOWER, AIRSIDE_APRON; denied SERVER_ROOM
        { emp: opsUser.email, zone: 'CONTROL_TOWER', expected: true },
        { emp: opsUser.email, zone: 'AIRSIDE_APRON', expected: true },
        { emp: opsUser.email, zone: 'SERVER_ROOM', expected: false },

        // Admin: allowed everywhere
        { emp: adminUser.email, zone: 'SERVER_ROOM', expected: true },
        { emp: adminUser.email, zone: 'CONTROL_TOWER', expected: true },
      ];

      for (const c of cases) {
        const res = await fetch(`${baseUrl}/security/zone-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
          body: JSON.stringify({ zone: c.zone, employee: c.emp }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.access_granted).toBe(c.expected);
        if (data.access_log?.id) createdAccessLogIds.push(data.access_log.id);
        if (data.incident?.id) createdIncidentIds.push(data.incident.id);
      }
    });

    it('denied zone attempt generates unauthorized_access medium incident, logs attempt and emits alert', async () => {
      const res = await fetch(`${baseUrl}/security/zone-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secToken}` },
        body: JSON.stringify({ zone: 'SERVER_ROOM', employee: crewUser.email }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.access_granted).toBe(false);
      expect(data.reason).toMatch(/is NOT authorized/i);
      expect(data.incident).toBeDefined();
      expect(data.incident.type).toBe('unauthorized_access');
      expect(data.incident.severity).toBe('medium');
      expect(data.incident.status).toBe('open');

      createdAccessLogIds.push(data.access_log.id);
      createdIncidentIds.push(data.incident.id);

      // Verify DB incident record
      const incDb = await pool.query('SELECT type, severity FROM security_incident WHERE id = $1', [data.incident.id]);
      expect(incDb.rows[0].type).toBe('unauthorized_access');
      expect(incDb.rows[0].severity).toBe('medium');

      // Verify socket emit: security:zone_denied
      const deniedEmit = capturedEmits.find((e) => e.event === 'security:zone_denied');
      expect(deniedEmit).toBeDefined();
      expect(deniedEmit.rooms).toContain('role:security');
      expect(deniedEmit.rooms).toContain('role:ops_manager');
      expect(deniedEmit.rooms).toContain('role:admin');
    });
  });

  describe('6. Zone Access Logs Feed & Filtering (GET /security/zone-access)', () => {
    it('lists access logs with filtering by zone and access decision', async () => {
      const res = await fetch(`${baseUrl}/security/zone-access?zone=SERVER_ROOM&limit=10&offset=0`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.logs)).toBe(true);
      expect(typeof data.total).toBe('number');
      data.logs.forEach((log) => {
        expect(log.zone).toBe('SERVER_ROOM');
      });
    });
  });

  describe('7. Incidents Header Summary Telemetry (GET /security/incidents/summary)', () => {
    it('returns counts of active/open incidents broken down by severity', async () => {
      const res = await fetch(`${baseUrl}/security/incidents/summary`, {
        headers: { Authorization: `Bearer ${secToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.summary).toBeDefined();
      expect(typeof data.summary.total_open).toBe('number');
      expect(typeof data.summary.open_critical).toBe('number');
      expect(typeof data.summary.open_high).toBe('number');
      expect(typeof data.summary.open_medium).toBe('number');
      expect(typeof data.summary.open_low).toBe('number');
    });
  });
});
