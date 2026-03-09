export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function resolvePublicErrorMessage(error, fallbackMessage = 'Permintaan tidak dapat diproses.') {
  if (typeof error?.publicMessage === 'string' && error.publicMessage.trim()) {
    return error.publicMessage.trim();
  }

  const statusCode = Number(error?.statusCode || 0);
  if (statusCode > 0 && statusCode < 500 && typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

export function sendError(res, statusCode, code, message, details = null) {
  sendJson(res, statusCode, {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  });
}

export function sendNotFound(res) {
  sendError(res, 404, 'NOT_FOUND', 'Endpoint tidak ditemukan.');
}

export function sendMethodNotAllowed(res) {
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method tidak diizinkan.');
}

export function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}
