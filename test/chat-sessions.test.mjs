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
import { getChatHistory, processChatMessage } from '../src/services/chat.mjs';

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

  config.geminiApiKey = 'test-key';
  config.geminiModel = 'gemini-test';
  config.geminiModelLight = 'gemini-test-light';
  globalThis.fetch = async () => {
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
    return await runTest();
  } finally {
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
    geminiPayloadFromText('Halo juga. Ada yang ingin Anda cek dari bisnis Anda?'),
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
    geminiPayloadFromText('Halo juga! Ada yang bisa Vira.'),
    geminiPayloadFromText('Halo. Ada yang ingin Anda cek dari bisnis Anda?'),
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
    geminiPayloadFromText('Lagi siap bantu analisis. Mau cek tren atau minta dashboard?'),
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

test('processChatMessage allows acknowledgment prompts as conversation', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('conversational', { reason: 'respons positif' }),
    geminiPayloadFromText('Siap. Kalau mau, saya lanjut bantu baca insight berikutnya.'),
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
    geminiPayloadFromText('Halo, ada yang ingin Anda tanyakan?'),
    routePayload('conversational', { reason: 'sapaan' }),
    geminiPayloadFromText('Baik. Saya siap bantu membaca data Anda.'),
    routePayload('conversational', { reason: 'sapaan' }),
    geminiPayloadFromText('Siap. Tinggal bilang insight apa yang ingin dicari.'),
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

test('processChatMessage asks for clarification instead of throwing for unclear prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  await withMockGeminiResponses([
    routePayload('ask_clarification', { reason: 'permintaan terlalu kabur' }),
    geminiPayloadFromText('Bisa diperjelas sedikit? Misalnya metrik, periode, atau dashboard yang ingin Anda lihat.'),
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
      geminiPayloadFromText('Halo. Ada yang ingin Anda cek dari bisnis Anda?'),
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
