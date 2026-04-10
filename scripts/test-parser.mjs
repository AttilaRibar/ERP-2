import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import fs from "fs";

// Replicate the parser logic to test it
const COL = { SSZ: 0, ITEM_NUM: 1, NAME: 2, QUANTITY: 3, UNIT: 4, MAT_UNIT: 5, FEE_UNIT: 6, MAT_TOTAL: 7, FEE_TOTAL: 8 };
const HEADER_PATTERNS = [/^ssz\.?$/i, /^t[eé]telsz[aá]m$/i, /^t[eé]tel\s*sz[oö]veg/i, /^menny/i, /^egys[eé]g$/i, /^anyag\s*egys[eé]g/i, /^d[ií]j\s*egys[eé]g/i, /^anyag\s*[oö]sszesen$/i, /^d[ií]j\s*[oö]sszesen$/i];
const SKIP_SHEET_PATTERNS = [/z[aá]rad[eé]k/i, /fejezet\s*[oö]sszesít/i, /[oö]sszesít[oő]/i, /summary/i, /cover/i];

function shouldSkipSheet(name) { return SKIP_SHEET_PATTERNS.some(p => p.test(name)); }
function isHeaderRow(row) {
  if (!row || row.length < 5) return false;
  const matches = row.slice(0, 9).filter((cell, i) => { if (typeof cell !== "string") return false; return HEADER_PATTERNS[i]?.test(cell.trim()); });
  return matches.length >= 3;
}
function isSummaryRow(row) {
  const text = String(row[COL.NAME] ?? "").toLowerCase();
  return text.includes("fejezet összesen") || text.includes("összesen:") || text.includes("mindösszesen");
}
function isCategoryRow(row) {
  const ssz = row[COL.SSZ];
  if (typeof ssz === "string" && ssz.trim().length > 0) {
    const q = row[COL.QUANTITY], matUnit = row[COL.MAT_UNIT], feeUnit = row[COL.FEE_UNIT];
    if ((q === "" || q === undefined || q === null || q === 0) && (matUnit === "" || matUnit === undefined || matUnit === null || matUnit === 0) && (feeUnit === "" || feeUnit === undefined || feeUnit === null || feeUnit === 0)) return true;
  }
  return false;
}
function isDataRow(row) {
  const ssz = row[COL.SSZ];
  const name = row[COL.NAME];
  return typeof ssz === "number" && ssz > 0 && typeof name === "string" && name.trim().length > 0;
}

// Test with both files
const files = [
  "C:\\Users\\rattila\\Downloads\\Szolnok_Baross_Gyengeáram_költségvetés_árazatlan.xlsx",
  "C:\\Users\\rattila\\Downloads\\Szolnok Baross kiv új árazatlan 088  2025 05 30 (4).xlsx",
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const shortName = f.split("\\").pop();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FILE: ${shortName}`);
  const wb = XLSX.readFile(f);

  for (const sheetName of wb.SheetNames) {
    const skip = shouldSkipSheet(sheetName);
    if (skip) {
      console.log(`  SKIP: "${sheetName}"`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let currentSubCategory = null;
    let itemCount = 0;
    let warningCount = 0;
    const categories = [];
    const missingCats = [];

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      if (!row || row.length === 0) continue;
      if (isHeaderRow(row)) continue;
      if (isSummaryRow(row)) continue;

      if (isCategoryRow(row)) {
        currentSubCategory = String(row[COL.SSZ]).trim();
        categories.push({ row: rowIdx, type: "col0", name: currentSubCategory.substring(0, 40) });
        continue;
      }
      if (isDataRow(row)) { itemCount++; continue; }

      // Check if this is a missed category (text in col1 with empty elsewhere)
      const col1 = row[1];
      if (typeof col1 === "string" && col1.trim().length > 0 && row[0] === "" && (row[2] === "" || row[2] === undefined)) {
        missingCats.push({ row: rowIdx, name: col1.substring(0, 50) });
      }
    }

    console.log(`  SHEET: "${sheetName}"`);
    console.log(`    Items parsed: ${itemCount}`);
    console.log(`    Categories detected: ${categories.length}`);
    if (categories.length > 0) {
      for (const c of categories) console.log(`      [${c.row}] ${c.type}: "${c.name}"`);
    }
    console.log(`    MISSED categories (col1): ${missingCats.length}`);
    if (missingCats.length > 0) {
      for (const c of missingCats) console.log(`      [${c.row}] col1: "${c.name}"`);
    }
    if (itemCount === 0) console.log(`    *** NO ITEMS - would be added to skippedSheets ***`);
  }
}
