import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const emergenciesRouter = Router();

const EMERGENCY_TYPES = ['medical', 'security', 'weather', 'technical', 'fire'];
const STAFF_ROLES = ['admin', 'ops_manager', 'ground_crew', 'security', 'medical'];
// Which roles get alerted for which emergency type — mirrors the schema's
// emergency_alert.recipient_role check constraint.
const ALERT_ROLES_BY_TYPE = {
  medical: ['medical', 'ops_manager', 'admin'],
  security: ['security', 'ops_manager', 'admin'],
  weather: ['ops_manager', 'admin'],
  technical: ['ground_crew', 'ops_manager', 'admin'],
  fire: ['security', 'ground_crew', 'ops_manager', 'admin'],
};

// POST /emergencies — any staff role can declare one. Must be tied to
// either a flight or a gate (the schema enforces this with a CHECK too,
// this is just a friendlier error before hitting the DB constraint).
emergenciesRouter.post('/', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  const { type, flight_id, gate_id, notes } = req.body;
  if (!EMERGENCY_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${EMERGENCY_TYPES.join(', ')}` });
  }
  if (!flight_id && !gate_id) {
    return res.status(400).json({ error: 'Provide flight_id or gate_id (or both)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query(
      `INSERT INTO emergency_event (type, flight_id, gate_id, declared_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, flight_id, gate_id, status, declared_at, notes`,
      [type, flight_id || null, gate_id || null, req.user.id, notes || null]
    );
    const event = eventResult.rows[0];

    const recipientRoles = ALERT_ROLES_BY_TYPE[type] || ['ops_manager', 'admin'];
    for (const role of recipientRoles) {
      await client.query(
        `INSERT INTO emergency_alert (emergency_id, recipient_role) VALUES ($1, $2)`,
        [event.id, role]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ emergency: event, alertedRoles: recipientRoles });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('declare emergency error:', err.message);
    res.status(500).json({ error: 'Could not declare emergency' });
  } finally {
    client.release();
  }
});

// GET /emergencies — staff only. ?status=active|resolved filters; role
// filters to alerts actually sent to the requester's role (plus admin/
// ops_manager see everything, since they coordinate response).
emergenciesRouter.get('/', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  const { status } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (!['admin', 'ops_manager'].includes(req.user.role)) {
    params.push(req.user.role);
    conditions.push(`EXISTS (SELECT 1 FROM emergency_alert a WHERE a.emergency_id = e.id AND a.recipient_role = $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.status, e.declared_at, e.resolved_at, e.notes,
              f.flight_number, g.code AS gate_code,
              u.name AS declared_by_name
       FROM emergency_event e
       LEFT JOIN flight f ON f.id = e.flight_id
       LEFT JOIN gate g ON g.id = e.gate_id
       LEFT JOIN "user" u ON u.id = e.declared_by
       ${where}
       ORDER BY e.declared_at DESC`,
      params
    );
    res.json({ emergencies: rows });
  } catch (err) {
    console.error('list emergencies error:', err.message);
    res.status(500).json({ error: 'Could not list emergencies' });
  }
});

// PATCH /emergencies/:id/resolve — any staff role that received the alert,
// or admin/ops_manager, can mark it resolved.
emergenciesRouter.patch('/:id/resolve', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE emergency_event SET status = 'resolved', resolved_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING id, status, resolved_at`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Active emergency not found' });
    res.json({ emergency: rows[0] });
  } catch (err) {
    console.error('resolve emergency error:', err.message);
    res.status(500).json({ error: 'Could not resolve emergency' });
  }
});

// PATCH /emergencies/:id/acknowledge — the current user's role
// acknowledges having seen the alert.
emergenciesRouter.patch('/:id/acknowledge', authenticate, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE emergency_alert SET acknowledged_at = now()
       WHERE emergency_id = $1 AND recipient_role = $2 AND acknowledged_at IS NULL
       RETURNING id, acknowledged_at`,
      [req.params.id, req.user.role]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No pending alert for your role on this emergency' });
    res.json({ alert: rows[0] });
  } catch (err) {
    console.error('acknowledge emergency error:', err.message);
    res.status(500).json({ error: 'Could not acknowledge alert' });
  }
});
