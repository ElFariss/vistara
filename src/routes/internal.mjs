import { sendError, sendJson } from '../http/response.mjs';
import { executeAnalyticsIntent } from '../services/queryEngine.mjs';
import { createLogger } from '../utils/logger.mjs';

const logger = createLogger('internal-routes');

export function registerInternalRoutes(router) {
  // Only expose to the internal Docker network or localhost
  router.register(
    'POST',
    '/api/internal/analytics',
    async (ctx) => {
      const body = await ctx.getBody();
      
      if (!body.tenant_id || !body.user_id || !body.intent) {
        return sendError(ctx.res, 400, 'VALIDATION_ERROR', 'tenant_id, user_id, and intent are required.');
      }

      try {
        const result = await executeAnalyticsIntent({
          tenantId: body.tenant_id,
          userId: body.user_id,
          intent: body.intent,
        });

        return sendJson(ctx.res, 200, { ok: true, data: result });
      } catch (error) {
        logger.error('internal_analytics_failed', { 
          error: error?.message, 
          stack: error?.stack,
          intent: body.intent
        });
        return sendError(ctx.res, 500, 'INTERNAL_ANALYTICS_FAILED', error?.message || 'Failed to execute analytics query');
      }
    },
    { auth: false } // Internal route relies on Docker network isolation
  );
}
