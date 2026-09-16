# Week 3 : Ops Core — Flights, Gates, Turnaround & Resources

## Goal

Build the core scheduling engine: flights, gates, gate auto-assignment
with size-compatibility and conflict checking, the turnaround
checklist, and resource (fuel truck / baggage cart / crew) allocation
with the same no-double-booking rule as Week 2's shifts.

## What was done

**Backend**

- `airport`, `aircraft_type`: reference data, admin-managed
  (`GET/POST /airports`, `GET/POST /aircraft-types`).
- `GET/POST /gates`, `PATCH /gates/:id/status` (admin, ops_manager).
- `src/services/sizeCompat.js` — `gateCanHost(aircraftSize, gateSize)`
  (a gate can host an aircraft at or below its own size class) and
  `TURNAROUND_MINUTES` per size class, used by both gate-window
  calculation and the turnaround checklist's estimated durations.
- `src/services/gateConflict.js` — `computeGateWindow()` (buffer around
  scheduled departure, sized by aircraft class) and
  `checkGateConflict()`, reusing `rangesOverlap` from Week 2's
  `shiftConflict.js` rather than redefining it.
- `src/services/gateAssignment.js` — `suggestGate()`: greedy
  smallest-compatible-first search over a gate list, using
  `checkGateConflict` to skip busy gates.
- `POST /flights` — auto-assigns a gate when `gate_id` is omitted;
  when supplied, validates it through the *same* compatibility +
  conflict checks as the auto path, so a manual request can't bypass
  the rule. Also auto-generates the turnaround checklist
  (`src/services/turnaround.js`) on creation.
- `GET /flights`, `GET /flights/:id` (with checklist),
  `PATCH /flights/:id/gate` (reassignment, re-validated),
  `PATCH /flights/:id/status`.
- `PATCH /turnaround/:id/status` — ground_crew can now write, not just
  read; marking a step `done` accepts an explicit
  `actual_duration_minutes` (see "Known simplification" below).
- `src/services/resourceConflict.js` — same overlap pattern as
  `shiftConflict.js`, applied to `resource_assignment`.
- `POST /resources`, `GET /resources`, `PATCH /resources/:id/status`;
  `POST/GET/DELETE /resource-assignments` with conflict checking.
- `scripts/seed.js` — 3 airports, 3 aircraft types, 6 gates (mixed
  sizes) so the demo has something to actually conflict over.

**Frontend**

- `pages/OpsCore.jsx` (admin, ops_manager): reference-data quick-add,
  gate manager, flight scheduler (auto-assign toggle, conflict errors
  surfaced with the specific conflicting flight), resource manager.
- `pages/OpsCore.jsx` also exports `TurnaroundBoard` (ground_crew): a
  simple pending-tasks list with a "mark done" action.
- Wired into `Dashboard.jsx` alongside the Week 2 sections.

## Key decision

The gate-conflict rule is enforced identically whether a gate is
auto-assigned or manually typed in by an ops manager — the manual path
calls the exact same `checkGateConflict` / `gateCanHost` functions
the auto-suggest path uses. This was a deliberate choice: a conflict
rule that only applies to one entry path isn't a real rule.

## Known simplification

This schema stores one gate per flight leg (assigned around
departure), not separate arrival/departure gate legs — a flight's
"ground window" is modeled as a buffer before/after
`scheduled_departure`, sized by aircraft class, rather than tracking
true gate occupancy from touchdown to pushback. Documented in
`gateConflict.js`. Also, `turnaround_checklist` has no `started_at`
column yet, so `actual_duration` is supplied by the caller when
marking a step done rather than computed from elapsed time — adding
those timestamp columns is a named follow-up for Week 5, when delay
cascading needs "did a step run over its estimate" as a signal.

## Testing

`sizeCompat.test.js` (pure), `gateConflict.test.js`,
`gateAssignment.test.js`, `resourceConflict.test.js` — all
mock-DB-backed like Week 2's `shiftConflict.test.js`. 30 tests total
across the suite (Week 2 + Week 3), all passing.

Beyond unit tests, the full flow was verified against a real local
Postgres instance (schema → seed → live API calls): auto-assign
correctly skips a busy or size-incompatible gate and lands on the next
compatible one; a manual gate request on an occupied gate is rejected
with `409` and the specific conflicting flight; a resource
double-booking is rejected the same way; turnaround steps update
correctly. Screenshots/transcript in the Week 3 report.

## Outstanding / carried forward

- Resource assignment doesn't yet check aircraft/turnaround-step
  compatibility (e.g. a `crew` resource assigned to a `fuel` step) —
  it only prevents double-booking the resource itself. Fine for now;
  worth a line in the final report as a scoping decision.
- Remaining Tier 1 modules (Booking, Delay cascading, Connecting
  Flights, Emergency Handling, Predictive Analytics, Chatbot) not yet
  started — next up is Week 4 (Booking + Check-in).
