import test from 'node:test';
import assert from 'node:assert/strict';
import { listZipEntries } from '../src/utils/xlsx.mjs';
import { convertLegacySpreadsheetToCsv } from '../src/services/ingestion.mjs';

test('listZipEntries uses unzip listing that exists in the production image', () => {
  const calls = [];
  const entries = listZipEntries('/tmp/sample.xlsx', (command, args) => {
    calls.push({ command, args });
    return 'xl/workbook.xml\nxl/worksheets/sheet1.xml\n';
  });

  assert.deepEqual(calls, [{
    command: 'unzip',
    args: ['-Z1', '/tmp/sample.xlsx'],
  }]);
  assert.deepEqual(entries, ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
});

test('convertLegacySpreadsheetToCsv returns a clear error when ssconvert is unavailable', () => {
  assert.throws(
    () => convertLegacySpreadsheetToCsv('/tmp/sample.xls', () => {
      const error = new Error('spawn ssconvert ENOENT');
      error.code = 'ENOENT';
      throw error;
    }),
    /converter spreadsheet tidak tersedia/i,
  );
});
