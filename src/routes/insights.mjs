import { sendJson } from '../http/response.mjs';
import { getAnomalies, getDailyVerdict, getTrends } from '../services/insights.mjs';

export function registerInsightRoutes(router) {
  router.register(
    'GET',
    '/api/insights/verdict',
    async (ctx) => {
      const verdict = await getDailyVerdict(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, verdict });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/insights/anomalies',
    async (ctx) => {
      const anomalies = await getAnomalies(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, anomalies });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/insights/trends',
    async (ctx) => {
      const trends = await getTrends(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, trends });
    },
    { auth: true },
  );
}
