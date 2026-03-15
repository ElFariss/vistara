import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadDotEnv } from './utils/env.mjs';

loadDotEnv();

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const rootDir = process.cwd();
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || './data');
const uploadDir = path.join(dataDir, 'uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const env = process.env.NODE_ENV || 'development';
const runtimeJwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  const port = process.env.PGPORT;
  if (!host && !user && !password && !database && !port) {
    return '';
  }

  const safeUser = encodeURIComponent(user || 'postgres');
  const safePassword = password ? encodeURIComponent(password) : '';
  const auth = safePassword ? `${safeUser}:${safePassword}` : safeUser;
  const targetHost = host || 'localhost';
  const targetPort = port || '5432';
  const targetDatabase = database || 'umkm';
  return `postgresql://${auth}@${targetHost}:${targetPort}/${targetDatabase}`;
}

export const config = {
  env,
  isProduction: env === 'production',
  port: toInt(process.env.PORT, 8080),
  dataDir,
  uploadDir,
  databaseUrl: buildDatabaseUrl(),
  servePublicAssets: toBoolean(process.env.SERVE_PUBLIC_ASSETS, false),
  tokenTtlSeconds: toInt(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 24 * 7),
  jwtSecret: runtimeJwtSecret,
  rateLimitPerMinute: toInt(process.env.RATE_LIMIT_PER_MINUTE, 120),
  maxUploadSizeBytes: toInt(process.env.MAX_UPLOAD_SIZE_MB, 20) * 1024 * 1024,
  requestBodyTimeoutMs: Math.max(5000, toInt(process.env.REQUEST_BODY_TIMEOUT_MS, 180000)),
  allowedOrigins: toList(process.env.ALLOWED_ORIGINS),
  apiBaseUrl: process.env.API_BASE_URL || '',
  cspConnectSrc: toList(process.env.CSP_CONNECT_SRC),
  trustedProxyIps: toList(process.env.TRUSTED_PROXY_IPS).map((item) => item.toLowerCase()),
  otpPreviewEnabled: toBoolean(process.env.OTP_PREVIEW_ENABLED, false),
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  geminiModelLight: process.env.GEMINI_MODEL_LIGHT || 'gemini-2.5-flash',
  geminiVisionModel: process.env.GEMINI_VISION_MODEL || 'gemini-3-flash-preview',
  rawUploadAiFallbackEnabled: toBoolean(process.env.RAW_UPLOAD_AI_FALLBACK_ENABLED, true),
  dashboardAgentTimeoutMs: toInt(process.env.DASHBOARD_AGENT_TIMEOUT_MS, 120000),
  dashboardAgentMaxAttempts: Math.max(1, toInt(process.env.DASHBOARD_AGENT_MAX_ATTEMPTS, 2)),
  otpMaxAttempts: Math.max(1, toInt(process.env.OTP_MAX_ATTEMPTS, 5)),
  demoAuthRateLimitPerMinute: Math.max(1, toInt(process.env.DEMO_AUTH_RATE_LIMIT_PER_MINUTE, 5)),
  pythonAgentBackendUrl: process.env.PYTHON_AGENT_BACKEND_URL || 'http://localhost:8001',
};

if (config.isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET wajib di-set pada production.');
}
