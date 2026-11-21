# Week 6 — Connecting Flights & IRROPS Rebooking

**Date:** 2026-11-21  
**Branch:** week6-connections

## What I Built This Week

This week was focused on completing the connecting flights itinerary lifecycle: Minimum Connection Time (MCT) validation, delay cascade connection status re-evaluations, transactional atomic rebooking, and the passenger & operations dashboard interfaces matching the Stitch design specifications.

### 1. Database Schema & Realistic MCTs
- Added `min_connection_minutes` to the `airport` table via migration `005` and populated realistic per-airport standards via migration `006`: **BOM = 45m**, **DEL = 60m**, **BLR = 40m**.
- Extended the `connection` table with `inbound_booking_id`, `outbound_booking_id`, `created_at`, and indexing on `(passenger_id, inbound_flight_id, outbound_flight_id)`.

### 2. Validation & Cascade Re-evaluation
- `validateAndCreateConnection`: Enforces valid geometry (`inbound.dest_id === outbound.origin_id`), rejecting mismatched routes with HTTP 400.
- Automatic status evaluation:
  - `< 20 min` layover: `missed` (gate closing threshold)
  - `< MCT`: `at_risk` (insufficient transit buffer)
  - `≥ MCT`: `on_track`
- Wired directly to `delayCascadeService.js`: when an inbound flight suffers an ATC or weather delay, all downstream connecting itineraries are recalculated and real-time events (`connection:status_changed`) are broadcast via Socket.IO.

### 3. Rebooking Engine & Concurrency Control
- `getRebookingOptions`: Scans hub departures for flights to the final destination departing after `inbound.arrival + hub.mct`, filtering out departed/cancelled flights and sorting by passenger cabin class match.
- `rebookConnection`: Fully transactional with PostgreSQL advisory lock `pg_advisory_xact_lock(5, newSeatId)` on the target seat and row lock `FOR UPDATE OF c` on the connection. Frees the old seat, cancels the old outbound booking, confirms the new seat, records a ₹0 payment snapshot (`status = 'success'`), updates the connection, and notifies clients in real time.

### 4. User Interfaces (Stitch Designs)
- **Passenger Connecting Itinerary (`MyFlights.jsx`)**: Displays multi-segment flights in an authentic perforated ticket-notch container with inbound segment, layover connector node (actual vs MCT standard, deficit indicator), outbound segment, and reactive status banners.
- **Rebooking Modal (`RebookConnectionModal.jsx`)**: Shows the original outbound booking to be cancelled, up to 3 viable alternatives with radio selection, ₹0 protection indicator, explicit confirmation button, and robust states for "no options available" and "seat conflict / try again".
- **Operations Dashboard (`AdminConnections.jsx`)**: Added "Connections at Risk" under Admin Overview with live KPI metric cards (monitored, at_risk, missed, rebooked_today), segmented filters, hub pills, and passenger search. Table is read-only pending user approval on staff rebooking permissions.

## Test & Build Results
- Backend: All 10 test suites (51 tests) passing cleanly with PostgreSQL outside sandbox.
- Frontend: Vite build transformed 104 modules with 0 errors.

## Next Steps
- Implement staff rebooking capabilities once the user approves the permissions, audit logging, and passenger notification architecture.
- Proceed to Week 7 baggage tracking.
