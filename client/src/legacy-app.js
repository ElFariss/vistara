import { renderArtifact } from '@/vendor/chart-lite.js';
import { createGridStackLite } from '@/vendor/gridstack-lite.js';
import { resolveCanvasViewportTarget } from '@/dashboard/canvasViewport.js';
import { shouldRetryNonStreamChatRequest } from '@/chat/chatRequestPolicy.js';
import { summarizeChartArtifactForExport } from '@/utils/exportSummary.js';
import { CHART_CATALOG, chartDefinition, chartIconSvg, SINGLE_VALUE_VISUALS } from '@/widgets/chartCatalog.js';
import {
  didDeleteActiveConversation,
  normalizeAppPath,
  normalizeSettingsSection,
  normalizeConversationTitle,
  pageFromPath,
  pathFromPage,
  resolveAccessiblePage,
  resolveCanvasState,
  resolveDashboardResetState,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
  shouldCenterComposer,
  shouldDockLandingFinalCta,
  shouldShowChatHeader,
} from '@/navigation/workspaceState.js';
import {
  normalizeDashboardLayout,
  packDashboardLayout,
  suggestDashboardLayout,
} from '@/dashboard/layout.js';

const GRID_COLS = 16;
const GRID_ROWS = 9;
const GRID_GAP = 10;
const MOBILE_BREAKPOINT = 768;
const MIN_CANVAS_PCT = 28;
const MAX_CANVAS_PCT = 92;
const DEFAULT_CANVAS_PCT = 58;
const STAGE_BASE_WIDTH = 1280;
const STAGE_BASE_HEIGHT = 720;
const MIN_STAGE_ZOOM = 0.5;
const MAX_STAGE_ZOOM = 1.75;
const ZOOM_STEP = 0.1;
const SETTINGS_STORAGE_KEY = 'vistara_settings';
const PRECHAT_ROTATE_MS = 5000;
const PRECHAT_FADE_MS = 320;

const runtimeConfig = window.__VISTARA_RUNTIME__ || {};
const API_BASE_URL = String(runtimeConfig.API_BASE_URL || '').trim().replace(/\/+$/, '');
const DEFAULT_API_TIMEOUT_MS = 30000;
const UPLOAD_API_TIMEOUT_MS = 180000;
const STREAM_API_TIMEOUT_MS = 0;

const DEFAULT_SETTINGS = {
  theme_mode: 'system',
  accent_color: 'orange',
  nickname: '',
  response_style: 'ringkas',
  assistant_character: 'proaktif',
  personalization_focus: '',
};

const ACCENT_PRESETS = {
  orange: {
    accent: '#f97316',
    hover: '#fb8a2c',
    light: '#fef0e4',
  },
  blue: {
    accent: '#2563eb',
    hover: '#3b82f6',
    light: '#dbeafe',
  },
  green: {
    accent: '#16a34a',
    hover: '#22c55e',
    light: '#dcfce7',
  },
  rose: {
    accent: '#e11d48',
    hover: '#f43f5e',
    light: '#ffe4e6',
  },
};

const state = {
  token: localStorage.getItem('umkm_token') || '',
  user: null,
  profile: null,
  conversationId: null,
  conversationTitle: 'Percakapan baru',
  conversationMessageCount: 0,
  conversations: [],
  messages: [],
  dashboards: [],
  selectedDashboardId: null,
  currentDashboard: null,
  draftDashboard: null,
  canvasWidgets: [],
  workspaceLoaded: false,
  isWorkspaceBooting: false,
  datasetReady: false,
  schema: null,
  datasetTables: [],
  grid: null,
  isDemoSession: false,
  canvasOpen: false,
  selectedWidgetId: null,
  editMode: false,
  pendingMessageId: null,
  timelineMessageId: null,
  timelineRunId: null,
  canvasPage: 1,
  canvasPagesCount: 1,
  canvasWidthPct: DEFAULT_CANVAS_PCT,
  isResizingPanels: false,
  stageZoom: 1,
  settings: { ...DEFAULT_SETTINGS },
  settingsGroup: 'user',
  settingsOpen: false,
  settingsReturnFocus: null,
  sessionRailCollapsed: true,
  openConversationMenuId: null,
  dataPaneCollapsed: true,
  configPaneCollapsed: true,
  widgetBuilderOpen: false,
  widgetBuilderStep: 'type',
  widgetBuilderSelection: {
    visualization: null,
    datasetId: null,
    axes: {},
  },
  widgetBuilderActiveAxis: null,
  preChatTickerIndex: 0,
  preChatTickerInterval: null,
  preChatTickerSwapTimer: null,
  preChatTickerKey: '',
  isProgrammaticGridUpdate: false,
  isRenderingCanvas: false,
  isCanvasPreparing: false,
  isLoadingConversation: false,
  isSendingMessage: false,
  isUploadingDataset: false,
  canvasViewportMovedByUser: false,
  canvasAutoCenteredRunId: null,
  draftSaveDirty: false,
  landingRevealObserver: null,
  onboardingSlideIndex: 0,
  currentPage: 'landing',
};

const refs = {
  appShell: document.querySelector('.app-shell'),
  appHeader: document.querySelector('.app-header'),
  headerLoginBtn: document.getElementById('headerLoginBtn'),
  headerCtaBtn: document.getElementById('headerCtaBtn'),
  brandHomeLink: document.getElementById('brandHomeLink'),
  headerSettingsBtn: document.getElementById('headerSettingsBtn'),
  editProfileBtn: document.getElementById('editProfileBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  themeToggle: document.getElementById('themeToggle'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsForm: document.getElementById('settingsForm'),
  settingsResetBtn: document.getElementById('settingsResetBtn'),
  settingsGroupTabs: document.getElementById('settingsGroupTabs'),
  settingsGroupUserBtn: document.getElementById('settingsGroupUserBtn'),
  settingsGroupAgentBtn: document.getElementById('settingsGroupAgentBtn'),
  settingsUserGroup: document.getElementById('settingsUserGroup'),
  settingsAgentGroup: document.getElementById('settingsAgentGroup'),
  settingsThemeMode: document.getElementById('settingsThemeMode'),
  settingsAccentColor: document.getElementById('settingsAccentColor'),
  settingsNickname: document.getElementById('settingsNickname'),
  settingsResponseStyle: document.getElementById('settingsResponseStyle'),
  settingsAssistantCharacter: document.getElementById('settingsAssistantCharacter'),
  settingsPersonalizationFocus: document.getElementById('settingsPersonalizationFocus'),
  settingsBusinessName: document.getElementById('settingsBusinessName'),
  settingsBusinessIndustry: document.getElementById('settingsBusinessIndustry'),
  settingsBusinessCity: document.getElementById('settingsBusinessCity'),
  settingsBusinessTimezone: document.getElementById('settingsBusinessTimezone'),
  settingsBusinessCurrency: document.getElementById('settingsBusinessCurrency'),
  settingsBusinessVerdictTime: document.getElementById('settingsBusinessVerdictTime'),

  landingPage: document.getElementById('landingPage'),
  authPage: document.getElementById('authPage'),
  contextPage: document.getElementById('contextPage'),
  workspacePage: document.getElementById('workspacePage'),

  landingWelcomeCta: document.getElementById('landingWelcomeCta'),
  landingWelcomeDemo: document.getElementById('landingWelcomeDemo'),
  landingCtaBottom: document.getElementById('landingCtaBottom'),
  landingTryNowBtn: document.getElementById('landingTryNowBtn'),
  landingFinalCta: document.getElementById('landingFinalCta'),
  landingScrollCue: document.getElementById('landingScrollCue'),
  landingHeroStart: document.getElementById('landingHeroStart'),

  authTabs: document.getElementById('authTabs'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginPasswordInput: document.getElementById('loginPasswordInput'),
  loginPasswordToggle: document.getElementById('loginPasswordToggle'),
  registerPasswordInput: document.getElementById('registerPasswordInput'),
  registerPasswordToggle: document.getElementById('registerPasswordToggle'),
  authOnboardingSlides: Array.from(document.querySelectorAll('[data-onboarding-slide]')),
  authOnboardingDots: Array.from(document.querySelectorAll('[data-onboarding-dot]')),
  contextForm: document.getElementById('contextForm'),
  workspaceLoading: document.getElementById('workspaceLoading'),
  workspaceLoadingText: document.getElementById('workspaceLoadingText'),

  sessionRail: document.getElementById('sessionRail'),
  sessionRailPeekBtn: document.getElementById('sessionRailPeekBtn'),
  sessionRailToggleBtn: document.getElementById('sessionRailToggleBtn'),
  sessionRailToggleLabel: document.getElementById('sessionRailToggleLabel'),
  sessionList: document.getElementById('sessionList'),
  dashboardList: document.getElementById('dashboardList'),
  dashboardVersionsBtn: document.getElementById('dashboardVersionsBtn'),
  newSessionBtn: document.getElementById('newSessionBtn'),

  chatPane: document.getElementById('chatPane'),
  chatPaneHead: document.getElementById('chatPaneHead'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  openCanvasBtn: document.getElementById('openCanvasBtn'),
  workspaceShell: document.querySelector('.workspace-shell'),
  panelDivider: document.getElementById('panelDivider'),
  canvasPane: document.getElementById('canvasPane'),
  canvasShell: document.querySelector('.canvas-shell'),
  canvasViewport: document.getElementById('canvasViewport'),
  canvasWorld: document.getElementById('canvasWorld'),
  canvasLoading: document.getElementById('canvasLoading'),

  dataGate: document.getElementById('dataGate'),
  gateUploadInput: document.getElementById('gateUploadInput'),
  gateUploadPickerBtn: document.getElementById('gateUploadPickerBtn'),
  gateUploadBtn: document.getElementById('gateUploadBtn'),
  gateUploadName: document.getElementById('gateUploadName'),
  gateDemoBtn: document.getElementById('gateDemoBtn'),

  chatMessages: document.getElementById('chatMessages'),
  preChatTicker: document.getElementById('preChatTicker'),
  typingIndicator: document.getElementById('typingIndicator'),
  quickPrompts: document.getElementById('quickPrompts'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  chatFile: document.getElementById('chatFile'),
  chatFileBtn: document.getElementById('chatFileBtn'),
  fileLabel: document.getElementById('fileLabel'),

  persistDraftBtn: document.getElementById('persistDraftBtn'),
  saveCanvasBtn: document.getElementById('saveCanvasBtn'),
  toggleDataPaneBtn: document.getElementById('toggleDataPaneBtn'),
  toggleConfigPaneBtn: document.getElementById('toggleConfigPaneBtn'),
  addWidgetToolbar: document.getElementById('addWidgetToolbar'),
  widgetBuilderBackdrop: document.getElementById('widgetBuilderBackdrop'),
  widgetBuilderModal: document.getElementById('widgetBuilderModal'),
  widgetBuilderCloseBtn: document.getElementById('widgetBuilderCloseBtn'),
  widgetBuilderTitle: document.getElementById('widgetBuilderTitle'),
  widgetBuilderStepType: document.getElementById('widgetBuilderStepType'),
  widgetBuilderStepConfig: document.getElementById('widgetBuilderStepConfig'),
  widgetTypeGrid: document.getElementById('widgetTypeGrid'),
  widgetAxisList: document.getElementById('widgetAxisList'),
  widgetAxisHint: document.getElementById('widgetAxisHint'),
  widgetDatasetTitle: document.getElementById('widgetDatasetTitle'),
  widgetDatasetMeta: document.getElementById('widgetDatasetMeta'),
  widgetDatasetList: document.getElementById('widgetDatasetList'),
  widgetDatasetPreview: document.getElementById('widgetDatasetPreview'),
  widgetBuilderBackBtn: document.getElementById('widgetBuilderBackBtn'),
  widgetBuilderNextBtn: document.getElementById('widgetBuilderNextBtn'),
  editModeBtn: document.getElementById('editModeBtn'),
  floatingAddBtn: document.getElementById('floatingAddBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  zoomLevelLabel: document.getElementById('zoomLevelLabel'),
  canvasStage: document.getElementById('canvasStage'),
  canvasPrevPage: document.getElementById('canvasPrevPage'),
  canvasNextPage: document.getElementById('canvasNextPage'),
  canvasAddPage: document.getElementById('canvasAddPage'),
  canvasDeletePage: document.getElementById('canvasDeletePage'),
  canvasPageIndicator: document.getElementById('canvasPageIndicator'),
  canvasDock: document.getElementById('canvasDock'),
  canvasGrid: document.getElementById('canvasGrid'),
  dataFields: document.getElementById('dataFields'),
  dataPane: document.getElementById('dataPane'),

  configForm: document.getElementById('configForm'),
  configEmpty: document.getElementById('configEmpty'),
  configDataset: document.getElementById('configDataset'),
  configMeasure: document.getElementById('configMeasure'),
  configGroupBy: document.getElementById('configGroupBy'),
  configVisualization: document.getElementById('configVisualization'),

  statusBar: document.getElementById('statusBar'),
  verdictBadge: document.getElementById('verdictBadge'),
  sourceStats: document.getElementById('sourceStats'),
  toast: document.getElementById('toast'),
};

function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}

function showToast(message, timeout = 3000) {
  if (!refs.toast) {
    return;
  }

  refs.toast.textContent = message;
  refs.toast.classList.remove('hidden');

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    if (refs.toast) {
      refs.toast.classList.add('hidden');
    }
  }, timeout);
}

function resolveThemeMode(mode = 'light') {
  if (mode === 'system' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

function syncBrowserThemeChrome(theme) {
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    return;
  }
  themeMeta.setAttribute('content', theme === 'dark' ? '#111315' : '#faf7f2');
}

function setTheme(mode) {
  const root = document.documentElement;
  const next = resolveThemeMode(mode || 'light');
  root.setAttribute('data-theme', next);
  syncBrowserThemeChrome(next);
  if (refs.themeToggle) {
    refs.themeToggle.dataset.theme = next;
    refs.themeToggle.setAttribute('aria-label', next === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    refs.themeToggle.setAttribute('title', next === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
  }
  document.dispatchEvent(new CustomEvent('vistara:theme-change', {
    detail: { theme: next },
  }));
}

function syncHeaderActions() {
  const workspaceVisible = state.currentPage === 'workspace';
  const authVisible = state.currentPage === 'auth';
  const showSettings = workspaceVisible && Boolean(state.token);
  const showThemeToggle = !workspaceVisible;
  const resolvedTheme = resolveThemeMode(state.settings.theme_mode);
  const showPublicCtas = !state.token && !authVisible;
  const showHeaderStartCta = showPublicCtas && state.currentPage !== 'landing';

  if (refs.headerSettingsBtn) {
    refs.headerSettingsBtn.hidden = !showSettings;
  }
  if (refs.headerLoginBtn) {
    refs.headerLoginBtn.hidden = !showPublicCtas;
  }
  if (refs.headerCtaBtn) {
    refs.headerCtaBtn.hidden = !showHeaderStartCta;
  }
  if (refs.themeToggle) {
    refs.themeToggle.hidden = !showThemeToggle;
    refs.themeToggle.setAttribute('aria-label', resolvedTheme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    refs.themeToggle.setAttribute('title', resolvedTheme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    refs.themeToggle.dataset.theme = resolvedTheme;
  }
}

function currentConversationMessageCount() {
  const visiblePersistedMessages = state.messages.filter((entry) => entry.mode !== 'timeline' && entry.mode !== 'pending').length;
  return Math.max(Number(state.conversationMessageCount || 0), visiblePersistedMessages);
}

function shouldUseCenteredComposerLayout() {
  return shouldCenterComposer({
    messageCount: state.messages.length,
    persistedMessageCount: currentConversationMessageCount(),
    hasConversationId: Boolean(state.conversationId),
    isLoadingConversation: state.isLoadingConversation,
    hasPendingActivity: state.isSendingMessage || state.isUploadingDataset,
    hasDraftAttachment: Boolean(refs.chatFile?.files?.[0]),
    hasDraftDashboard: Boolean(state.draftDashboard?.widgets?.length),
  });
}

function dashboardSummaryParagraphs(message = {}) {
  return String(message.content || '')
    .split(/\n{2,}/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function plainTextFromMarkdown(content = '') {
  return String(content || '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkdownBlocks(content = '') {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);

    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const type = unorderedMatch ? 'ul' : 'ol';
      const items = [];
      let cursor = index;
      while (cursor < lines.length) {
        const nextLine = lines[cursor].trim();
        const nextMatch = type === 'ul'
          ? nextLine.match(/^[-*+]\s+(.+)$/)
          : nextLine.match(/^\d+\.\s+(.+)$/);
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1].trim());
        cursor += 1;
      }
      blocks.push({ type, items });
      index = cursor - 1;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function appendInlineMarkdown(parent, content = '') {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  const text = String(content || '');

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, start)));
    }

    let node = null;
    if (token.startsWith('**') && token.endsWith('**')) {
      node = document.createElement('strong');
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      node = document.createElement('em');
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      node = document.createElement('code');
      node.textContent = token.slice(1, -1);
    }

    if (node) {
      parent.append(node);
    } else {
      parent.append(document.createTextNode(token));
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderMarkdownContent(container, content = '', options = {}) {
  const blocks = parseMarkdownBlocks(content);
  const className = options.className || '';
  if (className) {
    container.classList.add(className);
  }

  if (blocks.length === 0) {
    const fallback = document.createElement('p');
    fallback.textContent = String(content || '').trim();
    container.append(fallback);
    return;
  }

  blocks.forEach((block, index) => {
    if (block.type === 'paragraph') {
      const paragraph = document.createElement(index === 0 && options.firstParagraphAsSpan ? 'span' : 'p');
      appendInlineMarkdown(paragraph, block.text);
      container.append(paragraph);
      return;
    }

    const list = document.createElement(block.type === 'ol' ? 'ol' : 'ul');
    block.items.forEach((item) => {
      const li = document.createElement('li');
      appendInlineMarkdown(li, item);
      list.append(li);
    });
    container.append(list);
  });
}

function setAccent(accentKey = 'orange') {
  const preset = ACCENT_PRESETS[accentKey] || ACCENT_PRESETS.orange;
  const root = document.documentElement;
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-hover', preset.hover);
  root.style.setProperty('--accent-light', preset.light);
}

function normalizeSettings(input = {}) {
  return {
    theme_mode: ['light', 'dark', 'system'].includes(input.theme_mode) ? input.theme_mode : DEFAULT_SETTINGS.theme_mode,
    accent_color: ACCENT_PRESETS[input.accent_color] ? input.accent_color : DEFAULT_SETTINGS.accent_color,
    nickname: String(input.nickname || '').trim().slice(0, 40),
    response_style: ['ringkas', 'detail', 'formal', 'santai'].includes(input.response_style)
      ? input.response_style
      : DEFAULT_SETTINGS.response_style,
    assistant_character: ['proaktif', 'teliti', 'tegas', 'suportif'].includes(input.assistant_character)
      ? input.assistant_character
      : DEFAULT_SETTINGS.assistant_character,
    personalization_focus: String(input.personalization_focus || '').trim().slice(0, 220),
  };
}

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...JSON.parse(raw),
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function syncSettingsForm() {
  if (
    !refs.settingsForm
    || !refs.settingsThemeMode
    || !refs.settingsAccentColor
    || !refs.settingsNickname
    || !refs.settingsResponseStyle
    || !refs.settingsAssistantCharacter
    || !refs.settingsPersonalizationFocus
  ) {
    return;
  }
  refs.settingsThemeMode.value = state.settings.theme_mode;
  refs.settingsAccentColor.value = state.settings.accent_color;
  refs.settingsNickname.value = state.settings.nickname;
  refs.settingsResponseStyle.value = state.settings.response_style;
  refs.settingsAssistantCharacter.value = state.settings.assistant_character;
  refs.settingsPersonalizationFocus.value = state.settings.personalization_focus;
  syncBusinessSettingsFields();
  setSettingsGroup(state.settingsGroup);
}

function syncBusinessSettingsFields() {
  if (
    !refs.settingsBusinessName
    || !refs.settingsBusinessIndustry
    || !refs.settingsBusinessCity
    || !refs.settingsBusinessTimezone
    || !refs.settingsBusinessCurrency
    || !refs.settingsBusinessVerdictTime
  ) {
    return;
  }
  refs.settingsBusinessName.value = state.profile?.name || '';
  refs.settingsBusinessIndustry.value = state.profile?.industry || '';
  refs.settingsBusinessCity.value = state.profile?.city || '';
  refs.settingsBusinessTimezone.value = state.profile?.timezone || 'Asia/Jakarta';
  refs.settingsBusinessCurrency.value = state.profile?.currency || 'IDR';
  refs.settingsBusinessVerdictTime.value = state.profile?.morning_verdict_time || '07:00';
}

function applySettings(nextSettings, options = {}) {
  const persist = options.persist !== false;
  state.settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...state.settings,
    ...nextSettings,
  });

  setTheme(state.settings.theme_mode);
  setAccent(state.settings.accent_color);
  syncHeaderActions();
  syncSettingsForm();
  if (!refs.workspacePage?.classList.contains('hidden')) {
    renderThread();
    if (state.grid) {
      renderCanvas();
    }
  }

  if (persist) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
  }
}

function syncSettingsGroupUi() {
  const isUser = state.settingsGroup === 'user';
  refs.settingsGroupUserBtn?.classList.toggle('is-active', isUser);
  refs.settingsGroupUserBtn?.classList.toggle('active', isUser);
  refs.settingsGroupUserBtn?.setAttribute('aria-pressed', String(isUser));
  refs.settingsGroupUserBtn?.setAttribute('aria-selected', String(isUser));
  refs.settingsGroupAgentBtn?.classList.toggle('is-active', !isUser);
  refs.settingsGroupAgentBtn?.classList.toggle('active', !isUser);
  refs.settingsGroupAgentBtn?.setAttribute('aria-pressed', String(!isUser));
  refs.settingsGroupAgentBtn?.setAttribute('aria-selected', String(!isUser));
  refs.settingsUserGroup?.classList.toggle('hidden', !isUser);
  refs.settingsAgentGroup?.classList.toggle('hidden', isUser);
}

function setSettingsGroup(group = 'user') {
  state.settingsGroup = normalizeSettingsSection(group);
  syncSettingsGroupUi();
}

function syncBrowserRoute(page, options = {}) {
  const targetPath = pathFromPage(page);
  if (!window.history || normalizeAppPath(window.location.pathname) === targetPath) {
    return;
  }
  const method = options.replace ? 'replaceState' : 'pushState';
  window.history[method]({ page }, '', targetPath);
}

function setSettingsOpen(open, options = {}) {
  state.settingsOpen = Boolean(open);
  if (state.settingsOpen) {
    setSettingsGroup(options.group || state.settingsGroup || 'user');
    state.settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  document.body.classList.toggle('settings-open', state.settingsOpen);
  refs.settingsBackdrop?.classList.toggle('hidden', !state.settingsOpen);
  refs.settingsPanel?.classList.toggle('hidden', !state.settingsOpen);
  if (refs.appShell) {
    if ('inert' in refs.appShell) {
      refs.appShell.inert = state.settingsOpen;
    }
    refs.appShell.setAttribute('aria-hidden', String(state.settingsOpen));
  }
  if (state.settingsOpen) {
    refs.settingsPanel?.focus();
  } else if (state.settingsReturnFocus && typeof state.settingsReturnFocus.focus === 'function') {
    state.settingsReturnFocus.focus();
    state.settingsReturnFocus = null;
  }
}

function setWorkspaceBooting(booting, options = {}) {
  state.isWorkspaceBooting = Boolean(booting);
  const message = String(options.message || '').trim();

  refs.workspacePage?.classList.toggle('workspace-page-loading', state.isWorkspaceBooting);
  refs.workspaceLoading?.classList.toggle('hidden', !state.isWorkspaceBooting);
  refs.workspacePage?.setAttribute('aria-busy', String(state.isWorkspaceBooting));
  if (refs.workspaceShell) {
    if ('inert' in refs.workspaceShell) {
      refs.workspaceShell.inert = state.isWorkspaceBooting;
    }
    refs.workspaceShell.setAttribute('aria-hidden', String(state.isWorkspaceBooting));
  }

  if (refs.workspaceLoadingText && message) {
    refs.workspaceLoadingText.textContent = message;
  }
}

function syncComposerChrome() {
  const centeredComposer = shouldUseCenteredComposerLayout();
  refs.chatPane?.classList.toggle('is-empty-thread', centeredComposer);
  updatePreChatTicker();
  updateQuickPromptsVisibility();
  updateChatHeader();
}

function getPreChatTickerMessages() {
  const nickname = state.settings.nickname || 'Anda';
  return [
    `Halo ${nickname}, ada yang bisa dibantu?`,
    'Upload dataset Anda untuk memulai.',
    'Tanya insight bisnis Anda hari ini.',
  ];
}

function stopPreChatTicker() {
  if (state.preChatTickerInterval) {
    window.clearInterval(state.preChatTickerInterval);
    state.preChatTickerInterval = null;
  }
  if (state.preChatTickerSwapTimer) {
    window.clearTimeout(state.preChatTickerSwapTimer);
    state.preChatTickerSwapTimer = null;
  }
}

function rotatePreChatTicker() {
  if (!refs.preChatTicker || refs.preChatTicker.classList.contains('hidden')) {
    return;
  }
  const messages = getPreChatTickerMessages();
  if (!messages.length) {
    return;
  }
  state.preChatTickerIndex = (state.preChatTickerIndex + 1) % messages.length;
  refs.preChatTicker.classList.add('is-fading');
  if (state.preChatTickerSwapTimer) {
    window.clearTimeout(state.preChatTickerSwapTimer);
  }
  state.preChatTickerSwapTimer = window.setTimeout(() => {
    refs.preChatTicker.textContent = messages[state.preChatTickerIndex];
    refs.preChatTicker.classList.remove('is-fading');
  }, PRECHAT_FADE_MS);
}

function updatePreChatTicker() {
  if (!refs.preChatTicker) {
    return;
  }

  const shouldShow = Boolean(state.token)
    && Boolean(state.conversationId)
    && currentConversationMessageCount() === 0
    && state.conversations.length > 0
    && !shouldUseCenteredComposerLayout();

  if (!shouldShow) {
    stopPreChatTicker();
    refs.preChatTicker.classList.add('hidden');
    refs.preChatTicker.classList.remove('is-fading');
    return;
  }

  const messages = getPreChatTickerMessages();
  const messageKey = messages.join('|');
  const shouldReset = state.preChatTickerKey !== messageKey;
  state.preChatTickerKey = messageKey;

  if (shouldReset) {
    state.preChatTickerIndex = 0;
  }

  refs.preChatTicker.classList.remove('hidden');
  refs.preChatTicker.textContent = messages[state.preChatTickerIndex] || messages[0];

  if (!state.preChatTickerInterval) {
    state.preChatTickerInterval = window.setInterval(() => {
      rotatePreChatTicker();
    }, PRECHAT_ROTATE_MS);
  }
}

function updateQuickPromptsVisibility() {
  if (!refs.quickPrompts) {
    return;
  }
  const workspaceVisible = Boolean(refs.workspacePage) && !refs.workspacePage.classList.contains('hidden');
  const shouldShow = workspaceVisible
    && shouldUseCenteredComposerLayout()
    && Boolean(state.token)
    && Boolean(state.datasetReady);
  refs.quickPrompts.classList.toggle('hidden', !shouldShow);
}

function toggleTheme() {
  const current = resolveThemeMode(state.settings.theme_mode);
  const nextTheme = current === 'dark' ? 'light' : 'dark';
  applySettings({ ...state.settings, theme_mode: nextTheme });
}

function isNetworkLikeError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('networkerror')
    || message.includes('failed to fetch')
    || message.includes('fetch resource')
    || message.includes('network request failed')
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url, options = {}, config = {}) {
  const retries = Number.isFinite(Number(config.retries)) ? Number(config.retries) : 2;
  const baseDelay = Number.isFinite(Number(config.baseDelayMs)) ? Number(config.baseDelayMs) : 450;
  const timeoutMs = Number.isFinite(Number(config.timeoutMs)) ? Number(config.timeoutMs) : 30000;
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      let controller = null;
      let timeoutId = null;
      let signal = options.signal;
      if (timeoutMs > 0) {
        controller = new AbortController();
        if (signal && typeof signal.addEventListener === 'function') {
          if (signal.aborted) {
            controller.abort(signal.reason);
          } else {
            signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
          }
        }
        signal = controller.signal;
        timeoutId = window.setTimeout(() => controller.abort('timeout'), timeoutMs);
      }

      try {
        return await fetch(url, {
          ...options,
          signal,
        });
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      lastError = error;
      if (!isNetworkLikeError(error) || attempt >= retries) {
        throw error;
      }
      await wait(baseDelay * (attempt + 1));
      attempt += 1;
    }
  }

  throw lastError || new Error('Network request failed');
}

function createAppError(message, options = {}) {
  const error = new Error(message || 'Request gagal');
  if (options.code) {
    error.code = options.code;
  }
  if (options.statusCode || options.status) {
    error.statusCode = Number(options.statusCode || options.status);
  }
  if (options.details !== undefined) {
    error.details = options.details;
  }
  if (options.conversationId) {
    error.conversationId = options.conversationId;
  }
  if (options.persistedInConversation !== undefined) {
    error.persistedInConversation = Boolean(options.persistedInConversation);
  }
  return error;
}

async function api(path, options = {}) {
  const requestUrl = /^https?:\/\//i.test(path)
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_API_TIMEOUT_MS;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  let response;
  try {
    response = await fetchWithRetry(requestUrl, {
      ...options,
      headers,
    }, {
      retries: 2,
      baseDelayMs: 550,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('timeout')) {
      throw createAppError('Permintaan melebihi batas waktu. Coba lagi.', {
        code: 'REQUEST_TIMEOUT',
      });
    }
    throw error;
  }

  if (response.status === 204) {
    return { ok: true };
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw createAppError(payload?.error?.message || response.statusText || 'Request gagal', {
      code: payload?.error?.code || null,
      statusCode: payload?.error?.status || response.status,
      details: payload?.error?.details ?? null,
      conversationId: payload?.conversation_id || null,
      persistedInConversation:
        payload?.error?.persisted_in_conversation
        ?? payload?.error?.persistedInConversation
        ?? false,
    });
  }

  return payload;
}

async function apiBlob(path, options = {}) {
  const requestUrl = /^https?:\/\//i.test(path)
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : DEFAULT_API_TIMEOUT_MS;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  let response;
  try {
    response = await fetchWithRetry(requestUrl, {
      ...options,
      headers,
    }, {
      retries: 2,
      baseDelayMs: 550,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('timeout')) {
      throw createAppError('Permintaan melebihi batas waktu. Coba lagi.', {
        code: 'REQUEST_TIMEOUT',
      });
    }
    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    throw createAppError(payload?.error?.message || response.statusText || 'Request gagal', {
      code: payload?.error?.code || null,
      statusCode: payload?.error?.status || response.status,
      details: payload?.error?.details ?? null,
    });
  }

  return response.blob();
}

function setAuth(token, user = null, options = {}) {
  const persist = options.persist !== false;
  const isDemo = Boolean(options.isDemo);

  state.token = token || '';
  state.user = user;
  state.isDemoSession = state.token ? isDemo : false;
  document.body.classList.toggle('is-authenticated', Boolean(state.token));

  if (state.token) {
    if (persist) {
      localStorage.setItem('umkm_token', state.token);
    } else {
      localStorage.removeItem('umkm_token');
    }
    if (refs.logoutBtn) refs.logoutBtn.hidden = false;
    if (refs.editProfileBtn) refs.editProfileBtn.hidden = true;
    if (refs.headerSettingsBtn) refs.headerSettingsBtn.hidden = false;
    if (refs.headerLoginBtn) refs.headerLoginBtn.hidden = true;
    if (refs.headerCtaBtn) refs.headerCtaBtn.hidden = true;
  } else {
    localStorage.removeItem('umkm_token');
    if (refs.logoutBtn) refs.logoutBtn.hidden = true;
    if (refs.editProfileBtn) refs.editProfileBtn.hidden = true;
    if (refs.headerSettingsBtn) refs.headerSettingsBtn.hidden = true;
    if (refs.headerLoginBtn) refs.headerLoginBtn.hidden = false;
    if (refs.headerCtaBtn) refs.headerCtaBtn.hidden = false;
  }

  syncHeaderActions();
  syncAppHeaderOffset();
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateWidgetId() {
  return `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function isMobileViewport() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function getCanvasRowHeight() {
  const fallback = isMobileViewport() ? 56 : 62;
  if (!refs.canvasStage || !refs.canvasGrid) {
    return fallback;
  }

  const stageRect = refs.canvasStage.getBoundingClientRect();
  if (!Number.isFinite(stageRect.height) || stageRect.height < 260) {
    return fallback;
  }

  const style = window.getComputedStyle(refs.canvasGrid);
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const padBottom = Number.parseFloat(style.paddingBottom) || 0;
  const innerHeight = Math.max(240, stageRect.height - padTop - padBottom);
  const next = Math.floor((innerHeight - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS);
  return Math.max(40, next);
}

function normalizeLayout(layout = {}, fallbackPage = 1, kind = 'chart') {
  return normalizeDashboardLayout(layout, {
    page: fallbackPage,
    kind,
  });
}

function normalizeTimelineTitle(title = '') {
  const value = String(title || '').trim();
  if (!value || /^agentic thinking$/i.test(value)) {
    return 'Proses analisis';
  }
  return value;
}

function summarizeDashboardText(content = '') {
  const value = plainTextFromMarkdown(content || '');
  if (!value) {
    return 'Ringkasan dashboard siap dibuka di panel kanan.';
  }

  const firstSentence = value.match(/.+?[.!?](?:\s|$)/)?.[0]?.trim() || value;
  if (firstSentence.length <= 148) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 145).trimEnd()}...`;
}

function isContextComplete(profile) {
  return Boolean(profile?.name && profile?.industry && profile?.city);
}

function initLandingReveal() {
  const nodes = Array.from(document.querySelectorAll('.landing-page .reveal-on-scroll'));
  if (nodes.length === 0) {
    return;
  }

  if (state.landingRevealObserver) {
    state.landingRevealObserver.disconnect();
    state.landingRevealObserver = null;
  }

  if (typeof window.IntersectionObserver !== 'function') {
    nodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, {
    root: null,
    threshold: 0.16,
    rootMargin: '0px 0px -10% 0px',
  });

  nodes.forEach((node, index) => {
    node.style.transitionDelay = `${Math.min(index * 55, 240)}ms`;
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.96) {
      node.classList.add('is-visible');
      return;
    }
    observer.observe(node);
  });
  state.landingRevealObserver = observer;
}

function syncLandingScrollCue() {
  const landingVisible = refs.landingPage && !refs.landingPage.classList.contains('hidden');
  if (refs.landingScrollCue) {
    const hide = !landingVisible || window.scrollY > 40;
    refs.landingScrollCue.classList.toggle('is-hidden', hide);
  }
  if (refs.landingFinalCta) {
    const showFinalCta = shouldDockLandingFinalCta({
      landingVisible,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement?.scrollHeight || document.body?.scrollHeight || 0,
    });
    refs.landingFinalCta.classList.toggle('is-visible', showFinalCta);
  }
}

function syncAppHeaderOffset() {
  const headerHeight = refs.appHeader?.offsetHeight || 0;
  document.documentElement.style.setProperty('--app-header-height', `${headerHeight}px`);
}

function routePrimaryEntry(options = {}) {
  if (state.token) {
    void handleRouteNavigation(pathFromPage('workspace'), {
      replace: options.replace !== false,
    });
    return;
  }

  showPage('auth', {
    replace: options.replace !== false,
    scrollTop: true,
  });
  switchAuthTab(options.authTab || 'register');
  setOnboardingSlide(0);
}

function setSessionRailCollapsed(collapsed) {
  state.sessionRailCollapsed = Boolean(collapsed);
  refs.sessionRail?.classList.toggle('collapsed', state.sessionRailCollapsed);
  refs.sessionRail?.setAttribute('aria-hidden', String(state.sessionRailCollapsed));
  if (refs.sessionRail && 'inert' in refs.sessionRail) {
    refs.sessionRail.inert = state.sessionRailCollapsed;
  }
  refs.workspaceShell?.classList.toggle('session-rail-collapsed', state.sessionRailCollapsed);
  refs.sessionRailPeekBtn?.classList.toggle('is-active', !state.sessionRailCollapsed);
  refs.sessionRailPeekBtn?.setAttribute('aria-expanded', String(!state.sessionRailCollapsed));
  refs.sessionRailPeekBtn?.setAttribute('title', state.sessionRailCollapsed ? 'Buka riwayat' : 'Tutup riwayat');
  if (refs.sessionRailToggleBtn) {
    refs.sessionRailToggleBtn.setAttribute('aria-expanded', String(!state.sessionRailCollapsed));
    refs.sessionRailToggleBtn.setAttribute('title', state.sessionRailCollapsed ? 'Buka riwayat' : 'Ciutkan riwayat');
  }
  if (state.sessionRailCollapsed) {
    const hadOpenMenu = Boolean(state.openConversationMenuId);
    state.openConversationMenuId = null;
    if (hadOpenMenu) {
      renderConversationList();
    }
  }
}

function showPage(page, options = {}) {
  if (state.settingsOpen && options.keepSettingsOpen !== true) {
    setSettingsOpen(false);
  }
  refs.landingPage.classList.add('hidden');
  refs.authPage.classList.add('hidden');
  refs.contextPage.classList.add('hidden');
  refs.workspacePage.classList.add('hidden');
  refs.statusBar?.classList.add('hidden');
  if (refs.appShell) {
    refs.appShell.classList.remove('workspace-active');
  }
  syncAppHeaderOffset();
  document.body.classList.remove('workspace-mode');
  state.currentPage = page;
  syncHeaderActions();
  syncBrowserRoute(page, {
    replace: options.replace === true,
  });
  if (page !== 'workspace') {
    setSessionRailCollapsed(true);
  }

  if (page === 'landing') {
    refs.landingPage.classList.remove('hidden');
    initLandingReveal();
    syncLandingScrollCue();
    if (options.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: options.smooth ? 'smooth' : 'auto' });
    }
    return;
  }

  if (page === 'auth') {
    refs.authPage.classList.remove('hidden');
    setSettingsOpen(false);
    if (options.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: options.smooth ? 'smooth' : 'auto' });
    }
    return;
  }

  if (page === 'context') {
    refs.contextPage.classList.remove('hidden');
    setSettingsOpen(false);
    if (options.scrollTop !== false) {
      window.scrollTo({ top: 0, behavior: options.smooth ? 'smooth' : 'auto' });
    }
    return;
  }

  refs.workspacePage.classList.remove('hidden');
  refs.statusBar?.classList.remove('hidden');
  if (refs.appShell) {
    refs.appShell.classList.add('workspace-active');
  }
  document.body.classList.add('workspace-mode');
  if (!state.workspaceLoaded) {
    setWorkspaceBooting(true);
  }
  syncAppHeaderOffset();
  syncLandingScrollCue();
}

async function ensureWorkspaceLoaded(options = {}) {
  if (state.workspaceLoaded && !options.force) {
    return;
  }
  setWorkspaceBooting(true, {
    message: options.message || 'Kami memuat percakapan, dataset, dan dashboard terlebih dulu supaya tampilan tidak muncul setengah jadi.',
  });
  try {
    await loadWorkspace();
    state.workspaceLoaded = true;
  } finally {
    setWorkspaceBooting(false);
  }
}

function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tab);
  });

  refs.loginForm.classList.toggle('hidden', tab !== 'login');
  refs.registerForm.classList.toggle('hidden', tab !== 'register');
}

function togglePasswordVisibility(input, toggle) {
  if (!input || !toggle) {
    return;
  }

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  toggle.textContent = showing ? 'Tampilkan' : 'Sembunyikan';
  toggle.setAttribute('aria-label', showing ? 'Tampilkan password' : 'Sembunyikan password');
  toggle.setAttribute('aria-pressed', String(!showing));
}

function setOnboardingSlide(index = 0) {
  const total = refs.authOnboardingSlides.length;
  if (!total) {
    return;
  }

  const nextIndex = ((Number(index) % total) + total) % total;
  state.onboardingSlideIndex = nextIndex;

  refs.authOnboardingSlides.forEach((slide, slideIndex) => {
    const isActive = slideIndex === nextIndex;
    slide.hidden = !isActive;
    slide.classList.toggle('is-active', isActive);
  });

  refs.authOnboardingDots.forEach((dot, dotIndex) => {
    dot.classList.toggle('is-active', dotIndex === nextIndex);
    dot.setAttribute('aria-pressed', String(dotIndex === nextIndex));
  });
}

function setCanvasOpen(open) {
  state.canvasOpen = Boolean(open);
  if (!refs.workspacePage) return;

  refs.workspacePage.classList.toggle('canvas-open', state.canvasOpen);
  refs.canvasPane.classList.toggle('hidden', false);
  refs.chatPane.classList.toggle('hidden', false);
  applyWorkspaceSplitState();

  if (state.canvasOpen && window.innerWidth <= 1180) {
    document.body.classList.add('canvas-overlay-open');
  } else {
    document.body.classList.remove('canvas-overlay-open');
  }

  if (state.canvasOpen && state.grid) {
    autoFitStageZoom();
    syncGridBounds();
    queueCanvasStageCenter();
    queueCanvasArtifactRefresh();
  }

  updateChatHeader();
}

function setCanvasPreparing(preparing, options = {}) {
  state.isCanvasPreparing = Boolean(preparing);
  refs.canvasPane?.classList.toggle('canvas-preparing', state.isCanvasPreparing);
  refs.canvasLoading?.classList.toggle('hidden', !state.isCanvasPreparing);
  refs.canvasPane?.setAttribute('aria-busy', String(state.isCanvasPreparing));
  if (refs.canvasViewport && 'inert' in refs.canvasViewport) {
    refs.canvasViewport.inert = state.isCanvasPreparing;
  }
  if (refs.canvasDock && 'inert' in refs.canvasDock) {
    refs.canvasDock.inert = state.isCanvasPreparing;
  }
  if (refs.canvasPageIndicator && 'inert' in refs.canvasPageIndicator) {
    refs.canvasPageIndicator.inert = state.isCanvasPreparing;
  }
  if (refs.canvasLoading && options.message) {
    const text = refs.canvasLoading.querySelector('[data-canvas-loading-text]');
    if (text) {
      text.textContent = options.message;
    }
  }
}

function setCanvasWidthPct(nextPct, options = {}) {
  const clamped = Math.max(MIN_CANVAS_PCT, Math.min(MAX_CANVAS_PCT, Number(nextPct || DEFAULT_CANVAS_PCT)));
  state.canvasWidthPct = clamped;
  if (refs.workspacePage) {
    const baseWidth = refs.workspaceShell?.clientWidth || window.innerWidth || 1440;
    const panePx = Math.round((baseWidth * clamped) / 100);
    refs.workspacePage.style.setProperty('--canvas-pane-width', `${clamped}%`);
    refs.workspacePage.style.setProperty('--canvas-pane-width-px', `${panePx}px`);
  }

  const shouldAutoCollapseSidebars = clamped >= 84;
  if (options.autoCollapse !== false && shouldAutoCollapseSidebars) {
    state.dataPaneCollapsed = true;
    state.configPaneCollapsed = true;
  }
  if (options.autoCollapse !== false && !shouldAutoCollapseSidebars && options.restore !== false) {
    state.dataPaneCollapsed = false;
    state.configPaneCollapsed = false;
  }
  updateCanvasPaneState();
}

function applyWorkspaceSplitState() {
  if (!refs.workspacePage) return;
  refs.workspacePage.classList.toggle('canvas-open', state.canvasOpen);
  if (refs.panelDivider) {
    refs.panelDivider.classList.toggle('hidden', !state.canvasOpen || window.innerWidth <= 1180);
  }
  setCanvasWidthPct(state.canvasWidthPct, {
    autoCollapse: state.canvasOpen,
    restore: false,
  });
}

function bindPanelDivider() {
  if (!refs.panelDivider || refs.panelDivider.dataset.bound) {
    return;
  }
  refs.panelDivider.dataset.bound = 'true';

  let isDragging = false;

  const onMove = (clientX) => {
    if (!state.canvasOpen || !refs.workspaceShell) {
      return;
    }
    const rect = refs.workspaceShell.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    const relativeX = clientX - rect.left;
    const canvasPct = ((rect.width - relativeX) / rect.width) * 100;
    setCanvasWidthPct(canvasPct, { autoCollapse: true, restore: false });
    syncGridBounds();
  };

  refs.panelDivider.addEventListener('pointerdown', (event) => {
    if (!state.canvasOpen || window.innerWidth <= 1180) {
      return;
    }
    isDragging = true;
    state.isResizingPanels = true;
    refs.workspaceShell?.classList.add('is-resizing');
    refs.panelDivider.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  refs.panelDivider.addEventListener('pointermove', (event) => {
    if (!isDragging) {
      return;
    }
    onMove(event.clientX);
  });

  const stopDrag = () => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    state.isResizingPanels = false;
    refs.workspaceShell?.classList.remove('is-resizing');
  };

  refs.panelDivider.addEventListener('pointerup', stopDrag);
  refs.panelDivider.addEventListener('pointercancel', stopDrag);

  refs.panelDivider.addEventListener('keydown', (event) => {
    if (!state.canvasOpen || window.innerWidth <= 1180) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setCanvasWidthPct(state.canvasWidthPct + 4, { autoCollapse: true, restore: false });
      syncGridBounds();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setCanvasWidthPct(state.canvasWidthPct - 4, { autoCollapse: true, restore: false });
      syncGridBounds();
    }
  });
}

function updateCanvasPaneState() {
  if (!refs.canvasShell) return;

  refs.canvasShell.classList.toggle('data-collapsed', state.dataPaneCollapsed);
  refs.canvasShell.classList.toggle('config-collapsed', state.configPaneCollapsed);

  if (refs.toggleDataPaneBtn) {
    refs.toggleDataPaneBtn.setAttribute('aria-expanded', String(!state.dataPaneCollapsed));
    refs.toggleDataPaneBtn.classList.toggle('is-active', !state.dataPaneCollapsed);
    refs.toggleDataPaneBtn.setAttribute('title', state.dataPaneCollapsed ? 'Buka Field Data' : 'Tutup Field Data');
    refs.toggleDataPaneBtn.setAttribute('data-tip', state.dataPaneCollapsed ? 'Buka Field Data' : 'Tutup Field Data');
    refs.toggleDataPaneBtn.setAttribute('aria-label', state.dataPaneCollapsed ? 'Buka Field Data' : 'Tutup Field Data');
  }

  if (refs.toggleConfigPaneBtn) {
    refs.toggleConfigPaneBtn.setAttribute('aria-expanded', String(!state.configPaneCollapsed));
    refs.toggleConfigPaneBtn.classList.toggle('is-active', !state.configPaneCollapsed);
    refs.toggleConfigPaneBtn.setAttribute('title', state.configPaneCollapsed ? 'Buka Panel Konfigurasi' : 'Tutup Panel Konfigurasi');
    refs.toggleConfigPaneBtn.setAttribute('data-tip', state.configPaneCollapsed ? 'Buka Panel Konfigurasi' : 'Tutup Panel Konfigurasi');
    refs.toggleConfigPaneBtn.setAttribute('aria-label', state.configPaneCollapsed ? 'Buka Panel Konfigurasi' : 'Tutup Panel Konfigurasi');
  }
  bindHintTooltips();
}

function setDataPaneCollapsed(collapsed) {
  state.dataPaneCollapsed = Boolean(collapsed);
  updateCanvasPaneState();
  syncGridBounds();
  queueCanvasStageCenter();
  queueCanvasArtifactRefresh();
}

function setConfigPaneCollapsed(collapsed) {
  state.configPaneCollapsed = Boolean(collapsed);
  updateCanvasPaneState();
  syncGridBounds();
  queueCanvasStageCenter();
  queueCanvasArtifactRefresh();
}

function bindCanvasViewportPan() {
  if (!refs.canvasViewport || refs.canvasViewport.dataset.panBound) {
    return;
  }
  refs.canvasViewport.dataset.panBound = 'true';

  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  refs.canvasViewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('.grid-widget')) {
      return;
    }
    isPanning = true;
    state.canvasViewportMovedByUser = true;
    window.clearTimeout(canvasStageCenterTimer);
    refs.canvasViewport.classList.add('is-panning');
    startX = event.clientX;
    startY = event.clientY;
    startLeft = refs.canvasViewport.scrollLeft;
    startTop = refs.canvasViewport.scrollTop;
    refs.canvasViewport.setPointerCapture(event.pointerId);
  });

  refs.canvasViewport.addEventListener('pointermove', (event) => {
    if (!isPanning) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    refs.canvasViewport.scrollLeft = startLeft - dx;
    refs.canvasViewport.scrollTop = startTop - dy;
  });

  const stopPan = () => {
    if (!isPanning) {
      return;
    }
    isPanning = false;
    refs.canvasViewport.classList.remove('is-panning');
  };

  refs.canvasViewport.addEventListener('pointerup', stopPan);
  refs.canvasViewport.addEventListener('pointercancel', stopPan);
  refs.canvasViewport.addEventListener('pointerleave', stopPan);

  refs.canvasViewport.addEventListener('wheel', (event) => {
    if (!refs.canvasStage) {
      return;
    }
    if (!(event.ctrlKey || event.metaKey || event.altKey)) {
      return;
    }
    event.preventDefault();
    state.canvasViewportMovedByUser = true;
    window.clearTimeout(canvasStageCenterTimer);
    const direction = event.deltaY > 0 ? -1 : 1;
    setStageZoom(state.stageZoom + direction * ZOOM_STEP, {
      anchorX: event.clientX,
      anchorY: event.clientY,
    });
  }, { passive: false });
}

function syncStageZoomLabel() {
  if (!refs.zoomLevelLabel) {
    return;
  }
  refs.zoomLevelLabel.textContent = `${Math.round(state.stageZoom * 100)}%`;
}

function autoFitStageZoom() {
  if (!refs.canvasViewport) {
    applyStageDimensions();
    return;
  }

  const vpWidth = refs.canvasViewport.clientWidth;
  const vpHeight = refs.canvasViewport.clientHeight;

  if (!vpWidth || !vpHeight) {
    applyStageDimensions();
    return;
  }

  const padFactor = 0.92;
  const fitZoom = Math.min(
    (vpWidth * padFactor) / STAGE_BASE_WIDTH,
    (vpHeight * padFactor) / STAGE_BASE_HEIGHT,
  );
  const clamped = Math.max(MIN_STAGE_ZOOM, Math.min(MAX_STAGE_ZOOM, fitZoom));
  state.stageZoom = clamped;
  applyStageDimensions();
}

function applyStageDimensions() {
  if (!refs.canvasStage || !refs.canvasWorld || !refs.canvasViewport) {
    return;
  }

  const width = Math.round(STAGE_BASE_WIDTH * state.stageZoom);
  const height = Math.round(STAGE_BASE_HEIGHT * state.stageZoom);
  const viewportPadX = Math.round((refs.canvasViewport?.clientWidth || 0) * 0.5);
  const viewportPadY = Math.round((refs.canvasViewport?.clientHeight || 0) * 0.5);
  const worldPad = Math.max(220, viewportPadX, viewportPadY, Math.round(Math.min(width, height) * 0.35));

  refs.canvasStage.style.width = `${width}px`;
  refs.canvasStage.style.height = `${height}px`;
  refs.canvasWorld.style.width = `${width + worldPad * 2}px`;
  refs.canvasWorld.style.height = `${height + worldPad * 2}px`;
  refs.canvasStage.style.left = `${worldPad}px`;
  refs.canvasStage.style.top = `${worldPad}px`;
  refs.canvasGrid.style.backgroundSize = `${Math.max(16, width / GRID_COLS)}px ${Math.max(16, height / GRID_ROWS)}px`;
  syncStageZoomLabel();
}

let canvasStageCenterTimer = null;
let canvasStageCenterFollowupTimer = null;
let canvasArtifactRefreshTimer = null;

function clearQueuedCanvasCenter() {
  window.clearTimeout(canvasStageCenterTimer);
  window.clearTimeout(canvasStageCenterFollowupTimer);
  canvasStageCenterTimer = null;
  canvasStageCenterFollowupTimer = null;
}

function layoutFocusRectForCurrentPage(stageRect) {
  const widgets = pageWidgets();
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return null;
  }

  const colWidth = stageRect.width / GRID_COLS;
  const rowHeight = stageRect.height / GRID_ROWS;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  widgets.forEach((widget) => {
    const layout = widget?.layout || null;
    if (!layout) {
      return;
    }
    left = Math.min(left, stageRect.left + Number(layout.x || 0) * colWidth);
    top = Math.min(top, stageRect.top + Number(layout.y || 0) * rowHeight);
    right = Math.max(right, stageRect.left + (Number(layout.x || 0) + Number(layout.w || 4)) * colWidth);
    bottom = Math.max(bottom, stageRect.top + (Number(layout.y || 0) + Number(layout.h || 2)) * rowHeight);
  });

  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null;
  }

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function centerCanvasStage(options = {}) {
  if (!refs.canvasViewport || !refs.canvasWorld || !refs.canvasStage) {
    return;
  }
  if (state.canvasViewportMovedByUser && !options.force) {
    return;
  }

  const worldRect = refs.canvasWorld.getBoundingClientRect();
  const viewportScrollLeft = refs.canvasViewport.scrollLeft;
  const viewportScrollTop = refs.canvasViewport.scrollTop;
  const stageRect = {
    left: refs.canvasStage.offsetLeft,
    top: refs.canvasStage.offsetTop,
    width: refs.canvasStage.clientWidth,
    height: refs.canvasStage.clientHeight,
  };

  let focusRect = layoutFocusRectForCurrentPage(stageRect);
  const widgetShells = Array.from(refs.canvasGrid?.querySelectorAll('.widget-shell') || []);
  if (!focusRect && widgetShells.length > 0) {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    widgetShells.forEach((shell) => {
      const rect = shell.getBoundingClientRect();
      left = Math.min(left, rect.left - worldRect.left + viewportScrollLeft);
      top = Math.min(top, rect.top - worldRect.top + viewportScrollTop);
      right = Math.max(right, rect.right - worldRect.left + viewportScrollLeft);
      bottom = Math.max(bottom, rect.bottom - worldRect.top + viewportScrollTop);
    });

    if (Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom)) {
      focusRect = {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    }
  }

  const target = resolveCanvasViewportTarget({
    stageRect,
    viewportRect: {
      width: refs.canvasViewport.clientWidth,
      height: refs.canvasViewport.clientHeight,
    },
    focusRect,
  });

  refs.canvasViewport.scrollTo(target.scrollLeft, target.scrollTop);
}

function queueCanvasStageCenter(options = {}) {
  clearQueuedCanvasCenter();
  canvasStageCenterTimer = window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      centerCanvasStage(options);
      canvasStageCenterFollowupTimer = window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          centerCanvasStage(options);
        });
      }, 180);
    });
  }, 50);
}

function queueCanvasArtifactRefresh() {
  window.clearTimeout(canvasArtifactRefreshTimer);
  canvasArtifactRefreshTimer = window.setTimeout(() => {
    document.querySelectorAll('.artifact-chart-canvas').forEach((canvas) => {
      const resize = () => {
        const chart = window.Chart?.getChart?.(canvas);
        if (chart) {
          chart.resize();
        }
      };
      window.requestAnimationFrame(resize);
      window.setTimeout(resize, 90);
    });
  }, 40);
}

function setStageZoom(nextZoom, options = {}) {
  const prevZoom = state.stageZoom;
  const clamped = Math.max(MIN_STAGE_ZOOM, Math.min(MAX_STAGE_ZOOM, Number(nextZoom || 1)));
  state.stageZoom = clamped;
  applyStageDimensions();
  syncGridBounds();

  if (!refs.canvasViewport || !refs.canvasWorld || !refs.canvasStage || prevZoom === clamped) {
    return;
  }

  if (Number.isFinite(options.anchorX) && Number.isFinite(options.anchorY)) {
    const viewportRect = refs.canvasViewport.getBoundingClientRect();
    const localX = options.anchorX - viewportRect.left + refs.canvasViewport.scrollLeft;
    const localY = options.anchorY - viewportRect.top + refs.canvasViewport.scrollTop;
    const ratio = clamped / prevZoom;
    refs.canvasViewport.scrollLeft = localX * ratio - (options.anchorX - viewportRect.left);
    refs.canvasViewport.scrollTop = localY * ratio - (options.anchorY - viewportRect.top);
    return;
  }

  if (options.recenter) {
    queueCanvasStageCenter();
  }
}

function setEditMode(editing) {
  state.editMode = Boolean(editing);
  if (refs.editModeBtn) {
    refs.editModeBtn.classList.toggle('is-active', state.editMode);
    refs.editModeBtn.setAttribute('aria-pressed', String(state.editMode));
    refs.editModeBtn.setAttribute('title', state.editMode ? 'Mode Edit: ON' : 'Mode Edit: OFF');
    refs.editModeBtn.setAttribute('data-tip', state.editMode ? 'Mode Edit: ON' : 'Mode Edit: OFF');
  }
  if (refs.canvasGrid) {
    refs.canvasGrid.classList.toggle('editing', state.editMode);
  }
  if (state.grid && typeof state.grid.setEditing === 'function') {
    state.grid.setEditing(state.editMode);
  }
  if (refs.canvasGrid) {
    refs.canvasGrid.querySelectorAll('.widget-head-actions').forEach((element) => {
      element.classList.toggle('hidden-actions', !state.editMode);
    });
  }
  bindHintTooltips();
}

function setDatasetGateVisible(visible) {
  refs.dataGate.classList.toggle('hidden', !visible);
}

function appendMessage(message) {
  const nextMessage = {
    id: message.id || generateMessageId(),
    role: message.role,
    content: message.content || '',
    contentFormat: message.contentFormat || 'plain',
    fileName: message.fileName || null,
    mode: message.mode || 'chat',
    widgets: Array.isArray(message.widgets) ? message.widgets : [],
    artifacts: Array.isArray(message.artifacts) ? message.artifacts : [],
    timeline: message.timeline || null,
    collapsed: Boolean(message.collapsed),
    timelineRunId: message.timelineRunId || null,
    timelineTitle: message.timelineTitle || null,
    error: Boolean(message.error),
  };

  state.messages.push(nextMessage);
  if (nextMessage.mode !== 'timeline' && nextMessage.mode !== 'pending') {
    state.conversationMessageCount += 1;
  }

  renderThread();
}

function findPendingAssistantMessage() {
  return state.messages.find((entry) => entry.id === state.pendingMessageId && entry.mode === 'pending')
    || state.messages.find((entry) => entry.mode === 'pending' && entry.role === 'assistant')
    || null;
}

function ensurePendingAssistantMessage(content = 'Sedang menyiapkan jawaban...') {
  const existing = findPendingAssistantMessage();
  if (existing) {
    existing.content = String(content || existing.content || 'Sedang menyiapkan jawaban...').trim();
    state.pendingMessageId = existing.id;
    renderThread();
    return existing;
  }

  const id = generateMessageId();
  appendMessage({
    id,
    role: 'assistant',
    content,
    mode: 'pending',
    timeline: [],
    collapsed: false,
    showTimelineDetails: false,
  });
  state.pendingMessageId = id;
  return state.messages.find((entry) => entry.id === id) || null;
}

function clearPendingAssistantMessage() {
  const pending = findPendingAssistantMessage();
  if (!pending) {
    state.pendingMessageId = null;
    return;
  }
  state.messages = state.messages.filter((entry) => entry.id !== pending.id);
  state.pendingMessageId = null;
  renderThread();
}

function commitAssistantMessage(message) {
  const nextMessage = {
    id: message.id || generateMessageId(),
    role: message.role || 'assistant',
    content: message.content || '',
    contentFormat: message.contentFormat || 'plain',
    fileName: message.fileName || null,
    mode: message.mode || 'chat',
    widgets: Array.isArray(message.widgets) ? message.widgets : [],
    artifacts: Array.isArray(message.artifacts) ? message.artifacts : [],
    timeline: message.timeline || null,
    collapsed: Boolean(message.collapsed),
    timelineRunId: message.timelineRunId || null,
    timelineTitle: message.timelineTitle || null,
    showTimelineDetails: Boolean(message.showTimelineDetails),
    error: Boolean(message.error),
  };

  const pending = findPendingAssistantMessage();
  if (!pending) {
    appendMessage(nextMessage);
    return;
  }

  const index = state.messages.findIndex((entry) => entry.id === pending.id);
  if (index >= 0) {
    state.messages.splice(index, 1, nextMessage);
    if (nextMessage.mode !== 'timeline' && nextMessage.mode !== 'pending') {
      state.conversationMessageCount += 1;
    }
  } else {
    state.messages.push(nextMessage);
    if (nextMessage.mode !== 'timeline' && nextMessage.mode !== 'pending') {
      state.conversationMessageCount += 1;
    }
  }

  state.pendingMessageId = null;
  renderThread();
}

function scrollToBottom() {
  refs.chatMessages.scrollTo({ top: refs.chatMessages.scrollHeight, behavior: 'smooth' });
}

function showTyping() {
  ensurePendingAssistantMessage('Sedang menyiapkan jawaban...');
  scrollToBottom();
}

function hideTyping() {
  if (refs.typingIndicator) {
    refs.typingIndicator.classList.add('hidden');
  }
}

function renderDashboardSummary(message) {
  const card = document.createElement('div');
  card.className = 'summary-card';

  const title = document.createElement('p');
  title.className = 'summary-title';
  title.textContent = 'Temuan dashboard';
  card.append(title);

  if (message.contentFormat === 'markdown' && String(message.content || '').trim()) {
    const summaryBody = document.createElement('div');
    summaryBody.className = 'summary-markdown';
    renderMarkdownContent(summaryBody, message.content, { className: 'summary-markdown' });
    card.append(summaryBody);
  } else {
    const paragraphs = dashboardSummaryParagraphs(message);
    if (paragraphs.length === 0) {
      const meta = document.createElement('span');
      meta.className = 'summary-meta';
      meta.textContent = summarizeDashboardText(message.content);
      card.append(meta);
    } else {
      paragraphs.forEach((paragraph, index) => {
        const block = document.createElement(index === 0 ? 'p' : 'span');
        block.className = index === 0 ? 'summary-meta' : 'summary-support';
        block.textContent = paragraph;
        card.append(block);
      });
    }
  }

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'summary-btn ghost icon-nav-btn';
  openBtn.setAttribute('aria-label', 'Buka dashboard');
  openBtn.setAttribute('title', 'Buka dashboard');
  openBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 13h7v7H4z"></path></svg><span class="sr-only">Buka dashboard</span>';
  const hasWidgets = Array.isArray(message.widgets) && message.widgets.length > 0;
  if (!hasWidgets) {
    openBtn.disabled = true;
    openBtn.classList.add('is-disabled');
    openBtn.setAttribute('aria-disabled', 'true');
    openBtn.setAttribute('title', 'Dashboard sedang disiapkan');
  }
  openBtn.addEventListener('click', () => {
    if (Array.isArray(message.widgets) && message.widgets.length > 0) {
      setDraftDashboard({
        ...buildDraftDashboardFromCanvas({
          widgets: normalizeIncomingWidgets(message.widgets),
          pages: pageCountForWidgets(message.widgets),
          note: message.content || null,
          status: 'ready',
        }),
        widgets: normalizeIncomingWidgets(message.widgets),
        pages: pageCountForWidgets(message.widgets),
      }, {
        markDirty: true,
        page: Math.max(1, Number(message.widgets[0]?.layout?.page || 1)),
      });
      setCanvasPreparing(false);
      renderCanvas();
    }
    state.canvasViewportMovedByUser = false;
    setCanvasOpen(true);
    queueCanvasStageCenter({ force: true });
  });
  card.append(openBtn);

  return card;
}

function renderMessageContent(bubble, message) {
  if (message.contentFormat === 'markdown' && message.role === 'assistant') {
    const wrap = document.createElement('div');
    wrap.className = 'msg-markdown';
    renderMarkdownContent(wrap, message.content, { className: 'msg-markdown' });
    bubble.append(wrap);
    return;
  }

  const text = document.createElement('div');
  text.innerHTML = escapeHtml(message.content).replace(/\n/g, '<br/>');
  bubble.append(text);
}

function renderThread() {
  refs.chatMessages.innerHTML = '';

  for (const message of state.messages) {
    const row = document.createElement('div');
    row.className = `msg ${message.role}`;
    row.classList.toggle('is-error', Boolean(message.error));

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.classList.toggle('is-error', Boolean(message.error));
    bubble.classList.toggle('is-pending', message.mode === 'pending');

    if (message.mode === 'timeline') {
      bubble.append(renderTimeline(message));
      row.append(bubble);
      refs.chatMessages.append(row);
      continue;
    }

    if (message.mode === 'pending') {
      const text = document.createElement('div');
      text.className = 'pending-message-text';
      text.textContent = message.content || 'Sedang menyiapkan jawaban...';
      bubble.append(text);

      const loader = document.createElement('div');
      loader.className = 'bubble-loader';
      loader.setAttribute('aria-hidden', 'true');
      loader.innerHTML = '<span></span><span></span><span></span>';
      bubble.append(loader);

      if (Boolean(message.showTimelineDetails) && Array.isArray(message.timeline) && message.timeline.length > 0) {
        bubble.append(renderTimeline(message));
      }

      row.append(bubble);
      refs.chatMessages.append(row);
      continue;
    }

    if (message.mode !== 'canvas') {
      renderMessageContent(bubble, message);
    }

    if (message.fileName) {
      const fileChip = document.createElement('div');
      fileChip.className = 'file-chip';
      fileChip.textContent = `File: ${message.fileName}`;
      bubble.append(fileChip);
    }

    const showArtifacts = message.mode !== 'canvas';

    if (showArtifacts && message.artifacts && message.artifacts.length > 0) {
      const list = document.createElement('div');
      list.className = 'chat-artifacts';

      for (const artifact of message.artifacts) {
        const block = document.createElement('div');
        block.className = 'artifact-block';
        renderArtifact(block, artifact);
        list.append(block);
      }

      bubble.append(list);
    }

    if (message.mode === 'canvas') {
      bubble.append(renderDashboardSummary(message));
    }

    row.append(bubble);
    refs.chatMessages.append(row);
  }

  if (state.messages.length > 0) {
    scrollToBottom();
  } else {
    refs.chatMessages.scrollTo({ top: 0 });
  }
  syncComposerChrome();
}
function renderTimeline(message) {
  const wrap = document.createElement('div');
  wrap.className = 'timeline-card';

  const header = document.createElement('div');
  header.className = 'timeline-head';
  const title = document.createElement('strong');
  title.textContent = normalizeTimelineTitle(message.timelineTitle || message.content);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ghost timeline-toggle';
  toggle.textContent = message.collapsed ? 'Tampilkan' : 'Sembunyikan';
  toggle.addEventListener('click', () => {
    message.collapsed = !message.collapsed;
    renderThread();
  });
  header.append(title, toggle);
  wrap.append(header);

  if (!message.collapsed && Array.isArray(message.timeline)) {
    const list = document.createElement('div');
    list.className = 'timeline-steps';
    message.timeline.forEach((step) => {
      const row = document.createElement('div');
      row.className = `timeline-step ${step.status}`;
      const indicator = document.createElement('span');
      indicator.className = 'timeline-indicator';
      indicator.textContent = step.status === 'done' ? '✓' : step.status === 'error' ? '!' : '•';
      const label = document.createElement('span');
      label.textContent = step.label;
      row.append(indicator, label);
      list.append(row);
    });
    wrap.append(list);
  }

  return wrap;
}

function toMetricArtifact(widget) {
  const extractTopListValue = (item = {}) => {
    const candidates = [
      item.total_revenue,
      item.revenue,
      item.total_profit,
      item.profit,
      item.total_expense,
      item.expense,
      item.amount,
      item.total,
      item.value,
      item.quantity,
      item.qty,
      item.count,
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) {
        continue;
      }
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      const text = String(candidate)
        .replace(/\./g, '')
        .replace(/,/g, '.')
        .replace(/[^\d.-]/g, '')
        .trim();
      const parsed = Number(text);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return 0;
  };

  if (widget.type === 'MetricCard') {
    return {
      kind: 'metric',
      title: widget.title || 'Metric',
      value: widget.displayValue || `${Number(widget.value || 0).toLocaleString('id-ID')}`,
      delta: widget.comparison || null,
    };
  }

  if (widget.type === 'TrendChart') {
    return {
      kind: 'chart',
      chart_type: 'line',
      title: widget.title || 'Trend',
      labels: (widget.points || []).map((point) => point.label),
      series: [
        {
          name: widget.title || 'Trend',
          values: (widget.points || []).map((point) => Number(point.value || 0)),
        },
      ],
    };
  }

  if (widget.type === 'TopList') {
    return {
      kind: 'table',
      title: widget.title || 'Top List',
      columns: ['name', 'value'],
      rows: (widget.items || []).map((item) => ({
        name: item.name || item.label || 'Item',
        value: extractTopListValue(item),
      })),
    };
  }

  if (widget.artifact) {
    return widget.artifact;
  }

  return {
    kind: 'text',
    title: widget.title || 'Widget',
    content: JSON.stringify(widget, null, 2),
  };
}

function normalizeIncomingWidgets(inputWidgets = []) {
  const seenIds = new Set();
  const prepared = inputWidgets.map((widget, index) => {
    const artifact = widget.artifact || toMetricArtifact(widget);
    let id = String(widget.id || generateWidgetId());
    if (!id || seenIds.has(id)) {
      id = generateWidgetId();
    }
    seenIds.add(id);
    return {
      id,
      title: normalizeConversationTitle(widget.title || artifact?.title || `Widget ${index + 1}`, `Widget ${index + 1}`),
      artifact,
      query: widget.query || null,
      layout: widget.layout || artifact?.layout || null,
      kind: artifact?.kind || 'chart',
    };
  });

  return packDashboardLayout(prepared).map((widget) => ({
    ...widget,
    layout: normalizeLayout(widget.layout || {}, Number(widget.layout?.page || 1), widget.kind),
  }));
}

function pageCountForWidgets(widgets = []) {
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return 1;
  }

  return widgets.reduce((max, widget) => Math.max(max, Number(widget?.layout?.page || 1)), 1);
}

function buildDraftDashboardFromCanvas(overrides = {}) {
  const widgets = Array.isArray(overrides.widgets)
    ? normalizeIncomingWidgets(overrides.widgets)
    : normalizeIncomingWidgets(state.canvasWidgets);
  return {
    run_id: overrides.run_id || state.draftDashboard?.run_id || null,
    status: overrides.status || state.draftDashboard?.status || 'drafting',
    note: overrides.note ?? state.draftDashboard?.note ?? null,
    name: overrides.name || state.draftDashboard?.name || state.currentDashboard?.name || 'Draft Dashboard',
    saved_dashboard_id: overrides.saved_dashboard_id || state.draftDashboard?.saved_dashboard_id || state.selectedDashboardId || state.currentDashboard?.id || null,
    pages: Math.max(1, Number(overrides.pages || pageCountForWidgets(widgets) || state.canvasPagesCount || 1)),
    widgets,
    artifacts: Array.isArray(overrides.artifacts) ? overrides.artifacts : (state.draftDashboard?.artifacts || []),
    updated_at: new Date().toISOString(),
  };
}

function isDraftDisplayReady(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'ready' || normalized === 'needs_review';
}

function setDraftDashboard(draft = null, options = {}) {
  state.draftDashboard = draft && typeof draft === 'object' ? {
    ...draft,
    pages: Math.max(1, Number(draft.pages || pageCountForWidgets(draft.widgets || []))),
    widgets: Array.isArray(draft.widgets) ? normalizeIncomingWidgets(draft.widgets) : [],
  } : null;

  if (state.draftDashboard?.saved_dashboard_id) {
    state.selectedDashboardId = state.draftDashboard.saved_dashboard_id;
    syncSelectedDashboard({ fallbackToFirst: true });
    renderDashboardList();
  }

  if (state.draftDashboard) {
    state.canvasWidgets = state.draftDashboard.widgets;
    state.canvasPagesCount = Math.max(1, Number(state.draftDashboard.pages || pageCountForWidgets(state.canvasWidgets)));
    if (options.resetPage !== false) {
      state.canvasPage = Math.min(Math.max(1, Number(options.page || 1)), state.canvasPagesCount);
    }
  }

  if (options.markDirty !== undefined) {
    state.draftSaveDirty = Boolean(options.markDirty);
  }
}

function getCanvasConfig() {
  return {
    mode: 'manual',
    pages: Math.max(1, Number(state.canvasPagesCount || 1)),
    components: state.canvasWidgets,
    updated_by: 'user',
  };
}

async function ensureDashboard() {
  if (state.currentDashboard?.id) {
    return state.currentDashboard;
  }

  const created = await api('/api/dashboards', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Dashboard Utama',
      config: getCanvasConfig(),
      conversation_id: state.conversationId || null,
    }),
  });

  upsertDashboardRecord(created.dashboard);
  state.currentDashboard = created.dashboard;
  state.selectedDashboardId = created.dashboard?.id || null;
  renderDashboardList();
  return state.currentDashboard;
}

let saveCanvasTimer = null;
function scheduleCanvasSave() {
  window.clearTimeout(saveCanvasTimer);
  saveCanvasTimer = window.setTimeout(async () => {
    setDraftDashboard(buildDraftDashboardFromCanvas(), {
      markDirty: true,
      resetPage: false,
      page: state.canvasPage,
    });
    updateChatHeader();
  }, 90);
}

function applyDraftDashboardPayload(draft = null, options = {}) {
  if (!draft || typeof draft !== 'object') {
    return;
  }

  const nextDraft = {
    ...draft,
    widgets: Array.isArray(draft.widgets) ? draft.widgets : [],
    pages: Math.max(1, Number(draft.pages || pageCountForWidgets(draft.widgets || []))),
  };
  state.canvasViewportMovedByUser = Boolean(options.preserveViewport) ? state.canvasViewportMovedByUser : false;
  state.canvasAutoCenteredRunId = options.runId || nextDraft.run_id || null;
  setDraftDashboard(nextDraft, {
    markDirty: options.markDirty ?? Boolean(nextDraft.status && nextDraft.status !== 'ready'),
    resetPage: options.resetPage !== false,
    page: options.page || state.canvasPage || 1,
  });
  setCanvasPreparing(!isDraftDisplayReady(nextDraft.status), {
    message: nextDraft.note || 'Dashboard sedang disiapkan...',
  });
  renderCanvas();
  updateChatHeader();
  if (options.openCanvas && state.canvasWidgets.length > 0) {
    setCanvasOpen(true);
  }
  if (!state.canvasViewportMovedByUser && (options.forceCenter || options.runId)) {
    queueCanvasStageCenter({ force: true });
  }
}

function applyDashboardPatch(patch = {}) {
  if (!patch || !patch.draft_dashboard) {
    return;
  }

  const pending = findPendingAssistantMessage();
  if (pending) {
    pending.content = String(patch.note || pending.content || 'Dashboard sedang disusun...').trim();
    pending.showTimelineDetails = true;
  }

  applyDraftDashboardPayload(patch.draft_dashboard, {
    openCanvas: true,
    preserveViewport: state.canvasViewportMovedByUser,
    markDirty: true,
    resetPage: state.canvasWidgets.length === 0,
    page: state.canvasPage || 1,
    runId: patch.run_id || patch.draft_dashboard.run_id || null,
    forceCenter: !state.canvasViewportMovedByUser && state.canvasAutoCenteredRunId !== (patch.run_id || null),
  });
}

function renderCanvasItem(item) {
  const widget = item.data;
  const widgetId = String(widget.id || item.id || generateWidgetId());
  const shell = document.createElement('div');
  shell.className = 'widget-shell';
  if (state.selectedWidgetId === widgetId) {
    shell.classList.add('selected');
  }
  shell.addEventListener('click', (event) => {
    event.stopPropagation();
    selectWidget(widgetId);
  });

  const head = document.createElement('div');
  head.className = 'widget-head';

  const title = document.createElement('strong');
  title.textContent = widget.title || widget.artifact?.title || 'Widget';

  const actions = document.createElement('div');
  actions.className = 'widget-head-actions';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Hapus';
  removeBtn.dataset.widgetId = String(widgetId || '');
  removeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeWidgetById(widgetId);
  });

  actions.append(removeBtn);
  head.append(title, actions);

  actions.classList.toggle('hidden-actions', !state.editMode);

  const body = document.createElement('div');
  body.className = 'widget-body';

  if (widget.artifact?.kind === 'placeholder' || !widget.artifact) {
    const placeholder = document.createElement('div');
    placeholder.className = 'placeholder-artifact';
    placeholder.innerHTML = `
      <div class="placeholder-chart-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="presentation">
          <rect x="10" y="36" width="9" height="18" rx="2"></rect>
          <rect x="26" y="28" width="9" height="26" rx="2"></rect>
          <rect x="42" y="20" width="9" height="34" rx="2"></rect>
          <path d="M8 18L22 24L33 16L56 24"></path>
        </svg>
      </div>
      <p>Pilih data di panel kanan</p>
    `;
    body.append(placeholder);
  } else {
    renderArtifact(body, widget.artifact, { hideTitle: true });
  }

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'widget-resize-handle';

  shell.append(head, body, resizeHandle);
  return shell;
}

function ensureGrid() {
  if (state.grid) {
    return;
  }

  const rowHeight = getCanvasRowHeight();

  state.grid = createGridStackLite(refs.canvasGrid, {
    cols: GRID_COLS,
    gap: GRID_GAP,
    rowHeight,
    maxRows: GRID_ROWS,
    onChange: (items) => {
      if (state.isProgrammaticGridUpdate) {
        return;
      }
      const map = new Map(items.map((item) => [String(item.id), item.layout]));
      state.canvasWidgets = state.canvasWidgets.map((widget) => {
        const currentLayout = normalizeLayout(widget.layout || {}, 1, widget.artifact?.kind);
        const widgetId = String(widget.id || '');
        if ((currentLayout.page || 1) !== state.canvasPage) {
          return {
            ...widget,
            layout: currentLayout,
          };
        }
        return {
          ...widget,
          layout: normalizeLayout(map.get(widgetId) || currentLayout, state.canvasPage, widget.artifact?.kind),
        };
      });
      scheduleCanvasSave();
    },
  });

  if (refs.canvasGrid && !refs.canvasGrid.dataset.boundClick) {
    refs.canvasGrid.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const deleteBtn = target.closest('button[data-widget-id]');
      if (deleteBtn && deleteBtn.textContent?.trim() === 'Hapus') {
        event.preventDefault();
        event.stopPropagation();
        removeWidgetById(deleteBtn.dataset.widgetId);
        return;
      }

      const widgetShell = target.closest('.widget-shell');
      if (widgetShell) {
        const anyActionBtn = target.closest('.widget-head-actions button');
        if (anyActionBtn) {
          return;
        }
      }

      if (event.target === refs.canvasGrid) {
        selectWidget(null);
      }
    });
    refs.canvasGrid.dataset.boundClick = 'true';
  }

  if (state.grid && typeof state.grid.setEditing === 'function') {
    state.grid.setEditing(state.editMode);
  }
}

function syncGridBounds() {
  if (!state.grid) return;
  const rowHeight = getCanvasRowHeight();

  try {
    state.isProgrammaticGridUpdate = true;
    if (typeof state.grid.setBounds === 'function') {
      state.grid.setBounds({
        cols: GRID_COLS,
        maxRows: GRID_ROWS,
        rowHeight,
        gap: GRID_GAP,
      });
    }
    state.grid.refresh();
  } catch (error) {
    console.warn('syncGridBounds_failed', error);
  } finally {
    state.isProgrammaticGridUpdate = false;
  }
  queueCanvasArtifactRefresh();
}

function allPages() {
  const maxPage = state.canvasWidgets.reduce((max, widget) => {
    const page = Number(widget.layout?.page || 1);
    return Math.max(max, page);
  }, 1);
  return Math.max(1, Number(state.canvasPagesCount || 1), maxPage);
}

function setCanvasPage(page, rerender = true) {
  const total = allPages();
  state.canvasPage = Math.max(1, Math.min(Number(page || 1), total));
  if (rerender) {
    renderCanvas();
  } else {
    updateCanvasPagination();
  }
  if (state.canvasOpen) {
    queueCanvasStageCenter({ force: true });
  }
}

function updateCanvasPagination() {
  const total = allPages();
  state.canvasPagesCount = total;
  const pending = state.isCanvasPreparing && (!Array.isArray(state.canvasWidgets) || state.canvasWidgets.length === 0);
  if (refs.canvasPageIndicator) {
    refs.canvasPageIndicator.textContent = pending ? 'Menyiapkan...' : `Hal ${state.canvasPage} / ${total}`;
  }
  if (refs.canvasPrevPage) {
    refs.canvasPrevPage.disabled = pending || state.canvasPage <= 1;
  }
  if (refs.canvasNextPage) {
    refs.canvasNextPage.disabled = pending || state.canvasPage >= total;
  }
  if (refs.canvasAddPage) {
    refs.canvasAddPage.disabled = pending;
  }
}

function addCanvasPage() {
  if (state.isCanvasPreparing) {
    return;
  }
  const total = allPages();
  state.canvasPagesCount = total + 1;
  state.canvasPage = state.canvasPagesCount;
  state.selectedWidgetId = null;
  renderCanvas();
  if (state.canvasOpen) {
    queueCanvasStageCenter();
  }
  scheduleCanvasSave();
  showToast(`Halaman ${state.canvasPage} siap.`);
}

function pageWidgets() {
  return state.canvasWidgets
    .filter((widget) => Number(widget.layout?.page || 1) === state.canvasPage)
    .map((widget) => {
      if (!widget.id) {
        widget.id = generateWidgetId();
      }
      if (typeof widget.id !== 'string') {
        widget.id = String(widget.id);
      }
      return {
        ...widget,
        id: widget.id,
        layout: normalizeLayout(widget.layout || {}, state.canvasPage, widget.artifact?.kind),
      };
    });
}

function nextWidgetLayout(kind = 'chart') {
  return suggestDashboardLayout(state.canvasWidgets, kind, state.canvasPage || 1);
}

function selectWidget(widgetId) {
  state.selectedWidgetId = widgetId || null;

  const widget = state.canvasWidgets.find((entry) => entry.id === state.selectedWidgetId);

  if (!widget || !refs.configForm || !refs.configEmpty) {
    if (refs.configForm) refs.configForm.classList.add('hidden');
    if (refs.configEmpty) refs.configEmpty.classList.remove('hidden');
    renderCanvas();
    return;
  }

  if (state.configPaneCollapsed) {
    setConfigPaneCollapsed(false);
  }

  const widgetPage = Number(widget.layout?.page || 1);
  if (widgetPage !== state.canvasPage) {
    state.canvasPage = widgetPage;
  }

  const schema = state.schema;
  if (schema && refs.configDataset) {
    const datasetId = widget.query?.dataset || refs.configDataset.value || schema.datasets?.[0]?.id;
    refs.configDataset.value = datasetId || schema.datasets?.[0]?.id || '';
    updateConfigDatasetOptions();
  }

  if (refs.configForm.title) {
    refs.configForm.title.value = widget.title || widget.artifact?.title || '';
  }

  if (refs.configDataset) {
    refs.configDataset.value = widget.query?.dataset || refs.configDataset.value;
  }
  if (refs.configMeasure) {
    refs.configMeasure.value = widget.query?.measure || refs.configMeasure.value;
  }
  if (refs.configGroupBy) {
    refs.configGroupBy.value = widget.query?.group_by || refs.configGroupBy.value;
  }
  if (refs.configVisualization) {
    const viz = widget.query?.visualization || (widget.artifact?.kind === 'metric' ? 'metric' : widget.artifact?.chart_type || 'chart');
    if (Array.from(refs.configVisualization.options).some((opt) => opt.value === viz)) {
      refs.configVisualization.value = viz;
    }
  }

  if (refs.configForm.time_period) {
    refs.configForm.time_period.value = widget.query?.time_period || '30 hari terakhir';
  }
  if (refs.configForm.limit) {
    refs.configForm.limit.value = widget.query?.limit || 12;
  }

  refs.configEmpty.classList.add('hidden');
  refs.configForm.classList.remove('hidden');
  renderCanvas();
}

function ensureTimeline(runId, title = 'Proses analisis') {
  if (!runId) return;
  const pending = ensurePendingAssistantMessage('Sedang menyiapkan jawaban...');
  if (pending) {
    pending.timeline = Array.isArray(pending.timeline) ? pending.timeline : [];
    pending.timelineRunId = runId;
    pending.timelineTitle = normalizeTimelineTitle(title);
    state.timelineMessageId = pending.id;
    state.timelineRunId = runId;
    renderThread();
    return pending;
  }

  const existing = state.messages.find((entry) => entry.mode === 'timeline' && entry.timelineRunId === runId);
  if (existing) {
    state.timelineMessageId = existing.id;
    state.timelineRunId = runId;
    return existing;
  }

  const id = generateMessageId();
  appendMessage({
    id,
    role: 'assistant',
    content: normalizeTimelineTitle(title),
    mode: 'timeline',
    timeline: [],
    collapsed: false,
    timelineRunId: runId,
  });
  state.timelineMessageId = id;
  state.timelineRunId = runId;
  return state.messages.find((entry) => entry.id === id);
}

function timelineStepId(step = {}) {
  if (step.id) return String(step.id);
  if (step.step_id) return String(step.step_id);
  if (step.event_id) return String(step.event_id);
  const agent = String(step.agent || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  const title = String(step.title || step.label || step.step || 'langkah')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 72);
  return `${agent}_${title || 'langkah'}`;
}

function upsertTimelineStep(runId, step = {}) {
  const timeline = ensureTimeline(runId);
  if (!timeline || !Array.isArray(timeline.timeline)) {
    return;
  }

  const stepId = timelineStepId(step);
  const existingIndex = timeline.timeline.findIndex((item) => item.id === stepId);
  const cleanLabel = String(step.title || step.label || 'Langkah agent')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const normalizedStep = {
    id: stepId,
    label: cleanLabel || 'Langkah agent',
    status: step.status || 'pending',
  };

  if (existingIndex >= 0) {
    timeline.timeline[existingIndex] = {
      ...timeline.timeline[existingIndex],
      ...normalizedStep,
    };
  } else {
    const duplicateIndex = timeline.timeline.findIndex((item) => (
      item.label === normalizedStep.label && item.status === normalizedStep.status
    ));
    if (duplicateIndex >= 0) {
      timeline.timeline[duplicateIndex] = {
        ...timeline.timeline[duplicateIndex],
        ...normalizedStep,
      };
      renderThread();
      return;
    }

    const lastStep = timeline.timeline[timeline.timeline.length - 1];
    if (lastStep && lastStep.label === normalizedStep.label && lastStep.status === normalizedStep.status) {
      return;
    }

    timeline.timeline.push(normalizedStep);
  }

  renderThread();
}

function finalizeTimeline(runId) {
  if (!runId) return;
  const timeline = state.messages.find((entry) => (
    (entry.mode === 'timeline' || entry.mode === 'pending') && entry.timelineRunId === runId
  ));
  if (!timeline || !Array.isArray(timeline.timeline)) {
    state.timelineMessageId = null;
    state.timelineRunId = null;
    return;
  }

  timeline.timeline = timeline.timeline.map((step) => ({
    ...step,
    status: step.status === 'error' ? 'error' : 'done',
  }));
  timeline.collapsed = true;
  state.timelineMessageId = null;
  state.timelineRunId = null;
  renderThread();
}

function createTimelineStreamState() {
  return {
    hadTimeline: false,
    runId: null,
    seenEventKeys: new Set(),
    visualStepKeys: new Set(),
    agentKeys: new Set(),
    complex: false,
  };
}

function revealPendingTimeline(runId = null) {
  const pending = findPendingAssistantMessage();
  if (!pending) {
    return;
  }
  if (runId && pending.timelineRunId && pending.timelineRunId !== runId) {
    return;
  }
  if (!pending.showTimelineDetails) {
    pending.showTimelineDetails = true;
    renderThread();
  }
}

function markStreamComplexity(streamState, runId = null) {
  if (!streamState) {
    return;
  }
  streamState.complex = true;
  streamState.hadTimeline = true;
  revealPendingTimeline(runId || streamState.runId || null);
}

function timelineEventKey(runId, step = {}) {
  const id = timelineStepId(step);
  const status = String(step.status || 'pending');
  return `${runId}:${id}:${status}`;
}

function isVisualTimelineStep(step = {}) {
  const key = String(step.step || '').toLowerCase();
  if (key === 'tool:query_template' || key === 'tool:query_builder') {
    return true;
  }
  const label = String(step.title || step.label || '').toLowerCase();
  return /^membuat\s+(visual|line|bar|pie|tabel|kartu|chart)/.test(label);
}

function upsertVisualAggregateTimeline(runId, streamState, status = 'pending') {
  const count = streamState?.visualStepKeys?.size || 0;
  if (!runId || count <= 0) {
    return;
  }
  upsertTimelineStep(runId, {
    id: `${runId}_visual_aggregate`,
    title: `Membuat ${count} visual`,
    status,
  });
}

function addEmptyWidget() {
  if (!state.datasetReady) {
    setDatasetGateVisible(true);
    setCanvasOpen(false);
    showToast('Upload dataset dulu sebelum tambah widget.');
    return;
  }

  const widget = {
    id: generateWidgetId(),
    title: 'Widget Baru',
    artifact: { kind: 'placeholder', title: 'Widget Baru' },
    query: null,
    layout: nextWidgetLayout('chart'),
  };

  state.canvasPagesCount = Math.max(state.canvasPagesCount, Number(widget.layout?.page || state.canvasPage || 1));
  state.canvasWidgets.push(widget);
  renderCanvas();
  setCanvasOpen(true);
  selectWidget(widget.id);
  scheduleCanvasSave();
}

function resetWidgetBuilderState() {
  state.widgetBuilderSelection = {
    visualization: null,
    datasetId: null,
    axes: {},
  };
  state.widgetBuilderActiveAxis = null;
  state.widgetBuilderStep = 'type';
}

function setWidgetBuilderOpen(isOpen) {
  state.widgetBuilderOpen = isOpen;
  if (refs.widgetBuilderBackdrop) {
    refs.widgetBuilderBackdrop.classList.toggle('hidden', !isOpen);
  }
  if (refs.widgetBuilderModal) {
    refs.widgetBuilderModal.classList.toggle('hidden', !isOpen);
  }
  if (isOpen) {
    renderWidgetBuilder();
  }
}

function openWidgetBuilder() {
  if (!state.datasetReady) {
    setDatasetGateVisible(true);
    setCanvasOpen(false);
    showToast('Upload dataset dulu sebelum tambah widget.');
    return;
  }
  resetWidgetBuilderState();
  setWidgetBuilderOpen(true);
}

function closeWidgetBuilder() {
  setWidgetBuilderOpen(false);
}

function datasetSupportsVisualization(dataset, visualization) {
  const def = chartDefinition(visualization);
  if (!def) return false;
  const measures = Array.isArray(dataset?.measures) ? dataset.measures.filter((item) => item !== 'count') : [];
  const dimensions = Array.isArray(dataset?.dimensions) ? dataset.dimensions.filter((item) => item !== 'none') : [];
  if (def.requires?.includes('measure') && measures.length === 0 && !SINGLE_VALUE_VISUALS.has(def.id)) {
    return false;
  }
  if (def.requires?.includes('dimension') && dimensions.length === 0) {
    return false;
  }
  if (def.requires?.includes('columns') && (!dataset?.columns || dataset.columns.length === 0)) {
    return false;
  }
  return true;
}

function visualizationAvailable(visualization) {
  const datasets = Array.isArray(state.datasetTables) ? state.datasetTables : [];
  if (!datasets.length) return false;
  return datasets.some((dataset) => datasetSupportsVisualization(dataset, visualization));
}

function renderWidgetTypeGrid() {
  if (!refs.widgetTypeGrid) return;
  refs.widgetTypeGrid.innerHTML = '';

  const availableCharts = CHART_CATALOG.filter((item) => visualizationAvailable(item.id));
  availableCharts.forEach((item) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'widget-type-card';
    if (state.widgetBuilderSelection.visualization === item.id) {
      card.classList.add('is-selected');
    }
    card.innerHTML = `
      <div class="widget-type-icon">${item.icon}</div>
      <div>
        <h4>${item.label}</h4>
        <p>${item.category || 'visual'}</p>
      </div>
    `;
    card.addEventListener('click', () => {
      state.widgetBuilderSelection.visualization = item.id;
      state.widgetBuilderStep = 'config';
      renderWidgetBuilder();
    });
    refs.widgetTypeGrid.append(card);
  });
}

function axisDefinitionsForVisualization(visualization) {
  const def = chartDefinition(visualization);
  if (!def) return [];
  const requires = def.requires || [];
  const axes = [];
  if (requires.includes('dimension')) {
    axes.push({ key: 'dimension', label: 'Sumbu X (Kategori)', hint: 'Pilih kolom kategori atau tanggal' });
  }
  if (requires.includes('measure')) {
    axes.push({ key: 'measure', label: SINGLE_VALUE_VISUALS.has(def.id) ? 'Nilai Utama' : 'Sumbu Y (Nilai)', hint: 'Pilih kolom angka' });
  }
  if (requires.includes('columns')) {
    axes.push({ key: 'columns', label: 'Kolom Tabel', hint: 'Klik beberapa kolom untuk tabel' });
  }
  return axes;
}

function renderWidgetAxisList() {
  if (!refs.widgetAxisList) return;
  refs.widgetAxisList.innerHTML = '';
  const visualization = state.widgetBuilderSelection.visualization;
  if (!visualization) return;
  const axes = axisDefinitionsForVisualization(visualization);

  axes.forEach((axis) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'widget-axis-item';
    const selected = state.widgetBuilderSelection.axes?.[axis.key];
    const valueText = Array.isArray(selected) ? selected.join(', ') : selected || 'Belum dipilih';

    wrapper.innerHTML = `
      <strong>${axis.label}</strong>
      <div class="widget-axis-value">${valueText || 'Belum dipilih'}</div>
      <button type="button" class="ghost" data-axis="${axis.key}">Pilih kolom</button>
    `;

    const button = wrapper.querySelector('button[data-axis]');
    if (button) {
      button.addEventListener('click', () => {
        state.widgetBuilderActiveAxis = axis.key;
        renderWidgetBuilder();
      });
    }
    refs.widgetAxisList.append(wrapper);
  });
}

function renderWidgetDatasetList() {
  if (!refs.widgetDatasetList) return;
  refs.widgetDatasetList.innerHTML = '';
  const datasets = Array.isArray(state.datasetTables) ? state.datasetTables : [];
  if (!datasets.length) {
    refs.widgetDatasetList.innerHTML = '<p class="widget-axis-hint">Dataset belum tersedia.</p>';
    return;
  }

  const activeDataset = state.widgetBuilderSelection.datasetId;
  datasets.forEach((dataset) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'widget-dataset-card';
    if (dataset.id === activeDataset) {
      card.classList.add('is-active');
    }
    card.innerHTML = `
      <h5>${dataset.label || dataset.name || dataset.id}</h5>
      <p>${dataset.description || `${dataset.row_count || 0} baris`}</p>
    `;
    card.addEventListener('click', () => {
      state.widgetBuilderSelection.datasetId = dataset.id;
      renderWidgetBuilder();
      renderDatasetPreview(dataset.id);
    });
    refs.widgetDatasetList.append(card);
  });
}

async function renderDatasetPreview(datasetId) {
  if (!refs.widgetDatasetPreview) return;
  refs.widgetDatasetPreview.innerHTML = '<p class="widget-axis-hint">Memuat preview...</p>';
  if (datasetId === 'transactions' || datasetId === 'expenses') {
    refs.widgetDatasetPreview.innerHTML = '<p class="widget-axis-hint">Preview tabel tersedia setelah upload dataset multi-tabel.</p>';
    return;
  }
  try {
    const preview = await api(`/api/data/tables/${datasetId}/preview?limit=5`);
    const columns = Array.isArray(preview.columns) ? preview.columns : [];
    const rows = Array.isArray(preview.rows) ? preview.rows : [];
    if (!columns.length) {
      refs.widgetDatasetPreview.innerHTML = '<p class="widget-axis-hint">Preview tidak tersedia.</p>';
      return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach((column) => {
      const th = document.createElement('th');
      th.textContent = column;
      th.dataset.column = column;
      th.addEventListener('click', () => selectAxisColumn(datasetId, column));
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      columns.forEach((column) => {
        const td = document.createElement('td');
        td.textContent = row?.[column] ?? '';
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    refs.widgetDatasetPreview.innerHTML = '';
    refs.widgetDatasetPreview.append(table);
  } catch {
    refs.widgetDatasetPreview.innerHTML = '<p class="widget-axis-hint">Preview gagal dimuat.</p>';
  }
}

function selectAxisColumn(datasetId, column) {
  const axisKey = state.widgetBuilderActiveAxis;
  if (!axisKey) {
    showToast('Pilih sumbu dulu.');
    return;
  }
  if (state.widgetBuilderSelection.datasetId && state.widgetBuilderSelection.datasetId !== datasetId) {
    showToast('Gunakan satu tabel untuk semua sumbu.');
    return;
  }
  state.widgetBuilderSelection.datasetId = datasetId;
  if (axisKey === 'columns') {
    const existing = Array.isArray(state.widgetBuilderSelection.axes.columns)
      ? state.widgetBuilderSelection.axes.columns
      : [];
    if (existing.includes(column)) {
      state.widgetBuilderSelection.axes.columns = existing.filter((item) => item !== column);
    } else {
      state.widgetBuilderSelection.axes.columns = [...existing, column];
    }
  } else {
    state.widgetBuilderSelection.axes[axisKey] = column;
  }
  renderWidgetBuilder();
}

function widgetBuilderReady() {
  const visualization = state.widgetBuilderSelection.visualization;
  if (!visualization) return false;
  const axes = axisDefinitionsForVisualization(visualization);
  if (!state.widgetBuilderSelection.datasetId && axes.length > 0) return false;
  return axes.every((axis) => {
    const value = state.widgetBuilderSelection.axes?.[axis.key];
    return axis.key === 'columns'
      ? Array.isArray(value) && value.length > 0
      : Boolean(value);
  });
}

async function createWidgetFromBuilder() {
  if (!widgetBuilderReady()) {
    showToast('Lengkapi sumbu widget dulu.');
    return;
  }
  const visualization = state.widgetBuilderSelection.visualization;
  const dataset = state.widgetBuilderSelection.datasetId;
  const axes = state.widgetBuilderSelection.axes || {};
  const measure = axes.measure || null;
  const groupBy = axes.dimension || 'none';
  const columns = Array.isArray(axes.columns) ? axes.columns : null;

  const titleParts = [];
  if (visualization && visualization !== 'metric' && visualization !== 'table') {
    titleParts.push(chartDefinition(visualization)?.label || 'Visual');
  }
  if (groupBy && groupBy !== 'none') {
    titleParts.push(`per ${groupBy}`);
  }
  const title = titleParts.join(' ') || 'Widget Baru';

  try {
    const result = await api('/api/data/query', {
      method: 'POST',
      body: JSON.stringify({
        dataset,
        measure,
        group_by: groupBy,
        visualization,
        title,
        columns,
        time_period: '30 hari terakhir',
        limit: 12,
      }),
    });

    const artifact = result.artifact || null;
    if (!artifact) {
      showToast('Widget gagal dibuat.');
      return;
    }

    const widget = {
      id: generateWidgetId(),
      title: title || artifact.title,
      artifact,
      query: result.query || { dataset, measure, group_by: groupBy, visualization },
      layout: nextWidgetLayout(artifact.kind || 'chart'),
    };
    state.canvasWidgets.push(widget);
    state.canvasPagesCount = Math.max(state.canvasPagesCount, Number(widget.layout?.page || state.canvasPage || 1));
    renderCanvas();
    setCanvasOpen(true);
    selectWidget(widget.id);
    scheduleCanvasSave();
    closeWidgetBuilder();
  } catch (error) {
    showToast(`Gagal membuat widget: ${error.message || 'error'}`);
  }
}

function renderWidgetBuilder() {
  if (!refs.widgetBuilderModal) return;
  if (refs.widgetBuilderTitle) {
    refs.widgetBuilderTitle.textContent = state.widgetBuilderStep === 'type'
      ? 'Pilih jenis visual'
      : 'Atur sumbu & dataset';
  }
  if (refs.widgetBuilderStepType) {
    refs.widgetBuilderStepType.classList.toggle('is-active', state.widgetBuilderStep === 'type');
  }
  if (refs.widgetBuilderStepConfig) {
    refs.widgetBuilderStepConfig.classList.toggle('is-active', state.widgetBuilderStep === 'config');
  }
  renderWidgetTypeGrid();
  renderWidgetAxisList();
  renderWidgetDatasetList();

  if (refs.widgetDatasetTitle) {
    refs.widgetDatasetTitle.textContent = state.widgetBuilderActiveAxis
      ? `Pilih kolom untuk ${state.widgetBuilderActiveAxis === 'measure' ? 'nilai' : state.widgetBuilderActiveAxis === 'dimension' ? 'kategori' : 'tabel'}`
      : 'Pilih tabel data';
  }

  if (refs.widgetBuilderBackBtn) {
    refs.widgetBuilderBackBtn.hidden = state.widgetBuilderStep === 'type';
  }
  if (refs.widgetBuilderNextBtn) {
    refs.widgetBuilderNextBtn.textContent = state.widgetBuilderStep === 'type' ? 'Lanjut' : 'Buat Widget';
    refs.widgetBuilderNextBtn.disabled = state.widgetBuilderStep === 'config' && !widgetBuilderReady();
  }
}

function removeWidgetById(widgetId) {
  const targetId = String(widgetId || '');
  if (!targetId) {
    return;
  }

  let removed = false;
  const nextWidgets = state.canvasWidgets.filter((entry) => {
    if (String(entry.id) === targetId) {
      removed = true;
      return false;
    }
    return true;
  });
  if (!removed) {
    return;
  }

  state.canvasWidgets = nextWidgets;

  if (state.grid && typeof state.grid.removeItem === 'function') {
    state.grid.removeItem(targetId);
  }

  if (state.selectedWidgetId && String(state.selectedWidgetId) === targetId) {
    state.selectedWidgetId = null;
    if (refs.configForm) refs.configForm.classList.add('hidden');
    if (refs.configEmpty) refs.configEmpty.classList.remove('hidden');
  }

  renderCanvas();
  scheduleCanvasSave();
}

function renderCanvas() {
  if (state.isRenderingCanvas) {
    return;
  }
  if (state.isWorkspaceBooting && !state.workspaceLoaded) {
    return;
  }
  state.isRenderingCanvas = true;
  try {
    setCanvasPreparing(state.isCanvasPreparing, {
      message: state.isCanvasPreparing ? 'Dashboard sedang disiapkan...' : '',
    });
    ensureGrid();
    if (state.canvasPage > allPages()) {
      state.canvasPage = allPages();
    }
    updateCanvasPagination();
    if (state.grid && typeof state.grid.setEditing === 'function') {
      state.grid.setEditing(state.editMode);
    }
    state.isProgrammaticGridUpdate = true;
    state.grid.setItems(pageWidgets(), renderCanvasItem);
    syncGridBounds();
    queueCanvasArtifactRefresh();

    if (state.selectedWidgetId && !state.canvasWidgets.find((w) => w.id === state.selectedWidgetId)) {
      selectWidget(null);
    }
  } catch (error) {
    console.warn('renderCanvas_failed', error);
    showToast('Dashboard siap, tetapi canvas gagal dirender. Coba buka ulang Canvas.');
  } finally {
    state.isProgrammaticGridUpdate = false;
    state.isRenderingCanvas = false;
  }
}

async function refreshDashboards() {
  try {
    const queryParams = state.conversationId ? `?conversation_id=${encodeURIComponent(state.conversationId)}` : '';
    const response = await api(`/api/dashboards${queryParams}`);
    state.dashboards = normalizeDashboardCollection(response.dashboards || []);
    syncSelectedDashboard({ fallbackToFirst: true });
    renderDashboardList();
    setCanvasPreparing(false);

    if (state.draftDashboard && Array.isArray(state.draftDashboard.widgets) && state.draftDashboard.widgets.length > 0) {
      applySelectedDashboardToCanvas({ preservePage: true });
      return;
    }

    state.draftSaveDirty = false;
    applySelectedDashboardToCanvas({ preservePage: true });
  } catch {
    state.dashboards = [];
    state.currentDashboard = null;
    state.selectedDashboardId = null;
    state.canvasPagesCount = 1;
    renderDashboardList();
    setCanvasPreparing(false);
  }
}

function fillContextForm(profile) {
  refs.contextForm.name.value = profile?.name || '';
  refs.contextForm.industry.value = profile?.industry || '';
  refs.contextForm.city.value = profile?.city || '';
  refs.contextForm.timezone.value = profile?.timezone || 'Asia/Jakarta';
  refs.contextForm.currency.value = profile?.currency || 'IDR';
  refs.contextForm.morning_verdict_time.value = profile?.morning_verdict_time || '07:00';
}

async function refreshProfile() {
  const response = await api('/api/business/profile');
  state.profile = response.profile;
  fillContextForm(state.profile);
  syncBusinessSettingsFields();
}

async function refreshVerdict() {
  if (!refs.verdictBadge) {
    return;
  }

  if (!state.datasetReady) {
    refs.verdictBadge.className = 'verdict-badge';
    refs.verdictBadge.textContent = 'Verdict: menunggu dataset';
    return;
  }

  try {
    const response = await api('/api/insights/verdict');
    const verdict = response.verdict;

    refs.verdictBadge.className = 'verdict-badge';
    if (verdict.status === 'SEHAT') {
      refs.verdictBadge.classList.add('ok');
    } else if (verdict.status === 'WASPADA') {
      refs.verdictBadge.classList.add('warn');
    } else {
      refs.verdictBadge.classList.add('critical');
    }
    refs.verdictBadge.textContent = `Verdict ${verdict.status}: ${verdict.sentence}`;
  } catch {
    refs.verdictBadge.className = 'verdict-badge';
    refs.verdictBadge.textContent = 'Verdict: belum tersedia';
  }
}

async function refreshSources() {
  try {
    const response = await api('/api/data/sources');
    const sources = response.sources || [];
    const ready = sources.filter((item) => item.status === 'ready');
    const totalRows = ready.reduce((acc, item) => acc + Number(item.row_count || 0), 0);

    state.datasetReady = ready.length > 0 && totalRows > 0;
    if (refs.sourceStats) {
      refs.sourceStats.textContent = `Data: ${ready.length}/${sources.length} source • ${totalRows.toLocaleString('id-ID')} baris`;
    }
    setDatasetGateVisible(!state.datasetReady);
    syncComposerChrome();
  } catch {
    if (refs.sourceStats) {
      refs.sourceStats.textContent = 'Data: tidak dapat dimuat';
    }
    setDatasetGateVisible(!state.datasetReady);
    syncComposerChrome();
  }
}

function updateChatHeader() {
  const hasCanvasWidgets = Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0;
  if (refs.openCanvasBtn) {
    refs.openCanvasBtn.hidden = !hasCanvasWidgets;
    refs.openCanvasBtn.setAttribute('title', state.canvasOpen ? 'Ciutkan dashboard' : 'Buka dashboard');
    refs.openCanvasBtn.setAttribute('aria-label', state.canvasOpen ? 'Ciutkan dashboard' : 'Buka dashboard');
  }
  if (refs.persistDraftBtn) {
    refs.persistDraftBtn.hidden = !hasCanvasWidgets;
    refs.persistDraftBtn.classList.toggle('is-active', Boolean(state.draftSaveDirty));
    refs.persistDraftBtn.setAttribute('title', state.draftSaveDirty ? 'Simpan draft dashboard' : 'Dashboard sudah tersimpan');
    refs.persistDraftBtn.setAttribute('aria-label', state.draftSaveDirty ? 'Simpan draft dashboard' : 'Dashboard sudah tersimpan');
  }
  if (refs.chatPaneHead) {
    refs.chatPaneHead.hidden = !shouldShowChatHeader({ hasCanvasWidgets });
  }
}

function resetConversationWorkspaceState({
  conversationId = null,
  conversationTitle = '',
  preserveDashboard = false,
} = {}) {
  state.conversationId = conversationId;
  state.conversationTitle = normalizeConversationTitle(conversationTitle);
  state.conversationMessageCount = 0;
  state.openConversationMenuId = null;
  state.messages = [];
  state.pendingMessageId = null;
  state.timelineRunId = null;
  state.timelineMessageId = null;
  const dashboardState = resolveDashboardResetState({
    preserveDashboard,
    currentDashboard: state.currentDashboard,
    canvasWidgets: state.canvasWidgets,
    canvasPage: state.canvasPage,
    canvasPagesCount: state.canvasPagesCount,
  });
  state.currentDashboard = dashboardState.currentDashboard;
  state.selectedDashboardId = dashboardState.currentDashboard?.id || state.selectedDashboardId;
  state.draftDashboard = null;
  state.canvasWidgets = dashboardState.canvasWidgets;
  state.canvasPage = dashboardState.canvasPage;
  state.canvasPagesCount = dashboardState.canvasPagesCount;
  state.selectedWidgetId = null;
  state.isLoadingConversation = false;
  state.isSendingMessage = false;
  state.isUploadingDataset = false;
  setCanvasPreparing(false);
  setCanvasOpen(false);
  renderCanvas();
  renderThread();
  renderDashboardList();
  updateChatHeader();
}

function renderConversationList() {
  if (!refs.sessionList) {
    return;
  }

  if (!state.conversations.length) {
    refs.sessionList.innerHTML = `
      <div class="session-empty">
        <strong>Belum ada percakapan.</strong>
        <span>Mulai chat baru untuk membuat riwayat pertama.</span>
      </div>
    `;
    updateChatHeader();
    return;
  }

  refs.sessionList.innerHTML = '';
  state.conversations.forEach((conversation) => {
    const card = document.createElement('article');
    card.className = 'session-card';
    card.classList.toggle('active', conversation.id === state.conversationId);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'session-card-open ghost';
    openBtn.setAttribute('aria-pressed', String(conversation.id === state.conversationId));
    openBtn.addEventListener('click', async () => {
      state.openConversationMenuId = null;
      if (conversation.id === state.conversationId) {
        return;
      }
      try {
        await loadConversation(conversation.id);
      } catch (error) {
        showToast(error.message);
      }
    });

    const title = document.createElement('span');
    title.className = 'session-card-title';
    title.textContent = normalizeConversationTitle(conversation.title);
    openBtn.append(title);

    const actions = document.createElement('div');
    actions.className = 'session-card-actions';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'ghost session-card-menu-btn';
    menuBtn.setAttribute('aria-expanded', String(state.openConversationMenuId === conversation.id));
    menuBtn.setAttribute('aria-label', `Aksi untuk ${title.textContent}`);
    menuBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v.01M12 12v.01M12 19v.01"></path></svg>';

    const menu = document.createElement('div');
    menu.className = `session-card-menu${state.openConversationMenuId === conversation.id ? '' : ' hidden'}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ghost';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.addEventListener('click', async () => {
      if (typeof window.confirm === 'function' && !window.confirm('Hapus percakapan ini?')) {
        return;
      }
      state.openConversationMenuId = null;
      try {
        await deleteConversationById(conversation.id);
      } catch (error) {
        showToast(error.message);
      }
    });

    menuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.openConversationMenuId = state.openConversationMenuId === conversation.id ? null : conversation.id;
      renderConversationList();
    });

    menu.append(deleteBtn);
    actions.append(menuBtn, menu);
    card.append(openBtn, actions);
    refs.sessionList.append(card);
  });

  updateChatHeader();
}

function normalizeDashboardCollection(dashboards = []) {
  return Array.isArray(dashboards) ? dashboards.filter((dashboard) => dashboard?.id) : [];
}

function upsertDashboardRecord(dashboard) {
  if (!dashboard?.id) {
    return;
  }

  const index = state.dashboards.findIndex((item) => item.id === dashboard.id);
  if (index >= 0) {
    state.dashboards.splice(index, 1, { ...state.dashboards[index], ...dashboard });
  } else {
    state.dashboards.unshift(dashboard);
  }

  state.dashboards.sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function syncSelectedDashboard({ fallbackToFirst = true } = {}) {
  const available = normalizeDashboardCollection(state.dashboards);
  const preferredId = state.selectedDashboardId
    || state.draftDashboard?.saved_dashboard_id
    || state.currentDashboard?.id
    || null;

  const selected = available.find((dashboard) => dashboard.id === preferredId)
    || (fallbackToFirst ? available[0] || null : null);

  state.currentDashboard = selected || null;
  state.selectedDashboardId = selected?.id || null;
  return state.currentDashboard;
}

function selectedDashboardSavedWidgets() {
  return Array.isArray(state.currentDashboard?.config?.components)
    ? normalizeIncomingWidgets(state.currentDashboard.config.components)
    : [];
}

function applySelectedDashboardToCanvas(options = {}) {
  const currentDashboardId = state.currentDashboard?.id || null;
  const shouldUseDraft = Boolean(
    currentDashboardId
    && state.draftDashboard?.saved_dashboard_id
    && state.draftDashboard.saved_dashboard_id === currentDashboardId
    && Array.isArray(state.draftDashboard.widgets)
    && state.draftDashboard.widgets.length > 0
  );

  const widgets = shouldUseDraft ? state.draftDashboard.widgets : selectedDashboardSavedWidgets();
  const pages = shouldUseDraft
    ? Math.max(1, Number(state.draftDashboard?.pages || pageCountForWidgets(widgets)))
    : Math.max(1, Number(state.currentDashboard?.config?.pages || pageCountForWidgets(widgets) || 1));

  if (!shouldUseDraft) {
    state.draftSaveDirty = false;
  }

  state.canvasWidgets = widgets;
  state.canvasPagesCount = Math.max(1, pages);
  state.canvasPage = options.preservePage
    ? Math.min(Math.max(1, Number(state.canvasPage || 1)), state.canvasPagesCount)
    : 1;

  renderCanvas();
  updateChatHeader();
}

function renderDashboardList() {
  if (!refs.dashboardList) {
    return;
  }

  const dashboards = normalizeDashboardCollection(state.dashboards);
  if (dashboards.length === 0) {
    refs.dashboardList.innerHTML = `
      <div class="session-empty">
        <strong>Belum ada dashboard.</strong>
        <span>Buat dashboard dari chat untuk menyimpannya di sini.</span>
      </div>
    `;
    return;
  }

  refs.dashboardList.innerHTML = '';
  dashboards.forEach((dashboard) => {
    const card = document.createElement('article');
    card.className = 'session-card dashboard-card';
    card.classList.toggle('active', dashboard.id === state.selectedDashboardId);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'session-card-open ghost';
    openBtn.setAttribute('aria-pressed', String(dashboard.id === state.selectedDashboardId));
    openBtn.addEventListener('click', () => {
      const reselecting = dashboard.id === state.selectedDashboardId;
      state.selectedDashboardId = dashboard.id;
      syncSelectedDashboard();
      applySelectedDashboardToCanvas();
      renderDashboardList();

      if (Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0) {
        state.canvasViewportMovedByUser = false;
        setCanvasOpen(reselecting ? !state.canvasOpen : true);
        if (state.canvasOpen) {
          queueCanvasStageCenter({ force: true });
        }
      }
    });

    const title = document.createElement('span');
    title.className = 'session-card-title';
    title.textContent = normalizeConversationTitle(dashboard.name || 'Dashboard');
    openBtn.append(title);

    card.append(openBtn);
    refs.dashboardList.append(card);
  });

  if (refs.dashboardVersionsBtn) {
    refs.dashboardVersionsBtn.innerHTML = `Versi (${dashboards.length}) <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;
  }

  // Notify dashboard switcher of available dashboards
  document.dispatchEvent(new CustomEvent('vistara:dashboards-updated', {
    detail: {
      dashboards: dashboards.map((d) => ({ id: d.id, title: normalizeConversationTitle(d.name || 'Dashboard') })),
      activeId: state.selectedDashboardId,
    },
  }));
}

function upsertConversation(conversation) {
  if (!conversation?.id) {
    return;
  }
  const nextConversation = {
    ...conversation,
    title: normalizeConversationTitle(conversation.title || 'Percakapan baru'),
  };
  const index = state.conversations.findIndex((item) => item.id === nextConversation.id);
  if (index >= 0) {
    state.conversations.splice(index, 1, { ...state.conversations[index], ...nextConversation });
  } else {
    state.conversations.unshift(nextConversation);
  }

  state.conversations.sort((a, b) => {
    const aTime = new Date(a.last_message_at || a.created_at || 0).getTime();
    const bTime = new Date(b.last_message_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });

  if (nextConversation.id === state.conversationId) {
    state.conversationTitle = normalizeConversationTitle(nextConversation.title);
  }

  renderConversationList();
}

async function refreshConversationList() {
  const response = await api('/api/chat/conversations');
  state.conversations = Array.isArray(response.conversations) ? response.conversations : [];
  renderConversationList();
  syncComposerChrome();
}

async function refreshChatHistory(conversationId = state.conversationId) {
  state.isLoadingConversation = true;
  try {
    const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
    const response = await api(`/api/chat/history${query}`);
    state.conversationId = response.conversation_id;
    state.conversationTitle = normalizeConversationTitle(response.conversation?.title || 'Percakapan baru');
    upsertConversation(response.conversation);

    state.messages = (response.messages || [])
      .map((item) => {
        const payload = item.payload || {};
        return {
          role: item.role,
          content: item.content,
          contentFormat: payload.content_format || 'plain',
          artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
          widgets: Array.isArray(payload.widgets) ? payload.widgets : [],
          mode: payload.presentation_mode || 'chat',
          fileName: null,
          error: Boolean(payload.error),
        };
      })
      .filter((entry) => !(entry.role === 'assistant' && entry.mode === 'chat' && /^selamat datang/i.test(entry.content || '')));

    state.conversationMessageCount = state.messages.filter((entry) => entry.mode !== 'timeline' && entry.mode !== 'pending').length;
    state.pendingMessageId = null;

    const draftDashboard = response.agent_state?.draft_dashboard || null;
    state.draftDashboard = draftDashboard
      ? {
          ...draftDashboard,
          widgets: Array.isArray(draftDashboard.widgets) ? normalizeIncomingWidgets(draftDashboard.widgets) : [],
        }
      : null;
    state.draftSaveDirty = Boolean(state.draftDashboard);
    if (state.draftDashboard?.saved_dashboard_id) {
      state.selectedDashboardId = state.draftDashboard.saved_dashboard_id;
      syncSelectedDashboard({ fallbackToFirst: true });
      renderDashboardList();
    }

    const lastCanvas = [...state.messages]
      .reverse()
      .find((item) => item.mode === 'canvas' && Array.isArray(item.widgets) && item.widgets.length > 0);

    const selectedSavedWidgets = selectedDashboardSavedWidgets();
    const nextCanvasState = resolveCanvasState({
      messageWidgets: state.draftDashboard?.widgets?.length
        && (!state.selectedDashboardId || state.draftDashboard?.saved_dashboard_id === state.selectedDashboardId)
        ? state.draftDashboard.widgets
        : (lastCanvas ? normalizeIncomingWidgets(lastCanvas.widgets) : []),
      dashboardWidgets: selectedSavedWidgets,
      canvasPage: 1,
      canvasPagesCount: state.canvasPagesCount,
      dashboardPagesCount: state.currentDashboard?.config?.pages,
    });
    state.canvasWidgets = nextCanvasState.canvasWidgets;
    state.canvasPagesCount = nextCanvasState.canvasPagesCount;
    state.canvasPage = nextCanvasState.canvasPage;
    renderCanvas();

    renderThread();
    setCanvasPreparing(false);
  } finally {
    state.isLoadingConversation = false;
    syncComposerChrome();
    setCanvasPreparing(false);
  }
}

async function loadConversation(conversationId) {
  setCanvasOpen(false);
  await refreshChatHistory(conversationId);
}

async function startNewConversation() {
  // Don't persist to DB yet — only create the conversation when the user sends a message.
  resetConversationWorkspaceState({
    conversationId: null,
    conversationTitle: 'Percakapan baru',
    preserveDashboard: true,
  });
  renderConversationList();
  syncComposerChrome();
}

async function deleteConversationById(conversationId) {
  await api(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });

  const removedActiveConversation = didDeleteActiveConversation({
    activeConversationId: state.conversationId,
    deletedConversationId: conversationId,
  });
  state.conversations = state.conversations.filter((item) => item.id !== conversationId);
  const nextConversationId = resolveNextConversationIdAfterDelete({
    activeConversationId: state.conversationId,
    deletedConversationId: conversationId,
    remainingConversations: state.conversations,
  });

  if (removedActiveConversation && nextConversationId) {
    await loadConversation(nextConversationId);
  } else if (removedActiveConversation) {
    resetConversationWorkspaceState({ preserveDashboard: true });
    renderConversationList();
  } else {
    renderConversationList();
  }
}

function ensureWelcomeMessage() {
  updatePreChatTicker();
}

function refreshWelcomeGreeting() {
  updatePreChatTicker();
}

async function loadSchema() {
  try {
    const response = await api('/api/data/schema');
    state.schema = response.schema;
    state.datasetTables = Array.isArray(response.schema?.datasets) ? response.schema.datasets : [];
    populateSchemaOptions();
    renderDataFields();
  } catch {
    state.schema = null;
    state.datasetTables = [];
  }
}

function populateSchemaOptions() {
  const schema = state.schema;
  if (!schema) return;

  if (refs.configDataset) {
    refs.configDataset.innerHTML = '';
    for (const dataset of schema.datasets || []) {
      const option = document.createElement('option');
      option.value = dataset.id;
      option.textContent = dataset.label || dataset.id;
      refs.configDataset.append(option);
    }
  }

  if (refs.configVisualization) {
    refs.configVisualization.innerHTML = '';
    const list = schema.visualizations?.length
      ? schema.visualizations
      : CHART_CATALOG;
    for (const item of list) {
      const value = typeof item === 'string' ? item : item.id;
      const label = typeof item === 'string' ? item.toUpperCase() : item.label;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      refs.configVisualization.append(option);
    }
  }

  updateConfigDatasetOptions();
}

function updateConfigDatasetOptions() {
  const schema = state.schema;
  if (!schema) return;

  const datasetId = refs.configDataset?.value || schema.datasets?.[0]?.id;
  const dataset = (schema.datasets || []).find((entry) => entry.id === datasetId) || schema.datasets?.[0];
  if (!dataset) return;

  if (refs.configMeasure) {
    refs.configMeasure.innerHTML = '';
    for (const measure of dataset.measures || []) {
      const option = document.createElement('option');
      option.value = measure;
      option.textContent = measure;
      refs.configMeasure.append(option);
    }
  }

  if (refs.configGroupBy) {
    refs.configGroupBy.innerHTML = '';
    for (const dimension of dataset.dimensions || []) {
      const option = document.createElement('option');
      option.value = dimension;
      option.textContent = dimension;
      refs.configGroupBy.append(option);
    }
  }
}

function renderDataFields() {
  if (!refs.dataFields) return;
  const schema = state.schema;
  refs.dataFields.innerHTML = '';
  if (!schema) return;

  for (const dataset of schema.datasets || []) {
    const group = document.createElement('div');
    group.className = 'data-group';

    const title = document.createElement('div');
    title.className = 'data-group-title';
    title.textContent = dataset.label || dataset.id;
    group.append(title);

    if (dataset.measures?.length) {
      const row = document.createElement('div');
      row.className = 'data-badges';
      for (const measure of dataset.measures) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-measure';
        badge.textContent = measure;
        row.append(badge);
      }
      group.append(row);
    }

    if (dataset.dimensions?.length) {
      const row = document.createElement('div');
      row.className = 'data-badges';
      for (const dim of dataset.dimensions) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-dimension';
        badge.textContent = dim;
        row.append(badge);
      }
      group.append(row);
    }

    refs.dataFields.append(group);
  }
}

async function uploadDataset({ file = null, demo = false, silent = false } = {}) {
  if (!state.token) {
    showPage('auth');
    showToast('Login dulu.');
    return null;
  }

  if (demo) {
    console.info('[upload] demo_start');
  } else if (file) {
    console.info('[upload] start', {
      name: file.name,
      size: file.size,
      type: file.type,
    });
  } else {
    console.info('[upload] start without file');
  }

  state.isUploadingDataset = true;
  syncComposerChrome();
  document.dispatchEvent(new CustomEvent('vistara:message-sending'));
  try {
    let response;
    if (demo) {
      response = await api('/api/data/demo/import', {
        method: 'POST',
        timeoutMs: UPLOAD_API_TIMEOUT_MS,
      });
    } else {
      if (!file) {
        throw new Error('Pilih file dulu.');
      }

      const formData = new FormData();
      formData.set('file', file);

      response = await api('/api/data/upload', {
        method: 'POST',
        body: formData,
        timeoutMs: UPLOAD_API_TIMEOUT_MS,
      });
    }

    await Promise.allSettled([refreshSources(), refreshVerdict(), refreshDashboards()]);

    if (!silent) {
      appendMessage({
        role: 'assistant',
        content: `Dataset ${response.source?.filename || 'baru'} siap digunakan. ${response.ingestion?.inserted ?? 0} baris diproses.`,
        mode: 'chat',
        artifacts: [],
      });
    }

    console.info('[upload] success', {
      sourceId: response.source?.id || null,
      filename: response.source?.filename || null,
      inserted: response.ingestion?.inserted ?? null,
      datasetType: response.ingestion?.dataset_type || null,
    });

    showToast(demo ? 'Demo dataset berhasil diimport.' : 'Dataset berhasil diupload.');
    document.dispatchEvent(new CustomEvent('vistara:upload-complete', { detail: { success: true, message: 'Upload selesai!' } }));
    document.dispatchEvent(new CustomEvent('vistara:message-sent'));
    return response;
  } catch (uploadError) {
    console.warn('[upload] failed', uploadError);
    document.dispatchEvent(new CustomEvent('vistara:upload-error', { detail: { message: uploadError.message || 'Upload gagal.' } }));
    document.dispatchEvent(new CustomEvent('vistara:message-error'));
    throw uploadError;
  } finally {
    state.isUploadingDataset = false;
    syncComposerChrome();
  }
}

function traceStepTitle(step = {}) {
  const key = String(step.step || '').toLowerCase();
  if (key === 'planner') return 'Menyusun rencana dashboard';
  if (key === 'worker_fallback') return 'Mengaktifkan fallback deterministik';
  if (key === 'tool:read_dashboard_template') return 'Membaca template dashboard aktif';
  if (key === 'tool:python_exec') return 'Menjalankan validasi Python';
  if (key === 'tool:finalize_dashboard') return 'Menyelesaikan komposisi dashboard';
  if (key.startsWith('tool:')) {
    return `Menjalankan ${key.replace('tool:', '')}`;
  }
  return key ? key.replace(/_/g, ' ') : 'Langkah agent';
}

function hydrateTimelineFromTrace(agent) {
  const trace = Array.isArray(agent?.trace) ? agent.trace : [];
  if (trace.length === 0) {
    return;
  }
  const runId = state.timelineRunId || `trace_${Date.now()}`;
  ensureTimeline(runId, 'Proses analisis');
  const visualSteps = trace.filter((step) => {
    const key = String(step.step || '').toLowerCase();
    return key === 'tool:query_template' || key === 'tool:query_builder';
  });

  trace
    .filter((step) => {
      const key = String(step.step || '').toLowerCase();
      return key !== 'tool:query_template' && key !== 'tool:query_builder';
    })
    .forEach((step, index) => {
      upsertTimelineStep(runId, {
        id: `trace_${index + 1}`,
        title: traceStepTitle(step),
        status: 'done',
      });
    });

  if (visualSteps.length > 0) {
    upsertTimelineStep(runId, {
      id: 'trace_visual_aggregate',
      title: `Membuat ${visualSteps.length} visual`,
      status: 'done',
    });
  }

  finalizeTimeline(runId);
}

function shouldHydrateTimelineFromResponse(response = {}) {
  if (!response || typeof response !== 'object') {
    return false;
  }

  if (response.pending_approval) {
    return true;
  }

  if (response.presentation_mode === 'canvas') {
    return true;
  }

  const routeAction = String(response.agent?.route?.action || '').toLowerCase();
  if (['analyze', 'inspect_dataset', 'create_dashboard', 'edit_dashboard'].includes(routeAction)) {
    return true;
  }

  const trace = Array.isArray(response.agent?.trace) ? response.agent.trace : [];
  return trace.length > 1;
}

function applyAssistantResponse(response, options = {}) {
  state.conversationId = response.conversation_id;
  state.conversationTitle = response.conversation?.title || state.conversationTitle || 'Percakapan baru';
  upsertConversation(response.conversation);
  if (response.dashboard) {
    upsertDashboardRecord(response.dashboard);
    state.selectedDashboardId = response.dashboard.id;
    syncSelectedDashboard({ fallbackToFirst: true });
    renderDashboardList();
  }
  if (response.draft_dashboard) {
    state.draftDashboard = {
      ...response.draft_dashboard,
      widgets: Array.isArray(response.draft_dashboard.widgets)
        ? normalizeIncomingWidgets(response.draft_dashboard.widgets)
        : [],
    };
    state.draftSaveDirty = response.save_required !== false;
    if (state.draftDashboard.saved_dashboard_id) {
      state.selectedDashboardId = state.draftDashboard.saved_dashboard_id;
      syncSelectedDashboard({ fallbackToFirst: true });
      renderDashboardList();
    }
  }

  if (options.needsTimeline && !options.skipTraceHydration && !state.timelineRunId && !findPendingAssistantMessage()) {
    hydrateTimelineFromTrace(response.agent);
  }

  const widgets = response.widgets || [];
  const artifacts = response.artifacts || [];
  const mode = response.presentation_mode || 'chat';
  const isSingleWidget = Array.isArray(widgets) && widgets.length === 1;
  const isSingleArtifact = !isSingleWidget && Array.isArray(artifacts) && artifacts.length === 1;
  const isCanvasPending = mode === 'canvas' && (!Array.isArray(widgets) || widgets.length === 0);
  if (mode === 'canvas') {
    setCanvasPreparing(isCanvasPending, { message: 'Dashboard sedang disiapkan...' });
  } else {
    setCanvasPreparing(false);
  }

  if (isSingleWidget) {
    const normalized = normalizeIncomingWidgets(widgets)[0];
    commitAssistantMessage({
      role: 'assistant',
      content: response.answer || 'Berikut insight cepat.',
      contentFormat: response.content_format || 'plain',
      mode: 'chat',
      widgets: [],
      artifacts: [normalized.artifact],
    });
    return;
  }

  if (isSingleArtifact) {
    commitAssistantMessage({
      role: 'assistant',
      content: response.answer || 'Berikut insight cepat.',
      contentFormat: response.content_format || 'plain',
      mode: 'chat',
      widgets: [],
      artifacts,
    });
    return;
  }

  commitAssistantMessage({
    role: 'assistant',
    content: response.answer || 'Selesai.',
    contentFormat: response.content_format || 'plain',
    mode,
    widgets,
    artifacts,
  });

  if (mode === 'canvas' && Array.isArray(widgets) && widgets.length > 0) {
    try {
      applyDraftDashboardPayload(response.draft_dashboard || buildDraftDashboardFromCanvas({
        widgets: normalizeIncomingWidgets(widgets),
        pages: pageCountForWidgets(widgets),
        note: response.answer || null,
        status: 'ready',
      }), {
        openCanvas: Boolean(state.canvasOpen),
        preserveViewport: state.canvasViewportMovedByUser,
        markDirty: Boolean(response.save_required !== false),
        resetPage: true,
        page: 1,
        runId: response.draft_dashboard?.run_id || null,
        forceCenter: !state.canvasViewportMovedByUser,
      });
    } catch (error) {
      console.warn('applyAssistantResponse_canvas_failed', error);
      showToast('Jawaban masuk, tapi render canvas gagal. Coba buka ulang Canvas.');
    }
  }
}

async function streamChatMessage(userText, streamState = createTimelineStreamState()) {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetchWithRetry(`${API_BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: userText,
      conversation_id: state.conversationId,
      dashboard_id: state.draftDashboard?.saved_dashboard_id || state.selectedDashboardId || state.currentDashboard?.id || null,
      client_preferences: state.settings,
    }),
  }, {
    retries: 1,
    baseDelayMs: 450,
    timeoutMs: STREAM_API_TIMEOUT_MS,
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : null;
    throw createAppError(payload?.error?.message || `Stream gagal (${response.status})`, {
      code: payload?.error?.code || 'CHAT_STREAM_FAILED',
      statusCode: payload?.error?.status || response.status,
      details: payload?.error?.details ?? null,
    });
  }
  if (!response.body) {
    throw createAppError('Stream tidak tersedia.', {
      code: 'CHAT_STREAM_UNAVAILABLE',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (event.type === 'timeline_start') {
          const runId = event.timeline_id || `timeline_${Date.now()}`;
          streamState.runId = runId;
          streamState.seenEventKeys.clear();
          streamState.visualStepKeys.clear();
          ensureTimeline(runId, normalizeTimelineTitle(event.title));
        } else if (event.type === 'agent_start' || event.type === 'agent_step') {
          const runId = streamState.runId || event.run_id || state.timelineRunId || `timeline_${Date.now()}`;
          streamState.runId = runId;
          const agentKey = String(event.agent || 'agent').trim().toLowerCase();
          if (agentKey) {
            streamState.agentKeys.add(agentKey);
          }
          if (streamState.agentKeys.size > 2) {
            markStreamComplexity(streamState, runId);
          }
          ensureTimeline(runId, 'Tim agent sedang bekerja');
          upsertTimelineStep(runId, {
            id: `${event.type}_${String(event.agent || 'agent').toLowerCase()}_${String(event.title || 'langkah').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            title: event.title || 'Langkah agent',
            status: event.type === 'agent_start' ? 'pending' : (event.status || 'done'),
          });
        } else if (event.type === 'timeline_step') {
          const step = event.step || {};
          const runId = step.timeline_id || streamState.runId || state.timelineRunId || `timeline_${Date.now()}`;
          streamState.runId = runId;
          const eventKey = timelineEventKey(runId, step);
          if (streamState.seenEventKeys.has(eventKey)) {
            continue;
          }
          streamState.seenEventKeys.add(eventKey);
          ensureTimeline(runId, 'Proses analisis');
          if (isVisualTimelineStep(step)) {
            markStreamComplexity(streamState, runId);
            streamState.visualStepKeys.add(timelineStepId(step));
            upsertVisualAggregateTimeline(runId, streamState, step.status === 'error' ? 'error' : 'pending');
            continue;
          }
          upsertTimelineStep(runId, {
            ...step,
            id: timelineStepId(step),
          });
        } else if (event.type === 'timeline_done') {
          const runId = event.timeline_id || streamState.runId || state.timelineRunId;
          if (runId) {
            upsertVisualAggregateTimeline(runId, streamState, 'done');
          }
          finalizeTimeline(runId);
        } else if (event.type === 'dashboard_patch') {
          markStreamComplexity(streamState, event.run_id || streamState.runId || null);
          applyDashboardPatch(event);
        } else if (event.type === 'approval_required') {
          markStreamComplexity(streamState, event.run_id || streamState.runId || null);
          if (event.approval?.prompt) {
            showToast(event.approval.prompt);
          }
        } else if (event.type === 'final') {
          finalPayload = event.payload || null;
        } else if (event.type === 'error') {
          throw createAppError(event.message || 'Stream error.', {
            code: event.code || 'CHAT_STREAM_FAILED',
            statusCode: event.status || 500,
            conversationId: event.conversation_id || null,
            persistedInConversation:
              event.persisted_in_conversation
              ?? event.persistedInConversation
              ?? false,
          });
        }
      }
    }
  } catch (error) {
    if (String(error?.code || '').trim().toUpperCase().startsWith('CHAT_STREAM_')) {
      throw error;
    }
    throw createAppError(error?.message || 'Stream gagal dibaca.', {
      code: 'CHAT_STREAM_READ_FAILED',
    });
  }

  if (!finalPayload) {
    throw createAppError('Final payload tidak diterima dari stream.', {
      code: 'CHAT_STREAM_INCOMPLETE',
    });
  }

  return {
    payload: finalPayload,
    timelineSeen: Boolean(streamState.hadTimeline),
  };
}

async function sendChatMessage(userText) {
  if (state.timelineRunId) {
    finalizeTimeline(state.timelineRunId);
  }
  state.isSendingMessage = true;
  syncComposerChrome();
  showTyping();
  document.dispatchEvent(new CustomEvent('vistara:message-sending'));

  // Lazily create the conversation on first message if it doesn't exist yet
  if (!state.conversationId) {
    try {
      const convResponse = await api('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      state.conversationId = convResponse.conversation?.id || null;
      state.conversationTitle = normalizeConversationTitle(convResponse.conversation?.title || 'Percakapan baru');
      upsertConversation(convResponse.conversation);
    } catch (convError) {
      hideTyping();
      state.isSendingMessage = false;
      syncComposerChrome();
      showToast(`Gagal memulai percakapan: ${convError.message}`);
      return;
    }
  }

  try {
    let response;
    let streamTimelineSeen = false;
    const streamState = createTimelineStreamState();
    try {
      const streamed = await streamChatMessage(userText, streamState);
      response = streamed.payload;
      streamTimelineSeen = Boolean(streamed.timelineSeen);
    } catch (error) {
      streamTimelineSeen = Boolean(streamState.hadTimeline);
      if (!(isNetworkLikeError(error) || shouldRetryNonStreamChatRequest(error))) {
        throw error;
      }
      response = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userText,
          conversation_id: state.conversationId,
          dashboard_id: state.draftDashboard?.saved_dashboard_id || state.selectedDashboardId || state.currentDashboard?.id || null,
          client_preferences: state.settings,
        }),
      });
    }

    hideTyping();
    applyAssistantResponse(response, {
      needsTimeline: !streamTimelineSeen && shouldHydrateTimelineFromResponse(response),
      skipTraceHydration: streamTimelineSeen,
    });
    if (state.timelineRunId) {
      finalizeTimeline(state.timelineRunId);
    }
    await refreshVerdict();
  } catch (error) {
    hideTyping();
    setCanvasPreparing(false);
    finalizeTimeline(state.timelineRunId);
    document.dispatchEvent(new CustomEvent('vistara:message-error'));
    const historyConversationId = error?.conversationId || state.conversationId;
    if ((error?.persistedInConversation || (error?.statusCode && error.statusCode < 500)) && historyConversationId) {
      state.conversationId = historyConversationId;
      try {
        clearPendingAssistantMessage();
        await refreshChatHistory(historyConversationId);
        return;
      } catch (refreshError) {
        console.warn('refreshChatHistory_after_error_failed', refreshError);
      }
    }
    commitAssistantMessage({
      role: 'assistant',
      content: `Error: ${error.message || 'Permintaan tidak dapat diproses.'}`,
      contentFormat: 'plain',
      mode: 'chat',
      artifacts: [],
      error: true,
    });
  } finally {
    state.isSendingMessage = false;
    syncComposerChrome();
    document.dispatchEvent(new CustomEvent('vistara:message-sent'));
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawWidgetChart(context, artifact, area) {
  const series = Array.isArray(artifact?.series) ? artifact.series : [];
  const values = (series[0]?.values || []).map((value) => Number(value || 0));
  if (!values.length) {
    context.fillStyle = '#94a3b8';
    context.fillText('Tidak ada data chart', area.x + 12, area.y + 24);
    return;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue || 1;
  const chartType = String(artifact?.chart_type || 'line').toLowerCase();
  const accent = '#f97316';

  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = area.y + (area.height * i) / 4;
    context.beginPath();
    context.moveTo(area.x, y);
    context.lineTo(area.x + area.width, y);
    context.stroke();
  }

  if (chartType === 'bar') {
    const barGap = Math.max(6, area.width * 0.015);
    const barWidth = Math.max(8, (area.width - barGap * (values.length + 1)) / values.length);
    values.forEach((value, index) => {
      const ratio = (value - minValue) / span;
      const barHeight = Math.max(8, ratio * (area.height - 12));
      const x = area.x + barGap + index * (barWidth + barGap);
      const y = area.y + area.height - barHeight;
      context.fillStyle = accent;
      drawRoundedRect(context, x, y, barWidth, barHeight, 4);
      context.fill();
    });
    return;
  }

  if (chartType === 'pie') {
    const total = values.reduce((acc, value) => acc + Math.max(0, value), 0) || 1;
    const radius = Math.min(area.width, area.height) * 0.36;
    const cx = area.x + area.width / 2;
    const cy = area.y + area.height / 2;
    const palette = ['#f97316', '#fb923c', '#fdba74', '#f59e0b', '#84cc16', '#38bdf8', '#a78bfa'];
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const slice = (Math.max(0, value) / total) * Math.PI * 2;
      context.beginPath();
      context.moveTo(cx, cy);
      context.arc(cx, cy, radius, angle, angle + slice);
      context.closePath();
      context.fillStyle = palette[index % palette.length];
      context.fill();
      angle += slice;
    });
    return;
  }

  const stepX = values.length > 1 ? area.width / (values.length - 1) : area.width;
  const points = values.map((value, index) => {
    const ratio = (value - minValue) / span;
    return {
      x: area.x + index * stepX,
      y: area.y + area.height - ratio * (area.height - 10),
    };
  });

  context.beginPath();
  context.moveTo(points[0].x, area.y + area.height);
  points.forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(points[points.length - 1].x, area.y + area.height);
  context.closePath();
  context.fillStyle = 'rgba(249, 115, 22, 0.2)';
  context.fill();

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.strokeStyle = accent;
  context.lineWidth = 2.5;
  context.stroke();
}

function drawWidgetOnExport(context, widget, rect) {
  const artifact = widget?.artifact || {};
  context.fillStyle = '#ffffff';
  drawRoundedRect(context, rect.x, rect.y, rect.w, rect.h, 12);
  context.fill();
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = '#475569';
  context.font = '600 20px Inter, Arial, sans-serif';
  context.fillText(String(widget.title || artifact.title || 'Widget').slice(0, 36), rect.x + 14, rect.y + 30);

  const body = {
    x: rect.x + 14,
    y: rect.y + 42,
    width: rect.w - 28,
    height: rect.h - 56,
  };

  if (artifact.kind === 'metric') {
    context.fillStyle = '#0f172a';
    context.font = '700 38px Space Grotesk, Inter, Arial, sans-serif';
    context.fillText(String(artifact.value || '-').slice(0, 18), body.x, body.y + Math.min(66, body.height - 10));
    return;
  }

  if (artifact.kind === 'table') {
    const rows = Array.isArray(artifact.rows) ? artifact.rows.slice(0, 6) : [];
    const columns = Array.isArray(artifact.columns) ? artifact.columns : [];
    context.fillStyle = '#64748b';
    context.font = '600 14px Inter, Arial, sans-serif';
    context.fillText(columns.join('  |  '), body.x, body.y + 18);
    context.fillStyle = '#0f172a';
    context.font = '500 13px Inter, Arial, sans-serif';
    rows.forEach((row, index) => {
      const text = columns.map((column) => String(row?.[column] ?? '')).join('  |  ');
      context.fillText(text.slice(0, 72), body.x, body.y + 42 + index * 20);
    });
    return;
  }

  if (artifact.kind === 'placeholder') {
    context.fillStyle = '#94a3b8';
    context.font = '500 16px Inter, Arial, sans-serif';
    context.fillText('Pilih data di panel kanan', body.x, body.y + 24);
    return;
  }

  drawWidgetChart(context, artifact, {
    x: body.x,
    y: body.y + 4,
    width: Math.max(40, body.width),
    height: Math.max(36, body.height - 74),
  });

  const summaryLines = summarizeChartArtifactForExport(artifact);
  if (!summaryLines.length) {
    return;
  }

  context.fillStyle = '#475569';
  context.font = '600 13px Inter, Arial, sans-serif';
  summaryLines.slice(0, 3).forEach((line, index) => {
    context.fillText(String(line).slice(0, 48), body.x, rect.y + rect.h - 30 + index * 15);
  });
}

async function downloadCanvasAsJpg() {
  if (!refs.canvasStage || !state.canvasWidgets.length) {
    showToast('Canvas belum tersedia.');
    return;
  }

  const pageItems = state.canvasWidgets
    .filter((widget) => Number(widget.layout?.page || 1) === state.canvasPage)
    .map((widget) => ({
      ...widget,
      layout: normalizeLayout(widget.layout || {}, state.canvasPage, widget.artifact?.kind),
    }));

  if (!pageItems.length) {
    showToast('Halaman ini belum memiliki widget untuk diexport.');
    return;
  }

  try {
    const pngBlob = await apiBlob('/api/dashboards/render-image', {
      method: 'POST',
      body: JSON.stringify({
        title: state.draftDashboard?.name || state.currentDashboard?.name || 'Dashboard Vistara',
        page: state.canvasPage,
        widgets: pageItems,
      }),
    });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw createAppError('Browser tidak mendukung export JPG.', {
        code: 'DASHBOARD_EXPORT_UNSUPPORTED',
      });
    }

    if (typeof createImageBitmap === 'function') {
      const imageBitmap = await createImageBitmap(pngBlob);
      try {
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(imageBitmap, 0, 0);
      } finally {
        if (typeof imageBitmap.close === 'function') {
          imageBitmap.close();
        }
      }
    } else {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(createAppError('Gagal memuat render dashboard.', {
          code: 'DASHBOARD_RENDER_FAILED',
        }));
        reader.readAsDataURL(pngBlob);
      });
      const image = await new Promise((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(createAppError('Gagal memuat render dashboard.', {
          code: 'DASHBOARD_RENDER_FAILED',
        }));
        nextImage.src = dataUrl;
      });
      canvas.width = image.width;
      canvas.height = image.height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
    }

    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/jpeg', 0.94);
    anchor.download = `vistara-dashboard-hal-${state.canvasPage}.jpg`;
    anchor.click();
    showToast('JPG dashboard berhasil diunduh.');
  } catch (error) {
    showToast(error?.message || 'Gagal membuat export JPG dashboard.');
  }
}

async function persistDraftDashboard() {
  if (!state.canvasWidgets.length) {
    showToast('Belum ada draft dashboard untuk disimpan.');
    return;
  }

  const draft = buildDraftDashboardFromCanvas({
    status: 'ready',
  });
  const targetDashboard = state.currentDashboard?.id
    ? state.currentDashboard
    : (draft.saved_dashboard_id ? { id: draft.saved_dashboard_id, name: draft.name } : null);

  try {
    let saved;
    if (targetDashboard?.id) {
      saved = await api(`/api/dashboards/${targetDashboard.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: draft.name || targetDashboard.name || 'Dashboard Utama',
          config: getCanvasConfig(),
        }),
      });
    } else {
      saved = await api('/api/dashboards', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name || 'Dashboard Utama',
          config: getCanvasConfig(),
          conversation_id: state.conversationId || null,
        }),
      });
    }

    state.currentDashboard = saved.dashboard;
    upsertDashboardRecord(saved.dashboard);
    state.selectedDashboardId = saved.dashboard?.id || state.selectedDashboardId;
    state.draftDashboard = {
      ...draft,
      saved_dashboard_id: saved.dashboard?.id || draft.saved_dashboard_id || null,
      updated_at: new Date().toISOString(),
    };
    state.draftSaveDirty = false;
    renderDashboardList();
    updateChatHeader();
    showToast('Draft dashboard berhasil disimpan.');
  } catch (error) {
    showToast(`Gagal simpan dashboard: ${error.message}`);
  }
}

function bindHintTooltips() {
  document.querySelectorAll('[data-tip]').forEach((node) => {
    if (!(node instanceof HTMLElement) || node.dataset.tipBound === 'true') {
      return;
    }
    node.dataset.tipBound = 'true';

    let timer = null;
    const clearTimer = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    node.addEventListener('pointerdown', () => {
      clearTimer();
      timer = window.setTimeout(() => {
        const text = node.getAttribute('data-tip');
        if (text) {
          showToast(text, 1800);
        }
      }, 480);
    });
    node.addEventListener('pointerup', clearTimer);
    node.addEventListener('pointerleave', clearTimer);
    node.addEventListener('pointercancel', clearTimer);
  });
}

async function loadWorkspace() {
  await Promise.allSettled([refreshProfile(), refreshSources(), refreshDashboards(), refreshConversationList(), loadSchema()]);
  await refreshVerdict();
  const initialConversationId = resolveInitialConversationId(state.conversations);
  if (initialConversationId) {
    await refreshChatHistory(initialConversationId);
  } else {
    resetConversationWorkspaceState({ preserveDashboard: true });
  }
  state.workspaceLoaded = true;
  ensureWelcomeMessage();
}

async function handleRouteNavigation(pathname = window.location.pathname, options = {}) {
  const rawRequestedPage = pageFromPath(pathname);
  let requestedPage = resolveAccessiblePage({
    requestedPage: rawRequestedPage,
    isAuthenticated: Boolean(state.token),
    contextComplete: isContextComplete(state.profile),
  });

  if (!state.token) {
    showPage(requestedPage, {
      replace: options.replace === true || requestedPage !== rawRequestedPage,
      scrollTop: requestedPage === 'landing',
    });
    if (requestedPage === 'auth' && options.preserveAuthTab !== true) {
      switchAuthTab('login');
    }
    return;
  }

  if (!state.profile) {
    try {
      await refreshProfile();
      requestedPage = resolveAccessiblePage({
        requestedPage: rawRequestedPage,
        isAuthenticated: true,
        contextComplete: isContextComplete(state.profile),
      });
    } catch {
      setAuth('', null, {
        persist: false,
        isDemo: false,
      });
      state.workspaceLoaded = false;
      showPage('landing', { replace: true });
      return;
    }
  }

  if (requestedPage === 'landing') {
    showPage('landing', {
      replace: options.replace === true,
      scrollTop: options.scrollTop !== false,
    });
    return;
  }

  if (requestedPage === 'auth') {
    if (!isContextComplete(state.profile)) {
      showPage('context', { replace: true });
      return;
    }
    showPage('workspace', { replace: true });
    await ensureWorkspaceLoaded();
    setSessionRailCollapsed(true);
    return;
  }

  if (requestedPage === 'context') {
    showPage('context', {
      replace: options.replace === true,
    });
    return;
  }

  if (!isContextComplete(state.profile)) {
    showPage('context', { replace: true });
    return;
  }

  showPage('workspace', {
    replace: options.replace === true,
  });
  await ensureWorkspaceLoaded();
  if (options.keepSessionRail !== true) {
    setSessionRailCollapsed(true);
  }
}

refs.chatInput.addEventListener('input', () => {
  refs.chatInput.style.height = 'auto';
  refs.chatInput.style.height = `${Math.min(refs.chatInput.scrollHeight, 180)}px`;
});

refs.chatFile.addEventListener('change', () => {
  const file = refs.chatFile.files[0];
  if (refs.fileLabel) {
    refs.fileLabel.hidden = !file;
    refs.fileLabel.textContent = file ? file.name : 'Tidak ada file';
  }
  syncComposerChrome();

  if (!file) {
    return;
  }

  const userText = refs.chatInput?.value?.trim() || '';
  if (!userText && !state.isUploadingDataset) {
    (async () => {
      try {
        await uploadDataset({ file });
      } catch (error) {
        showToast(`Upload gagal: ${error.message}`);
      } finally {
        refs.chatFile.value = '';
        if (refs.fileLabel) {
          refs.fileLabel.textContent = 'Tidak ada file';
          refs.fileLabel.hidden = true;
        }
      }
    })();
  }
});

refs.gateUploadInput?.addEventListener('change', () => {
  const file = refs.gateUploadInput.files[0];
  if (refs.gateUploadName) {
    refs.gateUploadName.hidden = !file;
    refs.gateUploadName.textContent = file ? file.name : '';
  }
});

refs.gateUploadPickerBtn?.addEventListener('click', () => {
  refs.gateUploadInput?.click();
});

refs.chatFileBtn?.addEventListener('click', () => {
  refs.chatFile?.click();
});

refs.loginPasswordToggle?.addEventListener('click', () => {
  togglePasswordVisibility(refs.loginPasswordInput, refs.loginPasswordToggle);
});

refs.registerPasswordToggle?.addEventListener('click', () => {
  togglePasswordVisibility(refs.registerPasswordInput, refs.registerPasswordToggle);
});

if (refs.newSessionBtn) {
  refs.newSessionBtn.addEventListener('click', async () => {
    try {
      await startNewConversation();
      showToast('Chat baru siap.');
      refs.chatInput?.focus();
    } catch (error) {
      showToast(error.message);
    }
  });
}

if (refs.sessionRailToggleBtn) {
  refs.sessionRailToggleBtn.addEventListener('click', () => {
    setSessionRailCollapsed(!state.sessionRailCollapsed);
  });
}

if (refs.sessionRailPeekBtn) {
  refs.sessionRailPeekBtn.addEventListener('click', () => {
    setSessionRailCollapsed(!state.sessionRailCollapsed);
    if (!state.sessionRailCollapsed) {
      refs.newSessionBtn?.focus();
    }
  });
}

if (refs.brandHomeLink) {
  refs.brandHomeLink.addEventListener('click', (event) => {
    event.preventDefault();
    setCanvasOpen(false);
    void handleRouteNavigation(pathFromPage('landing'), {
      scrollTop: true,
    });
  });
}

if (refs.openCanvasBtn) {
  refs.openCanvasBtn.addEventListener('click', () => {
    if (Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0) {
      state.canvasViewportMovedByUser = false;
      setCanvasOpen(!state.canvasOpen);
      if (state.canvasOpen) {
        queueCanvasStageCenter({ force: true });
      }
    }
  });
}

refs.gateUploadBtn.addEventListener('click', async () => {
  const file = refs.gateUploadInput.files[0];
  if (!file) {
    return showToast('Pilih file dataset dulu.');
  }

  try {
    await uploadDataset({ file });
    refs.gateUploadInput.value = '';
    if (refs.gateUploadName) {
      refs.gateUploadName.hidden = true;
      refs.gateUploadName.textContent = '';
    }
  } catch (error) {
    showToast(error.message);
  }
});

refs.gateDemoBtn.addEventListener('click', async () => {
  try {
    await uploadDataset({ demo: true });
    if (refs.gateUploadName) {
      refs.gateUploadName.hidden = true;
      refs.gateUploadName.textContent = '';
    }
  } catch (error) {
    showToast(error.message);
  }
});

refs.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!state.token) {
    showPage('auth');
    return showToast('Login dulu.');
  }

  const userText = refs.chatInput.value.trim();
  const file = refs.chatFile.files[0] || null;

  if (!userText && !file) {
    return;
  }

  if (file) {
    try {
      await uploadDataset({ file, silent: Boolean(userText) });
    } catch (error) {
      showToast(`Upload gagal: ${error.message}`);
      return;
    } finally {
      refs.chatFile.value = '';
      if (refs.fileLabel) {
        refs.fileLabel.textContent = 'Tidak ada file';
        refs.fileLabel.hidden = true;
      }
    }
  }

  if (userText) {
    appendMessage({ role: 'user', content: userText, artifacts: [] });
    refs.chatInput.value = '';
    refs.chatInput.style.height = 'auto';
    await sendChatMessage(userText);
  }
});

if (refs.saveCanvasBtn) {
  refs.saveCanvasBtn.addEventListener('click', async () => {
    try {
      await downloadCanvasAsJpg();
    } catch (error) {
      showToast(`Gagal export JPG: ${error.message}`);
    }
  });
}

if (refs.persistDraftBtn) {
  refs.persistDraftBtn.addEventListener('click', async () => {
    await persistDraftDashboard();
  });
}

if (refs.canvasPrevPage) {
  refs.canvasPrevPage.addEventListener('click', () => {
    setCanvasPage(state.canvasPage - 1);
  });
}

if (refs.canvasNextPage) {
  refs.canvasNextPage.addEventListener('click', () => {
    setCanvasPage(state.canvasPage + 1);
  });
}

if (refs.canvasAddPage) {
  refs.canvasAddPage.addEventListener('click', () => {
    addCanvasPage();
  });
}

if (refs.addWidgetToolbar) {
  refs.addWidgetToolbar.addEventListener('click', () => {
    if (!state.editMode) {
      setEditMode(true);
    }
    openWidgetBuilder();
  });
}

if (refs.toggleDataPaneBtn) {
  refs.toggleDataPaneBtn.addEventListener('click', () => {
    setDataPaneCollapsed(!state.dataPaneCollapsed);
  });
}

if (refs.toggleConfigPaneBtn) {
  refs.toggleConfigPaneBtn.addEventListener('click', () => {
    setConfigPaneCollapsed(!state.configPaneCollapsed);
  });
}

if (refs.editModeBtn) {
  refs.editModeBtn.addEventListener('click', () => {
    setEditMode(!state.editMode);
  });
}

if (refs.floatingAddBtn) {
  refs.floatingAddBtn.addEventListener('click', () => {
    openWidgetBuilder();
  });
}

if (refs.widgetBuilderCloseBtn) {
  refs.widgetBuilderCloseBtn.addEventListener('click', () => {
    closeWidgetBuilder();
  });
}

if (refs.widgetBuilderBackdrop) {
  refs.widgetBuilderBackdrop.addEventListener('click', () => {
    closeWidgetBuilder();
  });
}

if (refs.widgetBuilderBackBtn) {
  refs.widgetBuilderBackBtn.addEventListener('click', () => {
    state.widgetBuilderStep = 'type';
    renderWidgetBuilder();
  });
}

if (refs.widgetBuilderNextBtn) {
  refs.widgetBuilderNextBtn.addEventListener('click', () => {
    if (state.widgetBuilderStep === 'type') {
      if (!state.widgetBuilderSelection.visualization) {
        showToast('Pilih jenis visual dulu.');
        return;
      }
      state.widgetBuilderStep = 'config';
      renderWidgetBuilder();
      return;
    }
    createWidgetFromBuilder();
  });
}

if (refs.zoomInBtn) {
  refs.zoomInBtn.addEventListener('click', () => {
    setStageZoom(state.stageZoom + ZOOM_STEP, { recenter: false });
  });
}

if (refs.zoomOutBtn) {
  refs.zoomOutBtn.addEventListener('click', () => {
    setStageZoom(state.stageZoom - ZOOM_STEP, { recenter: false });
  });
}

if (refs.zoomResetBtn) {
  refs.zoomResetBtn.addEventListener('click', () => {
    setStageZoom(1, { recenter: true });
  });
}

if (refs.canvasDeletePage) {
  refs.canvasDeletePage.addEventListener('click', () => {
    if (state.canvasPagesCount <= 1) {
      showToast('Tidak bisa menghapus halaman terakhir.');
      return;
    }
    if (typeof window.confirm === 'function' && !window.confirm(`Hapus halaman ${state.canvasPage}?`)) {
      return;
    }

    const pageToDelete = state.canvasPage;
    state.canvasWidgets = state.canvasWidgets.filter((w) => Number(w.layout?.page || 1) !== pageToDelete);

    state.canvasWidgets.forEach((w) => {
      const p = Number(w.layout?.page || 1);
      if (p > pageToDelete) {
        w.layout.page = p - 1;
      }
    });

    state.canvasPagesCount -= 1;
    if (state.canvasPage > state.canvasPagesCount) {
      state.canvasPage = state.canvasPagesCount;
    }

    renderCanvas();
    scheduleCanvasSave();
  });
}

if (refs.dashboardVersionsBtn) {
  refs.dashboardVersionsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const expanded = refs.dashboardVersionsBtn.getAttribute('aria-expanded') === 'true';
    refs.dashboardVersionsBtn.setAttribute('aria-expanded', String(!expanded));
    if (refs.dashboardList) {
      refs.dashboardList.classList.toggle('hidden', expanded);
    }
  });

  document.addEventListener('click', (event) => {
    if (refs.dashboardVersionsBtn && !refs.dashboardVersionsBtn.contains(event.target)) {
      refs.dashboardVersionsBtn.setAttribute('aria-expanded', 'false');
      if (refs.dashboardList) {
        refs.dashboardList.classList.add('hidden');
      }
    }
  });
}

window.addEventListener('resize', () => {
  syncAppHeaderOffset();
  applyWorkspaceSplitState();
  applyStageDimensions();
  syncGridBounds();
  queueCanvasStageCenter();
  queueCanvasArtifactRefresh();
  syncLandingScrollCue();
});

window.addEventListener('scroll', () => {
  syncLandingScrollCue();
}, { passive: true });

if (refs.configDataset) {
  refs.configDataset.addEventListener('change', () => {
    updateConfigDatasetOptions();
  });
}

if (refs.configForm) {
  refs.configForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.datasetReady) {
      setDatasetGateVisible(true);
      return showToast('Upload dataset dulu sebelum konfigurasi widget.');
    }

    const widget = state.canvasWidgets.find((item) => item.id === state.selectedWidgetId);
    if (!widget) {
      return showToast('Pilih widget dulu.');
    }

    const form = new FormData(refs.configForm);
    const payload = {
      title: form.get('title') || widget.title,
      dataset: form.get('dataset'),
      measure: form.get('measure'),
      group_by: form.get('group_by'),
      visualization: form.get('visualization'),
      time_period: form.get('time_period') || '30 hari terakhir',
      limit: Number(form.get('limit') || 12),
    };

    try {
      const result = await api('/api/data/query', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      widget.title = payload.title || result.artifact?.title || widget.title;
      widget.query = payload;
      widget.artifact = result.artifact || widget.artifact;

      renderCanvas();
      scheduleCanvasSave();
      showToast('Widget diperbarui.');
    } catch (error) {
      showToast(`Gagal membuat widget: ${error.message}`);
    }
  });
}

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', async () => {
    const prompt = button.getAttribute('data-prompt') || '';
    if (!prompt) return;

    if (!state.token) {
      showPage('auth', { replace: true });
      return showToast('Login dulu.');
    }

    appendMessage({ role: 'user', content: prompt, artifacts: [] });
    await sendChatMessage(prompt);
  });
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('.session-card-actions')) {
    return;
  }
  if (!state.openConversationMenuId) {
    return;
  }
  state.openConversationMenuId = null;
  renderConversationList();
});

if (refs.landingWelcomeCta) {
  refs.landingWelcomeCta.addEventListener('click', () => {
    routePrimaryEntry({ authTab: 'register' });
  });
}
if (refs.headerLoginBtn) {
  refs.headerLoginBtn.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('login');
    setOnboardingSlide(0);
  });
}
if (refs.headerCtaBtn) {
  refs.headerCtaBtn.addEventListener('click', () => {
    routePrimaryEntry({ authTab: 'register' });
  });
}
async function startDemoSession() {
  if (state.token) {
    routePrimaryEntry({ replace: true });
    return;
  }

  const originalText = refs.landingWelcomeDemo?.textContent || 'Coba Demo';
  if (refs.landingWelcomeDemo) {
    refs.landingWelcomeDemo.disabled = true;
    refs.landingWelcomeDemo.textContent = 'Menyiapkan Demo...';
  }

  const fallbackStart = async () => {
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      name: 'Demo User',
      email: `demo_${nonce}@guest.local`,
      password: `Demo_${nonce}!`,
      business_name: 'Demo Workspace',
      industry: 'Demo',
      city: 'Jakarta',
    };

    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    setAuth(registration.token, registration.user, {
      persist: false,
      isDemo: true,
    });

    await api('/api/business/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Demo Workspace',
        industry: 'Retail',
        city: 'Jakarta',
        timezone: 'Asia/Jakarta',
        currency: 'IDR',
        morning_verdict_time: '07:00',
      }),
    });

    await api('/api/data/demo/import', {
      method: 'POST',
    });
  };

  try {
    const response = await api('/api/auth/demo', {
      method: 'POST',
    });

    setAuth(response.token, response.user, {
      persist: false,
      isDemo: true,
    });

    state.workspaceLoaded = false;
    showPage('workspace', { replace: true });
    await ensureWorkspaceLoaded({ force: true });
    setCanvasOpen(false);
    setSessionRailCollapsed(true);
    showToast('Demo siap. Login jika ingin simpan histori permanen.');
  } catch (error) {
    try {
      await fallbackStart();
      state.workspaceLoaded = false;
      showPage('workspace', { replace: true });
      await ensureWorkspaceLoaded({ force: true });
      setCanvasOpen(false);
      setSessionRailCollapsed(true);
      showToast('Demo siap. Login jika ingin simpan histori permanen.');
    } catch (fallbackError) {
      showToast(`Gagal masuk demo: ${fallbackError.message || error.message}`);
    }
  } finally {
    if (refs.landingWelcomeDemo) {
      refs.landingWelcomeDemo.disabled = false;
      refs.landingWelcomeDemo.textContent = originalText;
    }
  }
}

if (refs.landingWelcomeDemo) {
  refs.landingWelcomeDemo.addEventListener('click', () => {
    startDemoSession();
  });
}

if (refs.landingTryNowBtn) {
  refs.landingTryNowBtn.addEventListener('click', () => {
    routePrimaryEntry({ authTab: 'register' });
  });
}

if (refs.themeToggle) {
  refs.themeToggle.addEventListener('click', toggleTheme);
}

if (refs.headerSettingsBtn) {
  refs.headerSettingsBtn.addEventListener('click', () => {
    syncSettingsForm();
    setSettingsOpen(true, { group: 'user' });
  });
}

if (refs.settingsCloseBtn) {
  refs.settingsCloseBtn.addEventListener('click', () => {
    setSettingsOpen(false);
  });
}

if (refs.settingsBackdrop) {
  refs.settingsBackdrop.addEventListener('click', () => {
    setSettingsOpen(false);
  });
}

if (refs.settingsResetBtn) {
  refs.settingsResetBtn.addEventListener('click', () => {
    applySettings({ ...DEFAULT_SETTINGS });
    setSettingsGroup('user');
    refreshWelcomeGreeting();
    showToast('Pengaturan dikembalikan ke default.');
  });
}

if (refs.settingsForm) {
  refs.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(refs.settingsForm);
    const payload = Object.fromEntries(formData.entries());
    applySettings(payload);

    if (state.token) {
      try {
        const profilePayload = {
          name: String(payload.business_name || state.profile?.name || '').trim() || state.profile?.name || '',
          industry: String(payload.business_industry || state.profile?.industry || '').trim(),
          city: String(payload.business_city || state.profile?.city || '').trim(),
          timezone: String(payload.business_timezone || state.profile?.timezone || 'Asia/Jakarta').trim() || 'Asia/Jakarta',
          currency: String(payload.business_currency || state.profile?.currency || 'IDR').trim() || 'IDR',
          morning_verdict_time: String(payload.business_verdict_time || state.profile?.morning_verdict_time || '07:00').trim() || '07:00',
        };

        const response = await api('/api/business/profile', {
          method: 'PUT',
          body: JSON.stringify(profilePayload),
        });
        state.profile = response.profile;
        fillContextForm(state.profile);
        syncBusinessSettingsFields();
      } catch (error) {
        showToast(`Gagal memperbarui business context: ${error.message}`);
        return;
      }
    }

    refreshWelcomeGreeting();
    setSettingsOpen(false);
    showToast('Pengaturan berhasil disimpan.');
  });
}

refs.settingsGroupUserBtn?.addEventListener('click', () => {
  setSettingsGroup('user');
});

refs.settingsGroupAgentBtn?.addEventListener('click', () => {
  setSettingsGroup('agent');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.settingsOpen) {
    setSettingsOpen(false);
    return;
  }
  if (event.key === 'Escape' && !state.sessionRailCollapsed) {
    setSessionRailCollapsed(true);
  }
});

refs.authTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-auth-tab]');
  if (!button) {
    return;
  }
  switchAuthTab(button.dataset.authTab);
  setOnboardingSlide(0);
});

refs.authOnboardingDots.forEach((button) => {
  button.addEventListener('click', () => {
    setOnboardingSlide(Number(button.dataset.onboardingDot || 0));
  });
});

refs.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(refs.loginForm);

  try {
    const response = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
      }),
    });

    setAuth(response.token, response.user, {
      persist: true,
      isDemo: false,
    });
    state.workspaceLoaded = false;

    try {
      await refreshProfile();
    } catch {
      state.profile = null;
    }

    if (!isContextComplete(state.profile)) {
      showPage('context');
      showToast('Lengkapi business context dulu.');
    } else {
      showPage('workspace');
      await ensureWorkspaceLoaded();
      setSessionRailCollapsed(true);
      setCanvasOpen(false);
      showToast('Workspace siap.');
    }
  } catch (error) {
    showToast(error.message);
  }
});

refs.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(refs.registerForm).entries());

  try {
    const response = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    setAuth(response.token, response.user, {
      persist: true,
      isDemo: false,
    });

    fillContextForm({
      name: payload.business_name || '',
      industry: payload.industry || '',
      city: payload.city || '',
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      morning_verdict_time: '07:00',
    });

    showPage('context', { replace: true });
    showToast('Akun dibuat. Lengkapi business context.');
  } catch (error) {
    showToast(error.message);
  }
});

refs.contextForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!state.token) {
    showPage('auth');
    return showToast('Session tidak ditemukan. Login ulang.');
  }

  const payload = Object.fromEntries(new FormData(refs.contextForm).entries());

  try {
    const response = await api('/api/business/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    state.profile = response.profile;
    state.workspaceLoaded = false;
    showPage('workspace');
    await ensureWorkspaceLoaded();
    setSessionRailCollapsed(true);
    setCanvasOpen(false);
    showToast('Workspace siap digunakan.');
  } catch (error) {
    showToast(error.message);
  }
});

if (refs.editProfileBtn) {
  refs.editProfileBtn.addEventListener('click', async () => {
    if (!state.token) {
      return showPage('auth');
    }
    try {
      await refreshProfile();
    } catch {
      // continue with current state
    }
    syncSettingsForm();
    setSettingsOpen(true, { group: 'user' });
  });
}

refs.logoutBtn.addEventListener('click', () => {
  setAuth('', null, {
    persist: false,
    isDemo: false,
  });
  state.profile = null;
  state.conversationId = null;
  state.conversationTitle = 'Percakapan baru';
  state.conversations = [];
  state.messages = [];
  state.dashboards = [];
  state.selectedDashboardId = null;
  state.currentDashboard = null;
  state.draftDashboard = null;
  state.canvasWidgets = [];
  state.canvasPage = 1;
  state.canvasPagesCount = 1;
  state.workspaceLoaded = false;
  state.isWorkspaceBooting = false;
  state.datasetReady = false;
  state.dataPaneCollapsed = true;
  state.configPaneCollapsed = true;
  state.canvasViewportMovedByUser = false;
  state.canvasAutoCenteredRunId = null;
  state.draftSaveDirty = false;
  state.timelineRunId = null;
  state.timelineMessageId = null;
  renderDashboardList();

  if (state.grid) {
    if (typeof state.grid.destroy === 'function') {
      state.grid.destroy();
    }
    state.grid = null;
    refs.canvasGrid.innerHTML = '';
  }

  setSettingsOpen(false);
  setCanvasOpen(false);
  setSessionRailCollapsed(true);

  renderThread();
  renderConversationList();
  if (refs.sourceStats) {
    refs.sourceStats.textContent = 'Data: 0 source';
  }
  if (refs.verdictBadge) {
    refs.verdictBadge.textContent = 'Verdict: belum tersedia';
  }
  showPage('landing', { replace: true });
  stopPreChatTicker();
  showToast('Logout berhasil.');
});

async function bootstrap() {
  applySettings(readSettings(), { persist: false });
  syncAppHeaderOffset();
  bindPanelDivider();
  bindCanvasViewportPan();
  applyStageDimensions();
  queueCanvasStageCenter();
  setSessionRailCollapsed(true);
  syncSettingsGroupUi();
  updateCanvasPaneState();
  applyWorkspaceSplitState();
  setEditMode(false);
  bindHintTooltips();
  switchAuthTab('login');
  setOnboardingSlide(0);
  setCanvasOpen(false);
  updateCanvasPagination();
  setAuth(state.token, null, {
    persist: true,
    isDemo: false,
  });
  await handleRouteNavigation(window.location.pathname, {
    replace: pageFromPath(window.location.pathname) !== 'landing',
    scrollTop: false,
  });
  if (state.token && state.workspaceLoaded && state.conversations.length > 0) {
    showToast('Session dipulihkan.');
  }
}

const prefersDarkQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

if (prefersDarkQuery && typeof prefersDarkQuery.addEventListener === 'function') {
  prefersDarkQuery.addEventListener('change', () => {
    if (state.settings.theme_mode === 'system') {
      setTheme('system');
    }
  });
}

window.addEventListener('popstate', () => {
  void handleRouteNavigation(window.location.pathname, {
    replace: false,
    scrollTop: false,
    keepSessionRail: true,
    preserveAuthTab: true,
  });
});

// Listen for dashboard switch events from the new dashboard switcher module
document.addEventListener('vistara:switch-dashboard', (event) => {
  const dashboardId = event.detail?.dashboardId;
  if (!dashboardId || dashboardId === state.selectedDashboardId) return;
  state.selectedDashboardId = dashboardId;
  syncSelectedDashboard();
  applySelectedDashboardToCanvas();
  renderDashboardList();
  if (Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0) {
    state.canvasViewportMovedByUser = false;
    setCanvasOpen(true);
    queueCanvasStageCenter({ force: true });
  }
});

bootstrap();
