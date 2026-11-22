import { pool } from '../src/db/pool.js';
import {
  logFlightDelayAndCascade,
  updateTurnaroundStepTiming,
  IATA_REASON_CODES,
} from '../src/services/delayCascadeService.js';

describe('Week 5: IATA Delays, Cascade Forward & Turnaround Timestamps Tests', () => {
  let airportA, airportB;
  let aircraftType;
  let testUser;

  beforeAll(async () => {
    // Cleanup any lingering test flights from previous runs
    await pool.query("DELETE FROM flight WHERE flight_number LIKE 'W5-%'");

    // 1. Fetch test airports
    const apRes = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 2');
    airportA = apRes.rows[0].id;
    airportB = apRes.rows[1].id;

    // 2. Fetch test aircraft type
    const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
    aircraftType = actRes.rows[0].id;

    // 3. Create ops manager test user
    const uRes = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Ops Manager W5', 'ops_w5_' || gen_random_uuid() || '@example.com', 'dummy_hash', 'ops_manager')
       RETURNING id`
    );
    testUser = uRes.rows[0];
  });

  afterAll(async () => {
    // Cleanup created test delay logs, flights, and user
    if (testUser) {
      await pool.query('DELETE FROM delay_log WHERE logged_by = $1', [testUser.id]);
      await pool.query("DELETE FROM flight WHERE flight_number LIKE 'W5-%'");
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUser.id]);
    }
  });

  test('Validation: rejects invalid IATA reason code and negative/zero delay minutes', async () => {
    await expect(
      logFlightDelayAndCascade({
        flightId: 999999,
        delayMinutes: 30,
        reasonCode: 'INVALID_CODE',
      })
    ).rejects.toThrow(/Invalid reason code/);

    await expect(
      logFlightDelayAndCascade({
        flightId: 999999,
        delayMinutes: -10,
        reasonCode: 'WX',
      })
    ).rejects.toThrow(/delayMinutes must be a positive integer/);

    await expect(
      logFlightDelayAndCascade({
        flightId: 999999,
        delayMinutes: 0,
        reasonCode: 'WX',
      })
    ).rejects.toThrow(/delayMinutes must be a positive integer/);
  });

  test('Primary flight delay: shifts estimated times, updates status to delayed, logs IATA code', async () => {
    // Create flight scheduled 3 days ahead
    const depTime = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const arrTime = new Date(depTime.getTime() + 2 * 3600 * 1000);

    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W5-01', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id, scheduled_departure, scheduled_arrival, estimated_departure, estimated_arrival`,
      [aircraftType, airportA, airportB, depTime, arrTime]
    );
    const flight = fRes.rows[0];

    const result = await logFlightDelayAndCascade({
      flightId: flight.id,
      delayMinutes: 45,
      reasonCode: 'ATC',
      notes: 'Air traffic congestion at destination',
      loggedBy: testUser.id,
    });

    expect(result.ok).toBe(true);
    expect(result.primaryLog.delayMinutes).toBe(45);
    expect(result.primaryLog.reasonCode).toBe('ATC');

    // Verify DB state
    const { rows: updated } = await pool.query(
      'SELECT status, estimated_departure, estimated_arrival FROM flight WHERE id = $1',
      [flight.id]
    );
    expect(updated[0].status).toBe('delayed');

    const expectedEstDep = new Date(depTime.getTime() + 45 * 60_000);
    const actualEstDep = new Date(updated[0].estimated_departure);
    expect(Math.abs(actualEstDep.getTime() - expectedEstDep.getTime())).toBeLessThan(2000);

    // Verify delay_log entry
    const { rows: logs } = await pool.query(
      'SELECT delay_minutes, reason_code, is_cascade, logged_by FROM delay_log WHERE id = $1',
      [result.primaryLog.id]
    );
    expect(logs[0].delay_minutes).toBe(45);
    expect(logs[0].reason_code).toBe('ATC');
    expect(logs[0].is_cascade).toBe(false);
    expect(logs[0].logged_by).toBe(testUser.id);
  });

  test('Cascade forward: delay on inbound aircraft bleeds through to downstream flight within turnaround window', async () => {
    // Inbound flight arrives at T0 = now + 4 days
    const inDep = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    const inArr = new Date(inDep.getTime() + 2 * 3600 * 1000);

    const inRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W5-IN', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, inDep, inArr]
    );
    const inboundId = inRes.rows[0].id;

    // Downstream flight departs 30 mins after inbound arrives (slack = 30 mins, < 90 min turnaround buffer)
    const outDep = new Date(inArr.getTime() + 30 * 60_000);
    const outArr = new Date(outDep.getTime() + 2 * 3600 * 1000);

    const outRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W5-OUT', $1, $3, $2, $4, $5, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, outDep, outArr]
    );
    const downstreamId = outRes.rows[0].id;

    // Inbound delayed by 75 minutes.
    // Bleedthrough = 75 - slack(30) = 45 minutes
    const result = await logFlightDelayAndCascade({
      flightId: inboundId,
      delayMinutes: 75,
      reasonCode: 'TECH',
      notes: 'Hydraulic inspection',
      loggedBy: testUser.id,
    });

    expect(result.ok).toBe(true);
    expect(result.cascadeResults.length).toBe(1);
    expect(result.cascadeResults[0].flightId).toBe(downstreamId);
    expect(result.cascadeResults[0].bleedthroughMinutes).toBe(45);

    // Verify downstream flight was shifted by 45 minutes
    const { rows: downstreamUpdated } = await pool.query(
      'SELECT status, estimated_departure FROM flight WHERE id = $1',
      [downstreamId]
    );
    expect(downstreamUpdated[0].status).toBe('delayed');
    const expectedOutDep = new Date(outDep.getTime() + 45 * 60_000);
    const actualOutDep = new Date(downstreamUpdated[0].estimated_departure);
    expect(Math.abs(actualOutDep.getTime() - expectedOutDep.getTime())).toBeLessThan(2000);

    // Verify cascade log in delay_log
    const { rows: cascadeLogs } = await pool.query(
      'SELECT reason_code, is_cascade, caused_by_log_id FROM delay_log WHERE id = $1',
      [result.cascadeResults[0].logId]
    );
    expect(cascadeLogs[0].reason_code).toBe('LATE_INBOUND');
    expect(cascadeLogs[0].is_cascade).toBe(true);
    expect(cascadeLogs[0].caused_by_log_id).toBe(result.primaryLog.id);
  });

  test('Race safety: concurrent delay requests on the same flight serialize via FOR UPDATE', async () => {
    const depTime = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const arrTime = new Date(depTime.getTime() + 2 * 3600 * 1000);

    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival,
                           estimated_departure, estimated_arrival, status)
       VALUES ('W5-RACE', $1, $2, $3, $4, $5, $4, $5, 'scheduled')
       RETURNING id, scheduled_departure, scheduled_arrival`,
      [aircraftType, airportA, airportB, depTime, arrTime]
    );
    const raceFlightId = fRes.rows[0].id;

    // Fire 2 concurrent delay updates of 20 mins and 30 mins
    const [res1, res2] = await Promise.all([
      logFlightDelayAndCascade({
        flightId: raceFlightId,
        delayMinutes: 20,
        reasonCode: 'WX',
        loggedBy: testUser.id,
      }),
      logFlightDelayAndCascade({
        flightId: raceFlightId,
        delayMinutes: 30,
        reasonCode: 'GROUND',
        loggedBy: testUser.id,
      }),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    // Final departure time should reflect both delays (total 50 mins)
    const { rows: finalFlight } = await pool.query(
      'SELECT estimated_departure FROM flight WHERE id = $1',
      [raceFlightId]
    );
    const expectedFinalDep = new Date(depTime.getTime() + 50 * 60_000);
    const actualFinalDep = new Date(finalFlight[0].estimated_departure);
    expect(Math.abs(actualFinalDep.getTime() - expectedFinalDep.getTime())).toBeLessThan(2000);
  });

  test('Turnaround step timing: transitions record started_at and completed_at with actual_duration_seconds', async () => {
    // 1. Create a flight and a turnaround step
    const depTime = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    const arrTime = new Date(depTime.getTime() + 2 * 3600 * 1000);
    const fRes = await pool.query(
      `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                           scheduled_departure, scheduled_arrival, status)
       VALUES ('W5-TURN', $1, $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [aircraftType, airportA, airportB, depTime, arrTime]
    );
    const flightId = fRes.rows[0].id;

    const stepRes = await pool.query(
      `INSERT INTO turnaround_checklist (flight_id, step, status, est_duration)
       VALUES ($1, 'clean', 'pending', INTERVAL '25 minutes')
       RETURNING id`,
      [flightId]
    );
    const stepId = stepRes.rows[0].id;

    // 2. Mark in_progress -> started_at must be populated
    const inProg = await updateTurnaroundStepTiming(stepId, 'in_progress');
    expect(inProg).not.toBeNull();
    expect(inProg.status).toBe('in_progress');
    expect(inProg.started_at).not.toBeNull();

    // 3. Mark done -> completed_at must be populated and actual_duration_seconds computed
    const done = await updateTurnaroundStepTiming(stepId, 'done');
    expect(done).not.toBeNull();
    expect(done.status).toBe('done');
    expect(done.completed_at).not.toBeNull();
    expect(typeof done.actual_duration_seconds).toBe('number');
    expect(done.actual_duration_seconds).toBeGreaterThanOrEqual(0);
  });
});
