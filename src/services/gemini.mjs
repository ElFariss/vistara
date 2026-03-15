import { config } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';
import { parseJsonObjectFromText } from '../utils/text.mjs';

const logger = createLogger('gemini');
let quotaCooldownUntil = 0;
let quotaCooldownReason = null;

function parseQuotaRetryMs(text) {
  const source = String(text || '');
  const match = source.match(/retry in\s*([0-9hms.\s]+)/i);
  if (!match) {
    return null;
  }

  const chunk = match[1];
  const hours = Number((chunk.match(/(\d+)\s*h/i) || [])[1] || 0);
  const minutes = Number((chunk.match(/(\d+)\s*m/i) || [])[1] || 0);
  const seconds = Number((chunk.match(/([\d.]+)\s*s/i) || [])[1] || 0);
  const totalMs = Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
  return Number.isFinite(totalMs) && totalMs > 0 ? totalMs : null;
}

function activateQuotaCooldown(body, fallbackMs = 15 * 60 * 1000) {
  const durationMs = parseQuotaRetryMs(body) || fallbackMs;
  quotaCooldownUntil = Date.now() + durationMs;
  quotaCooldownReason = 'quota_exhausted';
  logger.warn('gemini quota cooldown active', {
    duration_ms: durationMs,
    until_iso: new Date(quotaCooldownUntil).toISOString(),
  });
}

function isQuotaCooldownActive() {
  return quotaCooldownUntil > Date.now();
}

function clearQuotaCooldown() {
  quotaCooldownUntil = 0;
  quotaCooldownReason = null;
}

export function getGeminiQuotaCooldownInfo() {
  const active = isQuotaCooldownActive();
  return {
    active,
    reason: active ? quotaCooldownReason || 'quota_exhausted' : null,
    until: active ? new Date(quotaCooldownUntil).toISOString() : null,
  };
}

export function resetGeminiQuotaCooldown() {
  clearQuotaCooldown();
}

function buildPrompt(systemPrompt, userPrompt) {
  if (!systemPrompt) {
    return userPrompt;
  }
  return `${systemPrompt}\n\n${userPrompt}`;
}

function buildInlineMediaParts({ systemPrompt = '', userPrompt = '', inlineFiles = [] }) {
  const parts = [];
  for (const file of Array.isArray(inlineFiles) ? inlineFiles : []) {
    const mimeType = String(file?.mimeType || '').trim().toLowerCase();
    const data = String(file?.data || '').trim();
    if (!mimeType || !data) {
      continue;
    }
    parts.push({
      inlineData: {
        mimeType,
        data,
      },
    });
  }

  const prompt = buildPrompt(systemPrompt, userPrompt);
  if (prompt) {
    parts.push({ text: prompt });
  }
  return parts;
}

function extractTextResponse(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  const textPart = parts.find((part) => typeof part.text === 'string');
  return textPart?.text ?? null;
}

function extractThoughtSummaries(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  return parts
    .filter((part) => Boolean(part?.thought) && typeof part?.text === 'string' && part.text.trim())
    .map((part) => String(part.text).trim())
    .filter(Boolean);
}

function normalizeFunctionArgs(rawArgs) {
  if (!rawArgs) {
    return {};
  }

  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  if (typeof rawArgs === 'object') {
    return rawArgs;
  }

  return {};
}

function extractFunctionCalls(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return [];
  }

  const calls = [];
  for (const part of parts) {
    const call = part?.functionCall || part?.function_call;
    if (!call || typeof call !== 'object') {
      continue;
    }

    const name = String(call.name || '').trim();
    if (!name) {
      continue;
    }

    calls.push({
      name,
      args: normalizeFunctionArgs(call.args),
    });
  }

  return calls;
}

export async function generateJsonWithGemini({
  systemPrompt = '',
  userPrompt,
  temperature = 0.1,
  topP = null,
  topK = null,
  maxOutputTokens = 800,
}) {
  if (!config.geminiApiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      data: null,
      rawText: null,
    };
  }

  if (isQuotaCooldownActive()) {
    return {
      ok: false,
      reason: quotaCooldownReason || 'quota_exhausted',
      data: null,
      rawText: null,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const prompt = buildPrompt(systemPrompt, userPrompt);

  try {
    const generationConfig = {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
    };
    if (Number.isFinite(topP)) {
      generationConfig.topP = topP;
    }
    if (Number.isFinite(topK)) {
      generationConfig.topK = Math.max(1, Math.floor(topK));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('gemini request failed', { status: response.status, body: body.slice(0, 500) });
      if (response.status === 429) {
        activateQuotaCooldown(body);
      }
      return {
        ok: false,
        reason: `http_${response.status}`,
        data: null,
        rawText: body,
      };
    }

    clearQuotaCooldown();
    const json = await response.json();
    const text = extractTextResponse(json);
    const parsed = parseJsonObjectFromText(text);

    if (!parsed) {
      return {
        ok: false,
        reason: 'invalid_json',
        data: null,
        rawText: text,
      };
    }

    return {
      ok: true,
      reason: null,
      data: parsed,
      rawText: text,
    };
  } catch (error) {
    logger.warn('gemini request error', { error: error.message });
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network_error',
      data: null,
      rawText: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateTextWithGemini({
  systemPrompt = '',
  userPrompt,
  temperature = 0.7,
  topP = null,
  topK = null,
  maxOutputTokens = 200,
  modelOverride = null,
}) {
  if (!config.geminiApiKey) {
    return { ok: false, reason: 'missing_api_key', text: null };
  }

  if (isQuotaCooldownActive()) {
    return { ok: false, reason: quotaCooldownReason || 'quota_exhausted', text: null };
  }

  const model = modelOverride || config.geminiModelLight || config.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const prompt = buildPrompt(systemPrompt, userPrompt);

  try {
    const generationConfig = { temperature, maxOutputTokens };
    if (Number.isFinite(topP)) {
      generationConfig.topP = topP;
    }
    if (Number.isFinite(topK)) {
      generationConfig.topK = Math.max(1, Math.floor(topK));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('gemini text request failed', { status: response.status, body: body.slice(0, 500) });
      if (response.status === 429) {
        activateQuotaCooldown(body);
      }
      return { ok: false, reason: `http_${response.status}`, text: null };
    }

    clearQuotaCooldown();
    const json = await response.json();
    const text = extractTextResponse(json);
    return { ok: true, reason: null, text: text || '' };
  } catch (error) {
    logger.warn('gemini text request error', { error: error.message });
    return { ok: false, reason: error.name === 'AbortError' ? 'timeout' : 'network_error', text: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateJsonWithGeminiMedia({
  systemPrompt = '',
  userPrompt,
  inlineFiles = [],
  temperature = 0.1,
  maxOutputTokens = 1200,
  modelOverride = null,
  signal = null,
}) {
  if (!config.geminiApiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      data: null,
      rawText: null,
    };
  }

  if (isQuotaCooldownActive()) {
    return {
      ok: false,
      reason: quotaCooldownReason || 'quota_exhausted',
      data: null,
      rawText: null,
    };
  }

  const model = modelOverride || config.geminiVisionModel || config.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const parts = buildInlineMediaParts({ systemPrompt, userPrompt, inlineFiles });
  const abortOnExternalSignal = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortOnExternalSignal();
  } else if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', abortOnExternalSignal, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('gemini media json request failed', { status: response.status, body: body.slice(0, 500) });
      if (response.status === 429) {
        activateQuotaCooldown(body);
      }
      return {
        ok: false,
        reason: `http_${response.status}`,
        data: null,
        rawText: body,
      };
    }

    clearQuotaCooldown();
    const json = await response.json();
    const text = extractTextResponse(json);
    const parsed = parseJsonObjectFromText(text);
    if (!parsed) {
      return {
        ok: false,
        reason: 'invalid_json',
        data: null,
        rawText: text,
      };
    }

    return {
      ok: true,
      reason: null,
      data: parsed,
      rawText: text,
    };
  } catch (error) {
    logger.warn('gemini media json request error', { error: error.message });
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network_error',
      data: null,
      rawText: null,
    };
  } finally {
    clearTimeout(timeout);
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', abortOnExternalSignal);
    }
  }
}

export async function generateWithGeminiTools({
  systemPrompt = '',
  userPrompt,
  tools = [],
  temperature = 0.1,
  maxOutputTokens = 800,
  modelOverride = null,
  thinkingLevel = null,
  thinkingBudget = null,
  includeThoughts = false,
  maxRetries = 1,
  functionCallingMode = 'AUTO',
  allowedFunctionNames = [],
  signal = null,
}) {
  if (!config.geminiApiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      text: null,
      thoughts: [],
      functionCalls: [],
      raw: null,
    };
  }

  if (isQuotaCooldownActive()) {
    return {
      ok: false,
      reason: quotaCooldownReason || 'quota_exhausted',
      text: null,
      thoughts: [],
      functionCalls: [],
      raw: null,
    };
  }

  const model = String(modelOverride || config.geminiModel || '').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const prompt = buildPrompt(systemPrompt, userPrompt);
  const abortOnExternalSignal = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortOnExternalSignal();
  } else if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', abortOnExternalSignal, { once: true });
  }

  const attempt = async () => {
    const parsedBudget = Number(thinkingBudget);
    const hasThinkingBudget = Number.isFinite(parsedBudget);
    const thinkingConfig = {
      ...(hasThinkingBudget ? { thinkingBudget: parsedBudget } : {}),
      ...(!hasThinkingBudget && thinkingLevel ? { thinkingLevel } : {}),
      ...(includeThoughts ? { includeThoughts: true } : {}),
    };
    const sanitizedMode = typeof functionCallingMode === 'string'
      ? functionCallingMode.toUpperCase()
      : 'AUTO';
    const mode = ['AUTO', 'ANY', 'NONE'].includes(sanitizedMode) ? sanitizedMode : 'AUTO';
    const names = Array.isArray(allowedFunctionNames)
      ? allowedFunctionNames.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const functionCallingConfig = {
      mode,
      ...(names.length > 0 ? { allowedFunctionNames: names } : {}),
    };
    const hasTools = Array.isArray(tools) && tools.length > 0;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(hasTools
          ? {
              tools: [
                {
                  functionDeclarations: tools,
                },
              ],
              toolConfig: {
                functionCallingConfig,
              },
            }
          : {}),
        generationConfig: {
          temperature,
          maxOutputTokens,
          ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('gemini tool request failed', { status: response.status, body: body.slice(0, 500) });
      if (response.status === 429) {
        activateQuotaCooldown(body);
      }
      return {
        ok: false,
        reason: `http_${response.status}`,
        text: null,
        thoughts: [],
        functionCalls: [],
        raw: body,
      };
    }

    clearQuotaCooldown();
    const payload = await response.json();
    return {
      ok: true,
      reason: null,
      text: extractTextResponse(payload),
      thoughts: extractThoughtSummaries(payload),
      functionCalls: extractFunctionCalls(payload),
      raw: payload,
    };
  };

  try {
    let retriesLeft = Number.isFinite(Number(maxRetries)) ? Math.max(0, Number(maxRetries)) : 0;
    while (true) {
      try {
        return await attempt();
      } catch (error) {
        if (error.name === 'AbortError' && retriesLeft > 0) {
          retriesLeft -= 1;
          logger.warn('gemini tool request retry', { reason: 'timeout', retries_left: retriesLeft });
          continue;
        }

        logger.warn('gemini tool request error', { error: error.message });
        return {
          ok: false,
          reason: error.name === 'AbortError' ? 'timeout' : 'network_error',
          text: null,
          thoughts: [],
          functionCalls: [],
          raw: null,
        };
      }
    }
  } finally {
    clearTimeout(timeout);
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', abortOnExternalSignal);
    }
  }
}
