import { pool } from '../src/db/pool.js';
import {
  validateAndCreateConnection,
  evaluateConnectionStatus,
  getRebookingOptions,
  rebookConnection,
} from '../src/services/connectionService.js';
import { logFlightDelayAndCascade } from '../src/services/delayCascadeService.js';

describe('Week 6: Connecting Flights & Rebooking Tests', () => {
  let airportA, airportB, airportC; // A -> B (hub) -> C
  let aircraftType;
  let testUser;

  beforeAll(async () => {
    // Cleanup any lingering test data
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'W6-%'");

    // Fetch 3 airports
    const apRes = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 3');
    airportA = apRes.rows[0].id;
    airportB = apRes.rows[1].id; // transit hub
    airportC = apRes.rows[2].id;

    // Set MCT on hub airport B to 60 minutes
    await pool.query('UPDATE airport SET min_connection_minutes = 60 WHERE id = $1', [airportB]);

    // Fetch aircraft type
    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    aircraftType = actRes.rows[0].id;

    // Create passenger user
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Conn Passenger', 'w6_p_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'passenger')
       RETURNING id`
    );
    testUser = uRes.rows[0];
  });

  afterAll(async () => {
    if (testUser) {
      await pool.query('DELETE FROM connection WHERE passenger_id = $1', [testUser.id]);
      await pool.query('DELETE FROM booking WHERE passenger_id = $1 OR user_id = $1', [testUser.id]);
      await pool.query('DELETE FROM delay_log WHERE logged_by = $1', [testUser.id]);
      await pool.query("DELETE FROM flight WHERE flight_number LIKE 'W6-%'");
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
  });

  test('Validation: rejects connections where inbound destination != outbound origin', async () => {
    const dep1 = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    const arr1 = new Date(dep1.getTime() + 2 * 3600 * 1000);

    // Flight 1: A -> B
    const f1 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status)
       VALUES ('W6-VAL1', $1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, dep1, arr1]
    );

    // Flight 2: A -> C (mismatch! outbound departs from A, but inbound arrives at B)
    const dep2 = new Date(dep1.getTime() + 4 * 3600 * 1000);
    const arr2 = new Date(dep2.getTime() + 2 * 3600 * 1000);
    const f2 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status)
       VALUES ('W6-VAL2', $1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportC, dep2, arr2]
    );

    await expect(
      validateAndCreateConnection({
        inboundFlightId: f1.rows[0].id,
        outboundFlightId: f2.rows[0].id,
        passengerId: testUser.id,
      })
    ).rejects.toThrow(/must match outbound origin/i);
  });

  test('Status evaluation: sets on_track when actual >= MCT (60m), at_risk when < MCT, missed when < 20m', async () => {
    const t0 = new Date(Date.now() + 11 * 24 * 3600 * 1000);
    const inArr = new Date(t0.getTime() + 2 * 3600 * 1000);

    // Inbound: A -> B
    const inFlight = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-IN1', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, t0, inArr]
    );

    // Outbound with 90 min buffer: B -> C (90 >= 60 -> on_track)
    const outDep90 = new Date(inArr.getTime() + 90 * 60_000);
    const outArr90 = new Date(outDep90.getTime() + 2 * 3600 * 1000);
    const outFlight90 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-OUT90', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportB, airportC, outDep90, outArr90]
    );

    const conn90 = await validateAndCreateConnection({
      inboundFlightId: inFlight.rows[0].id,
      outboundFlightId: outFlight90.rows[0].id,
      passengerId: testUser.id,
    });
    expect(conn90.status).toBe('on_track');
    expect(conn90.actual_connection_minutes).toBe(90);

    // Outbound with 35 min buffer: B -> C (20 <= 35 < 60 -> at_risk)
    const outDep35 = new Date(inArr.getTime() + 35 * 60_000);
    const outArr35 = new Date(outDep35.getTime() + 2 * 3600 * 1000);
    const outFlight35 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-OUT35', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportB, airportC, outDep35, outArr35]
    );

    const conn35 = await validateAndCreateConnection({
      inboundFlightId: inFlight.rows[0].id,
      outboundFlightId: outFlight35.rows[0].id,
      passengerId: testUser.id,
    });
    expect(conn35.status).toBe('at_risk');
    expect(conn35.actual_connection_minutes).toBe(35);

    // Outbound with 10 min buffer: B -> C (10 < 20 -> missed)
    const outDep10 = new Date(inArr.getTime() + 10 * 60_000);
    const outArr10 = new Date(outDep10.getTime() + 2 * 3600 * 1000);
    const outFlight10 = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-OUT10', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportB, airportC, outDep10, outArr10]
    );

    const conn10 = await validateAndCreateConnection({
      inboundFlightId: inFlight.rows[0].id,
      outboundFlightId: outFlight10.rows[0].id,
      passengerId: testUser.id,
    });
    expect(conn10.status).toBe('missed');
    expect(conn10.actual_connection_minutes).toBe(10);
  });

  test('Delay cascade triggers automatic connection re-evaluation: on_track flips to at_risk/missed', async () => {
    const t0 = new Date(Date.now() + 12 * 24 * 3600 * 1000);
    const inArr = new Date(t0.getTime() + 2 * 3600 * 1000);

    // Inbound: A -> B
    const inF = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-CAS-IN', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, t0, inArr]
    );
    const inboundId = inF.rows[0].id;

    // Outbound: B -> C (scheduled 75 mins after inbound arrival -> on_track)
    const outDep = new Date(inArr.getTime() + 75 * 60_000);
    const outArr = new Date(outDep.getTime() + 2 * 3600 * 1000);
    const outF = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-CAS-OUT', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportB, airportC, outDep, outArr]
    );
    const outboundId = outF.rows[0].id;

    const conn = await validateAndCreateConnection({
      inboundFlightId: inboundId,
      outboundFlightId: outboundId,
      passengerId: testUser.id,
    });
    expect(conn.status).toBe('on_track');

    // Incur 30 min delay on inbound flight:
    // New connection time: 75 - 30 = 45 mins (< 60m MCT -> at_risk)
    await logFlightDelayAndCascade({
      flightId: inboundId,
      delayMinutes: 30,
      reasonCode: 'ATC',
      loggedBy: testUser.id,
    });

    const { rows: reCheckedConn } = await pool.query('SELECT status, actual_connection_minutes FROM connection WHERE id = $1', [conn.id]);
    expect(reCheckedConn[0].status).toBe('at_risk');
    expect(reCheckedConn[0].actual_connection_minutes).toBe(45);

    // Incur additional 30 min delay on inbound (total 60 min delay):
    // New connection time: 75 - 60 = 15 mins (< 20m gate close -> missed)
    await logFlightDelayAndCascade({
      flightId: inboundId,
      delayMinutes: 30,
      reasonCode: 'WX',
      loggedBy: testUser.id,
    });

    const { rows: missedConn } = await pool.query('SELECT status, actual_connection_minutes FROM connection WHERE id = $1', [conn.id]);
    expect(missedConn[0].status).toBe('missed');
    expect(missedConn[0].actual_connection_minutes).toBe(15);
  });

  test('Rebooking options & transactional rebooking: suggests alternative flights and executes atomic swap', async () => {
    const t0 = new Date(Date.now() + 13 * 24 * 3600 * 1000);
    const inArr = new Date(t0.getTime() + 2 * 3600 * 1000);

    // Inbound: A -> B
    const inF = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-RB-IN', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, t0, inArr]
    );

    // Old outbound (missed): B -> C
    const oldOutDep = new Date(inArr.getTime() + 10 * 60_000);
    const oldOutArr = new Date(oldOutDep.getTime() + 2 * 3600 * 1000);
    const oldOutF = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W6-RB-OLD', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportB, airportC, oldOutDep, oldOutArr]
    );

    // Seat and booking on old outbound
    const oldSeat = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '12A', 'economy', true)
       RETURNING id`,
      [oldOutF.rows[0].id]
    );

    const oldBooking = await pool.query(
      `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
       VALUES ('BKOLD1', $1, $1, $2, $3, 'confirmed', 5000)
       RETURNING id`,
      [testUser.id, oldOutF.rows[0].id, oldSeat.rows[0].id]
    );

    const conn = await validateAndCreateConnection({
      inboundFlightId: inF.rows[0].id,
      outboundFlightId: oldOutF.rows[0].id,
      passengerId: testUser.id,
      outboundBookingId: oldBooking.rows[0].id,
    });
    expect(conn.status).toBe('missed');

    // Create alternative flight: B -> C departing 2 hours after inbound arrival
    const newOutDep = new Date(inArr.getTime() + 120 * 60_000);
    const newOutArr = new Date(newOutDep.getTime() + 2 * 3600 * 1000);
    const newOutF = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status, base_price_cents)
       VALUES ('W6-RB-NEW', $1, $2, $3, $4, $5, $4, $5, 'scheduled', 5500)
       RETURNING id`,
      [aircraftType, airportB, airportC, newOutDep, newOutArr]
    );

    const newSeat = await pool.query(
      `INSERT INTO seat (flight_id, seat_number, class, is_booked)
       VALUES ($1, '14B', 'economy', false)
       RETURNING id`,
      [newOutF.rows[0].id]
    );

    // 1. Fetch rebooking options
    const optionsResult = await getRebookingOptions(conn.id);
    expect(optionsResult.options.length).toBeGreaterThanOrEqual(1);
    const option = optionsResult.options.find((o) => o.id === newOutF.rows[0].id);
    expect(option).toBeDefined();

    // 2. Perform atomic rebooking
    const rebookResult = await rebookConnection(conn.id, {
      newFlightId: newOutF.rows[0].id,
      newSeatId: newSeat.rows[0].id,
      userId: testUser.id,
    });

    expect(rebookResult.ok).toBe(true);
    expect(rebookResult.connection.status).toBe('on_track');
    expect(rebookResult.connection.outbound_flight_id).toBe(newOutF.rows[0].id);

    // Old booking must be cancelled, old seat freed
    const { rows: oldBookingCheck } = await pool.query('SELECT status FROM booking WHERE id = $1', [oldBooking.rows[0].id]);
    expect(oldBookingCheck[0].status).toBe('cancelled');

    const { rows: oldSeatCheck } = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [oldSeat.rows[0].id]);
    expect(oldSeatCheck[0].is_booked).toBe(false);

    // New seat must be booked
    const { rows: newSeatCheck } = await pool.query('SELECT is_booked FROM seat WHERE id = $1', [newSeat.rows[0].id]);
    expect(newSeatCheck[0].is_booked).toBe(true);

    // Double rebooking prevention
    await expect(
      rebookConnection(conn.id, {
        newFlightId: newOutF.rows[0].id,
        newSeatId: newSeat.rows[0].id,
        userId: testUser.id,
      })
    ).rejects.toThrow(/already booked on this flight/i);
  });
});
