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

  // Enforce realistic Minimum Connection Times per airport (BOM 45, DEL 60, BLR 40)
  await pool.query("UPDATE airport SET min_connection_minutes = 45 WHERE code = 'BOM'");
  await pool.query("UPDATE airport SET min_connection_minutes = 60 WHERE code = 'DEL'");
  await pool.query("UPDATE airport SET min_connection_minutes = 40 WHERE code = 'BLR'");

  console.log(`Airports: DEL=${del} (MCT 60m), BOM=${bom} (MCT 45m), BLR=${blr} (MCT 40m)`);

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

  // Seed 2 alternative flights from BOM -> BLR for rebooking options
  const depTime3 = new Date(now.getTime() + 10 * 3600_000).toISOString();
  const arrTime3 = new Date(now.getTime() + 12 * 3600_000).toISOString();
  const f3 = await upsertSampleFlight({
    flightNumber: 'AI-504',
    aircraftTypeId: a320,
    originId: bom,
    destId: blr,
    scheduledDeparture: depTime3,
    scheduledArrival: arrTime3,
    gateId: gateBomC2,
    basePriceCents: 5200,
    sizeClass: 'medium',
  });
  console.log(`Sample Rebooking Flight AI-504 (BOM -> BLR) = ${f3}`);

  const depTime4 = new Date(now.getTime() + 12 * 3600_000).toISOString();
  const arrTime4 = new Date(now.getTime() + 14 * 3600_000).toISOString();
  const f4 = await upsertSampleFlight({
    flightNumber: '6E-606',
    aircraftTypeId: atr72,
    originId: bom,
    destId: blr,
    scheduledDeparture: depTime4,
    scheduledArrival: arrTime4,
    gateId: gateBomC1,
    basePriceCents: 4900,
    sizeClass: 'small',
  });
  console.log(`Sample Rebooking Flight 6E-606 (BOM -> BLR) = ${f4}`);

  // Seed sample connecting itinerary if a passenger user exists
  const userRes = await pool.query('SELECT id FROM "user" WHERE role = \'passenger\' ORDER BY id LIMIT 1');
  if (userRes.rows.length > 0) {
    const passengerId = userRes.rows[0].id;
    const existingConn = await pool.query(
      'SELECT id FROM connection WHERE inbound_flight_id = $1 AND outbound_flight_id = $2 AND passenger_id = $3',
      [f1, f2, passengerId]
    );

    if (existingConn.rows.length === 0) {
      // Find or assign seat for Inbound
      const seatIn = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [f1]);
      let bInId = null;
      if (seatIn.rows.length > 0) {
        await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatIn.rows[0].id]);
        const bIn = await pool.query(
          `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
           VALUES ('BK-IN101', $1, $1, $2, $3, 'confirmed', 6500)
           ON CONFLICT (booking_ref) DO UPDATE SET status = 'confirmed'
           RETURNING id`,
          [passengerId, f1, seatIn.rows[0].id]
        );
        bInId = bIn.rows[0]?.id;
      }

      // Find or assign seat for Outbound
      const seatOut = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [f2]);
      let bOutId = null;
      if (seatOut.rows.length > 0) {
        await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatOut.rows[0].id]);
        const bOut = await pool.query(
          `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
           VALUES ('BK-OUT202', $1, $1, $2, $3, 'confirmed', 4800)
           ON CONFLICT (booking_ref) DO UPDATE SET status = 'confirmed'
           RETURNING id`,
          [passengerId, f2, seatOut.rows[0].id]
        );
        bOutId = bOut.rows[0]?.id;
      }

      // Set inbound flight estimated arrival to leave 32 mins layover at BOM (45m MCT -> at_risk)
      const f2Dep = new Date(depTime2).getTime();
      const delayMinutes = 38;
      const delayedInArr = new Date(f2Dep - 32 * 60_000);
      await pool.query(
        "UPDATE flight SET estimated_arrival = $1, status = 'delayed' WHERE id = $2",
        [delayedInArr.toISOString(), f1]
      );

      // Insert delay log
      await pool.query(
        `INSERT INTO delay_log (flight_id, minutes, delay_minutes, reason_code, logged_at, logged_by, "timestamp")
         VALUES ($1, $2, $2, 'ATC', now(), $3, now())`,
        [f1, delayMinutes, passengerId]
      ).catch((e) => console.warn('Delay log seed note:', e.message));

      // Insert connection
      await pool.query(
        `INSERT INTO connection (inbound_flight_id, outbound_flight_id, passenger_id,
                                 min_connection_minutes, actual_connection_minutes, status,
                                 inbound_booking_id, outbound_booking_id)
         VALUES ($1, $2, $3, 45, 32, 'at_risk', $4, $5)`,
        [f1, f2, passengerId, bInId, bOutId]
      );
      console.log(`Sample Connecting Itinerary (DEL -> BOM -> BLR, At Risk 32m vs 45m MCT) created for passenger ${passengerId}`);
    }
  }

  console.log('Seed complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
