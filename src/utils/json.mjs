function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenObject(input, prefix = '', output = {}) {
  if (!isPlainObject(input)) {
    return output;
  }

  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      output[nextKey] = value
        .map((item) => (item === null || item === undefined ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item)))
        .join(', ');
      continue;
    }

    if (isPlainObject(value)) {
      flattenObject(value, nextKey, output);
      continue;
    }

    output[nextKey] = value;
  }

  return output;
}

function normalizeRow(value) {
  if (isPlainObject(value)) {
    return flattenObject(value);
  }

  if (Array.isArray(value)) {
    const row = {};
    value.forEach((item, index) => {
      row[`field_${index + 1}`] = item;
    });
    return row;
  }

  return {
    value,
  };
}

function normalizeRoot(root) {
  if (Array.isArray(root)) {
    return root.map(normalizeRow);
  }

  if (isPlainObject(root)) {
    const listCandidate = Object.values(root).find((entry) => Array.isArray(entry));
    if (Array.isArray(listCandidate)) {
      return listCandidate.map(normalizeRow);
    }
    return [normalizeRow(root)];
  }

  return [normalizeRow(root)];
}

export function parseJsonText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File JSON tidak valid.');
  }

  const rows = normalizeRoot(parsed);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return {
    columns,
    rows: rows.map((row) => {
      const normalized = {};
      for (const column of columns) {
        const value = row[column];
        normalized[column] = value === null || value === undefined ? '' : String(value);
      }
      return normalized;
    }),
  };
}

export function parseJsonBuffer(buffer) {
  return parseJsonText(buffer.toString('utf8'));
}
