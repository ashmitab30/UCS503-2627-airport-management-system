// One-off seed script: creates enough reference data (airports,
// aircraft types, gates) to actually demo flight creation, gate
// conflict detection, and resource assignment. Run once against a
// fresh database: `node scripts/seed.js`. Safe to re-run — it checks
// for existing rows by unique code/model before inserting.
import { pool } from '../src/db/pool.js';

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

  // Deliberately mixed gate sizes at DEL so gateCanHost() and the
  // auto-suggest heuristic actually have something to choose between
  // during the Week 3 demo.
  for (const [code, size] of [['A1', 'small'], ['A2', 'medium'], ['A3', 'medium'], ['B1', 'large']]) {
    const id = await upsertGate(del, code, size);
    console.log(`Gate DEL/${code} (${size}) = ${id}`);
  }
  for (const [code, size] of [['C1', 'medium'], ['C2', 'large']]) {
    const id = await upsertGate(bom, code, size);
    console.log(`Gate BOM/${code} (${size}) = ${id}`);
  }

  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
