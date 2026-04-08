-- ============================================================
-- Migration 011: Alvállalkozói tételes elszámolás rendszer
-- Replaces the simple billing system (010) with a proper
-- item-level settlement system.
-- ============================================================

-- Drop old billing tables from migration 010
DROP TABLE IF EXISTS subcontractor_billings CASCADE;
DROP TABLE IF EXISTS subcontractor_access_tokens CASCADE;

-- ============================================================
-- 1. SETTLEMENT CONTRACTS (Elszámolási szerződések)
--    Admin creates one per subcontractor+version combination.
--    Contains the access link token and password hash.
-- ============================================================
CREATE TABLE settlement_contracts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id       BIGINT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    version_id      BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    partner_id      BIGINT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

    -- Access credentials
    access_token    VARCHAR(64) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,

    -- Contract info
    total_net_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    label           TEXT NOT NULL DEFAULT '',

    -- Status: active | completed | cancelled
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'cancelled')),

    created_by      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_settlement_contracts_budget ON settlement_contracts(budget_id);
CREATE INDEX idx_settlement_contracts_version ON settlement_contracts(version_id);
CREATE INDEX idx_settlement_contracts_partner ON settlement_contracts(partner_id);
CREATE UNIQUE INDEX idx_settlement_contracts_token ON settlement_contracts(access_token);
CREATE INDEX idx_settlement_contracts_status ON settlement_contracts(status);

-- ============================================================
-- 2. SETTLEMENT INVOICES (Részszámlák)
--    Admin defines partial invoices with max amounts.
--    Only one can be 'open' at a time per contract.
-- ============================================================
CREATE TABLE settlement_invoices (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_id     BIGINT NOT NULL REFERENCES settlement_contracts(id) ON DELETE CASCADE,

    invoice_number  INTEGER NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    max_amount      NUMERIC(15, 2) NOT NULL DEFAULT 0,

    -- Status lifecycle: locked → open → submitted → approved/rejected
    status          TEXT NOT NULL DEFAULT 'locked'
                        CHECK (status IN ('locked', 'open', 'submitted', 'approved', 'rejected')),

    -- Subcontractor submission
    submitted_at    TIMESTAMPTZ,
    submitted_note  TEXT,

    -- Admin review
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     TEXT,
    review_note     TEXT,

    -- Denormalized totals (updated on save)
    claimed_material_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
    claimed_fee_total      NUMERIC(15, 2) NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(contract_id, invoice_number)
);

CREATE INDEX idx_settlement_invoices_contract ON settlement_invoices(contract_id);
CREATE INDEX idx_settlement_invoices_status ON settlement_invoices(status);

-- ============================================================
-- 3. SETTLEMENT ITEMS (Tételes elszámolás)
--    Per-invoice per-item claimed quantities.
-- ============================================================
CREATE TABLE settlement_items (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES settlement_invoices(id) ON DELETE CASCADE,

    item_code       UUID NOT NULL,

    -- Claimed quantity for this partial invoice
    claimed_qty     NUMERIC(15, 4) NOT NULL DEFAULT 0,

    -- Optional note per item
    note            TEXT NOT NULL DEFAULT '',

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(invoice_id, item_code)
);

CREATE INDEX idx_settlement_items_invoice ON settlement_items(invoice_id);
CREATE INDEX idx_settlement_items_item_code ON settlement_items(item_code);
