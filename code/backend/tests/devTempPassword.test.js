import { jest } from '@jest/globals';

const mockSendStaffCredentialsEmail = jest.fn();
jest.unstable_mockModule('../src/utils/mail.js', () => ({
  sendStaffCredentialsEmail: mockSendStaffCredentialsEmail,
  sendPasswordChangeCodeEmail: jest.fn(),
}));

const express = (await import('express')).default;
const http = (await import('http')).default;
const { pool } = await import('../src/db/pool.js');
const { employeesRouter } = await import('../src/routes/employees.js');
const { hashPassword } = await import('../src/utils/password.js');
const { signToken } = await import('../src/utils/jwt.js');
const { attachDevPassword } = await import('../src/utils/devPassword.js');

describe('Dev Temp Password Tests (Task 12.2)', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let createdEmployeeId;
  let createdUserId;
  const originalEnv = process.env.NODE_ENV;

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
       VALUES ('Dev Aid Admin', 'dev_admin_' || gen_random_uuid() || '@example.com', $1, 'admin')
       RETURNING id, name, email, role`,
      [adminHash]
    );
    adminUser = aRes.rows[0];
    adminToken = signToken(adminUser);
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    if (createdEmployeeId) {
      await pool.query('DELETE FROM employee WHERE id = $1', [createdEmployeeId]);
    }
    if (createdUserId) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [createdUserId]);
    }
    if (adminUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [adminUser.id]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Part 1: attachDevPassword helper unit logic', () => {
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('attaches devTempPassword when emailSent is false in non-production', () => {
      process.env.NODE_ENV = 'development';
      const res = attachDevPassword({ ok: true, emailSent: false }, 'TempPass123!', false);
      expect(res.devTempPassword).toBe('TempPass123!');
      expect(res.ok).toBe(true);
    });

    it('attaches devTempPassword when mail is dev fallback (unconfigured SMTP) in non-production', () => {
      process.env.NODE_ENV = 'test';
      const res = attachDevPassword(
        { ok: true, emailSent: true },
        'TempPass123!',
        true,
        { sent: true, devFallback: true }
      );
      expect(res.devTempPassword).toBe('TempPass123!');
    });

    it('omits devTempPassword when email was actually sent (no fallback) in non-production', () => {
      process.env.NODE_ENV = 'development';
      const res = attachDevPassword(
        { ok: true, emailSent: true },
        'TempPass123!',
        true,
        { sent: true }
      );
      expect(res.devTempPassword).toBeUndefined();
    });

    it('omits devTempPassword when NODE_ENV is production even if email was NOT sent', () => {
      process.env.NODE_ENV = 'production';
      const res1 = attachDevPassword({ ok: true, emailSent: false }, 'TempPass123!', false);
      expect(res1.devTempPassword).toBeUndefined();

      const res2 = attachDevPassword(
        { ok: true, emailSent: true },
        'TempPass123!',
        true,
        { sent: true, devFallback: true }
      );
      expect(res2.devTempPassword).toBeUndefined();
    });

    it('omits devTempPassword when NODE_ENV is production and email was sent', () => {
      process.env.NODE_ENV = 'production';
      const res = attachDevPassword(
        { ok: true, emailSent: true },
        'TempPass123!',
        true,
        { sent: true }
      );
      expect(res.devTempPassword).toBeUndefined();
    });
  });

  describe('Part 2: HTTP Integration on endpoints (POST /employees and resend-credentials)', () => {
    let empEmail;

    beforeEach(() => {
      process.env.NODE_ENV = 'test';
      mockSendStaffCredentialsEmail.mockReset();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('Condition A: email not sent in non-production -> devTempPassword present on both endpoints', async () => {
      process.env.NODE_ENV = 'development';
      mockSendStaffCredentialsEmail.mockResolvedValue({ sent: true, devFallback: true });
      empEmail = `dev_hire_${Date.now()}@meridianops.com`;

      // 1. POST /employees
      const createRes = await fetch(`${baseUrl}/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Dev Hire Tech',
          email: empEmail,
          role: 'ground_crew',
          department: 'Ground Operations',
          role_title: 'Baggage Handler',
        }),
      });

      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.employee).toBeDefined();
      expect(createBody.devTempPassword).toBeDefined();
      expect(typeof createBody.devTempPassword).toBe('string');
      expect(createBody.devTempPassword.length).toBeGreaterThan(5);

      createdEmployeeId = createBody.employee.id;
      createdUserId = createBody.employee.user_id;

      // 2. POST /employees/:id/resend-credentials
      const resendRes = await fetch(`${baseUrl}/employees/${createdEmployeeId}/resend-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(resendRes.status).toBe(200);
      const resendBody = await resendRes.json();
      expect(resendBody.ok).toBe(true);
      expect(resendBody.devTempPassword).toBeDefined();
      expect(typeof resendBody.devTempPassword).toBe('string');
      expect(resendBody.devTempPassword.length).toBeGreaterThan(5);
    });

    it('Condition B: email sent (mocked successful delivery) -> devTempPassword absent on both endpoints', async () => {
      process.env.NODE_ENV = 'development';
      mockSendStaffCredentialsEmail.mockResolvedValue({ sent: true });

      const emailB = `dev_sent_${Date.now()}@meridianops.com`;
      const createRes = await fetch(`${baseUrl}/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Sent Hire Tech',
          email: emailB,
          role: 'medical',
          department: 'Emergency & Medical',
          role_title: 'Airport Paramedic',
        }),
      });

      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.devTempPassword).toBeUndefined();

      const tempEmpId = createBody.employee.id;
      const tempUserId = createBody.employee.user_id;

      const resendRes = await fetch(`${baseUrl}/employees/${tempEmpId}/resend-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(resendRes.status).toBe(200);
      const resendBody = await resendRes.json();
      expect(resendBody.devTempPassword).toBeUndefined();

      // Clean up temp record
      await pool.query('DELETE FROM employee WHERE id = $1', [tempEmpId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [tempUserId]);
    });

    it('Condition C: production mode (NODE_ENV = production) -> devTempPassword absent on both endpoints', async () => {
      process.env.NODE_ENV = 'production';
      // In production, sendStaffCredentialsEmail succeeds so endpoint doesn't return 500
      mockSendStaffCredentialsEmail.mockResolvedValue({ sent: true });

      const emailC = `dev_prod_${Date.now()}@meridianops.com`;
      const createRes = await fetch(`${baseUrl}/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Prod Hire Tech',
          email: emailC,
          role: 'security',
          department: 'Security',
          role_title: 'Security Officer',
        }),
      });

      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.devTempPassword).toBeUndefined();

      const tempEmpId = createBody.employee.id;
      const tempUserId = createBody.employee.user_id;

      const resendRes = await fetch(`${baseUrl}/employees/${tempEmpId}/resend-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(resendRes.status).toBe(200);
      const resendBody = await resendRes.json();
      expect(resendBody.devTempPassword).toBeUndefined();

      // Clean up temp record
      await pool.query('DELETE FROM employee WHERE id = $1', [tempEmpId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [tempUserId]);
    });
  });
});
