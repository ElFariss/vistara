import { sendError, sendJson, sendNoContent } from '../http/response.mjs';
import {
  createDashboard,
  deleteDashboard,
  ensureDefaultDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from '../services/dashboards.mjs';
import { renderDashboardPng } from '../services/dashboardImage.mjs';

function isDashboardConfigObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isRenderWidgetArray(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
}

export function registerDashboardRoutes(router) {
  router.register(
    'GET',
    '/api/dashboards',
    async (ctx) => {
      ensureDefaultDashboard(ctx.user.tenant_id, ctx.user.id);
      const conversationId = ctx.query.get('conversation_id') || null;
      const dashboards = listDashboards(ctx.user.tenant_id, ctx.user.id, { conversationId });
      return sendJson(ctx.res, 200, { ok: true, dashboards });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/dashboards/:id',
    async (ctx) => {
      const dashboard = getDashboard(ctx.user.tenant_id, ctx.user.id, ctx.params.id);
      if (!dashboard) {
        return sendError(ctx.res, 404, 'DASHBOARD_NOT_FOUND', 'Dashboard tidak ditemukan.');
      }
      return sendJson(ctx.res, 200, { ok: true, dashboard });
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/dashboards',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!body.name || typeof body.name !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'name wajib diisi.');
      }
      if (body.config !== undefined && body.config !== null && !isDashboardConfigObject(body.config)) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'config dashboard harus berupa object.');
      }
      const dashboard = createDashboard(ctx.user.tenant_id, ctx.user.id, body.name, body.config || null, {
        conversationId: body.conversation_id || null,
      });
      return sendJson(ctx.res, 201, { ok: true, dashboard });
    },
    { auth: true },
  );

  router.register(
    'PUT',
    '/api/dashboards/:id',
    async (ctx) => {
      const body = await ctx.getBody();
      if (body.name !== undefined && typeof body.name !== 'string') {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'name harus berupa string.');
      }
      if (body.config !== undefined && body.config !== null && !isDashboardConfigObject(body.config)) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'config dashboard harus berupa object.');
      }
      const dashboard = updateDashboard(ctx.user.tenant_id, ctx.user.id, ctx.params.id, {
        name: body.name,
        config: body.config,
      });

      if (!dashboard) {
        return sendError(ctx.res, 404, 'DASHBOARD_NOT_FOUND', 'Dashboard tidak ditemukan.');
      }

      return sendJson(ctx.res, 200, { ok: true, dashboard });
    },
    { auth: true },
  );

  router.register(
    'DELETE',
    '/api/dashboards/:id',
    async (ctx) => {
      const deleted = deleteDashboard(ctx.user.tenant_id, ctx.user.id, ctx.params.id);
      if (!deleted) {
        return sendError(ctx.res, 400, 'DASHBOARD_DELETE_FAILED', 'Dashboard tidak bisa dihapus.');
      }
      return sendNoContent(ctx.res);
    },
    { auth: true },
  );

  router.register(
    'POST',
    '/api/dashboards/render-image',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!isRenderWidgetArray(body.widgets)) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'widgets wajib berupa array object.');
      }

      try {
        const rendered = renderDashboardPng({
          widgets: body.widgets,
          page: body.page ? Number(body.page) : 1,
          stackPages: Boolean(body.stack_pages),
          title: typeof body.title === 'string' ? body.title : 'Dashboard Vistara',
        });
        ctx.res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        });
        ctx.res.end(rendered.buffer);
      } catch (error) {
        if (String(error?.code || '').startsWith('RENDER_')) {
          return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'Payload render dashboard terlalu besar atau tidak valid.');
        }
        return sendError(ctx.res, 500, 'DASHBOARD_RENDER_FAILED', 'Gagal merender gambar dashboard.');
      }
    },
    { auth: true },
  );
}
