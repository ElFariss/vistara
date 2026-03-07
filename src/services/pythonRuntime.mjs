import { config } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('python-runtime');

function trimUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

export async function runPythonSnippet({ code, context = {}, timeoutMs = config.pythonAgentTimeoutMs } = {}) {
  const baseUrl = trimUrl(config.pythonAgentUrl);
  if (!baseUrl) {
    return {
      ok: false,
      reason: 'disabled',
      result: null,
      error: 'python_agent_disabled',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, Number(timeoutMs || 3000)));

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (config.pythonAgentToken) {
      headers.Authorization = `Bearer ${config.pythonAgentToken}`;
    }

    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        code: String(code || ''),
        context: context && typeof context === 'object' ? context : {},
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      return {
        ok: false,
        reason: `http_${response.status}`,
        result: null,
        error: raw.slice(0, 500),
      };
    }

    const payload = await response.json();
    return {
      ok: Boolean(payload?.ok),
      reason: payload?.ok ? null : payload?.reason || 'execution_failed',
      result: payload?.result ?? null,
      error: payload?.error || null,
      runtime_ms: payload?.runtime_ms || null,
    };
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    logger.warn('python runtime call failed', {
      error: error?.message || 'unknown_error',
      timeout,
    });
    return {
      ok: false,
      reason: timeout ? 'timeout' : 'network_error',
      result: null,
      error: error?.message || 'python_runtime_error',
    };
  } finally {
    clearTimeout(timer);
  }
}
