// Seed script: creates reference data (airports, aircraft types, gates, sample flights, and seats).
// Safe to re-run — checks for existing rows by unique code/flight_number before inserting.
import { pool } from '../src/db/pool.js';
import { generateSeatsForFlight } from '../src/services/seatService.js';
import { initTurnaroundChecklist } from '../src/services/turnaround.js';

async function upsertAirport(name, code, timezone) {
  const existing = await pool.query('SELECT id FROM airport WHERE code = $1', [code]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const { rows } = await pool.query(
    'INSERT INTO airport (name, code, timezone) VALUES ($1, $2, $3) RETURNING id',
    [name, code, timezone]
  );
  return rows[0].id;
}

async function upsertAircraftType(model, capacity, sizeClass) {
  const existing = await pool.query('SELECT id FROM aircraft_type WHERE model = $1', [model]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const { rows } = await pool.query(
    'INSERT INTO aircraft_type (model, capacity, size_class) VALUES ($1, $2, $3) RETURNING id',
    [model, capacity, sizeClass]
  );
  return rows[0].id;
}

async function upsertGate(airportId, code, sizeClass) {
  const existing = await pool.query('SELECT id FROM gate WHERE airport_id = $1 AND code = $2', [airportId, code]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const { rows } = await pool.query(
    'INSERT INTO gate (airport_id, code, size_class) VALUES ($1, $2, $3) RETURNING id',
    [airportId, code, sizeClass]
  );
  return rows[0].id;
}

async function upsertSampleFlight({
  flightNumber,
  aircraftTypeId,
  originId,
  destId,
  scheduledDeparture,
  scheduledArrival,
  gateId,
  basePriceCents,
  sizeClass,
}) {
  const existing = await pool.query('SELECT id FROM flight WHERE flight_number = $1', [flightNumber]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const { rows } = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8)
     RETURNING id`,
    [
      flightNumber,
      aircraftTypeId,
      originId,
      destId,
      scheduledDeparture,
      scheduledArrival,
      gateId,
      basePriceCents,
    ]
  );
  const flightId = rows[0].id;
  await initTurnaroundChecklist(flightId, sizeClass, pool);
  await generateSeatsForFlight(flightId, aircraftTypeId, pool);
  return flightId;
}

async function main() {
  console.log('Seeding reference data...');

  const del = await upsertAirport('Indira Gandhi International Airport', 'DEL', 'Asia/Kolkata');
  const bom = await upsertAirport('Chhatrapati Shivaji Maharaj International Airport', 'BOM', 'Asia/Kolkata');
  const blr = await upsertAirport('Kempegowda International Airport', 'BLR', 'Asia/Kolkata');
  console.log(`Airports: DEL=${del}, BOM=${bom}, BLR=${blr}`);

  const a320 = await upsertAircraftType('Airbus A320', 180, 'medium');
  const atr72 = await upsertAircraftType('ATR 72', 78, 'small');
  const b777 = await upsertAircraftType('Boeing 777', 396, 'large');
  console.log(`Aircraft types: A320=${a320}, ATR72=${atr72}, B777=${b777}`);

  const gateDelA1 = await upsertGate(del, 'A1', 'small');
  const gateDelA2 = await upsertGate(del, 'A2', 'medium');
  const gateDelA3 = await upsertGate(del, 'A3', 'medium');
  const gateDelB1 = await upsertGate(del, 'B1', 'large');
  const gateBomC1 = await upsertGate(bom, 'C1', 'medium');
  const gateBomC2 = await upsertGate(bom, 'C2', 'large');

  // Seed sample demonstration flights for today
  const now = new Date();
  const depTime1 = new Date(now.getTime() + 4 * 3600_000).toISOString();
  const arrTime1 = new Date(now.getTime() + 6 * 3600_000).toISOString();
  const f1 = await upsertSampleFlight({
    flightNumber: 'AI-101',
    aircraftTypeId: a320,
    originId: del,
    destId: bom,
    scheduledDeparture: depTime1,
    scheduledArrival: arrTime1,
    gateId: gateDelA2,
    basePriceCents: 6500,
    sizeClass: 'medium',
  });
  console.log(`Sample Flight AI-101 (DEL -> BOM) = ${f1}`);

  const depTime2 = new Date(now.getTime() + 8 * 3600_000).toISOString();
  const arrTime2 = new Date(now.getTime() + 10 * 3600_000).toISOString();
  const f2 = await upsertSampleFlight({
    flightNumber: '6E-202',
    aircraftTypeId: atr72,
    originId: bom,
    destId: blr,
    scheduledDeparture: depTime2,
    scheduledArrival: arrTime2,
    gateId: gateBomC1,
    basePriceCents: 4800,
    sizeClass: 'small',
  });
  console.log(`Sample Flight 6E-202 (BOM -> BLR) = ${f2}`);

  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
