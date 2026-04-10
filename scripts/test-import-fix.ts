import { parseExcelBuffer } from '../lib/import/excel-parser';
import fs from 'fs';

const files = [
  'C:\\Users\\rattila\\Downloads\\03 SZSZC-GD_ K ép. III. ütem árazatlan kiv251213..xlsx',
  'C:\\Users\\rattila\\Downloads\\Szolnok_Baross_Gyengeáram_költségvetés_árazatlan.xlsx',
  'C:\\Users\\rattila\\Downloads\\Szolnok Baross kiv új árazatlan 088  2025 05 30 (4).xlsx',
];

for (const f of files) {
  if (!fs.existsSync(f)) { console.log('NOT FOUND:', f); continue; }
  const shortName = f.split('\\').pop();
  console.log('\n' + '='.repeat(60));
  console.log('FILE:', shortName);

  const buf = fs.readFileSync(f);
  const result = parseExcelBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  console.log('Total items:', result.totals.itemCount);
  console.log('Sheets parsed:', result.sheetSummaries.length);
  console.log('Sheets skipped:', result.skippedSheets.join(', '));
  console.log('Warnings:', result.warnings.length);

  for (const s of result.sheetSummaries) {
    console.log('  ' + s.sheetName + ': ' + s.itemCount + ' items, ' + s.subCategories.length + ' cats');
  }

  if (result.warnings.length > 0) {
    console.log('\nFirst 10 warnings:');
    for (const w of result.warnings.slice(0, 10)) {
      console.log('  [' + w.sheet + '] row ' + w.row + ': ' + w.message);
    }
  }
}
