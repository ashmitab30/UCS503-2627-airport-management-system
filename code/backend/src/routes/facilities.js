import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { authenticate, requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  ADMIN_OPS_ROLES,
  FACILITY_TYPES,
  FACILITY_STATUSES,
  FACILITY_STAFF_ROLES,
} from '../constants/index.js';

export const facilitiesRouter = Router();

const getIo = (req) => req?.app?.get?.('io');

// All facilities endpoints require authentication
facilitiesRouter.use(authenticate, requireAuth);

const facilityQuerySchema = z.object({
  airport_id: z
    .preprocess((val) => (val === '' || val === undefined ? undefined : val), z.coerce.number().int().positive().optional()),
  type: z
    .preprocess((val) => (val === '' || val === undefined ? undefined : val), z.enum(FACILITY_TYPES).optional()),
  status: z
    .preprocess((val) => (val === '' || val === undefined ? undefined : val), z.enum(FACILITY_STATUSES).optional()),
  q: z.string().optional(),
  limit: z
    .preprocess((val) => (val === '' || val === undefined ? undefined : val), z.coerce.number().int().min(1).max(200).optional().default(50)),
  offset: z
    .preprocess((val) => (val === '' || val === undefined ? undefined : val), z.coerce.number().int().min(0).optional().default(0)),
});

const facilityIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid facility ID'),
});

const createFacilitySchema = z.object({
  airport_id: z.coerce.number().int().positive('airport_id must be a positive integer'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name cannot exceed 80 characters'),
  type: z.enum(FACILITY_TYPES, {
    errorMap: () => ({ message: `Invalid facility type. Must be one of: ${FACILITY_TYPES.join(', ')}` }),
  }),
  location_terminal: z.string().trim().max(80, 'Terminal location cannot exceed 80 characters').optional().nullable(),
  location_gate_proximity: z.string().trim().max(80, 'Gate proximity cannot exceed 80 characters').optional().nullable(),
  status: z.enum(FACILITY_STATUSES).optional().default('open'),
});

const updateFacilitySchema = z
  .object({
    airport_id: z.coerce.number().int().positive('airport_id must be a positive integer').optional(),
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name cannot exceed 80 characters').optional(),
    type: z.enum(FACILITY_TYPES, {
      errorMap: () => ({ message: `Invalid facility type. Must be one of: ${FACILITY_TYPES.join(', ')}` }),
    }).optional(),
    location_terminal: z.string().trim().max(80, 'Terminal location cannot exceed 80 characters').optional().nullable(),
    location_gate_proximity: z.string().trim().max(80, 'Gate proximity cannot exceed 80 characters').optional().nullable(),
    status: z.enum(FACILITY_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
  });

const updateStatusSchema = z.object({
  status: z.enum(FACILITY_STATUSES, {
    errorMap: () => ({ message: `status must be one of: ${FACILITY_STATUSES.join(', ')}` }),
  }),
});

// GET /facilities — list facilities with filtering and pagination
facilitiesRouter.get(
  '/',
  validate({ query: facilityQuerySchema }),
  async (req, res) => {
    try {
      const { airport_id, type, status, q, limit, offset } = req.query;

      const conditions = [];
      const params = [];

      if (airport_id) {
        params.push(airport_id);
        conditions.push(`f.airport_id = $${params.length}`);
      }

      if (type) {
        params.push(type);
        conditions.push(`f.type = $${params.length}`);
      }

      if (status) {
        params.push(status);
        conditions.push(`f.status = $${params.length}`);
      }

      if (q && q.trim()) {
        params.push(`%${q.trim()}%`);
        conditions.push(`f.name ILIKE $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total matching facilities
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total
           FROM facility f
          ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total, 10);

      // Fetch paginated facilities ordered by terminal then name
      const queryParams = [...params, limit, offset];
      const dataResult = await pool.query(
        `SELECT f.id,
                f.airport_id,
                f.name,
                f.type,
                f.location_terminal,
                f.location_gate_proximity,
                f.status,
                a.code AS airport_code,
                a.name AS airport_name,
                a.city AS airport_city
           FROM facility f
           JOIN airport a ON a.id = f.airport_id
          ${whereClause}
          ORDER BY f.location_terminal ASC NULLS LAST, f.name ASC
          LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
        queryParams
      );

      res.json({
        facilities: dataResult.rows,
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error('get facilities error:', err.message);
      res.status(500).json({ error: 'Could not fetch facilities' });
    }
  }
);

// GET /facilities/:id — get facility details by id
facilitiesRouter.get(
  '/:id',
  validate({ params: facilityIdParamSchema }),
  async (req, res) => {
    try {
      const facilityId = req.params.id;
      const { rows } = await pool.query(
        `SELECT f.id,
                f.airport_id,
                f.name,
                f.type,
                f.location_terminal,
                f.location_gate_proximity,
                f.status,
                a.code AS airport_code,
                a.name AS airport_name,
                a.city AS airport_city
           FROM facility f
           JOIN airport a ON a.id = f.airport_id
          WHERE f.id = $1`,
        [facilityId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }

      res.json({ facility: rows[0] });
    } catch (err) {
      console.error('get facility error:', err.message);
      res.status(500).json({ error: 'Could not fetch facility' });
    }
  }
);

// POST /facilities — admin and ops_manager create facility
facilitiesRouter.post(
  '/',
  requireRole(...ADMIN_OPS_ROLES),
  validate({ body: createFacilitySchema }),
  async (req, res) => {
    const { airport_id, name, type, location_terminal, location_gate_proximity, status } = req.body;

    try {
      // Validate airport exists
      const airportRes = await pool.query('SELECT id, code, name, city FROM airport WHERE id = $1', [airport_id]);
      if (airportRes.rows.length === 0) {
        return res.status(400).json({ error: 'Airport not found' });
      }
      const airport = airportRes.rows[0];

      const { rows } = await pool.query(
        `INSERT INTO facility (airport_id, name, type, location_terminal, location_gate_proximity, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, airport_id, name, type, location_terminal, location_gate_proximity, status`,
        [
          airport_id,
          name,
          type,
          location_terminal || null,
          location_gate_proximity || null,
          status || 'open',
        ]
      );

      const facility = {
        ...rows[0],
        airport_code: airport.code,
        airport_name: airport.name,
        airport_city: airport.city,
      };

      const io = getIo(req);
      if (io) {
        io.to('ops_feed').emit('facility:created', { facility });
      }

      res.status(201).json({ facility });
    } catch (err) {
      console.error('create facility error:', err.message);
      res.status(500).json({ error: 'Could not create facility' });
    }
  }
);

// PATCH /facilities/:id — admin and ops_manager edit facility
facilitiesRouter.patch(
  '/:id',
  requireRole(...ADMIN_OPS_ROLES),
  validate({ params: facilityIdParamSchema, body: updateFacilitySchema }),
  async (req, res) => {
    const facilityId = req.params.id;
    const { airport_id, name, type, location_terminal, location_gate_proximity, status } = req.body;

    try {
      // Check existing facility
      const existingRes = await pool.query('SELECT id, airport_id FROM facility WHERE id = $1', [facilityId]);
      if (existingRes.rows.length === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }

      // Check airport if updated
      if (airport_id !== undefined) {
        const airportRes = await pool.query('SELECT id FROM airport WHERE id = $1', [airport_id]);
        if (airportRes.rows.length === 0) {
          return res.status(400).json({ error: 'Airport not found' });
        }
      }

      const updates = [];
      const values = [];

      if (airport_id !== undefined) {
        values.push(airport_id);
        updates.push(`airport_id = $${values.length}`);
      }
      if (name !== undefined) {
        values.push(name);
        updates.push(`name = $${values.length}`);
      }
      if (type !== undefined) {
        values.push(type);
        updates.push(`type = $${values.length}`);
      }
      if (location_terminal !== undefined) {
        values.push(location_terminal || null);
        updates.push(`location_terminal = $${values.length}`);
      }
      if (location_gate_proximity !== undefined) {
        values.push(location_gate_proximity || null);
        updates.push(`location_gate_proximity = $${values.length}`);
      }
      if (status !== undefined) {
        values.push(status);
        updates.push(`status = $${values.length}`);
      }

      values.push(facilityId);
      await pool.query(
        `UPDATE facility
            SET ${updates.join(', ')}
          WHERE id = $${values.length}`,
        values
      );

      const updatedRes = await pool.query(
        `SELECT f.id,
                f.airport_id,
                f.name,
                f.type,
                f.location_terminal,
                f.location_gate_proximity,
                f.status,
                a.code AS airport_code,
                a.name AS airport_name,
                a.city AS airport_city
           FROM facility f
           JOIN airport a ON a.id = f.airport_id
          WHERE f.id = $1`,
        [facilityId]
      );

      const facility = updatedRes.rows[0];

      const io = getIo(req);
      if (io) {
        io.to('ops_feed').emit('facility:updated', { facility });
      }

      res.json({ facility });
    } catch (err) {
      console.error('update facility error:', err.message);
      res.status(500).json({ error: 'Could not update facility' });
    }
  }
);

// PATCH /facilities/:id/status — admin, ops_manager, ground_crew update status
facilitiesRouter.patch(
  '/:id/status',
  requireRole(...FACILITY_STAFF_ROLES),
  validate({ params: facilityIdParamSchema, body: updateStatusSchema }),
  async (req, res) => {
    const facilityId = req.params.id;
    const { status } = req.body;

    try {
      const updateRes = await pool.query(
        `UPDATE facility
            SET status = $1
          WHERE id = $2
          RETURNING id`,
        [status, facilityId]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }

      const updatedRes = await pool.query(
        `SELECT f.id,
                f.airport_id,
                f.name,
                f.type,
                f.location_terminal,
                f.location_gate_proximity,
                f.status,
                a.code AS airport_code,
                a.name AS airport_name,
                a.city AS airport_city
           FROM facility f
           JOIN airport a ON a.id = f.airport_id
          WHERE f.id = $1`,
        [facilityId]
      );

      const facility = updatedRes.rows[0];

      const io = getIo(req);
      if (io) {
        io.to('ops_feed').emit('facility:status_updated', { facility });
      }

      res.json({ facility });
    } catch (err) {
      console.error('update facility status error:', err.message);
      res.status(500).json({ error: 'Could not update facility status' });
    }
  }
);

// DELETE /facilities/:id — admin and ops_manager delete facility
facilitiesRouter.delete(
  '/:id',
  requireRole(...ADMIN_OPS_ROLES),
  validate({ params: facilityIdParamSchema }),
  async (req, res) => {
    const facilityId = req.params.id;

    try {
      const delRes = await pool.query(
        'DELETE FROM facility WHERE id = $1 RETURNING id',
        [facilityId]
      );

      if (delRes.rows.length === 0) {
        return res.status(404).json({ error: 'Facility not found' });
      }

      const io = getIo(req);
      if (io) {
        io.to('ops_feed').emit('facility:deleted', { id: facilityId });
      }

      res.json({ message: 'Facility deleted successfully', id: facilityId });
    } catch (err) {
      console.error('delete facility error:', err.message);
      res.status(500).json({ error: 'Could not delete facility' });
    }
  }
);
