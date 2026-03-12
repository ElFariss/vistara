import { generateJsonWithGemini } from './gemini.mjs';
import { toLowerAlnum } from '../utils/text.mjs';
import { Prompts } from './agents/index.mjs';

const TRANSACTION_FIELDS = [
  'transaction_date',
  'product_name',
  'quantity',
  'unit_price',
  'total_revenue',
  'cogs',
  'discount',
  'branch_name',
  'channel',
  'payment_method',
  'category',
];

const EXPENSE_FIELDS = [
  'expense_date',
  'expense_category',
  'expense_amount',
  'branch_name',
  'description',
  'recurring',
];

const keywordMap = new Map([
  ['transaction_date', ['tanggal', 'date', 'waktu', 'time']],
  ['product_name', ['produk', 'product', 'item', 'menu', 'nama barang', 'nama produk', 'barang']],
  ['quantity', ['qty', 'jumlah', 'kuantitas', 'pcs', 'unit terjual']],
  ['unit_price', ['harga satuan', 'unit price', 'harga', 'price']],
  ['total_revenue', ['total', 'omzet', 'revenue', 'sales', 'pendapatan', 'subtotal']],
  ['cogs', ['hpp', 'cogs', 'harga pokok', 'modal']],
  ['discount', ['diskon', 'discount', 'potongan']],
  ['branch_name', ['cabang', 'branch', 'outlet', 'toko']],
  ['channel', ['channel', 'kanal', 'marketplace', 'source']],
  ['payment_method', ['payment', 'pembayaran', 'metode bayar']],
  ['category', ['kategori', 'category']],
  ['expense_date', ['tanggal', 'date', 'waktu']],
  ['expense_category', ['kategori', 'category', 'jenis biaya']],
  ['expense_amount', ['nominal', 'amount', 'biaya', 'pengeluaran', 'expense']],
  ['description', ['deskripsi', 'keterangan', 'description', 'catatan']],
  ['recurring', ['berulang', 'recurring', 'langganan']],
]);

const PRODUCT_NAME_KEYWORDS = ['produk', 'product', 'item', 'menu', 'nama barang', 'nama produk', 'barang'];
const PRODUCT_VARIANT_KEYWORDS = ['type', 'model', 'variant', 'varian', 'sku'];
const PRODUCT_BRAND_KEYWORDS = ['merk', 'merek', 'brand'];

function detectDatasetType(columns) {
  const normalized = columns.map((column) => toLowerAlnum(column)).join(' ');
  const expenseSignals = ['biaya', 'expense', 'pengeluaran', 'gaji', 'sewa'];
  const hasExpenseSignal = expenseSignals.some((signal) => normalized.includes(signal));
  return hasExpenseSignal ? 'expense' : 'transaction';
}

function scoreColumn(columnName, targetField) {
  const normalized = toLowerAlnum(columnName);
  const keywords = keywordMap.get(targetField) || [];

  let score = 0;
  for (const keyword of keywords) {
    const normalizedKeyword = toLowerAlnum(keyword);
    if (normalized === normalizedKeyword) {
      score += 20;
    } else if (normalized.includes(normalizedKeyword)) {
      score += 8;
    }
  }

  return score;
}

function findBestColumnByKeywords(columns, keywords) {
  let bestColumn = null;
  let bestScore = 0;

  for (const column of columns) {
    const score = keywords.reduce((acc, keyword) => {
      const normalizedColumn = toLowerAlnum(column);
      const normalizedKeyword = toLowerAlnum(keyword);
      if (normalizedColumn === normalizedKeyword) {
        return acc + 20;
      }
      if (normalizedColumn.includes(normalizedKeyword)) {
        return acc + 8;
      }
      return acc;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }

  return bestScore > 0 ? bestColumn : null;
}

function inferProductDimensionColumn(columns) {
  return findBestColumnByKeywords(columns, PRODUCT_NAME_KEYWORDS)
    || findBestColumnByKeywords(columns, PRODUCT_VARIANT_KEYWORDS)
    || findBestColumnByKeywords(columns, PRODUCT_BRAND_KEYWORDS);
}

function applyTransactionFallbacks(columns, mapping) {
  const completed = { ...mapping };

  if (!completed.product_name) {
    const inferredProductColumn = inferProductDimensionColumn(columns);
    if (inferredProductColumn) {
      completed.product_name = inferredProductColumn;
    }
  }

  if (!completed.unit_price) {
    const inferredPriceColumn = columns.find((column) => {
      const normalized = toLowerAlnum(column);
      return normalized.includes('harga') || normalized.includes('price') || normalized.includes('nominal');
    });
    if (inferredPriceColumn) {
      completed.unit_price = inferredPriceColumn;
    }
  }

  if (!completed.total_revenue && completed.unit_price) {
    completed.total_revenue = '__derived__';
  }

  return completed;
}

function heuristicMapping(columns, datasetType) {
  const fields = datasetType === 'expense' ? EXPENSE_FIELDS : TRANSACTION_FIELDS;
  const mapping = {};

  for (const field of fields) {
    let bestColumn = null;
    let bestScore = 0;

    for (const column of columns) {
      const score = scoreColumn(column, field);
      if (score > bestScore) {
        bestScore = score;
        bestColumn = column;
      }
    }

    if (bestColumn && bestScore > 0) {
      mapping[field] = bestColumn;
    }
  }

  if (datasetType === 'transaction') {
    return applyTransactionFallbacks(columns, mapping);
  }

  return mapping;
}

function sanitizeMapping(columns, rawMapping, datasetType) {
  const allowedFields = new Set(datasetType === 'expense' ? EXPENSE_FIELDS : TRANSACTION_FIELDS);
  const allowedColumns = new Set(columns);
  const cleaned = {};

  for (const [field, column] of Object.entries(rawMapping || {})) {
    if (!allowedFields.has(field)) {
      continue;
    }

    if (column === '__derived__') {
      cleaned[field] = column;
      continue;
    }

    if (typeof column !== 'string') {
      continue;
    }

    if (allowedColumns.has(column)) {
      cleaned[field] = column;
    }
  }

  return cleaned;
}

async function aiMapping(columns, sampleRows, datasetType, fallbackMapping) {
  const result = await generateJsonWithGemini({
    systemPrompt: Prompts.COLUMN_MAPPER_AGENT,
    userPrompt: JSON.stringify({
      instruction:
        'Pilih mapping terbaik. Gunakan hanya nama kolom yang tersedia. Jika field tidak ada, jangan isi.',
      dataset_type: datasetType,
      available_columns: columns,
      sample_rows: sampleRows.slice(0, 5),
      fallback_mapping: fallbackMapping,
      response_format: {
        mapping: 'object(field->columnName|"__derived__")',
        confidence: 'number 0..1',
      },
    }),
    temperature: 0,
    maxOutputTokens: 600,
  });

  if (!result.ok || !result.data) {
    return null;
  }

  const mapping = sanitizeMapping(columns, result.data.mapping, datasetType);
  const confidence = Number(result.data.confidence);
  const completedMapping = datasetType === 'transaction'
    ? applyTransactionFallbacks(columns, mapping)
    : mapping;

  return {
    mapping: completedMapping,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
  };
}

export async function suggestColumnMapping(columns, sampleRows) {
  const datasetType = detectDatasetType(columns);
  const heuristic = heuristicMapping(columns, datasetType);

  const ai = await aiMapping(columns, sampleRows, datasetType, heuristic);
  if (ai && Object.keys(ai.mapping).length > 0) {
    return {
      datasetType,
      mapping: ai.mapping,
      confidence: ai.confidence,
      method: 'gemini',
    };
  }

  return {
    datasetType,
    mapping: heuristic,
    confidence: 0.65,
    method: 'heuristic',
  };
}

export function requiredFieldsForDataset(datasetType) {
  if (datasetType === 'expense') {
    return ['expense_date', 'expense_amount'];
  }
  return ['transaction_date', 'total_revenue'];
}
