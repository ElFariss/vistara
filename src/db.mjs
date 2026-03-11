import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { createLogger } from './utils/logger.mjs';

const logger = createLogger('db');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

function isBusyError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return message.includes('database is locked')
    || message.includes('database table is locked')
    || code.includes('sqlite_busy')
    || code.includes('database_busy');
}

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`PRAGMA busy_timeout = ${Math.max(1000, Number(config.dbBusyTimeoutMs || 5000))};`);

function applyStartupPragma(statement, { tolerateBusy = false } = {}) {
  try {
    db.exec(statement);
  } catch (error) {
    if (tolerateBusy && isBusyError(error)) {
      logger.warn('db_startup_pragma_skipped', {
        statement,
        reason: 'database_busy',
      });
      return;
    }
    throw error;
  }
}

applyStartupPragma('PRAGMA journal_mode = WAL;', { tolerateBusy: true });
applyStartupPragma('PRAGMA synchronous = NORMAL;', { tolerateBusy: true });
const namedParamCache = new Map();
let databaseClosed = false;

const schema = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  city TEXT,
  timezone TEXT DEFAULT 'Asia/Jakarta',
  currency TEXT DEFAULT 'IDR',
  morning_verdict_time TEXT DEFAULT '07:00',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  date_range_start TEXT,
  date_range_end TEXT,
  column_mapping TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  metadata_json TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_tables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_file_id TEXT,
  table_name TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  columns_json TEXT,
  profile_json TEXT,
  sample_rows_json TEXT,
  data_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  sku TEXT,
  unit TEXT,
  base_price REAL,
  base_cogs REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  type TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  total_orders INTEGER DEFAULT 0,
  total_spent REAL DEFAULT 0,
  first_order TEXT,
  last_order TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  product_id TEXT,
  branch_id TEXT,
  customer_id TEXT,
  quantity REAL,
  unit_price REAL,
  total_revenue REAL,
  cogs REAL,
  discount REAL DEFAULT 0,
  channel TEXT,
  payment_method TEXT,
  source_file_id TEXT,
  raw_data TEXT,
  checksum TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL,
  UNIQUE(tenant_id, checksum)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  branch_id TEXT,
  description TEXT,
  recurring INTEGER DEFAULT 0,
  source_file_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  payload_json TEXT,
  feedback TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversation_agent_state (
  conversation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  memory_json TEXT,
  dataset_profile_json TEXT,
  draft_dashboard_json TEXT,
  pending_approval_json TEXT,
  active_run_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  format TEXT NOT NULL DEFAULT 'markdown',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  target_value REAL NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_date ON transactions(tenant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_branch ON transactions(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_source_files_tenant ON source_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dataset_tables_tenant ON dataset_tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dataset_tables_source ON dataset_tables(source_file_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON chat_messages(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_agent_state_tenant_user ON conversation_agent_state(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_goals_tenant_status ON goals(tenant_id, status);
`;

function ensureColumn(tableName, columnName, definition) {
  const columns = all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => String(column?.name || '').toLowerCase() === String(columnName || '').toLowerCase());
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

export function initializeDatabase() {
  if (databaseClosed) {
    throw new Error('Database sudah ditutup dan tidak bisa diinisialisasi ulang pada proses ini.');
  }
  db.exec(schema);
  ensureColumn('otp_codes', 'failed_attempts', 'failed_attempts INTEGER NOT NULL DEFAULT 0');
  ensureColumn('dashboards', 'conversation_id', 'conversation_id TEXT');
  ensureColumn('conversations', 'last_message_at', 'last_message_at TEXT');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dashboards_conversation ON dashboards(conversation_id)'); } catch { /* index may exist */ }
  logger.info('database initialized', { dbPath: config.dbPath });
}

export function closeDatabase() {
  if (databaseClosed) {
    return;
  }
  db.close();
  databaseClosed = true;
  logger.info('database closed', { dbPath: config.dbPath });
}

function namedParamsForSql(sql) {
  const key = String(sql || '');
  if (namedParamCache.has(key)) {
    return namedParamCache.get(key);
  }

  const regex = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;
  const names = new Set();
  let match = regex.exec(key);
  while (match) {
    names.add(match[1]);
    match = regex.exec(key);
  }

  const result = [...names];
  namedParamCache.set(key, result);
  return result;
}

function sanitizeParams(sql, params) {
  if (!params || typeof params !== 'object') {
    return {};
  }

  const named = namedParamsForSql(sql);
  if (named.length === 0) {
    return {};
  }

  const safe = {};
  for (const key of named) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      safe[key] = params[key];
    }
  }

  return safe;
}

export function normalizeDatabaseError(error) {
  if (!isBusyError(error)) {
    return error;
  }

  const normalized = new Error('Database sedang sibuk. Coba lagi sebentar.');
  normalized.code = 'DATABASE_BUSY';
  normalized.statusCode = 503;
  normalized.publicMessage = 'Database sedang sibuk. Coba lagi sebentar.';
  normalized.cause = error;
  return normalized;
}

function executePrepared(sql, params, mode) {
  try {
    const statement = db.prepare(sql);
    const safeParams = sanitizeParams(sql, params);
    if (mode === 'all') {
      return statement.all(safeParams);
    }
    if (mode === 'get') {
      return statement.get(safeParams) ?? null;
    }
    return statement.run(safeParams);
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}

export function all(sql, params = {}) {
  return executePrepared(sql, params, 'all');
}

export function get(sql, params = {}) {
  return executePrepared(sql, params, 'get');
}

export function run(sql, params = {}) {
  return executePrepared(sql, params, 'run');
}

export function withTransaction(task) {
  let began = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    began = true;
    const result = task();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (began) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures when the transaction never fully opened.
      }
    }
    throw normalizeDatabaseError(error);
  }
}
