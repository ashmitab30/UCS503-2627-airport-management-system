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
import { io } from '../index.js';

export const emergenciesRouter = Router();

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

      await client.query('COMMIT');

      if (io) {
        io.emit('emergency:declared', { emergency: event, alertedRoles: recipientRoles });
      }

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

// PATCH /emergencies/:id/resolve — strictly restricted to alerted roles, admin, or ops_manager.
emergenciesRouter.patch(
  '/:id/resolve',
  authenticate,
  requireRole(...STAFF_ROLES),
  async (req, res) => {
    const emergencyId = parseInt(req.params.id, 10);
    if (isNaN(emergencyId)) return res.status(400).json({ error: 'Invalid emergency ID' });

    try {
      // Permission check: admin/ops_manager can always resolve.
      // Other roles can resolve ONLY if their role was in the alert list for this emergency.
      const isManager = ADMIN_OPS_ROLES.includes(req.user.role);
      if (!isManager) {
        const alertCheck = await pool.query(
          'SELECT 1 FROM emergency_alert WHERE emergency_id = $1 AND recipient_role = $2',
          [emergencyId, req.user.role]
        );
        if (alertCheck.rows.length === 0) {
          return res.status(403).json({
            error: 'Forbidden: only alerted roles, admin, or ops_manager can resolve this emergency',
          });
        }
      }

      const { rows } = await pool.query(
        `UPDATE emergency_event SET status = 'resolved', resolved_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING id, status, resolved_at`,
        [emergencyId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Active emergency not found' });

      if (io) {
        io.emit('emergency:resolved', { emergency: rows[0], resolvedBy: req.user.id });
      }

      res.json({ emergency: rows[0] });
    } catch (err) {
      console.error('resolve emergency error:', err.message);
      res.status(500).json({ error: 'Could not resolve emergency' });
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

    try {
      const { rows } = await pool.query(
        `UPDATE emergency_alert
         SET acknowledged_at = now(), acknowledged_by = $1
         WHERE emergency_id = $2 AND recipient_role = $3 AND acknowledged_at IS NULL
         RETURNING id, acknowledged_at, acknowledged_by`,
        [req.user.id, emergencyId, req.user.role]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'No pending alert for your role on this emergency' });
      }

      if (io) {
        io.emit('emergency:acknowledged', { emergencyId, role: req.user.role, acknowledgedBy: req.user.id });
      }

      res.json({ alert: rows[0] });
    } catch (err) {
      console.error('acknowledge emergency error:', err.message);
      res.status(500).json({ error: 'Could not acknowledge alert' });
    }
  }
);
