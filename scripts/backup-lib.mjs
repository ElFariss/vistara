import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, initializeDatabase } from '../src/db.mjs';

const TABLES = [
  'tenants',
  'users',
  'otp_codes',
  'source_files',
  'dataset_tables',
  'products',
  'branches',
  'customers',
  'transactions',
  'expenses',
  'conversations',
  'chat_messages',
  'conversation_agent_state',
  'dashboards',
  'reports',
  'goals',
  'audit_logs',
];

function timestampSlug(input = new Date()) {
  return input.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
}

function safeIdentifier(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function createBackup({
  dataDir,
  backupRootDir,
  label = 'backup',
  now = new Date(),
} = {}) {
  if (!dataDir || !backupRootDir) {
    throw new Error('dataDir dan backupRootDir wajib diisi.');
  }

  await initializeDatabase();
  const pool = getPool();

  const backupId = `${label}-${timestampSlug(now)}`;
  const backupDir = path.resolve(backupRootDir, backupId);
  const dbDir = path.join(backupDir, 'db');
  const uploadsSourceDir = path.join(dataDir, 'uploads');
  const uploadsTargetDir = path.join(backupDir, 'uploads');

  await fs.mkdir(dbDir, { recursive: true });

  const dbTables = [];
  for (const table of TABLES) {
    const result = await pool.query(`SELECT * FROM ${safeIdentifier(table)}`);
    const filename = `${table}.json`;
    await fs.writeFile(path.join(dbDir, filename), `${JSON.stringify(result.rows || [], null, 2)}\n`);
    dbTables.push({ table, filename, rows: result.rows?.length || 0 });
  }

  const uploadsCopied = await pathExists(uploadsSourceDir);
  if (uploadsCopied) {
    await fs.cp(uploadsSourceDir, uploadsTargetDir, { recursive: true });
  }

  const manifest = {
    label,
    created_at: now.toISOString(),
    data_dir: path.resolve(dataDir),
    db_tables: dbTables,
    uploads_copied: uploadsCopied,
  };

  await fs.writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    backupDir,
    manifest,
  };
}

export async function restoreBackup({
  backupDir,
  dataDir,
} = {}) {
  if (!backupDir || !dataDir) {
    throw new Error('backupDir dan dataDir wajib diisi.');
  }

  await initializeDatabase();
  const pool = getPool();

  const resolvedBackupDir = path.resolve(backupDir);
  const manifestPath = path.join(resolvedBackupDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Manifest backup tidak ditemukan di ${resolvedBackupDir}.`);
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const dbDir = path.join(resolvedBackupDir, 'db');
  const uploadsSourceDir = path.join(resolvedBackupDir, 'uploads');
  const uploadsTargetDir = path.join(dataDir, 'uploads');

  const client = await pool.connect();
  let restoredTables = 0;
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      await client.query(`TRUNCATE ${safeIdentifier(table)} CASCADE`);
    }

    for (const table of TABLES) {
      const tablePath = path.join(dbDir, `${table}.json`);
      if (!(await pathExists(tablePath))) {
        continue;
      }
      const rows = JSON.parse(await fs.readFile(tablePath, 'utf8'));
      if (!Array.isArray(rows) || rows.length === 0) {
        continue;
      }

      const columns = Object.keys(rows[0]);
      if (columns.length === 0) {
        continue;
      }
      const columnList = columns.map((column) => safeIdentifier(column)).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const insertSql = `INSERT INTO ${safeIdentifier(table)} (${columnList}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map((column) => (Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null));
        await client.query(insertSql, values);
      }
      restoredTables += 1;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (await pathExists(uploadsTargetDir)) {
    await fs.rm(uploadsTargetDir, { recursive: true, force: true });
  }

  const restoredUploads = await pathExists(uploadsSourceDir);
  if (restoredUploads) {
    await fs.cp(uploadsSourceDir, uploadsTargetDir, { recursive: true });
  }

  return {
    restoredTables,
    restoredUploads,
    manifest,
  };
}
