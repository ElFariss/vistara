import crypto from 'node:crypto';

export function generateId() {
  return crypto.randomUUID();
}

export function shortId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
