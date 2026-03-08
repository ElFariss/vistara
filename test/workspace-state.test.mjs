import test from 'node:test';
import assert from 'node:assert/strict';
import {
  didDeleteActiveConversation,
  getChatHeaderState,
  normalizeAppPath,
  normalizeConversationTitle,
  normalizeSettingsSection,
  pageFromPath,
  pathFromPage,
  resolveAccessiblePage,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
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
  assert.equal(resolveInitialConversationId([{ id: 'conv_1' }]), 'conv_1');
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
    remainingConversations: [{ id: 'conv_2' }],
  }), 'conv_2');
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

test('getChatHeaderState returns the normalized active conversation title', () => {
  const header = getChatHeaderState({
    activeConversation: { title: '  Ringkas performa minggu ini ' },
    fallbackTitle: 'Fallback',
  });

  assert.equal(header.title, 'Ringkas performa minggu ini');
});
