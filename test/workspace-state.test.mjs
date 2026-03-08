import test from 'node:test';
import assert from 'node:assert/strict';
import {
  didDeleteActiveConversation,
  getChatHeaderState,
  normalizeConversationTitle,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
} from '../public/workspaceState.js';

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
