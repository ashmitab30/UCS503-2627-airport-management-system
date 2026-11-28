import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const resourcesRouter = Router();

export const VALID_TYPES = ['fuel_truck', 'baggage_cart', 'crew', 'catering_truck', 'pushback_tug'];
export const VALID_STATUSES = ['available', 'in_use', 'maintenance'];

const createResourceSchema = z.object({
  airport_id: z.number().int('airport_id must be an integer').positive('airport_id must be a positive integer'),
  type: z.enum(VALID_TYPES, {
    errorMap: () => ({ message: `type must be one of: ${VALID_TYPES.join(', ')}` }),
  }),
});

// POST /resources — admin, ops_manager.
resourcesRouter.post(
  '/',
  authenticate,
  requireRole('admin', 'ops_manager'),
  validate({ body: createResourceSchema }),
  async (req, res) => {
    const { airport_id, type } = req.body;
    try {
      // Check if airport exists
      const airportCheck = await pool.query('SELECT id FROM airport WHERE id = $1', [airport_id]);
      if (airportCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Airport not found' });
      }

      const { rows } = await pool.query(
        `INSERT INTO resource (airport_id, type) VALUES ($1, $2)
         RETURNING id, airport_id, type, status`,
        [airport_id, type]
      );
      res.status(201).json({ resource: rows[0] });
    } catch (err) {
      console.error('create resource error:', err.message);
      res.status(500).json({ error: 'Could not create resource' });
    }
  }
);

// GET /resources?airport_id=&type=&status=
resourcesRouter.get('/', authenticate, async (req, res) => {
  const { airport_id, type, status } = req.query;
  const conditions = [];
  const params = [];
  if (airport_id) {
    params.push(airport_id);
    conditions.push(`airport_id = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT id, airport_id, type, status FROM resource ${where} ORDER BY type, id`,
      params
    );
    res.json({ resources: rows });
  } catch (err) {
    console.error('list resources error:', err.message);
    res.status(500).json({ error: 'Could not list resources' });
  }
});

// PATCH /resources/:id/status — admin, ops_manager.
resourcesRouter.patch('/:id/status', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE resource SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    res.json({ resource: rows[0] });
  } catch (err) {
    console.error('update resource status error:', err.message);
    res.status(500).json({ error: 'Could not update resource status' });
  }
});
