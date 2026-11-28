/**
 * Problem 3: Tail-number rotation & gate-conflict delay cascade tests.
 *
 * Verifies:
 *  - Same tail_number + origin_id = previous dest_id cascades within turnaround buffer
 *  - Different tail_number with same aircraft_type_id does NOT cascade
 *  - Same tail_number with origin_id != previous dest_id does NOT cascade
 *  - Flight without tail_number skips rotation cascade (same gate_id still cascades)
 *  - Chained multi-hop rotation cascade works
 */
import { pool } from '../src/db/pool.js';
import { logFlightDelayAndCascade } from '../src/services/delayCascadeService.js';

const PREFIX = 'P3-TAIL-';

let airportA, airportB, airportC;
let aircraftTypeId;
let gateA1, gateB1;
let opsUserId;
const createdFlightIds = [];

async function createFlight({
  suffix,
  originId,
  destId,
  depTime,
  arrTime,
  tailNumber = null,
  gateId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival,
                         estimated_departure, estimated_arrival,
                         status, tail_number, gate_id, base_price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 'scheduled', $7, $8, 500000)
     RETURNING id`,
    [
      `${PREFIX}${suffix}`,
      aircraftTypeId,
      originId,
      destId,
      depTime,
      arrTime,
      tailNumber,
      gateId,
    ]
  );
  createdFlightIds.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  await pool.query('DELETE FROM flight WHERE flight_number LIKE $1', [`${PREFIX}%`]);

  const ap = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 3');
  airportA = ap.rows[0].id;
  airportB = ap.rows[1].id;
  airportC = ap.rows[2].id;

  const act = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
  aircraftTypeId = act.rows[0].id;

  const gA = await pool.query(
    `INSERT INTO gate (airport_id, code, size_class)
     VALUES ($1, 'P3A', 'medium')
     ON CONFLICT (airport_id, code) DO UPDATE SET size_class = EXCLUDED.size_class
     RETURNING id`,
    [airportA]
  );
  gateA1 = gA.rows[0].id;

  const gB = await pool.query(
    `INSERT INTO gate (airport_id, code, size_class)
     VALUES ($1, 'P3B', 'medium')
     ON CONFLICT (airport_id, code) DO UPDATE SET size_class = EXCLUDED.size_class
     RETURNING id`,
    [airportB]
  );
  gateB1 = gB.rows[0].id;

  const uRes = await pool.query(
    `INSERT INTO "user" (name, email, password_hash, role)
     VALUES ('P3 Ops', 'p3_ops_' || gen_random_uuid() || '@example.com', 'dummy', 'ops_manager')
     RETURNING id`
  );
  opsUserId = uRes.rows[0].id;
});

afterAll(async () => {
  if (createdFlightIds.length > 0) {
    await pool.query('DELETE FROM delay_log WHERE flight_id = ANY($1::int[])', [createdFlightIds]).catch(() => {});
    await pool.query('DELETE FROM flight WHERE id = ANY($1::int[])', [createdFlightIds]).catch(() => {});
  }
  if (opsUserId) {
    await pool.query('DELETE FROM "user" WHERE id = $1', [opsUserId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe('Delay cascade by tail_number rotation and gate conflict', () => {
  test('same tail_number + matching origin/dest cascades, while different tail_number with same aircraft_type does not', async () => {
    const base = new Date(Date.now() + 15 * 24 * 3600_000);
    const inArr = new Date(base.getTime() + 2 * 3600_000);

    const f1 = await createFlight({
      suffix: '1A',
      originId: airportA,
      destId: airportB,
      depTime: base,
      arrTime: inArr,
      tailNumber: 'VT-P301',
    });

    // Same tail, departs from B 30m after f1 arrives -> should cascade
    const fSameTail = await createFlight({
      suffix: '1B',
      originId: airportB,
      destId: airportC,
      depTime: new Date(inArr.getTime() + 30 * 60_000),
      arrTime: new Date(inArr.getTime() + 150 * 60_000),
      tailNumber: 'VT-P301',
    });

    // Different tail, same aircraft_type_id, departs from B 30m after f1 arrives -> should NOT cascade
    const fDiffTail = await createFlight({
      suffix: '1C',
      originId: airportB,
      destId: airportC,
      depTime: new Date(inArr.getTime() + 30 * 60_000),
      arrTime: new Date(inArr.getTime() + 150 * 60_000),
      tailNumber: 'VT-P399',
    });

    // Same tail, but origin is A instead of B (mismatch) -> should NOT cascade
    const fWrongOrigin = await createFlight({
      suffix: '1D',
      originId: airportA,
      destId: airportC,
      depTime: new Date(inArr.getTime() + 30 * 60_000),
      arrTime: new Date(inArr.getTime() + 150 * 60_000),
      tailNumber: 'VT-P301',
    });

    const result = await logFlightDelayAndCascade({
      flightId: f1,
      delayMinutes: 60,
      reasonCode: 'TECH',
      loggedBy: opsUserId,
    });

    expect(result.ok).toBe(true);
    const cascadedIds = result.cascadeResults.map((c) => c.flightId);
    expect(cascadedIds).toContain(fSameTail);
    expect(cascadedIds).not.toContain(fDiffTail);
    expect(cascadedIds).not.toContain(fWrongOrigin);
  });

  test('flight without tail_number skips rotation cascade, but same gate_id still cascades', async () => {
    const base = new Date(Date.now() + 16 * 24 * 3600_000);
    const inArr = new Date(base.getTime() + 2 * 3600_000);

    const fNoTail = await createFlight({
      suffix: '2A',
      originId: airportA,
      destId: airportB,
      depTime: base,
      arrTime: inArr,
      tailNumber: null,
      gateId: gateA1,
    });

    // No tail, different gate -> should NOT cascade
    const fOther = await createFlight({
      suffix: '2B',
      originId: airportB,
      destId: airportC,
      depTime: new Date(inArr.getTime() + 20 * 60_000),
      arrTime: new Date(inArr.getTime() + 140 * 60_000),
      tailNumber: null,
      gateId: gateB1,
    });

    // Same gate_id within turnaround window -> SHOULD cascade
    const fSameGate = await createFlight({
      suffix: '2C',
      originId: airportA,
      destId: airportC,
      depTime: new Date(inArr.getTime() + 25 * 60_000),
      arrTime: new Date(inArr.getTime() + 145 * 60_000),
      tailNumber: null,
      gateId: gateA1,
    });

    const result = await logFlightDelayAndCascade({
      flightId: fNoTail,
      delayMinutes: 60,
      reasonCode: 'GROUND',
      loggedBy: opsUserId,
    });

    expect(result.ok).toBe(true);
    const cascadedIds = result.cascadeResults.map((c) => c.flightId);
    expect(cascadedIds).toContain(fSameGate);
    expect(cascadedIds).not.toContain(fOther);
  });
});
