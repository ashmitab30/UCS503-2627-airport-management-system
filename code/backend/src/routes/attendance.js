import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireAuth, requireRole } from '../middleware/auth.js';

export const attendanceRouter = Router();

async function getEmployeeIdForUser(userId) {
  const { rows } = await pool.query('SELECT id FROM employee WHERE user_id = $1', [userId]);
  return rows[0]?.id ?? null;
}

// POST /attendance/clock-in  { shift_id }
// A staff member clocks themselves in for one of their own shifts.
// Deliberately self-service (not admin-driven) — that's how clock-in
// works in real life, and it's a nice small role-boundary check to
// demo: you can only clock into YOUR shift.
attendanceRouter.post('/clock-in', authenticate, requireAuth, async (req, res) => {
  const { shift_id } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });

  try {
    const employeeId = await getEmployeeIdForUser(req.user.id);
    if (!employeeId) {
      return res.status(404).json({ error: 'No employee record linked to this account' });
    }

    const shiftResult = await pool.query(
      'SELECT id, employee_id FROM shift WHERE id = $1',
      [shift_id]
    );
    if (shiftResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shiftResult.rows[0].employee_id !== employeeId) {
      return res.status(403).json({ error: 'You can only clock in to your own shift' });
    }

    const existing = await pool.query(
      'SELECT id FROM attendance WHERE shift_id = $1 AND clock_out IS NULL',
      [shift_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Already clocked in for this shift', attendance_id: existing.rows[0].id });
    }

    const { rows } = await pool.query(
      `INSERT INTO attendance (employee_id, shift_id, clock_in)
       VALUES ($1, $2, now())
       RETURNING id, employee_id, shift_id, clock_in, clock_out`,
      [employeeId, shift_id]
    );
    res.status(201).json({ attendance: rows[0] });
  } catch (err) {
    console.error('clock-in error:', err.message);
    res.status(500).json({ error: 'Could not clock in' });
  }
});

// POST /attendance/clock-out  { attendance_id }
attendanceRouter.post('/clock-out', authenticate, requireAuth, async (req, res) => {
  const { attendance_id } = req.body;
  if (!attendance_id) return res.status(400).json({ error: 'attendance_id is required' });

  try {
    const employeeId = await getEmployeeIdForUser(req.user.id);
    if (!employeeId) {
      return res.status(404).json({ error: 'No employee record linked to this account' });
    }

    const record = await pool.query('SELECT * FROM attendance WHERE id = $1', [attendance_id]);
    if (record.rows.length === 0) return res.status(404).json({ error: 'Attendance record not found' });
    if (record.rows[0].employee_id !== employeeId) {
      return res.status(403).json({ error: 'You can only clock out of your own attendance record' });
    }
    if (record.rows[0].clock_out) {
      return res.status(409).json({ error: 'Already clocked out' });
    }

    const { rows } = await pool.query(
      `UPDATE attendance SET clock_out = now() WHERE id = $1
       RETURNING id, employee_id, shift_id, clock_in, clock_out`,
      [attendance_id]
    );
    res.json({ attendance: rows[0] });
  } catch (err) {
    console.error('clock-out error:', err.message);
    res.status(500).json({ error: 'Could not clock out' });
  }
});

// GET /attendance?employee_id= — admin/ops_manager oversight view.
attendanceRouter.get('/', authenticate, requireRole('admin', 'ops_manager'), async (req, res) => {
  const { employee_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, employee_id, shift_id, clock_in, clock_out
       FROM attendance
       WHERE ($1::int IS NULL OR employee_id = $1)
       ORDER BY clock_in DESC NULLS LAST`,
      [employee_id || null]
    );
    res.json({ attendance: rows });
  } catch (err) {
    console.error('list attendance error:', err.message);
    res.status(500).json({ error: 'Could not list attendance' });
  }
});
