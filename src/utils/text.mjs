export function normalizeWhitespace(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

export function toLowerAlnum(input = '') {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseJsonObjectFromText(input) {
  if (!input) {
    return null;
  }

  const text = String(input).trim();

  try {
    return JSON.parse(text);
  } catch {
    // Continue to bracket extraction fallback.
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function toRupiah(value) {
  const number = Number(value || 0);
  return `Rp ${number.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}
