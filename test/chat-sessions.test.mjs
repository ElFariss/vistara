import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabase, run } from '../src/db.mjs';
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

test('parseIntent keeps analytics prompts with "cek data" on the analytics path', async () => {
  const intent = await parseIntent('cek data penjualan minggu ini');
  assert.notEqual(intent.intent, 'dataset_inspection');
  assert.equal(intent.intent, 'show_metric');
  assert.equal(intent.time_period, 'minggu ini');
});
