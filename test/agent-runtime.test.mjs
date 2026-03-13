import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../src/config.mjs';
import { initializeDatabase, run } from '../src/db.mjs';
import { layoutsIntersect } from '../public/dashboard-layout.js';
import { executeAnalyticsIntent } from '../src/services/queryEngine.mjs';
import { DashboardAgentError, runDashboardAgent } from '../src/services/agentRuntime.mjs';
import { resetGeminiQuotaCooldown } from '../src/services/gemini.mjs';

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

await initializeDatabase();

async function seedTenantUser() {
  const tenantId = uid('tenant');
  const userId = uid('user');
  const now = new Date().toISOString();

  await run(
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

  await run(
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

async function cleanupTenant(tenantId) {
  await run(`DELETE FROM tenants WHERE id = :id`, { id: tenantId });
}

async function seedTransaction({ tenantId, date = '2024-01-15T00:00:00.000Z', revenue = 1_500_000 }) {
  const branchId = uid('branch');
  const productId = uid('product');
  const branchName = `Cabang ${branchId}`;
  const productName = `Produk ${productId}`;
  const now = new Date().toISOString();

  await run(
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

  await run(
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

  await run(
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

  resetGeminiQuotaCooldown();
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
    resetGeminiQuotaCooldown();
    globalThis.fetch = previousFetch;
    config.geminiApiKey = previousGeminiApiKey;
    config.geminiModel = previousGeminiModel;
  }
}

function createDashboardAgentResponses({
  timePeriod = '30 hari terakhir',
  finalSummary = 'Omzet stabil dengan kontribusi kuat dari produk utama.',
  templates = ['total_revenue', 'total_profit', 'revenue_trend', 'top_products'],
  analysisFindings = null,
  reviewerResponses = null,
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
  const defaultReviewerResponse = {
    verdict: 'pass',
    completeness_pct: 100,
    summary: 'Layout konsisten dan artefak cukup untuk dipakai.',
    issues: [],
    directives: {
      expand_titles: [],
      add_templates: [],
      notes: [],
    },
  };
  const finalReviewerResponses = Array.isArray(reviewerResponses) && reviewerResponses.length > 0
    ? reviewerResponses
    : [defaultReviewerResponse, defaultReviewerResponse];
  const defaultFindings = (Array.isArray(analysisFindings) ? analysisFindings : templates).map((templateId, index) => {
    if (templateId && typeof templateId === 'object') {
      return {
        id: templateId.id || `finding_${index + 1}`,
        candidate_id: templateId.candidate_id || `candidate_${index + 1}`,
        insight: templateId.insight || 'Insight dashboard belum tersedia.',
        evidence: templateId.evidence || 'Evidence dashboard belum tersedia.',
        why_it_matters: templateId.why_it_matters || 'Alasan bisnis belum tersedia.',
        recommended_visual: templateId.recommended_visual || 'chart',
        priority: templateId.priority || (index === 0 ? 'primary' : 'supporting'),
      };
    }

    const normalized = String(templateId || '').trim().toLowerCase();
    if (normalized === 'revenue_trend') {
      return {
        id: `finding_${index + 1}`,
        candidate_id: templateId,
        insight: 'Tren omzet perlu ditampilkan untuk melihat arah perubahan penjualan.',
        evidence: 'Perubahan nilai omzet harian terlihat jelas pada periode aktif.',
        why_it_matters: 'agar pola naik turun harian dan titik puncak cepat terbaca',
        recommended_visual: 'line',
        priority: index === 0 ? 'primary' : 'supporting',
      };
    }
    if (normalized === 'top_products') {
      return {
        id: `finding_${index + 1}`,
        candidate_id: templateId,
        insight: 'Produk terlaris perlu ditampilkan untuk melihat kontributor utama omzet.',
        evidence: 'Ada perbedaan kontribusi yang jelas antar produk.',
        why_it_matters: 'agar produk yang paling mendorong omzet bisa dikenali tanpa membuka tabel mentah',
        recommended_visual: 'table',
        priority: 'supporting',
      };
    }
    if (normalized === 'total_profit') {
      return {
        id: `finding_${index + 1}`,
        candidate_id: templateId,
        insight: 'Untung bersih perlu ditampilkan agar penjualan tidak dibaca tanpa konteks laba.',
        evidence: 'Nilai profit tersedia untuk periode aktif.',
        why_it_matters: 'agar user bisa membedakan penjualan yang ramai dengan hasil bersih yang benar-benar tersisa',
        recommended_visual: 'metric',
        priority: index === 0 ? 'primary' : 'supporting',
      };
    }
    return {
      id: `finding_${index + 1}`,
      candidate_id: templateId,
      insight: 'Omzet utama perlu ditampilkan sebagai acuan performa inti.',
      evidence: 'Nilai omzet total tersedia untuk periode aktif.',
      why_it_matters: 'agar user langsung tahu skala omzet pada periode ini sebelum masuk ke rincian lain',
      recommended_visual: 'metric',
      priority: index === 0 ? 'primary' : 'supporting',
    };
  });

  return [
    geminiToolPayload({
      functionCalls: [
        {
          name: 'submit_analysis_brief',
          args: {
            headline: defaultFindings[0]?.insight || 'Temuan utama tersedia.',
            business_goal: 'Buat dashboard bisnis yang ringkas.',
            time_scope: timePeriod,
            findings: defaultFindings,
          },
        },
      ],
    }),
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
              pages: placements.length > 0
                ? Math.max(...placements.map((placement) => Number(placement.page || 1)))
                : 1,
              placements,
            },
          },
        },
      ],
    }),
    ...finalReviewerResponses.map((response) => geminiToolPayload({
      text: JSON.stringify(response),
    })),
  ];
}

test('executeAnalyticsIntent anchors relative period to latest dataset date', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-18T00:00:00.000Z', revenue: 2_000_000 });

    const result = await executeAnalyticsIntent({
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
    assert.equal(result.content_format, 'markdown');
    assert.match(result.answer, /\*\*.+\*\*/);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent returns canvas widgets with findings instead of generic success copy', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-10T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-11T00:00:00.000Z', revenue: 2_250_000 });
    await seedTransaction({ tenantId, date: '2024-01-12T00:00:00.000Z', revenue: 1_900_000 });
    await seedTransaction({ tenantId, date: '2024-01-13T00:00:00.000Z', revenue: 2_600_000 });

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
    assert.ok(response.analysis_brief);
    assert.ok(Array.isArray(response.analysis_brief.findings));
    assert.ok(response.analysis_brief.findings.length > 0);
    assert.ok(response.widgets.every((widget) => typeof widget.finding_id === 'string' && widget.finding_id.length > 0));
    assert.ok(response.widgets.every((widget) => typeof widget.rationale === 'string' && widget.rationale.length > 0));

    assert.match(response.answer, /Ringkasan dashboard:/);
    assert.match(response.answer, /Apa yang terlihat:/);
    assert.match(response.answer, /Insight analis:/);
    assert.match(response.answer, /Saran opsional:/);
    assert.doesNotMatch(response.answer, /\.\.\./);
    assert.doesNotMatch(response.answer, /widget siap|dashboard siap|review selesai/i);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent keeps long analysis findings intact without backend ellipsis', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-13T00:00:00.000Z', revenue: 1_200_000 });
    await seedTransaction({ tenantId, date: '2024-01-14T00:00:00.000Z', revenue: 1_800_000 });
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_050_000 });

    const longInsight = 'Trend Omzet ikut ditampilkan untuk memahami fluktuasi harian yang membantu mengidentifikasi pola penjualan, penurunan di akhir rentang, serta momen lonjakan yang relevan untuk keputusan stok dan promosi tanpa harus membuka tabel mentah satu per satu di belakang layar.';
    const longEvidence = 'Tren pendapatan menunjukkan penurunan menjelang akhir periode setelah sempat mencapai puncak yang jelas di pertengahan rentang, sehingga perubahan arah performa bisa dibaca langsung dari visual tanpa perlu menjumlah ulang data transaksi secara manual.';
    const longWhy = 'Visual ini penting karena user non-teknis biasanya perlu alasan yang langsung terhubung ke keputusan bisnis, misalnya kapan promosi perlu diperkuat, kapan stok perlu diamankan, dan kapan investigasi cabang atau produk harus diprioritaskan.';

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        analysisFindings: [
          {
            id: 'finding_long_trend',
            candidate_id: 'revenue_trend',
            insight: longInsight,
            evidence: longEvidence,
            why_it_matters: longWhy,
            recommended_visual: 'line',
            priority: 'primary',
          },
        ],
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard penjualan yang grounded',
        intent: {
          intent: 'show_metric',
          time_period: '30 hari terakhir',
        },
      }),
    );

    assert.equal(response.presentation_mode, 'canvas');
    assert.doesNotMatch(response.answer, /\.\.\./);
    assert.match(response.answer, /stok dan promosi tanpa harus membuka tabel mentah satu per satu/);
    assert.match(response.answer, /promosi perlu diperkuat, kapan stok perlu diamankan/);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent preserves valid worker-authored page placements', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    for (let index = 0; index < 4; index += 1) {
      await seedTransaction({
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
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent repairs overlapping worker-authored layouts before returning widgets', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-18T00:00:00.000Z', revenue: 2_100_000 });

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

    assert.ok(response.widgets.length >= 2);
    const titles = response.widgets.map((widget) => widget.title);
    assert.ok(titles.includes('Omzet'));
    assert.ok(titles.includes('Untung'));
    for (let index = 0; index < response.widgets.length; index += 1) {
      for (let other = index + 1; other < response.widgets.length; other += 1) {
        assert.equal(layoutsIntersect(response.widgets[index].layout, response.widgets[other].layout), false);
      }
    }
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent rejects unusable dashboards with DASHBOARD_EMPTY', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await assert.rejects(
      () => withMockGeminiToolResponses(
        createDashboardAgentResponses({
          templates: ['top_products'],
          placements: [{ title: 'Produk Terlaris', page: 1, x: 0, y: 0, w: 8, h: 4, kind: 'table' }],
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
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent builds findings from chart-only dashboards without generic success copy', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });
    await seedTransaction({ tenantId, date: '2024-01-17T00:00:00.000Z', revenue: 1_950_000 });

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

    assert.ok(response.widgets.length >= 1);
    assert.ok(response.artifacts.some((artifact) => artifact?.kind === 'chart'));
    assert.doesNotMatch(response.answer, /dashboard .* sudah siap/i);
    assert.match(response.answer, /trend|berakhir|puncak/i);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent falls back to deterministic planner steps when submit_plan is missing', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

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

    assert.ok(response.widgets.length >= 2);
    assert.ok(response.widgets.some((widget) => widget.title === 'Omzet'));
    assert.ok(response.widgets.some((widget) => widget.title === 'Trend Omzet'));
    assert.equal(response.agent.planner.source, 'fallback');
    assert.equal(response.agent.planner.ok, true);
    assert.equal(response.agent.planner.reason, 'missing_submit_plan_call');
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent dedupes repeated worker outputs and collapses unused second pages', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

    const response = await withMockGeminiToolResponses(
      [
        geminiToolPayload({
          functionCalls: [
            {
              name: 'submit_analysis_brief',
              args: {
                headline: 'Omzet utama perlu ditampilkan sebagai acuan performa inti.',
                business_goal: 'Buat dashboard ringkas omzet.',
                time_scope: '7 hari terakhir',
                findings: [
                  {
                    id: 'finding_1',
                    candidate_id: 'total_revenue',
                    insight: 'Omzet utama perlu ditampilkan sebagai acuan performa inti.',
                    evidence: 'Nilai omzet total tersedia untuk periode aktif.',
                    why_it_matters: 'agar user langsung tahu skala omzet pada periode ini sebelum masuk ke rincian lain',
                    recommended_visual: 'metric',
                    priority: 'primary',
                  },
                ],
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'submit_plan',
              args: {
                steps: [
                  'Baca template dashboard.',
                  'Ambil KPI utama.',
                  'Finalisasi layout yang ringkas.',
                ],
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'query_template',
              args: {
                template_id: 'total_revenue',
                time_period: '7 hari terakhir',
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'query_template',
              args: {
                template_id: 'total_revenue',
                time_period: '7 hari terakhir',
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'finalize_dashboard',
              args: {
                summary: 'Fokus utama tetap pada omzet inti.',
                layout_plan: {
                  strategy: 'balanced',
                  pages: 2,
                  placements: [
                    { title: 'Omzet', template_id: 'total_revenue', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
                    { title: 'Omzet', template_id: 'total_revenue', page: 2, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
                  ],
                },
              },
            },
          ],
        }),
        geminiToolPayload({
          text: JSON.stringify({
            verdict: 'pass',
            completeness_pct: 100,
            summary: 'Satu KPI kuat sudah cukup untuk ringkasan ini.',
            issues: [],
            directives: { expand_titles: [], add_templates: [], notes: [] },
          }),
        }),
        geminiToolPayload({
          text: JSON.stringify({
            verdict: 'pass',
            completeness_pct: 100,
            summary: 'Pass verifikasi kedua juga menilai dashboard ini cukup ringkas.',
            issues: [],
            directives: { expand_titles: [], add_templates: [], notes: [] },
          }),
        }),
      ],
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard ringkas omzet',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    assert.ok(response.widgets.length >= 1);
    assert.ok(response.artifacts.length >= 1);
    assert.ok(response.widgets.some((widget) => widget?.title === 'Omzet'));
    assert.ok(response.widgets.every((widget) => Number(widget?.layout?.page || 1) === 1));
    assert.equal(new Set(response.widgets.map((widget) => widget.title)).size, response.widgets.length);
    assert.equal(response.agent.worker.pages, 1);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent stops after repeated duplicate worker calls instead of inflating latency', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

    const response = await withMockGeminiToolResponses(
      [
        geminiToolPayload({
          functionCalls: [
            {
              name: 'submit_analysis_brief',
              args: {
                headline: 'Omzet utama perlu ditampilkan sebagai acuan performa inti.',
                business_goal: 'Buat dashboard omzet singkat.',
                time_scope: '7 hari terakhir',
                findings: [
                  {
                    id: 'finding_1',
                    candidate_id: 'total_revenue',
                    insight: 'Omzet utama perlu ditampilkan sebagai acuan performa inti.',
                    evidence: 'Nilai omzet total tersedia untuk periode aktif.',
                    why_it_matters: 'agar user langsung tahu skala omzet pada periode ini sebelum masuk ke rincian lain',
                    recommended_visual: 'metric',
                    priority: 'primary',
                  },
                ],
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'submit_plan',
              args: {
                steps: [
                  'Ambil KPI utama.',
                  'Hindari query berulang.',
                  'Selesaikan dashboard.',
                ],
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'query_template',
              args: {
                template_id: 'total_revenue',
                time_period: '7 hari terakhir',
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'query_template',
              args: {
                template_id: 'total_revenue',
                time_period: '7 hari terakhir',
              },
            },
          ],
        }),
        geminiToolPayload({
          functionCalls: [
            {
              name: 'query_template',
              args: {
                template_id: 'total_revenue',
                time_period: '7 hari terakhir',
              },
            },
          ],
        }),
        geminiToolPayload({
          text: JSON.stringify({
            verdict: 'pass',
            completeness_pct: 100,
            summary: 'Tidak perlu tool tambahan.',
            issues: [],
            directives: { expand_titles: [], add_templates: [], notes: [] },
          }),
        }),
        geminiToolPayload({
          text: JSON.stringify({
            verdict: 'pass',
            completeness_pct: 100,
            summary: 'Pass verifikasi kedua juga tidak menemukan masalah tambahan.',
            issues: [],
            directives: { expand_titles: [], add_templates: [], notes: [] },
          }),
        }),
      ],
      async ({ requests }) => {
        const result = await runDashboardAgent({
          tenantId,
          userId,
          goal: 'Buat dashboard omzet singkat',
          intent: {
            intent: 'show_metric',
            time_period: '7 hari terakhir',
          },
        });

        assert.ok(result.widgets.length >= 1);
        assert.ok(result.widgets.some((widget) => widget?.title === 'Omzet'));
        assert.ok(result.widgets.every((widget) => Number(widget?.layout?.page || 1) === 1));
        assert.equal(result.agent.tool_calls, 1);
        assert.ok(requests.length <= 7);
        return result;
      },
    );

    assert.ok(response.widgets.some((widget) => widget?.title === 'Omzet'));
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent expands layout to use at least 96% of the page width', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });
    await seedTransaction({ tenantId, date: '2024-01-17T00:00:00.000Z', revenue: 1_950_000 });

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['total_revenue', 'revenue_trend'],
        placements: [
          { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
          { title: 'Trend Omzet', page: 1, x: 0, y: 2, w: 8, h: 4, kind: 'chart' },
        ],
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard omzet yang ringkas',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    const rightEdge = response.widgets.reduce((max, widget) => (
      Number(widget.layout?.page || 1) === 1
        ? Math.max(max, Number(widget.layout?.x || 0) + Number(widget.layout?.w || 0))
        : max
    ), 0);
    const occupiedArea = response.widgets.reduce((sum, widget) => (
      Number(widget.layout?.page || 1) === 1
        ? sum + (Number(widget.layout?.w || 0) * Number(widget.layout?.h || 0))
        : sum
    ), 0);
    const contentHeight = response.widgets.reduce((max, widget) => (
      Number(widget.layout?.page || 1) === 1
        ? Math.max(max, Number(widget.layout?.y || 0) + Number(widget.layout?.h || 0))
        : max
    ), 0);
    const densityPct = occupiedArea / Math.max(1, rightEdge * contentHeight);
    const rowCoverage = new Map();
    for (const widget of response.widgets) {
      if (Number(widget.layout?.page || 1) !== 1) {
        continue;
      }
      const startRow = Number(widget.layout?.y || 0);
      const endRow = startRow + Number(widget.layout?.h || 0);
      const startCol = Number(widget.layout?.x || 0);
      const endCol = startCol + Number(widget.layout?.w || 0);
      for (let row = startRow; row < endRow; row += 1) {
        const columns = rowCoverage.get(row) || new Set();
        for (let column = startCol; column < endCol; column += 1) {
          columns.add(column);
        }
        rowCoverage.set(row, columns);
      }
    }
    let sparseRowCount = 0;
    let maxRightGapCols = 0;
    let topGapRows = 0;
    for (let row = 0; row < contentHeight; row += 1) {
      const columns = rowCoverage.get(row) || new Set();
      const coveragePct = columns.size / 16;
      const rowRightEdge = columns.size > 0 ? Math.max(...columns) + 1 : 0;
      if (columns.size === 0 && row === topGapRows) {
        topGapRows += 1;
      }
      if (coveragePct < 0.7) {
        sparseRowCount += 1;
      }
      maxRightGapCols = Math.max(maxRightGapCols, 16 - rowRightEdge);
    }

    assert.ok(rightEdge >= 16);
    assert.ok(densityPct >= 0.72);
    assert.equal(topGapRows, 0);
    assert.equal(sparseRowCount, 0);
    assert.ok(maxRightGapCols <= 4);
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent performs at least two reviewer passes before finalizing', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

    await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['total_revenue', 'revenue_trend'],
        placements: [
          { title: 'Omzet', page: 1, x: 0, y: 0, w: 8, h: 2, kind: 'metric' },
          { title: 'Trend Omzet', page: 1, x: 0, y: 2, w: 16, h: 4, kind: 'chart' },
        ],
      }),
      async ({ requests }) => {
        const response = await runDashboardAgent({
          tenantId,
          userId,
          goal: 'Buat dashboard omzet mingguan',
          intent: {
            intent: 'show_metric',
            time_period: '7 hari terakhir',
          },
        });

        const reviewerPasses = requests.filter((request) => (
          JSON.stringify(request).includes('dashboard UX curator')
        )).length;

        assert.equal(response.presentation_mode, 'canvas');
        assert.ok(reviewerPasses >= 2);
      },
    );
  } finally {
    await cleanupTenant(tenantId);
  }
});

test('runDashboardAgent returns a needs_review draft instead of throwing when reviewer rejects an otherwise usable dashboard', async () => {
  const { tenantId, userId } = await seedTenantUser();
  try {
    await seedTransaction({ tenantId, date: '2024-01-15T00:00:00.000Z', revenue: 1_500_000 });
    await seedTransaction({ tenantId, date: '2024-01-16T00:00:00.000Z', revenue: 2_250_000 });

    const response = await withMockGeminiToolResponses(
      createDashboardAgentResponses({
        templates: ['total_revenue', 'revenue_trend'],
        placements: [
          { title: 'Omzet', page: 1, x: 0, y: 0, w: 4, h: 2, kind: 'metric' },
          { title: 'Trend Omzet', page: 1, x: 0, y: 2, w: 8, h: 4, kind: 'chart' },
        ],
        reviewerResponses: [
          {
            verdict: 'fail',
            completeness_pct: 42,
            summary: 'Masih ada area yang perlu dirapikan.',
            issues: ['Hierarchy lemah'],
            directives: {
              expand_titles: [],
              add_templates: [],
              notes: ['Perlu review tambahan'],
            },
          },
        ],
      }),
      () => runDashboardAgent({
        tenantId,
        userId,
        goal: 'Buat dashboard omzet mingguan',
        intent: {
          intent: 'show_metric',
          time_period: '7 hari terakhir',
        },
      }),
    );

    assert.equal(response.presentation_mode, 'canvas');
    assert.equal(response.draft_status, 'needs_review');
    assert.equal(response.agent.reviewer_meta.requires_attention, true);
    assert.match(response.answer, /perlu dirapikan sebelum dianggap final/i);
    assert.ok(response.widgets.length > 0);
  } finally {
    await cleanupTenant(tenantId);
  }
});
