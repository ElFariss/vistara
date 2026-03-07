import { normalizeWhitespace } from './text.mjs';

function firstNonEmptyLine(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) || '';
}

function detectDelimiter(headerLine) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;

  for (const delimiter of candidates) {
    let count = 0;
    let inQuotes = false;

    for (let i = 0; i < headerLine.length; i += 1) {
      const char = headerLine[i];
      const next = headerLine[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === delimiter && !inQuotes) {
        count += 1;
      }
    }

    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(normalizeWhitespace(field));
    field = '';
  };

  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && !inQuotes) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      pushField();
      pushRow();
      continue;
    }

    field += char;
  }

  pushField();
  if (row.length > 0) {
    pushRow();
  }

  return rows.filter((values) => values.some((value) => String(value || '').trim() !== ''));
}

function parseLine(text, delimiter) {
  return parseDelimitedText(text, delimiter)[0] || [];
}

function recoverWrappedRow(rowValues, delimiter, expectedLength) {
  if (rowValues.length !== 1) {
    return rowValues;
  }

  const raw = rowValues[0];
  if (!raw || !raw.includes(delimiter)) {
    return rowValues;
  }

  const parsed = parseLine(raw, delimiter);
  if (parsed.length === expectedLength) {
    return parsed;
  }

  return rowValues;
}

export function parseCsvText(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const headerLine = firstNonEmptyLine(source);

  if (!headerLine) {
    return { columns: [], rows: [] };
  }

  const delimiter = detectDelimiter(headerLine);
  const matrix = parseDelimitedText(source, delimiter);

  if (matrix.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = matrix[0].map((column, index) => column || `column_${index + 1}`);
  const rows = [];

  for (const values of matrix.slice(1)) {
    const recovered = recoverWrappedRow(values, delimiter, columns.length);
    const row = {};
    for (let i = 0; i < columns.length; i += 1) {
      row[columns[i]] = recovered[i] ?? '';
    }
    rows.push(row);
  }

  return { columns, rows };
}

export function parseCsvBuffer(buffer) {
  return parseCsvText(buffer.toString('utf8'));
}
