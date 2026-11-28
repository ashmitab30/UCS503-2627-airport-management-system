import express from 'express';
import http from 'http';
import { pool } from '../src/db/pool.js';
import { employeesRouter } from '../src/routes/employees.js';
import { hashPassword, comparePassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Employee Credentials & Resend Tests (POST /employees)', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let nonAdminUser;
  let nonAdminToken;
  let createdEmployeeId;
  let createdUserId;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/employees', employeesRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const adminHash = await hashPassword('AdminPass123!');
    const aRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Emp Test Admin', 'emp_admin_' || gen_random_uuid() || '@example.com', $1, 'admin')
       RETURNING id, name, email, role`,
      [adminHash]
    );
    adminUser = aRes.rows[0];
    adminToken = signToken(adminUser);

    const nonAdminHash = await hashPassword('StaffPass123!');
    const naRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Emp Test Staff', 'emp_staff_' || gen_random_uuid() || '@example.com', $1, 'ground_crew')
       RETURNING id, name, email, role`,
      [nonAdminHash]
    );
    nonAdminUser = naRes.rows[0];
    nonAdminToken = signToken(nonAdminUser);
  });

  afterAll(async () => {
    if (createdEmployeeId) {
      await pool.query('DELETE FROM employee WHERE id = $1', [createdEmployeeId]);
    }
    if (createdUserId) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [createdUserId]);
    }
    if (adminUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [adminUser.id]);
    }
    if (nonAdminUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [nonAdminUser.id]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. POST /employees creates an employee without returning tempPassword in response', async () => {
    const email = `emp_new_${Date.now()}@meridianops.com`;
    const res = await fetch(`${baseUrl}/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'New Hire Officer',
        email,
        role: 'security',
        department: 'Security',
        role_title: 'Security Officer',
        certification: 'Aviation Security',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.employee).toBeDefined();
    expect(body.employee.user.email).toBe(email);
    expect(body.tempPassword).toBeUndefined();
    expect(body.emailSent).toBe(true);
    expect(body.message).toMatch(/credentials have been emailed/i);

    createdEmployeeId = body.employee.id;
    createdUserId = body.employee.user_id;

    const uRow = await pool.query('SELECT password_hash FROM "user" WHERE id = $1', [createdUserId]);
    expect(uRow.rows[0].password_hash).toBeTruthy();
  });

  it('2. POST /employees/:id/resend-credentials succeeds for admin, updates hash, and does not return password', async () => {
    const beforeRow = await pool.query('SELECT password_hash FROM "user" WHERE id = $1', [createdUserId]);
    const oldHash = beforeRow.rows[0].password_hash;

    const res = await fetch(`${baseUrl}/employees/${createdEmployeeId}/resend-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.emailSent).toBe(true);
    expect(body.message).toMatch(/credentials resent to/i);
    expect(body.tempPassword).toBeUndefined();
    expect(body.password).toBeUndefined();

    const afterRow = await pool.query('SELECT password_hash FROM "user" WHERE id = $1', [createdUserId]);
    const newHash = afterRow.rows[0].password_hash;
    expect(newHash).not.toBe(oldHash);
  });

  it('3. POST /employees/:id/resend-credentials rejects non-admin with 403', async () => {
    const res = await fetch(`${baseUrl}/employees/${createdEmployeeId}/resend-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nonAdminToken}`,
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });
});
