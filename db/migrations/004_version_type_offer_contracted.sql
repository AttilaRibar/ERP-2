-- Change version types: remove 'internal'/'subcontractor', add 'offer'
-- Default is now 'offer' instead of 'internal'

-- Drop old constraints first
ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_version_type_check;
ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_partner_id_check;

-- Update existing data
UPDATE versions SET version_type = 'offer' WHERE version_type IN ('internal', 'subcontractor');

-- Change default
ALTER TABLE versions ALTER COLUMN version_type SET DEFAULT 'offer';

-- Add new constraint
ALTER TABLE versions ADD CONSTRAINT versions_version_type_check
  CHECK (version_type IN ('offer', 'contracted'));
