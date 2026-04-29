import postgres from "postgres";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, "../db/migrations/014_agentic_proposals.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

async function main() {
  const sql = postgres(DATABASE_URL!, { ssl: "require" });
  try {
    await sql.unsafe(migration);

    const [tables] = await sql<{
      agent_proposals: string | null;
      agent_proposal_operations: string | null;
      agent_runs: string | null;
    }[]>`
      SELECT
        to_regclass('public.agent_proposals')::text AS agent_proposals,
        to_regclass('public.agent_proposal_operations')::text AS agent_proposal_operations,
        to_regclass('public.agent_runs')::text AS agent_runs
    `;

    if (!tables?.agent_proposals || !tables.agent_proposal_operations || !tables.agent_runs) {
      throw new Error("Migration verification failed: one or more agent tables are missing");
    }

    console.log("Migration 014 applied and verified successfully");
  } catch (e: unknown) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
