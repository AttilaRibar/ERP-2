-- Store every original file uploaded during a budget import, attached to the version.
-- Unlike versions.original_file_name / original_file_path (a single, manually-replaceable
-- reference file), this table keeps ALL source files of an import so the full, unfiltered
-- state can later be restored even if items were filtered out during the import.
CREATE TABLE IF NOT EXISTS version_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id BIGINT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  content_type TEXT,
  kind TEXT NOT NULL DEFAULT 'import_source',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT version_files_kind_check CHECK (kind IN ('import_source', 'attachment'))
);

CREATE INDEX IF NOT EXISTS idx_version_files_version_id ON version_files(version_id);

COMMENT ON TABLE version_files IS
  'Original files saved during import (and other attachments) for a budget version. Enables restoring the full imported state from the stored source files.';
COMMENT ON COLUMN version_files.file_path IS 'Supabase Storage (S3) key in the budget-files bucket.';
COMMENT ON COLUMN version_files.kind IS 'import_source = original file auto-saved at import time; attachment = other reference file.';
