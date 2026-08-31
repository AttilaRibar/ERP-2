-- Migration from AWS Cognito to Supabase Auth.
--
-- Nothing structural changes: every `user_id` / `created_by` column already
-- stores an opaque TEXT subject. It used to hold the Cognito `sub`, from now on
-- it holds the Supabase `auth.users.id` (a UUID). Only the documentation on the
-- tables is corrected here, together with the notes on where RBAC roles live.

COMMENT ON TABLE ai_chat_sessions IS
  'AI assistant conversation sessions owned by a Supabase Auth user (user_id = auth.users.id). Access is through Next.js server code; RLS blocks browser Data API access by default.';

COMMENT ON COLUMN ai_chat_sessions.user_id IS
  'Supabase auth.users.id of the owning user.';

COMMENT ON COLUMN ai_chat_messages.user_id IS
  'Supabase auth.users.id of the owning user.';

COMMENT ON COLUMN agent_runs.user_id IS
  'Supabase auth.users.id of the user the agent run acted on behalf of.';

COMMENT ON COLUMN agent_proposals.created_by IS
  'Supabase auth.users.id of the user who created the proposal.';

COMMENT ON COLUMN version_files.file_path IS
  'Supabase Storage object path in the budget-files bucket.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: ERP roles live in the Supabase user's app_metadata, so they are part of
-- the access token (JWT) and need no extra query on every request.
--
-- Assign roles (erp-admin | erp-manager | erp-accountant | erp-viewer):
--
--   UPDATE auth.users
--      SET raw_app_meta_data =
--            COALESCE(raw_app_meta_data, '{}'::jsonb)
--            || '{"erp_roles": ["erp-admin"]}'::jsonb
--    WHERE email = 'user@example.com';
--
-- The user must sign in again (or have their token refreshed) for a role change
-- to take effect.
-- ─────────────────────────────────────────────────────────────────────────────

-- No view is created over auth.users on purpose: anything in the `public`
-- schema is served by the Supabase Data API, and exposing the auth schema that
-- way would leak user records. Query the roles directly instead:
--
--   SELECT id, email, raw_app_meta_data -> 'erp_roles' AS erp_roles
--     FROM auth.users
--    ORDER BY email;
