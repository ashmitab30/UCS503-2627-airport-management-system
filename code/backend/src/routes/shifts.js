import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole, requireAuth } from '../middleware/auth.js';
import { checkShiftConflict } from '../services/shiftConflict.js';

export const shiftsRouter = Router();

// POST /shifts — admin + ops_manager. Same conflict-prevention pattern
// that resource_assignment (Week 3) and parking_slot booking (Week 7)
// reuse: check for overlap, reject with 409 + the conflicting rows if
// found, otherwise insert.
shiftsRouter.post('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { employee_id, start_time, end_time, area_assigned } = req.body;

  if (!employee_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'employee_id, start_time and end_time are required' });
  }
  if (!(new Date(start_time) < new Date(end_time))) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  try {
    const employeeExists = await pool.query('SELECT id FROM employee WHERE id = $1', [employee_id]);
    if (employeeExists.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const conflictResult = await checkShiftConflict(employee_id, start_time, end_time);
    if (!conflictResult.ok) {
      return res.status(409).json({
        error: 'Shift conflicts with an existing shift for this employee',
        conflicts: conflictResult.conflicts,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO shift (employee_id, start_time, end_time, area_assigned)
       VALUES ($1, $2, $3, $4)
       RETURNING id, employee_id, start_time, end_time, area_assigned`,
      [employee_id, start_time, end_time, area_assigned || null]
    );
    res.status(201).json({ shift: rows[0] });
  } catch (err) {
    console.error('create shift error:', err.message);
    res.status(500).json({ error: 'Could not create shift' });
  }
});

// GET /shifts?employee_id=  — admin/ops_manager see any employee's
// shifts; a staff user can see their own via GET /shifts/mine below.
shiftsRouter.get('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { employee_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, employee_id, start_time, end_time, area_assigned
       FROM shift
       WHERE ($1::int IS NULL OR employee_id = $1)
       ORDER BY start_time`,
      [employee_id || null]
    );
    res.json({ shifts: rows });
  } catch (err) {
    console.error('list shifts error:', err.message);
    res.status(500).json({ error: 'Could not list shifts' });
  }
});

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
  try {
    const { rows } = await pool.query('DELETE FROM shift WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    res.status(204).send();
  } catch (err) {
    console.error('delete shift error:', err.message);
    res.status(500).json({ error: 'Could not delete shift' });
  }
});
