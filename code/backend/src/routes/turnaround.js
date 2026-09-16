import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const turnaroundRouter = Router();

const VALID_STATUSES = ['pending', 'in_progress', 'done', 'skipped'];

// PATCH /turnaround/:id/status — ground_crew, ops_manager, admin.
// Ground crew are the ones actually doing deboard/clean/fuel/etc., so
// they need write access here, not just ops_manager/admin like most of
// this module. When a step is marked 'done', we compute actual_duration
// from est_duration vs. how long it ran — a live "did this step run
// over" flag is exactly the kind of downstream-risk signal Week 5's
// delay cascading will consume.
turnaroundRouter.patch('/:id/status', authenticate, requireRole('ground_crew', 'ops_manager', 'admin'), async (req, res) => {
  const { status, assigned_team, actual_duration_minutes } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const existing = await pool.query('SELECT * FROM turnaround_checklist WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Checklist step not found' });

    const resolvedTeam = assigned_team ?? existing.rows[0].assigned_team;

    // turnaround_checklist has no started_at timestamp in the Week 1
    // schema, so actual_duration can't be computed server-side from
    // elapsed time yet — the caller supplies it explicitly when marking
    // a step done. Adding started_at/completed_at columns to compute
    // this automatically is a named follow-up for Week 5, when delay
    // cascading needs "did this step run over its estimate" as a signal.
    let result;
    if (status === 'done' && actual_duration_minutes) {
      result = await pool.query(
        `UPDATE turnaround_checklist
         SET status = $1, assigned_team = $2, actual_duration = ($3 || ' minutes')::interval
         WHERE id = $4
         RETURNING id, flight_id, step, status, assigned_team, est_duration, actual_duration`,
        [status, resolvedTeam, actual_duration_minutes, req.params.id]
      );
    } else {
      result = await pool.query(
        `UPDATE turnaround_checklist
         SET status = $1, assigned_team = $2
         WHERE id = $3
         RETURNING id, flight_id, step, status, assigned_team, est_duration, actual_duration`,
        [status, resolvedTeam, req.params.id]
      );
    }

    res.json({ turnaround_step: result.rows[0] });
  } catch (err) {
    console.error('update turnaround step error:', err.message);
    res.status(500).json({ error: 'Could not update checklist step' });
  }
});

// GET /turnaround?flight_id= — anyone authenticated (ground crew need
// to see their queue; ops_manager/admin need oversight).
turnaroundRouter.get('/', authenticate, async (req, res) => {
  const { flight_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, flight_id, step, status, assigned_team, est_duration, actual_duration
       FROM turnaround_checklist
       WHERE ($1::int IS NULL OR flight_id = $1)
       ORDER BY flight_id, id`,
      [flight_id || null]
    );
    res.json({ turnaround_checklist: rows });
  } catch (err) {
    console.error('list turnaround error:', err.message);
    res.status(500).json({ error: 'Could not list checklist steps' });
  }
});
