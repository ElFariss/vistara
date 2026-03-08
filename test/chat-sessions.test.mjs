import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabase, run } from '../src/db.mjs';
import { Router } from '../src/router.mjs';
import { registerChatRoutes } from '../src/routes/chat.mjs';
import { ingestUploadedSource } from '../src/services/ingestion.mjs';
import { createConversation, getChatHistory, listChatConversations, processChatMessage } from '../src/services/chat.mjs';
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
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk ? String(chunk) : '';
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

  return {
    statusCode: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null,
  };
}

test('getChatHistory resumes the latest conversation instead of creating another blank one', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const conversation = createConversation({ tenantId, userId });
    await processChatMessage({
      tenantId,
      userId,
      conversationId: conversation.id,
      message: 'tes koneksi',
    });

    const history = getChatHistory({ tenantId, userId });
    assert.equal(history.conversation_id, conversation.id);
    assert.equal(listChatConversations({ tenantId, userId }).length, 1);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('getChatHistory rejects an explicit stale conversation id instead of rebinding to latest', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const conversation = createConversation({ tenantId, userId });
    await processChatMessage({
      tenantId,
      userId,
      conversationId: conversation.id,
      message: 'tes koneksi',
    });

    assert.throws(
      () =>
        getChatHistory({
          tenantId,
          userId,
          conversationId: 'conversation_does_not_exist',
        }),
      (error) => error?.code === 'CONVERSATION_NOT_FOUND',
    );
  } finally {
    cleanupTenant(tenantId);
  }
});

test('createConversation always creates a fresh session', () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const first = createConversation({ tenantId, userId });
    const second = createConversation({ tenantId, userId });

    assert.notEqual(first.id, second.id);
    assert.equal(listChatConversations({ tenantId, userId }).length, 2);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('processChatMessage answers dataset inspection questions in chat', async () => {
  const { tenantId, userId } = seedTenantUser();
  const filePath = path.join(os.tmpdir(), `${uid('dataset-inspection')}.csv`);

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

    const response = await processChatMessage({
      tenantId,
      userId,
      message: 'cek kolom dan kualitas dataset saya',
    });

    assert.equal(response.intent.intent, 'dataset_inspection');
    assert.ok(Array.isArray(response.artifacts));
    assert.ok(response.artifacts.length > 0);
    assert.equal(response.presentation_mode, 'chat');
  } finally {
    cleanupTenant(tenantId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

test('processChatMessage rejects an explicit stale conversation id instead of writing into latest', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const conversation = createConversation({ tenantId, userId });
    await processChatMessage({
      tenantId,
      userId,
      conversationId: conversation.id,
      message: 'tes koneksi',
    });

    const before = getChatHistory({
      tenantId,
      userId,
      conversationId: conversation.id,
    });

    await assert.rejects(
      () =>
        processChatMessage({
          tenantId,
          userId,
          conversationId: 'conversation_does_not_exist',
          message: 'berapa omzet hari ini?',
        }),
      (error) => error?.code === 'CONVERSATION_NOT_FOUND',
    );

    const after = getChatHistory({
      tenantId,
      userId,
      conversationId: conversation.id,
    });

    assert.equal(after.messages.length, before.messages.length);
    assert.equal(listChatConversations({ tenantId, userId }).length, 1);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('chat routes return 404 for explicit stale conversation ids', async () => {
  const { tenantId, userId } = seedTenantUser();
  try {
    const conversation = createConversation({ tenantId, userId });
    await processChatMessage({
      tenantId,
      userId,
      conversationId: conversation.id,
      message: 'tes koneksi',
    });

    const router = new Router();
    registerChatRoutes(router);

    const historyResponse = await invokeRoute(router, 'GET', '/api/chat/history', {
      user: { id: userId, tenant_id: tenantId },
      query: 'conversation_id=conversation_does_not_exist',
    });
    assert.equal(historyResponse.statusCode, 404);
    assert.equal(historyResponse.payload.error.code, 'CONVERSATION_NOT_FOUND');

    const chatResponse = await invokeRoute(router, 'POST', '/api/chat', {
      user: { id: userId, tenant_id: tenantId },
      body: {
        conversation_id: 'conversation_does_not_exist',
        message: 'berapa omzet hari ini?',
      },
    });
    assert.equal(chatResponse.statusCode, 404);
    assert.equal(chatResponse.payload.error.code, 'CONVERSATION_NOT_FOUND');
  } finally {
    cleanupTenant(tenantId);
  }
});

test('parseIntent keeps analytics prompts with "cek data" on the analytics path', async () => {
  const intent = await parseIntent('cek data penjualan minggu ini');
  assert.notEqual(intent.intent, 'dataset_inspection');
  assert.equal(intent.intent, 'show_metric');
  assert.equal(intent.time_period, 'minggu ini');
});

test('parseIntent keeps dashboard prompts with field selections on the dashboard path', async () => {
  const intent = await parseIntent('buat dashboard field omzet dan laba');
  assert.notEqual(intent.intent, 'dataset_inspection');
});
