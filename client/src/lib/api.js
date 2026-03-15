/**
 * HTTP API client — fetch with retry, timeout, auth headers.
 */

import { state } from './state.js';
import { API_BASE_URL, DEFAULT_API_TIMEOUT_MS, UPLOAD_API_TIMEOUT_MS } from './constants.js';
import { createAppError, isNetworkLikeError, wait } from './utils.js';

// ── Fetch with retry ───────────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, config = {}) {
  const retries = Number.isFinite(config.retries) ? config.retries : 2;
  const baseDelayMs = Number.isFinite(config.baseDelayMs) ? config.baseDelayMs : 550;
  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : DEFAULT_API_TIMEOUT_MS;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timer = null;
    if (timeoutMs > 0) {
      timer = window.setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (timer) window.clearTimeout(timer);

      if (!response.ok && attempt < retries && [502, 503, 504].includes(response.status)) {
        await wait(baseDelayMs * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      if (timer) window.clearTimeout(timer);
      lastError = error;

      if (error?.name === 'AbortError') {
        throw createAppError('Permintaan melebihi batas waktu. Coba lagi.', { code: 'REQUEST_TIMEOUT' });
      }

      if (isNetworkLikeError(error) && attempt < retries) {
        await wait(baseDelayMs * (attempt + 1));
        continue;
      }

      throw error;
    }
  }

  throw lastError || createAppError('Request gagal');
}

// ── Demo session refresh ───────────────────────────────────────────────────

export async function refreshDemoSession() {
  try {
    const requestUrl = API_BASE_URL
      ? `${API_BASE_URL}/api/auth/demo`
      : '/api/auth/demo';
    const response = await fetchWithRetry(requestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, {
      retries: 1,
      baseDelayMs: 300,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      token: data.token || null,
      user: data.user || null,
    };
  } catch {
    return null;
  }
}

// ── Main API helper ────────────────────────────────────────────────────────

export async function api(path, options = {}) {
  const requestUrl = /^https?:\/\//.test(path)
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_API_TIMEOUT_MS;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  let body = options.body;
  if (body && !isFormData && typeof body === 'object') {
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchWithRetry(requestUrl, {
      ...options,
      headers,
      body,
    }, {
      retries: 2,
      baseDelayMs: 550,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('timeout')) {
      throw createAppError('Permintaan melebihi batas waktu. Coba lagi.', { code: 'REQUEST_TIMEOUT' });
    }
    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    throw createAppError(payload?.error?.message || response.statusText || 'Request gagal', {
      code: payload?.error?.code || null,
      statusCode: payload?.error?.status || response.status,
      details: payload?.error?.details ?? null,
    });
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  if (contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson')) {
    return response;
  }
  return response.text();
}

// ── Blob API helper ────────────────────────────────────────────────────────

export async function apiBlob(path, options = {}) {
  const requestUrl = /^https?:\/\//.test(path)
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_API_TIMEOUT_MS;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  let response;
  try {
    response = await fetchWithRetry(requestUrl, {
      ...options,
      headers,
    }, {
      retries: 2,
      baseDelayMs: 550,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('timeout')) {
      throw createAppError('Permintaan melebihi batas waktu. Coba lagi.', { code: 'REQUEST_TIMEOUT' });
    }
    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    throw createAppError(payload?.error?.message || response.statusText || 'Request gagal', {
      code: payload?.error?.code || null,
      statusCode: payload?.error?.status || response.status,
      details: payload?.error?.details ?? null,
    });
  }

  return response.blob();
}
