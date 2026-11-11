import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkResourceConflict } from '../services/resourceConflict.js';
import { ADVISORY_LOCK_DOMAINS, ADMIN_OPS_ROLES } from '../constants/index.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

export const resourceAssignmentsRouter = Router();

const createResourceAssignmentSchema = z.object({
  resource_id: z.number().int().positive('resource_id must be a positive integer'),
  flight_id: z.number().int().positive('flight_id must be a positive integer'),
  start_time: z.string().datetime({ offset: true }).or(z.string().min(1)),
  end_time: z.string().datetime({ offset: true }).or(z.string().min(1)),
}).refine(
  (data) => new Date(data.start_time) < new Date(data.end_time),
  { message: 'end_time must be after start_time', path: ['end_time'] }
);

// POST /resource-assignments — admin, ops_manager. Race-safe via pg_advisory_xact_lock on resource_id.
resourceAssignmentsRouter.post(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ body: createResourceAssignmentSchema }),
  async (req, res) => {
    const { resource_id, flight_id, start_time, end_time } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory transaction lock on the resource domain + resource_id
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        ADVISORY_LOCK_DOMAINS.RESOURCE,
        resource_id,
      ]);

      const resourceExists = await client.query('SELECT id, status FROM resource WHERE id = $1', [resource_id]);
      if (resourceExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Resource not found' });
      }
      if (resourceExists.rows[0].status === 'maintenance') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Resource is under maintenance and cannot be assigned' });
      }

      const flightExists = await client.query('SELECT id FROM flight WHERE id = $1', [flight_id]);
      if (flightExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Flight not found' });
      }

      const conflictResult = await checkResourceConflict(resource_id, start_time, end_time, null, client);
      if (!conflictResult.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Resource is already assigned during this window',
          conflicts: conflictResult.conflicts,
        });
      }

      const { rows } = await client.query(
        `INSERT INTO resource_assignment (resource_id, flight_id, start_time, end_time)
         VALUES ($1, $2, $3, $4)
         RETURNING id, resource_id, flight_id, start_time, end_time`,
        [resource_id, flight_id, start_time, end_time]
      );

      await client.query('COMMIT');
      res.status(201).json({ resource_assignment: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('create resource assignment error:', err.message);
      res.status(500).json({ error: 'Could not create resource assignment' });
    } finally {
      client.release();
    }
  }
);

const listResourceAssignmentsSchema = paginationQuerySchema().extend({
  resource_id: z.string().optional(),
  flight_id: z.string().optional(),
});

// GET /resource-assignments?resource_id=&flight_id=&limit=&offset=
resourceAssignmentsRouter.get(
  '/',
  authenticate,
  validate({ query: listResourceAssignmentsSchema }),
  async (req, res) => {
    const { resource_id, flight_id, limit, offset } = req.query;
    const conditions = [];
    const params = [];
    if (resource_id) {
      params.push(parseInt(resource_id, 10));
      conditions.push(`resource_id = $${params.length}`);
    }
    if (flight_id) {
      params.push(parseInt(flight_id, 10));
      conditions.push(`flight_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    try {
      const { rows } = await pool.query(
        `SELECT id, resource_id, flight_id, start_time, end_time
         FROM resource_assignment ${where}
         ORDER BY start_time
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );
      res.json({ resource_assignments: rows, limit, offset });
    } catch (err) {
      console.error('list resource assignments error:', err.message);
      res.status(500).json({ error: 'Could not list resource assignments' });
    }
  }
);

// DELETE /resource-assignments/:id — admin, ops_manager.
resourceAssignmentsRouter.delete(
  '/:id',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    try {
      const { rows } = await pool.query('DELETE FROM resource_assignment WHERE id = $1 RETURNING id', [id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Resource assignment not found' });
      res.status(204).send();
    } catch (err) {
      console.error('delete resource assignment error:', err.message);
      res.status(500).json({ error: 'Could not delete resource assignment' });
    }
  }
);
