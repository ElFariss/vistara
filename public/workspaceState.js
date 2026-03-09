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
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return null;
  }

  const meaningfulConversation = conversations.find((conversation) => {
    if (!conversation?.id) {
      return false;
    }

    const messageCount = Number(conversation.message_count || 0);
    if (messageCount > 0) {
      return true;
    }

    const preview = String(conversation.last_message_preview || '').trim();
    const role = String(conversation.last_message_role || '').trim();
    return preview.length > 0 || role.length > 0;
  });

  return meaningfulConversation?.id || null;
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
  persistedMessageCount = 0,
  hasConversationId = false,
  isLoadingConversation = false,
  hasPendingActivity = false,
  hasDraftAttachment = false,
} = {}) {
  if (Boolean(isLoadingConversation) || Boolean(hasPendingActivity) || Boolean(hasDraftAttachment)) {
    return false;
  }

  const visibleMessages = Number(messageCount || 0);
  const persistedMessages = Number(persistedMessageCount || 0);

  if (visibleMessages > 0 || persistedMessages > 0) {
    return false;
  }

  return !Boolean(hasConversationId) || persistedMessages === 0;
}

export function shouldShowChatHeader({
  hasCanvasWidgets = false,
} = {}) {
  return Boolean(hasCanvasWidgets);
}

export function shouldDockLandingFinalCta({
  landingVisible = false,
  scrollY = 0,
  viewportHeight = 0,
  documentHeight = 0,
  threshold = 24,
} = {}) {
  if (!landingVisible) {
    return false;
  }

  const bottomEdge = Number(scrollY || 0) + Number(viewportHeight || 0);
  const pageBottom = Math.max(0, Number(documentHeight || 0) - Math.max(0, Number(threshold || 0)));
  return bottomEdge >= pageBottom;
}

export function resolveDashboardResetState({
  preserveDashboard = false,
  currentDashboard = null,
  canvasWidgets = [],
  canvasPage = 1,
  canvasPagesCount = 1,
} = {}) {
  if (!preserveDashboard) {
    return {
      currentDashboard: null,
      canvasWidgets: [],
      canvasPage: 1,
      canvasPagesCount: 1,
    };
  }

  const widgets = Array.isArray(canvasWidgets) ? canvasWidgets : [];
  const maxWidgetPage = widgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
  const pagesCount = Math.max(1, Number(canvasPagesCount || 1), maxWidgetPage);
  const page = Math.min(Math.max(1, Number(canvasPage || 1)), pagesCount);

  return {
    currentDashboard,
    canvasWidgets: widgets,
    canvasPage: page,
    canvasPagesCount: pagesCount,
  };
}

export function resolveCanvasState({
  messageWidgets = [],
  dashboardWidgets = [],
  canvasPage = 1,
  canvasPagesCount = 1,
} = {}) {
  const preferredWidgets = Array.isArray(messageWidgets) && messageWidgets.length > 0
    ? messageWidgets
    : (Array.isArray(dashboardWidgets) ? dashboardWidgets : []);
  const maxWidgetPage = preferredWidgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
  const pagesCount = preferredWidgets.length > 0
    ? Math.max(1, Number(canvasPagesCount || 1), maxWidgetPage)
    : 1;

  return {
    canvasWidgets: preferredWidgets,
    canvasPagesCount: pagesCount,
    canvasPage: preferredWidgets.length > 0
      ? Math.min(Math.max(1, Number(canvasPage || 1)), pagesCount)
      : 1,
  };
}
