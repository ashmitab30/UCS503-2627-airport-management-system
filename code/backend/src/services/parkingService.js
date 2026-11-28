import crypto from 'crypto';
import { pool } from '../db/pool.js';
import {
  ADVISORY_LOCK_DOMAINS,
  PARKING_MAX_DURATION_DAYS,
  PARKING_BOOKING_STATUSES,
  PARKING_SLOT_STATUSES,
  INDIAN_VEHICLE_PLATE_REGEX,
} from '../constants/index.js';

export {
  PARKING_MAX_DURATION_DAYS,
  PARKING_BOOKING_STATUSES,
  PARKING_SLOT_STATUSES,
  INDIAN_VEHICLE_PLATE_REGEX,
};

/**
 * ARCHITECTURAL RULE / CONCURRENCY MODEL:
 * =======================================
 * 1. Concurrency Safety:
 *    All booking creations take an advisory transaction-level lock on the lot:
 *    pg_advisory_xact_lock(ADVISORY_LOCK_DOMAINS.PARKING_SLOT, lot_id).
 *    This serializes concurrent slot allocations within the same lot without
 *    causing deadlocks or database-wide locking.
 *
 * 2. Slot Availability vs Physical Slot Status:
 *    - Availability for arbitrary/future windows [from, until] is ALWAYS decided
 *      by reservation windows of non-cancelled bookings, NOT by slot.status.
 *      Specifically, a slot is available if:
 *        NOT EXISTS (
 *          SELECT 1 FROM parking_booking pb
 *          WHERE pb.slot_id = ps.id
 *            AND pb.status != 'cancelled'
 *            AND pb.reserved_from < :until
 *            AND pb.reserved_until > :from
 *        )
 *      Back-to-back bookings (where one ends exactly when the next starts)
 *      are valid and allowed since pb.reserved_from < until AND pb.reserved_until > from
 *      evaluates to FALSE at exact boundaries.
 *    - slot.status ('free', 'occupied', 'reserved') is kept consistent with physical
 *      vehicle entry and exit (set to 'occupied' upon check-in/entry, 'free' on exit).
 */

/**
 * Normalise vehicle registration number and validate against Indian plate patterns.
 * Examples: MH12AB1234, DL1CAB1234, KA05D9999, 22BH1234AA.
 */
export function validateVehiclePlate(plateString) {
  if (!plateString || typeof plateString !== 'string') {
    return { valid: false, error: 'Vehicle registration number is required' };
  }
  const cleaned = plateString.replace(/[\s-]+/g, '').toUpperCase();
  if (cleaned.length < 5 || cleaned.length > 12 || !INDIAN_VEHICLE_PLATE_REGEX.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid Indian vehicle registration format (e.g. MH12AB1234 or DL1CAB1234)',
    };
  }
  return { valid: true, plate: cleaned };
}

/**
 * Generate a short unique crypto-random booking reference with retry.
 * Format: PK-XXXXXXXX (e.g. PK-8F3A29B1)
 */
export async function generateParkingBookingRef(client = pool, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const ref = `PK-${randomHex}`;
    const existing = await client.query(
      'SELECT 1 FROM parking_booking WHERE booking_ref = $1',
      [ref]
    );
    if (existing.rows.length === 0) {
      return ref;
    }
  }
  throw new Error('Failed to generate a unique parking booking reference');
}

/**
 * Validate reservation date window.
 * Rules:
 *  - start in the future
 *  - end after start
 *  - duration at most 30 days
 */
export function validateReservationWindow(fromString, untilString) {
  if (!fromString || !untilString) {
    return { valid: false, error: 'Both from and until date-times are required' };
  }

  const fromDate = new Date(fromString);
  const untilDate = new Date(untilString);

  if (isNaN(fromDate.getTime()) || isNaN(untilDate.getTime())) {
    return { valid: false, error: 'Invalid date format for reservation window' };
  }

  const now = new Date();
  // Allow 60 seconds grace for clock skew / network transmission
  if (fromDate.getTime() < now.getTime() - 60_000) {
    return { valid: false, error: 'Reservation start time must be in the future' };
  }

  if (untilDate.getTime() <= fromDate.getTime()) {
    return { valid: false, error: 'Reservation end time must be after start time' };
  }

  const durationMs = untilDate.getTime() - fromDate.getTime();
  const maxMs = PARKING_MAX_DURATION_DAYS * 24 * 3600 * 1000;
  if (durationMs > maxMs) {
    return {
      valid: false,
      error: `Reservation duration cannot exceed ${PARKING_MAX_DURATION_DAYS} days`,
    };
  }

  const hours = Math.ceil(durationMs / (1000 * 60 * 60));
  return {
    valid: true,
    fromDate,
    untilDate,
    hours,
  };
}

/**
 * GET available lots for an airport and date window with free slots count and estimated cost.
 */
export async function getAvailableLotsForWindow({
  airportId,
  from,
  until,
  client = pool,
}) {
  const airportIdNum = parseInt(airportId, 10);
  if (isNaN(airportIdNum)) {
    const err = new Error('Valid airport_id is required');
    err.status = 400;
    throw err;
  }

  const windowValidation = validateReservationWindow(from, until);
  if (!windowValidation.valid) {
    const err = new Error(windowValidation.error);
    err.status = 400;
    throw err;
  }

  const { fromDate, untilDate, hours } = windowValidation;

  const query = `
    SELECT pl.id, pl.airport_id, pl.name, pl.total_slots, pl.hourly_rate,
           a.code AS airport_code, a.name AS airport_name,
           COUNT(DISTINCT pb.slot_id)::int AS booked_slots_count
    FROM parking_lot pl
    JOIN airport a ON a.id = pl.airport_id
    LEFT JOIN parking_slot ps ON ps.lot_id = pl.id
    LEFT JOIN parking_booking pb ON pb.slot_id = ps.id
         AND pb.status != 'cancelled'
         AND pb.reserved_from < $3
         AND pb.reserved_until > $2
    WHERE pl.airport_id = $1
    GROUP BY pl.id, a.code, a.name
    ORDER BY pl.name ASC
  `;

  const { rows } = await client.query(query, [airportIdNum, fromDate, untilDate]);

  return rows.map((lot) => {
    const totalSlots = parseInt(lot.total_slots, 10);
    const bookedCount = parseInt(lot.booked_slots_count || 0, 10);
    const freeSlots = Math.max(0, totalSlots - bookedCount);
    const hourlyRateNum = parseFloat(lot.hourly_rate);
    const estimatedCost = Number((hours * hourlyRateNum).toFixed(2));

    return {
      id: lot.id,
      airport_id: lot.airport_id,
      airport_code: lot.airport_code,
      airport_name: lot.airport_name,
      name: lot.name,
      total_slots: totalSlots,
      booked_slots: bookedCount,
      free_slots: freeSlots,
      hourly_rate: hourlyRateNum,
      estimated_cost: estimatedCost,
      hours,
    };
  });
}

/**
 * Concurrency-safe creation of a parking booking.
 * In ONE transaction:
 *  - takes pg_advisory_xact_lock on the lot
 *  - picks a free slot for the window
 *  - inserts the booking
 *  - calculates mock charge (hours rounded UP x hourly_rate)
 */
export async function createParkingBooking({
  userId,
  lotId,
  vehicleNumber,
  from,
  until,
  io,
  clientPool = pool,
}) {
  const lotIdNum = parseInt(lotId, 10);
  if (isNaN(lotIdNum)) {
    const err = new Error('Valid lot_id is required');
    err.status = 400;
    throw err;
  }

  const plateValidation = validateVehiclePlate(vehicleNumber);
  if (!plateValidation.valid) {
    const err = new Error(plateValidation.error);
    err.status = 400;
    throw err;
  }

  const windowValidation = validateReservationWindow(from, until);
  if (!windowValidation.valid) {
    const err = new Error(windowValidation.error);
    err.status = 400;
    throw err;
  }

  const { fromDate, untilDate, hours } = windowValidation;
  const client = await clientPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Advisory transaction-level lock on the lot
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ADVISORY_LOCK_DOMAINS.PARKING_SLOT,
      lotIdNum,
    ]);

    // 2. Fetch lot details
    const lotRes = await client.query(
      `SELECT pl.*, a.code AS airport_code, a.name AS airport_name
       FROM parking_lot pl
       JOIN airport a ON a.id = pl.airport_id
       WHERE pl.id = $1`,
      [lotIdNum]
    );

    if (lotRes.rows.length === 0) {
      const err = new Error('Parking lot not found');
      err.status = 404;
      throw err;
    }
    const lot = lotRes.rows[0];

    // 3. Find an available slot with no overlapping non-cancelled booking in [fromDate, untilDate]
    const slotRes = await client.query(
      `SELECT ps.id, ps.slot_number
       FROM parking_slot ps
       WHERE ps.lot_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM parking_booking pb
           WHERE pb.slot_id = ps.id
             AND pb.status != 'cancelled'
             AND pb.reserved_from < $3
             AND pb.reserved_until > $2
         )
       ORDER BY ps.slot_number ASC
       LIMIT 1
       FOR UPDATE OF ps`,
      [lotIdNum, fromDate, untilDate]
    );

    if (slotRes.rows.length === 0) {
      const err = new Error('No parking slots available for the selected lot and reservation window');
      err.status = 409;
      throw err;
    }
    const slot = slotRes.rows[0];

    // 4. Calculate amount: hours rounded up * hourly rate
    const hourlyRateNum = parseFloat(lot.hourly_rate);
    const amountPaid = Number((hours * hourlyRateNum).toFixed(2));

    // 5. Generate short unique crypto booking reference
    const bookingRef = await generateParkingBookingRef(client);

    // 6. Insert booking
    const insertRes = await client.query(
      `INSERT INTO parking_booking (
         booking_ref, user_id, slot_id, vehicle_number,
         reserved_from, reserved_until, status, amount_paid, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, NOW())
       RETURNING *`,
      [
        bookingRef,
        userId,
        slot.id,
        plateValidation.plate,
        fromDate,
        untilDate,
        amountPaid,
      ]
    );
    const booking = insertRes.rows[0];

    await client.query('COMMIT');

    const result = {
      ...booking,
      slot_number: slot.slot_number,
      lot_name: lot.name,
      airport_code: lot.airport_code,
      airport_name: lot.airport_name,
      hours,
    };

    if (io) {
      io.to('ops_feed').emit('parking:updated', { bookingId: booking.id, lotId: lot.id });
      io.to(`user:${userId}`).emit('parking:booking_created', result);
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
 * Cancel a parking booking.
 * Only allowed for the booking owner before the reserved window starts.
 */
export async function cancelParkingBooking({
  bookingId,
  userId,
  isAdmin = false,
  io,
  clientPool = pool,
}) {
  const bId = parseInt(bookingId, 10);
  if (isNaN(bId)) {
    const err = new Error('Invalid booking ID');
    err.status = 400;
    throw err;
  }

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');

    const bookRes = await client.query(
      `SELECT pb.*, ps.slot_number, ps.lot_id
       FROM parking_booking pb
       JOIN parking_slot ps ON ps.id = pb.slot_id
       WHERE pb.id = $1
       FOR UPDATE OF pb`,
      [bId]
    );

    if (bookRes.rows.length === 0) {
      const err = new Error('Parking reservation not found');
      err.status = 404;
      throw err;
    }
    const booking = bookRes.rows[0];

    // Ownership check
    if (!isAdmin && booking.user_id !== userId) {
      const err = new Error('You do not have permission to cancel this parking reservation');
      err.status = 403;
      throw err;
    }

    // Status check
    if (booking.status === 'cancelled') {
      const err = new Error('Parking reservation is already cancelled');
      err.status = 409;
      throw err;
    }
    if (booking.status === 'active' || booking.status === 'completed') {
      const err = new Error(`Cannot cancel a parking reservation that is ${booking.status}`);
      err.status = 409;
      throw err;
    }

    // Window check: only before window starts
    const now = new Date();
    if (new Date(booking.reserved_from) <= now) {
      const err = new Error('Cannot cancel a parking reservation after the reserved window has started');
      err.status = 409;
      throw err;
    }

    // Update booking status
    const updateRes = await client.query(
      `UPDATE parking_booking
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING *`,
      [bId]
    );
    const updatedBooking = updateRes.rows[0];

    // Slot status check: if slot was reserved, set to free if no other active booking
    await client.query(
      `UPDATE parking_slot
       SET status = 'free'
       WHERE id = $1 AND status = 'reserved'`,
      [booking.slot_id]
    );

    await client.query('COMMIT');

    const refund = {
      amount_refunded: updatedBooking.amount_paid,
      status: 'refunded',
      cancelled_at: new Date(),
    };

    if (io) {
      io.to('ops_feed').emit('parking:updated', { bookingId: bId, lotId: booking.lot_id });
      io.to(`user:${booking.user_id}`).emit('parking:cancelled', { bookingId: bId, refund });
    }

    return { booking: updatedBooking, refund };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record vehicle physical entry (admin / ops_manager).
 * Sets booking entry_time, booking status 'active', and slot status 'occupied'.
 */
export async function recordParkingEntry({
  bookingId,
  io,
  clientPool = pool,
}) {
  const bId = parseInt(bookingId, 10);
  if (isNaN(bId)) {
    const err = new Error('Invalid booking ID');
    err.status = 400;
    throw err;
  }

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');

    const bookRes = await client.query(
      `SELECT pb.*, ps.slot_number, ps.lot_id
       FROM parking_booking pb
       JOIN parking_slot ps ON ps.id = pb.slot_id
       WHERE pb.id = $1
       FOR UPDATE OF pb`,
      [bId]
    );

    if (bookRes.rows.length === 0) {
      const err = new Error('Parking reservation not found');
      err.status = 404;
      throw err;
    }
    const booking = bookRes.rows[0];

    if (booking.status === 'active') {
      const err = new Error('Vehicle entry has already been recorded');
      err.status = 409;
      throw err;
    }
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      const err = new Error(`Cannot record entry for a ${booking.status} booking`);
      err.status = 409;
      throw err;
    }

    // Update booking
    const updateRes = await client.query(
      `UPDATE parking_booking
       SET status = 'active', entry_time = NOW()
       WHERE id = $1
       RETURNING *`,
      [bId]
    );
    const updated = updateRes.rows[0];

    // Update slot physical status to occupied
    await client.query(
      `UPDATE parking_slot SET status = 'occupied' WHERE id = $1`,
      [booking.slot_id]
    );

    await client.query('COMMIT');

    if (io) {
      io.to('ops_feed').emit('parking:updated', { bookingId: bId, lotId: booking.lot_id });
    }

    return { ...updated, slot_number: booking.slot_number };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record vehicle physical exit (admin / ops_manager).
 * Sets booking exit_time, booking status 'completed', and slot status 'free'.
 */
export async function recordParkingExit({
  bookingId,
  io,
  clientPool = pool,
}) {
  const bId = parseInt(bookingId, 10);
  if (isNaN(bId)) {
    const err = new Error('Invalid booking ID');
    err.status = 400;
    throw err;
  }

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');

    const bookRes = await client.query(
      `SELECT pb.*, ps.slot_number, ps.lot_id
       FROM parking_booking pb
       JOIN parking_slot ps ON ps.id = pb.slot_id
       WHERE pb.id = $1
       FOR UPDATE OF pb`,
      [bId]
    );

    if (bookRes.rows.length === 0) {
      const err = new Error('Parking reservation not found');
      err.status = 404;
      throw err;
    }
    const booking = bookRes.rows[0];

    if (booking.status !== 'active') {
      const err = new Error(`Cannot record exit for a booking that is currently "${booking.status}"`);
      err.status = 409;
      throw err;
    }

    // Update booking
    const updateRes = await client.query(
      `UPDATE parking_booking
       SET status = 'completed', exit_time = NOW()
       WHERE id = $1
       RETURNING *`,
      [bId]
    );
    const updated = updateRes.rows[0];

    // Update slot physical status to free
    await client.query(
      `UPDATE parking_slot SET status = 'free' WHERE id = $1`,
      [booking.slot_id]
    );

    await client.query('COMMIT');

    if (io) {
      io.to('ops_feed').emit('parking:updated', { bookingId: bId, lotId: booking.lot_id });
    }

    return { ...updated, slot_number: booking.slot_number };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get bookings for the authenticated user.
 */
export async function getUserParkingBookings(userId, client = pool) {
  const query = `
    SELECT pb.*,
           ps.slot_number,
           pl.id AS lot_id, pl.name AS lot_name, pl.hourly_rate,
           a.id AS airport_id, a.code AS airport_code, a.name AS airport_name
    FROM parking_booking pb
    JOIN parking_slot ps ON ps.id = pb.slot_id
    JOIN parking_lot pl ON pl.id = ps.lot_id
    JOIN airport a ON a.id = pl.airport_id
    WHERE pb.user_id = $1
    ORDER BY pb.created_at DESC, pb.reserved_from DESC
  `;
  const { rows } = await client.query(query, [userId]);
  return rows;
}

/**
 * Get lot occupancy summary and slot statuses (admin / ops_manager).
 */
export async function getLotOccupancy(lotId, client = pool) {
  const lotIdNum = parseInt(lotId, 10);
  if (isNaN(lotIdNum)) {
    const err = new Error('Valid lot_id is required');
    err.status = 400;
    throw err;
  }

  const lotRes = await client.query(
    `SELECT pl.*, a.code AS airport_code, a.name AS airport_name
     FROM parking_lot pl
     JOIN airport a ON a.id = pl.airport_id
     WHERE pl.id = $1`,
    [lotIdNum]
  );

  if (lotRes.rows.length === 0) {
    const err = new Error('Parking lot not found');
    err.status = 404;
    throw err;
  }
  const lot = lotRes.rows[0];

  // Slots in this lot with their current real-time status and active vehicle if any
  const slotsRes = await client.query(
    `SELECT ps.id, ps.slot_number, ps.status,
            pb.id AS active_booking_id, pb.booking_ref, pb.vehicle_number,
            pb.reserved_from, pb.reserved_until, pb.entry_time
     FROM parking_slot ps
     LEFT JOIN parking_booking pb ON pb.slot_id = ps.id AND pb.status = 'active'
     WHERE ps.lot_id = $1
     ORDER BY ps.slot_number ASC`,
    [lotIdNum]
  );

  const totalSlots = parseInt(lot.total_slots, 10);
  const occupiedSlots = slotsRes.rows.filter((s) => s.status === 'occupied').length;
  const reservedSlots = slotsRes.rows.filter((s) => s.status === 'reserved').length;
  const freeSlots = slotsRes.rows.filter((s) => s.status === 'free').length;

  return {
    lot: {
      ...lot,
      hourly_rate: parseFloat(lot.hourly_rate),
    },
    total_slots: totalSlots,
    occupied_slots: occupiedSlots,
    reserved_slots: reservedSlots,
    free_slots: freeSlots,
    slots: slotsRes.rows,
  };
}

/**
 * List all parking bookings with filters and pagination (admin / ops_manager).
 */
export async function listParkingBookings({
  status,
  lotId,
  airportId,
  vehicleNumber,
  bookingRef,
  page = 1,
  limit = 20,
  client = pool,
} = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`pb.status = $${params.length}`);
  }

  if (lotId) {
    params.push(parseInt(lotId, 10));
    conditions.push(`pl.id = $${params.length}`);
  }

  if (airportId) {
    params.push(parseInt(airportId, 10));
    conditions.push(`pl.airport_id = $${params.length}`);
  }

  if (vehicleNumber) {
    params.push(`%${vehicleNumber.trim().toUpperCase()}%`);
    conditions.push(`pb.vehicle_number ILIKE $${params.length}`);
  }

  if (bookingRef) {
    params.push(`%${bookingRef.trim().toUpperCase()}%`);
    conditions.push(`pb.booking_ref ILIKE $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM parking_booking pb
    JOIN parking_slot ps ON ps.id = pb.slot_id
    JOIN parking_lot pl ON pl.id = ps.lot_id
    ${whereClause}
  `;
  const countRes = await client.query(countQuery, params);
  const total = countRes.rows[0].total;

  const dataQuery = `
    SELECT pb.*,
           ps.slot_number,
           pl.id AS lot_id, pl.name AS lot_name, pl.hourly_rate,
           a.id AS airport_id, a.code AS airport_code, a.name AS airport_name,
           u.email AS user_email, u.name AS user_name
    FROM parking_booking pb
    JOIN parking_slot ps ON ps.id = pb.slot_id
    JOIN parking_lot pl ON pl.id = ps.lot_id
    JOIN airport a ON a.id = pl.airport_id
    JOIN "user" u ON u.id = pb.user_id
    ${whereClause}
    ORDER BY pb.created_at DESC, pb.reserved_from DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  params.push(limitNum, offset);

  const { rows } = await client.query(dataQuery, params);

  return {
    items: rows,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  };
}
