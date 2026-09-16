import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkResourceConflict } from '../services/resourceConflict.js';

export const resourceAssignmentsRouter = Router();

// POST /resource-assignments — admin, ops_manager. Same
// conflict-prevention shape as POST /shifts (Week 2): check overlap,
// reject 409 + conflicting rows, otherwise insert. This is the second
// reuse of that pattern the Week 2 journal called out in advance.
resourceAssignmentsRouter.post('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { resource_id, flight_id, start_time, end_time } = req.body;
  if (!resource_id || !flight_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'resource_id, flight_id, start_time and end_time are required' });
  }
  if (!(new Date(start_time) < new Date(end_time))) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  try {
    const resourceExists = await pool.query('SELECT id, status FROM resource WHERE id = $1', [resource_id]);
    if (resourceExists.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    if (resourceExists.rows[0].status === 'maintenance') {
      return res.status(409).json({ error: 'Resource is under maintenance and cannot be assigned' });
    }

    const flightExists = await pool.query('SELECT id FROM flight WHERE id = $1', [flight_id]);
    if (flightExists.rows.length === 0) {
      return res.status(404).json({ error: 'Flight not found' });
    }

    const conflictResult = await checkResourceConflict(resource_id, start_time, end_time);
    if (!conflictResult.ok) {
      return res.status(409).json({
        error: 'Resource is already assigned during this window',
        conflicts: conflictResult.conflicts,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO resource_assignment (resource_id, flight_id, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING id, resource_id, flight_id, start_time, end_time`,
      [resource_id, flight_id, start_time, end_time]
    );
    res.status(201).json({ resource_assignment: rows[0] });
  } catch (err) {
    console.error('create resource assignment error:', err.message);
    res.status(500).json({ error: 'Could not create resource assignment' });
  }
});

// GET /resource-assignments?resource_id=&flight_id=
resourceAssignmentsRouter.get('/', authenticate, async (req, res) => {
  const { resource_id, flight_id } = req.query;
  const conditions = [];
  const params = [];
  if (resource_id) { params.push(resource_id); conditions.push(`resource_id = $${params.length}`); }
  if (flight_id) { params.push(flight_id); conditions.push(`flight_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT id, resource_id, flight_id, start_time, end_time
       FROM resource_assignment ${where} ORDER BY start_time`,
      params
    );
    res.json({ resource_assignments: rows });
  } catch (err) {
    console.error('list resource assignments error:', err.message);
    res.status(500).json({ error: 'Could not list resource assignments' });
  }
});

// DELETE /resource-assignments/:id — admin, ops_manager.
resourceAssignmentsRouter.delete('/:id', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM resource_assignment WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Resource assignment not found' });
    res.status(204).send();
  } catch (err) {
    console.error('delete resource assignment error:', err.message);
    res.status(500).json({ error: 'Could not delete resource assignment' });
  }
});
