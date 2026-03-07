import { get, run } from '../db.mjs';
import { sendError, sendJson } from '../http/response.mjs';

function fetchProfile(tenantId) {
  return get(
    `
      SELECT id, name, industry, city, timezone, currency, morning_verdict_time, created_at
      FROM tenants
      WHERE id = :id
    `,
    { id: tenantId },
  );
}

export function registerBusinessRoutes(router) {
  router.register(
    'POST',
    '/api/business/setup',
    async (ctx) => {
      const body = await ctx.getBody();
      const user = ctx.user;

      run(
        `
          UPDATE tenants
          SET name = :name,
              industry = :industry,
              city = :city,
              timezone = :timezone,
              currency = :currency,
              morning_verdict_time = :morning_verdict_time
          WHERE id = :id
        `,
        {
          id: user.tenant_id,
          name: body.name || body.business_name || 'Bisnis Vistara',
          industry: body.industry || null,
          city: body.city || null,
          timezone: body.timezone || 'Asia/Jakarta',
          currency: body.currency || 'IDR',
          morning_verdict_time: body.morning_verdict_time || '07:00',
        },
      );

      return sendJson(ctx.res, 200, {
        ok: true,
        profile: fetchProfile(user.tenant_id),
      });
    },
    { auth: true },
  );

  router.register(
    'GET',
    '/api/business/profile',
    async (ctx) => {
      const profile = fetchProfile(ctx.user.tenant_id);
      if (!profile) {
        return sendError(ctx.res, 404, 'PROFILE_NOT_FOUND', 'Profil bisnis tidak ditemukan.');
      }
      return sendJson(ctx.res, 200, { ok: true, profile });
    },
    { auth: true },
  );

  router.register(
    'PUT',
    '/api/business/profile',
    async (ctx) => {
      const body = await ctx.getBody();
      const current = fetchProfile(ctx.user.tenant_id);
      if (!current) {
        return sendError(ctx.res, 404, 'PROFILE_NOT_FOUND', 'Profil bisnis tidak ditemukan.');
      }

      run(
        `
          UPDATE tenants
          SET name = :name,
              industry = :industry,
              city = :city,
              timezone = :timezone,
              currency = :currency,
              morning_verdict_time = :morning_verdict_time
          WHERE id = :id
        `,
        {
          id: ctx.user.tenant_id,
          name: body.name ?? current.name,
          industry: body.industry ?? current.industry,
          city: body.city ?? current.city,
          timezone: body.timezone ?? current.timezone,
          currency: body.currency ?? current.currency,
          morning_verdict_time: body.morning_verdict_time ?? current.morning_verdict_time,
        },
      );

      return sendJson(ctx.res, 200, {
        ok: true,
        profile: fetchProfile(ctx.user.tenant_id),
      });
    },
    { auth: true },
  );
}
