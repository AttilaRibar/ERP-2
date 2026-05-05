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
const migrationPath = path.join(scriptDir, "../db/migrations/015_ai_chat_sessions.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

const sql = postgres(databaseUrl, { ssl: "require" });

try {
  await sql.unsafe(migration);

  const [tables] = await sql`
    SELECT
      to_regclass('public.ai_chat_sessions')::text AS sessions,
      to_regclass('public.ai_chat_messages')::text AS messages
  `;

  if (!tables?.sessions || !tables?.messages) {
    throw new Error("Migration verification failed: AI chat tables are missing");
  }

  const policies = await sql`
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('ai_chat_sessions', 'ai_chat_messages')
    ORDER BY tablename, policyname
  `;

  console.log(
    JSON.stringify(
      {
        tables,
        policies,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}