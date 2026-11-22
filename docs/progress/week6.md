# Week 6 — Connecting Flights & IRROPS Rebooking

**Branch:** `week6-connections`  
**Date:** 2026-11-21  

---

## What Was Built (mapped to plan)

| Plan Item | Implementation |
|---|---|
| **Airport Minimum Connection Time (MCT)** | Migration `005_week5_delays_and_connections.sql` and `006_week6_airport_mcts.sql` added `min_connection_minutes` to `airport` table with realistic per-airport standards: **BOM = 45m**, **DEL = 60m**, **BLR = 40m** (no invented terminals). |
| **Connecting Itinerary Validation** | `validateAndCreateConnection()` in `connectionService.js` strictly validates geometry: `inbound.dest_id === outbound.origin_id` (rejecting mismatches with clear HTTP 400). Computes initial layover time vs airport MCT and assigns initial status (`on_track`, `at_risk`, or `missed`). |
| **Status Rules & Cascade Integration** | Status logic: `missed` if actual layover < 20 min (gate closing) or either flight cancelled; `at_risk` if actual layover < airport MCT; `on_track` otherwise. `reEvaluateConnectionsForFlight()` is invoked automatically from `delayCascadeService.js` whenever inbound flights are delayed, dynamically advancing estimated arrival times and emitting `connection:status_changed` real-time events. |
| **Rebooking Suggestions Engine** | `getRebookingOptions()` dynamically scans alternative flights from transit hub to destination: scheduled after `inbound.estimated_arrival + hub.mct`, excluding cancelled/departed flights, requiring available inventory, and sorting by passenger cabin class match and earliest departure (up to 3 real slots). |
| **Atomic Transactional Rebooking** | `rebookConnection()` runs inside a single database transaction: acquires PostgreSQL advisory lock `pg_advisory_xact_lock(5, newSeatId)` to prevent double-booking races, row-locks connection with `FOR UPDATE OF c`, verifies seat availability, cancels old outbound booking, frees old seat, creates new confirmed booking, writes a $0 `payment` row with `status = 'success'` for zero-fee IRROPS protection, updates `connection`, and broadcasts live socket event. |
| **Admin Connections Endpoint** | `GET /connections/admin/at-risk` restricted to `admin` and `ops_manager`: returns real aggregate metrics (`monitored`, `at_risk`, `missed`, `rebooked_today`) and filtered connections with search and hub filtering. |
| **Rebook Missed Connection Modal** | `RebookConnectionModal.jsx` matching Stitch layout: displays original outbound booking to be cancelled, up to 3 real alternative flights with radio selection, ₹0 protection indicator, explicit confirmation button, and robust handling for "no options available" and "seat locking conflict / try again". No one-click or simulated rebooking. |
| **My Flights Connecting Itinerary View** | `MyFlights.jsx` renders multi-segment connecting itineraries in authentic perforated ticket-notch card format with inbound segment, layover connector node (actual layover vs airport MCT, shortfall/deficit badge), outbound segment, and status banners (`at_risk` in amber, `missed` in red, `on_track` in emerald). |
| **Admin Connections at Risk Dashboard** | `AdminConnections.jsx` matching Stitch layout: real KPI metric cards, status segmented tabs, hub pills (All Hubs, BOM, DEL, BLR), passenger search, and real data table with zero hardcoded values. Rebook buttons omitted awaiting user architecture approval. |
| **Real-time Navigation & Sockets** | Added "Connections at Risk" link to Admin sidebar (`AdminLayout.jsx`) and registered `/admin/connections` route (`App.jsx`). Real-time socket subscriptions update views instantly when delay cascades occur. |

---

## Verbatim Backend Test Output

```
> airport-management-backend@0.1.0 test
> node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand --forceExit

(node:4772) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS tests/week4BookingLifecycle.test.js
PASS tests/week6Connections.test.js
PASS tests/step0ConcurrencyAndCascade.test.js
PASS tests/week5DelayCascade.test.js
PASS tests/bookingService.test.js
PASS tests/shiftConflict.test.js
PASS tests/gateAssignment.test.js
PASS tests/sizeCompat.test.js
PASS tests/resourceConflict.test.js
PASS tests/gateConflict.test.js

Test Suites: 10 passed, 10 total
Tests:       51 passed, 51 total
Snapshots:   0 total
Time:        10.884 s
Ran all test suites.
```

---

## Verbatim Frontend Build Output

```
> airport-management-frontend@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 104 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.95 kB │ gzip:   0.50 kB
dist/assets/index-B3MRqoU2.css   15.73 kB │ gzip:   3.76 kB
dist/assets/index-BOlF-Wq3.js   446.90 kB │ gzip: 112.18 kB
✓ built in 3.58s
```

---

## Deliberately Omitted from Stitch Designs (and Rationale)

Per user instructions and project principles (production quality, zero fake/hardcoded data), the following elements were intentionally excluded:

1. **Demo Controls & Switchers**:
   - Removed: "Sim State Switcher", "Screen States Tester", "Simulation View" toggle, "Restore Demo", and fake sync timers.
   - *Rationale:* All application states (loading, empty, on track, at risk, missed, conflict/error) are driven by real API responses and database queries.

2. **Invented Services & Ancillary Add-ons**:
   - Removed: Electric buggy / "Ping Cart", BOM Concierge, Transfer Desk locator, transit hotel and meal vouchers, lounge access, dining credit, Gate Runner Dispatch, SMS/WhatsApp boarding pass sending.
   - *Rationale:* None of these services exist in the project scope or database schema.

3. **Data Not Supported by Schema**:
   - Removed: Terminals (T1, T2, T3), gate walking times, terminal transfer map, flight distance km, aircraft amenities (Wi-Fi, USB power), meal preference dropdowns, seat position tags ("Window"), boarding close time.
   - *Rationale:* Schema models gates and airports directly without terminal divisions. All display data strictly comes from existing database columns.

4. **Deferred Features & Upgrade Schemes**:
   - Removed: Checked baggage tracking cards, tags, and progress bars (deferred to Week 7 baggage milestone).
   - Removed: Business-class upgrade with extra fee (+₹1,200), pre-reserved standby seats, complete PDF itinerary download, "Instant Reschedule (₹0)" one-click action.
   - *Rationale:* IRROPS rebooking is passenger-confirmed with explicit radio selection; baggage tracking is scheduled for Week 7.

5. **Fake Telemetry & Marketing Claims**:
   - Removed: "Live Telemetry Feed (VOMM ATC)", "Concourse Transit Index", "Avg auto-reroute latency", "Meridian Seamless Connect Guarantee", "Transit Protocol §4.2", "Zero Penalty Protection", and hardcoded dummy passenger names/counts (e.g. 142 monitored transfers, Rajesh Sharma).
   - *Rationale:* All metric counters and table rows reflect live PostgreSQL data.

6. **Terminal-Based MCT Legend**:
   - Removed: "MCT Criteria: BOM Domestic-to-Domestic = 45m · DEL T3 Inter-Terminal = 60m".
   - *Rationale:* Standardized to airport-level `min_connection_minutes` (`BOM` 45, `DEL` 60, `BLR` 40).

7. **Staff Rebooking Buttons on Admin Table**:
   - Removed: "Rebook Passenger" and "Priority Rebook" buttons from the admin table.
   - *Rationale:* Kept read-only pending user architectural decision regarding staff permissions, audit logging, and passenger notification.

---

## Manual Verification Steps

1. **Database Seed**: Run `npm run seed` in `code/backend` to seed airports (`BOM` 45m, `DEL` 60m, `BLR` 40m), flights, and an at-risk connecting itinerary for Passenger 1 (`AI-101` DEL $\rightarrow$ BOM delayed by 38m, connecting to `6E-202` BOM $\rightarrow$ BLR with 32m actual layover vs 45m BOM MCT).
2. **Passenger Portal (`/my-flights`)**:
   - Log in as `passenger@example.com`.
   - Observe amber "Connection At Risk" banner with 32m actual vs 45m MCT and -13m deficit.
   - Click "View Rebooking Options" to open modal.
   - Select alternative flight `AI-504` and click "Confirm Rebooking (Flight AI-504)".
   - Observe atomic cancellation of `6E-202`, seat reassignment to `AI-504`, ₹0 payment snapshot, and connection status flipping to `on_track`.
3. **Admin Dashboard (`/admin/connections`)**:
   - Log in as admin (`admin@example.com`).
   - Navigate to "Connections at Risk" in the sidebar menu.
   - Verify KPI cards (monitored, at_risk, missed, rebooked_today) match database counts.
   - Test filters (All Alerts, At Risk, Missed, BOM hub, passenger search).
