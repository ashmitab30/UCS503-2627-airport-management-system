/**
 * Problem 4: Connection status re-evaluation as delay grows.
 * Problem 2: hasDeparted & isCheckInAllowed unit tests for delayed flights.
 *
 * Tests the full on_track → at_risk → missed progression as a delay
 * is applied to an inbound flight, and verifies `connection:updated`
 * and `connection:status_changed` socket events are emitted to the
 * correct rooms.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index.js';
import { pool } from '../src/db/pool.js';
import { signToken } from '../src/utils/jwt.js';
import { evaluateConnectionStatus } from '../src/services/connectionService.js';
import { logFlightDelayAndCascade } from '../src/services/delayCascadeService.js';
import { hasDeparted, isCheckInAllowed } from '../src/services/flightTime.js';

const PREFIX = 'P4-CSG-';

let originId, hubId, destId, aircraftTypeId;
let testUserId;
let inboundFlight, outboundFlight;
let connectionId;

function makeMockIo() {
  const events = [];
  return {
    events,
    to(room) {
      return {
        emit(event, payload) {
          events.push({ room, event, payload });
        },
      };
    },
    emit(event, payload) {
      events.push({ room: '__broadcast__', event, payload });
    },
  };
}

beforeAll(async () => {
  const ap = await pool.query('SELECT id FROM airport ORDER BY id LIMIT 3');
  originId = ap.rows[0].id;
  hubId = ap.rows[1].id;
  destId = ap.rows[2].id;

  await pool.query('UPDATE airport SET min_connection_minutes = 60 WHERE id = $1', [hubId]);

  const actRes = await pool.query('SELECT id FROM aircraft_type LIMIT 1');
  aircraftTypeId = actRes.rows[0].id;

  const uRes = await pool.query(
    `INSERT INTO "user" (name, email, password_hash, role)
     VALUES ('P4 Passenger', '${PREFIX}p_${Date.now()}@example.com', 'dummy', 'passenger')
     RETURNING id`
  );
  testUserId = uRes.rows[0].id;

  const now = new Date();
  const inDep = new Date(now.getTime() + 2 * 3600_000).toISOString();
  const inArr = new Date(now.getTime() + 4 * 3600_000).toISOString();
  const outDep = new Date(now.getTime() + 5.5 * 3600_000).toISOString();
  const outArr = new Date(now.getTime() + 7 * 3600_000).toISOString();

  const fIn = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival, status, base_price_cents)
     VALUES ('${PREFIX}IN', $1, $2, $3, $4, $5, 'scheduled', 300000)
     RETURNING id, scheduled_departure, scheduled_arrival`,
    [aircraftTypeId, originId, hubId, inDep, inArr]
  );
  inboundFlight = fIn.rows[0];

  const fOut = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival, status, base_price_cents)
     VALUES ('${PREFIX}OUT', $1, $2, $3, $4, $5, 'scheduled', 300000)
     RETURNING id, scheduled_departure, scheduled_arrival`,
    [aircraftTypeId, hubId, destId, outDep, outArr]
  );
  outboundFlight = fOut.rows[0];

  const connRes = await pool.query(
    `INSERT INTO connection (inbound_flight_id, outbound_flight_id, passenger_id,
                             min_connection_minutes, actual_connection_minutes, status)
     VALUES ($1, $2, $3, 60, 90, 'on_track')
     RETURNING id`,
    [inboundFlight.id, outboundFlight.id, testUserId]
  );
  connectionId = connRes.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM connection WHERE id = $1', [connectionId]).catch(() => { });
  await pool.query('DELETE FROM delay_log WHERE flight_id IN ($1, $2)', [inboundFlight.id, outboundFlight.id]).catch(() => { });
  await pool.query('DELETE FROM flight WHERE flight_number LIKE $1', [`${PREFIX}%`]).catch(() => { });
  await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]).catch(() => { });
  await pool.end().catch(() => { });
});

describe('Connection status progression: on_track → at_risk → missed', () => {
  beforeEach(async () => {
    await pool.query(
      `UPDATE flight
          SET status = 'scheduled',
              estimated_departure = NULL,
              estimated_arrival   = NULL
        WHERE id = $1`,
      [inboundFlight.id]
    );
    await pool.query(
      `UPDATE connection
          SET status = 'on_track', actual_connection_minutes = 90
        WHERE id = $1`,
      [connectionId]
    );
  });

  test('initial state is on_track with ~90 min actual connection', async () => {
    const mockIo = makeMockIo();
    const result = await evaluateConnectionStatus(connectionId, { client: pool, io: mockIo });
    expect(result.status).toBe('on_track');
    expect(result.actual_connection_minutes).toBeGreaterThanOrEqual(80);
  });

  test('a 35-minute delay makes connection at_risk (< 60m MCT but >= 20m gate close) and emits connection:updated', async () => {
    const mockIo = makeMockIo();
    const newEstArr = new Date(new Date(inboundFlight.scheduled_arrival).getTime() + 35 * 60_000).toISOString();
    await pool.query(
      `UPDATE flight SET status = 'delayed', estimated_arrival = $1 WHERE id = $2`,
      [newEstArr, inboundFlight.id]
    );

    const result = await evaluateConnectionStatus(connectionId, { client: pool, io: mockIo });
    expect(result.status).toBe('at_risk');
    expect(result.actual_connection_minutes).toBeLessThan(60);
    expect(result.actual_connection_minutes).toBeGreaterThanOrEqual(20);

    const updatedEvents = mockIo.events.filter((e) => e.event === 'connection:updated');
    expect(updatedEvents.find((e) => e.room === `user:${testUserId}`)).toBeDefined();
    expect(updatedEvents.find((e) => e.room === 'role:ops_manager')).toBeDefined();
  });

  test('a 75-minute delay makes connection missed (< 20m gate close)', async () => {
    const mockIo = makeMockIo();
    const newEstArr = new Date(new Date(inboundFlight.scheduled_arrival).getTime() + 75 * 60_000).toISOString();
    await pool.query(
      `UPDATE flight SET status = 'delayed', estimated_arrival = $1 WHERE id = $2`,
      [newEstArr, inboundFlight.id]
    );

    const result = await evaluateConnectionStatus(connectionId, { client: pool, io: mockIo });
    expect(result.status).toBe('missed');
    expect(result.actual_connection_minutes).toBeLessThan(20);
  });

  test('cancelling inbound flight marks connection missed', async () => {
    const mockIo = makeMockIo();
    await pool.query(`UPDATE flight SET status = 'cancelled' WHERE id = $1`, [inboundFlight.id]);

    const result = await evaluateConnectionStatus(connectionId, { client: pool, io: mockIo });
    expect(result.status).toBe('missed');

    await pool.query(`UPDATE flight SET status = 'scheduled' WHERE id = $1`, [inboundFlight.id]);
  });

  test('POST /api/flights/:id/delay triggers connection re-evaluation and emits connection:updated to user:<passenger_id> and role:ops_manager', async () => {
    const mockIo = makeMockIo();
    const originalIo = app.get('io');
    app.set('io', mockIo);

    const opsToken = signToken({ id: testUserId, role: 'ops_manager', email: 'ops_p4@example.com' });

    try {
      const res = await request(app)
        .post(`/flights/${inboundFlight.id}/delay`)
        .set('Authorization', `Bearer ${opsToken}`)
        .send({ delay_minutes: 40, reason_code: 'ATC', notes: 'Integration test delay' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      app.set('io', originalIo);
    }

    const { rows } = await pool.query(
      'SELECT status, actual_connection_minutes FROM connection WHERE id = $1',
      [connectionId]
    );
    expect(rows[0].status).toBe('at_risk');
    expect(rows[0].actual_connection_minutes).toBeLessThan(60);

    const updatedEvents = mockIo.events.filter((e) => e.event === 'connection:updated');
    expect(updatedEvents.find((e) => e.room === `user:${testUserId}` && e.payload.status === 'at_risk')).toBeDefined();
    expect(updatedEvents.find((e) => e.room === 'role:ops_manager' && e.payload.status === 'at_risk')).toBeDefined();
  });

  test('rolled-back delay emits nothing (no connection:updated or flight:delayed)', async () => {
    const mockIo = makeMockIo();
    const realConnect = pool.connect.bind(pool);
    const connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => {
      const realClient = await realConnect();
      return {
        query: async (sql, params) => {
          if (typeof sql === 'string' && sql.trim().toUpperCase() === 'COMMIT') {
            throw new Error('Simulated commit failure');
          }
          return realClient.query(sql, params);
        },
        release: () => realClient.release(),
      };
    });

    try {
      await expect(
        logFlightDelayAndCascade({
          flightId: inboundFlight.id,
          delayMinutes: 40,
          reasonCode: 'ATC',
          loggedBy: testUserId,
          io: mockIo,
        })
      ).rejects.toThrow('Simulated commit failure');
    } finally {
      connectSpy.mockRestore();
    }

    expect(mockIo.events).toHaveLength(0);

    const { rows } = await pool.query('SELECT status FROM connection WHERE id = $1', [connectionId]);
    expect(rows[0].status).toBe('on_track');
  });
});

describe('Problem 2: hasDeparted & check-in close — delayed flight past scheduled time', () => {
  test('a delayed flight past scheduled departure but NOT past estimated is NOT departed', () => {
    const now = new Date('2026-06-01T13:00:00Z');
    const flight = {
      status: 'delayed',
      scheduled_departure: '2026-06-01T12:00:00Z',
      estimated_departure: '2026-06-01T14:00:00Z',
      actual_departure: null,
    };
    expect(hasDeparted(flight, now)).toBe(false);
  });

  test('a delayed flight past its estimated departure IS departed', () => {
    const now = new Date('2026-06-01T15:00:00Z');
    const flight = {
      status: 'delayed',
      scheduled_departure: '2026-06-01T12:00:00Z',
      estimated_departure: '2026-06-01T14:30:00Z',
      actual_departure: null,
    };
    expect(hasDeparted(flight, now)).toBe(true);
  });

  test('a boarding flight with no estimated and no actual does NOT use scheduled_departure', () => {
    const now = new Date('2026-06-01T13:00:00Z');
    const flight = {
      status: 'boarding',
      scheduled_departure: '2026-06-01T12:00:00Z',
      estimated_departure: null,
      actual_departure: null,
    };
    expect(hasDeparted(flight, now)).toBe(false);
  });

  test('isCheckInAllowed returns CHECK_IN_CLOSED when <60m to estimated departure', () => {
    const now = new Date('2026-06-01T13:00:00Z');
    const flight = {
      status: 'delayed',
      scheduled_departure: '2026-06-01T13:00:00Z',
      estimated_departure: '2026-06-01T13:45:00Z',
      actual_departure: null,
    };
    const result = isCheckInAllowed(flight, now);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CHECK_IN_CLOSED');
  });
});

