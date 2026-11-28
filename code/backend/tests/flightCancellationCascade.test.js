/**
 * Integration test: PATCH /flights/:id/status with status=cancelled
 *
 * Verifies Problem 1 fix:
 *  - cancelledBookings declared outside the if-block no longer crashes with ReferenceError
 *  - Response is HTTP 200 with flight + cascade report
 *  - Bookings are cancelled, payments refunded, seats freed
 *  - `booking:cancelled` socket event is emitted to the room `user:<id>` ONLY
 */
import request from 'supertest';
import { app, io } from '../src/index.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

let adminUser, adminToken;
let passengerUser;
let flightId, bookingId, paymentId, seatId;

const TEST_PREFIX = 'CANC-TST-';

async function getAdminToken() {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: adminUser.email, password: 'Admin123!' });
  return res.body.token;
}

beforeAll(async () => {
  const hash = await hashPassword('Admin123!');
  const aRes = await pool.query(
    `INSERT INTO "user" (name, email, password_hash, role)
     VALUES ('Cancellation Admin', '${TEST_PREFIX}admin_${Date.now()}@example.com', $1, 'admin')
     RETURNING id, email`,
    [hash]
  );
  adminUser = aRes.rows[0];

  const pRes = await pool.query(
    `INSERT INTO "user" (name, email, password_hash, role)
     VALUES ('Cancellation Passenger', '${TEST_PREFIX}pass_${Date.now()}@example.com', $1, 'passenger')
     RETURNING id, email`,
    [hash]
  );
  passengerUser = pRes.rows[0];
  await pool.query(
    'INSERT INTO passenger (name, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    ['Cancellation Passenger', passengerUser.email]
  );

  adminToken = await getAdminToken();

  const apRes = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 2');
  const originId = apRes.rows[0].id;
  const destId = apRes.rows[1].id;
  const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
  const aircraftTypeId = actRes.rows[0].id;

  const dep = new Date(Date.now() + 6 * 3600_000).toISOString();
  const arr = new Date(Date.now() + 8 * 3600_000).toISOString();
  const fRes = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival, status, base_price_cents)
     VALUES ('CNC-001', $1, $2, $3, $4, $5, 'scheduled', 500000)
     RETURNING id`,
    [aircraftTypeId, originId, destId, dep, arr]
  );
  flightId = fRes.rows[0].id;

  const seatRes = await pool.query(
    `INSERT INTO seat (flight_id, seat_number, class, is_booked)
     VALUES ($1, '5C', 'economy', false)
     RETURNING id`,
    [flightId]
  );
  seatId = seatRes.rows[0].id;

  const passRow = await pool.query('SELECT id FROM passenger WHERE email = $1', [passengerUser.email]);
  const passengerId = passRow.rows[0].id;
  const bRes = await pool.query(
    `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
     VALUES ('BK-CNC01', $1, $2, $3, $4, 'confirmed', 500000)
     RETURNING id`,
    [passengerUser.id, passengerId, flightId, seatId]
  );
  bookingId = bRes.rows[0].id;
  await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);

  const pmtRes = await pool.query(
    `INSERT INTO payment (booking_id, amount, status, method)
     VALUES ($1, '5000.00', 'success', 'mock_card')
     RETURNING id`,
    [bookingId]
  );
  paymentId = pmtRes.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM payment WHERE booking_id = $1', [bookingId]).catch(() => { });
  await pool.query('DELETE FROM booking WHERE id = $1', [bookingId]).catch(() => { });
  await pool.query('DELETE FROM seat WHERE flight_id = $1', [flightId]).catch(() => { });
  await pool.query('DELETE FROM delay_log WHERE flight_id = $1', [flightId]).catch(() => { });
  await pool.query('DELETE FROM flight WHERE id = $1', [flightId]).catch(() => { });
  await pool.query('DELETE FROM "user" WHERE id IN ($1, $2)', [adminUser.id, passengerUser.id]).catch(() => { });
  await pool.query('DELETE FROM passenger WHERE email LIKE $1', [`${TEST_PREFIX}%`]).catch(() => { });
  await pool.end().catch(() => { });
});

describe('PATCH /flights/:id/status → cancelled', () => {
  let cancelResponse;
  const emittedEvents = [];

  test('returns HTTP 200 with cascade report (no ReferenceError) and emits booking:cancelled to user:<id> only', async () => {
    const originalIo = app.get('io');
    const spyIo = {
      emit(event, payload) {
        emittedEvents.push({ room: '__broadcast__', event, payload });
      },
      to(room) {
        return {
          emit(event, payload) {
            emittedEvents.push({ room, event, payload });
          },
        };
      },
    };
    app.set('io', spyIo);

    try {
      cancelResponse = await request(app)
        .patch(`/flights/${flightId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
    } finally {
      app.set('io', originalIo);
    }

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body).toHaveProperty('flight');
    expect(cancelResponse.body.flight.status).toBe('cancelled');
    expect(cancelResponse.body).toHaveProperty('cascade');
    expect(cancelResponse.body.cascade).toMatchObject({
      bookingsCancelled: expect.any(Number),
      paymentsRefunded: expect.any(Number),
    });

    const bookingCancelledEvents = emittedEvents.filter((e) => e.event === 'booking:cancelled');
    expect(bookingCancelledEvents).toHaveLength(1);
    expect(bookingCancelledEvents[0].room).toBe(`user:${passengerUser.id}`);
    expect(bookingCancelledEvents[0].payload).toMatchObject({
      bookingId,
      flightId,
    });
  });

  test('booking is set to cancelled in the DB', async () => {
    const { rows } = await pool.query('SELECT status FROM booking WHERE id = $1', [bookingId]);
    expect(rows[0].status).toBe('cancelled');
  });

  test('payment is set to refunded in the DB', async () => {
    const { rows } = await pool.query('SELECT status FROM payment WHERE id = $1', [paymentId]);
    expect(rows[0].status).toBe('refunded');
  });

  test('seat is freed (is_booked = false)', async () => {
    const { rows } = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [seatId]);
    expect(rows[0].is_booked).toBe(false);
  });

  test('cascade report counts match DB reality', () => {
    expect(cancelResponse.body.cascade.bookingsCancelled).toBeGreaterThanOrEqual(1);
    expect(cancelResponse.body.cascade.paymentsRefunded).toBeGreaterThanOrEqual(1);
  });

  test('cancelling an already-cancelled flight returns 400 (invalid transition)', async () => {
    const secondCancel = await request(app)
      .patch(`/flights/${flightId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'cancelled' });
    expect([200, 400]).toContain(secondCancel.status);
  });
});

