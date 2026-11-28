import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { emergenciesRouter } from '../src/routes/emergencies.js';
import { hashPassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Emergency Audit Trail & WebSocket Alerts (Task 13)', () => {
  let server;
  let baseUrl;
  let stubIo;
  let capturedEmits = [];

  let adminUser, adminToken;
  let medicalUser, medicalToken;
  let groundCrewUser, groundCrewToken;
  let securityUser, securityToken;
  let passengerUser, passengerToken;

  let createdEmergencyIds = [];
  let testGateId;

  beforeAll(async () => {
    // 1. Setup mock/stub socket.io that verifies room targeting and proves no global emit
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
        throw new Error('VIOLATION: global io.emit must not be called for emergencies!');
      },
    };

    const app = express();
    app.set('io', stubIo);
    app.use(express.json());
    app.use('/emergencies', emergenciesRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Create test users in test database
    const passHash = await hashPassword('Pass123!');
    async function createTestUser(name, role) {
      const email = `em_test_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@meridian.com`;
      const res = await pool.query(
        `INSERT INTO "user" (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role`,
        [name, email, passHash, role]
      );
      return res.rows[0];
    }

    adminUser = await createTestUser('Emergency Admin', 'admin');
    adminToken = signToken(adminUser);

    medicalUser = await createTestUser('Dr. Test Medical', 'medical');
    medicalToken = signToken(medicalUser);

    groundCrewUser = await createTestUser('Test Ground Crew', 'ground_crew');
    groundCrewToken = signToken(groundCrewUser);

    securityUser = await createTestUser('Test Security Officer', 'security');
    securityToken = signToken(securityUser);

    passengerUser = await createTestUser('Test Passenger', 'passenger');
    passengerToken = signToken(passengerUser);

    // Get an existing gate from airport_test
    const gateRes = await pool.query('SELECT id FROM gate LIMIT 1');
    testGateId = gateRes.rows[0]?.id || 1;
  });

  beforeEach(() => {
    capturedEmits = [];
  });

  afterAll(async () => {
    for (const emId of createdEmergencyIds) {
      await pool.query('DELETE FROM emergency_event WHERE id = $1', [emId]);
    }
    const testUserIds = [adminUser?.id, medicalUser?.id, groundCrewUser?.id, securityUser?.id, passengerUser?.id].filter(Boolean);
    if (testUserIds.length > 0) {
      await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [testUserIds]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. POST / declares emergency, inserts audit rows in order (declared + alert_sent) within transaction, and broadcasts ONLY to alerted roles + ops_feed', async () => {
    const res = await fetch(`${baseUrl}/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medicalToken}`,
      },
      body: JSON.stringify({
        type: 'medical',
        gate_id: testGateId,
        notes: 'Test passenger collapsed near gate seating',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emergency).toBeDefined();
    expect(body.emergency.status).toBe('active');
    expect(body.alertedRoles).toEqual(expect.arrayContaining(['medical', 'ops_manager', 'admin']));

    const emId = body.emergency.id;
    createdEmergencyIds.push(emId);

    // Check audit rows written in DB
    const auditRes = await pool.query(
      'SELECT action, actor_user_id, actor_role, details FROM emergency_audit WHERE emergency_id = $1 ORDER BY id ASC',
      [emId]
    );

    expect(auditRes.rows.length).toBe(4); // 1 'declared' + 3 'alert_sent'
    expect(auditRes.rows[0].action).toBe('declared');
    expect(auditRes.rows[0].actor_user_id).toBe(medicalUser.id);
    expect(auditRes.rows[0].actor_role).toBe('medical');
    expect(auditRes.rows[0].details.notes).toBe('Test passenger collapsed near gate seating');

    const alertSentRoles = auditRes.rows.slice(1).map((r) => r.details.recipient_role);
    expect(alertSentRoles).toEqual(expect.arrayContaining(['medical', 'ops_manager', 'admin']));

    // Check websocket emission
    expect(capturedEmits.length).toBe(1);
    const emit = capturedEmits[0];
    expect(emit.event).toBe('emergency:declared');
    expect(emit.rooms).toEqual(expect.arrayContaining(['role:medical', 'role:ops_manager', 'role:admin', 'ops_feed']));
    // Passenger must receive nothing:
    expect(emit.rooms).not.toContain('role:passenger');
  });

  it('2. GET /emergencies/active-for-me returns active emergencies for alerted role and rejects passengers with 403', async () => {
    // Passenger gets 403
    const passRes = await fetch(`${baseUrl}/emergencies/active-for-me`, {
      headers: { Authorization: `Bearer ${passengerToken}` },
    });
    expect(passRes.status).toBe(403);

    // Medical staff gets the medical emergency
    const medRes = await fetch(`${baseUrl}/emergencies/active-for-me`, {
      headers: { Authorization: `Bearer ${medicalToken}` },
    });
    expect(medRes.status).toBe(200);
    const medBody = await medRes.json();
    expect(medBody.emergencies.length).toBeGreaterThanOrEqual(1);
    const latestEm = medBody.emergencies.find((e) => e.id === createdEmergencyIds[0]);
    expect(latestEm).toBeDefined();
    expect(latestEm.type).toBe('medical');
    expect(latestEm.is_acknowledged).toBe(false);

    // Ground crew was NOT alerted for this medical emergency -> must not see it
    const gcRes = await fetch(`${baseUrl}/emergencies/active-for-me`, {
      headers: { Authorization: `Bearer ${groundCrewToken}` },
    });
    expect(gcRes.status).toBe(200);
    const gcBody = await gcRes.json();
    const gcFound = gcBody.emergencies.find((e) => e.id === createdEmergencyIds[0]);
    expect(gcFound).toBeUndefined();
  });

  it('3. PATCH /:id/acknowledge updates alert row, writes audit entry, and does NOT mark other roles', async () => {
    const emId = createdEmergencyIds[0];

    const ackRes = await fetch(`${baseUrl}/emergencies/${emId}/acknowledge`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${medicalToken}` },
    });

    expect(ackRes.status).toBe(200);
    const ackBody = await ackRes.json();
    expect(ackBody.alert).toBeDefined();
    expect(ackBody.alert.acknowledged_by).toBe(medicalUser.id);
    expect(ackBody.alert.acknowledged_at).toBeTruthy();

    // Check audit trail contains 'acknowledged'
    const auditRes = await pool.query(
      "SELECT action, actor_user_id, actor_role, details FROM emergency_audit WHERE emergency_id = $1 AND action = 'acknowledged'",
      [emId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].actor_user_id).toBe(medicalUser.id);
    expect(auditRes.rows[0].actor_role).toBe('medical');

    // Verify other roles (ops_manager, admin) are NOT marked acknowledged
    const otherAlerts = await pool.query(
      "SELECT recipient_role, acknowledged_at, acknowledged_by FROM emergency_alert WHERE emergency_id = $1 AND recipient_role != 'medical'",
      [emId]
    );
    for (const row of otherAlerts.rows) {
      expect(row.acknowledged_at).toBeNull();
      expect(row.acknowledged_by).toBeNull();
    }

    // Check socket emit
    expect(capturedEmits.length).toBe(1);
    expect(capturedEmits[0].event).toBe('emergency:acknowledged');
    expect(capturedEmits[0].data.emergencyId).toBe(emId);
    expect(capturedEmits[0].data.role).toBe('medical');
    expect(capturedEmits[0].rooms).toEqual(expect.arrayContaining(['role:medical', 'ops_feed']));
  });

  it('4. POST /:id/notes adds note to audit trail, enforces 500-char limit and permissions, and refuses for resolved emergencies', async () => {
    const emId = createdEmergencyIds[0];

    // Non-alerted role (ground_crew) is rejected with 403
    const forbiddenRes = await fetch(`${baseUrl}/emergencies/${emId}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groundCrewToken}`,
      },
      body: JSON.stringify({ note: 'Ground crew trying to add note' }),
    });
    expect(forbiddenRes.status).toBe(403);

    // Note over 500 characters is rejected with 400
    const tooLongRes = await fetch(`${baseUrl}/emergencies/${emId}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medicalToken}`,
      },
      body: JSON.stringify({ note: 'A'.repeat(501) }),
    });
    expect(tooLongRes.status).toBe(400);

    // Alerted role (medical) succeeds
    const noteRes = await fetch(`${baseUrl}/emergencies/${emId}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medicalToken}`,
      },
      body: JSON.stringify({ note: 'Paramedics on scene; administering CPR and oxygen.' }),
    });
    expect(noteRes.status).toBe(201);
    const noteBody = await noteRes.json();
    expect(noteBody.audit).toBeDefined();
    expect(noteBody.audit.action).toBe('note_added');
    expect(noteBody.audit.details.note).toBe('Paramedics on scene; administering CPR and oxygen.');

    // Socket broadcast emergency:note
    expect(capturedEmits.length).toBe(1);
    expect(capturedEmits[0].event).toBe('emergency:note');
    expect(capturedEmits[0].data.note).toBe('Paramedics on scene; administering CPR and oxygen.');
  });

  it('5. GET /:id/audit returns ordered trail with actor names and rejects passengers / non-alerted staff with 403', async () => {
    const emId = createdEmergencyIds[0];

    // Passenger gets 403
    const passRes = await fetch(`${baseUrl}/emergencies/${emId}/audit`, {
      headers: { Authorization: `Bearer ${passengerToken}` },
    });
    expect(passRes.status).toBe(403);

    // Non-alerted staff gets 403
    const gcRes = await fetch(`${baseUrl}/emergencies/${emId}/audit`, {
      headers: { Authorization: `Bearer ${groundCrewToken}` },
    });
    expect(gcRes.status).toBe(403);

    // Alerted staff gets 200 with ordered trail
    const auditRes = await fetch(`${baseUrl}/emergencies/${emId}/audit`, {
      headers: { Authorization: `Bearer ${medicalToken}` },
    });
    expect(auditRes.status).toBe(200);
    const body = await auditRes.json();
    expect(Array.isArray(body.audit)).toBe(true);
    expect(body.audit.length).toBeGreaterThanOrEqual(3);

    const actions = body.audit.map((a) => a.action);
    expect(actions[0]).toBe('declared');
    expect(actions).toContain('alert_sent');
    expect(actions).toContain('acknowledged');
    expect(actions).toContain('note_added');
    expect(body.audit[0].actor_name).toBe(medicalUser.name);
  });

  it('6. PATCH /:id/resolve restricts resolution to alerted roles/admin, logs audit row, and locks notes', async () => {
    const emId = createdEmergencyIds[0];

    // Non-alerted role (ground_crew) gets 403
    const forbiddenRes = await fetch(`${baseUrl}/emergencies/${emId}/resolve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groundCrewToken}`,
      },
      body: JSON.stringify({ resolution_notes: 'Ground crew attempting resolve' }),
    });
    expect(forbiddenRes.status).toBe(403);

    // Alerted role (medical) succeeds
    const resolveRes = await fetch(`${baseUrl}/emergencies/${emId}/resolve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medicalToken}`,
      },
      body: JSON.stringify({ resolution_notes: 'Patient vitals stable, escorted to medical bay.' }),
    });
    expect(resolveRes.status).toBe(200);
    const resolveBody = await resolveRes.json();
    expect(resolveBody.emergency.status).toBe('resolved');

    // Audit trail has 'resolved'
    const auditRes = await pool.query(
      "SELECT action, actor_user_id, details FROM emergency_audit WHERE emergency_id = $1 AND action = 'resolved'",
      [emId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].actor_user_id).toBe(medicalUser.id);
    expect(auditRes.rows[0].details.resolution_notes).toBe('Patient vitals stable, escorted to medical bay.');

    // Socket emit emergency:resolved
    expect(capturedEmits.length).toBe(1);
    expect(capturedEmits[0].event).toBe('emergency:resolved');

    // Adding notes to resolved emergency is now refused
    const noteAfterResolve = await fetch(`${baseUrl}/emergencies/${emId}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medicalToken}`,
      },
      body: JSON.stringify({ note: 'Late note attempt' }),
    });
    expect(noteAfterResolve.status).toBe(400);
  });

  it('7. Database trigger rejects UPDATE on emergency_audit table (append-only enforcement)', async () => {
    const emId = createdEmergencyIds[0];
    const auditRes = await pool.query('SELECT id FROM emergency_audit WHERE emergency_id = $1 LIMIT 1', [emId]);
    const auditId = auditRes.rows[0]?.id;
    expect(auditId).toBeTruthy();

    await expect(
      pool.query("UPDATE emergency_audit SET action = 'declared' WHERE id = $1", [auditId])
    ).rejects.toThrow(/emergency_audit table is append-only/);
  });
});
