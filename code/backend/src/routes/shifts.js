import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole, requireAuth } from '../middleware/auth.js';
import { checkShiftConflict } from '../services/shiftConflict.js';
import { ADVISORY_LOCK_DOMAINS, ADMIN_OPS_ROLES } from '../constants/index.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

export const shiftsRouter = Router();

const createShiftSchema = z.object({
  employee_id: z.number().int().positive('employee_id must be a positive integer'),
  start_time: z.string().datetime({ offset: true }).or(z.string().min(1)),
  end_time: z.string().datetime({ offset: true }).or(z.string().min(1)),
  area_assigned: z.string().optional().nullable(),
}).refine(
  (data) => new Date(data.start_time) < new Date(data.end_time),
  { message: 'end_time must be after start_time', path: ['end_time'] }
);

// POST /shifts — admin + ops_manager. Race-safe via pg_advisory_xact_lock on employee_id.
shiftsRouter.post(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ body: createShiftSchema }),
  async (req, res) => {
    const { employee_id, start_time, end_time, area_assigned } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory transaction lock on the employee domain + employee_id
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        ADVISORY_LOCK_DOMAINS.EMPLOYEE,
        employee_id,
      ]);

      const employeeExists = await client.query('SELECT id FROM employee WHERE id = $1', [employee_id]);
      if (employeeExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Employee not found' });
      }

      const conflictResult = await checkShiftConflict(employee_id, start_time, end_time, null, client);
      if (!conflictResult.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Shift conflicts with an existing shift for this employee',
          conflicts: conflictResult.conflicts,
        });
      }

      const { rows } = await client.query(
        `INSERT INTO shift (employee_id, start_time, end_time, area_assigned)
         VALUES ($1, $2, $3, $4)
         RETURNING id, employee_id, start_time, end_time, area_assigned`,
        [employee_id, start_time, end_time, area_assigned || null]
      );

      await client.query('COMMIT');
      res.status(201).json({ shift: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('create shift error:', err.message);
      res.status(500).json({ error: 'Could not create shift' });
    } finally {
      client.release();
    }
  }
);

const listShiftsQuerySchema = paginationQuerySchema().extend({
  employee_id: z.string().optional(),
});

// GET /shifts?employee_id=&limit=&offset= — admin/ops_manager
shiftsRouter.get(
  '/',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  validate({ query: listShiftsQuerySchema }),
  async (req, res) => {
    const { employee_id, limit, offset } = req.query;
    const parsedEmpId = employee_id ? parseInt(employee_id, 10) : null;
    try {
      const { rows } = await pool.query(
        `SELECT id, employee_id, start_time, end_time, area_assigned
         FROM shift
         WHERE ($1::int IS NULL OR employee_id = $1)
         ORDER BY start_time
         LIMIT $2 OFFSET $3`,
        [parsedEmpId, limit, offset]
      );
      res.json({ shifts: rows, limit, offset });
    } catch (err) {
      console.error('list shifts error:', err.message);
      res.status(500).json({ error: 'Could not list shifts' });
    }
  }
);

// GET /shifts/mine — any authenticated staff member, their own shifts.
shiftsRouter.get('/mine', authenticate, requireAuth, async (req, res) => {
  try {
    const employeeResult = await pool.query('SELECT id FROM employee WHERE user_id = $1', [req.user.id]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'No employee record linked to this account' });
    }
    const employeeId = employeeResult.rows[0].id;
    const { rows } = await pool.query(
      `SELECT id, employee_id, start_time, end_time, area_assigned
       FROM shift WHERE employee_id = $1 ORDER BY start_time`,
      [employeeId]
    );
    res.json({ shifts: rows });
  } catch (err) {
    console.error('list my shifts error:', err.message);
    res.status(500).json({ error: 'Could not list your shifts' });
  }
});

// DELETE /shifts/:id — admin only.
shiftsRouter.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const shiftId = parseInt(req.params.id, 10);
  if (isNaN(shiftId)) return res.status(400).json({ error: 'Invalid shift ID' });

  try {
    const { rows } = await pool.query('DELETE FROM shift WHERE id = $1 RETURNING id', [shiftId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    res.status(204).send();
  } catch (err) {
    console.error('delete shift error:', err.message);
    res.status(500).json({ error: 'Could not delete shift' });
  }
});
