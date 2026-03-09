const DEFAULT_CHAT_TITLE = 'Percakapan baru';

export const PAGE_PATHS = {
  landing: '/',
  auth: '/auth',
  context: '/context',
  workspace: '/chat',
};

export function normalizeConversationTitle(value, fallback = DEFAULT_CHAT_TITLE) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || fallback;
}

export function normalizeAppPath(value = '/') {
  const text = String(value || '').trim() || '/';
  const pathname = text.startsWith('/') ? text : `/${text}`;
  if (pathname.length === 1) {
    return '/';
  }
  return pathname.replace(/\/+$/, '') || '/';
}

export function pageFromPath(pathname = '/') {
  const normalized = normalizeAppPath(pathname);
  if (normalized === PAGE_PATHS.auth) return 'auth';
  if (normalized === PAGE_PATHS.context) return 'context';
  if (normalized === PAGE_PATHS.workspace) return 'workspace';
  return 'landing';
}

export function pathFromPage(page = 'landing') {
  return PAGE_PATHS[page] || PAGE_PATHS.landing;
}

export function resolveAccessiblePage({
  requestedPage = 'landing',
  isAuthenticated = false,
  contextComplete = false,
} = {}) {
  if (requestedPage === 'workspace') {
    if (!isAuthenticated) {
      return 'auth';
    }
    if (!contextComplete) {
      return 'context';
    }
    return 'workspace';
  }

  if (requestedPage === 'context') {
    if (!isAuthenticated) {
      return 'auth';
    }
    return contextComplete ? 'workspace' : 'context';
  }

  if (requestedPage === 'auth') {
    if (!isAuthenticated) {
      return 'auth';
    }
    return contextComplete ? 'workspace' : 'context';
  }

  return 'landing';
}

export function normalizeSettingsSection(value = 'user') {
  return String(value || '').trim().toLowerCase() === 'agent' ? 'agent' : 'user';
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

export function shouldCenterComposer({
  messageCount = 0,
} = {}) {
  return Number(messageCount || 0) === 0;
}

export function shouldShowChatHeader({
  hasCanvasWidgets = false,
} = {}) {
  return Boolean(hasCanvasWidgets);
}
