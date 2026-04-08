-- ============================================================
-- Migration 012: Switch settlement items from quantity to amounts
-- Store claimed_material_amount and claimed_fee_amount separately
-- per item, enabling independent material/fee settlement
-- (e.g. storage declaration: material settled earlier than fee).
-- ============================================================

ALTER TABLE settlement_items DROP COLUMN IF EXISTS claimed_qty;
ALTER TABLE settlement_items ADD COLUMN claimed_material_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE settlement_items ADD COLUMN claimed_fee_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
