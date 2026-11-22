-- 004_week5_turnaround_timestamps.sql
-- Adds actual start/complete timestamps to turnaround checklist steps,
-- extends delay_log with IATA reason codes and cascade tracking,
-- and adds estimated_departure/arrival to flight for delay cascade.

BEGIN;

-- ── Turnaround step timing ─────────────────────────────────────────────────
ALTER TABLE turnaround_checklist
  ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- actual_duration_seconds as a regular (non-generated) column updated on write
-- (Postgres generated columns cannot reference mutable functions; we set it in app code)
ALTER TABLE turnaround_checklist
  ADD COLUMN IF NOT EXISTS actual_duration_seconds INTEGER;

-- ── delay_log — extend the existing table ─────────────────────────────────
-- Existing columns: id, flight_id, reason_code, minutes, logged_by, timestamp
-- We rename/add to match the Week 5 schema without dropping data.

-- Add new columns if they don't exist yet
ALTER TABLE delay_log
  ADD COLUMN IF NOT EXISTS delay_minutes    INTEGER,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS logged_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_cascade       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS caused_by_log_id INTEGER REFERENCES delay_log(id);

-- Backfill new columns from old ones for existing rows
UPDATE delay_log
   SET delay_minutes = minutes,
       logged_at     = "timestamp"
 WHERE delay_minutes IS NULL;

-- Make delay_minutes NOT NULL after backfill
ALTER TABLE delay_log
  ALTER COLUMN delay_minutes SET NOT NULL,
  ALTER COLUMN logged_at     SET DEFAULT now();

-- Enforce IATA reason code enum via check constraint (drop old one first if present)
ALTER TABLE delay_log DROP CONSTRAINT IF EXISTS delay_log_reason_code_check;
ALTER TABLE delay_log ADD CONSTRAINT delay_log_reason_code_check
  CHECK (reason_code IN ('WX','TECH','ATC','LATE_INBOUND','GROUND','SEC','CREW'));

CREATE INDEX IF NOT EXISTS idx_delay_log_flight    ON delay_log(flight_id);
CREATE INDEX IF NOT EXISTS idx_delay_log_logged_at ON delay_log(logged_at DESC);

-- ── Flight estimated times for cascade ────────────────────────────────────
ALTER TABLE flight
  ADD COLUMN IF NOT EXISTS estimated_departure TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_arrival   TIMESTAMPTZ;

-- Backfill: set estimated = scheduled for existing flights
UPDATE flight
   SET estimated_departure = scheduled_departure,
       estimated_arrival   = scheduled_arrival
 WHERE estimated_departure IS NULL;

COMMIT;
