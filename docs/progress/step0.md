# Progress Report — Step 0: Fix Existing Problems & System Hardening

**Branch:** `step0`  
**Date:** 2026-11-12  
**Status:** Completed & Verified (All tests passing, builds clean, live PostgreSQL verified)

---

## 1. What Was Built (Mapped to Plan & Step 0 Requirements)

- **1. Advisory Transaction Locks for Concurrency Safety:**
  - Implemented `pg_advisory_xact_lock(domain, id)` within single transaction clients for:
    - Shifts (`routes/shifts.js` using `ADVISORY_LOCK_DOMAINS.EMPLOYEE`)
    - Resource assignments (`routes/resourceAssignments.js` using `ADVISORY_LOCK_DOMAINS.RESOURCE`)
    - Gate assignments & reassignments (`routes/flights.js` using `ADVISORY_LOCK_DOMAINS.GATE`)
  - Updated conflict detection services (`shiftConflict.js`, `resourceConflict.js`, `gateConflict.js`, `gateAssignment.js`) to execute against the same transactional client.
- **2. Unified Real Fares & Snapshots:**
  - Added `flight.base_price_cents` (default 5000) and `booking.price_cents` to schema.
  - Implemented class multipliers: Economy ($1.0\times$), Premium Economy ($1.4\times$), Business ($2.2\times$), First ($3.5\times$).
  - Search (`/bookings/search-flights`), seat map (`/bookings/flights/:flightId/seats`), booking execution, and payment record now use identical deterministic pricing and snapshot the charged amount at booking creation.
- **3. Route Input Validation:**
  - Added Zod schemas with unified middleware (`middleware/validate.js`) ensuring `flight_id` and `seat_id` are validated positive integers.
  - Returns standard HTTP 400 with `{ error: 'Validation failed', details: [...] }`.
- **4. Seat Generation Race Safety & Aircraft Type Capacity:**
  - Created `services/seatService.js` to automatically pre-generate all seats inside the flight creation transaction (`POST /flights`).
  - Seat layouts and capacities match the actual aircraft types (ATR 72: 78 seats; Airbus A320: 180 seats; Boeing 777: 396 seats).
  - Added database migration `002_step0_hardening.sql` backfilling seats for existing flights.
- **5. Flight Status State Machine & Cancellation Cascades:**
  - Enforced strict state transitions (`scheduled` $\to$ `boarding` / `delayed` / `cancelled`, etc.) in `PATCH /flights/:id/status`.
  - When a flight transitions to `cancelled`, an atomic cascade executes:
    - Gate is released (`gate_id = NULL`).
    - Resource assignments are deleted.
    - Active bookings are updated to `'cancelled'`.
    - Successful payments are marked `'refunded'`.
    - Booked seats are freed (`is_booked = false`).
    - WebSocket events `flight:status_updated` and `flight:cancelled` are emitted.
- **6. Emergency Resolution Permissions & Employee Attribution:**
  - Restricted `PATCH /emergencies/:id/resolve` to alerted roles, admin, or ops_manager. Non-alerted roles attempting resolution receive HTTP 403 Forbidden.
  - Updated `emergency_alert` with `acknowledged_by INTEGER REFERENCES "user"(id)`.
  - `PATCH /emergencies/:id/acknowledge` records both `acknowledged_at` and `acknowledged_by`.
- **7. Assistance Status Staff Assignment Fix:**
  - Updated `PATCH /bookings/assistance/:id/status` so `assigned_staff_id` is assigned when transitioning to `'assigned'`, and preserved without overwrite on subsequent transitions (`in_progress`, `completed`).
- **8. Cryptographic Booking References:**
  - Replaced `Math.random()` with `crypto.randomBytes(6)` generating unambiguous base32 Crockford-style references (`BK` + 6 chars).
  - Added unique constraint retry loop.
- **9. Passenger Table Linkage (Option B):**
  - Added `booking.passenger_id REFERENCES passenger(id)`.
  - Added Stitch registry columns (`passport_number`, `nationality`, `date_of_birth`, `created_at`) to `passenger`.
  - Backfilled existing bookings with passenger records.
- **10. Security Hardening & Pagination:**
  - Installed and configured `helmet` for security headers.
  - Added rate limiting: 1000 req/15min globally, 30 req/15min on `/auth/login` and `/auth/register`.
  - Enforced production security check: server refuses to start if `NODE_ENV === 'production'` and `JWT_SECRET` is missing or default.
  - Added pagination (`limit` default 50, `offset` default 0) to all list endpoints.
  - Restricted CORS and Socket.IO origin to `FRONTEND_URL`.
- **11. Numbered Database Migration System:**
  - Created `code/backend/migrations/`:
    - `001_initial_schema.sql` (safe baseline with `IF NOT EXISTS`)
    - `002_step0_hardening.sql` (fares, seat backfill, passenger linkage, alert attribution)
  - Created `code/backend/scripts/migrate.js` tracking executed migrations in `schema_migrations`.
  - Added `"migrate": "node scripts/migrate.js"` to `package.json`.
- **12. Constants & Refactoring:**
  - Created `code/backend/src/constants/index.js` consolidating roles, lock domains, and status transitions.
  - Extracted `code/backend/src/services/bookingService.js`.
  - Updated API root message to show current version (0.2.0) and operational modules.
  - Cross-platform test runner: updated `"test"` script to use `./node_modules/jest/bin/jest.js --runInBand --forceExit`.

---

## 2. Test & Build Outputs (Verbatim)

### Backend Test Suite:
```
> airport-management-backend@0.1.0 test
> node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand --forceExit

PASS tests/step0ConcurrencyAndCascade.test.js
PASS tests/sizeCompat.test.js
PASS tests/bookingService.test.js
PASS tests/shiftConflict.test.js
PASS tests/resourceConflict.test.js
PASS tests/gateConflict.test.js
PASS tests/gateAssignment.test.js

Test Suites: 7 passed, 7 total
Tests:       35 passed, 35 total
Snapshots:   0 total
Time:        2.832 s, estimated 3 s
Ran all test suites.
```

### Frontend Build (`npm run build`):
```
> airport-management-frontend@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 59 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.95 kB │ gzip:  0.50 kB
dist/assets/index-B3MRqoU2.css   15.73 kB │ gzip:  3.76 kB
dist/assets/index-KJDs7oes.js   306.10 kB │ gzip: 79.11 kB
✓ built in 1.38s
```

### Live PostgreSQL / Database Verification:
```
Applying migration: 001_initial_schema.sql...
✓ Applied 001_initial_schema.sql
Applying migration: 002_step0_hardening.sql...
✓ Applied 002_step0_hardening.sql
Database is up to date. No pending migrations.
```

---

## 3. Manual Demo Script (for Evaluation / Reporting)

1. **Verify Migrations & Database:**
   ```bash
   cd code/backend
   npm run migrate
   # Expected output: "Database is up to date. No pending migrations."
   npm run seed
   # Expected output: Seeds airports, aircraft types, gates, sample flights AI-101 and 6E-202 with pre-generated seats.
   ```
2. **Verify Real Pricing & Seat Lock:**
   - Run `curl http://localhost:4000/bookings/search-flights`
   - Observe `base_price_cents` (6500) and computed class fares: Economy (65.00), Business (143.00).
   - Query seats: `curl http://localhost:4000/bookings/flights/5/seats`
   - Note `is_available: true` and `price_cents: 14300` for Business seats.
3. **Verify Concurrency Safety:**
   - Run `npm test`
   - Note the output of `tests/step0ConcurrencyAndCascade.test.js`: 5 simultaneous seat bookings fired in parallel $\to$ exactly 1 succeeds with HTTP 201, 4 fail with HTTP 409 Conflict.
4. **Verify Flight State Machine & Cancellation Cascade:**
   - Transition flight AI-101 to cancelled via `PATCH /flights/5/status` with `{"status": "cancelled"}`.
   - Observe cascade report: gate freed (`gate_id: null`), seats freed, all bookings cancelled and refunded.
5. **Verify Emergency Authorization:**
   - Attempt to resolve medical emergency with non-alerted staff role (`ground_crew`) $\to$ rejected with HTTP 403 Forbidden.
   - Resolve with alerted role (`medical` or `admin`) $\to$ succeeds with HTTP 200.

---

## 4. Known Limitations & Deferred Items

- Full timed seat holding (expiring reservations with countdown before payment) and boarding pass PDF generation belong to Week 4 and will be implemented in the Week 4 phase.
- Live WebSockets client on frontend with room subscription belongs to Week 5.
- The `passenger` table is linked 1-to-1 per booking for now; multi-passenger bookings per itinerary remain deferred per user guidance.
