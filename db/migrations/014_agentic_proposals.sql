-- Agentic AI proposal workflow: draft first, execute only after user approval.

CREATE TABLE IF NOT EXISTS agent_proposals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  executed_by TEXT,
  source_agent TEXT NOT NULL,
  agent_session_id TEXT,
  proposal_hash TEXT NOT NULL,
  failure_reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  CONSTRAINT agent_proposals_kind_check CHECK (kind IN ('chat_action', 'budget_import', 'budget_bulk_edit', 'item_bulk_edit', 'report_spec', 'comparison_spec')),
  CONSTRAINT agent_proposals_status_check CHECK (status IN ('draft', 'approved', 'executing', 'executed', 'rejected', 'expired', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_created_by ON agent_proposals(created_by);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_proposals(status);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_session ON agent_proposals(agent_session_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_created_at ON agent_proposals(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_proposal_operations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id BIGINT NOT NULL REFERENCES agent_proposals(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  entity_type TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  entity_id TEXT,
  before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  command_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  warning_level TEXT NOT NULL DEFAULT 'none',
  conflict_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT agent_proposal_operations_type_check CHECK (operation_type IN ('create', 'update', 'delete', 'create_version', 'create_report', 'create_comparison')),
  CONSTRAINT agent_proposal_operations_status_check CHECK (status IN ('pending', 'approved', 'applied', 'skipped', 'failed', 'conflict')),
  CONSTRAINT agent_proposal_operations_warning_check CHECK (warning_level IN ('none', 'info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_agent_proposal_operations_proposal ON agent_proposal_operations(proposal_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_operations_status ON agent_proposal_operations(status);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_operations_entity ON agent_proposal_operations(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  input_summary TEXT NOT NULL DEFAULT '',
  output_summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT agent_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_session ON agent_runs(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC);
