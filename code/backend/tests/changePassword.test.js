import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { authRouter } from '../src/routes/auth.js';
import { hashPassword, comparePassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';

describe('Staff Change-Password Endpoint Tests (POST /auth/change-password)', () => {
  let server;
  let baseUrl;
  let testUserId;
  let validToken;
  const testEmail = `pw_staff_${Date.now()}@example.com`;
  const initialPassword = 'InitialStaffPassword123';

  beforeAll(async () => {
    // 1. Start ephemeral HTTP server with authRouter
    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Create test staff user
    const passwordHash = await hashPassword(initialPassword);
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Password Test Staff', $1, $2, 'ground_crew')
       RETURNING id, name, email, role`,
      [testEmail, passwordHash]
    );
    testUserId = uRes.rows[0].id;
    validToken = signToken(uRes.rows[0]);
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query('DELETE FROM password_change_code WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. Requesting a code returns ok: true and masked email', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.masked_email).toMatch(/^p\*\*\*@example\.com$/);
    expect(body.message).toContain('Confirmation code sent to');

    const codeRow = await pool.query(
      'SELECT id, code_hash, used_at, attempts FROM password_change_code WHERE user_id = $1 AND used_at IS NULL',
      [testUserId]
    );
    expect(codeRow.rows.length).toBe(1);
    expect(codeRow.rows[0].attempts).toBe(0);
  });

  it('2. Change-password without a code returns 400', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        current_password: initialPassword,
        new_password: 'NewStrongPassword456',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('3. Change-password with wrong code increments attempts and fails', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        current_password: initialPassword,
        new_password: 'NewStrongPassword456',
        code: '000000',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid confirmation code/i);
    expect(body.attempts_remaining).toBe(4);

    const codeRow = await pool.query(
      'SELECT attempts FROM password_change_code WHERE user_id = $1 AND used_at IS NULL',
      [testUserId]
    );
    expect(codeRow.rows[0].attempts).toBe(1);
  });

  it('4. Change-password with correct code succeeds and updates password', async () => {
    // Set a known hash in the DB for deterministic code testing
    const knownCode = '654321';
    const knownHash = crypto.createHash('sha256').update(knownCode).digest('hex');
    await pool.query(
      'UPDATE password_change_code SET code_hash = $1 WHERE user_id = $2 AND used_at IS NULL',
      [knownHash, testUserId]
    );

    const updatedPassword = 'BrandNewPassword789';
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        current_password: initialPassword,
        new_password: updatedPassword,
        code: knownCode,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/password updated/i);

    // Verify hash changed in database and matches new password
    const userRes = await pool.query('SELECT password_hash FROM "user" WHERE id = $1', [testUserId]);
    const matchesNew = await comparePassword(updatedPassword, userRes.rows[0].password_hash);
    expect(matchesNew).toBe(true);

    // Code is now marked used
    const codeRow = await pool.query(
      'SELECT used_at FROM password_change_code WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [testUserId]
    );
    expect(codeRow.rows[0].used_at).not.toBeNull();
  });

  it('5. Reusing a code fails', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        current_password: 'BrandNewPassword789',
        new_password: 'AnotherPassword999',
        code: '654321',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no active confirmation code found/i);
  });

  it('6. Expired code fails', async () => {
    // Insert an expired code
    const expiredCode = '112233';
    const expiredHash = crypto.createHash('sha256').update(expiredCode).digest('hex');
    await pool.query(
      `INSERT INTO password_change_code (user_id, code_hash, expires_at, created_at)
       VALUES ($1, $2, NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '2 hours')`,
      [testUserId, expiredHash]
    );

    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        current_password: 'BrandNewPassword789',
        new_password: 'YetAnotherPassword123',
        code: expiredCode,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/code has expired/i);
  });

  it('7. Rate limit kicks in on 4th code request', async () => {
    // We already made 1 request in test 1. Let's make 2 more (total 3).
    const res2 = await fetch(`${baseUrl}/auth/change-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validToken}` },
    });
    expect(res2.status).toBe(200);

    const res3 = await fetch(`${baseUrl}/auth/change-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validToken}` },
    });
    expect(res3.status).toBe(200);

    // The 4th request must be rate limited with 429
    const res4 = await fetch(`${baseUrl}/auth/change-password/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validToken}` },
    });

    expect(res4.status).toBe(429);
    const body = await res4.json();
    expect(body.error).toMatch(/too many code requests/i);
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
