# Week 4 — Booking Portal: Hold, Payment, Check-in & Boarding Pass

**Branch:** `week4`  
**Commit:** `c410fad`  
**Date:** 2026-11-12

---

## What Was Built (mapped to plan)

| Plan Bullet | Implementation |
|---|---|
| Seat hold (timed, expires) | `POST /bookings/hold` → `holdSeat()` in `bookingService.js`; `booking.held_until = now() + 10 min`; migration 003 adds column + index |
| Mock payment then confirm | `POST /bookings/:id/confirm-payment` → `confirmHeldBooking()`; checks expiry, creates `payment` row with `status = 'completed'` and `amount = price_cents` snapshot |
| E-ticket with booking reference | Crypto booking ref format `BK` + 6 Crockford-base32 chars; unique constraint + retry loop on collision |
| Web check-in | `POST /bookings/:id/check-in` → `checkInBooking()`; validates 24 h window; allows optional seat swap |
| Boarding pass PDF with QR | `GET /bookings/:id/boarding-pass` (JSON + QR data URL); `GET /bookings/:id/boarding-pass.pdf` (pdfkit stream); IATA-format QR payload |
| No-show auto-flagging | `POST /bookings/flights/:flightId/flag-no-shows` → `flagNoShowsForFlight()`: sets `status = 'no_show'` for `checked_in` bookings on departed flights |
| Cancellation and refund | `POST /bookings/:id/cancel` → `cancelBooking()`; enforces 2 h window for passengers; admin bypasses; creates payment refund row |
| Flight search filters | `GET /bookings/search-flights?origin=&destination=&date=&class=`; returns per-class fare columns computed from `base_price_cents` × multiplier |
| Frontend — search filters | `FlightSearchFilters.jsx`: origin, destination, date, class selector, swap button |
| Frontend — results | `FlightSearchResults.jsx`: real fare per class from API, duration computed from timestamps |
| Frontend — seat map | `SeatDeckMap.jsx`: grouped by cabin class, all rows rendered from actual seat data, price tooltip per seat |
| Frontend — hold checkout | `BookingHoldModal.jsx`: 10-min countdown, mock payment confirmation, assistance selection, expired state |
| Frontend — confirmation | `BookingConfirmation.jsx`: boarding pass card with booking ref, seat, gate |
| Frontend — My Flights | Updated with check-in, confirm-hold, cancel-with-refund, boarding pass link, hold timer badge |
| Frontend — Boarding Pass page | `BoardingPass.jsx`: QR data URL, print and PDF download buttons |

---

## Verbatim Test Output

```
PASS tests/week4BookingLifecycle.test.js
PASS tests/step0ConcurrencyAndCascade.test.js
PASS tests/bookingService.test.js
PASS tests/gateConflict.test.js
PASS tests/sizeCompat.test.js
PASS tests/gateAssignment.test.js
PASS tests/shiftConflict.test.js
PASS tests/resourceConflict.test.js
Test Suites: 8 passed, 8 total
Tests:       41 passed, 41 total
Time:        10.362 s
```

## Verbatim Frontend Build Output

```
vite v5.4.21 building for production...
✓ 65 modules transformed.
dist/index.html                   0.95 kB │ gzip:  0.50 kB
dist/assets/index-B3MRqoU2.css   15.73 kB │ gzip:  3.76 kB
dist/assets/index-DFQLiGXr.js   327.68 kB │ gzip: 83.57 kB
✓ built in 1.86s
```

---

## Manual Demo Script

1. **Register** a passenger at `/register`.
2. **Search flights**: `/book` → enter `DEL` → `BOM`, select "Economy", click Find Flights.
3. **Select a flight**: click any result card → interactive seat map loads.
4. **Pick a seat**: click any white seat button — tooltip shows fare.
5. **Hold seat**: click "Hold Seat & Continue" — 10-minute countdown starts.
6. **Mock payment**: confirm on the hold checkout page — booking reference displayed.
7. **My Flights**: navigate to `/my-flights` → see confirmed booking.
8. **Check in**: click "Web Check-in" (within 24h of departure).
9. **Boarding pass**: click "Boarding Pass" → QR code displayed; click "Download PDF".
10. **Cancel**: click Cancel on a confirmed booking (>2h before departure) → refund message shown.
11. **Admin no-show flag**: as admin, `POST /bookings/flights/:id/flag-no-shows` after flight departs.

---

## Known Limitations

- PDF boarding pass uses pdfkit — QR image is embedded as a base64 PNG data URL; on some systems the QR PNG rasterization may add a small delay (< 1s).
- Class filter on seat map shows only seats of the selected class. Switching class requires re-triggering flight selection.
- `BoardingPass.jsx` page uses the JSON endpoint (QR as data URL), not the PDF stream, for the digital view to avoid cross-origin blob handling in Vite dev mode.
- No-show flagging is manual (admin-triggered); automated scheduling (cron) is not wired yet — would be part of a future ops-automation week.

