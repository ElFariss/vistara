import { config } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';
import { parseJsonObjectFromText } from '../utils/text.mjs';

const logger = createLogger('gemini');

function buildPrompt(systemPrompt, userPrompt) {
  if (!systemPrompt) {
    return userPrompt;
  }
  return `${systemPrompt}\n\n${userPrompt}`;
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

export async function generateJsonWithGemini({ systemPrompt = '', userPrompt, temperature = 0.1, maxOutputTokens = 800 }) {
  if (!config.geminiApiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      data: null,
      rawText: null,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const prompt = buildPrompt(systemPrompt, userPrompt);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
      logger.warn('gemini request failed', { status: response.status, body: body.slice(0, 500) });
      return {
        ok: false,
        reason: `http_${response.status}`,
        data: null,
        rawText: body,
      };
    }

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

export async function generateWithGeminiTools({
  systemPrompt = '',
  userPrompt,
  tools = [],
  temperature = 0.1,
  maxOutputTokens = 800,
  thinkingLevel = null,
  maxRetries = 1,
}) {
  if (!config.geminiApiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      text: null,
      functionCalls: [],
      raw: null,
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const prompt = buildPrompt(systemPrompt, userPrompt);

  const attempt = async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [
          {
            functionDeclarations: tools,
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens,
          ...(thinkingLevel
            ? {
                thinkingConfig: {
                  thinkingLevel,
                },
              }
            : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('gemini tool request failed', { status: response.status, body: body.slice(0, 500) });
      return {
        ok: false,
        reason: `http_${response.status}`,
        text: null,
        functionCalls: [],
        raw: body,
      };
    }

    const payload = await response.json();
    return {
      ok: true,
      reason: null,
      text: extractTextResponse(payload),
      functionCalls: extractFunctionCalls(payload),
      raw: payload,
    };
  };

  try {
    return await attempt();
  } catch (error) {
    if (error.name === 'AbortError' && maxRetries > 0) {
      logger.warn('gemini tool request retry', { reason: 'timeout' });
      return generateWithGeminiTools({
        systemPrompt,
        userPrompt,
        tools,
        temperature,
        maxOutputTokens,
        thinkingLevel,
        maxRetries: maxRetries - 1,
      });
    }

    logger.warn('gemini tool request error', { error: error.message });
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network_error',
      text: null,
      functionCalls: [],
      raw: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
