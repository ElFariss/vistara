import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getChatHeaderState,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
} from '../public/workspaceState.mjs';

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

test('getChatHeaderState returns explicit empty-state copy when there is no conversation yet', () => {
  const empty = getChatHeaderState({
    activeConversation: null,
    fallbackTitle: '',
    hasDatasetReady: true,
    conversationCount: 0,
  });

  assert.equal(empty.title, 'Belum ada percakapan');
  assert.match(empty.subtitle, /Kirim pertanyaan pertama/);
});
