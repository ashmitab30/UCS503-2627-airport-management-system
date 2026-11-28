# Baseline Audit Report (Task 0)

**Date:** 2026-11-22  
**Branch:** `ui-fixes` (branched from `week6-connections`, commit `51b952f`)  
**Scope:** Verification and codebase baseline audit (no application code changes)

---

## 1. Environment & Setup Verification

An audit of required setup files and project assets was conducted on `ui-fixes`:

| Item / Requirement | Status | Location / Notes |
|---|---|---|
| `HANDOVER.md` in repo root | **Missing** | Not present in repo root. Setup executed following standard project procedures. |
| Migrations beyond `003` | **Present** | `004_week5_turnaround_timestamps.sql`, `005_week5_delays_and_connections.sql`, `006_week6_airport_mcts.sql` |
| Delay routes file | **Present** | Implemented inside `code/backend/src/routes/flights.js` (`POST /flights/:id/delay`, `GET /flights/:id/delays`) via `delayCascadeService.js` |
| Connections routes file | **Present** | `code/backend/src/routes/connections.js` |
| `socket.io-client` in `code/frontend/package.json` | **Present** | `"socket.io-client": "^4.8.4"` |
| `src/pages/staff` directory | **Present** | 7 files: `StaffLayout.jsx`, `StaffHome.jsx`, `StaffTurnaround.jsx`, `StaffShifts.jsx`, `StaffAssistance.jsx`, `StaffEmergencies.jsx`, `StaffPassword.jsx` |
| `design/` folder with Stitch exports | **Missing** | No `design/` directory exists in repo; Stitch design requirements followed via task specs |

### Setup Steps Completed
- Environment variables configured (`code/backend/.env`, `code/frontend/.env`).
- Dependencies installed via `npm install` in both `code/backend` and `code/frontend`.
- Database migrations executed via `npm run migrate` (all 6 migrations applied to PostgreSQL).
- Database seeded via `npm run seed` (airports, aircraft types, gates, sample flights, and rebooking slots).

---

## 2. Test & Build Status

### Backend Test Suite (`npm test` in `code/backend`)
- **Test Suites:** 10 passed, 10 total
- **Tests:** 51 passed, 51 total
- **Snapshots:** 0 total
- **Execution Time:** ~13.88 s

```text
PASS tests/week4BookingLifecycle.test.js
PASS tests/week6Connections.test.js
PASS tests/step0ConcurrencyAndCascade.test.js
PASS tests/week5DelayCascade.test.js
PASS tests/bookingService.test.js
PASS tests/gateAssignment.test.js
PASS tests/resourceConflict.test.js
PASS tests/shiftConflict.test.js
PASS tests/gateConflict.test.js
PASS tests/sizeCompat.test.js

Test Suites: 10 passed, 10 total
Tests:       51 passed, 51 total
```

### Frontend Production Build (`npm run build` in `code/frontend`)
- **Status:** Clean production build with Vite
- **Modules Transformed:** 104 modules
- **Output:**
  - `dist/index.html` (0.95 kB)
  - `dist/assets/index-B3MRqoU2.css` (15.73 kB)
  - `dist/assets/index-BOlF-Wq3.js` (446.90 kB)

---

## 3. Database Migrations List

All migrations are tracked sequentially in the `schema_migrations` table and executed via `scripts/migrate.js`:

| Migration File | Description / Scope |
|---|---|
| `001_initial_schema.sql` | Baseline table definitions with `IF NOT EXISTS` for all 15 operational modules. |
| `002_step0_hardening.sql` | Added `flight.base_price_cents`, class multiplier snapshots, `passenger.passport_number/nationality/dob`, `booking.passenger_id`, emergency acknowledgement fields (`acknowledged_by`), and backfilled seat allocations for existing flights. |
| `003_week4_seat_hold.sql` | Added `booking.held_until` timestamp and index to support timed 10-minute seat holds. |
| `004_week5_turnaround_timestamps.sql` | Added `started_at`, `completed_at`, `actual_duration_seconds` to `turnaround_checklist`; widened `delay_log.reason_code` to `VARCHAR(32)`. |
| `005_week5_delays_and_connections.sql` | Added `inbound_booking_id`, `outbound_booking_id`, `min_connection_minutes`, `actual_connection_minutes` to `connection`; added `airport.min_connection_minutes`. |
| `006_week6_airport_mcts.sql` | Seeded and configured realistic Minimum Connection Times per airport (`BOM` = 45m, `DEL` = 60m, `BLR` = 40m). |

---

## 4. Backend Routes Inventory

Mounted in `code/backend/src/index.js` (67 endpoints total):

| Method | Path | Source File |
|---|---|---|
| GET | `/` | `code/backend/src/index.js` |
| GET | `/aircraft-types` | `code/backend/src/routes/aircraftTypes.js` |
| POST | `/aircraft-types` | `code/backend/src/routes/aircraftTypes.js` |
| GET | `/airports` | `code/backend/src/routes/airports.js` |
| POST | `/airports` | `code/backend/src/routes/airports.js` |
| GET | `/attendance` | `code/backend/src/routes/attendance.js` |
| POST | `/attendance/clock-in` | `code/backend/src/routes/attendance.js` |
| POST | `/attendance/clock-out` | `code/backend/src/routes/attendance.js` |
| GET | `/attendance/mine` | `code/backend/src/routes/attendance.js` |
| POST | `/auth/change-password` | `code/backend/src/routes/auth.js` |
| POST | `/auth/login` | `code/backend/src/routes/auth.js` |
| GET | `/auth/me` | `code/backend/src/routes/auth.js` |
| POST | `/auth/register` | `code/backend/src/routes/auth.js` |
| GET | `/bookings` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/:id` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/:id/boarding-pass` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/:id/boarding-pass.pdf` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings/:id/cancel` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings/:id/check-in` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings/:id/confirm-payment` | `code/backend/src/routes/bookings.js` |
| PATCH | `/bookings/assistance/:id/status` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/assistance/all` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings/flights/:flightId/flag-no-shows` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/flights/:flightId/seats` | `code/backend/src/routes/bookings.js` |
| POST | `/bookings/hold` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/mine` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/passengers/all` | `code/backend/src/routes/bookings.js` |
| GET | `/bookings/search-flights` | `code/backend/src/routes/bookings.js` |
| POST | `/connections` | `code/backend/src/routes/connections.js` |
| GET | `/connections/:id` | `code/backend/src/routes/connections.js` |
| POST | `/connections/:id/rebook` | `code/backend/src/routes/connections.js` |
| GET | `/connections/:id/rebooking-options` | `code/backend/src/routes/connections.js` |
| GET | `/connections/admin/at-risk` | `code/backend/src/routes/connections.js` |
| GET | `/connections/mine` | `code/backend/src/routes/connections.js` |
| GET | `/emergencies` | `code/backend/src/routes/emergencies.js` |
| POST | `/emergencies` | `code/backend/src/routes/emergencies.js` |
| PATCH | `/emergencies/:id/acknowledge` | `code/backend/src/routes/emergencies.js` |
| PATCH | `/emergencies/:id/resolve` | `code/backend/src/routes/emergencies.js` |
| GET | `/employees` | `code/backend/src/routes/employees.js` |
| POST | `/employees` | `code/backend/src/routes/employees.js` |
| GET | `/employees/:id` | `code/backend/src/routes/employees.js` |
| PATCH | `/employees/:id/status` | `code/backend/src/routes/employees.js` |
| GET | `/flights` | `code/backend/src/routes/flights.js` |
| POST | `/flights` | `code/backend/src/routes/flights.js` |
| GET | `/flights/:id` | `code/backend/src/routes/flights.js` |
| POST | `/flights/:id/delay` | `code/backend/src/routes/flights.js` |
| GET | `/flights/:id/delays` | `code/backend/src/routes/flights.js` |
| PATCH | `/flights/:id/gate` | `code/backend/src/routes/flights.js` |
| PATCH | `/flights/:id/status` | `code/backend/src/routes/flights.js` |
| GET | `/gates` | `code/backend/src/routes/gates.js` |
| POST | `/gates` | `code/backend/src/routes/gates.js` |
| PATCH | `/gates/:id/status` | `code/backend/src/routes/gates.js` |
| GET | `/health` | `code/backend/src/routes/health.js` |
| GET | `/resource-assignments` | `code/backend/src/routes/resourceAssignments.js` |
| POST | `/resource-assignments` | `code/backend/src/routes/resourceAssignments.js` |
| DELETE | `/resource-assignments/:id` | `code/backend/src/routes/resourceAssignments.js` |
| GET | `/resources` | `code/backend/src/routes/resources.js` |
| POST | `/resources` | `code/backend/src/routes/resources.js` |
| PATCH | `/resources/:id/status` | `code/backend/src/routes/resources.js` |
| GET | `/shifts` | `code/backend/src/routes/shifts.js` |
| POST | `/shifts` | `code/backend/src/routes/shifts.js` |
| DELETE | `/shifts/:id` | `code/backend/src/routes/shifts.js` |
| GET | `/shifts/mine` | `code/backend/src/routes/shifts.js` |
| GET | `/tracking/:flightId` | `code/backend/src/routes/tracking.js` |
| GET | `/turnaround` | `code/backend/src/routes/turnaround.js` |
| PATCH | `/turnaround/:id/status` | `code/backend/src/routes/turnaround.js` |

---

## 5. Frontend Routes Inventory

Defined in `code/frontend/src/App.jsx`:

| Frontend Route | Component | Access Restrictions / Guard |
|---|---|---|
| `/` | `HealthCheck` | Public |
| `/login` | `Login` | Public |
| `/register` | `Register` | Public |
| `/dashboard` | `DashboardRoute` (`Dashboard` or redirect to `/staff`) | Authenticated (Any role) |
| `/book` | `BookFlight` | Authenticated (Any role) |
| `/my-flights` | `MyFlights` | Authenticated (Any role) |
| `/track/:flightId` | `FlightTracking` | Authenticated (Any role) |
| `/boarding-pass/:id` | `BoardingPass` | Authenticated (Any role) |
| `/staff` | `StaffLayout` (Outlet parent) | `['ground_crew', 'security', 'medical']` |
| `/staff/` (index) | `StaffHome` | Inherited from `/staff` |
| `/staff/turnaround` | `StaffTurnaround` | `['ground_crew']` |
| `/staff/assistance` | `StaffAssistance` | `['ground_crew', 'medical']` |
| `/staff/emergencies` | `StaffEmergencies` | Inherited from `/staff` |
| `/staff/shifts` | `StaffShifts` | Inherited from `/staff` |
| `/staff/password` | `StaffPassword` | Inherited from `/staff` |
| `/admin` | `AdminLayout` (Outlet parent) | `['admin', 'ops_manager']` |
| `/admin/` (index) | `AdminDashboard` | Inherited from `/admin` |
| `/admin/flights` | `AdminFlights` | Inherited from `/admin` |
| `/admin/gates` | `AdminGates` | Inherited from `/admin` |
| `/admin/resources` | `AdminResources` | Inherited from `/admin` |
| `/admin/emergencies` | `AdminEmergencies` | Inherited from `/admin` |
| `/admin/employees` | `AdminEmployees` | `['admin']` |
| `/admin/shifts` | `AdminShifts` | Inherited from `/admin` |
| `/admin/passengers` | `AdminPassengers` | Inherited from `/admin` |
| `/admin/assistance` | `AdminAssistance` | Inherited from `/admin` |
| `/admin/bookings` | `AdminBookings` | Inherited from `/admin` |
| `/admin/connections` | `AdminConnections` | Inherited from `/admin` |
| `*` | Catch-all redirect to `/` | Public |

---

## 6. Plan Features (Weeks 1–10) vs. Implementation Status

> **Scope Note:** Per project requirements, **Predictive Analytics (delay/congestion prediction)** is intentionally excluded from scope.

| Week / Module | Planned Feature / Capability | Implementation Status | Evidence in Codebase |
|---|---|---|---|
| **Week 1: Scope, Architecture & Skeleton** | Shared operational core data model (Airport, Gate, Flight, Passenger, Resource, User), ERD, baseline schema, `/health` endpoint. | **Fully Implemented** | `code/db/schema.sql`, `code/backend/src/routes/health.js`, `code/frontend/src/App.jsx` (`HealthCheck`). |
| **Week 2: Auth & Staff Management** | JWT auth (register, login, me), password change, role-based access control, employee CRUD, shift scheduling with overlap conflict prevention, attendance clock-in/out. | **Fully Implemented** | `src/routes/auth.js`, `src/routes/employees.js`, `src/routes/shifts.js`, `src/routes/attendance.js`, `src/services/shiftConflict.js`, `tests/shiftConflict.test.js`, `StaffShifts.jsx`, `AdminShifts.jsx`, `AdminEmployees.jsx`. |
| **Week 3: Ops Core** | Gates, aircraft types, flight scheduling, automated gate suggestion with size-compatibility, gate conflict detection with buffer windows, turnaround checklist generation, resource allocation with conflict prevention. | **Fully Implemented** | `src/routes/flights.js`, `src/routes/gates.js`, `src/routes/airports.js`, `src/routes/aircraftTypes.js`, `src/routes/resources.js`, `src/routes/resourceAssignments.js`, `src/routes/turnaround.js`, `src/services/sizeCompat.js`, `src/services/gateConflict.js`, `src/services/gateAssignment.js`, `src/services/resourceConflict.js`, `tests/gateConflict.test.js`, `tests/gateAssignment.test.js`, `AdminFlights.jsx`, `AdminGates.jsx`, `AdminResources.jsx`. |
| **Week 4: Booking Portal & Check-in** | Flight search with class pricing, timed 10-minute seat holds, mock payment confirmation with fare snapshot, web check-in within 24h, PDF boarding pass with IATA QR code, booking cancellation with refunds, no-show flagging. | **Fully Implemented** | `src/routes/bookings.js`, `src/services/bookingService.js`, `src/services/seatService.js`, `tests/bookingService.test.js`, `tests/week4BookingLifecycle.test.js`, `BookFlight.jsx`, `MyFlights.jsx`, `BoardingPass.jsx`, `AdminBookings.jsx`. |
| **Week 5: Delays, Cascade & Real-Time** | IATA delay reason codes, turnaround timing tracking (`started_at`, `completed_at`, `actual_duration_seconds`), downstream flight delay cascading across shared aircraft/gate buffers, delay logging, authenticated Socket.IO rooms by role/user/flight, frontend socket client with live reconnect status pill, dedicated staff portal. | **Fully Implemented** | `src/services/delayCascadeService.js`, `src/routes/flights.js` (`POST /flights/:id/delay`), `src/index.js` (Socket.IO auth & rooms), `src/context/SocketContext.jsx` (`LiveStatusPill`), `tests/week5DelayCascade.test.js`, `code/frontend/src/pages/staff/*`. |
| **Week 6: Connecting Flights & IRROPS** | Hub MCT validation, connecting itinerary geometry checks, at-risk and missed connection detection driven by delay cascades, zero-fee IRROPS alternative flight recommendation engine, atomic transactional rebooking with PostgreSQL advisory locks, passenger Connecting Itinerary UI, Admin Connections at Risk dashboard. | **Fully Implemented** | `src/routes/connections.js`, `src/services/connectionService.js`, `tests/week6Connections.test.js`, `AdminConnections.jsx`, `MyFlights.jsx` (`RebookConnectionModal.jsx`), migrations `005` and `006`. |
| **Week 7: Baggage & Parking Management** | Baggage tagging, transfer scan status pipeline, parking slot allocation with concurrency-safe booking. | **Pending / Deferred** | Database tables `baggage`, `parking_lot`, `parking_slot`, `parking_booking` exist in `code/db/schema.sql`. Application services, routes, and UI are not yet started (scheduled for later weeks). |
| **Week 8: Accessibility & Facilities** | Special assistance request queue (wheelchair, blind, medical escort) with staff assignment; airport facilities directory (lounges, shops, gates). | **Partially Implemented** | Assistance backend routes (`/bookings/assistance/*`) and UI (`AdminAssistance.jsx`, `StaffAssistance.jsx`, `BookingHoldModal.jsx`) are active; Facilities directory table `facility` exists in schema but routes and UI are pending. |
| **Week 9: Emergency Handling & Chatbot** | Emergency declaration, broadcast alerting, role acknowledgement, and resolution permissions; Support Chatbot with intent matching. | **Partially Implemented** | Emergency handling is **Fully Implemented** (`src/routes/emergencies.js`, `emergency_event`, `emergency_alert`, `AdminEmergencies.jsx`, `StaffEmergencies.jsx`, `tests/step0ConcurrencyAndCascade.test.js`). Support Chatbot tables (`chat_session`, `chat_message`) exist in schema; bot engine and UI are pending. |
| **Week 10: Security Module & Operations Rollup** | Security checkpoints, screening logs, incident tracking, restricted zone access; holistic Admin Dashboard consolidation. | **Partially Implemented** | Admin Dashboard rollup is **Fully Implemented** across operational modules (`AdminDashboard.jsx`, `AdminLayout.jsx`). Security operational tables (`security_checkpoint`, `screening_log`, `security_incident`, `restricted_zone_access`) exist in schema; checkpoint logging UI/routes are pending. |
| **Predictive Analytics** | Machine learning delay forecasting and terminal congestion prediction models (`delay_prediction`, `congestion_forecast`). | **Excluded from Scope** | Tables exist in baseline schema `code/db/schema.sql`, but analytical modeling is intentionally omitted per project scope directives. |
