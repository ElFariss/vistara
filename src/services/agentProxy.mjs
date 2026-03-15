/**
 * Agent proxy — routes AI agent calls to the Python FastAPI backend.
 *
 * When hooks are provided (streaming mode), the proxy uses POST /agent/chat/stream
 * to receive NDJSON events and dispatches them to the hooks as timeline events.
 * Otherwise, it uses POST /agent/chat for a simple JSON response.
 */

import { config } from '../config.mjs';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('agent-proxy');

function trimUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Build the common JSON request body for both endpoints.
 */
function buildRequestBody({ tenantId, userId, conversationId, dashboardId, message, history,
  datasetReady, userDisplayName, savedDashboard, datasetProfile, agentState }) {
  return JSON.stringify({
    tenant_id: tenantId,
    user_id: userId,
    conversation_id: conversationId,
    dashboard_id: dashboardId || null,
    message,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    dataset_ready: Boolean(datasetReady),
    dataset_profile: datasetProfile || null,
    user_display_name: userDisplayName || null,
    saved_dashboard: savedDashboard || null,
    agent_state: agentState || null,
  });
}

/**
 * Normalize a Python backend payload into the standard response shape.
 */
function normalizePayload(payload) {
  return {
    answer: payload.answer || '',
    content_format: payload.content_format || 'plain',
    widgets: payload.widgets || [],
    artifacts: payload.artifacts || [],
    presentation_mode: payload.presentation_mode || 'chat',
    intent: payload.intent || { intent: 'conversation', nlu_source: 'langgraph' },
    draft_dashboard: payload.draft_dashboard || null,
    pending_approval: payload.pending_approval || null,
    agent: payload.agent || { mode: 'langgraph', run_id: '', trace: [] },
    agent_dialogue: payload.agent_dialogue || [],
    analysis_brief: payload.analysis_brief || null,
    analytics_intent: payload.analytics_intent || null,
    agent_state: payload.agent_state || null,
  };
}

/**
 * Dispatch a parsed NDJSON event to the appropriate hook.
 */
function dispatchStreamEvent(event, hooks) {
  if (!hooks || !event?.type) return;

  const p = event.payload || {};

  switch (event.type) {
    case 'start':
      if (typeof hooks.onAgentStart === 'function') {
        hooks.onAgentStart({
          agent: p.agent || 'Vira',
          run_id: p.run_id || '',
          title: p.title || 'Memulai proses',
        });
      }
      break;

    case 'step':
      if (typeof hooks.onAgentStep === 'function') {
        hooks.onAgentStep({
          agent: p.agent || 'agent',
          run_id: p.run_id || '',
          status: p.status || 'done',
          title: p.title || 'Langkah selesai',
        });
      }
      break;

    case 'timeline':
      if (typeof hooks.onTimelineEvent === 'function') {
        hooks.onTimelineEvent({
          id: p.id || `timeline_${Date.now()}`,
          agent: p.agent || 'agent',
          status: p.status || 'done',
          title: p.title || 'Langkah proses',
        });
      }
      break;

    case 'dialogue':
      if (typeof hooks.onAgentDialogue === 'function') {
        hooks.onAgentDialogue(p);
      }
      break;

    case 'dashboard_patch':
      if (typeof hooks.onDashboardPatch === 'function') {
        hooks.onDashboardPatch(p);
      }
      break;

    default:
      // 'final' and 'error' types are handled in the main loop
      break;
  }
}

/**
 * Consume NDJSON stream from the Python backend.
 * Returns the final payload after dispatching all intermediate events.
 */
async function consumeNDJSONStream(response, hooks) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          if (event.type === 'final') {
            finalPayload = event.payload;
          } else if (event.type === 'error') {
            throw Object.assign(new Error(event.payload?.message || 'Agent stream failed'), {
              code: 'AGENT_FAILED',
              statusCode: 503,
              publicMessage: event.payload?.message || 'Gagal memproses permintaan AI.',
              reason: 'stream_error',
            });
          } else {
            dispatchStreamEvent(event, hooks);
          }
        } catch (parseError) {
          if (parseError?.code === 'AGENT_FAILED') throw parseError;
          logger.warn('ndjson parse error', { line: trimmed.slice(0, 200), error: parseError?.message });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalPayload) {
    throw Object.assign(new Error('Stream ended without final payload'), {
      code: 'AGENT_FAILED',
      statusCode: 503,
      publicMessage: 'Gagal memproses permintaan AI.',
      reason: 'stream_incomplete',
    });
  }

  return normalizePayload(finalPayload);
}

/**
 * Run the conversation agent via the Python backend.
 *
 * Drop-in replacement for the legacy JS conversation agent runtime.
 * When hooks are provided, uses the streaming NDJSON endpoint for live timeline events.
 */
export async function runConversationAgent({
  tenantId,
  userId,
  conversationId,
  dashboardId = null,
  message,
  history = [],
  datasetReady = false,
  userDisplayName = null,
  savedDashboard = null,
  datasetProfile = null,
  agentState = null,
  hooks = null,
}) {
  const baseUrl = trimUrl(config.pythonAgentBackendUrl);
  if (!baseUrl) {
    throw Object.assign(new Error('Python agent backend URL not configured.'), {
      code: 'AI_SERVICE_UNAVAILABLE',
      statusCode: 503,
      publicMessage: 'Layanan AI belum tersedia.',
      reason: 'python_backend_not_configured',
    });
  }

  const useStream = Boolean(hooks);
  const endpoint = useStream ? `${baseUrl}/agent/chat/stream` : `${baseUrl}/agent/chat`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(5000, config.dashboardAgentTimeoutMs || 120000),
  );

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildRequestBody({
        tenantId,
        userId,
        conversationId,
        dashboardId,
        message,
        history,
        datasetReady,
        userDisplayName,
        savedDashboard,
        datasetProfile,
        agentState,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn('python agent backend request failed', {
        status: response.status,
        body: body.slice(0, 500),
        endpoint,
      });

      throw Object.assign(new Error(body.slice(0, 200)), {
        code: 'AI_SERVICE_UNAVAILABLE',
        statusCode: response.status >= 500 ? 503 : response.status,
        publicMessage: 'Layanan AI sedang bermasalah.',
        reason: `http_${response.status}`,
      });
    }

    // Streaming path — consume NDJSON and dispatch hooks
    if (useStream) {
      return await consumeNDJSONStream(response, hooks);
    }

    // Synchronous path — parse JSON
    const payload = await response.json();

    if (!payload.ok) {
      throw Object.assign(new Error(payload.error?.message || 'Agent failed'), {
        code: payload.error?.code || 'AGENT_FAILED',
        statusCode: payload.error?.status || 503,
        publicMessage: payload.error?.message || 'Gagal memproses permintaan AI.',
        reason: payload.error?.code || 'agent_failed',
      });
    }

    return normalizePayload(payload);
  } catch (error) {
    if (error?.code) {
      throw error;
    }

    const isTimeout = error?.name === 'AbortError';
    logger.warn('python agent backend call failed', {
      error: error?.message || 'unknown',
      timeout: isTimeout,
    });

    throw Object.assign(new Error(error?.message || 'Agent backend unreachable'), {
      code: isTimeout ? 'AI_SERVICE_TIMEOUT' : 'AI_SERVICE_UNAVAILABLE',
      statusCode: isTimeout ? 504 : 503,
      publicMessage: isTimeout
        ? 'Layanan AI terlalu lama merespons. Coba lagi.'
        : 'Layanan AI sedang bermasalah.',
      reason: isTimeout ? 'timeout' : 'network_error',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Apply a conversation approval via the Python backend.
 *
 * Drop-in replacement for legacy conversation approval handling.
 */
export async function applyConversationApproval({
  tenantId,
  userId,
  conversationId,
  approvalId,
  decision,
}) {
  const baseUrl = trimUrl(config.pythonAgentBackendUrl);
  if (!baseUrl) {
    return { ok: false, message: 'Python agent backend not configured.' };
  }

  try {
    const response = await fetch(`${baseUrl}/agent/approvals/${approvalId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        user_id: userId,
        conversation_id: conversationId,
        decision,
      }),
    });

    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    logger.warn('approval proxy failed', { error: error?.message });
    return { ok: false, message: error?.message || 'Approval failed.' };
  }
}
