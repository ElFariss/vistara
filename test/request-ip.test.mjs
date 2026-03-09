import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from '../src/http/request.mjs';

test('getClientIp ignores x-forwarded-for unless proxy trust is enabled', () => {
  const req = {
    headers: {
      'x-forwarded-for': '203.0.113.8, 198.51.100.2',
    },
    socket: {
      remoteAddress: '10.0.0.5',
    },
  };

  assert.equal(getClientIp(req, { trustProxy: false }), '10.0.0.5');
  assert.equal(getClientIp(req, { trustProxy: true }), '203.0.113.8');
});
