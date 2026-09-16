# Week 2 : Auth & Staff/Employee Management

## Goal

Add JWT authentication and the first real feature module — Staff &
Employee Management, including shift scheduling and attendance.

## What was done

**Backend**

- `POST /auth/register` (public, passenger accounts only),
  `POST /auth/login`, `GET /auth/me`.
- `src/middleware/auth.js` — `authenticate`, `requireAuth`,
  `requireRole(...)` — shared by every protected route from here on.
- `POST /employees` (admin) — creates a `User` (staff role) +
  `Employee` record together and returns a one-time temp password;
  `GET /employees`, `GET /employees/:id` (admin, ops_manager);
  `PATCH /employees/:id/status` (admin).
- `POST /shifts` (admin, ops_manager) — rejects overlapping shifts for
  the same employee with `409` plus the conflicting rows;
  `GET /shifts`, `GET /shifts/mine`, `DELETE /shifts/:id`.
- `POST /attendance/clock-in`, `POST /attendance/clock-out`,
  `GET /attendance`.
- `src/services/shiftConflict.js` — the overlap-check logic, unit
  tested in `tests/shiftConflict.test.js`. This is the same pattern
  planned for `resource_assignment` (Week 3) and parking-slot booking
  (Week 7).

**Frontend**

- `AuthContext` — token kept in `localStorage`, validated against
  `/auth/me` on load.
- `/login`, `/register` pages.
- `/dashboard`, role-aware: passengers see a welcome card; staff see
  "My shifts" with clock in/out; admin/ops_manager see the shift
  scheduler; admin additionally sees staff management (create account
  + roster).

## Key decision

There is deliberately no public route to create an `admin` account
(see `code/backend/src/routes/auth.js`) — the first admin has to be
bootstrapped directly in the database after registering a normal
passenger account, which keeps privilege escalation out of the public
API surface entirely.

## Testing

`shiftConflict.js`'s overlap-detection logic is covered by unit tests
(`code/backend/tests/shiftConflict.test.js`), runnable with `npm test`
— no database needed, since the conflict check is pure logic over
time ranges.

## Outstanding / carried forward

- Resource assignment and parking-slot booking will reuse the same
  conflict-check pattern established here (Weeks 3 and 7).
- Remaining Tier 1 modules (Booking, Delay handling, Connecting
  Flights, Emergency Handling, Predictive Analytics, Chatbot) not yet
  started.
