import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateQuery, listTemplateIds } from '../src/services/queryTemplates.mjs';

test('template registry has required analytics templates', () => {
  const templates = listTemplateIds();
  assert.ok(templates.includes('total_revenue'));
  assert.ok(templates.includes('revenue_trend'));
  assert.ok(templates.includes('top_products'));
});

test('unknown template is rejected', () => {
  assert.throws(
    () =>
      buildTemplateQuery('drop_all_tables', {
        tenantId: 'tenant_1',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-01-31T23:59:59.999Z',
      }),
    /tidak dikenal/i,
  );
});

test('user-supplied values are parameterized, not injected into SQL', () => {
  const injection = "Bandung' OR 1=1 --";
  const query = buildTemplateQuery('total_revenue', {
    tenantId: 'tenant_1',
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-31T23:59:59.999Z',
    branchName: injection,
  });

  assert.equal(query.sql.includes(injection), false);
  assert.equal(query.params.branch_name, injection);
  assert.ok(query.sql.includes(':branch_name'));
});

test('metric templates only pass named parameters used in SQL', () => {
  const metric = buildTemplateQuery('total_revenue', {
    tenantId: 'tenant_1',
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-31T23:59:59.999Z',
    limit: 10,
  });

  assert.equal('limit' in metric.params, false);
  assert.equal(metric.sql.includes(':limit'), false);

  const list = buildTemplateQuery('top_products', {
    tenantId: 'tenant_1',
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-31T23:59:59.999Z',
    limit: 10,
  });

  assert.equal('limit' in list.params, true);
  assert.equal(typeof list.params.limit, 'number');
  assert.equal(list.sql.includes(':limit'), true);
});
