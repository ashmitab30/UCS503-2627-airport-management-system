# Airport Management System — Week 1: Scope & Setup

## 1. Project scope

Twelve modules, sharing one operational core (Airport, Gate, Flight, Passenger,
Resource, User). No module owns a silo of data — they all read/write the
shared core, which is the architectural point being demonstrated.

| # | Module | Tier | Owner-side users |
|---|---|---|---|
| 1 | Ops Core (flights, gates, resources, turnaround) | 1 | Admin / Ops |
| 2 | Booking Portal (search, seat lock, mock pay, e-ticket) | 1 | Passengers |
| 3 | Delay handling + cascading recalculation | 1 | Ops |
| 4 | Connecting Flights (min connection time, at-risk/missed) | 1 | Passengers / Ops |
| 5 | Emergency Handling (declare/alert/resolve) | 1 | Ops / Security / Admin |
| 6 | Predictive Analytics (delay + congestion forecasting) | 1 | Ops manager |
| 7 | Support Chatbot (live data lookup + escalation) | 1 | Passengers |
| 8 | Baggage Management (tag + status pipeline) | 2 | Ground staff / Passengers |
| 9 | Check-in (web check-in, boarding pass, no-show) | 2 | Passengers |
| 10 | Accessibility & Medical Assistance (request queue) | 2 | Passengers / Ground staff |
| 11 | Staff & Employee Management (shifts, attendance) | 2 | Admin / HR |
| 12 | Parking Management (slots, concurrency-safe booking) | 2 | Passengers / Admin |
| 13 | Facilities Directory (lounges, shops, restrooms) | 2 | Passengers |
| 14 | Security Module (checkpoints, screening, incidents) | 2 | Security staff |
| 15 | Admin Dashboard (rolls up everything above) | — | Ops manager |

**Tier 1** gets the engineering depth (concurrency, cascading logic, real-time
updates, prediction). **Tier 2** is CRUD + status pipelines done correctly but
simply. This split is intentional and is called out explicitly so it reads as
a planned decision, not a shortcut taken under deadline pressure.

## 2. Tech stack (locked for the project)

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Real-time | Socket.IO (WebSockets) |
| Frontend | React (Vite) |
| Auth | JWT, roles: `passenger`, `ground_crew`, `security`, `medical`, `ops_manager`, `admin` |
| Chatbot | Rule-based intent matching over live DB data (Week 9) |
| Payments | Mock payment service (Week 4) |
| Testing | Jest (backend), React Testing Library (frontend) |
| Deployment | Backend → Render/Railway, Frontend → Vercel, DB → managed Postgres (Render/Neon/Supabase) |

## 3. Week 1 deliverables (this week)

- [x] Finalized scope (this document)
- [x] Full ERD covering all 15 modules' entities (`docs/erd.md`)
- [x] `CREATE TABLE` migration for the entire schema (`db/schema.sql`)
- [x] Repo structure: `backend/` (Express) + `frontend/` (React/Vite)
- [x] Skeleton `/health` endpoint on the backend
- [x] Skeleton frontend page that calls `/health` and displays the result
- [ ] Deploy both, live — **you'll need to do this step yourself** since I can't
      push to GitHub or your Render/Vercel account from here. Step-by-step
      instructions are in the root `README.md`.

## 4. Risk / contingency noted up front

If a week runs long later on, the plan (from the 10-week schedule) is to
compress Week 9's predictive model down to a simple rule-based delay flag
instead of a trained regression, since it's the most self-contained module
and won't block anything downstream. Flagging this now, in Week 1, so it
reads as planned scope management rather than a scramble later.
