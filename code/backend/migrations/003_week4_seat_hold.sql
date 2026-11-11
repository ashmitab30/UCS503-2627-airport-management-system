-- 003_week4_seat_hold.sql
-- Adds timed seat hold expiration support to bookings

ALTER TABLE booking ADD COLUMN IF NOT EXISTS held_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_booking_held_until ON booking(held_until) WHERE status = 'held';

