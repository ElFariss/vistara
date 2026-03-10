import { config } from '../config.mjs';
import { parseMultipartBody } from './multipart.mjs';

export class RequestBodyError extends Error {
  constructor(code, message, statusCode, publicMessage = message) {
    super(message);
    this.name = 'RequestBodyError';
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

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
    let settled = false;

    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finishReject(new RequestBodyError(
          'PAYLOAD_TOO_LARGE',
          `Payload melebihi batas ${maxBytes} bytes.`,
          413,
          'Ukuran request melebihi batas maksimum.',
        ));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      finishResolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      if (settled) {
        return;
      }
      finishReject(error);
    });
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
      const parsed = JSON.parse(body.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RequestBodyError('INVALID_JSON', 'JSON body harus berupa object.', 400);
      }
      return parsed;
    } catch (error) {
      if (error instanceof RequestBodyError) {
        throw error;
      }
      throw new RequestBodyError('INVALID_JSON', 'JSON body tidak valid.', 400);
    }
  }

  if (contentType.includes('multipart/form-data')) {
    try {
      return parseMultipartBody(body, rawContentType);
    } catch {
      throw new RequestBodyError('INVALID_MULTIPART', 'Body multipart tidak valid.', 400);
    }
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
