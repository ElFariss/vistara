import crypto from 'node:crypto';

function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  let value = input.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) {
    value += '=';
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

function sign(unsignedToken, secret) {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(unsignedToken).digest());
}

export function createToken(payload, secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(unsignedToken, secret);
  return `${unsignedToken}.${signature}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expected = sign(unsignedToken, secret);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
