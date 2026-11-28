-- Migration 013: Add reservation window, status, created_at, and booking_ref to parking_booking

ALTER TABLE parking_booking
  ADD COLUMN IF NOT EXISTS booking_ref VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS reserved_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'active', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add check constraint for reserved_until > reserved_from
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_parking_booking_window'
  ) THEN
    ALTER TABLE parking_booking
      ADD CONSTRAINT chk_parking_booking_window CHECK (reserved_until > reserved_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parking_booking_slot_window
  ON parking_booking(slot_id, reserved_from, reserved_until)
  WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_parking_booking_user_id ON parking_booking(user_id);
CREATE INDEX IF NOT EXISTS idx_parking_booking_ref ON parking_booking(booking_ref);
CREATE INDEX IF NOT EXISTS idx_parking_booking_status ON parking_booking(status);
CREATE INDEX IF NOT EXISTS idx_parking_slot_lot_id ON parking_slot(lot_id);
CREATE INDEX IF NOT EXISTS idx_parking_lot_airport_id ON parking_lot(airport_id);
