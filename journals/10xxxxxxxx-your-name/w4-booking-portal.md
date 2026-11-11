# Week 4 — Booking Portal: Hold, Payment, Check-in & Boarding Pass

**Date:** 2026-11-12  
**Branch:** week4

## What I Built This Week

The passenger booking flow is now end-to-end and production-safe.

The most interesting engineering challenge was the **seat hold race condition**. The previous code had a check-then-insert pattern that could double-book under concurrent requests. The fix was `pg_advisory_xact_lock(5, seat_id)` — the same advisory-lock pattern used for gates and shifts, but on domain 5 (SEAT). I tested it by firing 5 concurrent `holdSeat` calls for the same seat and confirming only one wins (409 for the other four).

The **10-minute hold countdown** in `BookingHoldModal.jsx` runs in the browser using the server-returned `held_until` timestamp so it's authoritative even if the client clock differs. When it hits zero, the modal flips to an expired state and the hold is cleaned up server-side on the next seat-load call via `cleanupExpiredHolds`.

**PDF boarding pass** generation uses `pdfkit` + `qrcode`. The QR payload follows IATA BCBP format: `M1<name> E<booking_ref> <origin><dest><flight> <seat> <STATUS>`. The PDF renders an airline banner, all flight details, and the QR code in one stream — no temp files.

**Frontend modularization**: `BookFlight.jsx` was 775 lines; I split it into five focused components (`FlightSearchFilters`, `FlightSearchResults`, `SeatDeckMap`, `BookingHoldModal`, `BookingConfirmation`), all under 260 lines each, with the orchestrator at 308 lines. The seat map now renders the full aircraft from actual API data (all rows and columns) grouped by class, not just 6 hardcoded rows.

## Test Results

8 test suites, 41 tests — all pass. Concurrency tests (parallel hold, parallel shift conflict, parallel resource conflict) all verified.

## What's Next

Week 5: IATA delay reason codes, turnaround started_at/completed_at timestamps, cascading downstream flight recalculation, Socket.IO authenticated rooms, and the frontend socket client with reconnect handling.

