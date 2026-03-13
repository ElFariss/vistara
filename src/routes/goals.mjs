import { resolvePublicErrorMessage, sendError, sendJson } from '../http/response.mjs';
import { createGoal, getGoalProgress, listGoals } from '../services/goals.mjs';

export function registerGoalRoutes(router) {
  router.register(
    'POST',
    '/api/goals',
    async (ctx) => {
      const body = await ctx.getBody();
      if (!(Number(body.target_value) > 0)) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'target_value harus > 0.');
      }

      try {
        const goal = await createGoal({
          tenantId: ctx.user.tenant_id,
          userId: ctx.user.id,
          metric: body.metric || 'revenue',
          targetValue: Number(body.target_value),
          startDate: body.start_date,
          endDate: body.end_date,
        });

        return sendJson(ctx.res, 201, { ok: true, goal });
      } catch (error) {
        return sendError(
          ctx.res,
          400,
          'GOAL_CREATE_FAILED',
          resolvePublicErrorMessage(error, 'Goal tidak bisa dibuat dengan input saat ini.'),
        );
      }
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/goals',
    async (ctx) => {
      const goals = await listGoals(ctx.user.tenant_id, ctx.user.id);
      return sendJson(ctx.res, 200, { ok: true, goals });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/goals/:id/progress',
    async (ctx) => {
      const progress = await getGoalProgress(ctx.user.tenant_id, ctx.user.id, ctx.params.id);
      if (!progress) {
        return sendError(ctx.res, 404, 'GOAL_NOT_FOUND', 'Goal tidak ditemukan.');
      }
      return sendJson(ctx.res, 200, { ok: true, progress });
    },
    { auth: true },
  );
}
