import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import fs from "fs";

// Analyze the gyengeáram sheet in more detail
const files = [
  "C:\\Users\\rattila\\Downloads\\Szolnok Baross kiv új árazatlan 088  2025 05 30 (4).xlsx",
  "C:\\Users\\rattila\\Downloads\\Szolnok_Baross_Gyengeáram_költségvetés_árazatlan.xlsx",
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const shortName = f.split("\\").pop();
  const wb = XLSX.readFile(f);

  for (const name of wb.SheetNames) {
    // Only analyze the gyengeáram sheet and one regular sheet for comparison
    if (!name.includes("GYENGEÁRAM") && !name.includes("ELEKTROMOS") && !name.includes("ÁLTALÁNOS")) continue;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`FILE: ${shortName} | SHEET: "${name}"`);
    console.log("=".repeat(70));

    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Show ALL rows, highlighting the structure
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const ssz = row[0];
      const col1 = row[1];
      const col2 = row[2];
      const col3 = row[3];
      const col4 = row[4];

      // Classify the row
      let type = "?";
      const isEmpty = row.every(c => c === "" || c === null || c === undefined);
      if (isEmpty) { type = "EMPTY"; }
      else if (typeof ssz === "number" && ssz > 0 && typeof col2 === "string" && col2.trim()) { type = "DATA"; }
      else if (typeof ssz === "string" && /^ssz/i.test(ssz.trim())) { type = "HEADER"; }
      else if (typeof ssz === "string" && ssz.trim().length > 0) {
        const q = row[3], mu = row[5], fu = row[6];
        if ((q === "" || q === 0) && (mu === "" || mu === 0) && (fu === "" || fu === 0)) type = "CAT(col0)";
        else type = "CAT?(col0+data)";
      }
      else if (typeof col1 === "string" && col1.trim().length > 0 && !col2 && !col3) { type = "CAT(col1)"; }
      else if (typeof col2 === "string" && col2.trim().length > 0 && ssz === "" && col1 === "") { type = "TEXT(col2)"; }

      // Only print non-empty rows or first 5
      if (type === "EMPTY" && i > 5) continue;

      const shortCells = row.slice(0, 9).map((c, j) => {
        const t = typeof c === "number" ? "n" : typeof c === "string" ? "s" : "?";
        const v = String(c).substring(0, 35);
        return `${t}:"${v}"`;
      });
      console.log(`  [${String(i).padStart(3)}] ${type.padEnd(14)} ${shortCells.join(" | ")}`);
    }

    // Count items found by current parser logic
    let parsedCount = 0;
    let missedPotential = 0;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const ssz = row[0];
      if (typeof ssz === "number" && ssz > 0 && typeof row[2] === "string" && row[2].trim()) {
        parsedCount++;
      } else if (typeof ssz === "string" && /^\d+$/.test(ssz.trim()) && typeof row[2] === "string" && row[2].trim()) {
        missedPotential++;
      }
    }
    console.log(`\n  SUMMARY: Would parse ${parsedCount} items, missed ${missedPotential} (SSZ as text)`);
  }
}
