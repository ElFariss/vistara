export function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'ya'].includes(text)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'tidak'].includes(text)) {
    return false;
  }
  return defaultValue;
}

export function parseIndonesianNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value).trim();
  if (!text) {
    return null;
  }

  text = text
    .replace(/rp\.?/gi, '')
    .replace(/idr/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '');

  if (!text) {
    return null;
  }

  const hasDot = text.includes('.');
  const hasComma = text.includes(',');

  if (hasDot && hasComma) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = text.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      text = parts[0].replace(/\./g, '') + '.' + parts[1];
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasDot && !hasComma) {
    const parts = text.split('.');
    if (parts.length > 1) {
      const last = parts.at(-1);
      const likelyThousands = parts.slice(1).every((part) => part.length === 3);
      if (likelyThousands || (last && last.length === 3 && parts.length > 2)) {
        text = text.replace(/\./g, '');
      }
    }
  }

  const number = Number(text);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}

function dateFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function parseFlexibleDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}/.test(text);
  if (isoDate) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slashMatch = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);

    if (first > 12) {
      return dateFromParts(year, second, first);
    }

    // Indonesia-first default: dd/mm/yyyy
    return dateFromParts(year, second, first);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
