-- ============================================================
-- 006: Alternatív tételek támogatása
-- Egy költségvetési tétel alternatíváit az alternative_of_item_code
-- hivatkozással jelöljük. Ha NULL → eredeti tétel, ha kitöltve →
-- az adott item_code-ra vonatkozó alternatíva.
-- ============================================================

BEGIN;

-- Alternatíva-hivatkozás hozzáadása
ALTER TABLE budget_items
  ADD COLUMN IF NOT EXISTS alternative_of_item_code UUID;

-- Index a gyors lekérdezésekhez (mely alternatívák tartoznak egy eredeti tételhez)
CREATE INDEX IF NOT EXISTS idx_budget_items_alt_of
  ON budget_items(alternative_of_item_code)
  WHERE alternative_of_item_code IS NOT NULL;

COMMIT;
