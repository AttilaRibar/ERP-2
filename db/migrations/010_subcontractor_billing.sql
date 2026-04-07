-- Add cognito_sub to partners table for linking Cognito users to partners
ALTER TABLE partners ADD COLUMN IF NOT EXISTS cognito_sub TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_partners_cognito_sub ON partners(cognito_sub);

-- Subcontractor billing submissions
CREATE TABLE IF NOT EXISTS subcontractor_billings (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    partner_id       BIGINT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    version_id       BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    billing_number   TEXT GENERATED ALWAYS AS ('SZLA-' || LPAD(id::TEXT, 4, '0')) STORED,
    amount           NUMERIC(15, 2) NOT NULL DEFAULT 0,
    description      TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    submitted_at     TIMESTAMPTZ,
    reviewed_at      TIMESTAMPTZ,
    reviewer_notes   TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_billings_partner_id ON subcontractor_billings(partner_id);
CREATE INDEX IF NOT EXISTS idx_sub_billings_version_id ON subcontractor_billings(version_id);
CREATE INDEX IF NOT EXISTS idx_sub_billings_status ON subcontractor_billings(status);
