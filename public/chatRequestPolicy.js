export function shouldRetryNonStreamChatRequest(error = null) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const code = String(error?.code || '').trim().toUpperCase();

  if (statusCode >= 500) {
    return true;
  }

  return code.startsWith('CHAT_STREAM_');
}
