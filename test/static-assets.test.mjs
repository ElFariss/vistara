import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSpaAppRoute,
  isSharedStaticPath,
  normalizeStaticPathname,
  resolveStaticRelativePath,
  shouldDisableStaticCache,
} from '../src/http/staticAssets.mjs';

test('isSpaAppRoute recognizes the clean app routes', () => {
  assert.equal(isSpaAppRoute('/'), true);
  assert.equal(isSpaAppRoute('/auth'), true);
  assert.equal(isSpaAppRoute('/context'), true);
  assert.equal(isSpaAppRoute('/chat'), true);
  assert.equal(isSpaAppRoute('/chat/'), true);
  assert.equal(isSpaAppRoute('/api/health'), false);
  assert.equal(isSpaAppRoute('/health'), false);
  assert.equal(isSpaAppRoute('/vendor/chart.umd.min.js'), false);
});

test('isSharedStaticPath recognizes shared browser modules only', () => {
  assert.equal(isSharedStaticPath('/shared/dashboard-layout.mjs'), true);
  assert.equal(isSharedStaticPath('/shared'), false);
  assert.equal(isSharedStaticPath('/dashboard-layout.js'), false);
});

test('static pathname helpers only map the intended SPA routes to index.html', () => {
  assert.equal(normalizeStaticPathname('/chat/'), '/chat');
  assert.equal(resolveStaticRelativePath('/chat/'), '/index.html');
  assert.equal(resolveStaticRelativePath('/shared/dashboard-layout.mjs'), '/dashboard-layout.mjs');
  assert.equal(resolveStaticRelativePath('/health'), '/health');
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
    pathname: '/shared/dashboard-layout.mjs',
    filePath: '/shared/dashboard-layout.mjs',
  }), true);

  assert.equal(shouldDisableStaticCache({
    pathname: '/logo.png',
    filePath: '/public/logo.png',
  }), false);
});
