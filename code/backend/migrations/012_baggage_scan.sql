-- Migration 012: Baggage scan history for tracking status pipeline
CREATE TABLE IF NOT EXISTS baggage_scan (
  id SERIAL PRIMARY KEY,
  baggage_id INTEGER NOT NULL REFERENCES baggage(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  location TEXT NOT NULL,
  scanned_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baggage_scan_baggage_id ON baggage_scan(baggage_id);
CREATE INDEX IF NOT EXISTS idx_baggage_scan_scanned_at ON baggage_scan(scanned_at);
