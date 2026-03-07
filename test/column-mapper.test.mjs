import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestColumnMapping } from '../src/services/columnMapper.mjs';

test('column mapper derives revenue from Harga column for demo-like datasets', async () => {
  const result = await suggestColumnMapping(
    ['no', 'tanggal', 'merk', 'type', 'Harga', 'nama pembeli'],
    [
      {
        no: '1',
        tanggal: '01-01-2024',
        merk: 'Oppo',
        type: 'A18',
        Harga: '1498000',
        'nama pembeli': 'Sample',
      },
    ],
  );

  assert.equal(result.datasetType, 'transaction');
  assert.equal(result.mapping.transaction_date, 'tanggal');
  assert.equal(result.mapping.unit_price, 'Harga');
  assert.equal(result.mapping.total_revenue, '__derived__');
});
