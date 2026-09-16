import { pool } from '../db/pool.js';
import { rangesOverlap } from './shiftConflict.js';

// Same overlap-check shape as shiftConflict.js (Week 2), applied to
// resource_assignment instead of shift. A resource (fuel truck,
// baggage cart, crew) can't be assigned to two overlapping windows.
// This duplication-by-table (not by logic — rangesOverlap is shared)
// is intentional: each table has its own FK column name, so a fully
// generic version would need more indirection than it's worth for a
// project this size.

export async function findConflictingAssignments(resourceId, startTime, endTime, excludeAssignmentId = null) {
  const params = [resourceId, startTime, endTime];
  let query = `
    SELECT id, start_time, end_time, flight_id
    FROM resource_assignment
    WHERE resource_id = $1
      AND start_time < $3
      AND end_time > $2
  `;
  if (excludeAssignmentId != null) {
    params.push(excludeAssignmentId);
    query += ` AND id <> $${params.length}`;
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function checkResourceConflict(resourceId, startTime, endTime, excludeAssignmentId = null) {
  if (!(new Date(startTime) < new Date(endTime))) {
    return { ok: false, reason: 'invalid_range', conflicts: [] };
  }
  const conflicts = await findConflictingAssignments(resourceId, startTime, endTime, excludeAssignmentId);
  return conflicts.length > 0
    ? { ok: false, reason: 'overlap', conflicts }
    : { ok: true, conflicts: [] };
}

// Exported for completeness/tests — same primitive as shiftConflict.js,
// re-exported here so tests for this file don't need to reach into a
// different module for it.
export { rangesOverlap };
