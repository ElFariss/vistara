import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSpaAppRoute,
  shouldDisableStaticCache,
} from '../src/http/staticAssets.mjs';

test('isSpaAppRoute recognizes the clean app routes', () => {
  assert.equal(isSpaAppRoute('/'), true);
  assert.equal(isSpaAppRoute('/auth'), true);
  assert.equal(isSpaAppRoute('/context'), true);
  assert.equal(isSpaAppRoute('/chat'), true);
  assert.equal(isSpaAppRoute('/api/health'), false);
  assert.equal(isSpaAppRoute('/vendor/chart.umd.min.js'), false);
});

test('shouldDisableStaticCache keeps SPA shells and app assets fresh', () => {
  assert.equal(shouldDisableStaticCache({
    pathname: '/',
    filePath: '/public/index.html',
  }), true);

  assert.equal(shouldDisableStaticCache({
    pathname: '/chat',
    filePath: '/public/index.html',
  }), true);

  assert.equal(shouldDisableStaticCache({
    pathname: '/styles.css',
    filePath: '/public/styles.css',
  }), true);

  assert.equal(shouldDisableStaticCache({
    pathname: '/logo.png',
    filePath: '/public/logo.png',
  }), false);
});
