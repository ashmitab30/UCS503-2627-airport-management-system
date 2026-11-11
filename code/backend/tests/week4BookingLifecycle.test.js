import { pool } from '../src/db/pool.js';
import {
  holdSeat,
  confirmHeldBooking,
  checkInBooking,
  cancelBooking,
  flagNoShowsForFlight,
  cleanupExpiredHolds,
} from '../src/services/bookingService.js';
import { generateQrCode } from '../src/services/boardingPassService.js';

describe('Week 4: Booking Lifecycle, Holds, Check-in & Cancellation Tests', () => {
  let testUser;
  let testFlight;
  let testSeats;

  beforeAll(async () => {
    // 1. Create test user
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('W4 Passenger', 'w4_user_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email`
    );
    testUser = uRes.rows[0];

    // 2. Setup flight departing in 12 hours (within 24h check-in window)
    const apRes = await pool.query('SELECT id FROM airport LIMIT 2');
    const actRes = await pool.query('SELECT id FROM aircraft_type WHERE size_class = \'medium\' LIMIT 1');

    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('W4-TEST', $1, $2, $3, now() + INTERVAL '12 hours', now() + INTERVAL '14 hours', 'scheduled', 5500)
       RETURNING id, base_price_cents`,
      [actRes.rows[0].id, apRes.rows[0].id, apRes.rows[1].id]
    );
    testFlight = fRes.rows[0];

    // 3. Create test seats
    const s1 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '88A', 'economy', false) RETURNING id, seat_number, class`,
      [testFlight.id]
    );
    const s2 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '88B', 'economy', false) RETURNING id, seat_number, class`,
      [testFlight.id]
    );
    const s3 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '88C', 'economy', false) RETURNING id, seat_number, class`,
      [testFlight.id]
    );
    testSeats = [s1.rows[0], s2.rows[0], s3.rows[0]];
  });

  afterAll(async () => {
    if (testFlight) {
      await pool.query('DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = $1)', [testFlight.id]);
      await pool.query('DELETE FROM booking WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM seat WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM flight WHERE id = $1', [testFlight.id]);
    }
    if (testUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
  });

  test('Timed seat hold: holds seat for 10 minutes and blocks concurrent hold', async () => {
    const holdRes1 = await holdSeat({
      userId: testUser.id,
      flightId: testFlight.id,
      seatId: testSeats[0].id,
      passengerDetails: { name: 'W4 John Doe', email: 'john@example.com' },
    });

    expect(holdRes1.ok).toBe(true);
    expect(holdRes1.booking.status).toBe('held');
    expect(holdRes1.booking.held_until).toBeDefined();

    // Verify seat is now locked
    const seatCheck = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeats[0].id]);
    expect(seatCheck.rows[0].is_booked).toBe(true);

    // Second hold for the same seat must fail
    const holdRes2 = await holdSeat({
      userId: testUser.id,
      flightId: testFlight.id,
      seatId: testSeats[0].id,
    });
    expect(holdRes2.ok).toBe(false);
    expect(holdRes2.status).toBe(409);

    // Confirm booking with mock payment
    const confirmRes = await confirmHeldBooking({
      bookingId: holdRes1.booking.id,
      userId: testUser.id,
      paymentMethod: 'mock_card',
    });
    expect(confirmRes.ok).toBe(true);
    expect(confirmRes.booking.status).toBe('confirmed');
    expect(confirmRes.payment.status).toBe('success');
  });

  test('Expired seat hold cleanup: expired hold is cancelled and seat is released', async () => {
    // Manually insert an expired hold directly into DB
    const expBooking = await pool.query(
      `INSERT INTO booking (user_id, flight_id, seat_id, price_cents, status, booking_ref, held_until)
       VALUES ($1, $2, $3, 5500, 'held', 'BKEXP01', now() - INTERVAL '5 minutes')
       RETURNING id, seat_id`,
      [testUser.id, testFlight.id, testSeats[1].id]
    );
    await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [testSeats[1].id]);

    // Attempting to confirm an expired hold returns 410 and frees seat
    const confirmRes = await confirmHeldBooking({
      bookingId: expBooking.rows[0].id,
      userId: testUser.id,
    });
    expect(confirmRes.ok).toBe(false);
    expect(confirmRes.status).toBe(410);

    // Verify seat is freed
    const seatCheck = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeats[1].id]);
    expect(seatCheck.rows[0].is_booked).toBe(false);
  });

  test('Web check-in: allows check-in within 24h window and optional seat selection', async () => {
    // Hold & confirm a fresh booking on seat 88B
    const holdRes = await holdSeat({
      userId: testUser.id,
      flightId: testFlight.id,
      seatId: testSeats[1].id,
    });
    await confirmHeldBooking({ bookingId: holdRes.booking.id, userId: testUser.id });

    // Check in with seat swap to 88C
    const checkInRes = await checkInBooking({
      bookingId: holdRes.booking.id,
      userId: testUser.id,
      seatId: testSeats[2].id,
    });

    expect(checkInRes.ok).toBe(true);
    expect(checkInRes.booking.status).toBe('checked_in');
    expect(checkInRes.booking.seat_id).toBe(testSeats[2].id);

    // Verify old seat is freed and new seat is booked
    const oldSeat = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeats[1].id]);
    const newSeat = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeats[2].id]);
    expect(oldSeat.rows[0].is_booked).toBe(false);
    expect(newSeat.rows[0].is_booked).toBe(true);
  });

  test('Cancellation & refund: frees seat and sets payment to refunded', async () => {
    // Book seat 88B
    const holdRes = await holdSeat({
      userId: testUser.id,
      flightId: testFlight.id,
      seatId: testSeats[1].id,
    });
    await confirmHeldBooking({ bookingId: holdRes.booking.id, userId: testUser.id });

    // Cancel booking (>2h before departure)
    const cancelRes = await cancelBooking({
      bookingId: holdRes.booking.id,
      userId: testUser.id,
    });

    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.booking.status).toBe('cancelled');
    expect(cancelRes.refund.status).toBe('refunded');

    // Seat is freed
    const seatCheck = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [testSeats[1].id]);
    expect(seatCheck.rows[0].is_booked).toBe(false);
  });

  test('No-show auto-flagging: updates unboarded passengers on flight', async () => {
    // Book seat 88B again
    const holdRes = await holdSeat({
      userId: testUser.id,
      flightId: testFlight.id,
      seatId: testSeats[1].id,
    });
    await confirmHeldBooking({ bookingId: holdRes.booking.id, userId: testUser.id });

    // Flag no-shows
    const flagRes = await flagNoShowsForFlight({ flightId: testFlight.id });
    expect(flagRes.ok).toBe(true);
    expect(flagRes.flagged_count).toBeGreaterThanOrEqual(1);

    const bCheck = await pool.query('SELECT status FROM booking WHERE id = $1', [holdRes.booking.id]);
    expect(bCheck.rows[0].status).toBe('no_show');
  });

  test('QR Code generation produces valid Data URL', async () => {
    const qrUrl = await generateQrCode('TEST|PAYLOAD|AI101');
    expect(qrUrl).toMatch(/^data:image\/png;base64,/);
  });
});

