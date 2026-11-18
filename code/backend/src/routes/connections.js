import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
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
              in_orig.code AS inbound_origin_code, in_dest.code AS hub_code,
              outf.flight_number AS outbound_flight_number,
              outf.scheduled_departure AS outbound_departure,
              outf.scheduled_arrival AS outbound_arrival,
              outf.estimated_departure AS outbound_estimated_departure,
              outf.status AS outbound_status,
              out_dest.code AS destination_code
         FROM connection c
         JOIN flight inf ON inf.id = c.inbound_flight_id
         JOIN flight outf ON outf.id = c.outbound_flight_id
         JOIN airport in_orig ON in_orig.id = inf.origin_id
         JOIN airport in_dest ON in_dest.id = inf.dest_id
         JOIN airport out_dest ON out_dest.id = outf.dest_id
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
