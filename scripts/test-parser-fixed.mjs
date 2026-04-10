import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import fs from "fs";

// Replicate the FIXED parser logic to test it
const COL = { SSZ: 0, ITEM_NUM: 1, NAME: 2, QUANTITY: 3, UNIT: 4, MAT_UNIT: 5, FEE_UNIT: 6, MAT_TOTAL: 7, FEE_TOTAL: 8 };
const HEADER_PATTERNS = [/^ssz\.?$/i, /^t[eé]telsz[aá]m$/i, /^t[eé]tel\s*sz[oö]veg/i, /^menny/i, /^egys[eé]g$/i, /^anyag\s*egys[eé]g/i, /^d[ií]j\s*egys[eé]g/i, /^anyag\s*[oö]sszesen$/i, /^d[ií]j\s*[oö]sszesen$/i];
const SKIP_SHEET_PATTERNS = [/z[aá]rad[eé]k/i, /fejezet\s*[oö]sszesít/i, /[oö]sszesít[oő]/i, /summary/i, /cover/i];

function shouldSkipSheet(name) { return SKIP_SHEET_PATTERNS.some(p => p.test(name)); }
function isHeaderRow(row) {
  if (!row || row.length < 5) return false;
  const matches = row.slice(0, 9).filter((cell, i) => { if (typeof cell !== "string") return false; return HEADER_PATTERNS[i]?.test(cell.trim()); });
  return matches.length >= 3;
}
function isEmptyCell(val) { return val === "" || val === undefined || val === null || val === 0; }
function isSummaryRow(row) {
  const check = (text) => text.includes("fejezet összesen") || text.includes("összesen:") || text.includes("mindösszesen");
  const nameText = String(row[COL.NAME] ?? "").toLowerCase();
  if (check(nameText)) return true;
  const itemText = String(row[COL.ITEM_NUM] ?? "").toLowerCase();
  if (check(itemText)) return true;
  return false;
}
function isCategoryRow(row) {
  const ssz = row[COL.SSZ];
  const numericEmpty = isEmptyCell(row[COL.QUANTITY]) && isEmptyCell(row[COL.MAT_UNIT]) && isEmptyCell(row[COL.FEE_UNIT]);
  if (typeof ssz === "string" && ssz.trim().length > 0 && numericEmpty) return true;
  const itemNum = row[COL.ITEM_NUM];
  if (typeof itemNum === "string" && itemNum.trim().length > 0 && isEmptyCell(ssz) && isEmptyCell(row[COL.NAME]) && numericEmpty) return true;
  return false;
}
function getCategoryName(row) {
  const ssz = String(row[COL.SSZ] ?? "").trim();
  if (ssz) return ssz;
  return String(row[COL.ITEM_NUM] ?? "").trim();
}
function isDataRow(row) {
  const ssz = row[COL.SSZ];
  const name = row[COL.NAME];
  const sszNum = typeof ssz === "number" ? ssz : (typeof ssz === "string" ? parseFloat(ssz.replace(/\s/g, "")) : NaN);
  return !isNaN(sszNum) && sszNum > 0 && typeof name === "string" && name.trim().length > 0;
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
    if (shouldSkipSheet(sheetName)) { console.log(`  SKIP: "${sheetName}"`); continue; }
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (data.length === 0) { console.log(`  EMPTY: "${sheetName}"`); continue; }

    // Find header row (same as fixed parser)
    let headerRowIdx = -1;
    const maxScan = Math.min(data.length, 20);
    for (let i = 0; i < maxScan; i++) {
      if (isHeaderRow(data[i])) { headerRowIdx = i; break; }
    }

    let currentSubCategory = null;
    let itemCount = 0;
    const categories = [];
    let warningCount = 0;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const row = data[rowIdx];
      if (!row || row.length === 0) continue;
      // Skip rows up to and including header
      if (headerRowIdx >= 0 && rowIdx <= headerRowIdx) continue;
      if (isHeaderRow(row)) continue;
      if (isSummaryRow(row)) continue;
      if (isCategoryRow(row)) {
        currentSubCategory = getCategoryName(row);
        if (currentSubCategory) categories.push({ row: rowIdx, name: currentSubCategory.substring(0, 55) });
        continue;
      }
      if (isDataRow(row)) { itemCount++; continue; }
      // Check if non-empty
      const nonEmpty = row.filter(c => c !== "" && c !== null && c !== undefined);
      if (nonEmpty.length > 1) warningCount++;
    }

    console.log(`  SHEET: "${sheetName}" (header@row${headerRowIdx})`);
    console.log(`    Items: ${itemCount} | Categories: ${categories.length} | Warnings: ${warningCount}`);
    for (const c of categories) {
      console.log(`      [${c.row}] "${c.name}"`);
    }
    if (itemCount === 0) console.log(`    *** NO ITEMS ***`);
  }
}
