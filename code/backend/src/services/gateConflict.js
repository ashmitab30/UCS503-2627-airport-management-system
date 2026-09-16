import { pool } from '../db/pool.js';
import { rangesOverlap } from './shiftConflict.js';
import { TURNAROUND_MINUTES } from './sizeCompat.js';

// Reusing rangesOverlap from Week 2's shiftConflict.js rather than
// redefining it — same overlap primitive, now applied to gates instead
// of employees. This is exactly the reuse the Week 2 journal flagged
// as planned for Week 3.

// A flight's gate is assigned around its DEPARTURE (this schema stores
// one gate per flight leg, at the origin airport). We model the
// "ground window" a flight occupies its gate as a buffer before and
// after scheduled_departure, sized by aircraft class — bigger aircraft
// need a longer buffer to board/fuel/push back. This is a deliberate
// simplification vs. modeling separate arrival/departure gate legs;
// worth a line in the report.
export function computeGateWindow(scheduledDeparture, aircraftSizeClass) {
  const bufferMinutes = TURNAROUND_MINUTES[aircraftSizeClass] ?? TURNAROUND_MINUTES.medium;
  const dep = new Date(scheduledDeparture);
  const start = new Date(dep.getTime() - bufferMinutes * 60_000);
  const end = new Date(dep.getTime() + bufferMinutes * 60_000);
  return { start, end };
}

// Returns flights already holding this gate whose own ground window
// (buffer sized by THEIR aircraft type) could plausibly overlap the
// given window. We over-fetch with a generous SQL pre-filter (anything
// within +/- 3 hours of departure) then compute exact overlap in JS,
// since each candidate flight has its own buffer size.
async function findCandidateFlights(gateId, windowStart, windowEnd, excludeFlightId = null) {
  const params = [gateId, windowStart, windowEnd];
  let query = `
    SELECT f.id, f.flight_number, f.scheduled_departure, f.gate_id, at.size_class
    FROM flight f
    JOIN aircraft_type at ON at.id = f.aircraft_type_id
    WHERE f.gate_id = $1
      AND f.status NOT IN ('cancelled')
      AND f.scheduled_departure BETWEEN $2::timestamptz - INTERVAL '3 hours'
                                     AND $3::timestamptz + INTERVAL '3 hours'
  `;
  if (excludeFlightId != null) {
    params.push(excludeFlightId);
    query += ` AND f.id <> $${params.length}`;
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function checkGateConflict(gateId, windowStart, windowEnd, excludeFlightId = null) {
  if (!(new Date(windowStart) < new Date(windowEnd))) {
    return { ok: false, reason: 'invalid_range', conflicts: [] };
  }
  const candidates = await findCandidateFlights(gateId, windowStart, windowEnd, excludeFlightId);

  const conflicts = candidates.filter((c) => {
    const theirWindow = computeGateWindow(c.scheduled_departure, c.size_class);
    return rangesOverlap(
      new Date(windowStart), new Date(windowEnd),
      theirWindow.start, theirWindow.end
    );
  });

  return conflicts.length > 0
    ? { ok: false, reason: 'gate_occupied', conflicts }
    : { ok: true, conflicts: [] };
}
