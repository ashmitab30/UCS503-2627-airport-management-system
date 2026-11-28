import crypto from 'crypto';
import { pool } from '../db/pool.js';
import {
  BAGGAGE_STATUSES,
  BAGGAGE_TRANSITIONS,
  BAGGAGE_WEIGHT_MIN,
  BAGGAGE_WEIGHT_MAX,
  MAX_BAGS_PER_BOOKING,
} from '../constants/index.js';
import { hasDeparted } from './flightTime.js';

export {
  BAGGAGE_STATUSES,
  BAGGAGE_TRANSITIONS,
  BAGGAGE_WEIGHT_MIN,
  BAGGAGE_WEIGHT_MAX,
  MAX_BAGS_PER_BOOKING,
};

/**
 * Generate a 10-digit crypto-random numeric tag string.
 * Retries if a collision occurs.
 */
export async function generateBaggageTag(client = pool, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 10 digits numeric: range 1,000,000,000 to 9,999,999,999
    const tag = crypto.randomInt(1000000000, 10000000000).toString();
    const existing = await client.query('SELECT 1 FROM baggage WHERE tag_number = $1', [tag]);
    if (existing.rows.length === 0) {
      return tag;
    }
  }
  throw new Error('Failed to generate a unique 10-digit baggage tag after maximum retries');
}

/**
 * Register a bag for a checked-in booking.
 * Creates the baggage row and first baggage_scan row in a single transaction.
 */
export async function registerBaggage({
  bookingId,
  weight,
  location,
  scannedBy,
  io,
  clientPool = pool,
}) {
  const numericWeight = parseFloat(weight);
  if (
    isNaN(numericWeight) ||
    numericWeight < BAGGAGE_WEIGHT_MIN ||
    numericWeight > BAGGAGE_WEIGHT_MAX
  ) {
    const err = new Error(
      `Weight must be between ${BAGGAGE_WEIGHT_MIN} and ${BAGGAGE_WEIGHT_MAX} kg`
    );
    err.status = 400;
    throw err;
  }

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and retrieve booking details with flight and origin airport
    const bookingRes = await client.query(
      `SELECT b.*, f.status AS flight_status, f.scheduled_departure, a.code AS origin_code
       FROM booking b
       JOIN flight f ON f.id = b.flight_id
       LEFT JOIN airport a ON a.id = f.origin_id
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [bookingId]
    );

    if (bookingRes.rows.length === 0) {
      const err = new Error('Booking not found');
      err.status = 404;
      throw err;
    }

    const booking = bookingRes.rows[0];

    // 2. Booking must be checked_in
    if (booking.status !== 'checked_in') {
      const err = new Error(
        `Booking must be checked in to register baggage. Current status: ${booking.status}`
      );
      err.status = 409;
      throw err;
    }

    // 3. Flight must not be departed or cancelled
    const flightDeparted =
      ['departed', 'in_air', 'landed', 'cancelled', 'diverted'].includes(
        booking.flight_status
      ) || hasDeparted(booking.scheduled_departure);

    if (flightDeparted) {
      const err = new Error(
        `Cannot register baggage for departed or cancelled flight (${booking.flight_status})`
      );
      err.status = 409;
      throw err;
    }

    // 4. Max 3 bags per booking check
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS count FROM baggage WHERE booking_id = $1',
      [bookingId]
    );
    const existingCount = countRes.rows[0].count;
    if (existingCount >= MAX_BAGS_PER_BOOKING) {
      const err = new Error(
        `Maximum ${MAX_BAGS_PER_BOOKING} bags allowed per booking`
      );
      err.status = 409;
      throw err;
    }

    // 5. Generate unique tag and determine initial location
    const tagNumber = await generateBaggageTag(client);
    const scanLocation = (location && String(location).trim()) || (booking.origin_code ? `${booking.origin_code} Check-in Desk` : 'Check-in Desk');

    // 6. Insert baggage
    const bagInsert = await client.query(
      `INSERT INTO baggage (booking_id, tag_number, weight, status, last_scanned_location, last_scanned_at)
       VALUES ($1, $2, $3, 'checked_in', $4, NOW())
       RETURNING *`,
      [bookingId, tagNumber, numericWeight.toFixed(2), scanLocation]
    );
    const bag = bagInsert.rows[0];

    // 7. Insert initial baggage_scan
    const scanInsert = await client.query(
      `INSERT INTO baggage_scan (baggage_id, status, location, scanned_by, scanned_at)
       VALUES ($1, 'checked_in', $2, $3, NOW())
       RETURNING *`,
      [bag.id, scanLocation, scannedBy || null]
    );
    const scan = scanInsert.rows[0];

    await client.query('COMMIT');

    const result = {
      ...bag,
      scans: [scan],
    };

    // Socket notification
    if (io) {
      io.to('ops_feed').emit('baggage_updated', { baggage: result, scan });
      io.to(`role:ground_crew`).emit('baggage_updated', { baggage: result, scan });
      io.to(`role:ops_manager`).emit('baggage_updated', { baggage: result, scan });
      io.to(`role:admin`).emit('baggage_updated', { baggage: result, scan });
      if (booking.user_id) {
        io.to(`user:${booking.user_id}`).emit('baggage_updated', { baggage: result, scan });
      }
      if (booking.flight_id) {
        io.to(`flight:${booking.flight_id}`).emit('baggage_updated', { baggage: result, scan });
      }
    }

    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update baggage status in pipeline.
 * Allowed transitions:
 *  - checked_in -> loaded, lost
 *  - loaded -> in_transit, lost
 *  - in_transit -> arrived, lost
 *  - arrived / lost -> terminal (no transitions)
 */
export async function updateBaggageStatus({
  baggageId,
  status: newStatus,
  location,
  scannedBy,
  io,
  clientPool = pool,
}) {
  if (!location || !String(location).trim()) {
    const err = new Error('Location is required for baggage status scan');
    err.status = 400;
    throw err;
  }

  if (!BAGGAGE_STATUSES.includes(newStatus)) {
    const err = new Error(
      `Invalid baggage status "${newStatus}". Must be one of: ${BAGGAGE_STATUSES.join(', ')}`
    );
    err.status = 400;
    throw err;
  }

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and retrieve baggage
    const bagRes = await client.query(
      `SELECT b.*, bk.user_id, bk.flight_id, bk.booking_ref
       FROM baggage b
       JOIN booking bk ON bk.id = b.booking_id
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [baggageId]
    );

    if (bagRes.rows.length === 0) {
      const err = new Error('Baggage not found');
      err.status = 404;
      throw err;
    }

    const bag = bagRes.rows[0];
    const currentStatus = bag.status;
    const allowed = BAGGAGE_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      const err = new Error(
        `Cannot transition baggage status from "${currentStatus}" to "${newStatus}"`
      );
      err.status = 409;
      throw err;
    }

    const scanLocation = String(location).trim();

    // 2. Update baggage row
    const updateRes = await client.query(
      `UPDATE baggage
       SET status = $1, last_scanned_location = $2, last_scanned_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, scanLocation, baggageId]
    );
    const updatedBag = updateRes.rows[0];

    // 3. Insert scan row
    const scanInsert = await client.query(
      `INSERT INTO baggage_scan (baggage_id, status, location, scanned_by, scanned_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [baggageId, newStatus, scanLocation, scannedBy || null]
    );
    const scan = scanInsert.rows[0];

    await client.query('COMMIT');

    const result = {
      ...updatedBag,
      booking_ref: bag.booking_ref,
      user_id: bag.user_id,
      flight_id: bag.flight_id,
      scan,
    };

    // Socket notification
    if (io) {
      io.to('ops_feed').emit('baggage_updated', { baggage: result, scan });
      io.to(`role:ground_crew`).emit('baggage_updated', { baggage: result, scan });
      io.to(`role:ops_manager`).emit('baggage_updated', { baggage: result, scan });
      io.to(`role:admin`).emit('baggage_updated', { baggage: result, scan });
      if (bag.user_id) {
        io.to(`user:${bag.user_id}`).emit('baggage_updated', { baggage: result, scan });
      }
      if (bag.flight_id) {
        io.to(`flight:${bag.flight_id}`).emit('baggage_updated', { baggage: result, scan });
      }
    }

    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get baggage details by tag number, including booking, flight, and scan history.
 */
export async function getBaggageByTag(tagNumber, client = pool) {
  const bagRes = await client.query(
    `SELECT b.*,
            bk.booking_ref, bk.user_id, bk.status AS booking_status,
            p.name AS passenger_name, p.email AS passenger_email,
            f.id AS flight_id, f.flight_number, f.status AS flight_status, f.scheduled_departure,
            orig.code AS origin_code, orig.city AS origin_city,
            dest.code AS destination_code, dest.city AS destination_city,
            st.seat_number, st.class AS seat_class
     FROM baggage b
     JOIN booking bk ON bk.id = b.booking_id
     LEFT JOIN passenger p ON p.id = bk.passenger_id
     JOIN flight f ON f.id = bk.flight_id
     LEFT JOIN airport orig ON orig.id = f.origin_id
     LEFT JOIN airport dest ON dest.id = f.dest_id
     LEFT JOIN seat st ON st.id = bk.seat_id
     WHERE b.tag_number = $1`,
    [tagNumber]
  );

  if (bagRes.rows.length === 0) {
    return null;
  }

  const bag = bagRes.rows[0];

  const scansRes = await client.query(
    `SELECT s.*, u.email AS scanned_by_email, u.role AS scanned_by_role
     FROM baggage_scan s
     LEFT JOIN "user" u ON u.id = s.scanned_by
     WHERE s.baggage_id = $1
     ORDER BY s.scanned_at ASC`,
    [bag.id]
  );

  return {
    ...bag,
    scans: scansRes.rows,
  };
}

/**
 * Get all bags for a booking with scan history.
 */
export async function getBookingBaggage(bookingId, client = pool) {
  const bagsRes = await client.query(
    `SELECT b.*
     FROM baggage b
     WHERE b.booking_id = $1
     ORDER BY b.id ASC`,
    [bookingId]
  );

  if (bagsRes.rows.length === 0) {
    return [];
  }

  const bagIds = bagsRes.rows.map((b) => b.id);
  const scansRes = await client.query(
    `SELECT s.*, u.email AS scanned_by_email, u.role AS scanned_by_role
     FROM baggage_scan s
     LEFT JOIN "user" u ON u.id = s.scanned_by
     WHERE s.baggage_id = ANY($1::int[])
     ORDER BY s.scanned_at ASC`,
    [bagIds]
  );

  const scansByBag = {};
  for (const s of scansRes.rows) {
    if (!scansByBag[s.baggage_id]) scansByBag[s.baggage_id] = [];
    scansByBag[s.baggage_id].push(s);
  }

  return bagsRes.rows.map((b) => ({
    ...b,
    scans: scansByBag[b.id] || [],
  }));
}

/**
 * List baggage for staff view with filtering and pagination.
 */
export async function listBaggage({
  status,
  flightId,
  tag,
  bookingRef,
  page = 1,
  limit = 20,
  client = pool,
} = {}) {
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
  const pageLimit = Math.max(1, Math.min(100, parseInt(limit, 10)));

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  if (flightId) {
    params.push(flightId);
    conditions.push(`f.id = $${params.length}`);
  }

  if (tag) {
    params.push(`%${tag.trim()}%`);
    conditions.push(`b.tag_number ILIKE $${params.length}`);
  }

  if (bookingRef) {
    params.push(`%${bookingRef.trim()}%`);
    conditions.push(`bk.booking_ref ILIKE $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM baggage b
    JOIN booking bk ON bk.id = b.booking_id
    JOIN flight f ON f.id = bk.flight_id
    ${whereClause}
  `;
  const countRes = await client.query(countQuery, params);
  const total = countRes.rows[0].total;

  const dataQuery = `
    SELECT b.*,
           bk.booking_ref, bk.user_id,
           p.name AS passenger_name, p.email AS passenger_email,
           f.id AS flight_id, f.flight_number, f.status AS flight_status, f.scheduled_departure,
           orig.code AS origin_code, dest.code AS destination_code
    FROM baggage b
    JOIN booking bk ON bk.id = b.booking_id
    LEFT JOIN passenger p ON p.id = bk.passenger_id
    JOIN flight f ON f.id = bk.flight_id
    LEFT JOIN airport orig ON orig.id = f.origin_id
    LEFT JOIN airport dest ON dest.id = f.dest_id
    ${whereClause}
    ORDER BY b.last_scanned_at DESC NULLS LAST, b.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(pageLimit, offset);

  const dataRes = await client.query(dataQuery, params);

  return {
    items: dataRes.rows,
    total,
    page: parseInt(page, 10),
    limit: pageLimit,
    totalPages: Math.ceil(total / pageLimit),
  };
}
