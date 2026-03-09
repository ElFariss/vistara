import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../src/config.mjs';
import { initializeDatabase, run } from '../src/db.mjs';
import { layoutsIntersect } from '../shared/dashboard-layout.mjs';
import { executeAnalyticsIntent } from '../src/services/queryEngine.mjs';
import { DashboardAgentError, runDashboardAgent } from '../src/services/agentRuntime.mjs';

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

function geminiToolPayload({ text = null, functionCalls = [] } = {}) {
  const parts = [];
  if (typeof text === 'string') {
    parts.push({ text });
  }
  for (const call of functionCalls) {
    parts.push({
      functionCall: {
        name: call.name,
        args: call.args || {},
      },
    });
  }

  return {
    candidates: [
      {
        content: {
          parts,
        },
      },
    ],
  };
}

async function withMockGeminiToolResponses(responses, runTest) {
  const previousGeminiApiKey = config.geminiApiKey;
  const previousGeminiModel = config.geminiModel;
  const previousFetch = globalThis.fetch;
  const queue = [...responses];
  const requests = [];

  config.geminiApiKey = 'test-key';
  config.geminiModel = 'gemini-test';
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(String(options.body || '{}')));
    const next = queue.shift();
    if (!next) {
      throw new Error('unexpected_gemini_fetch');
    }
    return {
      ok: true,
      async json() {
        return next;
      },
      async text() {
        return JSON.stringify(next);
      },
    };
  };

  try {
    return await runTest({ requests });
  } finally {
    globalThis.fetch = previousFetch;
    config.geminiApiKey = previousGeminiApiKey;
    config.geminiModel = previousGeminiModel;
  }
}

function createDashboardAgentResponses({
  timePeriod = '30 hari terakhir',
  finalSummary = 'Omzet stabil dengan kontribusi kuat dari produk utama.',
  templates = ['total_revenue', 'total_profit', 'revenue_trend', 'top_products'],
  plannerFunctionCalls = [
    {
      name: 'submit_plan',
      args: {
        steps: [
          'Identifikasi KPI utama.',
          'Ambil tren penjualan inti.',
          'Susun layout dashboard yang ringkas dan jelas.',
        ],
      },
    },
  ],
  placements = [
    { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
    { title: 'Untung', page: 1, x: 4, y: 0, w: 4, h: 2, kind: 'metric' },
    { title: 'Trend Omzet', page: 1, x: 0, y: 2, w: 8, h: 4, kind: 'chart' },
    { title: 'Produk Terlaris', page: 1, x: 8, y: 2, w: 8, h: 4, kind: 'table' },
  ],
} = {}) {
  return [
    geminiToolPayload({
      functionCalls: plannerFunctionCalls,
    }),
    ...templates.map((templateId) => geminiToolPayload({
      functionCalls: [
        {
          name: 'query_template',
          args: {
            template_id: templateId,
            time_period: timePeriod,
            limit: templateId === 'top_products' ? 5 : null,
          },
        },
      ],
    })),
    geminiToolPayload({
      functionCalls: [
        {
          name: 'finalize_dashboard',
          args: {
            summary: finalSummary,
            layout_plan: {
              strategy: 'balanced',
              pages: Math.max(...placements.map((placement) => Number(placement.page || 1))),
              placements,
            },
          },
        },
      ],
    }),
    geminiToolPayload({
      functionCalls: [
        {
          name: 'submit_review',
          args: {
            verdict: 'good',
            completeness_pct: 100,
            summary: 'Layout konsisten dan artefak cukup untuk dipakai.',
          },
        },
      ],
    }),
  ];
}

test('executeAnalyticsIntent anchors relative period to latest dataset date', () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({ tenantId, date: '2024-01-18T00:00:00.000Z', revenue: 2_000_000 });

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

test('runDashboardAgent returns canvas widgets with findings instead of generic success copy', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({ tenantId, date: '2024-01-10T00:00:00.000Z', revenue: 1_500_000 });
    seedTransaction({ tenantId, date: '2024-01-11T00:00:00.000Z', revenue: 2_250_000 });
    seedTransaction({ tenantId, date: '2024-01-12T00:00:00.000Z', revenue: 1_900_000 });
    seedTransaction({ tenantId, date: '2024-01-13T00:00:00.000Z', revenue: 2_600_000 });

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        finalSummary: 'Omzet terus menguat dengan kontribusi terbesar dari produk inti. Margin tetap sehat dan tren penjualan bergerak naik.',
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard performa bisnis',
        intent: {
          intent: 'show_metric',
          time_period: '30 hari terakhir',
        },
      }),
    );

    assert.equal(response.presentation_mode, 'canvas');
    assert.ok(Array.isArray(response.widgets));
    assert.ok(response.widgets.length > 0);
    assert.equal(response.agent.fallback_used, false);

    const paragraphs = String(response.answer || '')
      .split(/\n\s*\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(paragraphs.length >= 1);
    assert.ok(paragraphs.length <= 2);
    assert.doesNotMatch(response.answer, /widget siap|dashboard siap|review selesai/i);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent preserves valid worker-authored page placements', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    for (let index = 0; index < 4; index += 1) {
      seedTransaction({
        tenantId,
        date: `2024-01-${10 + index}T00:00:00.000Z`,
        revenue: 1_500_000 + index * 200_000,
      });
    }

    const placements = [
      { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
      { title: 'Untung', page: 1, x: 4, y: 0, w: 4, h: 2, kind: 'metric' },
      { title: 'Trend Omzet', page: 2, x: 0, y: 0, w: 8, h: 4, kind: 'chart' },
      { title: 'Produk Terlaris', page: 2, x: 8, y: 0, w: 8, h: 4, kind: 'table' },
    ];

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({ placements }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard dua halaman',
        intent: {
          intent: 'show_metric',
          time_period: '30 hari terakhir',
        },
      }),
    );

    assert.equal(response.agent.worker.pages, 2);
    assert.ok(response.widgets.every((widget) => Number(widget.layout?.page || 0) >= 1));
    assert.equal(response.widgets.find((widget) => widget.title === 'Trend Omzet')?.layout?.page, 2);
    assert.equal(response.widgets.find((widget) => widget.title === 'Produk Terlaris')?.layout?.page, 2);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent repairs overlapping worker-authored layouts before returning widgets', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({ tenantId, date: '2024-01-18T00:00:00.000Z', revenue: 2_100_000 });

    const placements = [
      { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
      { title: 'Untung', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
    ];

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['total_revenue', 'total_profit'],
        placements,
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard omzet dan laba',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    assert.equal(response.widgets.length, 2);
    assert.equal(layoutsIntersect(response.widgets[0].layout, response.widgets[1].layout), false);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent rejects unusable dashboards with DASHBOARD_EMPTY', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    await assert.rejects(
      () => withMockGeminiToolResponses(
        createDashboardAgentResponses({
          templates: ['total_revenue', 'total_profit', 'revenue_trend', 'top_products'],
        }),
        () => runDashboardAgent({
          tenantId,
          userId,
          goal: 'Buat dashboard performa bisnis',
          intent: {
            intent: 'show_metric',
            time_period: '30 hari terakhir',
          },
        }),
      ),
      (error) => {
        assert.ok(error instanceof DashboardAgentError);
        assert.equal(error.code, 'DASHBOARD_EMPTY');
        assert.equal(error.statusCode, 422);
        return true;
      },
    );
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent builds findings from chart-only dashboards without generic success copy', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });
    seedTransaction({ tenantId, date: '2024-01-17T00:00:00.000Z', revenue: 1_950_000 });

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['revenue_trend'],
        placements: [
          { title: 'Trend Omzet', page: 1, x: 0, y: 0, w: 8, h: 4, kind: 'chart' },
        ],
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard tren omzet',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    assert.equal(response.widgets.length, 1);
    assert.equal(response.artifacts[0]?.kind, 'chart');
    assert.doesNotMatch(response.answer, /dashboard .* sudah siap/i);
    assert.match(response.answer, /trend|berakhir|puncak/i);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('runDashboardAgent falls back to deterministic planner steps when submit_plan is missing', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['total_revenue', 'revenue_trend'],
        plannerFunctionCalls: [],
        placements: [
          { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
          { title: 'Trend Omzet', page: 1, x: 0, y: 2, w: 8, h: 4, kind: 'chart' },
        ],
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard omzet minggu ini',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    assert.equal(response.widgets.length, 2);
    assert.equal(response.agent.planner.source, 'fallback');
    assert.equal(response.agent.planner.ok, true);
    assert.equal(response.agent.planner.reason, 'missing_submit_plan_call');
  } finally {
    cleanupTenant(tenantId);
  }
});
