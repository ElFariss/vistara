import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router.mjs';
import { registerDashboardRoutes } from '../src/routes/dashboards.mjs';

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    destroyed: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk = '') {
      this.body += chunk ? String(chunk) : '';
    },
    end(chunk = '') {
      this.body += chunk ? String(chunk) : '';
      this.writableEnded = true;
    },
  };
}

async function invokeRoute(router, method, routePath, { user, body } = {}) {
  const match = router.match(method, routePath);
  assert.ok(match, `Route ${method} ${routePath} should exist`);

  const res = createMockResponse();
  await match.route.handler({
    req: {},
    res,
    params: match.params,
    query: new URLSearchParams(''),
    user,
    getBody: async () => body || {},
  });

  return res;
}

test('dashboard render route rejects oversized widget payloads', async () => {
  const router = new Router();
  registerDashboardRoutes(router);

  const widgets = Array.from({ length: 25 }, (_, index) => ({
    id: `widget-${index + 1}`,
    title: `Widget ${index + 1}`,
    artifact: {
      kind: 'metric',
      title: `Widget ${index + 1}`,
      value: '1',
      raw_value: 1,
    },
    layout: {
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      page: 1,
    },
  }));

  const res = await invokeRoute(router, 'POST', '/api/dashboards/render-image', {
    user: { id: 'user-test', tenant_id: 'tenant-test' },
    body: {
      title: 'Oversized',
      page: 1,
      widgets,
    },
  });

  assert.equal(res.statusCode, 400);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
});
