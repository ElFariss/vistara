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

export function parseXlsxFile(filePath) {
  const entries = getZipEntries(filePath);
  const sheetEntry = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
    .sort()[0];

  if (!sheetEntry) {
    throw new Error('File XLSX tidak memiliki worksheet yang didukung.');
  }

  const sharedStringsXml = entries.includes('xl/sharedStrings.xml')
    ? unzipText(filePath, 'xl/sharedStrings.xml')
    : null;
  const sheetXml = unzipText(filePath, sheetEntry);

  if (!sheetXml) {
    throw new Error('Gagal membaca isi worksheet XLSX.');
  }

  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const matrix = parseSheetRows(sheetXml, sharedStrings);

  if (matrix.length === 0) {
    return { columns: [], rows: [] };
  }

  const header = matrix[0].map((col, index) => col || `column_${index + 1}`);
  const rows = matrix.slice(1).filter((values) => values.some((v) => String(v || '').trim() !== '')).map((values) => {
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = values[i] ?? '';
    }
    return row;
  });

  return { columns: header, rows };
}
