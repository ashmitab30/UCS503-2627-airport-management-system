import { pool } from '../db/pool.js';

/**
 * Generates seats for a flight based on aircraft type capacity and layout.
 * Runs inside the flight creation transaction so seats are always available immediately.
 */
export async function generateSeatsForFlight(flightId, aircraftTypeId, dbClient = pool) {
  const { rows } = await dbClient.query(
    'SELECT capacity, size_class, model FROM aircraft_type WHERE id = $1',
    [aircraftTypeId]
  );
  if (rows.length === 0) {
    throw new Error(`Aircraft type ${aircraftTypeId} not found`);
  }
  const { capacity, size_class } = rows[0];

  const seats = [];

  if (size_class === 'small') {
    // 2+2 layout (A, B, C, D) e.g. ATR 72
    const letters = ['A', 'B', 'C', 'D'];
    let count = 0;
    let row = 1;
    while (count < capacity) {
      for (const letter of letters) {
        if (count >= capacity) break;
        const seatClass = row <= 2 ? 'premium_economy' : 'economy';
        seats.push({ seatNumber: `${row}${letter}`, seatClass });
        count++;
      }
      row++;
    }
  } else if (size_class === 'large' || size_class === 'jumbo') {
    // 3-3-3 layout (A, B, C, D, E, F, G, H, J) e.g. Boeing 777
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];
    let count = 0;
    let row = 1;
    while (count < capacity) {
      for (const letter of letters) {
        if (count >= capacity) break;
        let seatClass = 'economy';
        if (row <= 4) seatClass = 'first';
        else if (row <= 10) seatClass = 'business';
        else if (row <= 16) seatClass = 'premium_economy';
        seats.push({ seatNumber: `${row}${letter}`, seatClass });
        count++;
      }
      row++;
    }
  } else {
    // Standard 3-3 layout (A, B, C, D, E, F) e.g. Airbus A320
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    let count = 0;
    let row = 1;
    while (count < capacity) {
      for (const letter of letters) {
        if (count >= capacity) break;
        let seatClass = 'economy';
        if (row <= 3) seatClass = 'business';
        else if (row <= 6) seatClass = 'premium_economy';
        seats.push({ seatNumber: `${row}${letter}`, seatClass });
        count++;
      }
      row++;
    }
  }

  // Bulk insert seats in chunks to respect parameter limits
  const chunkSize = 100;
  for (let i = 0; i < seats.length; i += chunkSize) {
    const chunk = seats.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let pIdx = 1;

    for (const s of chunk) {
      params.push(flightId, s.seatNumber, s.seatClass);
      values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++})`);
    }

    await dbClient.query(
      `INSERT INTO seat (flight_id, seat_number, class)
       VALUES ${values.join(',')}
       ON CONFLICT (flight_id, seat_number) DO NOTHING`,
      params
    );
  }

  return seats.length;
}
