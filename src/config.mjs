import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadDotEnv } from './utils/env.mjs';

loadDotEnv();

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
const dbPath = path.resolve(rootDir, process.env.DB_PATH || path.join(dataDir, 'umkm.db'));
const uploadDir = path.join(dataDir, 'uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const env = process.env.NODE_ENV || 'development';
const runtimeJwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

export const config = {
  env,
  isProduction: env === 'production',
  port: toInt(process.env.PORT, 8080),
  dataDir,
  dbPath,
  uploadDir,
  tokenTtlSeconds: toInt(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 24 * 7),
  jwtSecret: runtimeJwtSecret,
  rateLimitPerMinute: toInt(process.env.RATE_LIMIT_PER_MINUTE, 120),
  maxUploadSizeBytes: toInt(process.env.MAX_UPLOAD_SIZE_MB, 20) * 1024 * 1024,
  allowedOrigins: toList(process.env.ALLOWED_ORIGINS),
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  pythonAgentUrl: process.env.PYTHON_AGENT_URL || '',
  pythonAgentToken: process.env.PYTHON_AGENT_TOKEN || '',
  pythonAgentTimeoutMs: toInt(process.env.PYTHON_AGENT_TIMEOUT_MS, 3500),
  dashboardAgentTimeoutMs: toInt(process.env.DASHBOARD_AGENT_TIMEOUT_MS, 180000),
};

if (config.isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET wajib di-set pada production.');
}
