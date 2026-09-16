# Airport Management System — UCS503P Project

This is a UCS503P Project (2026-27 ODD), built on the
[UCS503P template](https://github.com/tiet-ucs503/ucs503p-202627odd-template).

A multi-module airport operations platform (Ops Core, Booking, Baggage,
Connecting Flights, Emergency Handling, Accessibility, Staff, Parking,
Facilities, Security, Chatbot, Predictive Analytics, Admin Dashboard)
built on one shared operational data layer. See `docs/week1-scope.md`
for the full module list and tiering, and `docs/erd.md` for the schema
diagram.

There are 3 reports in LaTeX format, namely *a*) Project Proposal,
*b*) Project Report Prototype Stage, and *c*) Project Report Final —
each in their respective folders.

Journals are stacked under the folder `journals`, one folder per team
member, logging the week-by-week engineering work (see `journals/`).

The source code is contained within the folder `code`.

The documentation is under folder `docs`.

## Repo structure

```
.
├── code/
│   ├── backend/          Express API (JWT auth, WebSockets, all module routes)
│   ├── frontend/         React (Vite) app — passenger + admin views
│   └── db/schema.sql     Full Postgres schema, all 15 modules
├── docs/                 Scope doc + ERD + mkdocs site
├── journals/             Per-member weekly engineering journals
├── project-proposal/
├── project-report-prototype-stage/
└── project-report-final/
```

## Local setup

### 1. Database
```bash
createdb airport_db
psql -d airport_db -f code/db/schema.sql
```

### 2. Backend
```bash
cd code/backend
cp .env.example .env    # fill in your local Postgres credentials
npm install
npm run dev              # http://localhost:4000
```
Check it worked: `curl http://localhost:4000/health`

### 3. Frontend
```bash
cd code/frontend
cp .env.example .env    # VITE_API_URL, defaults to localhost:4000
npm install
npm run dev              # http://localhost:5173
```
Open the URL — you should see the API status card with `db.connected: true`.

## Deploying

This needs to be done from your own GitHub/Render/Vercel accounts —
push this repo to GitHub first, then:

**Database (Render / Neon / Supabase — any managed Postgres):**
1. Create a new Postgres instance, copy its connection string.
2. Run `psql "<connection string>" -f code/db/schema.sql` to apply the schema.

**Backend (Render or Railway):**
1. New Web Service → point at your GitHub repo, root directory `code/backend/`.
2. Build command: `npm install`. Start command: `npm start`.
3. Set env vars from `code/backend/.env.example` — use the managed DB's
   connection string for `DATABASE_URL`, and set `FRONTEND_URL` once you
   know your Vercel URL (step below).
4. Deploy, then confirm `https://<your-backend-url>/health` returns JSON
   with `db.connected: true`.

**Frontend (Vercel):**
1. New Project → point at the same repo, root directory `code/frontend/`.
2. Framework preset: Vite. Build command `npm run build`, output `dist`.
3. Env var: `VITE_API_URL=https://<your-backend-url>`.
4. Deploy, then open the URL and confirm the health card renders.

## Progress

- **Week 1**: scope finalized (12+ modules), full ERD, complete Postgres
  schema, backend/frontend skeleton with a live `/health` check.
- **Week 2**: JWT auth (roles: passenger, ground_crew, security,
  medical, ops_manager, admin), Staff & Employee Management (records,
  shift scheduling with conflict prevention, attendance), role-aware
  frontend dashboard.

## Docs

As of now, the `docs` is just an organised collection of markdown
(`md`) files. But the build procedure is using
[`mkdocs`](https://www.mkdocs.org/) backend. As a result, any commit
into the `master` branch of the github repository would result in
CI/CD based build and deployment of the documentation including the
journals.

For a local DEV-version of the docs for viewing and testing, install
the local env and issue the following command:

``` shell
make docs
```
