-- Add 'unpriced' to version_type enum
-- This allows marking a version as "árazatlan" (unpriced) so price changes
-- are not shown as modifications when comparing with parent/child versions.

ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_version_type_check;
ALTER TABLE versions ADD CONSTRAINT versions_version_type_check
  CHECK (version_type IN ('offer', 'contracted', 'unpriced'));
