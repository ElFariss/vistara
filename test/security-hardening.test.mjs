import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.mjs';
import { get, initializeDatabase, run } from '../src/db.mjs';
import { Router } from '../src/router.mjs';
import { registerAuthRoutes } from '../src/routes/auth.mjs';
import { resolveAllowedOrigin } from '../src/http/cors.mjs';
import { resolveClientIp } from '../src/http/request.mjs';
import { resolveHttpError, resolvePublicErrorMessage } from '../src/http/response.mjs';
import { generateJsonWithGemini, generateWithGeminiTools } from '../src/services/gemini.mjs';
import { parseDataset } from '../src/services/ingestion.mjs';

initializeDatabase();

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function seedTenantUser({ phone = '08123456789' } = {}) {
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
      name: 'Tenant Security',
      industry: 'Retail',
      city: 'Jakarta',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      created_at: now,
    },
  );

  run(
    `
      INSERT INTO users (id, tenant_id, email, password_hash, name, phone, phone_verified, created_at)
      VALUES (:id, :tenant_id, :email, :password_hash, :name, :phone, :phone_verified, :created_at)
    `,
    {
      id: userId,
      tenant_id: tenantId,
      email: `${userId}@example.test`,
      password_hash: 'test-hash',
      name: 'User Security',
      phone,
      phone_verified: 0,
      created_at: now,
    },
  );

  return { tenantId, userId, email: `${userId}@example.test` };
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

async function invokeRoute(router, method, routePath, { user, body } = {}) {
  const match = router.match(method, routePath);
  assert.ok(match, `Route ${method} ${routePath} should exist`);

  const res = createMockResponse();
  await match.route.handler({
    req: {},
    res,
    params: match.params,
    query: new URLSearchParams(),
    user: user || null,
    getBody: async () => body || {},
  });

  return {
    statusCode: res.statusCode,
    payload: res.body ? JSON.parse(res.body) : null,
  };
}

test('resolveClientIp ignores spoofed forwarded headers by default', () => {
  assert.equal(resolveClientIp({
    remoteAddress: '203.0.113.10',
    forwardedFor: '198.51.100.7',
    trustedProxyIps: [],
  }), '203.0.113.10');

  assert.equal(resolveClientIp({
    remoteAddress: '::ffff:127.0.0.1',
    forwardedFor: '198.51.100.7, 198.51.100.8',
    trustedProxyIps: ['127.0.0.1'],
  }), '198.51.100.7');
});

test('resolveAllowedOrigin fails closed in production without an allowlist', () => {
  assert.equal(resolveAllowedOrigin('https://app.example.com', {
    isProduction: true,
    allowedOrigins: [],
  }), null);

  assert.equal(resolveAllowedOrigin('https://app.example.com', {
    isProduction: false,
    allowedOrigins: [],
  }), null);

  assert.equal(resolveAllowedOrigin('http://localhost:5173', {
    isProduction: false,
    allowedOrigins: [],
  }), 'http://localhost:5173');

  assert.equal(resolveAllowedOrigin('http://127.0.0.1:3000', {
    isProduction: false,
    allowedOrigins: [],
  }), 'http://127.0.0.1:3000');

  assert.equal(resolveAllowedOrigin('https://app.example.com', {
    isProduction: true,
    allowedOrigins: ['https://app.example.com'],
  }), 'https://app.example.com');
});

test('resolvePublicErrorMessage hides raw 500 messages but preserves explicit 4xx messages', () => {
  assert.equal(
    resolvePublicErrorMessage({ statusCode: 500, message: 'SQLITE database is locked' }, 'Fallback aman.'),
    'Fallback aman.',
  );
  assert.equal(
    resolvePublicErrorMessage({ statusCode: 400, message: 'Input tidak valid.' }, 'Fallback aman.'),
    'Input tidak valid.',
  );
});

test('resolveHttpError preserves typed 4xx client errors for transport responses', () => {
  const oversized = resolveHttpError({
    statusCode: 413,
    code: 'PAYLOAD_TOO_LARGE',
    publicMessage: 'Ukuran request melebihi batas maksimum.',
  });

  assert.deepEqual(oversized, {
    statusCode: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Ukuran request melebihi batas maksimum.',
  });
});

test('Gemini requests use x-goog-api-key header instead of query string', async () => {
  const originalFetch = global.fetch;
  const previousApiKey = config.geminiApiKey;
  const previousModel = config.geminiModel;
  const requests = [];

  config.geminiApiKey = 'secret-key';
  config.geminiModel = 'gemini-test-model';
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: '{"ok":true}' }] } },
        ],
      }),
    };
  };

  try {
    const jsonResult = await generateJsonWithGemini({ userPrompt: 'hello' });
    assert.equal(jsonResult.ok, true);

    const toolResult = await generateWithGeminiTools({ userPrompt: 'hello', tools: [] });
    assert.equal(toolResult.ok, true);

    for (const request of requests) {
      assert.equal(new URL(request.url).search, '');
      assert.equal(request.options.headers['x-goog-api-key'], 'secret-key');
      assert.equal(request.options.headers['Content-Type'], 'application/json');
    }
  } finally {
    global.fetch = originalFetch;
    config.geminiApiKey = previousApiKey;
    config.geminiModel = previousModel;
  }
});

test('OTP send does not reveal whether an unauthenticated email exists', async () => {
  const router = new Router();
  registerAuthRoutes(router);

  const response = await invokeRoute(router, 'POST', '/api/auth/otp/send', {
    body: {
      email: 'missing-user@example.test',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.message, 'Jika akun dan nomor telepon tersedia, OTP akan dikirim.');
  assert.equal(response.payload.otp_preview, undefined);
});

test('OTP send keeps preview hidden by default even for valid accounts', async () => {
  const { tenantId, email } = seedTenantUser();
  const router = new Router();
  registerAuthRoutes(router);

  try {
    const response = await invokeRoute(router, 'POST', '/api/auth/otp/send', {
      body: { email },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.otp_preview, undefined);
  } finally {
    cleanupTenant(tenantId);
  }
});

test('OTP send reveals preview only when the explicit opt-in flag is enabled', async () => {
  const { tenantId, email } = seedTenantUser();
  const router = new Router();
  const previousOtpPreviewEnabled = config.otpPreviewEnabled;
  registerAuthRoutes(router);

  config.otpPreviewEnabled = true;

  try {
    const response = await invokeRoute(router, 'POST', '/api/auth/otp/send', {
      body: { email },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.payload.otp_preview, 'string');
  } finally {
    config.otpPreviewEnabled = previousOtpPreviewEnabled;
    cleanupTenant(tenantId);
  }
});

test('OTP verify returns a generic invalid response for unknown emails', async () => {
  const router = new Router();
  registerAuthRoutes(router);

  const response = await invokeRoute(router, 'POST', '/api/auth/otp/verify', {
    body: {
      email: 'missing-user@example.test',
      code: '123456',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.error.code, 'OTP_INVALID');
  assert.equal(response.payload.error.message, 'Kode OTP tidak valid atau sudah kedaluwarsa.');
});

test('OTP verify consumes the code after the configured number of failed attempts', async () => {
  const { tenantId, userId, email } = seedTenantUser();
  const router = new Router();
  const previousOtpMaxAttempts = config.otpMaxAttempts;
  const previousOtpPreviewEnabled = config.otpPreviewEnabled;
  registerAuthRoutes(router);

  config.otpMaxAttempts = 3;
  config.otpPreviewEnabled = true;

  try {
    const sendResponse = await invokeRoute(router, 'POST', '/api/auth/otp/send', {
      body: { email },
    });
    assert.equal(sendResponse.statusCode, 200);
    assert.equal(typeof sendResponse.payload.otp_preview, 'string');

    for (let attempt = 1; attempt <= config.otpMaxAttempts; attempt += 1) {
      const verifyResponse = await invokeRoute(router, 'POST', '/api/auth/otp/verify', {
        body: {
          email,
          code: '000000',
        },
      });
      assert.equal(verifyResponse.statusCode, 400);
      assert.equal(verifyResponse.payload.error.code, 'OTP_INVALID');
    }

    const otp = get(
      `
        SELECT failed_attempts, consumed_at
        FROM otp_codes
        WHERE user_id = :user_id
        ORDER BY created_at DESC
        LIMIT 1
      `,
      { user_id: userId },
    );

    assert.equal(Number(otp.failed_attempts), config.otpMaxAttempts);
    assert.ok(otp.consumed_at);

    const finalResponse = await invokeRoute(router, 'POST', '/api/auth/otp/verify', {
      body: {
        email,
        code: sendResponse.payload.otp_preview,
      },
    });
    assert.equal(finalResponse.statusCode, 400);
    assert.equal(finalResponse.payload.error.code, 'OTP_INVALID');
  } finally {
    config.otpMaxAttempts = previousOtpMaxAttempts;
    config.otpPreviewEnabled = previousOtpPreviewEnabled;
    cleanupTenant(tenantId);
  }
});

test('non-tabular raw uploads do not auto-forward to Gemini unless explicitly enabled', async () => {
  const previousRawUploadAiFallbackEnabled = config.rawUploadAiFallbackEnabled;
  const previousGeminiApiKey = config.geminiApiKey;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  const filePath = path.join(os.tmpdir(), `${uid('raw-upload')}.txt`);
  fs.writeFileSync(filePath, 'memo harian tanpa struktur tabel');

  config.rawUploadAiFallbackEnabled = false;
  config.geminiApiKey = 'test-key';
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called');
  };

  try {
    await assert.rejects(
      () => parseDataset(filePath, 'text', 'notes.txt'),
      /Format file tidak didukung/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    config.geminiApiKey = previousGeminiApiKey;
    config.rawUploadAiFallbackEnabled = previousRawUploadAiFallbackEnabled;
    fs.unlinkSync(filePath);
  }
});
