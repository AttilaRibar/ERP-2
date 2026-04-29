-- Persistent AI assistant conversations stored in Supabase Postgres.
-- The app authorizes through Cognito in the Next.js server layer. RLS is enabled
-- with no browser-facing policies so these rows are not exposed via Supabase Data API.

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Új beszélgetés',
  last_message_preview TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_updated
  ON ai_chat_sessions(user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_last_message
  ON ai_chat_sessions(user_id, last_message_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_chat_sessions IS
  'Cognito-owned AI assistant conversation sessions. Access is through Next.js server code; RLS blocks browser Data API access by default.';

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_chat_messages_role_check CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_created
  ON ai_chat_messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user_session
  ON ai_chat_messages(user_id, session_id);

ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ai_chat_messages IS
  'Persisted AI assistant messages and extracted attachment text. Access is through Next.js server code; RLS blocks browser Data API access by default.';
