import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabase, run, get, all } from '../src/db.mjs';
import { Router } from '../src/router.mjs';
import { getAnomalies, getDailyVerdict, getTrends } from '../src/services/insights.mjs';
import { ingestUploadedSource } from '../src/services/ingestion.mjs';
import { registerDataRoutes } from '../src/routes/data.mjs';

initializeDatabase();

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function seedTenantUser() {
  const tenantId = uid('tenant');
  const userId = uid('user');
  const now = new Date().toISOString();

  run(
    `
      INSERT INTO tenants (id, name, industry, city, timezone, currency, created_at)
      VALUES (:id, :name, :industry, :city, :timezone, :currency, :created_at)
    `,
    {
      id: tenantId,
      name: 'Tenant Test',
      industry: 'Retail',
      city: 'Jakarta',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      created_at: now,
    },
  );

  run(
    `
      INSERT INTO users (id, tenant_id, email, password_hash, name, created_at)
      VALUES (:id, :tenant_id, :email, :password_hash, :name, :created_at)
    `,
    {
      id: userId,
      tenant_id: tenantId,
      email: `${userId}@example.test`,
      password_hash: 'test-hash',
      name: 'User Test',
      created_at: now,
    },
  );

  return { tenantId, userId };
}

function cleanupTenant(tenantId) {
  run(`DELETE FROM tenants WHERE id = :id`, { id: tenantId });
}

function seedTransaction({ tenantId, date, revenue, cogs = null }) {
  const branchId = uid('branch');
  const productId = uid('product');
  const branchName = `Cabang ${branchId.slice(-4)}`;
  const productName = `Produk ${productId.slice(-4)}`;
  const now = new Date().toISOString();

  run(
    `
      INSERT INTO branches (id, tenant_id, name, created_at)
      VALUES (:id, :tenant_id, :name, :created_at)
    `,
    {
      id: branchId,
      tenant_id: tenantId,
      name: branchName,
      created_at: now,
    },
  );

  run(
    `
      INSERT INTO products (id, tenant_id, name, category, created_at)
      VALUES (:id, :tenant_id, :name, :category, :created_at)
    `,
    {
      id: productId,
      tenant_id: tenantId,
      name: productName,
      category: 'Handphone',
      created_at: now,
    },
  );

  run(
    `
      INSERT INTO transactions (
        id, tenant_id, transaction_date, product_id, branch_id, customer_id,
        quantity, unit_price, total_revenue, cogs, discount, channel,
        payment_method, source_file_id, raw_data, checksum, created_at
      ) VALUES (
        :id, :tenant_id, :transaction_date, :product_id, :branch_id, :customer_id,
        :quantity, :unit_price, :total_revenue, :cogs, :discount, :channel,
        :payment_method, :source_file_id, :raw_data, :checksum, :created_at
      )
    `,
    {
      id: uid('trx'),
      tenant_id: tenantId,
      transaction_date: date,
      product_id: productId,
      branch_id: branchId,
      customer_id: null,
      quantity: 1,
      unit_price: revenue,
      total_revenue: revenue,
      cogs: cogs ?? revenue * 0.7,
      discount: 0,
      channel: 'offline',
      payment_method: 'cash',
      source_file_id: null,
      raw_data: '{}',
      checksum: uid('checksum'),
      created_at: now,
    },
  );
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk ? String(chunk) : '';
    },
  };
}

async function invokeRoute(router, method, routePath, { user, body } = {}) {
  const match = router.match(method, routePath);
  assert.ok(match, `Route ${method} ${routePath} should exist`);

  const res = createMockResponse();
  await match.route.handler({
    req: {},
    res,
    params: match.params,
    query: new URLSearchParams(),
    user,
    getBody: async () => body || {},
  });

  return {
    statusCode: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null,
  };
}

function insertSourceFileRecord({ tenantId, filePath, mapping, filename = 'phones.csv' }) {
  const sourceId = uid('source');
  run(
    `
      INSERT INTO source_files (
        id, tenant_id, filename, file_type, file_path,
        upload_date, row_count, column_mapping, status, metadata_json
      ) VALUES (
        :id, :tenant_id, :filename, :file_type, :file_path,
        :upload_date, :row_count, :column_mapping, :status, :metadata_json
      )
    `,
    {
      id: sourceId,
      tenant_id: tenantId,
      filename,
      file_type: 'csv',
      file_path: filePath,
      upload_date: new Date().toISOString(),
      row_count: 0,
      column_mapping: JSON.stringify({
        dataset_type: 'transaction',
        mapping,
      }),
      status: 'uploaded',
      metadata_json: JSON.stringify({}),
    },
  );

  return sourceId;
}

test('insights anchor stale trends, anomalies, and verdict to latest dataset date', () => {
  const { tenantId } = seedTenantUser();

  try {
    const dates = [
      ['2024-01-12T00:00:00.000Z', 100_000],
      ['2024-01-13T00:00:00.000Z', 100_000],
      ['2024-01-14T00:00:00.000Z', 100_000],
      ['2024-01-15T00:00:00.000Z', 100_000],
      ['2024-01-16T00:00:00.000Z', 100_000],
      ['2024-01-17T00:00:00.000Z', 100_000],
      ['2024-01-18T00:00:00.000Z', 1_000_000],
    ];

    for (const [date, revenue] of dates) {
      seedTransaction({ tenantId, date, revenue });
    }

    const trends = getTrends(tenantId);
    const anomalies = getAnomalies(tenantId);
    const verdict = getDailyVerdict(tenantId);

    assert.equal(trends.period.anchored, true);
    assert.equal(trends.period.anchor_date.slice(0, 10), '2024-01-18');
    assert.equal(trends.summary.revenue_latest, 1_000_000);
    assert.ok(anomalies.some((item) => item.type === 'revenue_spike' && item.day === '2024-01-18'));
    assert.equal(verdict.metrics.reference_date, '2024-01-18');
    assert.equal(verdict.metrics.revenue_today, 1_000_000);
    assert.equal(verdict.metrics.revenue_yesterday, 100_000);
    assert.match(verdict.sentence, /2024-01-18/);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('ingestion composes usable product names from merk and type style datasets', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('dataset')}.csv`);

  fs.writeFileSync(filePath, [
    'tanggal,merk,type,Harga',
    '01-01-2024,Oppo,A18,1498000',
    '02-01-2024,Samsung,A15,2999000',
  ].join('\n'));

  try {
    const ingested = await ingestUploadedSource({
      tenantId,
      userId,
      filePath,
      filename: 'phones.csv',
      contentType: 'text/csv',
      replaceExisting: true,
    });

    const mappingRecord = get(
      `
        SELECT column_mapping
        FROM source_files
        WHERE id = :id AND tenant_id = :tenant_id
      `,
      {
        id: ingested.source.id,
        tenant_id: tenantId,
      },
    );
    const mapping = JSON.parse(mappingRecord.column_mapping || '{}');
    const productNames = all(
      `
        SELECT name
        FROM products
        WHERE tenant_id = :tenant_id
        ORDER BY name
      `,
      { tenant_id: tenantId },
    ).map((row) => row.name);

    assert.equal(mapping.mapping.product_name, 'type');
    assert.deepEqual(productNames, ['Oppo A18', 'Samsung A15']);
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('ingestion respects explicit product mapping when brand is selected', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('dataset-brand')}.csv`);

  fs.writeFileSync(filePath, [
    'tanggal,merk,type,Harga',
    '01-01-2024,Oppo,A18,1498000',
    '02-01-2024,Samsung,A15,2999000',
  ].join('\n'));

  try {
    insertSourceFileRecord({
      tenantId,
      filePath,
      mapping: {
        transaction_date: 'tanggal',
        product_name: 'merk',
        unit_price: 'Harga',
        total_revenue: '__derived__',
      },
    });

    const source = get(
      `
        SELECT id
        FROM source_files
        WHERE tenant_id = :tenant_id
        ORDER BY upload_date DESC
        LIMIT 1
      `,
      { tenant_id: tenantId },
    );

    const { processSourceFile } = await import('../src/services/ingestion.mjs');
    await processSourceFile({
      tenantId,
      userId,
      sourceId: source.id,
    });

    const productNames = all(
      `
        SELECT name
        FROM products
        WHERE tenant_id = :tenant_id
        ORDER BY name
      `,
      { tenant_id: tenantId },
    ).map((row) => row.name);

    assert.deepEqual(productNames, ['Oppo', 'Samsung']);
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('data profile endpoint returns the latest dataset profile for authenticated tenants', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('profile')}.csv`);

  fs.writeFileSync(filePath, [
    'no,tanggal,merk,type,Harga,aktif',
    '1,01-01-2024,Oppo,A18,1498000,1',
    '2,02-01-2024,Samsung,A15,2999000,0',
  ].join('\n'));

  try {
    await ingestUploadedSource({
      tenantId,
      userId,
      filePath,
      filename: 'phones.csv',
      contentType: 'text/csv',
      replaceExisting: true,
    });

    const router = new Router();
    registerDataRoutes(router);
    const response = await invokeRoute(router, 'GET', '/api/data/profile', {
      user: { id: userId, tenant_id: tenantId },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.payload;
    assert.equal(payload.ok, true);
    assert.equal(payload.profile.summary.rows, 2);
    assert.equal(payload.profile.mapping.mapping.product_name, 'type');
    assert.ok(Array.isArray(payload.profile.columns));
    assert.ok(payload.profile.columns.length >= 6);
    assert.deepEqual(payload.profile.detected.date_columns, ['tanggal']);
    assert.ok(payload.profile.detected.numeric_columns.includes('no'));
    assert.ok(payload.profile.detected.numeric_columns.includes('Harga'));
    assert.ok(!payload.profile.detected.numeric_columns.includes('type'));
    assert.ok(payload.profile.detected.categorical_columns.includes('type'));
    assert.ok(!payload.profile.detected.date_columns.includes('no'));
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('data profile inspect endpoint answers in Indonesian and keeps SKU-like values categorical', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('profile-inspect')}.csv`);

  fs.writeFileSync(filePath, [
    'tanggal,merk,type,Harga',
    '01-01-2024,Oppo,A18,1498000',
    '02-01-2024,Samsung,A15,2999000',
  ].join('\n'));

  try {
    await ingestUploadedSource({
      tenantId,
      userId,
      filePath,
      filename: 'phones.csv',
      contentType: 'text/csv',
      replaceExisting: true,
    });

    const router = new Router();
    registerDataRoutes(router);
    const response = await invokeRoute(router, 'POST', '/api/data/profile/inspect', {
      user: { id: userId, tenant_id: tenantId },
      body: { message: 'cek kolom dan kualitas dataset saya' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.match(response.payload.answer, /Saya menemukan 4 kolom/);
    const typeColumn = response.payload.profile.columns.find((column) => column.name === 'type');
    assert.equal(typeColumn.kind, 'string');
    assert.equal(response.payload.artifacts[0].title, 'Kolom Dataset');
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('data repair endpoint repairs latest source and returns restored product dimension details', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('repair')}.csv`);

  fs.writeFileSync(filePath, [
    'tanggal,merk,type,Harga',
    '01-01-2024,Oppo,A18,1498000',
    '02-01-2024,Samsung,A15,2999000',
  ].join('\n'));

  try {
    insertSourceFileRecord({
      tenantId,
      filePath,
      mapping: {
        transaction_date: 'tanggal',
        unit_price: 'Harga',
        total_revenue: '__derived__',
      },
    });

    const router = new Router();
    registerDataRoutes(router);
    const response = await invokeRoute(router, 'POST', '/api/data/repair', {
      user: { id: userId, tenant_id: tenantId },
      body: { required_capability: 'product_dimension' },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.repair.repaired, true);
    assert.equal(response.payload.repair.analysis.suggestion.mapping.product_name, 'type');

    const productNames = all(
      `
        SELECT name
        FROM products
        WHERE tenant_id = :tenant_id
        ORDER BY name
      `,
      { tenant_id: tenantId },
    ).map((row) => row.name);

    assert.deepEqual(productNames, ['Oppo A18', 'Samsung A15']);
    assert.equal(Number(get(`SELECT COUNT(*) AS value FROM transactions WHERE tenant_id = :tenant_id`, {
      tenant_id: tenantId,
    }).value || 0), 2);
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('data repair endpoint returns explicit 404 when no latest source exists', async () => {
  const { tenantId, userId } = seedTenantUser();

  try {
    const router = new Router();
    registerDataRoutes(router);
    const response = await invokeRoute(router, 'POST', '/api/data/repair', {
      user: { id: userId, tenant_id: tenantId },
      body: { required_capability: 'product_dimension' },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.payload.ok, false);
    assert.equal(response.payload.error.code, 'SOURCE_NOT_FOUND');
    assert.equal(response.payload.error.details.reason, 'source_not_found');
  } finally {
    cleanupTenant(tenantId);
  }
});
