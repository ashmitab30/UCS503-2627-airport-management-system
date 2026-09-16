import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const gatesRouter = Router();

const VALID_SIZES = ['small', 'medium', 'large', 'jumbo'];
const VALID_STATUSES = ['available', 'occupied', 'maintenance', 'locked'];

// POST /gates — admin, ops_manager.
gatesRouter.post('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { airport_id, code, size_class } = req.body;
  if (!airport_id || !code || !VALID_SIZES.includes(size_class)) {
    return res.status(400).json({
      error: `airport_id, code and size_class (${VALID_SIZES.join('|')}) are required`,
    });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO gate (airport_id, code, size_class) VALUES ($1, $2, $3)
       RETURNING id, airport_id, code, size_class, status`,
      [airport_id, code.toUpperCase(), size_class]
    );
    res.status(201).json({ gate: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Gate ${code} already exists at this airport` });
    }
    console.error('create gate error:', err.message);
    res.status(500).json({ error: 'Could not create gate' });
  }
});

// GET /gates?airport_id= — public (passengers see gate info on their
// booking/flight-status screens later).
gatesRouter.get('/', async (req, res) => {
  const { airport_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, airport_id, code, size_class, status FROM gate
       WHERE ($1::int IS NULL OR airport_id = $1)
       ORDER BY code`,
      [airport_id || null]
    );
    res.json({ gates: rows });
  } catch (err) {
    console.error('list gates error:', err.message);
    res.status(500).json({ error: 'Could not list gates' });
  }
});

// PATCH /gates/:id/status — admin, ops_manager. e.g. take a gate into
// maintenance; separate from the automatic occupied/available flow
// that flight scheduling drives.
gatesRouter.patch('/:id/status', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE gate SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Gate not found' });
    res.json({ gate: rows[0] });
  } catch (err) {
    console.error('update gate status error:', err.message);
    res.status(500).json({ error: 'Could not update gate status' });
  }
});
