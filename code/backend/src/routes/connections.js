import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ADMIN_OPS_ROLES } from '../constants/index.js';
import {
  validateAndCreateConnection,
  evaluateConnectionStatus,
  getRebookingOptions,
  rebookConnection,
} from '../services/connectionService.js';
import { io } from '../index.js';

export const connectionsRouter = Router();

const createConnectionSchema = z.object({
  inbound_flight_id: z.number().int().positive(),
  outbound_flight_id: z.number().int().positive(),
  passenger_id: z.number().int().positive().optional(),
  inbound_booking_id: z.number().int().positive().optional().nullable(),
  outbound_booking_id: z.number().int().positive().optional().nullable(),
});

// POST /connections — creates a validated connecting itinerary
connectionsRouter.post(
  '/',
  authenticate,
  requireAuth,
  validate({ body: createConnectionSchema }),
  async (req, res) => {
    const {
      inbound_flight_id,
      outbound_flight_id,
      passenger_id,
      inbound_booking_id,
      outbound_booking_id,
    } = req.body;

    const resolvedPassengerId = passenger_id || req.user.id;

    try {
      const connection = await validateAndCreateConnection({
        inboundFlightId: inbound_flight_id,
        outboundFlightId: outbound_flight_id,
        passengerId: resolvedPassengerId,
        inboundBookingId,
        outboundBookingId,
        client: pool,
      });

      res.status(201).json({ connection });
    } catch (err) {
      console.error('create connection error:', err.message);
      res.status(err.status || 500).json({ error: err.message || 'Could not create connection' });
    }
  }
);

// GET /connections/mine — returns user's connecting itineraries
connectionsRouter.get('/mine', authenticate, requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              inf.flight_number AS inbound_flight_number,
              inf.scheduled_departure AS inbound_departure,
              inf.scheduled_arrival AS inbound_arrival,
              inf.estimated_arrival AS inbound_estimated_arrival,
              inf.status AS inbound_status,
              in_orig.code AS inbound_origin_code,
              in_orig.name AS inbound_origin_name,
              in_dest.code AS hub_code,
              in_dest.name AS hub_name,
              in_dest.min_connection_minutes AS hub_mct,
              outf.flight_number AS outbound_flight_number,
              outf.scheduled_departure AS outbound_departure,
              outf.scheduled_arrival AS outbound_arrival,
              outf.estimated_departure AS outbound_estimated_departure,
              outf.status AS outbound_status,
              out_dest.code AS destination_code,
              out_dest.name AS destination_name,
              s_in.seat_number AS inbound_seat_number,
              s_in.class AS inbound_class,
              s_out.seat_number AS outbound_seat_number,
              s_out.class AS outbound_class,
              b_in.booking_ref AS inbound_booking_ref,
              b_out.booking_ref AS outbound_booking_ref,
              COALESCE(dl.minutes, 0) AS inbound_delay_minutes,
              (c.min_connection_minutes - COALESCE(c.actual_connection_minutes, 0)) AS deficit_minutes
         FROM connection c
         JOIN flight inf ON inf.id = c.inbound_flight_id
         JOIN flight outf ON outf.id = c.outbound_flight_id
         JOIN airport in_orig ON in_orig.id = inf.origin_id
         JOIN airport in_dest ON in_dest.id = inf.dest_id
         JOIN airport out_dest ON out_dest.id = outf.dest_id
         LEFT JOIN booking b_in ON b_in.id = c.inbound_booking_id
         LEFT JOIN booking b_out ON b_out.id = c.outbound_booking_id
         LEFT JOIN seat s_in ON s_in.id = b_in.seat_id
         LEFT JOIN seat s_out ON s_out.id = b_out.seat_id
         LEFT JOIN LATERAL (
           SELECT minutes FROM delay_log
            WHERE flight_id = inf.id
            ORDER BY id DESC LIMIT 1
         ) dl ON true
        WHERE c.passenger_id = $1
        ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    res.json({ connections: rows });
  } catch (err) {
    console.error('get user connections error:', err.message);
    res.status(500).json({ error: 'Could not load connections' });
  }
});

// GET /connections/admin/at-risk — admin and ops_manager dashboard metrics & list
connectionsRouter.get(
  '/admin/at-risk',
  authenticate,
  requireRole(...ADMIN_OPS_ROLES),
  async (req, res) => {
    const { status, hub, search } = req.query;

    try {
      // 1. Compute aggregate metrics from real data
      const { rows: metricRows } = await pool.query(
        `SELECT
           COUNT(*)::int AS monitored,
           COUNT(*) FILTER (WHERE status = 'at_risk')::int AS at_risk,
           COUNT(*) FILTER (WHERE status = 'missed')::int AS missed
         FROM connection`
      );

      // Rebooked count: connections with outbound booking paid with zero fee (IRROPS protection)
      const { rows: rebookedRows } = await pool.query(
        `SELECT COUNT(DISTINCT c.id)::int AS rebooked_today
           FROM connection c
           JOIN booking b ON b.id = c.outbound_booking_id
           JOIN payment p ON p.booking_id = b.id
          WHERE p.amount = 0
            AND b.created_at >= CURRENT_DATE`
      );

      const metrics = {
        monitored: metricRows[0]?.monitored || 0,
        at_risk: metricRows[0]?.at_risk || 0,
        missed: metricRows[0]?.missed || 0,
        rebooked_today: rebookedRows[0]?.rebooked_today || 0,
      };

      // 2. Fetch connections list with filters
      const conditions = [];
      const params = [];

      if (status && status !== 'all') {
        const mappedStatus = status === 'risk' ? 'at_risk' : status;
        params.push(mappedStatus);
        conditions.push(`c.status = $${params.length}`);
      }

      if (hub && hub !== 'all') {
        params.push(hub.toUpperCase());
        conditions.push(`in_dest.code = $${params.length}`);
      }

      if (search && search.trim()) {
        params.push(`%${search.trim()}%`);
        const pIndex = params.length;
        conditions.push(
          `(u.name ILIKE $${pIndex} OR u.email ILIKE $${pIndex} OR b_out.booking_ref ILIKE $${pIndex} OR b_in.booking_ref ILIKE $${pIndex} OR inf.flight_number ILIKE $${pIndex} OR outf.flight_number ILIKE $${pIndex})`
        );
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows: connectionRows } = await pool.query(
        `SELECT c.*,
                COALESCE(u.name, 'Passenger #' || c.passenger_id) AS passenger_name,
                u.email AS passenger_email,
                COALESCE(b_out.booking_ref, b_in.booking_ref, 'CON-' || c.id) AS booking_ref,
                inf.flight_number AS inbound_flight_number,
                in_orig.code AS inbound_origin_code,
                in_dest.code AS hub_code,
                in_dest.name AS hub_name,
                inf.scheduled_arrival AS inbound_scheduled_arrival,
                inf.estimated_arrival AS inbound_estimated_arrival,
                COALESCE(dl.minutes, 0) AS inbound_delay_minutes,
                inf.status AS inbound_status,
                outf.flight_number AS outbound_flight_number,
                out_orig.code AS outbound_origin_code,
                out_dest.code AS outbound_dest_code,
                out_dest.name AS outbound_dest_name,
                outf.scheduled_departure AS outbound_scheduled_departure,
                outf.estimated_departure AS outbound_estimated_departure,
                outf.status AS outbound_status,
                (c.min_connection_minutes - COALESCE(c.actual_connection_minutes, 0)) AS deficit_minutes
           FROM connection c
           JOIN flight inf ON inf.id = c.inbound_flight_id
           JOIN flight outf ON outf.id = c.outbound_flight_id
           JOIN airport in_orig ON in_orig.id = inf.origin_id
           JOIN airport in_dest ON in_dest.id = inf.dest_id
           JOIN airport out_orig ON out_orig.id = outf.origin_id
           JOIN airport out_dest ON out_dest.id = outf.dest_id
           LEFT JOIN "user" u ON u.id = c.passenger_id
           LEFT JOIN booking b_in ON b_in.id = c.inbound_booking_id
           LEFT JOIN booking b_out ON b_out.id = c.outbound_booking_id
           LEFT JOIN LATERAL (
             SELECT minutes FROM delay_log
              WHERE flight_id = inf.id
              ORDER BY id DESC LIMIT 1
           ) dl ON true
          ${whereClause}
          ORDER BY (c.min_connection_minutes - COALESCE(c.actual_connection_minutes, 0)) DESC, c.created_at DESC`,
        params
      );

      res.json({ metrics, connections: connectionRows });
    } catch (err) {
      console.error('get admin at-risk connections error:', err.message);
      res.status(500).json({ error: 'Could not load connections at risk' });
    }
  }
);

// GET /connections/:id — single connection details
connectionsRouter.get('/:id', authenticate, requireAuth, async (req, res) => {
  const connectionId = parseInt(req.params.id, 10);
  if (isNaN(connectionId)) return res.status(400).json({ error: 'Invalid connection ID' });

  try {
    const conn = await evaluateConnectionStatus(connectionId, { client: pool, io });
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    res.json({ connection: conn });
  } catch (err) {
    console.error('get connection error:', err.message);
    res.status(500).json({ error: 'Could not fetch connection' });
  }
});

// GET /connections/:id/rebooking-options — read-only viable flight suggestions from hub
connectionsRouter.get('/:id/rebooking-options', authenticate, requireAuth, async (req, res) => {
  const connectionId = parseInt(req.params.id, 10);
  if (isNaN(connectionId)) return res.status(400).json({ error: 'Invalid connection ID' });

  try {
    const result = await getRebookingOptions(connectionId, { client: pool });
    res.json(result);
  } catch (err) {
    console.error('get rebooking options error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Could not fetch rebooking options' });
  }
});

const rebookSchema = z.object({
  flight_id: z.number().int().positive('flight_id must be a positive integer'),
  seat_id: z.number().int().positive('seat_id must be a positive integer'),
});

// POST /connections/:id/rebook — transactional atomic rebooking
connectionsRouter.post(
  '/:id/rebook',
  authenticate,
  requireAuth,
  validate({ body: rebookSchema }),
  async (req, res) => {
    const connectionId = parseInt(req.params.id, 10);
    if (isNaN(connectionId)) return res.status(400).json({ error: 'Invalid connection ID' });

    const { flight_id, seat_id } = req.body;
    try {
      const result = await rebookConnection(connectionId, {
        newFlightId: flight_id,
        newSeatId: seat_id,
        userId: req.user.id,
        io,
      });

      res.json(result);
    } catch (err) {
      console.error('rebook connection error:', err.message);
      res.status(err.status || 500).json({ error: err.message || 'Could not rebook connection' });
    }
  }
);
