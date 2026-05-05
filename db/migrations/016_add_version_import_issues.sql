-- Store grouped Excel import validation errors on imported versions.
ALTER TABLE versions
  ADD COLUMN IF NOT EXISTS import_issues JSONB;

COMMENT ON COLUMN versions.import_issues IS
  'Grouped Excel import validation errors: readErrors, formulaErrors, contentErrors.';
