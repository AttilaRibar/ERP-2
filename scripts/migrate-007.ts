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
const migrationPath = path.join(__dirname, "../db/migrations/007_scenario_layer_options.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

async function main() {
  const sql = postgres(DATABASE_URL!, { ssl: "require" });
  try {
    await sql.unsafe(migration);
    console.log("Migration 007 applied successfully");
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("already exists")) {
      console.log("Already applied (constraint exists)");
    } else {
      console.error("Error:", e instanceof Error ? e.message : e);
    }
  }
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
