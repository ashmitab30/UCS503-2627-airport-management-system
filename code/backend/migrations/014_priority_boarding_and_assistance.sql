-- 014_priority_boarding_and_assistance.sql
-- Migration 014: Priority boarding tied to check-in, and finishing assistance requests.

-- 1. Add boarding_group to booking table
-- Group 1: Priority boarding (assistance request or business/first class)
-- Group 2: General boarding (economy/premium_economy without active assistance)
ALTER TABLE booking ADD COLUMN IF NOT EXISTS boarding_group SMALLINT;

-- 2. Add lifecycle audit timestamps to assistance_request
ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE assistance_request ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 3. Update status constraint on assistance_request to support 'cancelled' status
DO $$
BEGIN
    ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS assistance_request_status_check;
    ALTER TABLE assistance_request ADD CONSTRAINT assistance_request_status_check
        CHECK (status IN ('requested', 'assigned', 'in_progress', 'completed', 'cancelled'));
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- 4. Indexes for fast queue and status lookups
CREATE INDEX IF NOT EXISTS idx_booking_boarding_group ON booking(flight_id, boarding_group);
CREATE INDEX IF NOT EXISTS idx_assistance_request_booking_status ON assistance_request(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_assistance_request_status ON assistance_request(status);
