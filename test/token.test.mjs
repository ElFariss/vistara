import test from 'node:test';
import assert from 'node:assert/strict';
import { createToken, verifyToken } from '../src/utils/token.mjs';

test('token roundtrip succeeds with valid signature', () => {
  const token = createToken({ sub: 'user_1', tenant_id: 'tenant_1' }, 'secret', 3600);
  const payload = verifyToken(token, 'secret');
  assert.equal(payload.sub, 'user_1');
  assert.equal(payload.tenant_id, 'tenant_1');
});

test('token verification fails for wrong secret', () => {
  const token = createToken({ sub: 'user_1' }, 'secret', 3600);
  const payload = verifyToken(token, 'another-secret');
  assert.equal(payload, null);
});

test('token verification fails after expiry', () => {
  const token = createToken({ sub: 'user_1' }, 'secret', -1);
  const payload = verifyToken(token, 'secret');
  assert.equal(payload, null);
});
