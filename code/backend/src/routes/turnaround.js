import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { updateTurnaroundStepTiming } from '../services/delayCascadeService.js';
import { io } from '../index.js';

export const turnaroundRouter = Router();

const VALID_STATUSES = ['pending', 'in_progress', 'done', 'skipped'];

// PATCH /turnaround/:id/status — ground_crew, ops_manager, admin.
// Ground crew are the ones actually doing deboard/clean/fuel/etc., so
// they need write access here. When a step transitions:
// - in_progress: sets started_at = now()
// - done: sets completed_at = now() and computes actual_duration_seconds
// Broadcasts turnaround:step_updated to role:ground_crew and ops_feed.
turnaroundRouter.patch('/:id/status', authenticate, requireRole('ground_crew', 'ops_manager', 'admin'), async (req, res) => {
  const { status, assigned_team, actual_duration_minutes } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const existing = await pool.query('SELECT * FROM turnaround_checklist WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Checklist step not found' });

    const stepId = parseInt(req.params.id, 10);
    let updatedStep = await updateTurnaroundStepTiming(stepId, status);

    const resolvedTeam = assigned_team ?? existing.rows[0].assigned_team;
    if (resolvedTeam !== existing.rows[0].assigned_team || actual_duration_minutes) {
      const durClause = actual_duration_minutes ? `, actual_duration = ($2 || ' minutes')::interval` : '';
      const params = actual_duration_minutes ? [resolvedTeam, actual_duration_minutes, stepId] : [resolvedTeam, stepId];
      const teamRes = await pool.query(
        `UPDATE turnaround_checklist
         SET assigned_team = $1 ${durClause}
         WHERE id = $${params.length}
         RETURNING *`,
        params
      );
      updatedStep = teamRes.rows[0];
    }

    if (io) {
      io.to('role:ground_crew').emit('turnaround:step_updated', { step: updatedStep });
      io.to('ops_feed').emit('turnaround:step_updated', { step: updatedStep });
    }

    res.json({ turnaround_step: updatedStep });
  } catch (err) {
    console.error('update turnaround step error:', err.message);
    res.status(500).json({ error: 'Could not update checklist step' });
  }
});

// GET /turnaround?flight_id=&active=true — anyone authenticated (ground crew
// need to see their queue; ops_manager/admin need oversight).
// Each step carries its flight number, route and gate so screens never have to
// show a bare flight id. Steps come back in their real sequence
// (deboard -> clean -> fuel -> catering -> board -> pushback).
// active=true hides flights that have already left, landed or been cancelled.
turnaroundRouter.get('/', authenticate, async (req, res) => {
  const { flight_id, active } = req.query;
  const flightIdNum = flight_id ? parseInt(flight_id, 10) : null;
  if (flight_id && Number.isNaN(flightIdNum)) {
    return res.status(400).json({ error: 'flight_id must be a number' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.flight_id, t.step, t.status, t.assigned_team, t.est_duration, t.actual_duration,
              f.flight_number, f.status AS flight_status, f.scheduled_departure,
              g.code AS gate_code, o.code AS origin_code, d.code AS dest_code
       FROM turnaround_checklist t
       JOIN flight f ON f.id = t.flight_id
       LEFT JOIN gate g ON g.id = f.gate_id
       LEFT JOIN airport o ON o.id = f.origin_id
       LEFT JOIN airport d ON d.id = f.dest_id
       WHERE ($1::int IS NULL OR t.flight_id = $1)
         AND ($2::boolean IS NOT TRUE
              OR f.status NOT IN ('departed', 'in_air', 'landed', 'cancelled', 'diverted'))
       ORDER BY f.scheduled_departure, t.flight_id,
                array_position(ARRAY['deboard','clean','fuel','catering','board','pushback'], t.step::text)`,
      [flightIdNum, active === 'true']
    );
    res.json({ turnaround_checklist: rows });
  } catch (err) {
    console.error('list turnaround error:', err.message);
    res.status(500).json({ error: 'Could not list checklist steps' });
  }
});
