import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';
import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { safeJsonParse } from '../utils/parse.mjs';
import { profileRows } from './dataProfile.mjs';

const tablesDir = path.join(config.dataDir, 'tables');
fs.mkdirSync(tablesDir, { recursive: true });

function normalizeTableName(name = '', fallback = 'Dataset') {
  const trimmed = String(name || '').replace(/\s+/g, ' ').trim();
  return trimmed || fallback;
}

function buildTablePath(tenantId, tableId) {
  const safeTenant = String(tenantId || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(tablesDir, `${safeTenant}_${tableId}.json`);
}

function writeTableFile(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload));
}

function readTableFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { columns: [], rows: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = safeJsonParse(raw, {});
    return {
      columns: Array.isArray(parsed?.columns) ? parsed.columns : [],
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
    };
  } catch {
    return { columns: [], rows: [] };
  }
}

export async function storeDatasetTables({ tenantId, sourceId, tables = [], minRows = 6 } = {}) {
  const stored = [];
  const cleanTables = Array.isArray(tables) ? tables : [];

  for (let index = 0; index < cleanTables.length; index += 1) {
    const table = cleanTables[index];
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    if (rows.length < minRows) {
      continue;
    }
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    const name = normalizeTableName(table?.name, `Sheet ${index + 1}`);
    const id = generateId();
    const dataPath = buildTablePath(tenantId, id);
    const profile = profileRows({ columns, rows });
    const sampleRows = rows.slice(0, 12);

    writeTableFile(dataPath, { columns, rows });
    await run(
      `
        INSERT INTO dataset_tables (
          id, tenant_id, source_file_id, table_name, row_count,
          columns_json, profile_json, sample_rows_json, data_path, created_at
        ) VALUES (
          :id, :tenant_id, :source_file_id, :table_name, :row_count,
          :columns_json, :profile_json, :sample_rows_json, :data_path, :created_at
        )
      `,
      {
        id,
        tenant_id: tenantId,
        source_file_id: sourceId || null,
        table_name: name,
        row_count: rows.length,
        columns_json: JSON.stringify(columns),
        profile_json: JSON.stringify(profile),
        sample_rows_json: JSON.stringify(sampleRows),
        data_path: dataPath,
        created_at: new Date().toISOString(),
      },
    );

    stored.push({
      id,
      name,
      row_count: rows.length,
      columns,
      profile,
      sample_rows: sampleRows,
      data_path: dataPath,
    });
  }

  return stored;
}

export async function listDatasetTables(tenantId) {
  const rows = await all(
    `
      SELECT *
      FROM dataset_tables
      WHERE tenant_id = :tenant_id
      ORDER BY created_at DESC
    `,
    { tenant_id: tenantId },
  );

  return rows.map((row) => ({
    id: row.id,
    name: normalizeTableName(row.table_name, 'Dataset'),
    row_count: Number(row.row_count || 0),
    columns: safeJsonParse(row.columns_json, []),
    profile: safeJsonParse(row.profile_json, {}),
    sample_rows: safeJsonParse(row.sample_rows_json, []),
    data_path: row.data_path || null,
    source_file_id: row.source_file_id || null,
  }));
}

export async function listDatasetTablesForSource(tenantId, sourceId) {
  const rows = await all(
    `
      SELECT *
      FROM dataset_tables
      WHERE tenant_id = :tenant_id
        AND source_file_id = :source_file_id
      ORDER BY created_at DESC
    `,
    { tenant_id: tenantId, source_file_id: sourceId },
  );

  return rows.map((row) => ({
    id: row.id,
    name: normalizeTableName(row.table_name, 'Dataset'),
    row_count: Number(row.row_count || 0),
    columns: safeJsonParse(row.columns_json, []),
    profile: safeJsonParse(row.profile_json, {}),
    sample_rows: safeJsonParse(row.sample_rows_json, []),
    data_path: row.data_path || null,
    source_file_id: row.source_file_id || null,
  }));
}

export async function getDatasetTable(tenantId, tableId) {
  const row = await get(
    `
      SELECT *
      FROM dataset_tables
      WHERE (id = :id OR LOWER(table_name) = LOWER(:id)) AND tenant_id = :tenant_id
      LIMIT 1
    `,
    { id: tableId, tenant_id: tenantId },
  );

  if (!row) {
    return null;
  }

  const data = readTableFile(row.data_path);
  return {
    id: row.id,
    name: normalizeTableName(row.table_name, 'Dataset'),
    row_count: Number(row.row_count || 0),
    columns: data.columns.length ? data.columns : safeJsonParse(row.columns_json, []),
    rows: data.rows.length ? data.rows : [],
    profile: safeJsonParse(row.profile_json, {}),
    sample_rows: safeJsonParse(row.sample_rows_json, []),
    data_path: row.data_path || null,
    source_file_id: row.source_file_id || null,
  };
}

export async function deleteDatasetTablesForTenant(tenantId) {
  const rows = await listDatasetTables(tenantId);
  rows.forEach((row) => {
    if (row.data_path && fs.existsSync(row.data_path)) {
      try {
        fs.unlinkSync(row.data_path);
      } catch {
        // Best-effort cleanup.
      }
    }
  });
  await run(`DELETE FROM dataset_tables WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
}

export async function deleteDatasetTablesForSource(sourceId) {
  const rows = await all(
    `
      SELECT *
      FROM dataset_tables
      WHERE source_file_id = :source_file_id
    `,
    { source_file_id: sourceId },
  );
  rows.forEach((row) => {
    if (row.data_path && fs.existsSync(row.data_path)) {
      try {
        fs.unlinkSync(row.data_path);
      } catch {
        // Best-effort cleanup.
      }
    }
  });
  await run(`DELETE FROM dataset_tables WHERE source_file_id = :source_file_id`, { source_file_id: sourceId });
}
