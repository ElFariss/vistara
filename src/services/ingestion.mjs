import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { all, get, run, withTransaction } from '../db.mjs';
import { parseCsvBuffer } from '../utils/csv.mjs';
import { parseJsonBuffer } from '../utils/json.mjs';
import { parseXlsxFile } from '../utils/xlsx.mjs';
import { generateId } from '../utils/ids.mjs';
import { parseFlexibleDate, parseIndonesianNumber, parseBoolean } from '../utils/parse.mjs';
import { suggestColumnMapping, requiredFieldsForDataset } from './columnMapper.mjs';
import { generateJsonWithGemini } from './gemini.mjs';
import { logAudit } from './audit.mjs';

function detectFileType(filename, contentType = '') {
  const ext = path.extname(filename || '').toLowerCase();
  const mime = String(contentType || '').toLowerCase();

  if (ext === '.csv' || mime.includes('csv')) {
    return 'csv';
  }

  if (ext === '.tsv' || mime.includes('tab-separated-values')) {
    return 'tsv';
  }

  if (ext === '.json' || mime.includes('json')) {
    return 'json';
  }

  if (ext === '.xlsx') {
    return 'xlsx';
  }

  if (ext === '.xls') {
    return 'xls';
  }

  if (ext === '.txt' || mime.startsWith('text/')) {
    return 'text';
  }

  return 'unknown';
}

function normalizeParsedDataset(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { columns: [], rows: [] };
  }

  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const columnsFromRows = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const columns = (Array.isArray(parsed.columns) && parsed.columns.length > 0 ? parsed.columns : columnsFromRows).map((item, index) => {
    const value = String(item || '').trim();
    return value || `column_${index + 1}`;
  });

  const normalizedRows = rows
    .map((row) => {
      const normalized = {};
      for (const column of columns) {
        const value = row?.[column];
        normalized[column] = value === null || value === undefined ? '' : String(value);
      }
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => String(value || '').trim() !== ''));

  return {
    columns,
    rows: normalizedRows,
  };
}

function decodeUtf8(buffer) {
  try {
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function isLikelyText(text) {
  if (!text) {
    return false;
  }

  const sample = text.slice(0, 5000);
  let printable = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13 || code >= 160) {
      printable += 1;
    }
  }

  return printable / sample.length >= 0.7;
}

function rowsFromAiPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (!rows || rows.length === 0) {
    return null;
  }

  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    return null;
  }

  const columns = Array.isArray(payload.columns) && payload.columns.length > 0
    ? payload.columns.map((column) => String(column))
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return normalizeParsedDataset({ columns, rows });
}

async function parseWithAiFallback(buffer, filename) {
  const text = decodeUtf8(buffer);
  if (!isLikelyText(text)) {
    throw new Error(`Format ${filename || 'file'} tidak didukung. Gunakan data tabular/JSON yang bisa dibaca.`);
  }

  const result = await generateJsonWithGemini({
    systemPrompt: [
      'Kamu parser data untuk aplikasi analytics Vistara.',
      'Ekstrak data menjadi JSON tabular.',
      'Wajib output JSON valid tanpa markdown dengan format {"columns":[],"rows":[{}]}.',
      'Jika tidak bisa diekstrak dengan yakin, kembalikan {"columns":[],"rows":[]}.',
    ].join(' '),
    userPrompt: JSON.stringify({
      filename,
      text_sample: text.slice(0, 12000),
      expected_format: {
        columns: ['string'],
        rows: ['object'],
      },
    }),
    temperature: 0,
    maxOutputTokens: 1200,
  });

  if (!result.ok || !result.data) {
    throw new Error('File tidak dapat diparse otomatis. Coba unggah CSV/TSV/JSON/XLSX.');
  }

  const parsed = rowsFromAiPayload(result.data);
  if (!parsed || parsed.rows.length === 0) {
    throw new Error('AI parser tidak menemukan data tabular yang valid.');
  }

  return parsed;
}

function parseExcelFile(filePath, fileType) {
  if (fileType === 'xls') {
    const convertedCsv = `${filePath}.converted.csv`;
    try {
      execFileSync('ssconvert', [filePath, convertedCsv], { stdio: 'ignore' });
      const buffer = fs.readFileSync(convertedCsv);
      return parseCsvBuffer(buffer);
    } finally {
      if (fs.existsSync(convertedCsv)) {
        fs.unlinkSync(convertedCsv);
      }
    }
  }

  return parseXlsxFile(filePath);
}

export async function parseDataset(filePath, fileType, filename) {
  const buffer = fs.readFileSync(filePath);

  if (fileType === 'csv' || fileType === 'tsv') {
    return normalizeParsedDataset(parseCsvBuffer(buffer));
  }

  if (fileType === 'json') {
    return normalizeParsedDataset(parseJsonBuffer(buffer));
  }

  if (fileType === 'xlsx' || fileType === 'xls') {
    return normalizeParsedDataset(parseExcelFile(filePath, fileType));
  }

  if (fileType === 'text') {
    try {
      const csv = normalizeParsedDataset(parseCsvBuffer(buffer));
      if (csv.columns.length > 1 && csv.rows.length > 0) {
        return csv;
      }
    } catch {
      // Continue fallback.
    }

    try {
      const json = normalizeParsedDataset(parseJsonBuffer(buffer));
      if (json.columns.length > 0 && json.rows.length > 0) {
        return json;
      }
    } catch {
      // Continue fallback.
    }

    return parseWithAiFallback(buffer, filename);
  }

  try {
    const asJson = normalizeParsedDataset(parseJsonBuffer(buffer));
    if (asJson.columns.length > 0 && asJson.rows.length > 0) {
      return asJson;
    }
  } catch {
    // Continue fallback.
  }

  try {
    const asCsv = normalizeParsedDataset(parseCsvBuffer(buffer));
    if (asCsv.columns.length > 1 && asCsv.rows.length > 0) {
      return asCsv;
    }
  } catch {
    // Continue fallback.
  }

  return parseWithAiFallback(buffer, filename);
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

const PRODUCT_NAME_ALIASES = ['produk', 'product', 'item', 'menu', 'nama barang', 'nama produk', 'barang'];
const PRODUCT_VARIANT_ALIASES = ['type', 'model', 'variant', 'varian', 'sku'];
const PRODUCT_BRAND_ALIASES = ['merk', 'merek', 'brand'];

function rowValueByAliases(row, aliases = []) {
  const entries = Object.entries(row || {});
  for (const [column, value] of entries) {
    const normalizedColumn = toLowerSafe(column);
    if (!aliases.includes(normalizedColumn)) {
      continue;
    }
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function joinUniqueText(parts = []) {
  const seen = new Set();
  const joined = [];

  for (const part of parts) {
    const text = normalizeText(part);
    if (!text) {
      continue;
    }
    const key = toLowerSafe(text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    joined.push(text);
  }

  return joined.length > 0 ? joined.join(' ') : null;
}

function deriveProductName(row, mapping) {
  const mappedColumn = mapping?.product_name;
  const mappedValue = normalizeText(mappedColumn ? row?.[mappedColumn] : null);
  const explicitProduct = rowValueByAliases(row, PRODUCT_NAME_ALIASES);
  const variant = rowValueByAliases(row, PRODUCT_VARIANT_ALIASES);
  const brand = rowValueByAliases(row, PRODUCT_BRAND_ALIASES);
  const normalizedMappedColumn = toLowerSafe(mappedColumn);

  if (mappedValue && PRODUCT_NAME_ALIASES.includes(normalizedMappedColumn)) {
    return mappedValue;
  }

  if (mappedValue && PRODUCT_VARIANT_ALIASES.includes(normalizedMappedColumn)) {
    return joinUniqueText([brand, mappedValue]) || mappedValue;
  }

  if (mappedValue && PRODUCT_BRAND_ALIASES.includes(normalizedMappedColumn)) {
    return mappedValue;
  }

  if (mappedValue) {
    return mappedValue;
  }

  if (explicitProduct) {
    return explicitProduct;
  }

  const combined = joinUniqueText([brand, variant]);
  if (combined) {
    return combined;
  }

  return mappedValue || variant || brand || null;
}

function ensureBranch(tenantId, branchName) {
  if (!branchName) {
    return null;
  }

  const existing = get(
    `SELECT id FROM branches WHERE tenant_id = :tenant_id AND LOWER(name) = LOWER(:name)`,
    { tenant_id: tenantId, name: branchName },
  );

  if (existing) {
    return existing.id;
  }

  const id = generateId();
  run(
    `
      INSERT INTO branches (id, tenant_id, name, created_at)
      VALUES (:id, :tenant_id, :name, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      name: branchName,
      created_at: new Date().toISOString(),
    },
  );

  return id;
}

function ensureProduct(tenantId, name, category = null) {
  if (!name) {
    return null;
  }

  const existing = get(
    `SELECT id FROM products WHERE tenant_id = :tenant_id AND LOWER(name) = LOWER(:name)`,
    { tenant_id: tenantId, name },
  );

  if (existing) {
    return existing.id;
  }

  const id = generateId();
  run(
    `
      INSERT INTO products (id, tenant_id, name, category, created_at)
      VALUES (:id, :tenant_id, :name, :category, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      name,
      category,
      created_at: new Date().toISOString(),
    },
  );

  return id;
}

function createChecksum(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function deriveRevenue(mapping, row, quantity, unitPrice) {
  const mapped = mapping.total_revenue;
  if (mapped === '__derived__') {
    if (quantity !== null && unitPrice !== null) {
      return quantity * unitPrice;
    }
    return null;
  }
  return parseIndonesianNumber(row[mapped]);
}

function normalizeTransactionRow(row, mapping) {
  const transactionDate = parseFlexibleDate(row[mapping.transaction_date]);
  const quantity = parseIndonesianNumber(row[mapping.quantity]) ?? 1;
  const unitPrice = parseIndonesianNumber(row[mapping.unit_price]);
  const totalRevenue = deriveRevenue(mapping, row, quantity, unitPrice);
  const cogs = parseIndonesianNumber(row[mapping.cogs]);
  const discount = parseIndonesianNumber(row[mapping.discount]) ?? 0;

  return {
    transaction_date: transactionDate,
    product_name: deriveProductName(row, mapping),
    quantity,
    unit_price: unitPrice,
    total_revenue: totalRevenue,
    cogs,
    discount,
    branch_name: normalizeText(row[mapping.branch_name]),
    channel: normalizeText(row[mapping.channel]),
    payment_method: normalizeText(row[mapping.payment_method]),
    category: normalizeText(row[mapping.category]),
  };
}

function normalizeExpenseRow(row, mapping) {
  const expenseDate = parseFlexibleDate(row[mapping.expense_date]);
  const amount = parseIndonesianNumber(row[mapping.expense_amount]);

  return {
    expense_date: expenseDate,
    amount,
    category: normalizeText(row[mapping.expense_category]),
    branch_name: normalizeText(row[mapping.branch_name]),
    description: normalizeText(row[mapping.description]),
    recurring: parseBoolean(row[mapping.recurring], false),
  };
}

export async function analyzeUploadedFile(filePath, filename, contentType) {
  const fileType = detectFileType(filename, contentType);
  const parsed = await parseDataset(filePath, fileType, filename);
  const sampleRows = parsed.rows.slice(0, 20);
  const suggestion = await suggestColumnMapping(parsed.columns, sampleRows);

  return {
    fileType,
    columns: parsed.columns,
    sampleRows,
    rowCount: parsed.rows.length,
    suggestion,
  };
}

export async function readParsedSourceFile({ filePath, fileType, filename }) {
  return parseDataset(filePath, fileType, filename);
}

export function storeSourceFileRecord({ tenantId, filename, fileType, filePath, rowCount, suggestion, sampleRows }) {
  const id = generateId();
  run(
    `
      INSERT INTO source_files (
        id, tenant_id, filename, file_type, file_path,
        upload_date, row_count, column_mapping, status, metadata_json
      ) VALUES (
        :id, :tenant_id, :filename, :file_type, :file_path,
        :upload_date, :row_count, :column_mapping, :status, :metadata_json
      )
    `,
    {
      id,
      tenant_id: tenantId,
      filename,
      file_type: fileType,
      file_path: filePath,
      upload_date: new Date().toISOString(),
      row_count: rowCount,
      column_mapping: JSON.stringify({
        dataset_type: suggestion.datasetType,
        mapping: suggestion.mapping,
        confidence: suggestion.confidence,
        method: suggestion.method,
      }),
      status: 'uploaded',
      metadata_json: JSON.stringify({
        sample_rows: sampleRows ?? [],
      }),
    },
  );

  return id;
}

function validateMapping(datasetType, mapping) {
  const required = requiredFieldsForDataset(datasetType);
  const missing = required.filter((field) => !mapping[field]);
  if (missing.length > 0) {
    throw new Error(`Kolom wajib belum dipetakan: ${missing.join(', ')}`);
  }
}

function parseColumnMapping(source) {
  try {
    const parsed = JSON.parse(source.column_mapping || '{}');
    return {
      datasetType: parsed.dataset_type || 'transaction',
      mapping: parsed.mapping || {},
      confidence: parsed.confidence ?? 0.5,
      method: parsed.method || 'unknown',
    };
  } catch {
    return {
      datasetType: 'transaction',
      mapping: {},
      confidence: 0,
      method: 'invalid',
    };
  }
}

function updateSourceSummary(sourceId, { rowCount, startDate, endDate, status }) {
  run(
    `
      UPDATE source_files
      SET row_count = :row_count,
          date_range_start = :date_start,
          date_range_end = :date_end,
          status = :status
      WHERE id = :id
    `,
    {
      id: sourceId,
      row_count: rowCount,
      date_start: startDate,
      date_end: endDate,
      status,
    },
  );
}

function markSourceFailed(sourceId, reason) {
  const current = get(`SELECT metadata_json FROM source_files WHERE id = :id`, { id: sourceId }) || {};
  let metadata = {};
  try {
    metadata = current.metadata_json ? JSON.parse(current.metadata_json) : {};
  } catch {
    metadata = {};
  }

  metadata.error = String(reason || 'unknown_error').slice(0, 400);

  run(
    `
      UPDATE source_files
      SET status = :status,
          metadata_json = :metadata_json
      WHERE id = :id
    `,
    {
      id: sourceId,
      status: 'failed',
      metadata_json: JSON.stringify(metadata),
    },
  );
}

function insertTransactions({ tenantId, userId, sourceId, rows, mapping }) {
  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

  let minDate = null;
  let maxDate = null;

  for (const row of rows) {
    const normalized = normalizeTransactionRow(row, mapping);

    if (!normalized.transaction_date || normalized.total_revenue === null) {
      skipped += 1;
      continue;
    }

    if (normalized.total_revenue < 0) {
      skipped += 1;
      continue;
    }

    const branchId = ensureBranch(tenantId, normalized.branch_name);
    const productId = ensureProduct(tenantId, normalized.product_name, normalized.category);

    const checksum = createChecksum({
      tenantId,
      date: normalized.transaction_date.toISOString(),
      product: normalized.product_name,
      qty: normalized.quantity,
      revenue: normalized.total_revenue,
      branch: normalized.branch_name,
      channel: normalized.channel,
    });

    try {
      run(
        `
          INSERT INTO transactions (
            id, tenant_id, transaction_date, product_id, branch_id,
            quantity, unit_price, total_revenue, cogs, discount,
            channel, payment_method, source_file_id, raw_data,
            checksum, created_at
          ) VALUES (
            :id, :tenant_id, :transaction_date, :product_id, :branch_id,
            :quantity, :unit_price, :total_revenue, :cogs, :discount,
            :channel, :payment_method, :source_file_id, :raw_data,
            :checksum, :created_at
          )
        `,
        {
          id: generateId(),
          tenant_id: tenantId,
          transaction_date: normalized.transaction_date.toISOString(),
          product_id: productId,
          branch_id: branchId,
          quantity: normalized.quantity,
          unit_price: normalized.unit_price,
          total_revenue: normalized.total_revenue,
          cogs: normalized.cogs,
          discount: normalized.discount,
          channel: normalized.channel,
          payment_method: normalized.payment_method,
          source_file_id: sourceId,
          raw_data: JSON.stringify(row),
          checksum,
          created_at: new Date().toISOString(),
        },
      );
      inserted += 1;

      if (!minDate || normalized.transaction_date < minDate) {
        minDate = normalized.transaction_date;
      }
      if (!maxDate || normalized.transaction_date > maxDate) {
        maxDate = normalized.transaction_date;
      }
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  logAudit({
    tenantId,
    userId,
    action: 'data_process_transactions',
    resourceType: 'source_file',
    resourceId: sourceId,
    metadata: { inserted, duplicates, skipped },
  });

  return {
    inserted,
    duplicates,
    skipped,
    minDate: minDate?.toISOString() ?? null,
    maxDate: maxDate?.toISOString() ?? null,
  };
}

function insertExpenses({ tenantId, userId, sourceId, rows, mapping }) {
  let inserted = 0;
  let skipped = 0;
  let minDate = null;
  let maxDate = null;

  for (const row of rows) {
    const normalized = normalizeExpenseRow(row, mapping);
    if (!normalized.expense_date || normalized.amount === null) {
      skipped += 1;
      continue;
    }

    const branchId = ensureBranch(tenantId, normalized.branch_name);

    run(
      `
        INSERT INTO expenses (
          id, tenant_id, expense_date, category, amount,
          branch_id, description, recurring, source_file_id, created_at
        ) VALUES (
          :id, :tenant_id, :expense_date, :category, :amount,
          :branch_id, :description, :recurring, :source_file_id, :created_at
        )
      `,
      {
        id: generateId(),
        tenant_id: tenantId,
        expense_date: normalized.expense_date.toISOString(),
        category: normalized.category,
        amount: normalized.amount,
        branch_id: branchId,
        description: normalized.description,
        recurring: normalized.recurring ? 1 : 0,
        source_file_id: sourceId,
        created_at: new Date().toISOString(),
      },
    );

    inserted += 1;
    if (!minDate || normalized.expense_date < minDate) {
      minDate = normalized.expense_date;
    }
    if (!maxDate || normalized.expense_date > maxDate) {
      maxDate = normalized.expense_date;
    }
  }

  logAudit({
    tenantId,
    userId,
    action: 'data_process_expenses',
    resourceType: 'source_file',
    resourceId: sourceId,
    metadata: { inserted, skipped },
  });

  return {
    inserted,
    duplicates: 0,
    skipped,
    minDate: minDate?.toISOString() ?? null,
    maxDate: maxDate?.toISOString() ?? null,
  };
}

export function replaceTenantDataset(tenantId, { keepFilePaths = [] } = {}) {
  const sources = all(`SELECT file_path FROM source_files WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  });
  const preserved = new Set((Array.isArray(keepFilePaths) ? keepFilePaths : [])
    .map((item) => String(item || ''))
    .filter(Boolean));

  withTransaction(() => {
    run(`DELETE FROM transactions WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
    run(`DELETE FROM expenses WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
    run(`DELETE FROM products WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
    run(`DELETE FROM branches WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
    run(`DELETE FROM customers WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
    run(`DELETE FROM source_files WHERE tenant_id = :tenant_id`, { tenant_id: tenantId });
  });

  for (const source of sources) {
    if (source.file_path && !preserved.has(source.file_path) && fs.existsSync(source.file_path)) {
      fs.unlinkSync(source.file_path);
    }
  }
}

export function updateSourceMapping({ tenantId, sourceId, datasetType, mapping }) {
  validateMapping(datasetType, mapping);

  run(
    `
      UPDATE source_files
      SET column_mapping = :column_mapping,
          status = :status
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    {
      id: sourceId,
      tenant_id: tenantId,
      column_mapping: JSON.stringify({ dataset_type: datasetType, mapping }),
      status: 'uploaded',
    },
  );
}

export async function processSourceFile({ tenantId, userId, sourceId }) {
  const source = get(`SELECT * FROM source_files WHERE id = :id AND tenant_id = :tenant_id`, {
    id: sourceId,
    tenant_id: tenantId,
  });

  if (!source) {
    throw new Error('Sumber data tidak ditemukan.');
  }

  const mappingInfo = parseColumnMapping(source);
  validateMapping(mappingInfo.datasetType, mappingInfo.mapping);

  try {
    const parsed = await parseDataset(source.file_path, source.file_type, source.filename);

    const summary = withTransaction(() => {
      if (mappingInfo.datasetType === 'expense') {
        return insertExpenses({
          tenantId,
          userId,
          sourceId,
          rows: parsed.rows,
          mapping: mappingInfo.mapping,
        });
      }

      return insertTransactions({
        tenantId,
        userId,
        sourceId,
        rows: parsed.rows,
        mapping: mappingInfo.mapping,
      });
    });

    updateSourceSummary(sourceId, {
      rowCount: summary.inserted,
      startDate: summary.minDate,
      endDate: summary.maxDate,
      status: 'ready',
    });

    return {
      sourceId,
      datasetType: mappingInfo.datasetType,
      ...summary,
    };
  } catch (error) {
    markSourceFailed(sourceId, error.message);
    throw error;
  }
}

export async function ingestUploadedSource({
  tenantId,
  userId,
  filePath,
  filename,
  contentType,
  replaceExisting = true,
  keepFilePaths = [],
}) {
  const analysis = await analyzeUploadedFile(filePath, filename, contentType);

  if (replaceExisting) {
    replaceTenantDataset(tenantId, { keepFilePaths });
  }

  const sourceId = storeSourceFileRecord({
    tenantId,
    filename,
    fileType: analysis.fileType,
    filePath,
    rowCount: analysis.rowCount,
    suggestion: analysis.suggestion,
    sampleRows: analysis.sampleRows,
  });

  const result = await processSourceFile({
    tenantId,
    userId,
    sourceId,
  });

  return {
    analysis,
    result,
    source: getSource(tenantId, sourceId),
  };
}

export async function repairLatestSourceIfNeeded({ tenantId, userId, requiredCapability = 'product_dimension' } = {}) {
  const latest = get(
    `
      SELECT *
      FROM source_files
      WHERE tenant_id = :tenant_id
      ORDER BY upload_date DESC
      LIMIT 1
    `,
    { tenant_id: tenantId },
  );

  if (!latest || !latest.file_path || !fs.existsSync(latest.file_path)) {
    return {
      ok: false,
      repaired: false,
      reason: 'source_not_found',
    };
  }

  let mappingInfo = parseColumnMapping(latest);
  const parsed = await readParsedSourceFile({
    filePath: latest.file_path,
    fileType: latest.file_type,
    filename: latest.filename,
  });

  const columns = Array.isArray(parsed?.columns) ? parsed.columns : [];
  const hasTypeColumn = columns.some((column) => ['type', 'model'].includes(toLowerSafe(column)));
  const hasBrandColumn = columns.some((column) => ['merk', 'brand'].includes(toLowerSafe(column)));

  const productsCount = get(
    `
      SELECT COUNT(*) AS value
      FROM products
      WHERE tenant_id = :tenant_id
    `,
    { tenant_id: tenantId },
  ) || { value: 0 };

  const alreadyHealthy = (() => {
    if (requiredCapability === 'product_dimension') {
      return Boolean(mappingInfo.mapping?.product_name) && Number(productsCount.value || 0) > 0;
    }
    return true;
  })();

  if (alreadyHealthy) {
    return {
      ok: true,
      repaired: false,
      reason: 'not_needed',
    };
  }

  if (requiredCapability === 'product_dimension' && !hasTypeColumn && !hasBrandColumn) {
    return {
      ok: false,
      repaired: false,
      reason: 'product_columns_not_found',
    };
  }

  const freshAnalysis = await analyzeUploadedFile(latest.file_path, latest.filename, latest.file_type);
  mappingInfo = {
    datasetType: freshAnalysis.suggestion?.datasetType || mappingInfo.datasetType,
    mapping: freshAnalysis.suggestion?.mapping || mappingInfo.mapping,
  };

  if (requiredCapability === 'product_dimension' && !mappingInfo.mapping?.product_name) {
    return {
      ok: false,
      repaired: false,
      reason: 'product_mapping_missing',
    };
  }

  const repaired = await ingestUploadedSource({
    tenantId,
    userId,
    filePath: latest.file_path,
    filename: latest.filename,
    contentType: latest.file_type,
    replaceExisting: true,
    keepFilePaths: [latest.file_path],
  });

  return {
    ok: true,
    repaired: true,
    source: repaired.source,
    analysis: repaired.analysis,
  };
}

function toLowerSafe(value) {
  return String(value || '').trim().toLowerCase();
}

export function listSources(tenantId) {
  return all(
    `
      SELECT id, filename, file_type, upload_date, row_count,
             date_range_start, date_range_end, status, column_mapping
      FROM source_files
      WHERE tenant_id = :tenant_id
      ORDER BY upload_date DESC
    `,
    { tenant_id: tenantId },
  );
}

export function getSource(tenantId, sourceId) {
  return get(
    `
      SELECT id, filename, file_type, upload_date, row_count,
             date_range_start, date_range_end, status, column_mapping
      FROM source_files
      WHERE tenant_id = :tenant_id AND id = :id
    `,
    { tenant_id: tenantId, id: sourceId },
  );
}

export function deleteSource(tenantId, sourceId) {
  const source = get(`SELECT * FROM source_files WHERE tenant_id = :tenant_id AND id = :id`, {
    tenant_id: tenantId,
    id: sourceId,
  });

  if (!source) {
    return false;
  }

  withTransaction(() => {
    run(`DELETE FROM transactions WHERE tenant_id = :tenant_id AND source_file_id = :source_file_id`, {
      tenant_id: tenantId,
      source_file_id: sourceId,
    });

    run(`DELETE FROM expenses WHERE tenant_id = :tenant_id AND source_file_id = :source_file_id`, {
      tenant_id: tenantId,
      source_file_id: sourceId,
    });

    run(`DELETE FROM source_files WHERE tenant_id = :tenant_id AND id = :id`, {
      tenant_id: tenantId,
      id: sourceId,
    });
  });

  if (source.file_path && fs.existsSync(source.file_path)) {
    fs.unlinkSync(source.file_path);
  }

  return true;
}
