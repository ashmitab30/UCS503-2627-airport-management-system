-- Migration 015: Emergency Audit Trail Table and Trigger
-- Append-only audit log of all emergency events, alerts, acknowledgements, notes, and resolutions.

CREATE TABLE IF NOT EXISTS emergency_audit (
    id SERIAL PRIMARY KEY,
    emergency_id INTEGER NOT NULL REFERENCES emergency_event(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL CHECK (action IN ('declared', 'alert_sent', 'acknowledged', 'note_added', 'resolved')),
    actor_user_id INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    actor_role VARCHAR(50),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_audit_emergency_id ON emergency_audit(emergency_id);
CREATE INDEX IF NOT EXISTS idx_emergency_audit_created_at ON emergency_audit(created_at);

-- Append-only trigger: reject any UPDATE statement on emergency_audit
CREATE OR REPLACE FUNCTION prevent_emergency_audit_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'emergency_audit table is append-only: UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_emergency_audit_no_update ON emergency_audit;
CREATE TRIGGER trigger_emergency_audit_no_update
BEFORE UPDATE ON emergency_audit
FOR EACH ROW
EXECUTE FUNCTION prevent_emergency_audit_update();
