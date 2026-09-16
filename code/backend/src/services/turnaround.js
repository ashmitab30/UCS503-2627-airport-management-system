import { pool } from '../db/pool.js';
import { TURNAROUND_MINUTES } from './sizeCompat.js';

// Standard turnaround sequence for any flight, in order. Real ground
// ops run these roughly in parallel/overlapping, but a simple ordered
// checklist is enough to demonstrate the tracking + "flag downstream
// risk if a step runs late" idea from the architecture doc, without
// building a full scheduling engine for this one sub-feature.
const STEPS = ['deboard', 'clean', 'fuel', 'catering', 'board', 'pushback'];

// Rough share of the total turnaround buffer each step gets. Doesn't
// need to be precise — it exists so the checklist has plausible
// est_duration values to compare actual_duration against later
// (Week 5: delay cascading uses "checklist step ran over" as one
// possible delay_log reason_code).
const STEP_SHARE = {
  deboard: 0.15,
  clean: 0.15,
  fuel: 0.2,
  catering: 0.15,
  board: 0.25,
  pushback: 0.1,
};

export async function initTurnaroundChecklist(flightId, aircraftSizeClass) {
  const totalMinutes = TURNAROUND_MINUTES[aircraftSizeClass] ?? TURNAROUND_MINUTES.medium;

  const insertPromises = STEPS.map((step) => {
    const estMinutes = Math.max(5, Math.round(totalMinutes * STEP_SHARE[step]));
    return pool.query(
      `INSERT INTO turnaround_checklist (flight_id, step, status, est_duration)
       VALUES ($1, $2, 'pending', ($3 || ' minutes')::interval)
       RETURNING id, flight_id, step, status, est_duration`,
      [flightId, step, estMinutes]
    );
  });

  const results = await Promise.all(insertPromises);
  return results.map((r) => r.rows[0]);
}
