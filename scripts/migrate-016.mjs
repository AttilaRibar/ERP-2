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
const migrationPath = path.join(scriptDir, "../db/migrations/016_add_version_import_issues.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

const sql = postgres(databaseUrl, { ssl: "require" });

try {
  await sql.unsafe(migration);

  const columns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'versions'
      AND column_name = 'import_issues'
  `;

  if (columns.length === 0) {
    throw new Error("Migration verification failed: versions.import_issues column is missing");
  }

  console.log(JSON.stringify({ columns }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}