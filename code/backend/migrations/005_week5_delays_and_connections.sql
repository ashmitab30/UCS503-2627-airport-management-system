-- 005_week5_delays_and_connections.sql
-- 1. Expands delay_log reason_code from VARCHAR(10) to VARCHAR(32) to support 'LATE_INBOUND'.
-- 2. Adds min_connection_minutes to airport (default 60 min, admin editable).
-- 3. Adds inbound_booking_id and outbound_booking_id to connection table for passenger itineraries.

BEGIN;

-- ── 1. Fix delay_log reason_code width ───────────────────────────────────────
ALTER TABLE delay_log
  ALTER COLUMN reason_code TYPE VARCHAR(32);

-- ── 2. Airport Minimum Connection Time (MCT) ─────────────────────────────────
ALTER TABLE airport
  ADD COLUMN IF NOT EXISTS min_connection_minutes INTEGER NOT NULL DEFAULT 60;

-- ── 3. Connection table extensions ──────────────────────────────────────────
ALTER TABLE connection
  ADD COLUMN IF NOT EXISTS inbound_booking_id INTEGER REFERENCES booking(id),
  ADD COLUMN IF NOT EXISTS outbound_booking_id INTEGER REFERENCES booking(id),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_connection_passenger ON connection(passenger_id);
CREATE INDEX IF NOT EXISTS idx_connection_inbound_flight ON connection(inbound_flight_id);
CREATE INDEX IF NOT EXISTS idx_connection_outbound_flight ON connection(outbound_flight_id);

COMMIT;
