import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  EMERGENCY_TYPES,
  STAFF_ROLES,
  ALERT_ROLES_BY_TYPE,
  ADMIN_OPS_ROLES,
} from '../constants/index.js';
import { validate, paginationQuerySchema } from '../middleware/validate.js';

export const emergenciesRouter = Router();

const getIo = (req) => req?.app?.get?.('io');

/**
 * Emits an emergency event ONLY to the rooms of alerted roles plus ops_feed.
 * Passengers belong only to role:passenger and user:<id>, so they never receive these events.
 */
export function broadcastEmergencyEvent(io, eventName, payload, recipientRoles = []) {
  if (!io) return;
  const rooms = new Set();
  for (const role of recipientRoles) {
    if (role) rooms.add(`role:${role}`);
  }
  rooms.add('ops_feed');
  const targetRooms = Array.from(rooms);
  if (typeof io.to === 'function') {
    io.to(targetRooms).emit(eventName, payload);
  }
}

const declareEmergencySchema = z.object({
  type: z.enum(EMERGENCY_TYPES),
  flight_id: z.number().int().positive().optional().nullable(),
  gate_id: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
}).refine(
  (data) => data.flight_id || data.gate_id,
  { message: 'Provide flight_id or gate_id (or both)', path: ['flight_id'] }
);

// POST /emergencies — any staff role can declare one.
emergenciesRouter.post(
  '/',
  authenticate,
  requireRole(...STAFF_ROLES),
  validate({ body: declareEmergencySchema }),
  async (req, res) => {
    const { type, flight_id, gate_id, notes } = req.body;

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

      // Write audit row for 'declared' inside the same transaction
      await client.query(
        `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
         VALUES ($1, 'declared', $2, $3, $4, now())`,
        [
          event.id,
          req.user.id,
          req.user.role,
          JSON.stringify({
            type: event.type,
            flight_id: event.flight_id,
            gate_id: event.gate_id,
            notes: event.notes,
          }),
        ]
      );

      // Write one 'alert_sent' audit row per alerted role
      for (const role of recipientRoles) {
        await client.query(
          `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
           VALUES ($1, 'alert_sent', $2, $3, $4, now())`,
          [
            event.id,
            req.user.id,
            req.user.role,
            JSON.stringify({ recipient_role: role }),
          ]
        );
      }

      await client.query('COMMIT');

      const io = getIo(req);
      broadcastEmergencyEvent(
        io,
        'emergency:declared',
        { emergency: event, alertedRoles: recipientRoles },
        recipientRoles
      );

      res.status(201).json({ emergency: event, alertedRoles: recipientRoles });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('declare emergency error:', err.message);
      res.status(500).json({ error: 'Could not declare emergency' });
    } finally {
      client.release();
    }
  }
);

// GET /emergencies/active-for-me — active emergencies whose alert includes the caller's role.
// Must be defined before /:id routes so Express does not capture 'active-for-me' as :id.
emergenciesRouter.get(
  '/active-for-me',
  authenticate,
  async (req, res) => {
    if (req.user.role === 'passenger') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const { rows } = await pool.query(
        `SELECT e.id, e.type, e.status, e.declared_at, e.notes,
                e.flight_id, f.flight_number,
                e.gate_id, g.code AS gate_code,
                u_dec.name AS declared_by_name,
                a.id AS alert_id,
                a.recipient_role,
                a.sent_at,
                a.acknowledged_at,
                a.acknowledged_by,
                u_ack.name AS acknowledged_by_name,
                (a.acknowledged_at IS NOT NULL) AS is_acknowledged
         FROM emergency_event e
         JOIN emergency_alert a ON a.emergency_id = e.id AND a.recipient_role = $1
         LEFT JOIN flight f ON f.id = e.flight_id
         LEFT JOIN gate g ON g.id = e.gate_id
         LEFT JOIN "user" u_dec ON u_dec.id = e.declared_by
         LEFT JOIN "user" u_ack ON u_ack.id = a.acknowledged_by
         WHERE e.status = 'active'
         ORDER BY e.declared_at DESC`,
        [req.user.role]
      );

      res.json({ emergencies: rows });
    } catch (err) {
      console.error('get active-for-me emergencies error:', err.message);
      res.status(500).json({ error: 'Could not fetch active emergencies' });
    }
  }
);

const listEmergenciesSchema = paginationQuerySchema().extend({
  status: z.enum(['active', 'resolved']).optional(),
});

// GET /emergencies — staff only. Paginated.
emergenciesRouter.get(
  '/',
  authenticate,
  requireRole(...STAFF_ROLES),
  validate({ query: listEmergenciesSchema }),
  async (req, res) => {
    const { status, limit, offset } = req.query;
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (!ADMIN_OPS_ROLES.includes(req.user.role)) {
      params.push(req.user.role);
      conditions.push(
        `EXISTS (SELECT 1 FROM emergency_alert a WHERE a.emergency_id = e.id AND a.recipient_role = $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

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
         ORDER BY e.declared_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );
      res.json({ emergencies: rows, limit, offset });
    } catch (err) {
      console.error('list emergencies error:', err.message);
      res.status(500).json({ error: 'Could not list emergencies' });
    }
  }
);

// GET /emergencies/:id/audit — ordered audit trail for an emergency.
emergenciesRouter.get(
  '/:id/audit',
  authenticate,
  async (req, res) => {
    if (req.user.role === 'passenger') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const emergencyId = parseInt(req.params.id, 10);
    if (isNaN(emergencyId)) return res.status(400).json({ error: 'Invalid emergency ID' });

    try {
      // Verify emergency exists
      const eventRes = await pool.query('SELECT id FROM emergency_event WHERE id = $1', [emergencyId]);
      if (eventRes.rows.length === 0) {
        return res.status(404).json({ error: 'Emergency not found' });
      }

      // Permissions: ops_manager, admin, or staff whose role was alerted
      const isManager = ADMIN_OPS_ROLES.includes(req.user.role);
      if (!isManager) {
        const alertCheck = await pool.query(
          'SELECT 1 FROM emergency_alert WHERE emergency_id = $1 AND recipient_role = $2',
          [emergencyId, req.user.role]
        );
        if (alertCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Forbidden: only alerted roles, admin, or ops_manager can view audit trail' });
        }
      }

      const { rows } = await pool.query(
        `SELECT a.id, a.emergency_id, a.action, a.actor_user_id, a.actor_role,
                a.details, a.created_at,
                COALESCE(u.name, 'System') AS actor_name
         FROM emergency_audit a
         LEFT JOIN "user" u ON u.id = a.actor_user_id
         WHERE a.emergency_id = $1
         ORDER BY a.created_at ASC, a.id ASC`,
        [emergencyId]
      );

      res.json({ audit: rows });
    } catch (err) {
      console.error('get emergency audit error:', err.message);
      res.status(500).json({ error: 'Could not fetch emergency audit trail' });
    }
  }
);

// POST /emergencies/:id/notes — adds a note to the audit trail while active (up to 500 chars).
emergenciesRouter.post(
  '/:id/notes',
  authenticate,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    const emergencyId = parseInt(req.params.id, 10);
    if (isNaN(emergencyId)) return res.status(400).json({ error: 'Invalid emergency ID' });

    const noteText = typeof req.body?.note === 'string'
      ? req.body.note.trim()
      : typeof req.body?.message === 'string'
      ? req.body.message.trim()
      : '';

    if (!noteText) {
      return res.status(400).json({ error: 'Note text is required' });
    }
    if (noteText.length > 500) {
      return res.status(400).json({ error: 'Note cannot exceed 500 characters' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const eventRes = await client.query(
        'SELECT id, status FROM emergency_event WHERE id = $1',
        [emergencyId]
      );
      if (eventRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Emergency not found' });
      }

      const event = eventRes.rows[0];
      if (event.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot add notes to a resolved emergency' });
      }

      // Check permissions: ops_manager, admin, or alerted role
      const isManager = ADMIN_OPS_ROLES.includes(req.user.role);
      if (!isManager) {
        const alertCheck = await client.query(
          'SELECT 1 FROM emergency_alert WHERE emergency_id = $1 AND recipient_role = $2',
          [emergencyId, req.user.role]
        );
        if (alertCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Forbidden: only alerted roles, admin, or ops_manager can add notes to this emergency' });
        }
      }

      const auditRes = await client.query(
        `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
         VALUES ($1, 'note_added', $2, $3, $4, now())
         RETURNING id, emergency_id, action, actor_user_id, actor_role, details, created_at`,
        [
          emergencyId,
          req.user.id,
          req.user.role,
          JSON.stringify({ note: noteText }),
        ]
      );
      const auditRow = auditRes.rows[0];

      const rolesRes = await client.query(
        'SELECT recipient_role FROM emergency_alert WHERE emergency_id = $1',
        [emergencyId]
      );
      const alertedRoles = rolesRes.rows.map((r) => r.recipient_role);

      await client.query('COMMIT');

      const io = getIo(req);
      broadcastEmergencyEvent(
        io,
        'emergency:note',
        {
          emergencyId,
          auditId: auditRow.id,
          note: noteText,
          actor: { id: req.user.id, name: req.user.name, role: req.user.role },
          createdAt: auditRow.created_at,
        },
        alertedRoles
      );

      res.status(201).json({
        audit: {
          ...auditRow,
          actor_name: req.user.name,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('add emergency note error:', err.message);
      res.status(500).json({ error: 'Could not add note to emergency' });
    } finally {
      client.release();
    }
  }
);

// PATCH /emergencies/:id/resolve — strictly restricted to alerted roles, admin, or ops_manager.
emergenciesRouter.patch(
  '/:id/resolve',
  authenticate,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    const emergencyId = parseInt(req.params.id, 10);
    if (isNaN(emergencyId)) return res.status(400).json({ error: 'Invalid emergency ID' });

    const resNotes = (req.body?.resolution_notes || req.body?.notes || '').trim() || null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Permission check: admin/ops_manager can always resolve.
      // Other roles can resolve ONLY if their role was in the alert list for this emergency.
      const isManager = ADMIN_OPS_ROLES.includes(req.user.role);
      if (!isManager) {
        const alertCheck = await client.query(
          'SELECT 1 FROM emergency_alert WHERE emergency_id = $1 AND recipient_role = $2',
          [emergencyId, req.user.role]
        );
        if (alertCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Forbidden: only alerted roles, admin, or ops_manager can resolve this emergency',
          });
        }
      }

      const { rows } = await client.query(
        `UPDATE emergency_event SET status = 'resolved', resolved_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id, type, flight_id, gate_id, status, declared_at, resolved_at, notes`,
        [emergencyId]
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Active emergency not found' });
      }
      const event = rows[0];

      // Write 'resolved' audit row inside the same transaction
      await client.query(
        `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
         VALUES ($1, 'resolved', $2, $3, $4, now())`,
        [
          emergencyId,
          req.user.id,
          req.user.role,
          JSON.stringify({ resolution_notes: resNotes }),
        ]
      );

      const rolesRes = await client.query(
        'SELECT recipient_role FROM emergency_alert WHERE emergency_id = $1',
        [emergencyId]
      );
      const alertedRoles = rolesRes.rows.map((r) => r.recipient_role);

      await client.query('COMMIT');

      const io = getIo(req);
      broadcastEmergencyEvent(
        io,
        'emergency:resolved',
        {
          emergency: event,
          resolvedBy: req.user.id,
          resolvedByName: req.user.name,
          resolutionNotes: resNotes,
        },
        alertedRoles
      );

      res.json({ emergency: event });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('resolve emergency error:', err.message);
      res.status(500).json({ error: 'Could not resolve emergency' });
    } finally {
      client.release();
    }
  }
);

// PATCH /emergencies/:id/acknowledge — records acknowledged_at and acknowledged_by (employee attribution).
emergenciesRouter.patch(
  '/:id/acknowledge',
  authenticate,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    const emergencyId = parseInt(req.params.id, 10);
    if (isNaN(emergencyId)) return res.status(400).json({ error: 'Invalid emergency ID' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `UPDATE emergency_alert
         SET acknowledged_at = now(), acknowledged_by = $1
         WHERE emergency_id = $2 AND recipient_role = $3 AND acknowledged_at IS NULL
         RETURNING id, emergency_id, recipient_role, acknowledged_at, acknowledged_by`,
        [req.user.id, emergencyId, req.user.role]
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No pending alert for your role on this emergency' });
      }
      const alertRow = rows[0];

      // Write 'acknowledged' audit row inside the same transaction
      await client.query(
        `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
         VALUES ($1, 'acknowledged', $2, $3, $4, now())`,
        [
          emergencyId,
          req.user.id,
          req.user.role,
          JSON.stringify({ recipient_role: req.user.role, alert_id: alertRow.id }),
        ]
      );

      const rolesRes = await client.query(
        'SELECT recipient_role FROM emergency_alert WHERE emergency_id = $1',
        [emergencyId]
      );
      const alertedRoles = rolesRes.rows.map((r) => r.recipient_role);

      await client.query('COMMIT');

      const io = getIo(req);
      broadcastEmergencyEvent(
        io,
        'emergency:acknowledged',
        {
          emergencyId,
          role: req.user.role,
          acknowledgedBy: req.user.id,
          acknowledgedByName: req.user.name,
          acknowledgedAt: alertRow.acknowledged_at,
        },
        alertedRoles
      );

      res.json({ alert: alertRow });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('acknowledge emergency error:', err.message);
      res.status(500).json({ error: 'Could not acknowledge alert' });
    } finally {
      client.release();
    }
  }
);
