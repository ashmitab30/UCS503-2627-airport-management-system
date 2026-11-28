-- Migration 019: Add nullable tail_number column to flight table for individual aircraft rotation tracking
ALTER TABLE flight
ADD COLUMN IF NOT EXISTS tail_number VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_flight_tail_number ON flight(tail_number);
