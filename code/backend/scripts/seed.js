// Seed script: creates reference data (airports, aircraft types, gates, sample flights, and seats).
// Safe to re-run — updates scheduled times on seed-owned flights so dates stay fresh relative to today.
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/pool.js';
import { generateSeatsForFlight } from '../src/services/seatService.js';
import { initTurnaroundChecklist } from '../src/services/turnaround.js';
import { hashPassword } from '../src/utils/password.js';

async function upsertDemoPayment(bookingId, amountRupees, status = 'success') {
  if (!bookingId) return;
  const existingPay = await pool.query('SELECT id FROM payment WHERE booking_id = $1', [bookingId]);
  if (existingPay.rows.length > 0) {
    await pool.query(
      'UPDATE payment SET amount = $1, status = $2, method = $3 WHERE booking_id = $4',
      [amountRupees, status, 'mock_card', bookingId]
    );
  } else {
    await pool.query(
      'INSERT INTO payment (booking_id, amount, status, method) VALUES ($1, $2, $3, $4)',
      [bookingId, amountRupees, status, 'mock_card']
    );
  }
}

async function upsertAirport(name, code, timezone, city = null, minConnectionMinutes = 45) {
  const existing = await pool.query('SELECT id FROM airport WHERE code = $1', [code]);
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE airport
       SET name = $1, timezone = $2,
           city = COALESCE($3, city),
           min_connection_minutes = COALESCE($4, min_connection_minutes)
       WHERE id = $5`,
      [name, timezone, city, minConnectionMinutes, id]
    );
    return id;
  }
  const { rows } = await pool.query(
    'INSERT INTO airport (name, code, timezone, city, min_connection_minutes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, code, timezone, city, minConnectionMinutes]
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
  status = 'scheduled',
  actualDeparture = null,
  actualArrival = null,
}) {
  const existing = await pool.query('SELECT id FROM flight WHERE flight_number = $1', [flightNumber]);
  if (existing.rows.length > 0) {
    const flightId = existing.rows[0].id;
    await pool.query(
      `UPDATE flight
       SET aircraft_type_id = $1, origin_id = $2, dest_id = $3,
           scheduled_departure = $4, scheduled_arrival = $5, gate_id = $6,
           status = $7, base_price_cents = $8, actual_departure = $9, actual_arrival = $10
       WHERE id = $11`,
      [
        aircraftTypeId,
        originId,
        destId,
        scheduledDeparture,
        scheduledArrival,
        gateId,
        status,
        basePriceCents,
        actualDeparture,
        actualArrival,
        flightId,
      ]
    );
    await initTurnaroundChecklist(flightId, sizeClass, pool);
    await generateSeatsForFlight(flightId, aircraftTypeId, pool);
    // If seat table has price_cents column, update unbooked seats
    try {
      await pool.query(
        `UPDATE seat s
         SET price_cents = ROUND($1 * CASE
           WHEN s.class = 'premium_economy' THEN 1.4
           WHEN s.class = 'business' THEN 2.2
           WHEN s.class = 'first' THEN 3.5
           ELSE 1.0
         END)
         WHERE s.flight_id = $2 AND s.is_booked = false`,
        [basePriceCents, flightId]
      );
    } catch {
      // Column may not exist on seat table
    }
    return flightId;
  }

  const { rows } = await pool.query(
    `INSERT INTO flight (flight_number, aircraft_type_id, origin_id, dest_id,
                         scheduled_departure, scheduled_arrival, gate_id, status, base_price_cents,
                         actual_departure, actual_arrival)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      flightNumber,
      aircraftTypeId,
      originId,
      destId,
      scheduledDeparture,
      scheduledArrival,
      gateId,
      status,
      basePriceCents,
      actualDeparture,
      actualArrival,
    ]
  );
  const flightId = rows[0].id;
  await initTurnaroundChecklist(flightId, sizeClass, pool);
  await generateSeatsForFlight(flightId, aircraftTypeId, pool);
  try {
    await pool.query(
      `UPDATE seat s
       SET price_cents = ROUND($1 * CASE
         WHEN s.class = 'premium_economy' THEN 1.4
         WHEN s.class = 'business' THEN 2.2
         WHEN s.class = 'first' THEN 3.5
         ELSE 1.0
       END)
       WHERE s.flight_id = $2 AND s.is_booked = false`,
      [basePriceCents, flightId]
    );
  } catch {
    // Column may not exist on seat table
  }
  return flightId;
}

export async function runSeed({ endPool = true, force = false } = {}) {
  const isForce = force || process.argv.includes('--force');
  if (process.env.NODE_ENV === 'production' && !isForce) {
    const errorMsg = 'Refusing to run seed script in production without --force';
    console.error(`FATAL: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log('Seeding reference data...');

  // 1. Remove bad demo data (such as a flight named just "7")
  await pool.query("DELETE FROM flight WHERE flight_number = '7'");

  const del = await upsertAirport('Indira Gandhi International Airport', 'DEL', 'Asia/Kolkata', 'Delhi', 60);
  const bom = await upsertAirport('Chhatrapati Shivaji Maharaj International Airport', 'BOM', 'Asia/Kolkata', 'Mumbai', 45);
  const blr = await upsertAirport('Kempegowda International Airport', 'BLR', 'Asia/Kolkata', 'Bengaluru', 40);

  // 8 additional real Indian airports (Task 3)
  const maa = await upsertAirport('Chennai International Airport', 'MAA', 'Asia/Kolkata', 'Chennai', 45);
  const hyd = await upsertAirport('Rajiv Gandhi International Airport', 'HYD', 'Asia/Kolkata', 'Hyderabad', 45);
  const ccu = await upsertAirport('Netaji Subhash Chandra Bose International Airport', 'CCU', 'Asia/Kolkata', 'Kolkata', 45);
  const goi = await upsertAirport('Dabolim Airport', 'GOI', 'Asia/Kolkata', 'Goa', 35);
  const amd = await upsertAirport('Sardar Vallabhbhai Patel International Airport', 'AMD', 'Asia/Kolkata', 'Ahmedabad', 40);
  const pnq = await upsertAirport('Pune Airport', 'PNQ', 'Asia/Kolkata', 'Pune', 35);
  const cok = await upsertAirport('Cochin International Airport', 'COK', 'Asia/Kolkata', 'Kochi', 40);
  const jai = await upsertAirport('Jaipur International Airport', 'JAI', 'Asia/Kolkata', 'Jaipur', 35);

  console.log(`Airports seeded: DEL, BOM, BLR, MAA, HYD, CCU, GOI, AMD, PNQ, COK, JAI`);

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
  const gateBlrD1 = await upsertGate(blr, 'D1', 'medium');
  const gateMaa1 = await upsertGate(maa, 'M1', 'medium');
  const gateHyd1 = await upsertGate(hyd, 'H1', 'medium');
  const gateCcu1 = await upsertGate(ccu, 'K1', 'medium');
  const gateGoi1 = await upsertGate(goi, 'G1', 'medium');
  const gateAmd1 = await upsertGate(amd, 'A1', 'medium');
  const gatePnq1 = await upsertGate(pnq, 'P1', 'medium');
  const gateCok1 = await upsertGate(cok, 'C1', 'medium');
  const gateJai1 = await upsertGate(jai, 'J1', 'medium');

  // Seed realistic resources per airport for all seeded airports (Task 4)
  async function ensureAirportResources(airportId) {
    const targets = [
      { type: 'fuel_truck', count: 2 },
      { type: 'baggage_cart', count: 2 },
      { type: 'crew', count: 1 },
      { type: 'catering_truck', count: 1 },
      { type: 'pushback_tug', count: 1 },
    ];

    for (const t of targets) {
      const existing = await pool.query(
        'SELECT count(*)::int AS count FROM resource WHERE airport_id = $1 AND type = $2',
        [airportId, t.type]
      );
      const currentCount = existing.rows[0].count;
      const needed = t.count - currentCount;
      for (let i = 0; i < needed; i++) {
        await pool.query(
          'INSERT INTO resource (airport_id, type, status) VALUES ($1, $2, $3)',
          [airportId, t.type, 'available']
        );
      }
    }
  }

  const allAirports = [del, bom, blr, maa, hyd, ccu, goi, amd, pnq, cok, jai];
  for (const apId of allAirports) {
    await ensureAirportResources(apId);
  }
  console.log(`Resources seeded for all ${allAirports.length} airports (2 fuel_truck, 2 baggage_cart, 1 crew, 1 catering_truck, 1 pushback_tug each)`);

  const now = new Date();

  // ── 2. UPCOMING FLIGHTS (+3 hours to +21 days) ─────────────────────────────
  // Connecting itinerary primary legs (AI-101 and 6E-202) + rebooking options (AI-504, 6E-606)
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
    basePriceCents: 650000,
    sizeClass: 'medium',
    tailNumber: 'VT-SEA',
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
    basePriceCents: 480000,
    sizeClass: 'small',
    tailNumber: 'VT-MUM',
  });
  console.log(`Sample Flight 6E-202 (BOM -> BLR) = ${f2}`);

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
    basePriceCents: 600000,
    sizeClass: 'medium',
    tailNumber: 'VT-SEA',
  });
  console.log(`Sample Rebooking Flight AI-504 (BOM -> BLR, higher fare +₹1,200) = ${f3}`);

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
    basePriceCents: 400000,
    sizeClass: 'small',
    tailNumber: 'VT-BOM',
  });
  console.log(`Sample Rebooking Flight 6E-606 (BOM -> BLR, lower fare -₹800) = ${f4}`);

  // Additional upcoming flights across route combinations (departures relative to today)
  const f5 = await upsertSampleFlight({
    flightNumber: 'AI-205',
    aircraftTypeId: a320,
    originId: del,
    destId: blr,
    scheduledDeparture: new Date(now.getTime() + 26 * 3600_000).toISOString(), // +26h: outside 24h check-in window
    scheduledArrival: new Date(now.getTime() + 29 * 3600_000).toISOString(),
    gateId: gateDelA3,
    basePriceCents: 720000,
    sizeClass: 'medium',
    tailNumber: 'VT-IND',
  });

  const f6 = await upsertSampleFlight({
    flightNumber: '6E-303',
    aircraftTypeId: atr72,
    originId: blr,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 3 * 24 * 3600_000).toISOString(), // +3 days
    scheduledArrival: new Date(now.getTime() + 3 * 24 * 3600_000 + 3 * 3600_000).toISOString(),
    gateId: gateBlrD1,
    basePriceCents: 590000,
    sizeClass: 'small',
    tailNumber: 'VT-MUM',
  });

  const f7 = await upsertSampleFlight({
    flightNumber: 'AI-407',
    aircraftTypeId: b777,
    originId: bom,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(), // +7 days
    scheduledArrival: new Date(now.getTime() + 7 * 24 * 3600_000 + 2 * 3600_000).toISOString(),
    gateId: gateBomC2,
    basePriceCents: 850000,
    sizeClass: 'large',
    tailNumber: 'VT-B77',
  });

  const f8 = await upsertSampleFlight({
    flightNumber: '6E-512',
    aircraftTypeId: a320,
    originId: blr,
    destId: bom,
    scheduledDeparture: new Date(now.getTime() + 14 * 24 * 3600_000).toISOString(), // +14 days
    scheduledArrival: new Date(now.getTime() + 14 * 24 * 3600_000 + 1.5 * 3600_000).toISOString(),
    gateId: gateBlrD1,
    basePriceCents: 440000,
    sizeClass: 'medium',
    tailNumber: 'VT-SEA',
  });

  const f9 = await upsertSampleFlight({
    flightNumber: 'AI-618',
    aircraftTypeId: b777,
    originId: del,
    destId: bom,
    scheduledDeparture: new Date(now.getTime() + 21 * 24 * 3600_000).toISOString(), // +21 days
    scheduledArrival: new Date(now.getTime() + 21 * 24 * 3600_000 + 2.2 * 3600_000).toISOString(),
    gateId: gateDelB1,
    basePriceCents: 890000,
    sizeClass: 'large',
    tailNumber: 'VT-B77',
  });

  console.log(`Additional Upcoming Flights: AI-205=${f5}, 6E-303=${f6}, AI-407=${f7}, 6E-512=${f8}, AI-618=${f9}`);

  // ── 2b. UPCOMING FLIGHTS CONNECTING NEW AIRPORTS (₹3,000 to ₹9,000) ────────
  const fDelIn = await upsertSampleFlight({
    flightNumber: 'AI-211',
    aircraftTypeId: a320,
    originId: bom,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 2 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 4 * 3600_000).toISOString(),
    gateId: gateBomC2,
    basePriceCents: 540000,
    sizeClass: 'medium',
    tailNumber: 'VT-DEL',
  });

  const fDelOut = await upsertSampleFlight({
    flightNumber: '6E-711',
    aircraftTypeId: a320,
    originId: del,
    destId: maa,
    scheduledDeparture: new Date(now.getTime() + 5.5 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 8.5 * 3600_000).toISOString(),
    gateId: gateDelA2,
    basePriceCents: 550000,
    sizeClass: 'medium',
    tailNumber: 'VT-DEL',
  });

  const fBlrIn = await upsertSampleFlight({
    flightNumber: '6E-315',
    aircraftTypeId: a320,
    originId: del,
    destId: blr,
    scheduledDeparture: new Date(now.getTime() + 3 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 5.5 * 3600_000).toISOString(),
    gateId: gateDelA1,
    basePriceCents: 680000,
    sizeClass: 'medium',
    tailNumber: 'VT-BLR',
  });

  const fBlrOut = await upsertSampleFlight({
    flightNumber: '6E-318',
    aircraftTypeId: atr72,
    originId: blr,
    destId: goi,
    scheduledDeparture: new Date(now.getTime() + 6.5 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 7.5 * 3600_000).toISOString(),
    gateId: gateBlrD1,
    basePriceCents: 390000,
    sizeClass: 'small',
    tailNumber: 'VT-GOI',
  });

  await upsertSampleFlight({
    flightNumber: 'AI-722',
    aircraftTypeId: a320,
    originId: maa,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 16 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 19 * 3600_000).toISOString(),
    gateId: gateMaa1,
    basePriceCents: 580000,
    sizeClass: 'medium',
    tailNumber: 'VT-DEL',
  });

  await upsertSampleFlight({
    flightNumber: '6E-833',
    aircraftTypeId: atr72,
    originId: bom,
    destId: hyd,
    scheduledDeparture: new Date(now.getTime() + 7 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 8.5 * 3600_000).toISOString(),
    gateId: gateBomC1,
    basePriceCents: 380000,
    sizeClass: 'small',
  });

  await upsertSampleFlight({
    flightNumber: 'AI-844',
    aircraftTypeId: a320,
    originId: hyd,
    destId: ccu,
    scheduledDeparture: new Date(now.getTime() + 18 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 20.5 * 3600_000).toISOString(),
    gateId: gateHyd1,
    basePriceCents: 460000,
    sizeClass: 'medium',
  });

  await upsertSampleFlight({
    flightNumber: '6E-955',
    aircraftTypeId: a320,
    originId: ccu,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 2 * 24 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 2 * 24 * 3600_000 + 2.5 * 3600_000).toISOString(),
    gateId: gateCcu1,
    basePriceCents: 620000,
    sizeClass: 'medium',
  });

  await upsertSampleFlight({
    flightNumber: 'AI-966',
    aircraftTypeId: a320,
    originId: del,
    destId: goi,
    scheduledDeparture: new Date(now.getTime() + 4 * 24 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 4 * 24 * 3600_000 + 2.5 * 3600_000).toISOString(),
    gateId: gateDelA3,
    basePriceCents: 690000,
    sizeClass: 'medium',
  });

  await upsertSampleFlight({
    flightNumber: '6E-177',
    aircraftTypeId: atr72,
    originId: blr,
    destId: cok,
    scheduledDeparture: new Date(now.getTime() + 6 * 24 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 6 * 24 * 3600_000 + 1 * 3600_000).toISOString(),
    gateId: gateBlrD1,
    basePriceCents: 320000,
    sizeClass: 'small',
  });

  await upsertSampleFlight({
    flightNumber: 'AI-288',
    aircraftTypeId: atr72,
    originId: amd,
    destId: jai,
    scheduledDeparture: new Date(now.getTime() + 8 * 24 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 8 * 24 * 3600_000 + 1.2 * 3600_000).toISOString(),
    gateId: gateAmd1,
    basePriceCents: 350000,
    sizeClass: 'small',
  });

  await upsertSampleFlight({
    flightNumber: '6E-399',
    aircraftTypeId: a320,
    originId: pnq,
    destId: del,
    scheduledDeparture: new Date(now.getTime() + 10 * 24 * 3600_000).toISOString(),
    scheduledArrival: new Date(now.getTime() + 10 * 24 * 3600_000 + 2 * 3600_000).toISOString(),
    gateId: gatePnq1,
    basePriceCents: 480000,
    sizeClass: 'medium',
  });

  // Connectable upcoming flights for "Link as connection" demo (DEL -> BOM and BOM -> CCU)
  const linkDep1 = new Date(now.getTime() + 48 * 3600_000).toISOString(); // +2 days
  const linkArr1 = new Date(now.getTime() + 50.25 * 3600_000).toISOString(); // +2h 15m duration
  const fLinkIn = await upsertSampleFlight({
    flightNumber: 'AI-821',
    aircraftTypeId: a320,
    originId: del,
    destId: bom,
    scheduledDeparture: linkDep1,
    scheduledArrival: linkArr1,
    gateId: gateDelA2,
    basePriceCents: 550000,
    sizeClass: 'medium',
    tailNumber: 'VT-CCU',
  });

  const linkDep2 = new Date(now.getTime() + 52.5 * 3600_000).toISOString(); // 2h 15m layover at BOM (> 45m MCT)
  const linkArr2 = new Date(now.getTime() + 55 * 3600_000).toISOString();
  const fLinkOut = await upsertSampleFlight({
    flightNumber: '6E-822',
    aircraftTypeId: a320,
    originId: bom,
    destId: ccu,
    scheduledDeparture: linkDep2,
    scheduledArrival: linkArr2,
    gateId: gateBomC1,
    basePriceCents: 620000,
    sizeClass: 'medium',
    tailNumber: 'VT-CCU',
  });
  console.log(`Connectable Demo Flights: AI-821 (DEL -> BOM) = ${fLinkIn}, 6E-822 (BOM -> CCU) = ${fLinkOut}`);

  // ── 3. PAST FLIGHTS (for Past tab verification) ───────────────────────────
  const pastDep1 = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const pastArr1 = new Date(now.getTime() - 46 * 3600_000).toISOString();
  const pastF1 = await upsertSampleFlight({
    flightNumber: 'AI-109',
    aircraftTypeId: a320,
    originId: del,
    destId: bom,
    scheduledDeparture: pastDep1,
    scheduledArrival: pastArr1,
    gateId: gateDelA1,
    basePriceCents: 620000,
    sizeClass: 'medium',
    status: 'landed',
    actualDeparture: pastDep1,
    actualArrival: pastArr1,
  });

  const pastDep2 = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const pastArr2 = new Date(now.getTime() - 22 * 3600_000).toISOString();
  const pastF2 = await upsertSampleFlight({
    flightNumber: '6E-215',
    aircraftTypeId: atr72,
    originId: bom,
    destId: blr,
    scheduledDeparture: pastDep2,
    scheduledArrival: pastArr2,
    gateId: gateBomC1,
    basePriceCents: 460000,
    sizeClass: 'small',
    status: 'landed',
    actualDeparture: pastDep2,
    actualArrival: pastArr2,
  });

  const pastDep3 = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const pastArr3 = new Date(now.getTime() - 4 * 3600_000).toISOString();
  const pastF3 = await upsertSampleFlight({
    flightNumber: 'AI-301',
    aircraftTypeId: b777,
    originId: blr,
    destId: del,
    scheduledDeparture: pastDep3,
    scheduledArrival: pastArr3,
    gateId: gateBlrD1,
    basePriceCents: 790000,
    sizeClass: 'large',
    status: 'landed',
    actualDeparture: pastDep3,
    actualArrival: pastArr3,
  });

  console.log(`Past Flights: AI-109=${pastF1}, 6E-215=${pastF2}, AI-301=${pastF3}`);

  // ── 4. SEED PASSENGER BOOKINGS & CONNECTIONS ──────────────────────────────
  // Ensure dedicated demo passenger account with known credentials exists
  const demoEmail = 'passenger@meridian.com';
  const demoPassword = 'passenger123';
  const demoHash = await hashPassword(demoPassword);
  let userRes = await pool.query('SELECT id, name, email FROM "user" WHERE email = $1', [demoEmail]);
  let userId, userName;
  if (userRes.rows.length === 0) {
    const newUser = await pool.query(
      `INSERT INTO "user" (name, email, password_hash, role)
       VALUES ('Priya Sharma', $1, $2, 'passenger')
       RETURNING id, name, email`,
      [demoEmail, demoHash]
    );
    userId = newUser.rows[0].id;
    userName = newUser.rows[0].name;
  } else {
    userId = userRes.rows[0].id;
    userName = userRes.rows[0].name;
    await pool.query('UPDATE "user" SET password_hash = $1 WHERE id = $2', [demoHash, userId]);
  }

  // Ensure matching passenger table row exists for foreign key constraint
  let pRes = await pool.query('SELECT id FROM passenger WHERE email = $1', [demoEmail]);
  let passengerRecordId;
  if (pRes.rows.length === 0) {
    const pInsert = await pool.query(
      'INSERT INTO passenger (name, email) VALUES ($1, $2) RETURNING id',
      [userName, demoEmail]
    );
    passengerRecordId = pInsert.rows[0].id;
  } else {
    passengerRecordId = pRes.rows[0].id;
  }

  // Helper to upsert a confirmed booking + payment for connections
  async function upsertConfirmedBooking(bookingRef, flightId, priceCents) {
    const existing = await pool.query('SELECT id FROM booking WHERE booking_ref = $1', [bookingRef]);
    let bId;
    if (existing.rows.length > 0) {
      bId = existing.rows[0].id;
      await pool.query(
        "UPDATE booking SET flight_id = $1, status = 'confirmed', price_cents = $2 WHERE id = $3",
        [flightId, priceCents, bId]
      );
    } else {
      const seatRes = await pool.query(
        'SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1',
        [flightId]
      );
      let seatId = seatRes.rows[0]?.id;
      if (!seatId) {
        const anySeat = await pool.query('SELECT id FROM seat WHERE flight_id = $1 LIMIT 1', [flightId]);
        seatId = anySeat.rows[0]?.id;
      }
      if (seatId) {
        await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatId]);
      }
      const bInsert = await pool.query(
        `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6)
         RETURNING id`,
        [bookingRef, userId, passengerRecordId, flightId, seatId, priceCents]
      );
      bId = bInsert.rows[0]?.id;
    }
    await upsertDemoPayment(bId, (priceCents / 100).toFixed(2), 'success');
    return bId;
  }

  // Helper to upsert a connection
  async function upsertDemoConnectionRecord(inboundFlightId, outboundFlightId, mct, actualMinutes, status, inBookingId, outBookingId) {
    const existingConn = await pool.query(
      'SELECT id FROM connection WHERE inbound_flight_id = $1 AND outbound_flight_id = $2 AND passenger_id = $3',
      [inboundFlightId, outboundFlightId, userId]
    );
    if (existingConn.rows.length > 0) {
      await pool.query(
        `UPDATE connection
            SET min_connection_minutes = $1, actual_connection_minutes = $2, status = $3,
                inbound_booking_id = $4, outbound_booking_id = $5
          WHERE id = $6`,
        [mct, actualMinutes, status, inBookingId, outBookingId, existingConn.rows[0].id]
      );
      return existingConn.rows[0].id;
    }
    const ins = await pool.query(
      `INSERT INTO connection (inbound_flight_id, outbound_flight_id, passenger_id,
                               min_connection_minutes, actual_connection_minutes, status,
                               inbound_booking_id, outbound_booking_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [inboundFlightId, outboundFlightId, userId, mct, actualMinutes, status, inBookingId, outBookingId]
    );
    return ins.rows[0].id;
  }

  // ── Connection 1: BOM Hub — status: at_risk (Existing Demo Connection) ──
  const bIn1 = await upsertConfirmedBooking('BK-IN101', f1, 650000);
  const bOut1 = await upsertConfirmedBooking('BK-OUT202', f2, 480000);

  // Set inbound flight estimated arrival to leave 32 mins layover at BOM (45m MCT -> at_risk)
  const f2Dep = new Date(depTime2).getTime();
  const delayMinutes1 = 38;
  const delayedInArr1 = new Date(f2Dep - 32 * 60_000);
  await pool.query(
    "UPDATE flight SET estimated_arrival = $1, status = 'delayed' WHERE id = $2",
    [delayedInArr1.toISOString(), f1]
  );
  await pool.query(
    `INSERT INTO delay_log (flight_id, minutes, delay_minutes, reason_code, logged_at, logged_by, "timestamp")
     VALUES ($1, $2, $2, 'ATC', now(), $3, now())`,
    [f1, delayMinutes1, userId]
  ).catch(() => {});
  await upsertDemoConnectionRecord(f1, f2, 45, 32, 'at_risk', bIn1, bOut1);
  console.log(`Demo Connection 1 (DEL -> BOM -> BLR, BOM Hub, at_risk 32m vs 45m MCT) active for user ${userId} (${demoEmail})`);

  // ── Connection 2: DEL Hub — status: on_track ──────────────────────────────
  const bIn2 = await upsertConfirmedBooking('BK-IN211', fDelIn, 540000);
  const bOut2 = await upsertConfirmedBooking('BK-OUT711', fDelOut, 550000);
  // DEL MCT = 60m; AI-211 arr +4h, 6E-711 dep +5.5h -> 90 mins connection (on_track)
  await upsertDemoConnectionRecord(fDelIn, fDelOut, 60, 90, 'on_track', bIn2, bOut2);
  console.log(`Demo Connection 2 (BOM -> DEL -> MAA, DEL Hub, on_track 90m vs 60m MCT) active for user ${userId} (${demoEmail})`);

  // ── Connection 3: BLR Hub — status: missed ────────────────────────────────
  const bIn3 = await upsertConfirmedBooking('BK-IN315', fBlrIn, 680000);
  const bOut3 = await upsertConfirmedBooking('BK-OUT318', fBlrOut, 390000);
  // BLR MCT = 40m; 6E-318 dep at +6.5h; 6E-315 delayed by 50 mins -> arrives at +6h20m -> 10m layover (< 20m gate close -> missed)
  const fBlrOutDep = new Date(now.getTime() + 6.5 * 3600_000).getTime();
  const delayedBlrInArr = new Date(fBlrOutDep - 10 * 60_000);
  await pool.query(
    "UPDATE flight SET estimated_arrival = $1, status = 'delayed' WHERE id = $2",
    [delayedBlrInArr.toISOString(), fBlrIn]
  );
  await pool.query(
    `INSERT INTO delay_log (flight_id, minutes, delay_minutes, reason_code, logged_at, logged_by, "timestamp")
     VALUES ($1, $2, $2, 'WEATHER', now(), $3, now())`,
    [fBlrIn, 50, userId]
  ).catch(() => {});
  await upsertDemoConnectionRecord(fBlrIn, fBlrOut, 40, 10, 'missed', bIn3, bOut3);
  console.log(`Demo Connection 3 (DEL -> BLR -> GOI, BLR Hub, missed 10m vs 40m MCT) active for user ${userId} (${demoEmail})`);

    // B. Upcoming Single-Segment Booking (AI-205, > 24h away -> Confirmed, Check-in NOT open)
    let bUpId = null;
    const existingBUp = await pool.query("SELECT id FROM booking WHERE booking_ref = 'BK-UP205'");
    if (existingBUp.rows.length > 0) {
      bUpId = existingBUp.rows[0].id;
      await pool.query("UPDATE booking SET flight_id = $1, price_cents = 720000 WHERE id = $2", [f5, bUpId]);
    } else {
      const seatUp = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [f5]);
      if (seatUp.rows.length > 0) {
        await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatUp.rows[0].id]);
        const bUp = await pool.query(
          `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
           VALUES ('BK-UP205', $1, $2, $3, $4, 'confirmed', 720000)
           RETURNING id`,
          [userId, passengerRecordId, f5, seatUp.rows[0].id]
        );
        bUpId = bUp.rows[0]?.id;
        console.log(`Upcoming Booking BK-UP205 created for flight AI-205 (+26h away)`);
      }
    }
    await upsertDemoPayment(bUpId, '7200.00', 'success');

    // D. Unlinked confirmed upcoming bookings forming a valid connection (for "Link as connection" demo)
    await upsertConfirmedBooking('BK-LINK101', fLinkIn, 550000);
    await upsertConfirmedBooking('BK-LINK202', fLinkOut, 620000);
    console.log(`Unlinked demo bookings BK-LINK101 (AI-821) and BK-LINK202 (6E-822) created for ${demoEmail}`);

    // C. Past Bookings (for Past tab verification)
    let bPast1Id = null;
    const existingBPast1 = await pool.query("SELECT id FROM booking WHERE booking_ref = 'BK-PAST109'");
    if (existingBPast1.rows.length > 0) {
      bPast1Id = existingBPast1.rows[0].id;
      await pool.query("UPDATE booking SET flight_id = $1, price_cents = 620000 WHERE id = $2", [pastF1, bPast1Id]);
    } else {
      const seatPast1 = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [pastF1]);
      if (seatPast1.rows.length > 0) {
        await pool.query('UPDATE seat SET is_booked = true WHERE id = $1', [seatPast1.rows[0].id]);
        const bPast1 = await pool.query(
          `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
           VALUES ('BK-PAST109', $1, $2, $3, $4, 'checked_in', 620000)
           RETURNING id`,
          [userId, passengerRecordId, pastF1, seatPast1.rows[0].id]
        );
        bPast1Id = bPast1.rows[0]?.id;
        console.log(`Past Booking BK-PAST109 created for landed flight AI-109`);
      }
    }
    await upsertDemoPayment(bPast1Id, '6200.00', 'success');

    let bPast2Id = null;
    const existingBPast2 = await pool.query("SELECT id FROM booking WHERE booking_ref = 'BK-PAST215'");
    if (existingBPast2.rows.length > 0) {
      bPast2Id = existingBPast2.rows[0].id;
      await pool.query("UPDATE booking SET flight_id = $1, price_cents = 460000 WHERE id = $2", [pastF2, bPast2Id]);
    } else {
      const seatPast2 = await pool.query('SELECT id FROM seat WHERE flight_id = $1 AND is_booked = false LIMIT 1', [pastF2]);
      if (seatPast2.rows.length > 0) {
        const bPast2 = await pool.query(
          `INSERT INTO booking (booking_ref, user_id, passenger_id, flight_id, seat_id, status, price_cents)
           VALUES ('BK-PAST215', $1, $2, $3, $4, 'cancelled', 460000)
           RETURNING id`,
          [userId, passengerRecordId, pastF2, seatPast2.rows[0].id]
        );
        bPast2Id = bPast2.rows[0]?.id;
        console.log(`Past Booking BK-PAST215 (cancelled) created for flight 6E-215`);
      }
    }
    await upsertDemoPayment(bPast2Id, '4600.00', 'refunded');

    // ── 5. SEED BAGGAGE & SCAN HISTORY (TASK 10) ──────────────────────────────
    async function upsertDemoStaffUser({ name, email, password, role, department, roleTitle }) {
      const hash = await hashPassword(password);
      let uRes = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
      let uId;
      if (uRes.rows.length === 0) {
        const ins = await pool.query(
          `INSERT INTO "user" (name, email, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [name, email, hash, role]
        );
        uId = ins.rows[0].id;
      } else {
        uId = uRes.rows[0].id;
        await pool.query('UPDATE "user" SET password_hash = $1, role = $2, name = $3 WHERE id = $4', [hash, role, name, uId]);
      }

      // Ensure matching employee record
      const empRes = await pool.query('SELECT id FROM employee WHERE user_id = $1', [uId]);
      if (empRes.rows.length === 0) {
        await pool.query(
          `INSERT INTO employee (user_id, department, role_title, status)
           VALUES ($1, $2, $3, 'active')`,
          [uId, department, roleTitle]
        );
      } else {
        await pool.query(
          `UPDATE employee SET department = $1, role_title = $2, status = 'active' WHERE id = $3`,
          [department, roleTitle, empRes.rows[0].id]
        );
      }
      return uId;
    }

    const staffId = await upsertDemoStaffUser({
      name: 'Ramesh Kumar',
      email: 'staff@meridian.com',
      password: 'staff123',
      role: 'ground_crew',
      department: 'Ground Operations',
      roleTitle: 'Apron Marshaller',
    });

    const securityId = await upsertDemoStaffUser({
      name: 'Vikram Singh',
      email: 'security@meridian.com',
      password: 'security123',
      role: 'security',
      department: 'Security',
      roleTitle: 'Security Officer',
    });

    const opsId = await upsertDemoStaffUser({
      name: 'Ananya Roy',
      email: 'ops@meridian.com',
      password: 'opsmanager123',
      role: 'ops_manager',
      department: 'Operations',
      roleTitle: 'Operations Manager',
    });

    const medicalId = await upsertDemoStaffUser({
      name: 'Dr. Neha Patel',
      email: 'medical@meridian.com',
      password: 'medical123',
      role: 'medical',
      department: 'Emergency & Medical',
      roleTitle: 'Airport Paramedic',
    });

    // Ensure checked_in status on demo bookings so baggage is valid
    if (bIn1) {
      await pool.query("UPDATE booking SET status = 'checked_in' WHERE id = $1", [bIn1]);
    }
    if (bIn2) {
      await pool.query("UPDATE booking SET status = 'checked_in' WHERE id = $1", [bIn2]);
    }

    async function upsertDemoBaggage({ bookingId, tagNumber, weight, status, lastLocation, lastScannedAt, scans }) {
      if (!bookingId) return null;
      let bagId;
      const existing = await pool.query('SELECT id FROM baggage WHERE tag_number = $1', [tagNumber]);
      if (existing.rows.length > 0) {
        bagId = existing.rows[0].id;
        await pool.query(
          `UPDATE baggage
           SET booking_id = $1, weight = $2, status = $3, last_scanned_location = $4, last_scanned_at = $5
           WHERE id = $6`,
          [bookingId, weight, status, lastLocation, lastScannedAt, bagId]
        );
      } else {
        const res = await pool.query(
          `INSERT INTO baggage (booking_id, tag_number, weight, status, last_scanned_location, last_scanned_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [bookingId, tagNumber, weight, status, lastLocation, lastScannedAt]
        );
        bagId = res.rows[0].id;
      }

      for (const scan of scans) {
        const existingScan = await pool.query(
          'SELECT id FROM baggage_scan WHERE baggage_id = $1 AND status = $2 AND location = $3',
          [bagId, scan.status, scan.location]
        );
        if (existingScan.rows.length === 0) {
          await pool.query(
            `INSERT INTO baggage_scan (baggage_id, status, location, scanned_by, scanned_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [bagId, scan.status, scan.location, staffId, scan.scannedAt]
          );
        }
      }
      return bagId;
    }

    const tNow = Date.now();
    // Bag 1 (BK-IN101): status loaded
    await upsertDemoBaggage({
      bookingId: bIn1,
      tagNumber: '1000001001',
      weight: 18.50,
      status: 'loaded',
      lastLocation: 'DEL Gate 4 Ramp',
      lastScannedAt: new Date(tNow - 45 * 60_000),
      scans: [
        { status: 'checked_in', location: 'DEL Check-in Desk 04', scannedAt: new Date(tNow - 120 * 60_000) },
        { status: 'loaded', location: 'DEL Gate 4 Ramp', scannedAt: new Date(tNow - 45 * 60_000) },
      ],
    });

    // Bag 2 (BK-IN101): status in_transit
    await upsertDemoBaggage({
      bookingId: bIn1,
      tagNumber: '1000001002',
      weight: 22.30,
      status: 'in_transit',
      lastLocation: 'Aircraft Cargo Hold - Forward',
      lastScannedAt: new Date(tNow - 20 * 60_000),
      scans: [
        { status: 'checked_in', location: 'DEL Check-in Desk 04', scannedAt: new Date(tNow - 120 * 60_000) },
        { status: 'loaded', location: 'DEL Gate 4 Ramp', scannedAt: new Date(tNow - 45 * 60_000) },
        { status: 'in_transit', location: 'Aircraft Cargo Hold - Forward', scannedAt: new Date(tNow - 20 * 60_000) },
      ],
    });

    // Bag 3 (BK-IN211): status checked_in
    await upsertDemoBaggage({
      bookingId: bIn2,
      tagNumber: '1000002001',
      weight: 14.20,
      status: 'checked_in',
      lastLocation: 'BOM Terminal 2 Check-in Counter 12',
      lastScannedAt: new Date(tNow - 30 * 60_000),
      scans: [
        { status: 'checked_in', location: 'BOM Terminal 2 Check-in Counter 12', scannedAt: new Date(tNow - 30 * 60_000) },
      ],
    });

    // Bag 4 (BK-PAST109): status arrived
    await upsertDemoBaggage({
      bookingId: bPast1Id,
      tagNumber: '1000003001',
      weight: 21.00,
      status: 'arrived',
      lastLocation: 'BOM Baggage Carousel 3',
      lastScannedAt: new Date(tNow - 5 * 3600_000),
      scans: [
        { status: 'checked_in', location: 'DEL Check-in Desk 02', scannedAt: new Date(tNow - 8 * 3600_000) },
        { status: 'loaded', location: 'DEL Ramp Loading Bay', scannedAt: new Date(tNow - 7 * 3600_000) },
        { status: 'in_transit', location: 'Cargo Hold AI-109', scannedAt: new Date(tNow - 6.5 * 3600_000) },
        { status: 'arrived', location: 'BOM Baggage Carousel 3', scannedAt: new Date(tNow - 5 * 3600_000) },
      ],
    });

    // Bag 5 (bOut1): status lost
    if (bOut1) {
      await pool.query("UPDATE booking SET status = 'checked_in' WHERE id = $1", [bOut1]);
      await upsertDemoBaggage({
        bookingId: bOut1,
        tagNumber: '1000004001',
        weight: 26.80,
        status: 'lost',
        lastLocation: 'BOM Ramp Bay 12 Inspection - Misrouted',
        lastScannedAt: new Date(tNow - 60 * 60_000),
        scans: [
          { status: 'checked_in', location: 'DEL Check-in Desk 01', scannedAt: new Date(tNow - 3 * 3600_000) },
          { status: 'loaded', location: 'DEL Gate 2 Ramp', scannedAt: new Date(tNow - 2 * 3600_000) },
          { status: 'lost', location: 'BOM Ramp Bay 12 Inspection - Misrouted', scannedAt: new Date(tNow - 60 * 60_000) },
        ],
      });
    }
    console.log('Demo baggage with all 5 pipeline statuses (checked_in, loaded, in_transit, arrived, lost) seeded successfully.');

    // ── 6. SEED PARKING LOTS, SLOTS & DEMO RESERVATIONS (TASK 11) ───────────
    async function upsertParkingLot(airportId, name, totalSlots, hourlyRate, slotPrefix = 'A') {
      const existing = await pool.query(
        'SELECT id FROM parking_lot WHERE airport_id = $1 AND name = $2',
        [airportId, name]
      );
      let lotId;
      if (existing.rows.length > 0) {
        lotId = existing.rows[0].id;
        await pool.query(
          'UPDATE parking_lot SET total_slots = $1, hourly_rate = $2 WHERE id = $3',
          [totalSlots, hourlyRate, lotId]
        );
      } else {
        const res = await pool.query(
          'INSERT INTO parking_lot (airport_id, name, total_slots, hourly_rate) VALUES ($1, $2, $3, $4) RETURNING id',
          [airportId, name, totalSlots, hourlyRate]
        );
        lotId = res.rows[0].id;
      }

      for (let i = 1; i <= totalSlots; i++) {
        const slotNum = `${slotPrefix}-${String(i).padStart(2, '0')}`;
        await pool.query(
          'INSERT INTO parking_slot (lot_id, slot_number, status) VALUES ($1, $2, \'free\') ON CONFLICT (lot_id, slot_number) DO NOTHING',
          [lotId, slotNum]
        );
      }
      return lotId;
    }

    // DEL lots (2 lots)
    const delLot1 = await upsertParkingLot(del, 'Terminal 1 Short Stay', 24, 60.00, 'A');
    const delLot2 = await upsertParkingLot(del, 'Terminal 3 Multi-Level Parking', 30, 120.00, 'B');

    // BOM lots (2 lots)
    const bomLot1 = await upsertParkingLot(bom, 'Terminal 1 Express Parking', 24, 75.00, 'A');
    const bomLot2 = await upsertParkingLot(bom, 'Terminal 2 Premium Parking', 30, 100.00, 'B');

    // BLR, MAA, HYD, CCU, GOI, AMD, PNQ, COK, JAI lots (1 lot each)
    const blrLot = await upsertParkingLot(blr, 'BLR Terminal General Parking', 24, 70.00, 'A');
    await upsertParkingLot(maa, 'MAA Domestic Parking', 24, 50.00, 'A');
    await upsertParkingLot(hyd, 'HYD Aeropark Plaza', 24, 65.00, 'A');
    await upsertParkingLot(ccu, 'CCU City Side Parking', 24, 50.00, 'A');
    await upsertParkingLot(goi, 'GOI Dabolim Parking', 24, 60.00, 'A');
    await upsertParkingLot(amd, 'AMD Terminal Parking', 24, 55.00, 'A');
    await upsertParkingLot(pnq, 'PNQ Airport Parking', 24, 50.00, 'A');
    await upsertParkingLot(cok, 'COK Canopy Parking', 24, 60.00, 'A');
    await upsertParkingLot(jai, 'JAI Heritage Parking', 24, 45.00, 'A');

    // Upsert demo reservations
    async function upsertDemoParkingBooking({
      ref,
      lotId,
      slotNumber,
      vehicleNumber,
      from,
      until,
      status,
      amountPaid,
      entryTime = null,
      exitTime = null,
      slotStatus = 'free',
    }) {
      const slotRes = await pool.query(
        'SELECT id FROM parking_slot WHERE lot_id = $1 AND slot_number = $2',
        [lotId, slotNumber]
      );
      if (slotRes.rows.length === 0) return;
      const slotId = slotRes.rows[0].id;

      const existing = await pool.query(
        'SELECT id FROM parking_booking WHERE booking_ref = $1',
        [ref]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE parking_booking
           SET slot_id = $1, vehicle_number = $2, reserved_from = $3, reserved_until = $4,
               status = $5, amount_paid = $6, entry_time = $7, exit_time = $8
           WHERE id = $9`,
          [slotId, vehicleNumber, from, until, status, amountPaid, entryTime, exitTime, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO parking_booking (
             booking_ref, user_id, slot_id, vehicle_number,
             reserved_from, reserved_until, status, amount_paid, entry_time, exit_time, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [ref, userId, slotId, vehicleNumber, from, until, status, amountPaid, entryTime, exitTime]
        );
      }

      await pool.query('UPDATE parking_slot SET status = $1 WHERE id = $2', [slotStatus, slotId]);
    }

    const pNow = Date.now();
    // 1. Active reservation at DEL Lot 1
    await upsertDemoParkingBooking({
      ref: 'PK-ACT101',
      lotId: delLot1,
      slotNumber: 'A-01',
      vehicleNumber: 'DL1CAB1234',
      from: new Date(pNow - 2 * 3600_000),
      until: new Date(pNow + 4 * 3600_000),
      status: 'active',
      amountPaid: 360.00,
      entryTime: new Date(pNow - 90 * 60_000),
      slotStatus: 'occupied',
    });

    // 2. Upcoming reserved booking at DEL Lot 2
    await upsertDemoParkingBooking({
      ref: 'PK-UP202',
      lotId: delLot2,
      slotNumber: 'B-05',
      vehicleNumber: 'DL1CAB1234',
      from: new Date(pNow + 24 * 3600_000),
      until: new Date(pNow + 48 * 3600_000),
      status: 'reserved',
      amountPaid: 2880.00,
      slotStatus: 'free',
    });

    // 3. Completed past booking at BOM Lot 1
    await upsertDemoParkingBooking({
      ref: 'PK-PAST303',
      lotId: bomLot1,
      slotNumber: 'A-03',
      vehicleNumber: 'MH12AB1234',
      from: new Date(pNow - 48 * 3600_000),
      until: new Date(pNow - 44 * 3600_000),
      status: 'completed',
      amountPaid: 300.00,
      entryTime: new Date(pNow - 48 * 3600_000),
      exitTime: new Date(pNow - 44 * 3600_000),
      slotStatus: 'free',
    });

    // 4. Cancelled booking at BLR Lot
    await upsertDemoParkingBooking({
      ref: 'PK-CAN404',
      lotId: blrLot,
      slotNumber: 'A-02',
      vehicleNumber: 'KA05MB9999',
      from: new Date(pNow - 24 * 3600_000),
      until: new Date(pNow - 20 * 3600_000),
      status: 'cancelled',
      amountPaid: 280.00,
      slotStatus: 'free',
    });

    console.log('Parking lots, slots, and demo reservations seeded successfully across all airports.');

    // ── 7. SEED ASSISTANCE REQUESTS & BOARDING GROUPS (TASK 12) ──────────────────
    async function upsertDemoAssistanceRequest({
      bookingId,
      type,
      status,
      notes,
      assignedStaffId,
      createdAt,
      assignedAt = null,
      startedAt = null,
      completedAt = null,
    }) {
      if (!bookingId) return;
      const existing = await pool.query(
        'SELECT id FROM assistance_request WHERE booking_id = $1 AND type = $2',
        [bookingId, type]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE assistance_request
           SET status = $1, notes = $2, assigned_staff_id = $3,
               created_at = $4, assigned_at = $5, started_at = $6, completed_at = $7
           WHERE id = $8`,
          [status, notes, assignedStaffId, createdAt, assignedAt, startedAt, completedAt, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO assistance_request (
             booking_id, type, status, notes, assigned_staff_id,
             created_at, assigned_at, started_at, completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [bookingId, type, status, notes, assignedStaffId, createdAt, assignedAt, startedAt, completedAt]
        );
      }
    }

    const astNow = Date.now();
    // 1. Status: requested (Open wheelchair request on BK-IN101)
    await upsertDemoAssistanceRequest({
      bookingId: bIn1,
      type: 'wheelchair',
      status: 'requested',
      notes: 'Passenger requires wheelchair assistance from curb to gate',
      assignedStaffId: null,
      createdAt: new Date(astNow - 2 * 3600_000),
    });

    // 2. Status: assigned (Medical assistance on BK-OUT202, assigned to staff)
    await upsertDemoAssistanceRequest({
      bookingId: bOut1,
      type: 'medical',
      status: 'assigned',
      notes: 'Continuous oxygen support equipment verification',
      assignedStaffId: staffId,
      createdAt: new Date(astNow - 3 * 3600_000),
      assignedAt: new Date(astNow - 90 * 60_000),
    });

    // 3. Status: in_progress (Elderly support on BK-OUT711)
    await upsertDemoAssistanceRequest({
      bookingId: bOut2,
      type: 'elderly_support',
      status: 'in_progress',
      notes: 'Assistance navigating through security and boarding gate',
      assignedStaffId: staffId,
      createdAt: new Date(astNow - 4 * 3600_000),
      assignedAt: new Date(astNow - 2 * 3600_000),
      startedAt: new Date(astNow - 45 * 60_000),
    });

    // 4. Status: completed (Visual assistance on past booking BK-PAST109)
    await upsertDemoAssistanceRequest({
      bookingId: bPast1Id,
      type: 'visual',
      status: 'completed',
      notes: 'Guided passenger safely through terminal and boarding bridge',
      assignedStaffId: staffId,
      createdAt: new Date(astNow - 26 * 3600_000),
      assignedAt: new Date(astNow - 25 * 3600_000),
      startedAt: new Date(astNow - 24.5 * 3600_000),
      completedAt: new Date(astNow - 24 * 3600_000),
    });

    // Re-evaluate boarding groups for all checked-in (not boarded) demo bookings with Task 12.1 rule:
    // Group 1 if business/first class OR has ANY assistance request that is not cancelled (requested, assigned, in_progress, completed)
    // Group 2 otherwise.
    await pool.query(`
      UPDATE booking b
      SET boarding_group = CASE
        WHEN s.class IN ('business', 'first') THEN 1
        WHEN EXISTS (
          SELECT 1 FROM assistance_request ar
          WHERE ar.booking_id = b.id AND ar.status != 'cancelled'
        ) THEN 1
        ELSE 2
      END
      FROM seat s
      WHERE b.seat_id = s.id
        AND b.status = 'checked_in'
    `);

    console.log('Demo assistance requests in all 4 statuses and demo boarding groups (Group 1 & 2) seeded successfully.');

    // ── 8. SEED EMERGENCIES & AUDIT TRAILS (TASK 13) ──────────────────────────
    const emNow = Date.now();

    async function upsertDemoEmergency({
      notesTag,
      type,
      flightId,
      gateId,
      declaredBy,
      status,
      declaredAt,
      resolvedAt = null,
      notes,
      alerts,
      auditTrail,
    }) {
      let emId;
      const existing = await pool.query(
        'SELECT id FROM emergency_event WHERE notes LIKE $1 LIMIT 1',
        [`%${notesTag}%`]
      );
      if (existing.rows.length > 0) {
        emId = existing.rows[0].id;
        await pool.query(
          `UPDATE emergency_event
           SET type = $1, flight_id = $2, gate_id = $3, declared_by = $4,
               status = $5, declared_at = $6, resolved_at = $7, notes = $8
           WHERE id = $9`,
          [type, flightId, gateId, declaredBy, status, declaredAt, resolvedAt, notes, emId]
        );
        await pool.query('DELETE FROM emergency_alert WHERE emergency_id = $1', [emId]);
        await pool.query('DELETE FROM emergency_audit WHERE emergency_id = $1', [emId]);
      } else {
        const ins = await pool.query(
          `INSERT INTO emergency_event (type, flight_id, gate_id, declared_by, status, declared_at, resolved_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [type, flightId, gateId, declaredBy, status, declaredAt, resolvedAt, notes]
        );
        emId = ins.rows[0].id;
      }

      for (const al of alerts) {
        await pool.query(
          `INSERT INTO emergency_alert (emergency_id, recipient_role, sent_at, acknowledged_at, acknowledged_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [emId, al.role, declaredAt, al.acknowledgedAt || null, al.acknowledgedBy || null]
        );
      }

      for (const tr of auditTrail) {
        await pool.query(
          `INSERT INTO emergency_audit (emergency_id, action, actor_user_id, actor_role, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [emId, tr.action, tr.actorUserId || null, tr.actorRole || null, JSON.stringify(tr.details || {}), tr.createdAt]
        );
      }

      return emId;
    }

    // 1. Active Emergency: Fire at DEL Gate A1
    const activeEmDeclaredAt = new Date(emNow - 25 * 60_000);
    const activeEmAckAt = new Date(emNow - 18 * 60_000);
    const activeEmNoteAt = new Date(emNow - 10 * 60_000);

    await upsertDemoEmergency({
      notesTag: 'Gate A1 ground power unit',
      type: 'fire',
      flightId: null,
      gateId: gateDelA1,
      declaredBy: staffId,
      status: 'active',
      declaredAt: activeEmDeclaredAt,
      notes: 'Electrical short circuit and smoke reported at Gate A1 ground power unit',
      alerts: [
        { role: 'ground_crew', acknowledgedBy: staffId, acknowledgedAt: activeEmAckAt },
        { role: 'security', acknowledgedBy: null, acknowledgedAt: null },
        { role: 'ops_manager', acknowledgedBy: null, acknowledgedAt: null },
        { role: 'admin', acknowledgedBy: null, acknowledgedAt: null },
      ],
      auditTrail: [
        {
          action: 'declared',
          actorUserId: staffId,
          actorRole: 'ground_crew',
          details: { type: 'fire', gate_id: gateDelA1, notes: 'Electrical short circuit and smoke reported at Gate A1 ground power unit' },
          createdAt: activeEmDeclaredAt,
        },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'security' }, createdAt: activeEmDeclaredAt },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'ground_crew' }, createdAt: activeEmDeclaredAt },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'ops_manager' }, createdAt: activeEmDeclaredAt },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'admin' }, createdAt: activeEmDeclaredAt },
        {
          action: 'acknowledged',
          actorUserId: staffId,
          actorRole: 'ground_crew',
          details: { recipient_role: 'ground_crew' },
          createdAt: activeEmAckAt,
        },
        {
          action: 'note_added',
          actorUserId: staffId,
          actorRole: 'ground_crew',
          details: { note: 'Ground power isolated to Gate A1. CO2 extinguisher deployed. Awaiting security cordon.' },
          createdAt: activeEmNoteAt,
        },
      ],
    });

    // 2. Resolved Emergency: Medical incident on Flight AI-101
    const resolvedEmDeclaredAt = new Date(emNow - 180 * 60_000);
    const resolvedEmMedAckAt = new Date(emNow - 170 * 60_000);
    const resolvedEmOpsAckAt = new Date(emNow - 165 * 60_000);
    const resolvedEmNoteAt = new Date(emNow - 150 * 60_000);
    const resolvedEmResolvedAt = new Date(emNow - 120 * 60_000);

    await upsertDemoEmergency({
      notesTag: 'chest tightness and shortness of breath',
      type: 'medical',
      flightId: f1,
      gateId: null,
      declaredBy: staffId,
      status: 'resolved',
      declaredAt: resolvedEmDeclaredAt,
      resolvedAt: resolvedEmResolvedAt,
      notes: 'Passenger on inbound AI-101 experiencing sudden chest tightness and shortness of breath',
      alerts: [
        { role: 'medical', acknowledgedBy: medicalId, acknowledgedAt: resolvedEmMedAckAt },
        { role: 'ops_manager', acknowledgedBy: opsId, acknowledgedAt: resolvedEmOpsAckAt },
        { role: 'admin', acknowledgedBy: null, acknowledgedAt: null },
      ],
      auditTrail: [
        {
          action: 'declared',
          actorUserId: staffId,
          actorRole: 'ground_crew',
          details: { type: 'medical', flight_id: f1, notes: 'Passenger on inbound AI-101 experiencing sudden chest tightness and shortness of breath' },
          createdAt: resolvedEmDeclaredAt,
        },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'medical' }, createdAt: resolvedEmDeclaredAt },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'ops_manager' }, createdAt: resolvedEmDeclaredAt },
        { action: 'alert_sent', actorUserId: staffId, actorRole: 'ground_crew', details: { recipient_role: 'admin' }, createdAt: resolvedEmDeclaredAt },
        {
          action: 'acknowledged',
          actorUserId: medicalId,
          actorRole: 'medical',
          details: { recipient_role: 'medical' },
          createdAt: resolvedEmMedAckAt,
        },
        {
          action: 'acknowledged',
          actorUserId: opsId,
          actorRole: 'ops_manager',
          details: { recipient_role: 'ops_manager' },
          createdAt: resolvedEmOpsAckAt,
        },
        {
          action: 'note_added',
          actorUserId: medicalId,
          actorRole: 'medical',
          details: { note: 'Paramedic triage team dispatched to gate with portable oxygen and vitals kit.' },
          createdAt: resolvedEmNoteAt,
        },
        {
          action: 'resolved',
          actorUserId: medicalId,
          actorRole: 'medical',
          details: { resolution_notes: 'Passenger stabilized on high-flow oxygen and safely escorted to terminal clinic for observation.' },
          createdAt: resolvedEmResolvedAt,
        },
      ],
    });

    console.log('Demo active and resolved emergencies with full audit trails seeded successfully.');

    // ── 9. SEED SECURITY CHECKPOINTS & SCREENING LOGS (TASK 14) ───────────────
    async function upsertDemoCheckpoint(airportId, name, location, status = 'open', statusReason = null) {
      const existing = await pool.query(
        'SELECT id FROM security_checkpoint WHERE airport_id = $1 AND name = $2',
        [airportId, name]
      );
      if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await pool.query(
          `UPDATE security_checkpoint
           SET location = $1, status = $2, status_reason = $3, updated_at = now()
           WHERE id = $4`,
          [location, status, statusReason, id]
        );
        return id;
      }
      const ins = await pool.query(
        `INSERT INTO security_checkpoint (airport_id, name, location, status, status_reason, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id`,
        [airportId, name, location, status, statusReason]
      );
      return ins.rows[0].id;
    }

    // DEL (4 checkpoints: 2 open, 1 delayed, 1 closed)
    const cpDel1 = await upsertDemoCheckpoint(del, 'T3 Domestic North Security', 'Terminal 3, Level 2 Departures', 'open');
    const cpDel2 = await upsertDemoCheckpoint(del, 'T3 Domestic South Security', 'Terminal 3, Level 2 South Pier', 'open');
    const cpDel3 = await upsertDemoCheckpoint(del, 'T3 International Screening Pier', 'Terminal 3, International Wing Gate B', 'delayed', 'Lane 4 scanner recalibration in progress');
    const cpDel4 = await upsertDemoCheckpoint(del, 'T2 Maintenance Checkpoint', 'Terminal 2, Concourse A', 'closed', 'Overnight scheduled conveyor and facility maintenance');

    // BOM (3 checkpoints: 2 open, 1 delayed)
    const cpBom1 = await upsertDemoCheckpoint(bom, 'T2 Security Alpha', 'Terminal 2, Pier C Departure', 'open');
    const cpBom2 = await upsertDemoCheckpoint(bom, 'T2 Security Bravo', 'Terminal 2, Pier D Departure', 'open');
    const cpBom3 = await upsertDemoCheckpoint(bom, 'T1 Domestic Screening', 'Terminal 1B, Departure Level', 'delayed', 'Peak hour passenger flow diversion to Alpha lane');

    // BLR (2 checkpoints: open)
    const cpBlr1 = await upsertDemoCheckpoint(blr, 'T1 Central Security Checkpoint', 'Terminal 1, Level 1', 'open');
    const cpBlr2 = await upsertDemoCheckpoint(blr, 'T2 Express Security Gate', 'Terminal 2, Gate Concourse', 'open');

    // MAA, HYD, CCU, GOI, AMD, PNQ, COK, JAI (2 checkpoints each)
    const cpMaa1 = await upsertDemoCheckpoint(maa, 'Terminal 1 Domestic Security', 'Domestic Concourse Level 1', 'open');
    const cpMaa2 = await upsertDemoCheckpoint(maa, 'Terminal 2 International Security', 'International Pier 2', 'open');

    const cpHyd1 = await upsertDemoCheckpoint(hyd, 'Main Concourse Security Hall', 'Departures Level 2', 'open');
    const cpHyd2 = await upsertDemoCheckpoint(hyd, 'East Pier Security Point', 'Gate 20-32 Concourse', 'delayed', 'Periodic canine patrol inspection in progress');

    const cpCcu1 = await upsertDemoCheckpoint(ccu, 'Central Departure Security', 'Terminal 1, Level 2', 'open');
    const cpCcu2 = await upsertDemoCheckpoint(ccu, 'International Pier Checkpoint', 'International Wing', 'open');

    const cpGoi1 = await upsertDemoCheckpoint(goi, 'Dabolim Main Security Area', 'Departure Gate Hall', 'open');
    const cpGoi2 = await upsertDemoCheckpoint(goi, 'North Concourse Security', 'Concourse B', 'open');

    const cpAmd1 = await upsertDemoCheckpoint(amd, 'Terminal 1 Security', 'Domestic Level 1', 'open');
    const cpAmd2 = await upsertDemoCheckpoint(amd, 'Terminal 2 Security', 'International Wing', 'open');

    const cpPnq1 = await upsertDemoCheckpoint(pnq, 'Main Terminal Security', 'Level 1 Departures', 'open');
    const cpPnq2 = await upsertDemoCheckpoint(pnq, 'Express Lane Security', 'Gate 1-6 Hall', 'open');

    const cpCok1 = await upsertDemoCheckpoint(cok, 'T3 Solar Terminal Security', 'Level 2 Departures', 'open');
    const cpCok2 = await upsertDemoCheckpoint(cok, 'T1 Domestic Checkpoint', 'Terminal 1 Concourse', 'open');

    const cpJai1 = await upsertDemoCheckpoint(jai, 'Pink City Security Hall', 'Terminal 2 Main Level', 'open');
    const cpJai2 = await upsertDemoCheckpoint(jai, 'Gate 1-4 Security Point', 'Boarding Area North', 'open');

    // ── Seed ~60 screenings over the last 24 hours ──
    const openCheckpoints = [cpDel1, cpDel2, cpDel3, cpBom1, cpBom2, cpBom3, cpBlr1, cpBlr2, cpMaa1, cpHyd1];
    const demoBookingIds = [bIn1, bOut1, bIn2, bOut2, bIn3, bOut3, bUpId].filter(Boolean);

    await pool.query('DELETE FROM screening_log WHERE screened_by = $1', [securityId]);

    const sNow = Date.now();
    const flaggedNotesSamples = [
      'Liquids volume exceeded 100ml allowance; passenger voluntarily surrendered items',
      'Unregistered high-capacity power bank identified in carry-on bag; verified safe',
      'Oversized blunt tool in personal luggage; moved to hold baggage',
      'Unidentified organic density in carry-on duffel; manual swab test required',
      'Scissors with blade length exceeding 6cm detected and surrendered',
    ];

    const secondaryNotesSamples = [
      'Random explosive trace detection (ETD) swab test performed; negative/cleared',
      'Full physical baggage inspection and biometric identity reverification completed',
      'Secondary pat-down protocol initiated following metal detector threshold trigger; cleared',
      'High-density electronic equipment inspection with standalone scanner; all components verified',
      'Random passenger selection for enhanced manual security verification protocol; cleared',
    ];

    for (let i = 0; i < 60; i++) {
      let offsetMinutes;
      if (i < 12) {
        offsetMinutes = Math.floor(Math.random() * 55) + 2;
      } else {
        offsetMinutes = Math.floor(Math.random() * (23.5 * 60 - 60)) + 60;
      }

      const screeningTime = new Date(sNow - offsetMinutes * 60_000);
      const chosenCp = openCheckpoints[i % openCheckpoints.length];
      const chosenBooking = demoBookingIds[i % demoBookingIds.length];

      let result = 'cleared';
      let notes = null;

      if (i % 12 === 3) {
        result = 'flagged';
        notes = flaggedNotesSamples[(i / 12) % flaggedNotesSamples.length];
      } else if (i % 12 === 7) {
        result = 'secondary_screening';
        notes = secondaryNotesSamples[(i / 12) % secondaryNotesSamples.length];
      }

      await pool.query(
        `INSERT INTO screening_log (checkpoint_id, booking_id, passenger_id, screened_by, result, notes, "timestamp")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [chosenCp, chosenBooking, userId, securityId, result, notes, screeningTime]
      );
    }

    console.log('Security checkpoints (2-4 per airport with open/delayed/closed) and 60 screening logs seeded successfully.');

    // ── 10. SEED RESTRICTED ZONES & INCIDENTS (TASK 15) ──────────────────────
    const adminId = await upsertDemoStaffUser({
      name: 'System Admin',
      email: 'admin@meridian.com',
      password: 'admin123',
      role: 'admin',
      department: 'Administration',
      roleTitle: 'Airport Systems Administrator',
    });

    const empLookup = {};
    for (const [key, uid] of Object.entries({
      ground_crew: staffId,
      security: securityId,
      ops_manager: opsId,
      medical: medicalId,
      admin: adminId,
    })) {
      const r = await pool.query('SELECT id FROM employee WHERE user_id = $1', [uid]);
      if (r.rows.length > 0) empLookup[key] = { userId: uid, employeeId: r.rows[0].id };
    }

    // 10A. Restricted Zones
    const zonesToSeed = [
      {
        code: 'AIRSIDE_APRON',
        name: 'Airside Apron & Ramp',
        description: 'Aircraft parking stands, taxi lanes, and ground handling operations area',
        allowed_roles: ['ground_crew', 'security', 'medical', 'ops_manager', 'admin'],
      },
      {
        code: 'BAGGAGE_HALL',
        name: 'Baggage Handling Hall',
        description: 'Baggage sortation systems, makeup carousels, and conveyor belts',
        allowed_roles: ['ground_crew', 'security', 'ops_manager', 'admin'],
      },
      {
        code: 'FUEL_FARM',
        name: 'Aviation Fuel Depot & Farm',
        description: 'Bulk Jet-A1 fuel storage, hydrant pumping stations, and refueler parking',
        allowed_roles: ['ground_crew', 'ops_manager', 'admin'],
      },
      {
        code: 'CARGO_TERMINAL',
        name: 'Air Cargo & Freight Terminal',
        description: 'Cargo processing, customs hold, and heavy pallet staging',
        allowed_roles: ['ground_crew', 'security', 'ops_manager', 'admin'],
      },
      {
        code: 'CONTROL_TOWER',
        name: 'Air Traffic Control Tower & Technical Core',
        description: 'ATC visual cab, radar equipment room, and flight data processing',
        allowed_roles: ['ops_manager', 'admin'],
      },
      {
        code: 'SERVER_ROOM',
        name: 'Airfield IT & Telecom Server Room',
        description: 'Central data center, flight information servers, and network core',
        allowed_roles: ['admin'],
      },
    ];

    for (const z of zonesToSeed) {
      await pool.query(
        `INSERT INTO restricted_zone (code, name, description, allowed_roles)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, allowed_roles = EXCLUDED.allowed_roles`,
        [z.code, z.name, z.description, z.allowed_roles]
      );
    }

    // 10B. Security Incidents (12 realistic records across severities and statuses)
    const existingInc = await pool.query('SELECT COUNT(*)::int AS count FROM security_incident');
    if (existingInc.rows[0].count < 12) {
      const demoIncidents = [
        {
          location: 'Terminal 3 Airside Security Gate 4',
          type: 'unauthorized_access',
          severity: 'critical',
          status: 'investigating',
          description: 'Individual breached airside security door after forced badge push bar activation.',
          reported_by: securityId,
          assigned_to: securityId,
          offsetHours: 3,
          timeline: [
            { action: 'created', note: 'Critical breach alarm sounded at T3 Gate 4.', offsetMins: 180, actor: securityId },
            { action: 'assigned', note: 'Assigned to Officer Vikram Singh for immediate containment.', offsetMins: 175, actor: opsId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 170, actor: securityId },
            { action: 'note', note: 'CCTV footage retrieved; suspect detained near ramp transfer corridor.', offsetMins: 120, actor: securityId },
          ],
        },
        {
          location: 'Baggage Scanner Unit B2 Concourse',
          type: 'equipment_tamper',
          severity: 'critical',
          status: 'closed',
          description: 'Emergency stop circuit disconnected on inline X-ray machine.',
          reported_by: staffId,
          assigned_to: opsId,
          closed_at_offset: 14,
          resolution_notes: 'Technician verified reconnected tamper switch and recalibrated optical sensor.',
          offsetHours: 28,
          timeline: [
            { action: 'created', note: 'Baggage crew reported offline safety lock.', offsetMins: 1680, actor: staffId },
            { action: 'assigned', note: 'Assigned to Ops Manager Ananya Roy.', offsetMins: 1650, actor: opsId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 1620, actor: opsId },
            { action: 'note', note: 'OEM contractor arrived on site with replacement wiring loom.', offsetMins: 1200, actor: opsId },
            { action: 'status_change', note: 'Incident closed. Resolution: Technician verified reconnected tamper switch and recalibrated optical sensor.', offsetMins: 840, actor: opsId },
          ],
        },
        {
          location: 'Terminal 1 Check-in Hall B',
          type: 'suspicious_behavior',
          severity: 'high',
          status: 'open',
          description: 'Individual repeatedly photographing CCTV camera positions and staff service access gates.',
          reported_by: securityId,
          assigned_to: null,
          offsetHours: 1,
          timeline: [
            { action: 'created', note: 'Patrol officer observed repeated photography of access control doors.', offsetMins: 60, actor: securityId },
            { action: 'note', note: 'Terminal floor supervisors notified to maintain visual watch.', offsetMins: 35, actor: securityId },
          ],
        },
        {
          location: 'Gate 14 Seating Area Pier C',
          type: 'unattended_baggage',
          severity: 'high',
          status: 'investigating',
          description: 'Black hard-shell rolling suitcase left unattended near charging kiosk for over 45 minutes.',
          reported_by: staffId,
          assigned_to: securityId,
          offsetHours: 4,
          timeline: [
            { action: 'created', note: 'Gate agent reported owner not responding to public address calls.', offsetMins: 240, actor: staffId },
            { action: 'assigned', note: 'Assigned to Officer Vikram Singh.', offsetMins: 230, actor: opsId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 220, actor: securityId },
            { action: 'note', note: 'K9 unit deployed; initial sniff sweep negative for energetic compounds.', offsetMins: 90, actor: securityId },
          ],
        },
        {
          location: 'Arrivals Immigration Desk 6',
          type: 'altercation',
          severity: 'high',
          status: 'closed',
          description: 'Verbal dispute between two passengers escalating to physical confrontation in immigration queue.',
          reported_by: securityId,
          assigned_to: securityId,
          closed_at_offset: 8,
          resolution_notes: 'Both parties separated, questioned by CISF security, and issued civil warning notices.',
          offsetHours: 12,
          timeline: [
            { action: 'created', note: 'Queue line marshals alerted security of heated scuffle.', offsetMins: 720, actor: securityId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 700, actor: securityId },
            { action: 'status_change', note: 'Incident closed. Resolution: Both parties separated, questioned by CISF security, and issued civil warning notices.', offsetMins: 480, actor: securityId },
          ],
        },
        {
          location: 'Terminal 2 Duty Free Concourse',
          type: 'theft',
          severity: 'medium',
          status: 'open',
          description: 'Store manager reported missing designer perfume inventory valued at ₹42,000.',
          reported_by: securityId,
          assigned_to: null,
          offsetHours: 5,
          timeline: [
            { action: 'created', note: 'Retail shift lead filed loss report with security desk.', offsetMins: 300, actor: securityId },
          ],
        },
        {
          location: 'Airfield IT Server Room North Door',
          type: 'unauthorized_access',
          severity: 'medium',
          status: 'investigating',
          description: 'Repeated badge tap failures by unauthorized ground crew personnel at server room badge reader.',
          reported_by: opsId,
          assigned_to: adminId,
          offsetHours: 9,
          timeline: [
            { action: 'created', note: 'Access control system generated badge rejection anomaly.', offsetMins: 540, actor: opsId },
            { action: 'assigned', note: 'Assigned to System Admin.', offsetMins: 510, actor: opsId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 480, actor: adminId },
          ],
        },
        {
          location: 'Food Court Level 2 Pier C',
          type: 'unattended_baggage',
          severity: 'medium',
          status: 'closed',
          description: 'Canvas tote bag left behind on dining table.',
          reported_by: staffId,
          assigned_to: securityId,
          closed_at_offset: 16,
          resolution_notes: 'Owner returned from restroom with matching boarding pass; verified contents and released.',
          offsetHours: 20,
          timeline: [
            { action: 'created', note: 'Cleaning contractor flagged unattended bag.', offsetMins: 1200, actor: staffId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 1150, actor: securityId },
            { action: 'status_change', note: 'Incident closed. Resolution: Owner returned from restroom with matching boarding pass; verified contents and released.', offsetMins: 960, actor: securityId },
          ],
        },
        {
          location: 'Staff Car Park Gate 3 Entry',
          type: 'other',
          severity: 'low',
          status: 'open',
          description: 'Automated barrier gate arm failed to close completely after vehicle transit.',
          reported_by: staffId,
          assigned_to: null,
          offsetHours: 6,
          timeline: [
            { action: 'created', note: 'Ground staff noted hydraulic arm slipping.', offsetMins: 360, actor: staffId },
          ],
        },
        {
          location: 'Taxi Stand Outer Curbside Lane',
          type: 'suspicious_behavior',
          severity: 'low',
          status: 'investigating',
          description: 'Commercial taxi driver loitering in terminal arrival vestibule soliciting passengers.',
          reported_by: securityId,
          assigned_to: securityId,
          offsetHours: 7,
          timeline: [
            { action: 'created', note: 'Curbside marshal filed touting complaint.', offsetMins: 420, actor: securityId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 390, actor: securityId },
          ],
        },
        {
          location: 'Lost and Found Customer Counter',
          type: 'theft',
          severity: 'low',
          status: 'closed',
          description: 'Passenger claimed misplaced smart watch was handed in but missing from registry log.',
          reported_by: securityId,
          assigned_to: securityId,
          closed_at_offset: 24,
          resolution_notes: 'Item located in secure night-drop safe; logged properly and reunited with passenger.',
          offsetHours: 36,
          timeline: [
            { action: 'created', note: 'Passenger inquiry logged.', offsetMins: 2160, actor: securityId },
            { action: 'status_change', note: 'Status advanced from open to investigating', offsetMins: 2000, actor: securityId },
            { action: 'status_change', note: 'Incident closed. Resolution: Item located in secure night-drop safe; logged properly and reunited with passenger.', offsetMins: 1440, actor: securityId },
          ],
        },
        {
          location: 'Control Tower Perimeter Door 102',
          type: 'unauthorized_access',
          severity: 'medium',
          status: 'open',
          description: 'Medical crew member badge tapped at restricted ATC core access door.',
          reported_by: opsId,
          assigned_to: null,
          offsetHours: 2,
          timeline: [
            { action: 'created', note: 'System alert: unauthorized role badge scan at Control Tower entrance.', offsetMins: 120, actor: opsId },
          ],
        },
      ];

      for (const d of demoIncidents) {
        const incTs = new Date(sNow - d.offsetHours * 3600_000);
        const closedAt = d.closed_at_offset ? new Date(sNow - d.closed_at_offset * 3600_000) : null;

        const res = await pool.query(
          `INSERT INTO security_incident (location, type, severity, status, description, reported_by, assigned_to, closed_at, resolution_notes, "timestamp", updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING id`,
          [d.location, d.type, d.severity, d.status, d.description, d.reported_by, d.assigned_to, closedAt, d.resolution_notes || null, incTs]
        );
        const incId = res.rows[0].id;

        for (const t of d.timeline) {
          const tTime = new Date(sNow - t.offsetMins * 60_000);
          await pool.query(
            `INSERT INTO security_incident_update (incident_id, actor_user_id, action, note, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [incId, t.actor, t.action, t.note, tTime]
          );
        }
      }
    }

    // 10C. Restricted Zone Access Logs (40 attempts over past 3 days with ~8-10 denied)
    const existingLogs = await pool.query('SELECT COUNT(*)::int AS count FROM restricted_zone_access');
    if (existingLogs.rows[0].count < 40) {
      const attemptsConfig = [
        // Ground crew (allowed: AIRSIDE_APRON, BAGGAGE_HALL, FUEL_FARM, CARGO_TERMINAL; denied: CONTROL_TOWER, SERVER_ROOM)
        { role: 'ground_crew', zone: 'AIRSIDE_APRON', count: 8 },
        { role: 'ground_crew', zone: 'BAGGAGE_HALL', count: 6 },
        { role: 'ground_crew', zone: 'FUEL_FARM', count: 3 },
        { role: 'ground_crew', zone: 'CARGO_TERMINAL', count: 3 },
        { role: 'ground_crew', zone: 'CONTROL_TOWER', count: 2, forceDenied: true },
        { role: 'ground_crew', zone: 'SERVER_ROOM', count: 2, forceDenied: true },

        // Security (allowed: AIRSIDE_APRON, BAGGAGE_HALL, CARGO_TERMINAL; denied: FUEL_FARM, CONTROL_TOWER, SERVER_ROOM)
        { role: 'security', zone: 'AIRSIDE_APRON', count: 4 },
        { role: 'security', zone: 'BAGGAGE_HALL', count: 3 },
        { role: 'security', zone: 'CARGO_TERMINAL', count: 2 },
        { role: 'security', zone: 'FUEL_FARM', count: 1, forceDenied: true },
        { role: 'security', zone: 'CONTROL_TOWER', count: 1, forceDenied: true },
        { role: 'security', zone: 'SERVER_ROOM', count: 1, forceDenied: true },

        // Medical (allowed: AIRSIDE_APRON; denied others)
        { role: 'medical', zone: 'AIRSIDE_APRON', count: 2 },
        { role: 'medical', zone: 'BAGGAGE_HALL', count: 1, forceDenied: true },
        { role: 'medical', zone: 'SERVER_ROOM', count: 1, forceDenied: true },

        // Ops Manager (allowed all except SERVER_ROOM)
        { role: 'ops_manager', zone: 'CONTROL_TOWER', count: 3 },
        { role: 'ops_manager', zone: 'AIRSIDE_APRON', count: 2 },
        { role: 'ops_manager', zone: 'SERVER_ROOM', count: 1, forceDenied: true },

        // Admin (allowed everywhere)
        { role: 'admin', zone: 'SERVER_ROOM', count: 2 },
        { role: 'admin', zone: 'CONTROL_TOWER', count: 1 },
      ];

      let attemptIdx = 0;
      for (const cfg of attemptsConfig) {
        const emp = empLookup[cfg.role];
        if (!emp) continue;

        for (let j = 0; j < cfg.count; j++) {
          attemptIdx++;
          const offsetHours = Math.floor(Math.random() * 70) + 1; // within 3 days
          const ts = new Date(sNow - offsetHours * 3600_000);
          const isGranted = !cfg.forceDenied;
          const reason = isGranted
            ? `Authorized: role "${cfg.role}" is permitted in ${cfg.zone}`
            : `Denied: role "${cfg.role}" is NOT permitted in ${cfg.zone}`;

          await pool.query(
            `INSERT INTO restricted_zone_access (employee_id, zone, access_granted, recorded_by, reason, "timestamp")
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [emp.employeeId, cfg.zone, isGranted, securityId, reason, ts]
          );
        }
      }
    }

    console.log('Restricted zones catalog, demo incidents with timelines, and zone access history seeded successfully.');

    // ── 11. SEED FACILITIES (Task 16a) ────────────────────────────────────────
    async function upsertFacility(apId, fName, fType, fTerminal, fGateProx, fStatus = 'open') {
      const existing = await pool.query(
        'SELECT id FROM facility WHERE airport_id = $1 AND name = $2',
        [apId, fName]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE facility
              SET type = $1, location_terminal = $2, location_gate_proximity = $3, status = $4
            WHERE id = $5`,
          [fType, fTerminal, fGateProx, fStatus, existing.rows[0].id]
        );
        return existing.rows[0].id;
      }
      const ins = await pool.query(
        `INSERT INTO facility (airport_id, name, type, location_terminal, location_gate_proximity, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [apId, fName, fType, fTerminal, fGateProx, fStatus]
      );
      return ins.rows[0].id;
    }

    const facilitiesSeedList = [
      // DEL (12 facilities across T1, T2, T3)
      { airportId: del, name: 'Encalm Lounge', type: 'lounge', terminal: 'Terminal 3', gate: 'Near Gate 27', status: 'open' },
      { airportId: del, name: 'Plaza Premium Lounge', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 4', status: 'open' },
      { airportId: del, name: 'Air India Maharaja Lounge', type: 'lounge', terminal: 'Terminal 3', gate: 'Near Gate 32', status: 'open' },
      { airportId: del, name: "Haldiram's Express", type: 'restaurant', terminal: 'Terminal 3', gate: 'Food Court Level 2', status: 'open' },
      { airportId: del, name: 'Costa Coffee', type: 'restaurant', terminal: 'Terminal 1', gate: 'Departure Hall Gate 6', status: 'open' },
      { airportId: del, name: 'Starbucks Coffee', type: 'restaurant', terminal: 'Terminal 2', gate: 'Near Gate 18', status: 'open' },
      { airportId: del, name: 'Delhi Duty Free', type: 'shop', terminal: 'Terminal 3', gate: 'Central Concourse', status: 'open' },
      { airportId: del, name: 'WHSmith Travel Essentials', type: 'shop', terminal: 'Terminal 1', gate: 'Security Check Area', status: 'open' },
      { airportId: del, name: 'T3 Executive Restroom & Shower', type: 'restroom', terminal: 'Terminal 3', gate: 'Near Gate 15', status: 'open' },
      { airportId: del, name: 'Multi-Faith Prayer Room', type: 'prayer_room', terminal: 'Terminal 3', gate: 'Mezzanine Level', status: 'open' },
      { airportId: del, name: 'Fast-Charge Power Hub', type: 'charging_station', terminal: 'Terminal 2', gate: 'Opposite Gate 12', status: 'open' },
      { airportId: del, name: 'The Coffee Club T3', type: 'restaurant', terminal: 'Terminal 3', gate: 'Near Gate 41', status: 'closed' },

      // BOM (12 facilities across T1, T2)
      { airportId: bom, name: 'Adani Lounge Domestic', type: 'lounge', terminal: 'Terminal 2', gate: 'Level 3 Near Gate 44', status: 'open' },
      { airportId: bom, name: 'Oasis Lounge', type: 'lounge', terminal: 'Terminal 1', gate: 'Security Hold Area Gate 2', status: 'open' },
      { airportId: bom, name: 'Travel Club Lounge', type: 'lounge', terminal: 'Terminal 2', gate: 'Near Gate 68', status: 'open' },
      { airportId: bom, name: 'Shiv Sagar Express', type: 'restaurant', terminal: 'Terminal 1', gate: 'Gate 8', status: 'open' },
      { airportId: bom, name: 'Bombay Brasserie', type: 'restaurant', terminal: 'Terminal 2', gate: 'Near Gate 48', status: 'open' },
      { airportId: bom, name: 'Chai Point', type: 'restaurant', terminal: 'Terminal 2', gate: 'Arrivals Pier', status: 'open' },
      { airportId: bom, name: 'Mumbai Duty Free', type: 'shop', terminal: 'Terminal 2', gate: 'Departures Pier A', status: 'open' },
      { airportId: bom, name: 'Hamleys Toy Store', type: 'shop', terminal: 'Terminal 2', gate: 'Central Walkway', status: 'open' },
      { airportId: bom, name: 'T2 Family Restroom & Baby Care', type: 'restroom', terminal: 'Terminal 2', gate: 'Near Gate 52', status: 'open' },
      { airportId: bom, name: 'Interfaith Prayer Room', type: 'prayer_room', terminal: 'Terminal 2', gate: 'Level 4 Airside', status: 'open' },
      { airportId: bom, name: 'Gadget Charging Station', type: 'charging_station', terminal: 'Terminal 1', gate: 'Gate 5 Seating', status: 'open' },
      { airportId: bom, name: 'Subway Grab & Go', type: 'restaurant', terminal: 'Terminal 2', gate: 'Near Gate 39', status: 'closed' },

      // BLR (12 facilities across T1, T2)
      { airportId: blr, name: '080 Domestic Lounge', type: 'lounge', terminal: 'Terminal 1', gate: 'Mezzanine Level Gate 11', status: 'open' },
      { airportId: blr, name: '080 International Lounge', type: 'lounge', terminal: 'Terminal 2', gate: 'Near Gate 22', status: 'open' },
      { airportId: blr, name: 'BLR Club Lounge', type: 'lounge', terminal: 'Terminal 2', gate: 'Level 3 East Wing', status: 'open' },
      { airportId: blr, name: 'Hatti Kaapi', type: 'restaurant', terminal: 'Terminal 1', gate: 'Near Gate 7', status: 'open' },
      { airportId: blr, name: 'Windmills Craftworks Bar', type: 'restaurant', terminal: 'Terminal 2', gate: 'Gate 18', status: 'open' },
      { airportId: blr, name: 'Third Wave Coffee', type: 'restaurant', terminal: 'Terminal 1', gate: 'Arrivals Concourse', status: 'open' },
      { airportId: blr, name: 'Shoppers Stop Airport', type: 'shop', terminal: 'Terminal 1', gate: 'Departures Gate 4', status: 'open' },
      { airportId: blr, name: 'Fabindia Artisanal', type: 'shop', terminal: 'Terminal 2', gate: 'Garden Pavillion', status: 'open' },
      { airportId: blr, name: 'T2 Premium Restrooms', type: 'restroom', terminal: 'Terminal 2', gate: 'Near Gate 14', status: 'open' },
      { airportId: blr, name: 'Quiet Contemplation & Prayer Room', type: 'prayer_room', terminal: 'Terminal 1', gate: 'Departure Pier B', status: 'open' },
      { airportId: blr, name: 'Solar Powered Rapid Charging Hub', type: 'charging_station', terminal: 'Terminal 2', gate: 'Gate 26 Pier', status: 'open' },
      { airportId: blr, name: 'Brew & Bites Kiosk', type: 'restaurant', terminal: 'Terminal 1', gate: 'Near Gate 15', status: 'closed' },

      // MAA (5 facilities)
      { airportId: maa, name: 'Travel Club Lounge MAA', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 5', status: 'open' },
      { airportId: maa, name: 'Madras Coffee House', type: 'restaurant', terminal: 'Terminal 1', gate: 'Gate 3', status: 'open' },
      { airportId: maa, name: 'Chennai Handloom Emporium', type: 'shop', terminal: 'Terminal 2', gate: 'Concourse B', status: 'open' },
      { airportId: maa, name: 'Terminal 1 Charging Point', type: 'charging_station', terminal: 'Terminal 1', gate: 'Gate 6', status: 'open' },
      { airportId: maa, name: 'South Express Diner', type: 'restaurant', terminal: 'Terminal 2', gate: 'Near Gate 12', status: 'closed' },

      // HYD (5 facilities)
      { airportId: hyd, name: 'Plaza Premium Lounge HYD', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 21', status: 'open' },
      { airportId: hyd, name: 'Paradise Biryani Counter', type: 'restaurant', terminal: 'Terminal 1', gate: 'Food Court', status: 'open' },
      { airportId: hyd, name: 'Pearl & Handicraft Boutique', type: 'shop', terminal: 'Terminal 1', gate: 'Near Gate 19', status: 'open' },
      { airportId: hyd, name: 'Terminal Prayer Room HYD', type: 'prayer_room', terminal: 'Terminal 1', gate: 'Airside Level 2', status: 'open' },
      { airportId: hyd, name: 'GMR High-Speed Charging Station', type: 'charging_station', terminal: 'Terminal 1', gate: 'Near Gate 24', status: 'closed' },

      // CCU (5 facilities)
      { airportId: ccu, name: 'Travel Club Lounge CCU', type: 'lounge', terminal: 'Terminal 2', gate: 'Near Gate 16', status: 'open' },
      { airportId: ccu, name: 'Flurys Bakery & Tearoom', type: 'restaurant', terminal: 'Terminal 2', gate: 'Departure Hall', status: 'open' },
      { airportId: ccu, name: 'Biswa Bangla Gift Shop', type: 'shop', terminal: 'Terminal 2', gate: 'Concourse Level 1', status: 'open' },
      { airportId: ccu, name: 'CCU Family Restroom', type: 'restroom', terminal: 'Terminal 2', gate: 'Near Gate 14', status: 'open' },
      { airportId: ccu, name: 'QuickCharge Station CCU', type: 'charging_station', terminal: 'Terminal 2', gate: 'Near Gate 18', status: 'closed' },

      // GOI (5 facilities)
      { airportId: goi, name: 'Good Times Bar & Lounge', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 2', status: 'open' },
      { airportId: goi, name: "Fisherman's Wharf Express", type: 'restaurant', terminal: 'Terminal 1', gate: 'Security Hall', status: 'open' },
      { airportId: goi, name: 'Cashew & Spices Souvenirs', type: 'shop', terminal: 'Terminal 1', gate: 'Main Hall', status: 'open' },
      { airportId: goi, name: 'Goa Transit Restroom', type: 'restroom', terminal: 'Terminal 1', gate: 'Near Gate 4', status: 'open' },
      { airportId: goi, name: 'Coastal Power Bank Rental', type: 'charging_station', terminal: 'Terminal 1', gate: 'Near Gate 1', status: 'closed' },

      // AMD (5 facilities)
      { airportId: amd, name: 'The Lounge AMD', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 3', status: 'open' },
      { airportId: amd, name: 'Sasumaa Gujarati Thali Express', type: 'restaurant', terminal: 'Terminal 1', gate: 'Food Pavilion', status: 'open' },
      { airportId: amd, name: 'Khadi & Handloom Pavilion', type: 'shop', terminal: 'Terminal 2', gate: 'Main Concourse', status: 'open' },
      { airportId: amd, name: 'Quiet Prayer Space AMD', type: 'prayer_room', terminal: 'Terminal 1', gate: 'Upper Level', status: 'open' },
      { airportId: amd, name: 'Mobile Fast Charging Station AMD', type: 'charging_station', terminal: 'Terminal 2', gate: 'Near Gate 7', status: 'closed' },

      // PNQ (5 facilities)
      { airportId: pnq, name: 'Earth Lounge Domestic PNQ', type: 'lounge', terminal: 'Terminal 1', gate: 'Near Gate 2', status: 'open' },
      { airportId: pnq, name: 'Chitale Bandhu Mithai', type: 'restaurant', terminal: 'Terminal 1', gate: 'Security Hold', status: 'open' },
      { airportId: pnq, name: 'Crossword Books & Stationery', type: 'shop', terminal: 'Terminal 1', gate: 'Departure Area', status: 'open' },
      { airportId: pnq, name: 'Passenger Comfort Restroom PNQ', type: 'restroom', terminal: 'Terminal 1', gate: 'Near Gate 1', status: 'open' },
      { airportId: pnq, name: 'Pune Express Charging Post', type: 'charging_station', terminal: 'Terminal 1', gate: 'Gate 3 Seating', status: 'closed' },

      // COK (5 facilities)
      { airportId: cok, name: 'Earth Lounge Kochi', type: 'lounge', terminal: 'Terminal 3', gate: 'Near Gate 3', status: 'open' },
      { airportId: cok, name: 'Malabar Spices Cafe', type: 'restaurant', terminal: 'Terminal 1', gate: 'Departure Pier', status: 'open' },
      { airportId: cok, name: 'Kerala Souvenirs & Ayurvedic Shop', type: 'shop', terminal: 'Terminal 3', gate: 'Concourse Pier', status: 'open' },
      { airportId: cok, name: 'Kochi Inter-Faith Prayer Area', type: 'prayer_room', terminal: 'Terminal 3', gate: 'Mezzanine', status: 'open' },
      { airportId: cok, name: 'Solar Powered Charging Deck COK', type: 'charging_station', terminal: 'Terminal 3', gate: 'Gate 5', status: 'closed' },

      // JAI (5 facilities)
      { airportId: jai, name: 'Club One Lounge JAI', type: 'lounge', terminal: 'Terminal 2', gate: 'Near Gate 2', status: 'open' },
      { airportId: jai, name: 'Rawat Sweets & Snacks', type: 'restaurant', terminal: 'Terminal 2', gate: 'Food Court', status: 'open' },
      { airportId: jai, name: 'Jaipur Blue Pottery & Crafts', type: 'shop', terminal: 'Terminal 2', gate: 'Departure Hall', status: 'open' },
      { airportId: jai, name: 'Terminal 2 Restroom Suite JAI', type: 'restroom', terminal: 'Terminal 2', gate: 'Near Gate 4', status: 'open' },
      { airportId: jai, name: 'Pink City Device Charging Hub', type: 'charging_station', terminal: 'Terminal 2', gate: 'Gate 1', status: 'closed' },
    ];

    for (const item of facilitiesSeedList) {
      await upsertFacility(item.airportId, item.name, item.type, item.terminal, item.gate, item.status);
    }
    console.log(`Facilities seeded: ${facilitiesSeedList.length} total across 11 airports.`);

    // ── 12. SEED SUPPORT CHAT SESSIONS (Task 16b) ─────────────────────────────
    // 1. One closed demo conversation
    const existingClosed = await pool.query(
      "SELECT id FROM chat_session WHERE user_id = $1 AND status = 'closed' LIMIT 1",
      [userId]
    );
    if (existingClosed.rows.length === 0) {
      const sClosedRes = await pool.query(
        `INSERT INTO chat_session (user_id, status, started_at, closed_at, updated_at)
         VALUES ($1, 'closed', now() - INTERVAL '2 days', now() - INTERVAL '2 days' + INTERVAL '8 minutes', now() - INTERVAL '2 days' + INTERVAL '8 minutes')
         RETURNING id`,
        [userId]
      );
      const sId = sClosedRes.rows[0].id;
      const closedMsgs = [
        { sender: 'user', text: 'Hi, what is the status of flight AI-101?', intent: null, offset: 480 },
        { sender: 'bot', text: 'Flight AI-101 from DEL (Delhi) to BOM (Mumbai) is currently LANDED. Scheduled departure: 10:00.', intent: 'flight_status', offset: 478 },
        { sender: 'user', text: 'Thanks for the quick update!', intent: null, offset: 475 },
        { sender: 'bot', text: 'You are welcome! Have a wonderful journey with Meridian.', intent: 'greeting', offset: 474 },
        { sender: 'bot', text: 'This support chat session has been closed. Thank you for contacting Meridian Support!', intent: 'session_closed', offset: 472 },
      ];
      for (const m of closedMsgs) {
        await pool.query(
          `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
           VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`,
          [sId, m.sender, m.text, m.intent, m.offset]
        );
      }
    }

    // 2. One escalated and waiting session
    const existingEsc = await pool.query(
      "SELECT id FROM chat_session WHERE user_id = $1 AND status = 'escalated' LIMIT 1",
      [userId]
    );
    if (existingEsc.rows.length === 0) {
      const sEscRes = await pool.query(
        `INSERT INTO chat_session (user_id, status, started_at, updated_at)
         VALUES ($1, 'escalated', now() - INTERVAL '25 minutes', now() - INTERVAL '20 minutes')
         RETURNING id`,
        [userId]
      );
      const sId = sEscRes.rows[0].id;
      const escMsgs = [
        { sender: 'user', text: 'Where can I find a quiet lounge at Terminal 3?', intent: null, offset: 25 },
        { sender: 'bot', text: 'Here are the lounge facilities at DEL:\n• Encalm Lounge — Terminal 3, Near Gate 27 [OPEN]\n• Air India Maharaja Lounge — Terminal 3, Near Gate 32 [OPEN]', intent: 'facilities', offset: 24 },
        { sender: 'user', text: 'I also have a special musical instrument with fragile luggage, can I speak to a person?', intent: null, offset: 21 },
        { sender: 'bot', text: 'I am connecting you with a member of our airport operations and support team. Please hold on while an agent joins the conversation.', intent: 'human_agent', offset: 20 },
      ];
      for (const m of escMsgs) {
        await pool.query(
          `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
           VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`,
          [sId, m.sender, m.text, m.intent, m.offset]
        );
      }
    }

    // 3. One assigned session with agent replies
    const existingAssigned = await pool.query(
      "SELECT id FROM chat_session WHERE user_id = $1 AND status = 'assigned' LIMIT 1",
      [userId]
    );
    if (existingAssigned.rows.length === 0) {
      const sAssignedRes = await pool.query(
        `INSERT INTO chat_session (user_id, status, assigned_agent_id, started_at, updated_at)
         VALUES ($1, 'assigned', $2, now() - INTERVAL '40 minutes', now() - INTERVAL '5 minutes')
         RETURNING id`,
        [userId, opsId]
      );
      const sId = sAssignedRes.rows[0].id;
      const assignedMsgs = [
        { sender: 'user', text: 'Hello, my bag tag 1000000001 seems delayed. Can an agent check on it?', intent: null, offset: 40 },
        { sender: 'bot', text: 'I am connecting you with a member of our airport operations and support team. Please hold on while an agent joins the conversation.', intent: 'human_agent', offset: 39 },
        { sender: 'bot', text: 'Devansh Verma from Airport Support has joined the chat.', intent: 'agent_joined', offset: 35 },
        { sender: 'agent', text: 'Hello Priya, this is Devansh from Airport Operations. I checked your bag tag 1000000001 in our airside scanner log.', intent: 'agent_reply', offset: 33 },
        { sender: 'agent', text: 'It has been safely transferred to Cart 2 for your flight AI-101 and is loaded into the forward cargo hold.', intent: 'agent_reply', offset: 30 },
        { sender: 'user', text: 'Wonderful, thank you so much for verifying Devansh!', intent: null, offset: 15 },
        { sender: 'agent', text: 'You are very welcome! Please reach out if you need anything else before boarding.', intent: 'agent_reply', offset: 5 },
      ];
      for (const m of assignedMsgs) {
        await pool.query(
          `INSERT INTO chat_message (session_id, sender, text, intent, "timestamp")
           VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`,
          [sId, m.sender, m.text, m.intent, m.offset]
        );
      }
    }

    console.log('Support chat demo conversations (closed, escalated, and assigned) seeded successfully.');

  console.log('Seed complete.');
  if (endPool) {
    await pool.end();
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const isForce = process.argv.includes('--force');
  if (process.env.NODE_ENV === 'production' && !isForce) {
    console.error('FATAL: Refusing to run seed script in production without --force');
    process.exit(1);
  }
  runSeed({ endPool: true, force: isForce }).catch(async (err) => {
    console.error('Seed failed:', err);
    await pool.end();
    process.exit(1);
  });
}
