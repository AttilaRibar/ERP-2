import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(scriptDir, "../db/migrations/018_supabase_auth.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

const sql = postgres(databaseUrl, { ssl: "require" });

try {
  await sql.unsafe(migration);

  const comments = await sql`
    SELECT c.relname AS table_name, obj_description(c.oid) AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ai_chat_sessions'
  `;

  if (comments.length === 0) {
    throw new Error("Migration verification failed: ai_chat_sessions table is missing");
  }

  console.log(JSON.stringify({ comments }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
