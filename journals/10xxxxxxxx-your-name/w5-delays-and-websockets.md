# Week 5 — Delays, Cascading Recalculation & Authenticated WebSockets

**Date:** 2026-11-18  
**Branch:** week5

## What I Built This Week

This week was centered around real-time reactive airport operations: delay logging, downstream cascade calculations, turnaround timing, and authenticated Socket.IO communication.

### 1. Downstream Delay Cascading
When an inbound flight slips, it does not happen in a vacuum. If an aircraft lands late, every subsequent flight assigned to that airframe (or stand) within the turnaround buffer window (90 minutes) is affected.
In `delayCascadeService.js`, the cascade formula calculates:
`slack = downstream.estimated_departure - inbound.estimated_arrival`
`bleedthrough = delay_minutes - slack`
If bleedthrough > 0, downstream flights are moved to `status = 'delayed'`, their estimated departure and arrival times are advanced, and an audit entry is automatically created with reason code `LATE_INBOUND` linked to the primary delay (`caused_by_log_id`).

### 2. Turnaround Timestamps & Metrics
Turnaround tasks now record authoritative server timestamps:
- Transition to `in_progress` stamps `started_at = now()`.
- Transition to `done` stamps `completed_at = now()` and calculates `actual_duration_seconds`.
This provides real operational elapsed time data for apron performance analysis.

### 3. Authenticated Socket.IO Architecture
- Socket handshake verifies JWT tokens in `io.use` middleware, safely rejecting invalid tokens with a generic `"Authentication failed"` message.
- Client sockets automatically join private user rooms (`user:${id}`), role rooms (`role:${role}`), and operations rooms (`ops_feed` for authorized staff).
- Passengers receive direct events on cancellation (`booking:cancelled`). Ground crew receive `turnaround:step_updated`. Ops staff receive `flight:delayed`, `delay:cascade`, and `flight:gate_changed`.

### 4. Frontend Socket Client & Live Indicators
- Created `SocketContext.jsx` with automatic reconnection handling, state tracking, and a reusable `LiveStatusPill` component.
- Added live pills and event listeners to `Dashboard.jsx`, `AdminLayout.jsx`, `MyFlights.jsx`, and `StaffTurnaround.jsx`.

## Test Results

All 9 test suites pass cleanly (46 total tests), including concurrency and state transitions against PostgreSQL. Frontend build produces a clean bundle of 102 transformed modules with 0 errors.

## What's Next

Week 6: Connecting flights validation (MCT check), at-risk/missed connection detection driven by delay cascades, and passenger rebooking options.
