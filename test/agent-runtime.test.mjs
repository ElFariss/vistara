import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../src/config.mjs';
import { initializeDatabase, run } from '../src/db.mjs';
import { executeAnalyticsIntent } from '../src/services/queryEngine.mjs';
import { runDashboardAgent } from '../src/services/agentRuntime.mjs';

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

initializeDatabase();

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

function seedTransaction({ tenantId, date = '2024-01-15T00:00:00.000Z', revenue = 1_500_000 }) {
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
      cogs: revenue * 0.7,
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

function artifactHasData(artifact) {
  if (!artifact) {
    return false;
  }
  if (artifact.kind === 'metric') {
    const raw = Number(artifact.raw_value);
    if (Number.isFinite(raw)) {
      return raw > 0;
    }
    return Number(String(artifact.value || '').replace(/[^0-9.-]/g, '')) > 0;
  }
  if (artifact.kind === 'table') {
    return Array.isArray(artifact.rows) && artifact.rows.length > 0;
  }
  if (artifact.kind === 'chart') {
    const values = (artifact.series || []).flatMap((series) => series.values || []);
    return values.some((value) => Number(value || 0) > 0);
  }
  return false;
}

async function withDeterministicDashboardAgent(runTest) {
  const previousGeminiApiKey = config.geminiApiKey;
  const previousGeminiModel = config.geminiModel;
  config.geminiApiKey = '';
  config.geminiModel = 'gemini-disabled-for-tests';
  try {
    return await runTest();
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    config.geminiModel = previousGeminiModel;
  }
}

test('executeAnalyticsIntent anchors relative period to latest dataset date', () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({
      tenantId,
      date: '2024-01-18T00:00:00.000Z',
      revenue: 2_000_000,
    });

    const result = executeAnalyticsIntent({
      tenantId,
      userId,
      intent: {
        intent: 'show_metric',
        metric: 'omzet',
        time_period: '7 hari terakhir',
      },
    });

    assert.equal(result.template_id, 'total_revenue');
    assert.ok(Number(result.widgets?.[0]?.value || 0) > 0);
    assert.equal(result.agent_context.period_anchored, true);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent builds dashboard widgets from template with non-empty artifacts', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({
      tenantId,
      date: '2024-01-10T00:00:00.000Z',
      revenue: 1_500_000,
    });
    seedTransaction({
      tenantId,
      date: '2024-01-11T00:00:00.000Z',
      revenue: 2_250_000,
    });

    const response = await withDeterministicDashboardAgent(() => runDashboardAgent({
      tenantId,
      userId,
      goal: 'Buat dashboard lengkap performa bisnis',
      intent: {
        intent: 'show_metric',
        time_period: '7 hari terakhir',
      },
    }));

    assert.equal(response.presentation_mode, 'canvas');
    assert.ok(Array.isArray(response.widgets));
    assert.ok(response.widgets.length > 0);
    assert.ok((response.artifacts || []).some((artifact) => artifactHasData(artifact)));
    assert.equal(response.agent.mode, 'multi_agent_runtime');
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent preserves an explicit component layout when it does not collide', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({
      tenantId,
      date: '2024-01-10T00:00:00.000Z',
      revenue: 1_500_000,
    });

    const response = await withDeterministicDashboardAgent(() => runDashboardAgent({
      tenantId,
      userId,
      goal: 'Buat dashboard omzet',
      intent: {
        intent: 'show_metric',
        time_period: '7 hari terakhir',
      },
      dashboard: {
        config: {
          components: [
            {
              id: 'component_1',
              type: 'TrendChart',
              title: 'Trend Omzet',
              metric: 'revenue_trend',
              layout: { x: 8, y: 2, w: 8, h: 4, page: 1 },
            },
          ],
        },
      },
    }));

    assert.equal(response.presentation_mode, 'canvas');
    assert.ok(Array.isArray(response.widgets));
    assert.ok(response.widgets.length >= 1);
    assert.equal(response.widgets[0].layout?.x, 8);
    assert.equal(response.widgets[0].layout?.y, 2);
    assert.equal(response.widgets[0].layout?.w, 8);
    assert.equal(response.widgets[0].layout?.h, 4);
    assert.equal(response.widgets[0].layout?.page, 1);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent preserves explicit dashboard component layout when provided', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({
      tenantId,
      date: '2024-01-11T00:00:00.000Z',
      revenue: 2_250_000,
    });

    const response = await withDeterministicDashboardAgent(() => runDashboardAgent({
      tenantId,
      userId,
      goal: 'Buat dashboard omzet sederhana',
      intent: {
        intent: 'show_metric',
        time_period: '7 hari terakhir',
      },
      dashboard: {
        id: 'dash_test',
        config: {
          components: [
            {
              type: 'MetricCard',
              title: 'Omzet',
              metric: 'revenue',
              layout: { x: 6, y: 0, w: 4, h: 2, page: 1 },
            },
          ],
        },
      },
    }));

    assert.equal(response.widgets[0]?.layout?.x, 6);
    assert.equal(response.widgets[0]?.layout?.page, 1);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent preserves explicit component layout when generating widgets', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({
      tenantId,
      date: '2024-01-18T00:00:00.000Z',
      revenue: 2_000_000,
    });

    const response = await withDeterministicDashboardAgent(() => runDashboardAgent({
      tenantId,
      userId,
      goal: 'Buat dashboard omzet dengan layout khusus',
      dashboard: {
        config: {
          components: [
            {
              type: 'MetricCard',
              title: 'Omzet',
              metric: 'revenue',
              layout: { x: 4, y: 1, w: 4, h: 2, page: 1 },
            },
          ],
        },
      },
      intent: {
        intent: 'show_metric',
        time_period: '7 hari terakhir',
      },
    }));

    assert.equal(response.presentation_mode, 'canvas');
    assert.equal(response.widgets?.[0]?.layout?.x, 4);
    assert.equal(response.widgets?.[0]?.layout?.y, 1);
    assert.equal(response.widgets?.[0]?.layout?.w, 4);
    assert.equal(response.widgets?.[0]?.layout?.h, 2);
  } finally {
    cleanupTenant(tenantId);
  }
});
