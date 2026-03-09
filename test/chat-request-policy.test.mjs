import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryNonStreamChatRequest } from '../public/chatRequestPolicy.js';

test('shouldRetryNonStreamChatRequest only retries transport-like failures', () => {
  assert.equal(shouldRetryNonStreamChatRequest({ code: 'DATASET_REQUIRED', statusCode: 400 }), false);
  assert.equal(shouldRetryNonStreamChatRequest({ code: 'CHAT_STREAM_UNAVAILABLE', statusCode: 400 }), true);
  assert.equal(shouldRetryNonStreamChatRequest({ code: 'CHAT_STREAM_INCOMPLETE', statusCode: 400 }), true);
  assert.equal(shouldRetryNonStreamChatRequest({ code: '', statusCode: 503 }), true);
  assert.equal(shouldRetryNonStreamChatRequest({ code: 'AI_SERVICE_UNAVAILABLE', statusCode: 503 }), false);
  assert.equal(shouldRetryNonStreamChatRequest({ code: 'AI_SERVICE_UNAVAILABLE', statusCode: 503, persistedInConversation: true }), false);
});
