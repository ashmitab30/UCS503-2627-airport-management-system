import { Router } from 'express';
import { pool } from '../db/pool.js';
import { hashPassword } from '../utils/password.js';
import { sendStaffCredentialsEmail } from '../utils/mail.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const employeesRouter = Router();

const STAFF_ROLES = ['ground_crew', 'security', 'medical', 'ops_manager', 'admin'];

// POST /employees — admin only. Creates the User account AND the
// Employee record in one transaction, since an employee without a
// login is useless and a staff-role user without an employee record
// is a data-integrity gap. Returns a one-time temp password so the
// admin can hand it to the new hire; only its hash is ever stored.
employeesRouter.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, email, role, department, role_title, certification, shift_pattern } = req.body;

  if (!name || !email || !role || !department || !role_title) {
    return res.status(400).json({
      error: 'name, email, role, department and role_title are required',
    });
  }
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({
      error: `role must be one of: ${STAFF_ROLES.join(', ')}`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    // Temp password: admin should tell the employee to change it on
    // first login. Real systems would email a reset link instead —
    // out of scope here, called out as a simplification.
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const userResult = await client.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email, passwordHash, role]
    );
    const user = userResult.rows[0];

    const employeeResult = await client.query(
      `INSERT INTO employee (user_id, department, role_title, certification, shift_pattern, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, user_id, department, role_title, certification, shift_pattern, status`,
      [user.id, department, role_title, certification || null, shift_pattern || null]
    );

    await client.query('COMMIT');

    // Best-effort: if SMTP isn't configured or sending fails, we still
    // return tempPassword in the response so the admin can relay it
    // manually — email is a convenience layer, not the only path.
    const emailSent = await sendStaffCredentialsEmail({
      to: user.email,
      name: user.name,
      email: user.email,
      tempPassword,
      role: user.role,
    });

    res.status(201).json({
      employee: { ...employeeResult.rows[0], user },
      tempPassword, // shown once — not retrievable after this response
      emailSent,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('create employee error:', err.message);
    res.status(500).json({ error: 'Could not create employee' });
  } finally {
    client.release();
  }
});

// GET /employees — admin + ops_manager. Simple listing, optional
// ?department= and ?status= filters.
employeesRouter.get('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { department, status } = req.query;
  const conditions = [];
  const params = [];

  if (department) {
    params.push(department);
    conditions.push(`e.department = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.department, e.role_title, e.certification, e.shift_pattern, e.status,
              u.id AS user_id, u.name, u.email, u.role
       FROM employee e
       JOIN "user" u ON u.id = e.user_id
       ${where}
       ORDER BY e.id`,
      params
    );
    res.json({ employees: rows });
  } catch (err) {
    console.error('list employees error:', err.message);
    res.status(500).json({ error: 'Could not list employees' });
  }
});

// GET /employees/:id
employeesRouter.get('/:id', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.department, e.role_title, e.certification, e.shift_pattern, e.status,
              u.id AS user_id, u.name, u.email, u.role
       FROM employee e
       JOIN "user" u ON u.id = e.user_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: rows[0] });
  } catch (err) {
    console.error('get employee error:', err.message);
    res.status(500).json({ error: 'Could not fetch employee' });
  }
});

// PATCH /employees/:id/status — admin only. active <-> on_leave.
employeesRouter.patch('/:id/status', authenticate, requireRole('admin'), async (req, res) => {
  const { status } = req.body;
  if (!['active', 'on_leave'].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'on_leave'" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE employee SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: rows[0] });
  } catch (err) {
    console.error('update employee status error:', err.message);
    res.status(500).json({ error: 'Could not update employee status' });
  }
});

function generateTempPassword() {
  // Not cryptographically precious — it's a one-time value the admin
  // relays out-of-band and the employee is expected to change. Good
  // enough for a school project; call this out in the report as a
  // simplification vs. a real email-based reset flow.
  return Math.random().toString(36).slice(-10) + 'A1!';
}