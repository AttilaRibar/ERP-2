import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import fs from "fs";

const files = [
  "C:\\Users\\rattila\\Downloads\\Szolnok_Baross_Gyengeáram_költségvetés_árazatlan.xlsx",
  "C:\\Users\\rattila\\Downloads\\Szolnok Baross kiv új árazatlan 088  2025 05 30 (4).xlsx",
];

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("NOT FOUND:", f);
    continue;
  }

  const shortName = f.split("\\").pop();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FILE: ${shortName}`);
  console.log("=".repeat(60));

  const wb = XLSX.readFile(f);
  console.log("Sheets:", wb.SheetNames);

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    console.log(`\n--- Sheet: "${name}" (${data.length} rows) ---`);

    // Print first 8 rows with type info
    for (let i = 0; i < Math.min(data.length, 8); i++) {
      const row = data[i];
      const cells = row
        .slice(0, 12)
        .map((c, j) => {
          const type = typeof c;
          const val = String(c).substring(0, 25);
          return `[${j}]${type[0]}:"${val}"`;
        });
      console.log(`  Row ${i}: ${cells.join(" | ")}`);
    }

    // Analyze SSZ column types for data rows
    const typeCounts = { number: 0, string: 0, empty: 0 };
    for (let i = 1; i < Math.min(data.length, 100); i++) {
      const ssz = data[i][0];
      if (typeof ssz === "number") typeCounts.number++;
      else if (typeof ssz === "string" && ssz.trim()) typeCounts.string++;
      else typeCounts.empty++;
    }
    console.log(`  SSZ col types (rows 1-99): num=${typeCounts.number} str=${typeCounts.string} empty=${typeCounts.empty}`);

    // Find a data-like row and show it in detail
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ssz = row[0];
      // Row that looks like it has data
      if (
        (typeof ssz === "number" && ssz > 0) ||
        (typeof ssz === "string" && /^\d+$/.test(ssz.trim()))
      ) {
        const name2 = row[2] || row[1];
        if (typeof name2 === "string" && name2.trim().length > 5) {
          console.log(`  First data-like row (${i}):`);
          for (let j = 0; j < Math.min(row.length, 12); j++) {
            console.log(`    col[${j}] = (${typeof row[j]}) ${JSON.stringify(row[j])}`);
          }
          break;
        }
      }
    }
  }
}
