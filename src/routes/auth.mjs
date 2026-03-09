import fs from 'node:fs';
import path from 'node:path';
import { get, run } from '../db.mjs';
import { hashSecret, randomNumericCode, sha256, verifySecret } from '../utils/security.mjs';
import { generateId } from '../utils/ids.mjs';
import { issueAuthToken } from '../http/auth.mjs';
import { resolvePublicErrorMessage, sendError, sendJson } from '../http/response.mjs';
import { config } from '../config.mjs';
import { ingestUploadedSource } from '../services/ingestion.mjs';

function validateRegisterBody(body) {
  if (!body.email || !body.password || !body.name) {
    return 'email, password, dan name wajib diisi.';
  }
  if (String(body.password).length < 8) {
    return 'password minimal 8 karakter.';
  }
  return null;
}

function buildOtpSendPayload({ otpPreview = null } = {}) {
  const payload = {
    ok: true,
    message: 'Jika akun dan nomor telepon tersedia, OTP akan dikirim.',
  };

  if (otpPreview && !config.isProduction) {
    payload.otp_preview = otpPreview;
  }

  return payload;
}

function sendInvalidOtp(res) {
  return sendError(res, 400, 'OTP_INVALID', 'Kode OTP tidak valid atau sudah kedaluwarsa.');
}

export function registerAuthRoutes(router) {
  router.register('POST', '/api/auth/demo', async (ctx) => {
    const demoDataset = path.resolve(process.cwd(), 'test.csv');
    if (!fs.existsSync(demoDataset)) {
      return sendError(ctx.res, 500, 'DEMO_DATASET_MISSING', 'File demo test.csv tidak ditemukan di server.');
    }

    const tenantId = generateId();
    const userId = generateId();
    const now = new Date().toISOString();
    const demoEmail = `demo_${userId.slice(0, 10)}@guest.local`;

    run(
      `
        INSERT INTO tenants (id, name, industry, city, timezone, currency, morning_verdict_time, created_at)
        VALUES (:id, :name, :industry, :city, :timezone, :currency, :morning_verdict_time, :created_at)
      `,
      {
        id: tenantId,
        name: 'Demo Workspace',
        industry: 'Demo',
        city: 'Jakarta',
        timezone: 'Asia/Jakarta',
        currency: 'IDR',
        morning_verdict_time: '07:00',
        created_at: now,
      },
    );

    run(
      `
        INSERT INTO users (id, tenant_id, email, password_hash, name, phone, phone_verified, role, created_at)
        VALUES (:id, :tenant_id, :email, :password_hash, :name, :phone, :phone_verified, :role, :created_at)
      `,
      {
        id: userId,
        tenant_id: tenantId,
        email: demoEmail,
        password_hash: hashSecret(generateId()),
        name: 'Demo User',
        phone: null,
        phone_verified: 1,
        role: 'demo',
        created_at: now,
      },
    );

    const storedPath = path.join(config.uploadDir, `${generateId()}-test.csv`);
    fs.copyFileSync(demoDataset, storedPath);

    try {
      await ingestUploadedSource({
        tenantId,
        userId,
        filePath: storedPath,
        filename: 'test.csv',
        contentType: 'text/csv',
        replaceExisting: true,
      });
    } catch (error) {
      if (fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
      }
      return sendError(
        ctx.res,
        500,
        'DEMO_SETUP_FAILED',
        resolvePublicErrorMessage(error, 'Gagal menyiapkan demo saat ini.'),
      );
    }

    const token = issueAuthToken({
      id: userId,
      tenant_id: tenantId,
      role: 'demo',
      email: demoEmail,
    });

    return sendJson(ctx.res, 201, {
      ok: true,
      demo: true,
      token,
      user: {
        id: userId,
        tenant_id: tenantId,
        email: demoEmail,
        name: 'Demo User',
        role: 'demo',
      },
      message: 'Demo siap digunakan.',
    });
  });

  router.register('POST', '/api/auth/register', async (ctx) => {
    const body = await ctx.getBody();
    const error = validateRegisterBody(body);
    if (error) {
      return sendError(ctx.res, 400, 'VALIDATION_ERROR', error);
    }

    const existing = get(`SELECT id FROM users WHERE LOWER(email) = LOWER(:email)`, {
      email: body.email,
    });

    if (existing) {
      return sendError(ctx.res, 409, 'EMAIL_TAKEN', 'Email sudah terdaftar.');
    }

    const tenantId = generateId();
    const userId = generateId();
    const now = new Date().toISOString();

    run(
      `
        INSERT INTO tenants (id, name, industry, city, created_at)
        VALUES (:id, :name, :industry, :city, :created_at)
      `,
      {
        id: tenantId,
        name: body.business_name || `${body.name} Business`,
        industry: body.industry || null,
        city: body.city || null,
        created_at: now,
      },
    );

    run(
      `
        INSERT INTO users (id, tenant_id, email, password_hash, name, phone, phone_verified, role, created_at)
        VALUES (:id, :tenant_id, :email, :password_hash, :name, :phone, :phone_verified, :role, :created_at)
      `,
      {
        id: userId,
        tenant_id: tenantId,
        email: String(body.email).trim().toLowerCase(),
        password_hash: hashSecret(body.password),
        name: body.name,
        phone: body.phone || null,
        phone_verified: body.phone ? 0 : 1,
        role: 'owner',
        created_at: now,
      },
    );

    const token = issueAuthToken({
      id: userId,
      tenant_id: tenantId,
      role: 'owner',
      email: String(body.email).trim().toLowerCase(),
    });

    return sendJson(ctx.res, 201, {
      ok: true,
      token,
      user: {
        id: userId,
        tenant_id: tenantId,
        email: String(body.email).trim().toLowerCase(),
        name: body.name,
        role: 'owner',
      },
    });
  });

  router.register('POST', '/api/auth/login', async (ctx) => {
    const body = await ctx.getBody();
    if (!body.email || !body.password) {
      return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'email dan password wajib diisi.');
    }

    const user = get(
      `
        SELECT id, tenant_id, email, password_hash, name, role, phone, phone_verified
        FROM users
        WHERE LOWER(email) = LOWER(:email)
      `,
      { email: String(body.email).trim() },
    );

    if (!user || !verifySecret(body.password, user.password_hash)) {
      return sendError(ctx.res, 401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
    }

    const token = issueAuthToken(user);

    return sendJson(ctx.res, 200, {
      ok: true,
      token,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        phone_verified: Boolean(user.phone_verified),
      },
    });
  });

  router.register('POST', '/api/auth/otp/send', async (ctx) => {
    const body = await ctx.getBody();
    if (!body.email && !ctx.user) {
      return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'email wajib diisi atau login dulu.');
    }

    let user = ctx.user;
    if (!user) {
      user = get(
        `
          SELECT id, tenant_id, email, name, role, phone, phone_verified
          FROM users
          WHERE LOWER(email) = LOWER(:email)
        `,
        { email: String(body.email).trim() },
      );
    }

    if (!user) {
      return sendJson(ctx.res, 200, buildOtpSendPayload());
    }

    const phone = body.phone || user.phone;
    if (!phone) {
      if (ctx.user) {
        return sendError(ctx.res, 400, 'PHONE_REQUIRED', 'Nomor telepon tidak tersedia.');
      }
      return sendJson(ctx.res, 200, buildOtpSendPayload());
    }

    const code = randomNumericCode(6);
    run(
      `
        UPDATE otp_codes
        SET consumed_at = :consumed_at
        WHERE user_id = :user_id
          AND consumed_at IS NULL
      `,
      {
        user_id: user.id,
        consumed_at: new Date().toISOString(),
      },
    );

    run(
      `
        INSERT INTO otp_codes (id, user_id, phone, code_hash, expires_at, consumed_at, created_at, failed_attempts)
        VALUES (:id, :user_id, :phone, :code_hash, :expires_at, NULL, :created_at, 0)
      `,
      {
        id: generateId(),
        user_id: user.id,
        phone,
        code_hash: sha256(code),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      },
    );

    return sendJson(ctx.res, 200, buildOtpSendPayload({ otpPreview: code }));
  });

  router.register('POST', '/api/auth/otp/verify', async (ctx) => {
    const body = await ctx.getBody();
    if (!body.email || !body.code) {
      return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'email dan code wajib diisi.');
    }

    const user = get(
      `
        SELECT id, tenant_id, email, name, role, phone, phone_verified
        FROM users
        WHERE LOWER(email) = LOWER(:email)
      `,
      { email: String(body.email).trim() },
    );

    if (!user) {
      return sendInvalidOtp(ctx.res);
    }

    const otp = get(
      `
        SELECT id, code_hash, expires_at, failed_attempts
        FROM otp_codes
        WHERE user_id = :user_id
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      { user_id: user.id },
    );

    if (!otp) {
      return sendInvalidOtp(ctx.res);
    }

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      run(`UPDATE otp_codes SET consumed_at = :consumed_at WHERE id = :id`, {
        id: otp.id,
        consumed_at: new Date().toISOString(),
      });
      return sendInvalidOtp(ctx.res);
    }

    if (Number(otp.failed_attempts || 0) >= config.otpMaxAttempts) {
      run(`UPDATE otp_codes SET consumed_at = :consumed_at WHERE id = :id`, {
        id: otp.id,
        consumed_at: new Date().toISOString(),
      });
      return sendInvalidOtp(ctx.res);
    }

    const codeHash = sha256(body.code);
    if (codeHash !== otp.code_hash) {
      const nextFailedAttempts = Number(otp.failed_attempts || 0) + 1;
      run(
        `
          UPDATE otp_codes
          SET failed_attempts = :failed_attempts,
              consumed_at = CASE
                WHEN :should_consume = 1 THEN :consumed_at
                ELSE consumed_at
              END
          WHERE id = :id
        `,
        {
          id: otp.id,
          failed_attempts: nextFailedAttempts,
          should_consume: nextFailedAttempts >= config.otpMaxAttempts ? 1 : 0,
          consumed_at: new Date().toISOString(),
        },
      );
      return sendInvalidOtp(ctx.res);
    }

    run(`UPDATE otp_codes SET consumed_at = :consumed_at WHERE id = :id`, {
      id: otp.id,
      consumed_at: new Date().toISOString(),
    });

    run(`UPDATE users SET phone_verified = 1 WHERE id = :id`, {
      id: user.id,
    });

    return sendJson(ctx.res, 200, {
      ok: true,
      message: 'OTP terverifikasi.',
    });
  });
}
