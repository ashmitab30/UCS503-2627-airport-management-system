-- Migration 016: Enhance security_checkpoint and screening_log for checkpoint operations and screening logs

-- 1. Add status reason and updated_at to security_checkpoint
ALTER TABLE security_checkpoint ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE security_checkpoint ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Add booking_id, screened_by, and notes to screening_log
ALTER TABLE screening_log ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES booking(id) ON DELETE SET NULL;
ALTER TABLE screening_log ADD COLUMN IF NOT EXISTS screened_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE screening_log ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Create performance indexes for checkpoint history, live stats, and booking lookups
CREATE INDEX IF NOT EXISTS idx_screening_log_checkpoint_timestamp ON screening_log(checkpoint_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_screening_log_timestamp ON screening_log("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_screening_log_booking_id ON screening_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_security_checkpoint_airport_id ON security_checkpoint(airport_id);
