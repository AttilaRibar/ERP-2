"use server";

import { db } from "@/lib/db";
import { versions, versionFiles } from "@/lib/db/schema";
import { s3, BUDGET_FILES_BUCKET } from "@/lib/supabase/storage";
import { eq, asc } from "drizzle-orm";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/** Metadata for a file stored against a version in the version_files table. */
export interface VersionFileInfo {
  id: number;
  versionId: number;
  fileName: string;
  fileSize: number;
  contentType: string | null;
  kind: string;
  createdAt: Date | null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload an original budget file for a version and store the reference.
 * The file is stored in Supabase Storage (S3) under: budgets/{budgetId}/{versionId}/{filename}
 */
export async function uploadVersionFile(
  versionId: number,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: "Nincs kiválasztott fájl" };
  }

  // 50 MB limit
  if (file.size > 50 * 1024 * 1024) {
    return { success: false, error: "A fájl mérete nem lehet nagyobb 50 MB-nál" };
  }

  // Fetch the version to get budgetId
  const [version] = await db
    .select({ id: versions.id, budgetId: versions.budgetId })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (!version) {
    return { success: false, error: "A verzió nem található" };
  }

  // Sanitize filename for storage path — S3 keys must be ASCII-safe
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `budgets/${version.budgetId}/${versionId}/${safeName}`;

  // Delete previous file if exists
  const [current] = await db
    .select({ originalFilePath: versions.originalFilePath })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (current?.originalFilePath) {
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUDGET_FILES_BUCKET,
        Key: current.originalFilePath,
      }));
    } catch {
      // Ignore delete errors — file may not exist
    }
  }

  // Upload via S3
  const arrayBuffer = await file.arrayBuffer();
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUDGET_FILES_BUCKET,
      Key: storagePath,
      Body: new Uint8Array(arrayBuffer),
      ContentType: file.type || "application/octet-stream",
    }));
  } catch (err) {
    console.error("S3 upload error:", err);
    return { success: false, error: "Hiba a fájl feltöltése közben" };
  }

  // Update the version record with file metadata
  await db
    .update(versions)
    .set({
      originalFileName: file.name,
      originalFilePath: storagePath,
    })
    .where(eq(versions.id, versionId));

  return { success: true };
}

/**
 * Get a signed download URL for a version's original budget file.
 * The URL is valid for 60 seconds.
 */
export async function getVersionFileDownloadUrl(
  versionId: number
): Promise<{ success: boolean; url?: string; fileName?: string; error?: string }> {
  const [version] = await db
    .select({
      originalFileName: versions.originalFileName,
      originalFilePath: versions.originalFilePath,
    })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (!version?.originalFilePath) {
    return { success: false, error: "Nincs feltöltött fájl ehhez a verzióhoz" };
  }

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUDGET_FILES_BUCKET,
        Key: version.originalFilePath,
        ResponseContentDisposition: `attachment; filename="${version.originalFileName ?? "file"}"`,
      }),
      { expiresIn: 60 }
    );
    return { success: true, url, fileName: version.originalFileName ?? "file" };
  } catch (err) {
    console.error("S3 signed URL error:", err);
    return { success: false, error: "Hiba a letöltési link generálása közben" };
  }
}

/**
 * Remove the uploaded file from a version.
 */
export async function deleteVersionFile(
  versionId: number
): Promise<{ success: boolean; error?: string }> {
  const [version] = await db
    .select({ originalFilePath: versions.originalFilePath })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (!version?.originalFilePath) {
    return { success: false, error: "Nincs feltöltött fájl" };
  }

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUDGET_FILES_BUCKET,
      Key: version.originalFilePath,
    }));
  } catch (err) {
    console.error("S3 delete error:", err);
    return { success: false, error: "Hiba a fájl törlése közben" };
  }

  await db
    .update(versions)
    .set({ originalFileName: null, originalFilePath: null })
    .where(eq(versions.id, versionId));

  return { success: true };
}

// ============================================================
// Multi-file storage (version_files) — original import sources
// ============================================================

/**
 * Save the original files uploaded during an import, attached to the version.
 * Every file is kept (not just the filtered selection) so the full imported
 * state can be restored later. Files are stored in Supabase Storage (S3) under:
 *   budgets/{budgetId}/{versionId}/source/{index}_{filename}
 *
 * The FormData may contain multiple entries under the key "files".
 * Failures on individual files are collected and reported but do not abort the rest.
 */
export async function uploadImportedVersionFiles(
  versionId: number,
  formData: FormData
): Promise<{ success: boolean; saved: number; error?: string }> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { success: false, saved: 0, error: "Nincs menthető fájl" };
  }

  const [version] = await db
    .select({ id: versions.id, budgetId: versions.budgetId })
    .from(versions)
    .where(eq(versions.id, versionId));

  if (!version) {
    return { success: false, saved: 0, error: "A verzió nem található" };
  }

  let saved = 0;
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`"${file.name}": nagyobb mint 50 MB`);
      continue;
    }

    const safeName = sanitizeFileName(file.name);
    const storagePath = `budgets/${version.budgetId}/${versionId}/source/${i}_${safeName}`;

    try {
      const arrayBuffer = await file.arrayBuffer();
      await s3.send(new PutObjectCommand({
        Bucket: BUDGET_FILES_BUCKET,
        Key: storagePath,
        Body: new Uint8Array(arrayBuffer),
        ContentType: file.type || "application/octet-stream",
      }));

      try {
        await db.insert(versionFiles).values({
          versionId,
          fileName: file.name,
          filePath: storagePath,
          fileSize: file.size,
          contentType: file.type || null,
          kind: "import_source",
        });
      } catch (dbErr) {
        // Roll back the just-uploaded object so it does not orphan in storage.
        await s3.send(new DeleteObjectCommand({ Bucket: BUDGET_FILES_BUCKET, Key: storagePath })).catch(() => {});
        throw dbErr;
      }
      saved++;
    } catch (err) {
      console.error("Imported file save error:", err);
      errors.push(`"${file.name}": ${err instanceof Error ? err.message : "feltöltési hiba"}`);
    }
  }

  if (saved === 0) {
    return { success: false, saved: 0, error: errors.join("; ") || "Nem sikerült fájlt menteni" };
  }
  return { success: true, saved, error: errors.length > 0 ? errors.join("; ") : undefined };
}

/** List the files stored against a version (most relevant: import sources). */
export async function getVersionFiles(versionId: number): Promise<VersionFileInfo[]> {
  const rows = await db
    .select({
      id: versionFiles.id,
      versionId: versionFiles.versionId,
      fileName: versionFiles.fileName,
      fileSize: versionFiles.fileSize,
      contentType: versionFiles.contentType,
      kind: versionFiles.kind,
      createdAt: versionFiles.createdAt,
    })
    .from(versionFiles)
    .where(eq(versionFiles.versionId, versionId))
    .orderBy(asc(versionFiles.id));

  return rows;
}

/** Get a signed download URL (valid 60s) for a single stored version file. */
export async function getVersionFileDownloadUrlById(
  fileId: number
): Promise<{ success: boolean; url?: string; fileName?: string; contentType?: string | null; error?: string }> {
  const [file] = await db
    .select({
      fileName: versionFiles.fileName,
      filePath: versionFiles.filePath,
      contentType: versionFiles.contentType,
    })
    .from(versionFiles)
    .where(eq(versionFiles.id, fileId));

  if (!file) {
    return { success: false, error: "A fájl nem található" };
  }

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUDGET_FILES_BUCKET,
        Key: file.filePath,
        ResponseContentDisposition: `attachment; filename="${file.fileName}"`,
      }),
      { expiresIn: 60 }
    );
    return { success: true, url, fileName: file.fileName, contentType: file.contentType };
  } catch (err) {
    console.error("S3 signed URL error:", err);
    return { success: false, error: "Hiba a letöltési link generálása közben" };
  }
}

/** Delete a single stored version file (from S3 and the table). */
export async function deleteVersionFileById(
  fileId: number
): Promise<{ success: boolean; error?: string }> {
  const [file] = await db
    .select({ filePath: versionFiles.filePath })
    .from(versionFiles)
    .where(eq(versionFiles.id, fileId));

  if (!file) {
    return { success: false, error: "A fájl nem található" };
  }

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUDGET_FILES_BUCKET,
      Key: file.filePath,
    }));
  } catch (err) {
    console.error("S3 delete error:", err);
    // Continue to remove the DB row even if S3 delete failed (file may be gone).
  }

  await db.delete(versionFiles).where(eq(versionFiles.id, fileId));
  return { success: true };
}
