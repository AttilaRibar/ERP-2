-- Migration 007: Add price_component and use_cheapest_alternative to cost_scenario_layers

ALTER TABLE cost_scenario_layers
  ADD COLUMN IF NOT EXISTS price_component TEXT NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS use_cheapest_alternative BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cost_scenario_layers
  ADD CONSTRAINT cost_scenario_layers_price_component_check
    CHECK (price_component IN ('both', 'material', 'fee'));
