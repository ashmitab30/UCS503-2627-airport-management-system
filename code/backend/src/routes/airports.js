import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const airportsRouter = Router();

// GET /airports — public. Needed by every dropdown in the frontend
// (flight creation, gate creation, resource creation, etc.).
airportsRouter.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, code, timezone FROM airport ORDER BY code');
    res.json({ airports: rows });
  } catch (err) {
    console.error('list airports error:', err.message);
    res.status(500).json({ error: 'Could not list airports' });
  }
});

// POST /airports — admin only. Reference data, rarely changes.
airportsRouter.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, code, timezone } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'name and code are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO airport (name, code, timezone) VALUES ($1, $2, $3)
       RETURNING id, name, code, timezone`,
      [name, code.toUpperCase(), timezone || 'UTC']
    );
    res.status(201).json({ airport: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Airport code ${code} already exists` });
    }
    console.error('create airport error:', err.message);
    res.status(500).json({ error: 'Could not create airport' });
  }
});
