import test from 'node:test';
import assert from 'node:assert/strict';
import {
  didDeleteActiveConversation,
  normalizeAppPath,
  normalizeConversationTitle,
  normalizeSettingsSection,
  pageFromPath,
  pathFromPage,
  resolveAccessiblePage,
  resolveCanvasState,
  resolveDashboardResetState,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
  shouldCenterComposer,
  shouldDockLandingFinalCta,
  shouldShowChatHeader,
} from '../public/workspaceState.js';

test('normalizeAppPath trims trailing slashes safely', () => {
  assert.equal(normalizeAppPath('/chat/'), '/chat');
  assert.equal(normalizeAppPath('auth///'), '/auth');
  assert.equal(normalizeAppPath('/'), '/');
});

test('page/path helpers map clean workspace routes', () => {
  assert.equal(pageFromPath('/'), 'landing');
  assert.equal(pageFromPath('/auth'), 'auth');
  assert.equal(pageFromPath('/context/'), 'context');
  assert.equal(pageFromPath('/chat'), 'workspace');
  assert.equal(pathFromPage('workspace'), '/chat');
  assert.equal(pathFromPage('landing'), '/');
});

test('resolveAccessiblePage protects workspace routes behind auth and context', () => {
  assert.equal(resolveAccessiblePage({ requestedPage: 'workspace', isAuthenticated: false, contextComplete: false }), 'auth');
  assert.equal(resolveAccessiblePage({ requestedPage: 'workspace', isAuthenticated: true, contextComplete: false }), 'context');
  assert.equal(resolveAccessiblePage({ requestedPage: 'workspace', isAuthenticated: true, contextComplete: true }), 'workspace');
  assert.equal(resolveAccessiblePage({ requestedPage: 'context', isAuthenticated: false, contextComplete: false }), 'auth');
  assert.equal(resolveAccessiblePage({ requestedPage: 'context', isAuthenticated: true, contextComplete: true }), 'workspace');
  assert.equal(resolveAccessiblePage({ requestedPage: 'auth', isAuthenticated: true, contextComplete: false }), 'context');
  assert.equal(resolveAccessiblePage({ requestedPage: 'auth', isAuthenticated: true, contextComplete: true }), 'workspace');
  assert.equal(resolveAccessiblePage({ requestedPage: 'landing', isAuthenticated: true, contextComplete: true }), 'landing');
});

test('normalizeSettingsSection locks the modal into user or agent groups', () => {
  assert.equal(normalizeSettingsSection('agent'), 'agent');
  assert.equal(normalizeSettingsSection('USER'), 'user');
  assert.equal(normalizeSettingsSection('other'), 'user');
});

test('resolveInitialConversationId keeps the empty session state reachable', () => {
  assert.equal(resolveInitialConversationId([]), null);
  assert.equal(resolveInitialConversationId([{ id: 'conv_1' }]), null);
  assert.equal(resolveInitialConversationId([{ id: 'conv_1', message_count: 2 }]), 'conv_1');
  assert.equal(resolveInitialConversationId([
    { id: 'conv_empty', message_count: 0, last_message_preview: '', last_message_role: null },
    { id: 'conv_real', message_count: 1, last_message_preview: 'Halo', last_message_role: 'assistant' },
  ]), 'conv_real');
});

test('resolveNextConversationIdAfterDelete clears the active session when the last one is removed', () => {
  assert.equal(resolveNextConversationIdAfterDelete({
    activeConversationId: 'conv_1',
    deletedConversationId: 'conv_1',
    remainingConversations: [],
  }), null);

  assert.equal(resolveNextConversationIdAfterDelete({
    activeConversationId: 'conv_1',
    deletedConversationId: 'conv_1',
    remainingConversations: [{ id: 'conv_2', message_count: 2 }],
  }), 'conv_2');

  assert.equal(resolveNextConversationIdAfterDelete({
    activeConversationId: 'conv_1',
    deletedConversationId: 'conv_1',
    remainingConversations: [{ id: 'conv_2', message_count: 0 }],
  }), null);
});

test('didDeleteActiveConversation only returns true for the active deleted session', () => {
  assert.equal(didDeleteActiveConversation({
    activeConversationId: 'conv_1',
    deletedConversationId: 'conv_1',
  }), true);

  assert.equal(didDeleteActiveConversation({
    activeConversationId: 'conv_1',
    deletedConversationId: 'conv_2',
  }), false);
});

test('normalizeConversationTitle trims whitespace and falls back cleanly', () => {
  assert.equal(normalizeConversationTitle('  Buat dashboard omzet  '), 'Buat dashboard omzet');
  assert.equal(normalizeConversationTitle(''), 'Percakapan baru');
});

test('shouldCenterComposer only centers a truly empty conversation with no pending state', () => {
  assert.equal(shouldCenterComposer({
    messageCount: 0,
    persistedMessageCount: 0,
    hasConversationId: false,
    isLoadingConversation: false,
    hasPendingActivity: false,
    hasDraftAttachment: false,
  }), true);

  assert.equal(shouldCenterComposer({
    messageCount: 0,
    persistedMessageCount: 2,
    hasConversationId: true,
  }), false);

  assert.equal(shouldCenterComposer({
    messageCount: 0,
    persistedMessageCount: 0,
    hasConversationId: true,
    isLoadingConversation: true,
  }), false);

  assert.equal(shouldCenterComposer({
    messageCount: 0,
    persistedMessageCount: 0,
    hasConversationId: true,
    hasPendingActivity: true,
  }), false);
});

test('shouldDockLandingFinalCta only docks when the user reaches the bottom of landing', () => {
  assert.equal(shouldDockLandingFinalCta({
    landingVisible: true,
    scrollY: 1200,
    viewportHeight: 800,
    documentHeight: 2200,
    threshold: 24,
  }), false);

  assert.equal(shouldDockLandingFinalCta({
    landingVisible: true,
    scrollY: 1376,
    viewportHeight: 800,
    documentHeight: 2200,
    threshold: 24,
  }), true);

  assert.equal(shouldDockLandingFinalCta({
    landingVisible: false,
    scrollY: 1376,
    viewportHeight: 800,
    documentHeight: 2200,
    threshold: 24,
  }), false);
});

test('shouldShowChatHeader only keeps the header when the dashboard action is available', () => {
  assert.equal(shouldShowChatHeader({ hasCanvasWidgets: true }), true);
  assert.equal(shouldShowChatHeader({ hasCanvasWidgets: false }), false);
});

test('resolveDashboardResetState preserves dashboard widgets when requested', () => {
  const widget = {
    id: 'widget_1',
    layout: { page: 2 },
  };

  assert.deepEqual(resolveDashboardResetState({
    preserveDashboard: true,
    currentDashboard: { id: 'dash_1' },
    canvasWidgets: [widget],
    canvasPage: 3,
    canvasPagesCount: 1,
  }), {
    currentDashboard: { id: 'dash_1' },
    canvasWidgets: [widget],
    canvasPage: 2,
    canvasPagesCount: 2,
  });

  assert.deepEqual(resolveDashboardResetState({
    preserveDashboard: false,
    currentDashboard: { id: 'dash_1' },
    canvasWidgets: [widget],
    canvasPage: 2,
    canvasPagesCount: 2,
  }), {
    currentDashboard: null,
    canvasWidgets: [],
    canvasPage: 1,
    canvasPagesCount: 1,
  });
});

test('resolveCanvasState falls back to saved dashboard widgets when the conversation has no canvas message', () => {
  const dashboardWidget = {
    id: 'widget_dashboard',
    layout: { page: 2 },
  };
  const messageWidget = {
    id: 'widget_message',
    layout: { page: 1 },
  };

  assert.deepEqual(resolveCanvasState({
    messageWidgets: [],
    dashboardWidgets: [dashboardWidget],
    canvasPage: 3,
    canvasPagesCount: 1,
    dashboardPagesCount: 3,
  }), {
    canvasWidgets: [dashboardWidget],
    canvasPagesCount: 3,
    canvasPage: 3,
  });

  assert.deepEqual(resolveCanvasState({
    messageWidgets: [messageWidget],
    dashboardWidgets: [dashboardWidget],
    canvasPage: 1,
    canvasPagesCount: 2,
  }), {
    canvasWidgets: [messageWidget],
    canvasPagesCount: 1,
    canvasPage: 1,
  });
});

test('canvas state helpers collapse stale extra pages when widgets only occupy page one', () => {
  const singlePageWidget = {
    id: 'widget_single',
    layout: { page: 1 },
  };

  assert.deepEqual(resolveDashboardResetState({
    preserveDashboard: true,
    currentDashboard: { id: 'dash_1' },
    canvasWidgets: [singlePageWidget],
    canvasPage: 2,
    canvasPagesCount: 2,
  }), {
    currentDashboard: { id: 'dash_1' },
    canvasWidgets: [singlePageWidget],
    canvasPage: 2,
    canvasPagesCount: 2,
  });

  assert.deepEqual(resolveCanvasState({
    messageWidgets: [singlePageWidget],
    dashboardWidgets: [],
    canvasPage: 2,
    canvasPagesCount: 2,
  }), {
    canvasWidgets: [singlePageWidget],
    canvasPagesCount: 1,
    canvasPage: 1,
  });
});
