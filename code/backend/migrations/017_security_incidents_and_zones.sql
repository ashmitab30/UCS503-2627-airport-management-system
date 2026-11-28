-- Migration 017: Security Incidents and Restricted Zones
-- Part A: Incident details, assignment, lifecycle timestamps and timeline audit trail
ALTER TABLE security_incident
  ADD COLUMN IF NOT EXISTS description VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS security_incident_update (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES security_incident(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES "user"(id),
  action TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Part B: Restricted zones catalog and access verification audit
CREATE TABLE IF NOT EXISTS restricted_zone (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  allowed_roles TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE restricted_zone_access
  ADD COLUMN IF NOT EXISTS recorded_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Indexes for incident filtering, timeline lookups, and zone access queries
CREATE INDEX IF NOT EXISTS idx_security_incident_status ON security_incident(status);
CREATE INDEX IF NOT EXISTS idx_security_incident_severity ON security_incident(severity);
CREATE INDEX IF NOT EXISTS idx_security_incident_timestamp ON security_incident("timestamp");
CREATE INDEX IF NOT EXISTS idx_security_incident_assigned ON security_incident(assigned_to);
CREATE INDEX IF NOT EXISTS idx_security_incident_update_incident ON security_incident_update(incident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_restricted_zone_access_zone ON restricted_zone_access(zone, "timestamp");
CREATE INDEX IF NOT EXISTS idx_restricted_zone_access_employee ON restricted_zone_access(employee_id);
