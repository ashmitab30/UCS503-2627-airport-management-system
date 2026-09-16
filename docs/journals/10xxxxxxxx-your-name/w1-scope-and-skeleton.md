# Week 1 : Scope, ERD, Schema & Skeleton Deploy

## Goal

Finalize the project scope, design the shared data model, and stand up
a deployable backend/frontend skeleton before any feature work begins.

## What was done

- Locked the scope to 15 modules (Ops Core, Booking, Baggage,
  Connecting Flights, Emergency Handling, Predictive Analytics,
  Support Chatbot, Check-in, Accessibility & Medical Assistance, Staff
  & Employee Management, Parking, Facilities Directory, Security,
  Admin Dashboard), split into **Tier 1** (engineering depth —
  concurrency, cascading logic, real-time updates, prediction) and
  **Tier 2** (CRUD + status pipelines). See `docs/week1-scope.md`.
- Chose the shared operational core: `Airport`, `Gate`, `Flight`,
  `Passenger`, `Resource`, `User` — every module reads/writes this
  core instead of owning a private data silo.
- Locked the tech stack: Node.js + Express, PostgreSQL, Socket.IO,
  React (Vite), JWT auth with six roles, Jest / React Testing Library
  for tests.
- Wrote the full ERD covering all 15 modules' entities
  (`docs/erd.md`) and the corresponding `CREATE TABLE` migration
  (`code/db/schema.sql`).
- Scaffolded the repo: `code/backend` (Express) and `code/frontend`
  (React/Vite), with a skeleton `/health` endpoint on the backend and
  a skeleton frontend page that calls it and renders `db.connected`.

## Key decision

The Tier 1 / Tier 2 split was made explicit up front rather than
discovered under deadline pressure later — Tier 1 modules are where
the harder engineering problems (conflict detection, cascading
recalculation, real-time state) are demonstrated; Tier 2 modules
prove the same data layer supports simpler CRUD flows cleanly.

## Outstanding / carried to Week 2

- Live deployment (backend → Render/Railway, frontend → Vercel, DB →
  managed Postgres) — instructions are documented in the root
  `README.md`, to be executed from the team's own hosting accounts.
- Auth (JWT, six roles) and the first real feature module — Staff &
  Employee Management.
