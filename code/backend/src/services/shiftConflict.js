import { pool } from '../db/pool.js';

// Standard interval-overlap check: two ranges [aStart, aEnd) and
// [bStart, bEnd) overlap iff aStart < bEnd AND bStart < aEnd.
// This is the exact pattern the architecture doc calls out for reuse in
// Week 3 (resource_assignment) and Week 7 (parking_slot booking) — same
// shape, different table.
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Returns the list of existing shifts for this employee that overlap
// the given window. Pass excludeShiftId when checking an *update* to an
// existing shift, so it doesn't conflict with itself.
export async function findConflictingShifts(employeeId, startTime, endTime, excludeShiftId = null) {
  const params = [employeeId, startTime, endTime];
  let query = `
    SELECT id, start_time, end_time, area_assigned
    FROM shift
    WHERE employee_id = $1
      AND start_time < $3
      AND end_time > $2
  `;
  if (excludeShiftId != null) {
    params.push(excludeShiftId);
    query += ` AND id <> $${params.length}`;
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

// Throws-free helper for routes: returns { ok: true } or
// { ok: false, conflicts }.
export async function checkShiftConflict(employeeId, startTime, endTime, excludeShiftId = null) {
  if (!(new Date(startTime) < new Date(endTime))) {
    return { ok: false, reason: 'invalid_range', conflicts: [] };
  }
  const conflicts = await findConflictingShifts(employeeId, startTime, endTime, excludeShiftId);
  return conflicts.length > 0
    ? { ok: false, reason: 'overlap', conflicts }
    : { ok: true, conflicts: [] };
}
