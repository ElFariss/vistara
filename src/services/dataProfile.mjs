import { get } from '../db.mjs';
import { parseFlexibleDate, parseIndonesianNumber } from '../utils/parse.mjs';
import { readParsedSourceFile } from './ingestion.mjs';

function parseJsonSafe(input, fallback = {}) {
  try {
    const parsed = JSON.parse(String(input || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function latestSourceRecord(tenantId) {
  return get(
    `
      SELECT *
      FROM source_files
      WHERE tenant_id = :tenant_id
      ORDER BY upload_date DESC
      LIMIT 1
    `,
    { tenant_id: tenantId },
  );
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '';
}

function toNumeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = parseIndonesianNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = parseFlexibleDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function inferColumnKind(values = []) {
  const sample = values.filter((value) => cleanText(value) !== '').slice(0, 120);
  if (sample.length === 0) {
    return 'empty';
  }

  let numericHits = 0;
  let dateHits = 0;
  let booleanHits = 0;
  for (const value of sample) {
    if (toNumeric(value) !== null) {
      numericHits += 1;
    }
    if (toDateValue(value) !== null) {
      dateHits += 1;
    }
    if (/^(true|false|ya|tidak|yes|no|0|1)$/i.test(cleanText(value))) {
      booleanHits += 1;
    }
  }

  const ratio = (hits) => hits / sample.length;
  if (ratio(dateHits) >= 0.7) return 'date';
  if (ratio(numericHits) >= 0.7) return 'number';
  if (ratio(booleanHits) >= 0.8) return 'boolean';
  return 'string';
}

function countDuplicates(rows = []) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = JSON.stringify(row || {});
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
  }
  return duplicates;
}

function pearson(valuesA = [], valuesB = []) {
  const pairs = [];
  const length = Math.min(valuesA.length, valuesB.length);
  for (let index = 0; index < length; index += 1) {
    const a = valuesA[index];
    const b = valuesB[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      continue;
    }
    pairs.push([a, b]);
  }

  if (pairs.length < 3) {
    return null;
  }

  const n = pairs.length;
  const sumX = pairs.reduce((acc, [x]) => acc + x, 0);
  const sumY = pairs.reduce((acc, [, y]) => acc + y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function topCorrelations(columns = [], rows = []) {
  const numericColumns = columns
    .filter((column) => column.kind === 'number')
    .slice(0, 12);

  const pairs = [];
  for (let leftIndex = 0; leftIndex < numericColumns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < numericColumns.length; rightIndex += 1) {
      const left = numericColumns[leftIndex];
      const right = numericColumns[rightIndex];
      const correlation = pearson(
        rows.map((row) => toNumeric(row[left.name])),
        rows.map((row) => toNumeric(row[right.name])),
      );
      if (!Number.isFinite(correlation)) {
        continue;
      }
      pairs.push({
        feature1: left.name,
        feature2: right.name,
        correlation: Number(correlation.toFixed(3)),
      });
    }
  }

  return pairs
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 8);
}

function buildColumnsProfile(rows = [], columns = []) {
  return columns.map((column) => {
    const values = rows.map((row) => row?.[column]);
    const nonEmptyValues = values.filter((value) => cleanText(value) !== '');
    const missingCount = values.length - nonEmptyValues.length;
    const uniqueCount = new Set(nonEmptyValues.map((value) => cleanText(value))).size;
    const samples = [...new Set(nonEmptyValues.map((value) => cleanText(value)).filter(Boolean))].slice(0, 5);
    return {
      name: column,
      kind: inferColumnKind(values),
      missing_count: missingCount,
      missing_pct: values.length > 0 ? Number(((missingCount / values.length) * 100).toFixed(2)) : 0,
      unique_count: uniqueCount,
      sample_values: samples,
    };
  });
}

function buildProfilePayload(source, parsed, mappingInfo) {
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const columns = Array.isArray(parsed?.columns) ? parsed.columns : [];
  const columnsProfile = buildColumnsProfile(rows, columns);
  const duplicates = countDuplicates(rows);

  return {
    source: {
      id: source.id,
      filename: source.filename,
      file_type: source.file_type,
      upload_date: source.upload_date,
      row_count: rows.length,
      status: source.status,
    },
    summary: {
      rows: rows.length,
      columns: columns.length,
      total_missing: columnsProfile.reduce((acc, column) => acc + column.missing_count, 0),
      duplicate_rows: duplicates,
      duplicate_pct: rows.length > 0 ? Number(((duplicates / rows.length) * 100).toFixed(2)) : 0,
    },
    detected: {
      date_columns: columnsProfile.filter((column) => column.kind === 'date').map((column) => column.name),
      numeric_columns: columnsProfile.filter((column) => column.kind === 'number').map((column) => column.name),
      categorical_columns: columnsProfile.filter((column) => column.kind === 'string').map((column) => column.name),
    },
    columns: columnsProfile,
    top_correlations: topCorrelations(columnsProfile, rows),
    mapping: mappingInfo,
    sample_rows: rows.slice(0, 12),
  };
}

export async function getDatasetProfile(tenantId) {
  const source = latestSourceRecord(tenantId);
  if (!source?.file_path) {
    return null;
  }

  const parsed = await readParsedSourceFile({
    filePath: source.file_path,
    fileType: source.file_type,
    filename: source.filename,
  });
  const mappingInfo = parseJsonSafe(source.column_mapping, {});
  return buildProfilePayload(source, parsed, mappingInfo);
}

function tableArtifact(title, columns, rows) {
  return {
    kind: 'table',
    title,
    columns,
    rows,
  };
}

export async function inspectDatasetQuestion({ tenantId, message = '' }) {
  const profile = await getDatasetProfile(tenantId);
  if (!profile) {
    return {
      answer: 'No dataset is available yet.',
      artifacts: [],
      profile: null,
    };
  }

  const lower = String(message || '').toLowerCase();

  if (/\b(column|columns|kolom|field|fields|schema)\b/.test(lower)) {
    const rows = profile.columns.map((column) => ({
      column: column.name,
      type: column.kind,
      missing_pct: `${column.missing_pct}%`,
      sample: column.sample_values.join(', '),
    }));
    return {
      answer: `I found ${profile.columns.length} columns in your dataset.`,
      artifacts: [tableArtifact('Dataset Columns', ['column', 'type', 'missing_pct', 'sample'], rows)],
      profile,
    };
  }

  if (/\b(missing|null|kosong|duplicate|duplikat|quality|kualitas|eda)\b/.test(lower)) {
    const worstColumns = [...profile.columns]
      .filter((column) => column.missing_count > 0)
      .sort((a, b) => b.missing_count - a.missing_count)
      .slice(0, 8)
      .map((column) => ({
        column: column.name,
        missing_count: column.missing_count,
        missing_pct: `${column.missing_pct}%`,
      }));
    return {
      answer: `Dataset quality summary: ${profile.summary.total_missing} missing values and ${profile.summary.duplicate_rows} duplicate rows.`,
      artifacts: [
        {
          kind: 'metric',
          title: 'Missing Values',
          value: profile.summary.total_missing.toLocaleString('en-US'),
          raw_value: profile.summary.total_missing,
        },
        {
          kind: 'metric',
          title: 'Duplicate Rows',
          value: profile.summary.duplicate_rows.toLocaleString('en-US'),
          raw_value: profile.summary.duplicate_rows,
        },
        tableArtifact('Columns With Missing Values', ['column', 'missing_count', 'missing_pct'], worstColumns),
      ].filter((artifact) => {
        if (artifact.kind !== 'table') return true;
        return artifact.rows.length > 0;
      }),
      profile,
    };
  }

  if (/\b(correlation|korelasi|hubungan)\b/.test(lower)) {
    const rows = profile.top_correlations.map((item) => ({
      feature_1: item.feature1,
      feature_2: item.feature2,
      correlation: item.correlation,
    }));
    return {
      answer: rows.length > 0
        ? `I found ${rows.length} strong numeric correlations in the dataset.`
        : 'I could not find enough numeric columns to compute meaningful correlations.',
      artifacts: rows.length > 0
        ? [tableArtifact('Top Correlations', ['feature_1', 'feature_2', 'correlation'], rows)]
        : [],
      profile,
    };
  }

  return {
    answer: `Dataset loaded: ${profile.summary.rows.toLocaleString('en-US')} rows, ${profile.summary.columns} columns, ${profile.detected.numeric_columns.length} numeric columns, and ${profile.detected.date_columns.length} date columns.`,
    artifacts: [
      {
        kind: 'metric',
        title: 'Rows',
        value: profile.summary.rows.toLocaleString('en-US'),
        raw_value: profile.summary.rows,
      },
      {
        kind: 'metric',
        title: 'Columns',
        value: String(profile.summary.columns),
        raw_value: profile.summary.columns,
      },
    ],
    profile,
  };
}
