import { execFileSync } from 'node:child_process';
import { normalizeWhitespace } from './text.mjs';

function decodeXml(input = '') {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getZipEntries(filePath) {
  const output = execFileSync('zipinfo', ['-1', filePath], { encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean);
}

function unzipText(filePath, entry) {
  try {
    return execFileSync('unzip', ['-p', filePath, entry], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function sheetIndexFromEntry(entry = '') {
  const match = String(entry).match(/sheet(\d+)\.xml$/i);
  return match ? Number(match[1]) : null;
}

function parseSheetNames(filePath, entries) {
  if (!entries.includes('xl/workbook.xml')) {
    return new Map();
  }
  const xml = unzipText(filePath, 'xl/workbook.xml');
  if (!xml) {
    return new Map();
  }
  const map = new Map();
  const regex = /<sheet[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/gi;
  let match;
  while ((match = regex.exec(xml))) {
    const name = normalizeWhitespace(decodeXml(match[1]));
    const sheetId = Number(match[2]);
    if (Number.isFinite(sheetId)) {
      map.set(sheetId, name || `Sheet ${sheetId}`);
    }
  }
  return map;
}

function parseSharedStrings(xml) {
  if (!xml) {
    return [];
  }

  const strings = [];
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(xml))) {
    const segment = siMatch[1];
    const tMatches = [...segment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
    if (tMatches.length === 0) {
      strings.push('');
      continue;
    }
    const joined = tMatches.map((m) => decodeXml(m[1])).join('');
    strings.push(normalizeWhitespace(joined));
  }
  return strings;
}

function colLettersToIndex(letters) {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSheetRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;

  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const rowData = [];
    const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];

      const refMatch = attrs.match(/\sr="([A-Z]+)\d+"/i);
      const colIndex = refMatch ? colLettersToIndex(refMatch[1]) : rowData.length;

      const typeMatch = attrs.match(/\st="([^"]+)"/i);
      const type = typeMatch ? typeMatch[1] : 'n';

      let value = '';
      const inline = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/i);
      if (inline) {
        value = decodeXml(inline[1]);
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/i);
        if (v) {
          value = decodeXml(v[1]);
        }
      }

      if (type === 's') {
        const idx = Number(value);
        value = Number.isInteger(idx) ? sharedStrings[idx] ?? '' : '';
      }

      rowData[colIndex] = normalizeWhitespace(value);
    }

    rows.push(rowData.map((cell) => cell ?? ''));
  }

  return rows;
}

/**
 * Detect the actual header row in a sheet matrix.
 * Many xlsx files have metadata/title rows at the top (e.g., "Dataset Name", "Description", etc.)
 * before the actual column headers. This function scans the first rows and picks the one
 * most likely to be the header based on heuristics:
 * - Most non-empty cells
 * - All/mostly unique string values
 * - More than 2 populated cells (metadata rows usually have only 1-2)
 */
function detectHeaderRowIndex(matrix) {
  const scanLimit = Math.min(matrix.length, 20);
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i += 1) {
    const row = matrix[i];
    const nonEmpty = row.filter((cell) => String(cell || '').trim() !== '');
    const nonEmptyCount = nonEmpty.length;

    // Skip rows with very few populated cells (metadata/title rows)
    if (nonEmptyCount <= 2) {
      continue;
    }

    // Check uniqueness — headers should have unique labels
    const uniqueValues = new Set(nonEmpty.map((v) => String(v).toLowerCase().trim()));
    const uniqueRatio = uniqueValues.size / Math.max(1, nonEmptyCount);

    // Check if values look like headers (mostly non-numeric strings)
    const numericCount = nonEmpty.filter((v) => {
      const s = String(v).trim();
      return s !== '' && !isNaN(Number(s)) && !/[a-z_]/i.test(s);
    }).length;
    const numericRatio = numericCount / Math.max(1, nonEmptyCount);

    // Score: prefer rows with many unique string-like cells
    const score = nonEmptyCount * uniqueRatio * (1 - numericRatio * 0.5);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function parseXlsxFile(filePath) {
  const sheets = parseXlsxSheets(filePath);
  if (!sheets.length) {
    throw new Error('File XLSX tidak memiliki worksheet yang didukung.');
  }
  return sheets[0];
}

export function parseXlsxSheets(filePath) {
  const entries = getZipEntries(filePath);
  const sheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
    .sort((a, b) => {
      const aIndex = sheetIndexFromEntry(a) ?? 0;
      const bIndex = sheetIndexFromEntry(b) ?? 0;
      return aIndex - bIndex;
    });

  if (sheetEntries.length === 0) {
    return [];
  }

  const nameMap = parseSheetNames(filePath, entries);
  const sharedStringsXml = entries.includes('xl/sharedStrings.xml')
    ? unzipText(filePath, 'xl/sharedStrings.xml')
    : null;
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  return sheetEntries.map((entry) => {
    const sheetXml = unzipText(filePath, entry);
    if (!sheetXml) {
      return { name: normalizeWhitespace(entry), columns: [], rows: [] };
    }
    const matrix = parseSheetRows(sheetXml, sharedStrings);
    if (matrix.length === 0) {
      return { name: normalizeWhitespace(entry), columns: [], rows: [] };
    }

    const headerIndex = detectHeaderRowIndex(matrix);
    const header = matrix[headerIndex].map((col, index) => col || `column_${index + 1}`);
    const rows = matrix.slice(headerIndex + 1).filter((values) => values.some((v) => String(v || '').trim() !== '')).map((values) => {
      const row = {};
      for (let i = 0; i < header.length; i += 1) {
        row[header[i]] = values[i] ?? '';
      }
      return row;
    });
    const sheetIndex = sheetIndexFromEntry(entry) ?? 1;
    const name = nameMap.get(sheetIndex) || `Sheet ${sheetIndex}`;
    return {
      name: normalizeWhitespace(name) || `Sheet ${sheetIndex}`,
      columns: header,
      rows,
    };
  });
}
