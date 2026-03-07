import crypto from 'node:crypto';

export function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  return `${salt}:${key}`;
}

export function verifySecret(secret, stored) {
  if (!stored || !stored.includes(':')) {
    return false;
  }

  const [salt, originalHex] = stored.split(':');
  if (!salt || !originalHex) {
    return false;
  }

  const candidateHex = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  const original = Buffer.from(originalHex, 'hex');
  const candidate = Buffer.from(candidateHex, 'hex');

  if (original.length !== candidate.length) {
    return false;
  }

  return crypto.timingSafeEqual(original, candidate);
}

export function randomNumericCode(length = 6) {
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += crypto.randomInt(0, 10).toString();
  }
  return output;
}

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}
