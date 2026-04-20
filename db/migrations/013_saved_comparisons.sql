-- Migration 013: Saved comparisons for budgets
CREATE TABLE saved_comparisons (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id      BIGINT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    version_ids    TEXT NOT NULL,       -- JSON array of version IDs e.g. "[1,2,3]"
    version_names  TEXT NOT NULL,       -- JSON array of version names e.g. '["v1","v2"]'
    compare_type   TEXT NOT NULL DEFAULT 'multi',  -- 'simple' | 'multi'
    state          TEXT NOT NULL DEFAULT '{}',     -- JSON blob with full UI state
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_comparisons_budget ON saved_comparisons(budget_id);
