import { sendError, sendJson } from '../http/response.mjs';
import { generateReport, getReport, listReports } from '../services/reports.mjs';

export function registerReportRoutes(router) {
  router.register(
    'POST',
    '/api/reports/generate',
    async (ctx) => {
      const body = await ctx.getBody();
      const report = await generateReport({
        tenantId: ctx.user.tenant_id,
        userId: ctx.user.id,
        title: body.title || null,
        period: body.period || 'minggu ini',
      });
      return sendJson(ctx.res, 201, { ok: true, report });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/reports',
    async (ctx) => {
      const reports = await listReports(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, reports });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/reports/:id/download',
    async (ctx) => {
      const report = await getReport(ctx.user.tenant_id, ctx.user.id, ctx.params.id);
      if (!report) {
        return sendError(ctx.res, 404, 'REPORT_NOT_FOUND', 'Report tidak ditemukan.');
      }

      const format = (ctx.query.get('format') || report.format || 'markdown').toLowerCase();
      if (format === 'json') {
        return sendJson(ctx.res, 200, { ok: true, report });
      }

      ctx.res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${report.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md"`,
      });
      ctx.res.end(report.content);
    },
    { auth: true },
  );
}
