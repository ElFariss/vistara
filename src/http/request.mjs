import { config } from '../config.mjs';
import { parseMultipartBody } from './multipart.mjs';

export function parseUrl(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

function normalizeIp(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('::ffff:')) {
    return raw.slice('::ffff:'.length);
  }

  return raw;
}

export function resolveClientIp({
  remoteAddress = '',
  forwardedFor = '',
  trustedProxyIps = [],
} = {}) {
  const normalizedRemote = normalizeIp(remoteAddress);
  const trusted = new Set((trustedProxyIps || []).map((item) => normalizeIp(item)).filter(Boolean));

  if (normalizedRemote && trusted.has(normalizedRemote)) {
    const firstForwarded = String(forwardedFor || '')
      .split(',')
      .map((item) => normalizeIp(item))
      .find(Boolean);

    if (firstForwarded) {
      return firstForwarded;
    }
  }

  return normalizedRemote || 'unknown';
}

export function getClientIp(req) {
  return resolveClientIp({
    remoteAddress: req.socket?.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'],
    trustedProxyIps: config.trustedProxyIps,
  });
}

export async function readBody(req, maxBytes = config.maxUploadSizeBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Payload melebihi batas ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

export async function parseRequestBody(req) {
  const rawContentType = String(req.headers['content-type'] || '');
  const contentType = rawContentType.toLowerCase();
  const body = await readBody(req);

  if (!body.length) {
    return {};
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('JSON body tidak valid.');
    }
  }

  if (contentType.includes('multipart/form-data')) {
    return parseMultipartBody(body, rawContentType);
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = body.toString('utf8');
    const params = new URLSearchParams(text);
    const object = {};
    for (const [key, value] of params.entries()) {
      object[key] = value;
    }
    return object;
  }

  return {
    raw: body,
  };
}
