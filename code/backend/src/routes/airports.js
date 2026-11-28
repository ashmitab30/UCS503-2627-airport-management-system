import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { evaluateConnectionStatus } from '../services/connectionService.js';

export const airportsRouter = Router();

const updateMctSchema = z.object({
  min_connection_minutes: z
    .number({ invalid_type_error: 'min_connection_minutes must be an integer between 15 and 240' })
    .int('min_connection_minutes must be an integer between 15 and 240')
    .min(15, 'min_connection_minutes must be at least 15')
    .max(240, 'min_connection_minutes must be at most 240'),
});

// GET /airports — public. Needed by every dropdown in the frontend
// (flight creation, gate creation, resource creation, etc.).
airportsRouter.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, code, timezone, city, min_connection_minutes FROM airport ORDER BY code'
    );
    res.json({ airports: rows });
  } catch (err) {
    console.error('list airports error:', err.message);
    res.status(500).json({ error: 'Could not list airports' });
  }
});

// PATCH /airports/:id/mct — admin only.
airportsRouter.patch(
  '/:id/mct',
  authenticate,
  requireRole('admin'),
  validate({ body: updateMctSchema }),
  async (req, res) => {
    const airportId = parseInt(req.params.id, 10);
    if (isNaN(airportId) || airportId <= 0) {
      return res.status(400).json({ error: 'Invalid airport ID' });
    }

    const { min_connection_minutes } = req.body;

    try {
      const { rows } = await pool.query(
        `UPDATE airport
            SET min_connection_minutes = $1
          WHERE id = $2
          RETURNING id, name, code, timezone, city, min_connection_minutes`,
        [min_connection_minutes, airportId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Airport not found' });
      }

      const updatedAirport = rows[0];

      // Re-evaluate the status of affected active connections using the existing re-evaluation logic
      const { rows: affectedConns } = await pool.query(
        `SELECT c.id
           FROM connection c
           JOIN flight inf ON inf.id = c.inbound_flight_id
          WHERE inf.dest_id = $1`,
        [airportId]
      );

      const reevaluated = [];
      const io = req.app?.get?.('io');
      for (const c of affectedConns) {
        const reevaluatedConn = await evaluateConnectionStatus(c.id, { client: pool, io });
        if (reevaluatedConn) reevaluated.push(reevaluatedConn);
      }

      res.json({
        airport: updatedAirport,
        reevaluated_connections_count: reevaluated.length,
      });
    } catch (err) {
      console.error('update airport mct error:', err.message);
      res.status(500).json({ error: 'Could not update airport MCT' });
    }
  }
);

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
