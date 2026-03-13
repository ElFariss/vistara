import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool as PgPool } from 'pg';
import { newDb } from 'pg-mem';
import { config } from './config.mjs';
import { createLogger } from './utils/logger.mjs';

const logger = createLogger('db');
const transactionContext = new AsyncLocalStorage();

let pool = null;
let databaseClosed = false;
let schemaInitialized = false;

function shouldUseInMemory() {
  return config.env === 'test' && !config.databaseUrl;
}

function createPool() {
  if (shouldUseInMemory()) {
    const mem = newDb({ autoCreateForeignKeyIndices: true });
    mem.public.registerFunction({
      name: 'round',
      args: ['float', 'int'],
      returns: 'float',
      implementation: (value, digits) => {
        if (value === null || value === undefined) {
          return null;
        }
        const precision = Number.isFinite(Number(digits)) ? Number(digits) : 0;
        const factor = 10 ** precision;
        return Math.round(Number(value) * factor) / factor;
      },
    });
    mem.public.registerFunction({
      name: 'round',
      args: ['float'],
      returns: 'float',
      implementation: (value) => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.round(Number(value));
      },
    });
    mem.public.registerFunction({
      name: 'date',
      args: ['text'],
      returns: 'text',
      implementation: (value) => {
        if (!value) {
          return null;
        }
        const parsed = new Date(String(value));
        if (Number.isNaN(parsed.getTime())) {
          return null;
        }
        return parsed.toISOString().slice(0, 10);
      },
    });
    const adapter = mem.adapters.createPg();
    return new adapter.Pool();
  }
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL wajib di-set untuk koneksi PostgreSQL.');
  }
  return new PgPool({ connectionString: config.databaseUrl });
}

pool = createPool();

export function normalizeDatabaseError(error) {
  const code = String(error?.code || '');
  if (code === '55P03' || code === '40001') {
    const normalized = new Error('Database sedang sibuk. Coba lagi sebentar.');
    normalized.code = 'DATABASE_BUSY';
    normalized.statusCode = 503;
    normalized.publicMessage = 'Database sedang sibuk. Coba lagi sebentar.';
    normalized.cause = error;
    return normalized;
  }
  return error;
}

function extractNamedParams(sql) {
  const regex = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;
  const names = [];
  const seen = new Set();
  let match = regex.exec(sql);
  while (match) {
    const name = match[1];
    if (!seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
    match = regex.exec(sql);
  }
  return names;
}

function prepareSql(sql, params = {}) {
  const named = extractNamedParams(sql);
  if (named.length === 0) {
    return { text: sql, values: [] };
  }
  const values = [];
  const indexMap = new Map();
  const text = String(sql).replace(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g, (full, name) => {
    if (!indexMap.has(name)) {
      const value = Object.prototype.hasOwnProperty.call(params, name) ? params[name] : null;
      values.push(value);
      indexMap.set(name, values.length);
    }
    return `$${indexMap.get(name)}`;
  });
  return { text, values };
}

function getQueryClient() {
  const store = transactionContext.getStore();
  return store?.client || pool;
}

async function executePrepared(sql, params, mode) {
  try {
    const { text, values } = prepareSql(sql, params);
    const client = getQueryClient();
    const result = await client.query(text, values);
    if (mode === 'all') {
      return result.rows;
    }
    if (mode === 'get') {
      return result.rows[0] ?? null;
    }
    return { rowCount: result.rowCount };
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}

export async function all(sql, params = {}) {
  return executePrepared(sql, params, 'all');
}

export async function get(sql, params = {}) {
  return executePrepared(sql, params, 'get');
}

export async function run(sql, params = {}) {
  return executePrepared(sql, params, 'run');
}

function safeIdentifier(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

async function ensureColumn(tableName, columnName, definition) {
  const exists = await get(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = :table_name AND column_name = :column_name
      LIMIT 1
    `,
    {
      table_name: tableName,
      column_name: columnName,
    },
  );
  if (!exists) {
    await run(`ALTER TABLE ${safeIdentifier(tableName)} ADD COLUMN ${definition}`);
  }
}

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
  base_price DOUBLE PRECISION,
  base_cogs DOUBLE PRECISION,
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
  total_spent DOUBLE PRECISION DEFAULT 0,
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
  quantity DOUBLE PRECISION,
  unit_price DOUBLE PRECISION,
  total_revenue DOUBLE PRECISION,
  cogs DOUBLE PRECISION,
  discount DOUBLE PRECISION DEFAULT 0,
  channel TEXT,
  payment_method TEXT,
  source_file_id TEXT,
  raw_data TEXT,
  checksum TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL,
  UNIQUE(tenant_id, checksum)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT,
  amount DOUBLE PRECISION NOT NULL,
  branch_id TEXT,
  description TEXT,
  recurring INTEGER DEFAULT 0,
  source_file_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  last_message_at TEXT,
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
  conversation_id TEXT,
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
  target_value DOUBLE PRECISION NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_dashboards_conversation ON dashboards(conversation_id);
`;

export async function initializeDatabase() {
  if (databaseClosed) {
    throw new Error('Database sudah ditutup dan tidak bisa diinisialisasi ulang pada proses ini.');
  }
  if (schemaInitialized) {
    return;
  }
  await pool.query(schema);
  await ensureColumn('otp_codes', 'failed_attempts', 'failed_attempts INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('dashboards', 'conversation_id', 'conversation_id TEXT');
  await ensureColumn('conversations', 'last_message_at', 'last_message_at TEXT');
  schemaInitialized = true;
  logger.info('database initialized', { databaseUrl: config.databaseUrl || 'pg-mem' });
}

export async function closeDatabase() {
  if (databaseClosed) {
    return;
  }
  databaseClosed = true;
  schemaInitialized = false;
  await pool.end();
  logger.info('database closed', { databaseUrl: config.databaseUrl || 'pg-mem' });
}

export function getPool() {
  return pool;
}

export async function withTransaction(task) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run({ client }, task);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures.
    }
    throw normalizeDatabaseError(error);
  } finally {
    client.release();
  }
}
