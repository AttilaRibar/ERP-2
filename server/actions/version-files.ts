"use server";

import { db } from "@/lib/db";
import { versions } from "@/lib/db/schema";
import { s3, BUDGET_FILES_BUCKET } from "@/lib/supabase/storage";
import { eq } from "drizzle-orm";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
