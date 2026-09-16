![Tiet Logo](assets/tiet-logo.svg){ .tiet-logo }

**UCS503: Software Engineering (Project)**  
**TIET Patiala**

# Airport Management System

**Author(s)**:

`(TODO)` Your Name `<your-email -at- thapar -dot- edu>`

A multi-module airport operations platform — Ops Core, Booking, Baggage,
Connecting Flights, Emergency Handling, Accessibility, Staff & Employee
Management, Parking, Facilities, Security, a Support Chatbot, Predictive
Analytics, and an Admin Dashboard — all built on one shared operational
data layer (Airport, Gate, Flight, Passenger, Resource, User). See
[Week 1 scope](week1-scope.md) for the full module list and tiering, and
[ERD](erd.md) for the schema diagram.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Real-time | Socket.IO (WebSockets) |
| Frontend | React (Vite) |
| Auth | JWT, roles: `passenger`, `ground_crew`, `security`, `medical`, `ops_manager`, `admin` |
| Testing | Jest (backend), React Testing Library (frontend) |
| Deployment | Backend → Render/Railway, Frontend → Vercel, DB → managed Postgres |

## Installation

### 1. Database
``` shell
createdb airport_db
psql -d airport_db -f code/db/schema.sql
```

### 2. Backend
``` shell
cd code/backend
cp .env.example .env    # fill in your local Postgres credentials
npm install
npm run dev              # http://localhost:4000
```
Check it worked: `curl http://localhost:4000/health`

### 3. Frontend
``` shell
cd code/frontend
cp .env.example .env    # VITE_API_URL, defaults to localhost:4000
npm install
npm run dev              # http://localhost:5173
```

## Usage

Open the frontend URL — you should see the API status card with
`db.connected: true`. Register a passenger account, then promote it to
`admin` directly in the database (see `code/backend/src/routes/auth.js`
for why there's no public admin-creation route) to explore the Staff
Management, shift scheduling, and attendance panels.

## Progress so far

- **Week 1** — scope finalized across 15 modules (tiered by engineering
  depth), full ERD, complete Postgres schema, backend/frontend skeleton
  with a live `/health` check.
- **Week 2** — JWT auth (register/login/me), Staff & Employee Management
  (records, shift scheduling with overlap-conflict rejection, unit
  tested), Attendance clock-in/clock-out, and role-aware frontend
  (login/register pages, dashboard with passenger/staff/admin views).

See the [journals](../journals/) for the week-by-week engineering log.
