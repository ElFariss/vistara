const DEFAULT_CHAT_TITLE = 'Percakapan baru';
const EMPTY_CHAT_TITLE = 'Belum ada percakapan';
const READY_CHAT_SUBTITLE = 'Tanya dengan bahasa biasa. Saya akan jawab dengan insight yang bisa langsung dipakai.';
const SETUP_CHAT_SUBTITLE = 'Upload dataset sekali, lalu lanjut ngobrol seperti konsultasi bisnis.';
const EMPTY_CHAT_SUBTITLE = 'Kirim pertanyaan pertama atau tekan "Chat Baru" untuk mulai sesi baru kapan saja.';

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

export function getChatHeaderState({
  activeConversation = null,
  fallbackTitle = '',
  hasDatasetReady = false,
  conversationCount = 0,
} = {}) {
  if (Number(conversationCount || 0) <= 0) {
    return {
      title: EMPTY_CHAT_TITLE,
      subtitle: EMPTY_CHAT_SUBTITLE,
    };
  }

  return {
    title: activeConversation?.title || fallbackTitle || DEFAULT_CHAT_TITLE,
    subtitle: hasDatasetReady ? READY_CHAT_SUBTITLE : SETUP_CHAT_SUBTITLE,
  };
}
