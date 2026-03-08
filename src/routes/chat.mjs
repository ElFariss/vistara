import { sendError, sendJson } from '../http/response.mjs';
import {
  createConversation,
  deleteConversation,
  getChatHistory,
  listChatConversations,
  processChatMessage,
  renameConversation,
  setChatFeedback,
} from '../services/chat.mjs';

export function registerChatRoutes(router) {
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
      const conversations = listChatConversations({
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
        const conversation = createConversation({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          title: body.title || null,
        });

        return sendJson(ctx.res, 201, { ok: true, conversation });
      } catch (error) {
        return sendError(ctx.res, 500, 'CONVERSATION_CREATE_FAILED', error.message);
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

      const conversation = renameConversation({
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
      const removed = deleteConversation({
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
          message: body.message,
          conversationId: body.conversation_id || null,
          dashboardId: body.dashboard_id || null,
        });

        return sendJson(ctx.res, 200, { ok: true, ...response });
      } catch (error) {
        return sendError(ctx.res, 500, 'CHAT_FAILED', error.message);
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
          },
        });

        writeStreamEvent(ctx.res, 'final', { payload: response });
      } catch (error) {
        writeStreamEvent(ctx.res, 'error', {
          message: error.message || 'Gagal memproses chat stream.',
        });
      } finally {
        ctx.res.end();
      }
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/chat/history',
    async (ctx) => {
      const response = getChatHistory({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
        conversationId: ctx.query.get('conversation_id') || null,
      });

      return sendJson(ctx.res, 200, { ok: true, ...response });
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

      const updated = setChatFeedback({
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
}
