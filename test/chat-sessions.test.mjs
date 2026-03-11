import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.mjs';
import { initializeDatabase, run } from '../src/db.mjs';
import { Router } from '../src/router.mjs';
import { registerChatRoutes } from '../src/routes/chat.mjs';
import { ingestUploadedSource } from '../src/services/ingestion.mjs';
import { createDashboard } from '../src/services/dashboards.mjs';
import { getChatHistory, processChatMessage } from '../src/services/chat.mjs';
import { resetGeminiQuotaCooldown } from '../src/services/gemini.mjs';

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
      name: 'Tenant Chat',
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
      name: 'User Chat',
      created_at: now,
    },
  );

  return { tenantId, userId };
}

function cleanupTenant(tenantId) {
  run(`DELETE FROM tenants WHERE id = :id`, { id: tenantId });
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    destroyed: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk = '') {
      this.body += chunk ? String(chunk) : '';
    },
    end(chunk = '') {
      this.body += chunk ? String(chunk) : '';
      this.writableEnded = true;
    },
  };
}

async function invokeRoute(router, method, routePath, { user, body, query } = {}) {
  const match = router.match(method, routePath);
  assert.ok(match, `Route ${method} ${routePath} should exist`);

  const res = createMockResponse();
  await match.route.handler({
    req: {},
    res,
    params: match.params,
    query: new URLSearchParams(query || ''),
    user,
    getBody: async () => body || {},
  });

  return res;
}

async function seedDataset({ tenantId, userId }) {
  const filePath = path.join(os.tmpdir(), `${uid('chat-dataset')}.csv`);
  fs.writeFileSync(filePath, [
    'tanggal,merk,type,harga',
    '2024-01-01,Oppo,A18,1498000',
    '2024-01-02,Samsung,A15,2999000',
    '2024-01-03,Xiaomi,Redmi 13,1999000',
  ].join('\n'));

  await ingestUploadedSource({
    tenantId,
    userId,
    filePath,
    filename: 'phones.csv',
    contentType: 'text/csv',
    replaceExisting: true,
  });

  return filePath;
}

function geminiPayloadFromText(text) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  };
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

function surfaceReplyPayload(answer, { replyKind = 'smalltalk', complete = true } = {}) {
  return geminiToolPayload({
    functionCalls: [{
      name: 'reply_user',
      args: {
        answer,
        reply_kind: replyKind,
        complete,
      },
    }],
  });
}

function routePayload(action, overrides = {}) {
  return geminiToolPayload({
    functionCalls: [{
      name: 'route_request',
      args: {
        action,
        reason: overrides.reason || null,
        time_period: overrides.time_period || null,
        metric: overrides.metric || null,
        visualization: overrides.visualization || null,
        dimension: overrides.dimension || null,
        limit: overrides.limit || null,
        branch: overrides.branch || null,
        channel: overrides.channel || null,
      },
    }],
  });
}

function createMinimalDashboardAgentResponses({ timePeriod = '30 hari terakhir' } = {}) {
  return [
    geminiToolPayload({
      functionCalls: [{
        name: 'submit_analysis_brief',
        args: {
          headline: 'Omzet menjadi fokus utama pada periode ini.',
          business_goal: 'Membuat dashboard ringkas dari dataset aktif.',
          time_scope: timePeriod,
          findings: [
            {
              id: 'finding_total_revenue',
              candidate_id: 'query_template_total_revenue',
              insight: 'Omzet menjadi temuan utama pada periode ini.',
              evidence: 'Omzet menunjukkan sinyal bisnis utama yang paling cepat terbaca.',
              why_it_matters: 'visual ini dipakai untuk menempatkan KPI utama di depan user lebih dulu',
              recommended_visual: 'metric',
              priority: 'primary',
            },
          ],
        },
      }],
    }),
    geminiToolPayload({
      functionCalls: [{
        name: 'submit_plan',
        args: {
          steps: ['Ambil KPI utama.', 'Buat draft dashboard ringkas.'],
        },
      }],
    }),
    geminiToolPayload({
      functionCalls: [{
        name: 'query_template',
        args: {
          template_id: 'total_revenue',
          time_period: timePeriod,
        },
      }],
    }),
    geminiToolPayload({
      functionCalls: [{
        name: 'finalize_dashboard',
        args: {
          summary: 'Omzet menjadi fokus utama dashboard.',
          layout_plan: {
            strategy: 'balanced',
            pages: 1,
            placements: [
              { title: 'Omzet', template_id: 'total_revenue', kind: 'metric', page: 1, x: 0, y: 0, w: 4, h: 2 },
            ],
          },
        },
      }],
    }),
    geminiToolPayload({
      text: JSON.stringify({
        verdict: 'pass',
        completeness_pct: 100,
        summary: 'Dashboard cukup kuat untuk user.',
        issues: [],
        directives: {
          expand_titles: [],
          add_templates: [],
          notes: [],
        },
      }),
    }),
  ];
}

async function withMockGeminiResponses(responses, runTest) {
  const previousGeminiApiKey = config.geminiApiKey;
  const previousGeminiModel = config.geminiModel;
  const previousGeminiModelLight = config.geminiModelLight;
  const previousFetch = globalThis.fetch;
  const queue = [...responses];
  const urls = [];

  resetGeminiQuotaCooldown();
  config.geminiApiKey = 'test-key';
  config.geminiModel = 'gemini-test';
  config.geminiModelLight = 'gemini-test-light';
  globalThis.fetch = async (url) => {
    urls.push(String(url || ''));
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
    return await runTest({ urls });
  } finally {
    resetGeminiQuotaCooldown();
    globalThis.fetch = previousFetch;
    config.geminiApiKey = previousGeminiApiKey;
    config.geminiModel = previousGeminiModel;
    config.geminiModelLight = previousGeminiModelLight;
  }
}

test('processChatMessage allows hi as smalltalk through the agent runtime', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Halo juga. Ada yang ingin Anda cek dari bisnis Anda?'),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'hi' });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.equal(response.presentation_mode, 'chat');
      assert.match(response.answer, /halo/i);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage retries truncated Vira replies before persisting', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Halo juga! Ada yang bisa Vira.', { complete: false }),
    surfaceReplyPayload('Halo. Ada yang ingin Anda cek dari bisnis Anda?'),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'hi' });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.equal(response.answer, 'Halo. Ada yang ingin Anda cek dari bisnis Anda?');
      assert.doesNotMatch(response.answer, /demo user/i);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test("processChatMessage allows what's up as natural conversation", async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'obrolan ringan' }),
    surfaceReplyPayload('Lagi siap bantu analisis. Mau cek tren atau minta dashboard?'),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: "what's up" });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.equal(response.presentation_mode, 'chat');
      assert.match(response.answer, /siap/i);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage returns a complete onboarding reply for capability questions', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'pertanyaan kemampuan awal' }),
    surfaceReplyPayload('Mulainya gampang: upload file lewat tombol plus atau drag file ke chat, lalu tulis pertanyaan analisis yang Anda butuhkan.', {
      replyKind: 'capability',
    }),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'cara mulainya gimana ya?' });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.match(response.answer, /upload file|drag file|chat/i);
      assert.match(response.answer, /[.!?]$/);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage retries incomplete clarification replies for follow-up prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('ask_clarification', { reason: 'follow-up masih kabur' }),
    surfaceReplyPayload('Mohon maaf, sepertinya.', {
      replyKind: 'clarification',
      complete: false,
    }),
    surfaceReplyPayload('Bagian mana yang ingin Anda ulang: cara mulai, analisis data, atau pembuatan dashboard?', {
      replyKind: 'clarification',
    }),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'gimana gimana?' });

      assert.equal(response.intent.intent, 'clarify');
      assert.match(response.answer, /cara mulai|analisis data|dashboard/i);
      assert.match(response.answer, /\?$/);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage auto-builds a dashboard when route classification stays vague but dataset is ready', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = await seedDataset({ tenantId, userId });

  await withMockGeminiResponses([
    routePayload('ask_clarification', { reason: 'permintaan masih samar' }),
    ...createMinimalDashboardAgentResponses(),
  ], async () => {
    try {
      const response = await processChatMessage({
        tenantId,
        userId,
        message: 'buatin dashboard dong',
      });

      assert.equal(response.presentation_mode, 'canvas');
      assert.equal(response.intent.intent, 'create_dashboard');
      assert.equal(response.content_format, 'markdown');
      assert.match(response.answer, /Ringkasan dashboard:/);
      assert.ok(response.dashboard?.id);
      assert.equal(response.draft_dashboard?.saved_dashboard_id, response.dashboard.id);
    } finally {
      fs.unlinkSync(filePath);
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage continues dashboard creation for vague follow-up replies after an earlier dashboard ask', async () => {
  const { tenantId, userId } = seedTenantUser();
  let filePath = null;

  try {
    const initial = await withMockGeminiResponses([
      routePayload('ask_clarification', { reason: 'assistant meminta preferensi dashboard' }),
      surfaceReplyPayload('Mau fokus ke metrik atau dimensi tertentu untuk dashboard-nya?', {
        replyKind: 'clarification',
      }),
    ], async () => processChatMessage({
      tenantId,
      userId,
      message: 'bro buatin dashboard dong',
    }));

    filePath = await seedDataset({ tenantId, userId });

    const followUp = await withMockGeminiResponses([
      routePayload('ask_clarification', { reason: 'permintaan follow-up masih samar' }),
      ...createMinimalDashboardAgentResponses(),
    ], async () => processChatMessage({
      tenantId,
      userId,
      conversationId: initial.conversation_id,
      message: 'ngga tau buat aja',
    }));

    assert.equal(followUp.presentation_mode, 'canvas');
    assert.equal(followUp.intent.intent, 'create_dashboard');
    assert.equal(followUp.content_format, 'markdown');
    assert.ok(followUp.dashboard?.id);
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    cleanupTenant(tenantId);
  }
});

test('processChatMessage promotes inspect_dataset to dashboard creation when the user still asks for a dashboard', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = await seedDataset({ tenantId, userId });

  await withMockGeminiResponses([
    routePayload('inspect_dataset', { reason: 'user menyebut lihat dataset' }),
    ...createMinimalDashboardAgentResponses(),
  ], async () => {
    try {
      const response = await processChatMessage({
        tenantId,
        userId,
        message: 'lihat aja datasetnya dan buatin dashboard',
      });

      assert.equal(response.presentation_mode, 'canvas');
      assert.equal(response.intent.intent, 'create_dashboard');
      assert.equal(response.content_format, 'markdown');
      assert.ok(response.dashboard?.id);
    } finally {
      fs.unlinkSync(filePath);
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage asks whether to edit or create when a meaningful dashboard already exists', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = await seedDataset({ tenantId, userId });
  const existingDashboard = createDashboard(tenantId, userId, 'Dashboard Aktif', {
    mode: 'manual',
    pages: 1,
    components: [
      { id: 'metric_1', type: 'MetricCard', title: 'Omzet', metric: 'revenue' },
      { id: 'trend_1', type: 'TrendChart', title: 'Trend Omzet', metric: 'revenue', granularity: 'day' },
    ],
    updated_by: 'assistant',
  });

  try {
    const initial = await withMockGeminiResponses([
      routePayload('create_dashboard', { reason: 'user meminta dashboard baru' }),
    ], async () => processChatMessage({
      tenantId,
      userId,
      message: 'buatin dashboard dong',
      dashboardId: existingDashboard.id,
    }));

    assert.equal(initial.intent.intent, 'clarify_dashboard_choice');
    assert.equal(initial.presentation_mode, 'chat');
    assert.equal(initial.content_format, 'markdown');
    assert.match(initial.answer, /balas `edit`/i);
    assert.match(initial.answer, /balas `baru`/i);

    const followUp = await withMockGeminiResponses([
      ...createMinimalDashboardAgentResponses(),
    ], async () => processChatMessage({
      tenantId,
      userId,
      message: 'baru',
      conversationId: initial.conversation_id,
      dashboardId: existingDashboard.id,
    }));

    assert.equal(followUp.presentation_mode, 'canvas');
    assert.ok(followUp.dashboard?.id);
    assert.notEqual(followUp.dashboard.id, existingDashboard.id);
    assert.equal(followUp.draft_dashboard?.saved_dashboard_id, followUp.dashboard.id);
  } finally {
    fs.unlinkSync(filePath);
    cleanupTenant(tenantId);
  }
});

test('processChatMessage allows acknowledgment prompts as conversation', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'respons positif' }),
    surfaceReplyPayload('Siap. Kalau mau, saya lanjut bantu baca insight berikutnya.'),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'mantap' });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.equal(response.presentation_mode, 'chat');
      assert.match(response.answer, /siap/i);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage handles extended greetings through Gemini classification', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Halo, ada yang ingin Anda tanyakan?'),
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Baik. Saya siap bantu membaca data Anda.'),
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Siap. Tinggal bilang insight apa yang ingin dicari.'),
  ], async () => {
    try {
      const responses = [];
      responses.push(await processChatMessage({ tenantId, userId, message: 'permisi' }));
      responses.push(await processChatMessage({ tenantId, userId, message: 'gimana kabar' }));
      responses.push(await processChatMessage({ tenantId, userId, message: 'sup' }));

      for (const response of responses) {
        assert.equal(response.intent.intent, 'smalltalk');
        assert.equal(response.presentation_mode, 'chat');
        assert.equal(typeof response.answer, 'string');
        assert.ok(response.answer.length > 0);
      }
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage uses the light Gemini model for surface replies', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'sapaan' }),
    surfaceReplyPayload('Halo, ada yang ingin Anda tanyakan?'),
  ], async ({ urls }) => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'permisi' });

      assert.equal(response.intent.intent, 'smalltalk');
      assert.match(urls[0] || '', /models\/gemini-test:generateContent/);
      assert.match(urls[1] || '', /models\/gemini-test-light:generateContent/);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage asks for clarification instead of throwing for unclear prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('ask_clarification', { reason: 'permintaan terlalu kabur' }),
    surfaceReplyPayload('Bisa diperjelas sedikit? Misalnya metrik, periode, atau dashboard yang ingin Anda lihat.', {
      replyKind: 'clarification',
    }),
  ], async () => {
    try {
      const response = await processChatMessage({ tenantId, userId, message: 'asdfghjkl' });

      assert.equal(response.intent.intent, 'clarify');
      assert.equal(response.presentation_mode, 'chat');
      assert.match(response.answer, /perjelas/i);

      const history = getChatHistory({ tenantId, userId, conversationId: response.conversation_id });
      assert.equal(history.messages.at(-1)?.payload?.error, undefined);
    } finally {
      cleanupTenant(tenantId);
    }
  });
});

test('processChatMessage returns AI_SERVICE_UNAVAILABLE for dashboard requests without Gemini', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  let filePath = null;
  try {
    filePath = await seedDataset({ tenantId, userId });
    config.geminiApiKey = '';

    await assert.rejects(
      () => processChatMessage({
        tenantId,
        userId,
        message: 'buat dashboard performa bulan ini',
      }),
      (error) => error?.code === 'AI_SERVICE_UNAVAILABLE' && error?.statusCode === 503,
    );

    const history = getChatHistory({ tenantId, userId });
    assert.equal(history.messages.at(-1)?.payload?.error?.code, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(history.messages.at(-1)?.content, 'Layanan AI belum tersedia.');
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    cleanupTenant(tenantId);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('processChatMessage routes dashboard refinement through the creator runtime and stores a draft', async () => {
  const { tenantId, userId } = seedTenantUser();
  let filePath = null;
  try {
    filePath = await seedDataset({ tenantId, userId });
    await withMockGeminiResponses([
      routePayload('edit_dashboard', { reason: 'permintaan edit dashboard', time_period: '30 hari terakhir' }),
      ...createMinimalDashboardAgentResponses({ timePeriod: '30 hari terakhir' }),
    ], async () => {
      const response = await processChatMessage({
        tenantId,
        userId,
        message: 'edit dashboarnya jauh lebih detail dong',
      });

      assert.equal(response.intent.intent, 'modify_dashboard');
      assert.equal(response.presentation_mode, 'canvas');
      assert.ok(Array.isArray(response.widgets));
      assert.ok(response.widgets.length >= 1);
      assert.ok(response.draft_dashboard);
      assert.ok(Array.isArray(response.draft_dashboard.widgets));

      const history = getChatHistory({ tenantId, userId, conversationId: response.conversation_id });
      assert.ok(history.agent_state?.draft_dashboard);
      assert.ok(Array.isArray(history.agent_state.draft_dashboard.widgets));
    });
  } finally {
    cleanupTenant(tenantId);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('chat stream error events include persisted conversation metadata for dashboard failures', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  let filePath = null;
  try {
    filePath = await seedDataset({ tenantId, userId });
    config.geminiApiKey = '';

    const router = new Router();
    registerChatRoutes(router);
    const res = await invokeRoute(router, 'POST', '/api/chat/stream', {
      user: { id: userId, tenant_id: tenantId },
      body: {
        message: 'buat dashboard performa bulan ini',
      },
    });

    const events = res.body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const errorEvent = events.find((event) => event.type === 'error');

    assert.ok(errorEvent);
    assert.equal(errorEvent.code, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(errorEvent.status, 503);
    assert.equal(errorEvent.persisted_in_conversation, true);
    assert.ok(errorEvent.conversation_id);
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    cleanupTenant(tenantId);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('chat stream keeps simple smalltalk free of timeline events', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const router = new Router();
    registerChatRoutes(router);

    await withMockGeminiResponses([
      routePayload('conversational', { reason: 'sapaan' }),
      surfaceReplyPayload('Halo. Ada yang ingin Anda cek dari bisnis Anda?'),
    ], async () => {
      const res = await invokeRoute(router, 'POST', '/api/chat/stream', {
        user: { id: userId, tenant_id: tenantId },
        body: {
          message: 'hi',
        },
      });

      const events = res.body
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      assert.equal(events.some((event) => event.type === 'timeline_start' || event.type === 'timeline_step'), false);
      assert.equal(events.at(-1)?.type, 'final');
    });
  } finally {
    cleanupTenant(tenantId);
  }
});

test('processChatMessage returns explicit AI error when Vira stays incomplete after retry', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    await assert.rejects(
      () => withMockGeminiResponses([
        routePayload('conversational', { reason: 'sapaan' }),
        surfaceReplyPayload('Baik, untuk memul.', { complete: false }),
        surfaceReplyPayload('Mohon maaf, sepertinya.', { complete: false }),
      ], async () => processChatMessage({ tenantId, userId, message: 'cara mulainya gimana ya?' })),
      (error) => error?.code === 'AI_SERVICE_UNAVAILABLE' && error?.reason === 'surface_reply_incomplete',
    );
  } finally {
    cleanupTenant(tenantId);
  }
});

test('chat route returns persisted conversation metadata for non-stream dashboard failures', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  let filePath = null;
  try {
    filePath = await seedDataset({ tenantId, userId });
    config.geminiApiKey = '';

    const router = new Router();
    registerChatRoutes(router);
    const res = await invokeRoute(router, 'POST', '/api/chat', {
      user: { id: userId, tenant_id: tenantId },
      body: {
        message: 'buat dashboard performa bulan ini',
      },
    });

    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 503);
    assert.equal(payload.error.code, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(payload.persisted_in_conversation, true);
    assert.ok(payload.conversation_id);
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    cleanupTenant(tenantId);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});
