import { S3Client } from "@aws-sdk/client-s3";

/**
 * S3-compatible client for Supabase Storage.
 * Uses the S3 protocol endpoint from the Supabase dashboard.
 *
 * Required env vars:
 *   SUPABASE_S3_ENDPOINT   – e.g. https://xxx.storage.supabase.co/storage/v1/s3
 *   SUPABASE_S3_REGION     – e.g. eu-central-1
 *   SUPABASE_S3_ACCESS_KEY – S3 access key ID from Supabase Storage settings
 *   SUPABASE_S3_SECRET_KEY – S3 secret key (shown only once when created)
 */
export const s3 = new S3Client({
  endpoint: process.env.SUPABASE_S3_ENDPOINT!,
  region: process.env.SUPABASE_S3_REGION ?? "eu-central-1",
  credentials: {
    accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY!,
    secretAccessKey: process.env.SUPABASE_S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

export const BUDGET_FILES_BUCKET = "budget-files";
