import { sendError, sendJson, sendNoContent } from '../http/response.mjs';
import {
  createDashboard,
  deleteDashboard,
  ensureDefaultDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
} from '../services/dashboards.mjs';

export function registerDashboardRoutes(router) {
  router.register(
    'GET',
    '/api/dashboards',
    async (ctx) => {
      ensureDefaultDashboard(ctx.user.tenant_id, ctx.user.id);
      const dashboards = listDashboards(ctx.user.tenant_id, ctx.user.id);
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
      const dashboard = createDashboard(ctx.user.tenant_id, ctx.user.id, body.name, body.config || null);
      return sendJson(ctx.res, 201, { ok: true, dashboard });
    },
    { auth: true },
  );

  router.register(
    'PUT',
    '/api/dashboards/:id',
    async (ctx) => {
      const body = await ctx.getBody();
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
}
