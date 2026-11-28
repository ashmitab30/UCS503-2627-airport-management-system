import { pool } from '../src/db/pool.js';
import {
  searchFlights,
  holdSeat,
  confirmHeldBooking,
  cancelBooking,
} from '../src/services/bookingService.js';

describe('Task 2: Realistic Domestic Fares & Pricing Consistency Tests', () => {
  let testUser;
  let testPassenger;
  let testFlight;
  let econSeat;
  let bizSeat;

  beforeAll(async () => {
    // 1. Create test user and passenger
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Fare Test User', 'fare_user_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id, name, email`
    );
    testUser = uRes.rows[0];

    const pRes = await pool.query(
      `INSERT INTO passenger (name, email)
       VALUES ($1, $2)
       RETURNING id`,
      [testUser.name, testUser.email]
    );
    testPassenger = pRes.rows[0];

    // 2. Setup test flight with base fare ₹4,500 = 450,000 paise
    const apRes = await pool.query('SELECT id FROM airport LIMIT 2');
    const actRes = await pool.query("SELECT id FROM aircraft_type WHERE size_class = 'medium' LIMIT 1");

    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status, base_price_cents)
       VALUES ('FARE-01', $1, $2, $3, now() + INTERVAL '24 hours', now() + INTERVAL '26 hours', 'scheduled', 450000)
       RETURNING id, base_price_cents, origin_id, dest_id`,
      [actRes.rows[0].id, apRes.rows[0].id, apRes.rows[1].id]
    );
    testFlight = fRes.rows[0];

    // 3. Create test seats
    const s1 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '91A', 'economy', false) RETURNING id, seat_number, class`,
      [testFlight.id]
    );
    const s2 = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '91B', 'business', false) RETURNING id, seat_number, class`,
      [testFlight.id]
    );
    econSeat = s1.rows[0];
    bizSeat = s2.rows[0];
  });

  afterAll(async () => {
    if (testFlight) {
      await pool.query('DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE flight_id = $1)', [testFlight.id]);
      await pool.query('DELETE FROM booking WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM seat WHERE flight_id = $1', [testFlight.id]);
      await pool.query('DELETE FROM flight WHERE id = $1', [testFlight.id]);
    }
    if (testPassenger) {
      await pool.query('DELETE FROM passenger WHERE id = $1', [testPassenger.id]);
    }
    if (testUser) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
  });

  describe('Seeded Fares Range and Cabin Multipliers', () => {
    const seedFlightNumbers = [
      'AI-101', '6E-202', 'AI-504', '6E-606',
      'AI-205', '6E-303', 'AI-407', '6E-512', 'AI-618',
      'AI-109', '6E-215', 'AI-301'
    ];

    it('all seeded flights have base_price_cents between ₹3,000 (300,000 paise) and ₹9,000 (900,000 paise)', async () => {
      const { rows } = await pool.query(
        'SELECT flight_number, base_price_cents FROM flight WHERE flight_number = ANY($1)',
        [seedFlightNumbers]
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const fare = Number(row.base_price_cents);
        expect(fare).toBeGreaterThanOrEqual(300000); // >= ₹3,000
        expect(fare).toBeLessThanOrEqual(900000);    // <= ₹9,000
      }
    });

    it('search flights computes proportional cabin fares based on multipliers (1.0x, 1.4x, 2.2x, 3.5x)', async () => {
      const res = await searchFlights({
        originId: testFlight.origin_id,
        destId: testFlight.dest_id,
      });

      const match = res.flights.find((f) => f.id === testFlight.id);
      expect(match).toBeDefined();
      expect(Number(match.base_price_cents)).toBe(450000);

      // Economy = 1.0x -> 450,000 paise (₹4,500)
      expect(Number(match.economy_price_cents)).toBe(450000);

      // Premium Economy = 1.4x -> 630,000 paise (₹6,300)
      expect(Number(match.premium_economy_price_cents)).toBe(Math.round(450000 * 1.4));

      // Business = 2.2x -> 990,000 paise (₹9,900)
      expect(Number(match.business_price_cents)).toBe(Math.round(450000 * 2.2));

      // First = 3.5x -> 1,575,000 paise (₹15,750)
      expect(Number(match.first_price_cents)).toBe(Math.round(450000 * 3.5));
    });
  });

  describe('Search vs Hold vs Payment Consistency', () => {
    it('charged economy booking price and payment amount match the search economy fare exactly', async () => {
      // 1. Search flight to get advertised fare
      const searchRes = await searchFlights({
        originId: testFlight.origin_id,
        destId: testFlight.dest_id,
      });
      const flightInSearch = searchRes.flights.find((f) => f.id === testFlight.id);
      const advertisedEconomyFare = Number(flightInSearch.economy_price_cents);
      expect(advertisedEconomyFare).toBe(450000);

      // 2. Hold economy seat
      const holdRes = await holdSeat({
        flightId: testFlight.id,
        seatId: econSeat.id,
        userId: testUser.id,
      });
      expect(holdRes.ok).toBe(true);
      expect(Number(holdRes.booking.price_cents)).toBe(advertisedEconomyFare);

      // 3. Confirm payment
      const confirmRes = await confirmHeldBooking({
        bookingId: holdRes.booking.id,
        userId: testUser.id,
        paymentMethod: 'mock_card',
      });
      expect(confirmRes.ok).toBe(true);

      // Payment amount must equal price_cents / 100 in rupees
      const expectedRupees = (advertisedEconomyFare / 100).toFixed(2);
      expect(confirmRes.payment.amount).toBe(expectedRupees);

      // 4. Verify payment row in database matches
      const payDb = await pool.query('SELECT amount, status FROM payment WHERE booking_id = $1', [holdRes.booking.id]);
      expect(payDb.rows.length).toBe(1);
      expect(Number(payDb.rows[0].amount)).toBe(advertisedEconomyFare / 100);
      expect(payDb.rows[0].status).toBe('success');

      // 5. Cancel booking & verify refund amount
      const cancelRes = await cancelBooking({
        bookingId: holdRes.booking.id,
        userId: testUser.id,
      });
      expect(cancelRes.ok).toBe(true);
      expect(cancelRes.refund).toBeDefined();
      expect(Number(cancelRes.refund.amount)).toBe(advertisedEconomyFare / 100);
    });

    it('charged business booking price and payment amount match the search business fare exactly', async () => {
      // 1. Search flight to get advertised business fare
      const searchRes = await searchFlights({
        originId: testFlight.origin_id,
        destId: testFlight.dest_id,
      });
      const flightInSearch = searchRes.flights.find((f) => f.id === testFlight.id);
      const advertisedBusinessFare = Number(flightInSearch.business_price_cents);
      expect(advertisedBusinessFare).toBe(990000);

      // 2. Hold business seat
      const holdRes = await holdSeat({
        flightId: testFlight.id,
        seatId: bizSeat.id,
        userId: testUser.id,
      });
      expect(holdRes.ok).toBe(true);
      expect(Number(holdRes.booking.price_cents)).toBe(advertisedBusinessFare);

      // 3. Confirm payment
      const confirmRes = await confirmHeldBooking({
        bookingId: holdRes.booking.id,
        userId: testUser.id,
        paymentMethod: 'mock_card',
      });
      expect(confirmRes.ok).toBe(true);

      const expectedRupees = (advertisedBusinessFare / 100).toFixed(2);
      expect(confirmRes.payment.amount).toBe(expectedRupees);

      // 4. Verify payment row in database matches
      const payDb = await pool.query('SELECT amount, status FROM payment WHERE booking_id = $1', [holdRes.booking.id]);
      expect(payDb.rows.length).toBe(1);
      expect(Number(payDb.rows[0].amount)).toBe(advertisedBusinessFare / 100);
      expect(payDb.rows[0].status).toBe('success');
    });
  });
});
