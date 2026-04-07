-- Add original file metadata columns to versions
ALTER TABLE versions
  ADD COLUMN original_file_name TEXT,
  ADD COLUMN original_file_path TEXT;

COMMENT ON COLUMN versions.original_file_name IS 'Original uploaded budget file name (e.g. "budget_v2.xlsx")';
COMMENT ON COLUMN versions.original_file_path IS 'Supabase Storage path in the budget-files bucket';
