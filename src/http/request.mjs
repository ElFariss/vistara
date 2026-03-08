import { config } from '../config.mjs';
import { parseMultipartBody } from './multipart.mjs';

export function parseUrl(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
  };
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
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
