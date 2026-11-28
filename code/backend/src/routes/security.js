import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const securityRouter = Router();

const getIo = (req) => req?.app?.get?.('io');

export const SECURITY_STAFF_ROLES = ['security', 'ops_manager', 'admin'];
export const ADMIN_OPS_ROLES = ['ops_manager', 'admin'];
export const VALID_CHECKPOINT_STATUSES = ['open', 'closed', 'delayed'];
export const VALID_SCREENING_RESULTS = ['cleared', 'flagged', 'secondary_screening'];
export const VALID_INCIDENT_TYPES = [
  'unattended_baggage',
  'unauthorized_access',
  'suspicious_behavior',
  'theft',
  'altercation',
  'equipment_tamper',
  'other',
];
export const VALID_INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const VALID_INCIDENT_STATUSES = ['open', 'investigating', 'closed'];

// GET /security/checkpoints — security, ops_manager, admin
// Returns checkpoints with live 1h and today throughput and flagged stats
securityRouter.get(
  '/checkpoints',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { airport_id, airport } = req.query;
    const conditions = [];
    const params = [];

    if (airport_id) {
      params.push(parseInt(airport_id, 10));
      conditions.push(`c.airport_id = $${params.length}`);
    } else if (airport) {
      params.push(airport.toUpperCase());
      conditions.push(`a.code = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.airport_id, c.name, c.location, c.status, c.status_reason, c.updated_at,
                a.code AS airport_code, a.name AS airport_name, a.city AS airport_city,
                COALESCE(st.screened_last_hour, 0)::int AS screened_last_hour,
                COALESCE(st.flagged_last_hour, 0)::int AS flagged_last_hour,
                COALESCE(st.secondary_last_hour, 0)::int AS secondary_last_hour,
                COALESCE(st.screened_today, 0)::int AS screened_today,
                COALESCE(st.flagged_today, 0)::int AS flagged_today,
                COALESCE(st.secondary_today, 0)::int AS secondary_today
         FROM security_checkpoint c
         JOIN airport a ON a.id = c.airport_id
         LEFT JOIN (
           SELECT checkpoint_id,
                  COUNT(*) FILTER (WHERE "timestamp" >= now() - interval '1 hour') AS screened_last_hour,
                  COUNT(*) FILTER (WHERE "timestamp" >= now() - interval '1 hour' AND result = 'flagged') AS flagged_last_hour,
                  COUNT(*) FILTER (WHERE "timestamp" >= now() - interval '1 hour' AND result = 'secondary_screening') AS secondary_last_hour,
                  COUNT(*) FILTER (WHERE "timestamp" >= date_trunc('day', now())) AS screened_today,
                  COUNT(*) FILTER (WHERE "timestamp" >= date_trunc('day', now()) AND result = 'flagged') AS flagged_today,
                  COUNT(*) FILTER (WHERE "timestamp" >= date_trunc('day', now()) AND result = 'secondary_screening') AS secondary_today
           FROM screening_log
           GROUP BY checkpoint_id
         ) st ON st.checkpoint_id = c.id
         ${where}
         ORDER BY c.airport_id, c.id`,
        params
      );

      res.json({ checkpoints: rows });
    } catch (err) {
      console.error('get checkpoints error:', err.message);
      res.status(500).json({ error: 'Could not fetch checkpoints' });
    }
  }
);

// POST /security/checkpoints — ops_manager, admin only
securityRouter.post(
  '/checkpoints',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const { airport_id, airport, name, location } = req.body;

    if (!name || (!airport_id && !airport)) {
      return res.status(400).json({ error: 'name and airport_id (or airport code) are required' });
    }

    try {
      let resolvedAirportId = airport_id ? parseInt(airport_id, 10) : null;
      if (!resolvedAirportId && airport) {
        const aRes = await pool.query('SELECT id FROM airport WHERE UPPER(code) = UPPER($1)', [airport]);
        if (aRes.rows.length === 0) return res.status(404).json({ error: 'Airport not found' });
        resolvedAirportId = aRes.rows[0].id;
      }

      const { rows } = await pool.query(
        `INSERT INTO security_checkpoint (airport_id, name, location, status, updated_at)
         VALUES ($1, $2, $3, 'open', now())
         RETURNING id, airport_id, name, location, status, status_reason, updated_at`,
        [resolvedAirportId, name.trim(), location ? location.trim() : null]
      );

      const created = rows[0];

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:checkpoint_created', {
          checkpoint: created,
          createdBy: { id: req.user.id, name: req.user.name, role: req.user.role },
        });
      }

      res.status(201).json({ checkpoint: created });
    } catch (err) {
      console.error('create checkpoint error:', err.message);
      res.status(500).json({ error: 'Could not create checkpoint' });
    }
  }
);

// PATCH /security/checkpoints/:id/status — security, ops_manager, admin
securityRouter.patch(
  '/checkpoints/:id/status',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const checkpointId = parseInt(req.params.id, 10);
    if (isNaN(checkpointId)) return res.status(400).json({ error: 'Invalid checkpoint ID' });

    const { status, reason, status_reason } = req.body;
    if (!status || !VALID_CHECKPOINT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_CHECKPOINT_STATUSES.join(', ')}` });
    }

    const shortReason = (status_reason || reason || '').trim() || null;

    try {
      const { rows } = await pool.query(
        `UPDATE security_checkpoint
         SET status = $1, status_reason = $2, updated_at = now()
         WHERE id = $3
         RETURNING id, airport_id, name, location, status, status_reason, updated_at`,
        [status, shortReason, checkpointId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Checkpoint not found' });
      }

      const updated = rows[0];

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:checkpoint_status', {
          checkpoint: updated,
          changedBy: { id: req.user.id, name: req.user.name, role: req.user.role },
        });
      }

      res.json({ checkpoint: updated });
    } catch (err) {
      console.error('update checkpoint status error:', err.message);
      res.status(500).json({ error: 'Could not update checkpoint status' });
    }
  }
);

// GET /security/lookup-booking — preview booking, passenger, and flight details
securityRouter.get(
  '/lookup-booking',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const ref = (req.query.ref || req.query.booking_ref || '').trim();
    if (!ref) return res.status(400).json({ error: 'Booking reference is required' });

    try {
      const { rows } = await pool.query(
        `SELECT b.id, b.booking_ref, b.booking_ref AS booking_reference, b.status AS booking_status,
                u.id AS passenger_id, u.name AS passenger_name, u.email AS passenger_email,
                f.id AS flight_id, f.flight_number, f.status AS flight_status,
                f.scheduled_departure, f.actual_departure,
                orig.code AS origin_code, dest.code AS dest_code,
                s.seat_number, s.class AS seat_class
         FROM booking b
         JOIN "user" u ON u.id = b.user_id
         JOIN flight f ON f.id = b.flight_id
         JOIN airport orig ON orig.id = f.origin_id
         JOIN airport dest ON dest.id = f.dest_id
         LEFT JOIN seat s ON s.id = b.seat_id
         WHERE UPPER(b.booking_ref) = UPPER($1)`,
        [ref]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: `Booking ${ref} not found` });
      }

      res.json({ booking: rows[0] });
    } catch (err) {
      console.error('lookup booking error:', err.message);
      res.status(500).json({ error: 'Could not look up booking' });
    }
  }
);

// POST /security/screenings — record a security screening event
securityRouter.post(
  '/screenings',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { checkpoint_id, booking_ref, result, notes } = req.body;

    if (!checkpoint_id || !booking_ref || !result) {
      return res.status(400).json({ error: 'checkpoint_id, booking_ref and result are required' });
    }

    if (!VALID_SCREENING_RESULTS.includes(result)) {
      return res.status(400).json({ error: `result must be one of: ${VALID_SCREENING_RESULTS.join(', ')}` });
    }

    const trimmedNotes = (notes || '').trim();
    if (result !== 'cleared' && !trimmedNotes) {
      return res.status(400).json({ error: 'Notes are strictly required when result is flagged or secondary_screening' });
    }

    const cId = parseInt(checkpoint_id, 10);
    if (isNaN(cId)) return res.status(400).json({ error: 'Invalid checkpoint ID' });

    try {
      // 1. Check checkpoint status
      const cpRes = await pool.query(
        'SELECT id, status, name, airport_id FROM security_checkpoint WHERE id = $1',
        [cId]
      );
      if (cpRes.rows.length === 0) {
        return res.status(404).json({ error: 'Checkpoint not found' });
      }
      const checkpoint = cpRes.rows[0];
      if (checkpoint.status === 'closed') {
        return res.status(409).json({ error: `Checkpoint "${checkpoint.name}" is closed; cannot record screening` });
      }

      // 2. Resolve booking and passenger
      const bRes = await pool.query(
        `SELECT b.id, b.booking_ref, b.user_id, b.status AS booking_status,
                u.name AS passenger_name, u.email AS passenger_email,
                f.id AS flight_id, f.flight_number, f.status AS flight_status,
                f.scheduled_departure, f.actual_departure
         FROM booking b
         JOIN "user" u ON u.id = b.user_id
         JOIN flight f ON f.id = b.flight_id
         WHERE UPPER(b.booking_ref) = UPPER($1)`,
        [booking_ref.trim()]
      );

      if (bRes.rows.length === 0) {
        return res.status(404).json({ error: `Booking reference "${booking_ref}" not found` });
      }

      const booking = bRes.rows[0];

      // Booking status must be confirmed or checked_in
      if (!['confirmed', 'checked_in'].includes(booking.booking_status)) {
        return res.status(409).json({
          error: `Booking ${booking.booking_ref} is not confirmed or checked in (current status: ${booking.booking_status})`,
        });
      }

      // Flight must not be cancelled or departed
      if (['cancelled', 'departed', 'in_air', 'landed'].includes(booking.flight_status) || Boolean(booking.actual_departure)) {
        return res.status(409).json({
          error: `Flight ${booking.flight_number} is ${booking.flight_status}; passenger screening is closed for departed or cancelled flights`,
        });
      }

      // 3. Insert screening log (passenger_id strictly resolved from booking.user_id)
      const insRes = await pool.query(
        `INSERT INTO screening_log (checkpoint_id, booking_id, passenger_id, screened_by, result, notes, "timestamp")
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id, checkpoint_id, booking_id, passenger_id, screened_by, result, notes, "timestamp"`,
        [
          checkpoint.id,
          booking.id,
          booking.user_id,
          req.user.id,
          result,
          trimmedNotes || null,
        ]
      );

      const screening = insRes.rows[0];

      // 4. Emit to security, ops_manager, admin rooms only
      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:screening', {
          screening: {
            ...screening,
            passenger_name: booking.passenger_name,
            booking_ref: booking.booking_ref,
            flight_number: booking.flight_number,
            checkpoint_name: checkpoint.name,
          },
          screenedBy: {
            id: req.user.id,
            name: req.user.name,
            role: req.user.role,
          },
        });
      }

      res.status(201).json({
        screening,
        passenger: {
          id: booking.user_id,
          name: booking.passenger_name,
          email: booking.passenger_email,
        },
        flight: {
          id: booking.flight_id,
          flight_number: booking.flight_number,
          status: booking.flight_status,
        },
      });
    } catch (err) {
      console.error('record screening error:', err.message);
      res.status(500).json({ error: 'Could not record screening log' });
    }
  }
);

// GET /security/screenings — list screenings with filters & pagination
securityRouter.get(
  '/screenings',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { checkpoint_id, result, from, to, booking_ref, search } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const conditions = [];
    const params = [];

    if (checkpoint_id) {
      params.push(parseInt(checkpoint_id, 10));
      conditions.push(`s.checkpoint_id = $${params.length}`);
    }

    if (result && VALID_SCREENING_RESULTS.includes(result)) {
      params.push(result);
      conditions.push(`s.result = $${params.length}`);
    }

    if (from) {
      params.push(new Date(from));
      conditions.push(`s."timestamp" >= $${params.length}`);
    }

    if (to) {
      params.push(new Date(to));
      conditions.push(`s."timestamp" <= $${params.length}`);
    }

    const searchRef = (booking_ref || search || '').trim();
    if (searchRef) {
      params.push(`%${searchRef}%`);
      conditions.push(`(b.booking_ref ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      // Get count
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM screening_log s
         JOIN security_checkpoint c ON c.id = s.checkpoint_id
         JOIN "user" p ON p.id = s.passenger_id
         LEFT JOIN booking b ON b.id = s.booking_id
         ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      // Add pagination params
      params.push(limit);
      const limitParam = `$${params.length}`;
      params.push(offset);
      const offsetParam = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT s.id, s.checkpoint_id, s.booking_id, s.passenger_id, s.screened_by,
                s.result, s.notes, s."timestamp",
                c.name AS checkpoint_name, c.location AS checkpoint_location,
                p.name AS passenger_name, p.email AS passenger_email,
                sb.name AS screened_by_name,
                b.booking_ref, f.flight_number
         FROM screening_log s
         JOIN security_checkpoint c ON c.id = s.checkpoint_id
         JOIN "user" p ON p.id = s.passenger_id
         LEFT JOIN "user" sb ON sb.id = s.screened_by
         LEFT JOIN booking b ON b.id = s.booking_id
         LEFT JOIN flight f ON f.id = b.flight_id
         ${where}
         ORDER BY s."timestamp" DESC, s.id DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );

      res.json({ screenings: rows, total, limit, offset });
    } catch (err) {
      console.error('list screenings error:', err.message);
      res.status(500).json({ error: 'Could not fetch screening logs' });
    }
  }
);

// GET /security/stats — counts by result for last 24 hours and per checkpoint
securityRouter.get(
  '/stats',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    try {
      const summaryRes = await pool.query(
        `SELECT
           COUNT(*)::int AS total_24h,
           COUNT(*) FILTER (WHERE result = 'cleared')::int AS cleared_24h,
           COUNT(*) FILTER (WHERE result = 'flagged')::int AS flagged_24h,
           COUNT(*) FILTER (WHERE result = 'secondary_screening')::int AS secondary_24h
         FROM screening_log
         WHERE "timestamp" >= now() - interval '24 hours'`
      );

      const perCpRes = await pool.query(
        `SELECT
           c.id AS checkpoint_id,
           c.name AS checkpoint_name,
           c.location AS checkpoint_location,
           c.status AS checkpoint_status,
           a.id AS airport_id,
           a.code AS airport_code,
           COUNT(s.id)::int AS total_24h,
           COUNT(s.id) FILTER (WHERE s.result = 'cleared')::int AS cleared_24h,
           COUNT(s.id) FILTER (WHERE s.result = 'flagged')::int AS flagged_24h,
           COUNT(s.id) FILTER (WHERE s.result = 'secondary_screening')::int AS secondary_24h
         FROM security_checkpoint c
         JOIN airport a ON a.id = c.airport_id
         LEFT JOIN screening_log s ON s.checkpoint_id = c.id AND s."timestamp" >= now() - interval '24 hours'
         GROUP BY c.id, a.id
         ORDER BY a.code, c.id`
      );

      const summary = summaryRes.rows[0] || { total_24h: 0, cleared_24h: 0, flagged_24h: 0, secondary_24h: 0 };
      const checkpoints = perCpRes.rows;

      res.json({
        summary,
        checkpoints,
        stats: {
          summary_24h: summary,
          per_checkpoint: checkpoints,
        },
      });
    } catch (err) {
      console.error('get security stats error:', err.message);
      res.status(500).json({ error: 'Could not fetch security stats' });
    }
  }
);

/**
 * Helper to generate automatic incident upon denied restricted zone badge scan.
 * Isolated in a single function for clean maintenance and removal if required.
 */
async function createUnauthorizedAccessIncident(client, { employee, zone, recordedBy, reason }) {
  const loc = `${zone.name || 'Restricted Zone'} (${zone.code})`;
  const desc = `Unauthorized zone access attempt: ${employee.employee_name || 'Staff'} (${employee.employee_email || ''}, role: ${employee.employee_role}, dept: ${employee.department || 'N/A'}) attempted entry to ${zone.code} without clearance. Reason: ${reason}`;

  const { rows } = await client.query(
    `INSERT INTO security_incident (location, type, severity, status, description, reported_by, "timestamp", updated_at)
     VALUES ($1, 'unauthorized_access', 'medium', 'open', $2, $3, now(), now())
     RETURNING id, location, type, severity, status, description, reported_by, "timestamp", updated_at`,
    [loc, desc.slice(0, 1000), recordedBy.id]
  );
  const incident = rows[0];

  await client.query(
    `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
     VALUES ($1, $2, 'created', 'Automated incident generated following denied zone badge verification scan.', now())`,
    [incident.id, recordedBy.id]
  );

  return incident;
}

// GET /security/incidents/summary — counts open incidents by severity for header badge
securityRouter.get(
  '/incidents/summary',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status != 'closed')::int AS total_open,
           COUNT(*) FILTER (WHERE status != 'closed' AND severity = 'low')::int AS open_low,
           COUNT(*) FILTER (WHERE status != 'closed' AND severity = 'medium')::int AS open_medium,
           COUNT(*) FILTER (WHERE status != 'closed' AND severity = 'high')::int AS open_high,
           COUNT(*) FILTER (WHERE status != 'closed' AND severity = 'critical')::int AS open_critical
         FROM security_incident`
      );
      res.json({ summary: rows[0] || { total_open: 0, open_low: 0, open_medium: 0, open_high: 0, open_critical: 0 } });
    } catch (err) {
      console.error('get incidents summary error:', err.message);
      res.status(500).json({ error: 'Could not fetch incidents summary' });
    }
  }
);

// POST /security/incidents — report a new security incident
securityRouter.post(
  '/incidents',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { location, type, severity, description } = req.body;

    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'location is required' });
    }
    if (!type || !VALID_INCIDENT_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_INCIDENT_TYPES.join(', ')}` });
    }
    if (!severity || !VALID_INCIDENT_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `severity must be one of: ${VALID_INCIDENT_SEVERITIES.join(', ')}` });
    }
    if (description && description.length > 1000) {
      return res.status(400).json({ error: 'description must not exceed 1000 characters' });
    }

    const trimmedLocation = location.trim();
    const trimmedDesc = description ? description.trim() : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const incRes = await client.query(
        `INSERT INTO security_incident (location, type, severity, status, description, reported_by, "timestamp", updated_at)
         VALUES ($1, $2, $3, 'open', $4, $5, now(), now())
         RETURNING id, location, type, severity, status, description, reported_by, "timestamp", updated_at`,
        [trimmedLocation, type, severity, trimmedDesc, req.user.id]
      );
      const incident = incRes.rows[0];

      await client.query(
        `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
         VALUES ($1, $2, 'created', $3, now())`,
        [incident.id, req.user.id, trimmedDesc || `Incident reported at ${trimmedLocation}`]
      );

      await client.query('COMMIT');

      // Add reported_by info for the response & live socket
      incident.reported_by_name = req.user.name;
      incident.reported_by_role = req.user.role;

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        if (severity === 'high' || severity === 'critical') {
          io.to(['role:security', 'role:ops_manager', 'role:admin', 'ops_feed']).emit('security:incident', { incident });
        } else {
          io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:incident', { incident });
        }
      }

      res.status(201).json({ incident });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('create incident error:', err.message);
      res.status(500).json({ error: 'Could not report incident' });
    } finally {
      client.release();
    }
  }
);

// GET /security/incidents — list incidents with filters & pagination
securityRouter.get(
  '/incidents',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { status, severity, type, from, to, search, limit = 20, offset = 0 } = req.query;

    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (severity && severity !== 'all') {
      params.push(severity);
      conditions.push(`i.severity = $${params.length}`);
    }
    if (type && type !== 'all') {
      params.push(type);
      conditions.push(`i.type = $${params.length}`);
    }
    if (from) {
      params.push(new Date(from).toISOString());
      conditions.push(`i."timestamp" >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(new Date(to).toISOString());
      conditions.push(`i."timestamp" <= $${params.length}::timestamptz`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      const pIdx = params.length;
      conditions.push(`(i.location ILIKE $${pIdx} OR i.description ILIKE $${pIdx} OR rep.name ILIKE $${pIdx} OR asgn.name ILIKE $${pIdx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    try {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM security_incident i
         JOIN "user" rep ON rep.id = i.reported_by
         LEFT JOIN "user" asgn ON asgn.id = i.assigned_to
         ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      params.push(limitNum);
      const limitParam = `$${params.length}`;
      params.push(offsetNum);
      const offsetParam = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT i.id, i.location, i.type, i.severity, i.status, i.description,
                i.reported_by, rep.name AS reported_by_name, rep.role AS reported_by_role,
                i.assigned_to, asgn.name AS assigned_to_name, asgn.role AS assigned_to_role,
                i.closed_at, i.resolution_notes, i."timestamp", i.updated_at,
                (SELECT COUNT(*)::int FROM security_incident_update WHERE incident_id = i.id) AS update_count
         FROM security_incident i
         JOIN "user" rep ON rep.id = i.reported_by
         LEFT JOIN "user" asgn ON asgn.id = i.assigned_to
         ${where}
         ORDER BY i."timestamp" DESC, i.id DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );

      res.json({ incidents: rows, total, limit: limitNum, offset: offsetNum });
    } catch (err) {
      console.error('list incidents error:', err.message);
      res.status(500).json({ error: 'Could not fetch incidents' });
    }
  }
);

// GET /security/incidents/:id — get incident details with full timeline
securityRouter.get(
  '/incidents/:id',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const incidentId = parseInt(req.params.id, 10);
    if (isNaN(incidentId)) return res.status(400).json({ error: 'Invalid incident ID' });

    try {
      const incRes = await pool.query(
        `SELECT i.id, i.location, i.type, i.severity, i.status, i.description,
                i.reported_by, rep.name AS reported_by_name, rep.role AS reported_by_role,
                i.assigned_to, asgn.name AS assigned_to_name, asgn.role AS assigned_to_role,
                i.closed_at, i.resolution_notes, i."timestamp", i.updated_at
         FROM security_incident i
         JOIN "user" rep ON rep.id = i.reported_by
         LEFT JOIN "user" asgn ON asgn.id = i.assigned_to
         WHERE i.id = $1`,
        [incidentId]
      );

      if (incRes.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incRes.rows[0];

      const timeRes = await pool.query(
        `SELECT u.id, u.incident_id, u.actor_user_id, u.action, u.note, u.created_at,
                usr.name AS actor_name, usr.role AS actor_role
         FROM security_incident_update u
         JOIN "user" usr ON usr.id = u.actor_user_id
         WHERE u.incident_id = $1
         ORDER BY u.created_at ASC, u.id ASC`,
        [incidentId]
      );

      incident.timeline = timeRes.rows;

      res.json({ incident });
    } catch (err) {
      console.error('get incident details error:', err.message);
      res.status(500).json({ error: 'Could not fetch incident' });
    }
  }
);

// PATCH /security/incidents/:id/status — advance status (strictly open -> investigating -> closed)
securityRouter.patch(
  '/incidents/:id/status',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const incidentId = parseInt(req.params.id, 10);
    if (isNaN(incidentId)) return res.status(400).json({ error: 'Invalid incident ID' });

    const { status: nextStatus, resolution_notes } = req.body;
    if (!nextStatus || !VALID_INCIDENT_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_INCIDENT_STATUSES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const curRes = await client.query(
        'SELECT id, status, resolution_notes, location FROM security_incident WHERE id = $1 FOR UPDATE',
        [incidentId]
      );
      if (curRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Incident not found' });
      }

      const currentStatus = curRes.rows[0].status;

      // Status Progression Guard: Strictly open -> investigating -> closed (no backwards jumps, no jumping straight open -> closed)
      const validTransitions = {
        open: ['investigating'],
        investigating: ['closed'],
        closed: [],
      };

      if (!validTransitions[currentStatus]?.includes(nextStatus)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Cannot transition incident status from "${currentStatus}" to "${nextStatus}". Allowed path: open -> investigating -> closed.`,
        });
      }

      let trimmedResolution = null;
      if (nextStatus === 'closed') {
        trimmedResolution = (resolution_notes || '').trim();
        if (!trimmedResolution) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'resolution_notes is required when closing an incident' });
        }
      }

      const isClosing = nextStatus === 'closed';
      const updateRes = await client.query(
        `UPDATE security_incident
         SET status = $1,
             closed_at = CASE WHEN $2::boolean THEN now() ELSE NULL END,
             resolution_notes = CASE WHEN $2::boolean THEN $3 ELSE resolution_notes END,
             updated_at = now()
         WHERE id = $4
         RETURNING id, location, type, severity, status, description, reported_by, assigned_to, closed_at, resolution_notes, "timestamp", updated_at`,
        [nextStatus, isClosing, trimmedResolution, incidentId]
      );
      const updatedIncident = updateRes.rows[0];

      const actionNote =
        nextStatus === 'closed'
          ? `Incident closed. Resolution: ${trimmedResolution}`
          : `Status advanced from ${currentStatus} to ${nextStatus}`;

      await client.query(
        `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
         VALUES ($1, $2, 'status_change', $3, now())`,
        [incidentId, req.user.id, actionNote]
      );

      await client.query('COMMIT');

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:incident_updated', {
          incident: updatedIncident,
          transition: { from: currentStatus, to: nextStatus, actor: req.user.name },
        });
      }

      res.json({ incident: updatedIncident });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('update incident status error:', err.message);
      res.status(500).json({ error: 'Could not update incident status' });
    } finally {
      client.release();
    }
  }
);

// POST /security/incidents/:id/assign — assign to an officer or self
securityRouter.post(
  '/incidents/:id/assign',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const incidentId = parseInt(req.params.id, 10);
    if (isNaN(incidentId)) return res.status(400).json({ error: 'Invalid incident ID' });

    const targetUserId = req.body.assigned_to ? parseInt(req.body.assigned_to, 10) : req.user.id;
    if (isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid assigned_to user ID' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query('SELECT id, name, role FROM "user" WHERE id = $1', [targetUserId]);
      if (userRes.rows.length === 0 || !SECURITY_STAFF_ROLES.includes(userRes.rows[0].role)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Assignee must be an active security, ops_manager, or admin user' });
      }
      const targetUser = userRes.rows[0];

      const incRes = await client.query(
        `UPDATE security_incident
         SET assigned_to = $1, updated_at = now()
         WHERE id = $2
         RETURNING id, location, type, severity, status, description, reported_by, assigned_to, closed_at, resolution_notes, "timestamp", updated_at`,
        [targetUserId, incidentId]
      );
      if (incRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Incident not found' });
      }
      const updatedIncident = incRes.rows[0];
      updatedIncident.assigned_to_name = targetUser.name;
      updatedIncident.assigned_to_role = targetUser.role;

      await client.query(
        `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
         VALUES ($1, $2, 'assigned', $3, now())`,
        [incidentId, req.user.id, `Assigned to ${targetUser.name} (${targetUser.role.replace('_', ' ')})`]
      );

      await client.query('COMMIT');

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:incident_updated', {
          incident: updatedIncident,
        });
      }

      res.json({ incident: updatedIncident });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('assign incident error:', err.message);
      res.status(500).json({ error: 'Could not assign incident' });
    } finally {
      client.release();
    }
  }
);

// POST /security/incidents/:id/notes — append a timeline note
securityRouter.post(
  '/incidents/:id/notes',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const incidentId = parseInt(req.params.id, 10);
    if (isNaN(incidentId)) return res.status(400).json({ error: 'Invalid incident ID' });

    const { note } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'note is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const incCheck = await client.query('SELECT id FROM security_incident WHERE id = $1', [incidentId]);
      if (incCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Incident not found' });
      }

      const { rows } = await client.query(
        `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
         VALUES ($1, $2, 'note', $3, now())
         RETURNING id, incident_id, actor_user_id, action, note, created_at`,
        [incidentId, req.user.id, note.trim()]
      );
      const updateRow = rows[0];
      updateRow.actor_name = req.user.name;
      updateRow.actor_role = req.user.role;

      await client.query('UPDATE security_incident SET updated_at = now() WHERE id = $1', [incidentId]);

      await client.query('COMMIT');

      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:incident_updated', {
          incidentId,
          update: updateRow,
        });
      }

      res.status(201).json({ update: updateRow });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('add incident note error:', err.message);
      res.status(500).json({ error: 'Could not add timeline note' });
    } finally {
      client.release();
    }
  }
);

// GET /security/zones — list restricted zones and their allowed roles (read-only in UI)
securityRouter.get(
  '/zones',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, code, name, description, allowed_roles, created_at
         FROM restricted_zone
         ORDER BY code ASC`
      );
      res.json({ zones: rows });
    } catch (err) {
      console.error('get restricted zones error:', err.message);
      res.status(500).json({ error: 'Could not fetch restricted zones' });
    }
  }
);

// POST /security/zone-access — verify employee zone clearance and log attempt
securityRouter.post(
  '/zone-access',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { employee, employee_id, email, zone, zone_code } = req.body;

    const requestedZoneCode = (zone_code || zone || '').toString().trim().toUpperCase();
    if (!requestedZoneCode) {
      return res.status(400).json({ error: 'zone code is required' });
    }

    const empIdent = employee_id || email || employee;
    if (!empIdent) {
      return res.status(400).json({ error: 'employee (id or email) is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Look up Zone
      const zoneRes = await client.query(
        'SELECT id, code, name, description, allowed_roles FROM restricted_zone WHERE code = $1',
        [requestedZoneCode]
      );
      if (zoneRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Restricted zone "${requestedZoneCode}" not found` });
      }
      const zoneRow = zoneRes.rows[0];

      // 2. Look up Employee
      let empQuery;
      let empParams;
      if (typeof empIdent === 'number' || /^\d+$/.test(empIdent.toString().trim())) {
        empQuery = `
          SELECT e.id AS employee_id, e.user_id, e.department, e.role_title, e.status AS employee_status,
                 u.name AS employee_name, u.email AS employee_email, u.role AS employee_role
          FROM employee e
          JOIN "user" u ON u.id = e.user_id
          WHERE e.id = $1 OR e.user_id = $1`;
        empParams = [parseInt(empIdent, 10)];
      } else {
        empQuery = `
          SELECT e.id AS employee_id, e.user_id, e.department, e.role_title, e.status AS employee_status,
                 u.name AS employee_name, u.email AS employee_email, u.role AS employee_role
          FROM employee e
          JOIN "user" u ON u.id = e.user_id
          WHERE LOWER(u.email) = LOWER($1)`;
        empParams = [empIdent.toString().trim()];
      }

      const empRes = await client.query(empQuery, empParams);
      if (empRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Employee "${empIdent}" not found` });
      }
      const emp = empRes.rows[0];

      // 3. Evaluate Clearance Decision
      const allowedRoles = Array.isArray(zoneRow.allowed_roles) ? zoneRow.allowed_roles : [];
      const accessGranted = allowedRoles.includes(emp.employee_role);

      const decisionReason = accessGranted
        ? `Access granted: role "${emp.employee_role}" is authorized for zone ${zoneRow.code} (${zoneRow.name})`
        : `Access denied: role "${emp.employee_role}" is NOT authorized for zone ${zoneRow.code} (${zoneRow.name})`;

      // 4. Log Access Record
      const logRes = await client.query(
        `INSERT INTO restricted_zone_access (employee_id, zone, access_granted, recorded_by, reason, "timestamp")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, employee_id, zone, access_granted, recorded_by, reason, "timestamp"`,
        [emp.employee_id, zoneRow.code, accessGranted, req.user.id, decisionReason]
      );
      const accessLog = logRes.rows[0];

      // 5. If Denied: Automatically create medium unauthorized_access incident with timeline row
      let autoIncident = null;
      if (!accessGranted) {
        autoIncident = await createUnauthorizedAccessIncident(client, {
          employee: emp,
          zone: zoneRow,
          recordedBy: req.user,
          reason: decisionReason,
        });
      }

      await client.query('COMMIT');

      // 6. Broadcast Real-Time Alerts
      const io = getIo(req);
      if (io && typeof io.to === 'function') {
        if (!accessGranted) {
          io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:zone_denied', {
            zone: zoneRow.code,
            zone_name: zoneRow.name,
            employee: {
              id: emp.employee_id,
              name: emp.employee_name,
              email: emp.employee_email,
              role: emp.employee_role,
            },
            access_granted: false,
            reason: decisionReason,
            incident_id: autoIncident?.id,
            timestamp: accessLog.timestamp,
          });

          if (autoIncident) {
            autoIncident.reported_by_name = req.user.name;
            autoIncident.reported_by_role = req.user.role;
            io.to(['role:security', 'role:ops_manager', 'role:admin']).emit('security:incident', {
              incident: autoIncident,
            });
          }
        }
      }

      res.status(200).json({
        access_granted: accessGranted,
        reason: decisionReason,
        employee: {
          id: emp.employee_id,
          name: emp.employee_name,
          email: emp.employee_email,
          role: emp.employee_role,
          department: emp.department,
        },
        zone: {
          code: zoneRow.code,
          name: zoneRow.name,
          allowed_roles: zoneRow.allowed_roles,
        },
        access_log: accessLog,
        incident: autoIncident || null,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('zone access verification error:', err.message);
      res.status(500).json({ error: 'Could not verify zone access' });
    } finally {
      client.release();
    }
  }
);

// GET /security/zone-access — list zone access attempts with filters and pagination
securityRouter.get(
  '/zone-access',
  authenticate,
  requireRole(...SECURITY_STAFF_ROLES),
  async (req, res) => {
    const { zone, access_granted, employee_id, from, to, limit = 20, offset = 0 } = req.query;

    const conditions = [];
    const params = [];

    if (zone && zone !== 'all') {
      params.push(zone.toUpperCase());
      conditions.push(`za.zone = $${params.length}`);
    }
    if (access_granted !== undefined && access_granted !== 'all') {
      const isGranted = access_granted === true || access_granted === 'true' || access_granted === 'granted';
      params.push(isGranted);
      conditions.push(`za.access_granted = $${params.length}`);
    }
    if (employee_id) {
      params.push(parseInt(employee_id, 10));
      conditions.push(`za.employee_id = $${params.length}`);
    }
    if (from) {
      params.push(new Date(from).toISOString());
      conditions.push(`za."timestamp" >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(new Date(to).toISOString());
      conditions.push(`za."timestamp" <= $${params.length}::timestamptz`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    try {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM restricted_zone_access za
         ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      params.push(limitNum);
      const limitParam = `$${params.length}`;
      params.push(offsetNum);
      const offsetParam = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT za.id, za.employee_id, za.zone, za.access_granted, za.recorded_by, za.reason, za."timestamp",
                u.name AS employee_name, u.email AS employee_email, u.role AS employee_role,
                rec.name AS recorded_by_name, rec.role AS recorded_by_role,
                rz.name AS zone_name
         FROM restricted_zone_access za
         JOIN employee e ON e.id = za.employee_id
         JOIN "user" u ON u.id = e.user_id
         LEFT JOIN "user" rec ON rec.id = za.recorded_by
         LEFT JOIN restricted_zone rz ON rz.code = za.zone
         ${where}
         ORDER BY za."timestamp" DESC, za.id DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params
      );

      res.json({ logs: rows, total, limit: limitNum, offset: offsetNum });
    } catch (err) {
      console.error('get zone access logs error:', err.message);
      res.status(500).json({ error: 'Could not fetch zone access logs' });
    }
  }
);
