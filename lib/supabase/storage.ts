import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Bucket holding the uploaded budget/import source files. */
export const BUDGET_FILES_BUCKET = "budget-files";

/** How long a generated download link stays valid (seconds). */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

function bucket(name: string = BUDGET_FILES_BUCKET) {
  return getSupabaseAdminClient().storage.from(name);
}

/**
 * Uploads (or overwrites) an object in Supabase Storage.
 * Throws on failure so callers can report a user-facing error.
 */
export async function uploadStorageObject(
  path: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType?: string | null
): Promise<void> {
  const { error } = await bucket().upload(path, body, {
    contentType: contentType || "application/octet-stream",
    upsert: true,
  });
  if (error) throw error;
}

/**
 * Removes objects from Supabase Storage. Missing objects are not an error —
 * deletion is always best-effort cleanup.
 */
export async function deleteStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await bucket().remove(paths);
  if (error) throw error;
}

/** Convenience wrapper around {@link deleteStorageObjects} for a single object. */
export async function deleteStorageObject(path: string): Promise<void> {
  await deleteStorageObjects([path]);
}

/**
 * Creates a short-lived signed download URL for a stored object.
 *
 * Passing `fileName` makes Storage answer with a `Content-Disposition:
 * attachment` header carrying that name, which replaces the S3
 * `ResponseContentDisposition` override used previously.
 */
export async function createSignedDownloadUrl(
  path: string,
  fileName?: string | null,
  expiresIn: number = DOWNLOAD_URL_TTL_SECONDS
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, expiresIn, {
    download: fileName ?? true,
  });
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Supabase Storage did not return a signed URL");
  return data.signedUrl;
}
