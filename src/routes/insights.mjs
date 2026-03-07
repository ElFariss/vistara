import { sendJson } from '../http/response.mjs';
import { getAnomalies, getDailyVerdict, getTrends } from '../services/insights.mjs';

export function registerInsightRoutes(router) {
  router.register(
    'GET',
    '/api/insights/verdict',
    async (ctx) => {
      const verdict = getDailyVerdict(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, verdict });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/insights/anomalies',
    async (ctx) => {
      const anomalies = getAnomalies(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, anomalies });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/insights/trends',
    async (ctx) => {
      const trends = getTrends(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, trends });
    },
    { auth: true },
  );
}
