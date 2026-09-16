import { pool } from '../db/pool.js';
import { gateCanHost } from './sizeCompat.js';
import { computeGateWindow, checkGateConflict } from './gateConflict.js';

// Auto-suggest a gate for a flight: among gates at the origin airport
// that are (a) size-compatible with the aircraft and (b) not under
// maintenance/locked, pick the first one whose ground window doesn't
// conflict with anything already scheduled there. Smallest-compatible
// gate first, so large gates stay free for aircraft that actually need
// them — a simple greedy heuristic, not a true optimizer, and that
// trade-off is worth naming explicitly in the report (see architecture
// doc's note on gate-assignment optimization as a stretch goal).
export async function suggestGate(originAirportId, aircraftSizeClass, scheduledDeparture, excludeFlightId = null) {
  const { rows: gates } = await pool.query(
    `SELECT id, code, size_class FROM gate
     WHERE airport_id = $1 AND status = 'available'
     ORDER BY
       CASE size_class WHEN 'small' THEN 1 WHEN 'medium' THEN 2 WHEN 'large' THEN 3 ELSE 4 END`,
    [originAirportId]
  );

  const compatible = gates.filter((g) => gateCanHost(aircraftSizeClass, g.size_class));
  if (compatible.length === 0) {
    return { gate: null, reason: 'no_compatible_gate' };
  }

  const { start, end } = computeGateWindow(scheduledDeparture, aircraftSizeClass);

  for (const gate of compatible) {
    const result = await checkGateConflict(gate.id, start, end, excludeFlightId);
    if (result.ok) {
      return { gate, reason: null };
    }
  }

  return { gate: null, reason: 'all_compatible_gates_busy' };
}
