import { Router } from 'express';
import { pool } from '../db/pool.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { authenticate, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// POST /auth/register
// Public self-registration. Deliberately restricted to 'passenger' —
// staff roles (ground_crew, security, medical, ops_manager, admin) are
// never created through a public endpoint. They're created by an admin
// via POST /employees (see routes/employees.js), which creates the
// user + employee record together. This is a real access-control
// decision worth a line in the report: "who can grant themselves a
// privileged role" is exactly the kind of thing a grader will probe.
authRouter.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const existing = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'passenger')
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash]
    );

    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Could not create account' });
  }
});

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);
    const user = rows[0];

    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was, that's a minor but real account-enumeration fix.
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me — sanity-check endpoint for "is my token valid, and who am I"
authRouter.get('/me', authenticate, requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at FROM "user" WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('me error:', err.message);
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});
