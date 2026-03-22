-- ============================================================
-- SmartERP – Építőipari Fővállalkozó ERP
-- PostgreSQL séma – teljes adatbázis struktúra
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PARTNERS (Partnerek – megrendelők, alvállalkozók, szállítók)
-- ============================================================
CREATE TABLE IF NOT EXISTS partners (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT,
    phone        TEXT,
    address      TEXT,
    tax_number   TEXT,
    -- 'client' | 'subcontractor' | 'supplier'
    partner_type TEXT NOT NULL DEFAULT 'client'
                     CHECK (partner_type IN ('client', 'subcontractor', 'supplier')),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_partner_type ON partners(partner_type);

-- ============================================================
-- 2. PROJECTS (Projektek – kibővítve)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Automatikusan generált azonosító, pl. "PRJ-0001"
    project_code     TEXT GENERATED ALWAYS AS ('PRJ-' || LPAD(id::TEXT, 4, '0')) STORED,
    name             TEXT NOT NULL,
    start_date       DATE,
    end_date         DATE,
    -- Megrendelő partner
    client_id        BIGINT REFERENCES partners(id) ON DELETE SET NULL,
    -- Garanciális időtartam hónapban
    warranty_months  INTEGER NOT NULL DEFAULT 12,
    -- 'active' | 'completed' | 'cancelled' | 'on_hold'
    status           TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'completed', 'cancelled', 'on_hold')),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id    ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status       ON projects(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_code   ON projects(project_code);

-- ============================================================
-- 3. QUOTES (Ajánlatok – projekthez tartozó beérkező ajánlatok)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Automatikusan generált azonosító, pl. "AJN-0001"
    quote_code   TEXT GENERATED ALWAYS AS ('AJN-' || LPAD(id::TEXT, 4, '0')) STORED,
    project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Ajánlat tárgya / témája
    subject      TEXT NOT NULL,
    -- Ajánlattevő partner
    offerer_id   BIGINT REFERENCES partners(id) ON DELETE SET NULL,
    price        NUMERIC(15, 2) NOT NULL DEFAULT 0,
    currency     TEXT NOT NULL DEFAULT 'HUF',
    -- 'pending' | 'accepted' | 'rejected' | 'expired'
    status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
    valid_until  DATE,
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_project_id  ON quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_quotes_offerer_id  ON quotes(offerer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status      ON quotes(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_code  ON quotes(quote_code);

-- ============================================================
-- 4. BUDGETS (Költségvetések – projekthez tartoznak)
-- ============================================================
CREATE TABLE IF NOT EXISTS budgets (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_project_id ON budgets(project_id);

-- ============================================================
-- 5. VERSIONS (Verziók – önreferenciáló DAG a verziófa számára)
-- ============================================================
CREATE TABLE IF NOT EXISTS versions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id     BIGINT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    parent_id     BIGINT REFERENCES versions(id) ON DELETE RESTRICT,
    version_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_versions_budget_id ON versions(budget_id);
CREATE INDEX IF NOT EXISTS idx_versions_parent_id ON versions(parent_id);

-- ============================================================
-- 6. BUDGET ITEMS (Költségvetési tételek – delta store)
-- ============================================================
CREATE TABLE IF NOT EXISTS budget_items (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version_id           BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    -- Tétel egyedi kódja (UUID) – verziókon átívelő azonosítás
    item_code            UUID NOT NULL,
    sequence_no          INTEGER NOT NULL DEFAULT 0,
    item_number          TEXT NOT NULL DEFAULT '',
    name                 TEXT NOT NULL,
    quantity             NUMERIC(15, 4) NOT NULL DEFAULT 1,
    unit                 TEXT NOT NULL DEFAULT '',
    material_unit_price  NUMERIC(15, 2) NOT NULL DEFAULT 0,
    fee_unit_price       NUMERIC(15, 2) NOT NULL DEFAULT 0,
    notes                TEXT NOT NULL DEFAULT '',
    is_deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_budget_items_version_id   ON budget_items(version_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_item_code    ON budget_items(item_code);
CREATE INDEX IF NOT EXISTS idx_budget_items_version_item ON budget_items(version_id, item_code);

-- ============================================================
-- HASZNOS NÉZETEK
-- ============================================================

-- Projekt összesítő nézet: megrendelő neve + ajánlatok összege
CREATE OR REPLACE VIEW v_project_summary AS
SELECT
    p.id,
    p.project_code,
    p.name,
    p.status,
    p.start_date,
    p.end_date,
    p.warranty_months,
    pt.name                                   AS client_name,
    COUNT(DISTINCT q.id)                      AS quote_count,
    COALESCE(SUM(q.price) FILTER (WHERE q.status = 'accepted'), 0) AS accepted_quotes_total,
    COUNT(DISTINCT b.id)                      AS budget_count
FROM projects p
LEFT JOIN partners pt ON pt.id = p.client_id
LEFT JOIN quotes q    ON q.project_id = p.id
LEFT JOIN budgets b   ON b.project_id = p.id
GROUP BY p.id, p.project_code, p.name, p.status,
         p.start_date, p.end_date, p.warranty_months, pt.name;

-- Ajánlat részletes nézet: projekt és ajánlattevő nevével együtt
CREATE OR REPLACE VIEW v_quote_detail AS
SELECT
    q.id,
    q.quote_code,
    q.subject,
    q.price,
    q.currency,
    q.status,
    q.valid_until,
    q.notes,
    q.created_at,
    p.project_code,
    p.name  AS project_name,
    pt.name AS offerer_name,
    pt.email AS offerer_email,
    pt.phone AS offerer_phone
FROM quotes q
JOIN projects p   ON p.id = q.project_id
LEFT JOIN partners pt ON pt.id = q.offerer_id;

-- Verzió összesítő nézet: tétel és összegzés
CREATE OR REPLACE VIEW v_version_totals AS
SELECT
    v.id             AS version_id,
    v.version_name,
    b.id             AS budget_id,
    b.name           AS budget_name,
    p.project_code,
    p.name           AS project_name,
    COUNT(bi.id) FILTER (WHERE NOT bi.is_deleted)                                 AS item_count,
    SUM((bi.material_unit_price + bi.fee_unit_price) * bi.quantity)
        FILTER (WHERE NOT bi.is_deleted)                                           AS total_price
FROM versions v
JOIN budgets b   ON b.id = v.budget_id
JOIN projects p  ON p.id = b.project_id
LEFT JOIN budget_items bi ON bi.version_id = v.id
GROUP BY v.id, v.version_name, b.id, b.name, p.project_code, p.name;

COMMIT;
