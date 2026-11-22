# Week 5 — Delays, Cascading Recalculation & Authenticated WebSockets

**Branch:** `week5`  
**Date:** 2026-11-18  

---

## What Was Built (mapped to plan)

| Plan Bullet | Implementation |
|---|---|
| IATA Delay Reason Codes | Enforced enum `('WX','TECH','ATC','LATE_INBOUND','GROUND','SEC','CREW')` on `delay_log.reason_code`. Schema migration 004/005 widened column to `VARCHAR(32)` to accommodate `LATE_INBOUND`. |
| Turnaround Timestamps | `started_at`, `completed_at`, and `actual_duration_seconds` tracked on `turnaround_checklist` table; `updateTurnaroundStepTiming()` updates timestamps on `in_progress` and `done` transitions. |
| Downstream Flight Recalculation | `delayCascadeService.js`: cascading recalculation forward for downstream flights sharing same aircraft or gate within 90-minute turnaround buffer window. Computes `bleedthrough = delay_minutes - slack`. Downstream flights updated to `status = 'delayed'` and logged with `LATE_INBOUND` and `caused_by_log_id`. |
| Delay Logging Routes | `POST /flights/:id/delay` (Zod validated, role-gated to `ops_manager`/`admin`) calls `logFlightDelayAndCascade`; `GET /flights/:id/delays` returns audit log with logged_by user name. |
| Authenticated Socket.IO Server | `src/index.js`: Socket.IO JWT verification middleware in `io.use` with generic `{ error: "Authentication failed" }` error emission. Disconnects unauthenticated clients. |
| Role & User Socket Rooms | Joined on socket connection: `user:${user.id}`, `role:${user.role}`, `ops_feed` (for ops roles), with dynamic subscription to `flight:${flightId}` via `subscribe_flight`. |
| Real-time Event Emissions | `flight:delayed`, `delay:cascade`, `flight:gate_changed`, `turnaround:step_updated` (broadcast to `role:ground_crew` and `ops_feed`), `booking:cancelled` (broadcast to affected passenger user rooms). |
| Frontend Socket Client | `src/context/SocketContext.jsx`: automatic reconnection handling with exponential backoff, auth error interception, and shared `LiveStatusPill` component (`Live` pulse / `Reconnecting` ping / `Offline`). |
| Live Push Integrations | `LiveStatusPill` and event listeners integrated into `Dashboard.jsx`, `AdminLayout.jsx`, `MyFlights.jsx`, and `StaffTurnaround.jsx`. |
| Staff Portal Extensions | Complete staff portal frontend in `src/pages/staff/` with `StaffLayout`, `StaffHome`, `StaffTurnaround`, `StaffShifts`, `StaffAssistance`, `StaffEmergencies`, `StaffPassword`. Supported by `GET /attendance/mine` and `POST /auth/change-password`. |

---

## Verbatim Test Output

```
PASS tests/week5DelayCascade.test.js
PASS tests/week4BookingLifecycle.test.js
PASS tests/step0ConcurrencyAndCascade.test.js
PASS tests/bookingService.test.js
PASS tests/gateAssignment.test.js
PASS tests/sizeCompat.test.js
PASS tests/shiftConflict.test.js
PASS tests/resourceConflict.test.js
PASS tests/gateConflict.test.js

Test Suites: 9 passed, 9 total
Tests:       46 passed, 46 total
Snapshots:   0 total
Time:        11.081 s
Ran all test suites.
```

## Verbatim Frontend Build Output

```
vite v5.4.21 building for production...
transforming...
✓ 102 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.95 kB │ gzip:   0.50 kB
dist/assets/index-B3MRqoU2.css   15.73 kB │ gzip:   3.76 kB
dist/assets/index-CwHnbdPh.js   398.35 kB │ gzip: 101.47 kB
✓ built in 2.15s
```

---

## Manual Demo Script

1. **Log a flight delay**: As `ops_manager` or `admin`, call `POST /flights/:id/delay` with `{ "delay_minutes": 45, "reason_code": "ATC", "notes": "Runway congestion" }`.
2. **Observe cascade**: Downstream flight sharing the aircraft within the 90-minute turnaround buffer has its `estimated_departure` shifted by the computed bleedthrough minutes, and a `LATE_INBOUND` cascade log is automatically appended.
3. **Live WebSocket push**: Observe `flight:delayed` and `delay:cascade` emitted to `ops_feed` and `flight:${id}` rooms. The frontend `LiveStatusPill` displays a pulsating emerald "Live" status indicator.
4. **Turnaround tracking**: As `ground_crew`, patch turnaround checklist step to `in_progress` (sets `started_at`), then to `done` (sets `completed_at` and computes `actual_duration_seconds`). Emits `turnaround:step_updated` to ground crew and ops feed.

---

## Known Limitations

- Turnaround buffer is an engineering constant fixed at 90 minutes.
- WebSocket reconnection attempts are capped at 10 attempts before falling back to manual reconnect on token refresh.
