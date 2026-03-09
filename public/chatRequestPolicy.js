export function shouldRetryNonStreamChatRequest(error = null) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const code = String(error?.code || '').trim().toUpperCase();
  const persistedInConversation = Boolean(error?.persistedInConversation);

  if (persistedInConversation) {
    return false;
  }

  if (statusCode >= 500 && !code) {
    return true;
  }

  return code.startsWith('CHAT_STREAM_');
}
