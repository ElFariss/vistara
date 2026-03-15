import { resolvePublicErrorMessage, sendError, sendJson } from '../http/response.mjs';
import {
  ConversationNotFoundError,
  createConversation,
  deleteConversation,
  getChatHistory,
  listChatConversations,
  processConversationApproval,
  processChatMessage,
  renameConversation,
  setChatFeedback,
} from '../services/chat.mjs';
import { deleteDashboard } from '../services/dashboards.mjs';

export function registerChatRoutes(router) {
  function handleChatError(res, error, fallbackCode, fallbackMessage) {
    const statusCode = error instanceof ConversationNotFoundError
      ? (error.statusCode || 404)
      : (error?.statusCode || 500);
    const code = error instanceof ConversationNotFoundError
      ? (error.code || 'CONVERSATION_NOT_FOUND')
      : (error?.code || fallbackCode);
    const message = error instanceof ConversationNotFoundError
      ? (error.message || 'Percakapan tidak ditemukan.')
      : resolvePublicErrorMessage(error, fallbackMessage);

    return sendJson(res, statusCode, {
      ok: false,
      conversation_id: error?.conversationId || null,
      persisted_in_conversation: Boolean(error?.persistedInConversation),
      error: {
        code,
        message,
        status: statusCode,
        persisted_in_conversation: Boolean(error?.persistedInConversation),
      },
    });
  }

  function writeStreamEvent(res, type, payload = {}) {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    try {
      res.write(`${JSON.stringify({ type, ...payload })}\n`);
    } catch {
      // Ignore stream write errors to avoid crashing handler.
    }
  }

  router.register(
    'GET',
    '/api/chat/conversations',
    async (ctx) => {
      if (ctx.user?.role === 'demo') {
        return sendJson(ctx.res, 200, { ok: true, conversations: [] });
      }
      const conversations = await listChatConversations({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
      });

      return sendJson(ctx.res, 200, { ok: true, conversations });
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/chat/conversations',
    async (ctx) => {
      const body = await ctx.getBody();

      try {
        const conversation = await createConversation({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          title: body.title || null,
        });

        return sendJson(ctx.res, 201, { ok: true, conversation });
      } catch (error) {
        return sendError(
          ctx.res,
          500,
          'CONVERSATION_CREATE_FAILED',
          resolvePublicErrorMessage(error, 'Percakapan baru tidak bisa dibuat saat ini.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'PUT',
    '/api/chat/conversations/:conversationId',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.title || typeof body.title !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'title wajib diisi.');
      }

      const conversation = await renameConversation({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
        conversationId: ctx.params.conversationId,
        title: body.title,
      });

      if (!conversation) {
        return sendError(ctx.res, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
      }

      return sendJson(ctx.res, 200, { ok: true, conversation });
    },
    { auth: true },
  );

  router.register(
    'DELETE',
    '/api/chat/conversations/:conversationId',
    async (ctx) => {
      const removed = await deleteConversation({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
        conversationId: ctx.params.conversationId,
      });

      if (!removed) {
        return sendError(ctx.res, 404, 'CONVERSATION_NOT_FOUND', 'Percakapan tidak ditemukan.');
      }

      return sendJson(ctx.res, 200, { ok: true });
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/chat',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.message || typeof body.message !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'message wajib diisi.');
      }

      try {
        const response = await processChatMessage({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          userRole: ctx.user.role,
          message: body.message,
          conversationId: body.conversation_id || null,
          dashboardId: body.dashboard_id || null,
        });

        return sendJson(ctx.res, 200, { ok: true, ...response });
      } catch (error) {
        return handleChatError(ctx.res, error, 'CHAT_FAILED', 'Gagal memproses chat.');
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/chat/stream',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.message || typeof body.message !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'message wajib diisi.');
      }

      ctx.res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      try {
        const response = await processChatMessage({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          userRole: ctx.user.role,
          message: body.message,
          conversationId: body.conversation_id || null,
          dashboardId: body.dashboard_id || null,
          stream: {
            onTimelineStart: (data) => {
              writeStreamEvent(ctx.res, 'timeline_start', data);
            },
            onTimelineStep: (step) => {
              writeStreamEvent(ctx.res, 'timeline_step', { step });
            },
            onTimelineDone: (data) => {
              writeStreamEvent(ctx.res, 'timeline_done', data);
            },
            onAgentStart: (data) => {
              writeStreamEvent(ctx.res, 'agent_start', data);
            },
            onAgentStep: (data) => {
              writeStreamEvent(ctx.res, 'agent_step', data);
            },
            onAgentDialogue: (entry) => {
              writeStreamEvent(ctx.res, 'agent_dialogue', entry);
            },
            onDashboardPatch: (patch) => {
              writeStreamEvent(ctx.res, 'dashboard_patch', patch);
            },
            onApprovalRequired: (payload) => {
              writeStreamEvent(ctx.res, 'approval_required', payload);
            },
          },
        });

        writeStreamEvent(ctx.res, 'final', { payload: response });
      } catch (error) {
        writeStreamEvent(ctx.res, 'error', {
          code: error?.code || 'CHAT_STREAM_FAILED',
          status: error?.statusCode || 500,
          conversation_id: error?.conversationId || null,
          persisted_in_conversation: Boolean(error?.persistedInConversation),
          message:
            error instanceof ConversationNotFoundError
              ? error.message
              : resolvePublicErrorMessage(error, 'Gagal memproses chat stream.'),
        });
      } finally {
        ctx.res.end();
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/chat/approvals/:approvalId',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.conversation_id || typeof body.conversation_id !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'conversation_id wajib diisi.');
      }
      if (!body.decision || typeof body.decision !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'decision wajib diisi.');
      }

      try {
        const response = await processConversationApproval({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          conversationId: body.conversation_id,
          approvalId: ctx.params.approvalId,
          decision: body.decision,
        });

        return sendJson(ctx.res, 200, { ok: true, ...response });
      } catch (error) {
        return handleChatError(ctx.res, error, 'CHAT_APPROVAL_FAILED', 'Gagal memproses keputusan approval.');
      }
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/chat/history',
    async (ctx) => {
      if (ctx.user?.role === 'demo') {
        return sendJson(ctx.res, 200, {
          ok: true,
          conversation_id: null,
          conversation: null,
          messages: [],
          agent_state: null,
        });
      }
      try {
      const response = await getChatHistory({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          conversationId: ctx.query.get('conversation_id') || null,
        });

        return sendJson(ctx.res, 200, { ok: true, ...response });
      } catch (error) {
        return handleChatError(ctx.res, error, 'CHAT_HISTORY_FAILED', 'Gagal memuat riwayat chat.');
      }
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/chat/feedback',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.message_id || !body.feedback) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'message_id dan feedback wajib diisi.');
      }

      const updated = await setChatFeedback({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
        messageId: body.message_id,
        feedback: body.feedback,
      });

      if (!updated) {
        return sendError(ctx.res, 404, 'MESSAGE_NOT_FOUND', 'Pesan tidak ditemukan.');
      }

      return sendJson(ctx.res, 200, { ok: true });
    },
    { auth: true },
  );

  router.register(
    'DELETE',
    '/api/chat/dashboards/:dashboardId',
    async (ctx) => {
      try {
        const deleted = await deleteDashboard(ctx.user.tenant_id, ctx.user.id, ctx.params.dashboardId);
        if (!deleted) {
          return sendError(ctx.res, 404, 'DASHBOARD_NOT_FOUND', 'Dashboard tidak ditemukan.');
        }
        return sendJson(ctx.res, 200, { ok: true });
      } catch (error) {
        return handleChatError(ctx.res, error, 'DASHBOARD_DELETE_FAILED', 'Gagal menghapus dashboard.');
      }
    },
    { auth: true },
  );
}
