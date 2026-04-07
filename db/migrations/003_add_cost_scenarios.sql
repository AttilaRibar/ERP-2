-- ============================================================
-- Migration 003: Cost Scenarios (Költség-szcenáriók)
-- Rétegelt verzió-összehasonlítás — "mi lenne ha" analízis
-- ============================================================

BEGIN;

-- ============================================================
-- 1. COST_SCENARIOS (Szcenáriók — elmentett kombinációk)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_scenarios (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_scenarios_project_id ON cost_scenarios(project_id);

-- ============================================================
-- 2. COST_SCENARIO_LAYERS (Rétegek — rendezett verziólista)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_scenario_layers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scenario_id   BIGINT NOT NULL REFERENCES cost_scenarios(id) ON DELETE CASCADE,
    version_id    BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    layer_order   INTEGER NOT NULL DEFAULT 0,
    label         TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_scenario_layers_scenario_id ON cost_scenario_layers(scenario_id);
CREATE INDEX IF NOT EXISTS idx_cost_scenario_layers_version_id ON cost_scenario_layers(version_id);
-- Ensure unique ordering per scenario
CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_scenario_layers_order ON cost_scenario_layers(scenario_id, layer_order);

-- ============================================================
-- 3. SEED DATA (Demo szcenárió)
-- ============================================================

-- Create a scenario for the "Corvin B" project (project_id = 1)
-- Uses version 1 (base v1.0) as bottom layer and version 3 (v1.2 final) as overlay
INSERT INTO cost_scenarios (project_id, name, description) VALUES
  (1, 'Vegyes forrás — v1.0 alap + v1.2 felülírás', 'Vállalkozó alap ajánlata (v1.0) a lámpás cég véglegesített áraival (v1.2) felülírva.');

INSERT INTO cost_scenario_layers (scenario_id, version_id, layer_order, label) VALUES
  (1, 1, 0, 'Vállalkozó X — alap ajánlat (v1.0)'),
  (1, 3, 1, 'Véglegesített árak (v1.2)');

COMMIT;
