-- Migration: 001_add_budget_sections
-- Fejezetek (hierarchikus szakaszok) hozzáadása a költségvetési tételekhez
-- Futtasd egyszer az élő adatbázison.

BEGIN;

-- 1. section_code oszlop a budget_items táblában
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS section_code UUID;
CREATE INDEX IF NOT EXISTS idx_budget_items_section_code ON budget_items(section_code);

-- 2. budget_sections tábla
CREATE TABLE IF NOT EXISTS budget_sections (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id           BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    section_code         UUID NOT NULL,
    parent_section_code  UUID,
    name                 TEXT NOT NULL,
    sequence_no          INTEGER NOT NULL DEFAULT 0,
    is_deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_budget_sections_version_id   ON budget_sections(version_id);
CREATE INDEX IF NOT EXISTS idx_budget_sections_section_code ON budget_sections(section_code);

COMMIT;
