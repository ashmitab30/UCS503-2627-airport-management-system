-- Migration 018: Chat Session Support & Escalation
-- Add session status, assigned agent, lifecycle timestamps and indexes

ALTER TABLE chat_session
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'escalated', 'assigned', 'closed')),
  ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_session_user_status ON chat_session(user_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_session_status ON chat_session(status);
CREATE INDEX IF NOT EXISTS idx_chat_session_agent ON chat_session(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_session_ts ON chat_message(session_id, "timestamp");
