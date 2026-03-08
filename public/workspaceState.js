const DEFAULT_CHAT_TITLE = 'Percakapan baru';

export function normalizeConversationTitle(value, fallback = DEFAULT_CHAT_TITLE) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || fallback;
}

export function resolveInitialConversationId(conversations = []) {
  return Array.isArray(conversations) && conversations[0]?.id ? conversations[0].id : null;
}

export function resolveNextConversationIdAfterDelete({
  activeConversationId = null,
  deletedConversationId = null,
  remainingConversations = [],
} = {}) {
  if (!activeConversationId || activeConversationId !== deletedConversationId) {
    return activeConversationId;
  }

  return resolveInitialConversationId(remainingConversations);
}

export function didDeleteActiveConversation({
  activeConversationId = null,
  deletedConversationId = null,
} = {}) {
  return Boolean(activeConversationId) && activeConversationId === deletedConversationId;
}

export function getChatHeaderState({
  activeConversation = null,
  fallbackTitle = '',
} = {}) {
  return {
    title: normalizeConversationTitle(activeConversation?.title || fallbackTitle),
  };
}
