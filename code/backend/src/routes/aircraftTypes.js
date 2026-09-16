import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const aircraftTypesRouter = Router();

aircraftTypesRouter.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, model, capacity, size_class FROM aircraft_type ORDER BY model');
    res.json({ aircraft_types: rows });
  } catch (err) {
    console.error('list aircraft types error:', err.message);
    res.status(500).json({ error: 'Could not list aircraft types' });
  }
});

aircraftTypesRouter.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { model, capacity, size_class } = req.body;
  const VALID_SIZES = ['small', 'medium', 'large', 'jumbo'];
  if (!model || !capacity || !VALID_SIZES.includes(size_class)) {
    return res.status(400).json({
      error: `model, capacity (>0) and size_class (${VALID_SIZES.join('|')}) are required`,
    });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO aircraft_type (model, capacity, size_class) VALUES ($1, $2, $3)
       RETURNING id, model, capacity, size_class`,
      [model, capacity, size_class]
    );
    res.status(201).json({ aircraft_type: rows[0] });
  } catch (err) {
    console.error('create aircraft type error:', err.message);
    res.status(500).json({ error: 'Could not create aircraft type' });
  }
});
