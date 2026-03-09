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
import { parseIntent } from '../src/services/nlu.mjs';

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

  fs.unlinkSync(filePath);
}

test('processChatMessage allows hi as smalltalk', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const response = await processChatMessage({ tenantId, userId, message: 'hi' });

    assert.equal(response.intent.intent, 'smalltalk');
    assert.equal(response.presentation_mode, 'chat');
    assert.match(response.answer, /halo/i);
  } finally {
    cleanupTenant(tenantId);
  }
});

test("processChatMessage allows what's up as smalltalk", async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const response = await processChatMessage({ tenantId, userId, message: "what's up" });

    assert.equal(response.intent.intent, 'smalltalk');
    assert.equal(response.presentation_mode, 'chat');
    assert.match(response.answer, /siap/i);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('processChatMessage allows acknowledgment smalltalk prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const response = await processChatMessage({ tenantId, userId, message: 'mantap' });

    assert.equal(response.intent.intent, 'smalltalk');
    assert.equal(response.presentation_mode, 'chat');
    assert.match(response.answer, /siap/i);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('processChatMessage allows extended greeting smalltalk prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const responses = await Promise.all([
      processChatMessage({ tenantId, userId, message: 'permisi' }),
      processChatMessage({ tenantId, userId, message: 'gimana kabar' }),
      processChatMessage({ tenantId, userId, message: 'sup' }),
    ]);

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

test('processChatMessage returns a clarify error for unparseable prompts', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    await assert.rejects(
      () => processChatMessage({ tenantId, userId, message: 'asdfghjkl' }),
      (error) => error?.code === 'CHAT_CLARIFICATION_REQUIRED' && error?.statusCode === 400,
    );

    const history = getChatHistory({ tenantId, userId });
    assert.equal(history.messages.at(-1)?.payload?.error?.code, 'CHAT_CLARIFICATION_REQUIRED');
  } finally {
    cleanupTenant(tenantId);
  }
});

test('processChatMessage returns AI_SERVICE_UNAVAILABLE for dashboard requests without Gemini', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  try {
    await seedDataset({ tenantId, userId });
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
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    cleanupTenant(tenantId);
  }
});

test('parseIntent routes dashboard refinement follow-up to modify_dashboard', async () => {
  const intent = await parseIntent('edit dashboarnya jauh lebih detail dong');
  assert.equal(intent.intent, 'modify_dashboard');
  assert.equal(intent.dashboard_action, 'refine_layout');
});

test('chat stream error events include persisted conversation metadata for dashboard failures', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  try {
    await seedDataset({ tenantId, userId });
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
  }
});

test('chat route returns persisted conversation metadata for non-stream dashboard failures', async () => {
  const { tenantId, userId } = seedTenantUser();
  const previousGeminiApiKey = config.geminiApiKey;
  try {
    await seedDataset({ tenantId, userId });
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
    assert.equal(payload.error?.code, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(payload.persisted_in_conversation, true);
    assert.equal(payload.error?.persisted_in_conversation, true);
    assert.ok(payload.conversation_id);
  } finally {
    config.geminiApiKey = previousGeminiApiKey;
    cleanupTenant(tenantId);
  }
});
