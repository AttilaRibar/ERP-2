-- Add version_type and partner_id to versions table
-- version_type: 'internal' (belsős), 'contracted' (szerződött), 'subcontractor' (alvállalkozói)

ALTER TABLE versions
  ADD COLUMN version_type TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN partner_id BIGINT REFERENCES partners(id) ON DELETE SET NULL;

ALTER TABLE versions
  ADD CONSTRAINT versions_version_type_check
  CHECK (version_type IN ('internal', 'contracted', 'subcontractor'));

-- partner_id should only be set when version_type = 'subcontractor'
ALTER TABLE versions
  ADD CONSTRAINT versions_partner_id_check
  CHECK (
    (version_type = 'subcontractor' AND partner_id IS NOT NULL)
    OR (version_type != 'subcontractor' AND partner_id IS NULL)
  );

CREATE INDEX idx_versions_version_type ON versions(version_type);
CREATE INDEX idx_versions_partner_id ON versions(partner_id);
