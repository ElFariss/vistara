import { renderArtifact } from './vendor/chart-lite.js?v=20260307c';
import { createGridStackLite } from './vendor/gridstack-lite.js?v=20260307e';
import {
  getChatHeaderState,
  resolveInitialConversationId,
  resolveNextConversationIdAfterDelete,
} from './workspaceState.mjs?v=20260308a';

const GRID_COLS = 16;
const GRID_ROWS = 9;
const GRID_GAP = 10;
const MOBILE_BREAKPOINT = 768;
const MAX_LAYOUT_ROWS = 240;
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

const DEFAULT_SETTINGS = {
  theme_mode: 'light',
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
  conversations: [],
  messages: [],
  currentDashboard: null,
  canvasWidgets: [],
  datasetReady: false,
  schema: null,
  grid: null,
  isDemoSession: false,
  canvasOpen: false,
  selectedWidgetId: null,
  editMode: false,
  timelineMessageId: null,
  timelineRunId: null,
  canvasPage: 1,
  canvasPagesCount: 1,
  canvasWidthPct: DEFAULT_CANVAS_PCT,
  isResizingPanels: false,
  stageZoom: 1,
  settings: { ...DEFAULT_SETTINGS },
  settingsOpen: false,
  dataPaneCollapsed: false,
  configPaneCollapsed: true,
  preChatTickerIndex: 0,
  preChatTickerInterval: null,
  preChatTickerSwapTimer: null,
  preChatTickerKey: '',
  isProgrammaticGridUpdate: false,
  isRenderingCanvas: false,
  landingRevealObserver: null,
};

const refs = {
  appShell: document.querySelector('.app-shell'),
  headerLoginBtn: document.getElementById('headerLoginBtn'),
  headerCtaBtn: document.getElementById('headerCtaBtn'),
  headerSettingsBtn: document.getElementById('headerSettingsBtn'),
  editProfileBtn: document.getElementById('editProfileBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  themeToggle: document.getElementById('themeToggle'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsForm: document.getElementById('settingsForm'),
  settingsResetBtn: document.getElementById('settingsResetBtn'),
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

  landingCta: document.getElementById('landingCta'),
  landingWelcomeCta: document.getElementById('landingWelcomeCta'),
  landingWelcomeDemo: document.getElementById('landingWelcomeDemo'),
  landingCtaBottom: document.getElementById('landingCtaBottom'),
  landingDemo: document.getElementById('landingDemo'),
  landingTryNowBtn: document.getElementById('landingTryNowBtn'),
  landingScrollCue: document.getElementById('landingScrollCue'),
  landingHeroStart: document.getElementById('landingHeroStart'),

  authTabs: document.getElementById('authTabs'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  contextForm: document.getElementById('contextForm'),

  sessionRail: document.getElementById('sessionRail'),
  sessionList: document.getElementById('sessionList'),
  newSessionBtn: document.getElementById('newSessionBtn'),

  chatPane: document.getElementById('chatPane'),
  chatTitle: document.getElementById('chatTitle'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  openCanvasBtn: document.getElementById('openCanvasBtn'),
  workspaceShell: document.querySelector('.workspace-shell'),
  panelDivider: document.getElementById('panelDivider'),
  canvasPane: document.getElementById('canvasPane'),
  canvasShell: document.querySelector('.canvas-shell'),
  canvasViewport: document.getElementById('canvasViewport'),
  canvasWorld: document.getElementById('canvasWorld'),

  dataGate: document.getElementById('dataGate'),
  gateUploadInput: document.getElementById('gateUploadInput'),
  gateUploadBtn: document.getElementById('gateUploadBtn'),
  gateDemoBtn: document.getElementById('gateDemoBtn'),

  chatMessages: document.getElementById('chatMessages'),
  preChatTicker: document.getElementById('preChatTicker'),
  typingIndicator: document.getElementById('typingIndicator'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  chatFile: document.getElementById('chatFile'),
  fileLabel: document.getElementById('fileLabel'),

  saveCanvasBtn: document.getElementById('saveCanvasBtn'),
  closeCanvasBtn: document.getElementById('closeCanvasBtn'),
  toggleDataPaneBtn: document.getElementById('toggleDataPaneBtn'),
  toggleConfigPaneBtn: document.getElementById('toggleConfigPaneBtn'),
  addWidgetToolbar: document.getElementById('addWidgetToolbar'),
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

function setTheme(mode) {
  const root = document.documentElement;
  const next = resolveThemeMode(mode || 'light');
  root.setAttribute('data-theme', next);
  document.dispatchEvent(new CustomEvent('vistara:theme-change', {
    detail: { theme: next },
  }));
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

function setSettingsOpen(open) {
  state.settingsOpen = Boolean(open);
  refs.settingsBackdrop?.classList.toggle('hidden', !state.settingsOpen);
  refs.settingsPanel?.classList.toggle('hidden', !state.settingsOpen);
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

  const shouldShow = Boolean(state.token) && state.messages.length === 0;

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
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      return await fetch(url, options);
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

async function api(path, options = {}) {
  const requestUrl = /^https?:\/\//i.test(path)
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetchWithRetry(requestUrl, {
    ...options,
    headers,
  }, {
    retries: 2,
    baseDelayMs: 550,
  });

  if (response.status === 204) {
    return { ok: true };
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(payload?.error?.message || response.statusText || 'Request gagal');
  }

  return payload;
}

function setAuth(token, user = null, options = {}) {
  const persist = options.persist !== false;
  const isDemo = Boolean(options.isDemo);

  state.token = token || '';
  state.user = user;
  state.isDemoSession = state.token ? isDemo : false;

  if (state.token) {
    if (persist) {
      localStorage.setItem('umkm_token', state.token);
    } else {
      localStorage.removeItem('umkm_token');
    }
    if (refs.logoutBtn) refs.logoutBtn.hidden = false;
    if (refs.editProfileBtn) refs.editProfileBtn.hidden = false;
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

const METRIC_SLOTS = [
  { x: 0, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { x: 4, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { x: 8, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
  { x: 12, y: 0, w: 4, h: 2, minW: 3, minH: 2 },
];

const VISUAL_SLOTS = [
  { x: 0, y: 2, w: 8, h: 3, minW: 5, minH: 3 },
  { x: 8, y: 2, w: 8, h: 3, minW: 5, minH: 3 },
  { x: 0, y: 5, w: 8, h: 4, minW: 5, minH: 3 },
  { x: 8, y: 5, w: 8, h: 4, minW: 5, minH: 3 },
];

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

function maxRowsForViewport() {
  return isMobileViewport() ? MAX_LAYOUT_ROWS : MAX_LAYOUT_ROWS;
}

function layoutIntersects(a, b) {
  if ((a.page || 1) !== (b.page || 1)) return false;
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function normalizeLayout(layout = {}, fallbackPage = 1) {
  const page = Math.max(1, Number(layout.page || fallbackPage || 1));
  const rowsLimit = maxRowsForViewport();
  const w = Math.max(1, Math.min(Number(layout.w || 4), GRID_COLS));
  const h = Math.max(1, Math.min(Number(layout.h || 4), rowsLimit));
  const x = Math.max(0, Math.min(Number(layout.x || 0), GRID_COLS - w));
  const y = Math.max(0, Math.min(Number(layout.y || 0), rowsLimit - h));
  const minW = Math.max(1, Math.min(Number(layout.minW || 2), w));
  const minH = Math.max(1, Math.min(Number(layout.minH || 2), h));
  return { x, y, w, h, page, minW, minH };
}

function layoutCandidates(kind = 'chart') {
  const metric = kind === 'metric';
  return metric ? [...METRIC_SLOTS, ...VISUAL_SLOTS] : [...VISUAL_SLOTS, ...METRIC_SLOTS];
}

function findOpenLayoutPosition(occupied = [], template = {}, page = 1) {
  const base = normalizeLayout({ ...template, page }, page);
  for (let y = 0; y <= Math.max(0, MAX_LAYOUT_ROWS - base.h); y += 1) {
    for (let x = 0; x <= Math.max(0, GRID_COLS - base.w); x += 1) {
      const candidate = normalizeLayout({ ...base, x, y, page }, page);
      if (!occupied.some((entry) => layoutIntersects(candidate, entry))) {
        return candidate;
      }
    }
  }
  return null;
}

function suggestedLayout(existingWidgets = [], kind = 'chart', preferredPage = 1) {
  const occupied = existingWidgets
    .map((item) => normalizeLayout(item.layout || {}, 1))
    .filter(Boolean);

  const maxPage = occupied.reduce((max, item) => Math.max(max, item.page || 1), preferredPage || 1);
  const candidates = layoutCandidates(kind);
  const page = Math.max(1, Number(preferredPage || 1));

  for (const slot of candidates) {
    const candidate = normalizeLayout({ ...slot, page }, page);
    if (!occupied.some((entry) => layoutIntersects(candidate, entry))) {
      return candidate;
    }
  }

  const fallbackTemplate = kind === 'metric' ? METRIC_SLOTS[0] : VISUAL_SLOTS[0];
  const scanned = findOpenLayoutPosition(occupied, fallbackTemplate, page);
  if (scanned) {
    return scanned;
  }

  return normalizeLayout({ ...fallbackTemplate, page: maxPage + 1 }, maxPage + 1);
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

function showPage(page) {
  refs.landingPage.classList.add('hidden');
  refs.authPage.classList.add('hidden');
  refs.contextPage.classList.add('hidden');
  refs.workspacePage.classList.add('hidden');
  refs.statusBar.classList.add('hidden');
  if (refs.appShell) {
    refs.appShell.classList.remove('workspace-active');
  }
  document.body.classList.remove('workspace-mode');

  if (page === 'landing') {
    refs.landingPage.classList.remove('hidden');
    initLandingReveal();
    return;
  }

  if (page === 'auth') {
    refs.authPage.classList.remove('hidden');
    return;
  }

  if (page === 'context') {
    refs.contextPage.classList.remove('hidden');
    return;
  }

  refs.workspacePage.classList.remove('hidden');
  refs.statusBar.classList.remove('hidden');
  if (refs.appShell) {
    refs.appShell.classList.add('workspace-active');
  }
  document.body.classList.add('workspace-mode');
}

function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tab);
  });

  refs.loginForm.classList.toggle('hidden', tab !== 'login');
  refs.registerForm.classList.toggle('hidden', tab !== 'register');
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
    applyStageDimensions();
    syncGridBounds();
    window.requestAnimationFrame(() => {
      centerCanvasStage();
    });
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
  }

  if (refs.toggleConfigPaneBtn) {
    refs.toggleConfigPaneBtn.setAttribute('aria-expanded', String(!state.configPaneCollapsed));
    refs.toggleConfigPaneBtn.classList.toggle('is-active', !state.configPaneCollapsed);
    refs.toggleConfigPaneBtn.setAttribute('title', state.configPaneCollapsed ? 'Buka Panel Konfigurasi' : 'Tutup Panel Konfigurasi');
    refs.toggleConfigPaneBtn.setAttribute('data-tip', state.configPaneCollapsed ? 'Buka Panel Konfigurasi' : 'Tutup Panel Konfigurasi');
  }
  bindHintTooltips();
}

function setDataPaneCollapsed(collapsed) {
  state.dataPaneCollapsed = Boolean(collapsed);
  updateCanvasPaneState();
  syncGridBounds();
}

function setConfigPaneCollapsed(collapsed) {
  state.configPaneCollapsed = Boolean(collapsed);
  updateCanvasPaneState();
  syncGridBounds();
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

function applyStageDimensions() {
  if (!refs.canvasStage || !refs.canvasWorld || !refs.canvasViewport) {
    return;
  }

  const width = Math.round(STAGE_BASE_WIDTH * state.stageZoom);
  const height = Math.round(STAGE_BASE_HEIGHT * state.stageZoom);
  const worldPad = Math.max(220, Math.round(Math.min(width, height) * 0.35));

  refs.canvasStage.style.width = `${width}px`;
  refs.canvasStage.style.height = `${height}px`;
  refs.canvasWorld.style.width = `${width + worldPad * 2}px`;
  refs.canvasWorld.style.height = `${height + worldPad * 2}px`;
  refs.canvasStage.style.left = `${worldPad}px`;
  refs.canvasStage.style.top = `${worldPad}px`;
  refs.canvasGrid.style.backgroundSize = `${Math.max(16, width / GRID_COLS)}px ${Math.max(16, height / GRID_ROWS)}px`;
  syncStageZoomLabel();
}

function centerCanvasStage() {
  if (!refs.canvasViewport || !refs.canvasWorld || !refs.canvasStage) {
    return;
  }
  if (window.innerWidth <= 1180) {
    refs.canvasViewport.scrollLeft = Math.max(0, refs.canvasStage.offsetLeft - 20);
    refs.canvasViewport.scrollTop = Math.max(0, refs.canvasStage.offsetTop - 20);
    return;
  }
  const centerX = Math.max(0, (refs.canvasWorld.clientWidth - refs.canvasViewport.clientWidth) / 2);
  const centerY = Math.max(0, (refs.canvasWorld.clientHeight - refs.canvasViewport.clientHeight) / 2);
  refs.canvasViewport.scrollLeft = centerX;
  refs.canvasViewport.scrollTop = centerY;
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
    centerCanvasStage();
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
  state.messages.push({
    id: message.id || generateMessageId(),
    role: message.role,
    content: message.content || '',
    fileName: message.fileName || null,
    mode: message.mode || 'chat',
    widgets: Array.isArray(message.widgets) ? message.widgets : [],
    artifacts: Array.isArray(message.artifacts) ? message.artifacts : [],
    timeline: message.timeline || null,
    collapsed: Boolean(message.collapsed),
    timelineRunId: message.timelineRunId || null,
  });

  renderThread();
}

function scrollToBottom() {
  refs.chatMessages.scrollTo({ top: refs.chatMessages.scrollHeight, behavior: 'smooth' });
}

function showTyping() {
  refs.typingIndicator.classList.remove('hidden');
  scrollToBottom();
}

function hideTyping() {
  refs.typingIndicator.classList.add('hidden');
}

function renderDashboardSummary(message) {
  const card = document.createElement('div');
  card.className = 'summary-card';

  const title = document.createElement('p');
  title.className = 'summary-title';
  const count = message.widgets?.length || 0;
  title.textContent = count > 0 ? `Dashboard siap (${count} widget).` : 'Dashboard siap.';
  card.append(title);

  const meta = document.createElement('span');
  meta.className = 'summary-meta';
  const detail = String(message.content || '').trim();
  meta.textContent = detail || 'Klik untuk membuka Canvas dan melihat detail visual.';
  card.append(meta);

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'summary-btn';
  openBtn.textContent = 'Buka Dashboard';
  openBtn.addEventListener('click', () => {
    if (Array.isArray(message.widgets) && message.widgets.length > 0) {
      state.canvasWidgets = normalizeIncomingWidgets(message.widgets);
      state.canvasPage = Math.max(1, Number(state.canvasWidgets[0]?.layout?.page || 1));
      renderCanvas();
      scheduleCanvasSave();
    }
    setCanvasOpen(true);
  });
  card.append(openBtn);

  return card;
}

function renderTimeline(message) {
  const wrap = document.createElement('div');
  wrap.className = 'timeline-card';

  const header = document.createElement('div');
  header.className = 'timeline-head';
  const title = document.createElement('strong');
  title.textContent = message.content || 'Agentic Thinking';
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

function renderThread() {
  refs.chatMessages.innerHTML = '';

  for (const message of state.messages) {
    const row = document.createElement('div');
    row.className = `msg ${message.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (message.mode === 'timeline') {
      bubble.append(renderTimeline(message));
      row.append(bubble);
      refs.chatMessages.append(row);
      continue;
    }

    if (message.mode !== 'canvas') {
      const text = document.createElement('div');
      text.innerHTML = escapeHtml(message.content).replace(/\n/g, '<br/>');
      bubble.append(text);
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
    if (!state.conversationId) {
      const empty = document.createElement('div');
      empty.className = 'thread-empty';
      empty.innerHTML = `
        <strong>Belum ada percakapan aktif.</strong>
        <span>Kirim pertanyaan pertama atau tekan "Chat Baru" kapan saja.</span>
      `;
      refs.chatMessages.append(empty);
    }
    refs.chatMessages.scrollTo({ top: 0 });
  }
  updatePreChatTicker();
  updateChatHeader();
}

function toMetricArtifact(widget) {
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
        value: item.total_revenue ?? item.revenue ?? item.value ?? 0,
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
  const normalized = [];

  for (let index = 0; index < inputWidgets.length; index += 1) {
    const widget = inputWidgets[index];
    if (widget.layout && widget.artifact) {
      normalized.push({
        id: widget.id || generateWidgetId(),
        title: widget.title || widget.artifact.title || `Widget ${index + 1}`,
        artifact: widget.artifact,
        query: widget.query || null,
        layout: normalizeLayout(widget.layout, Number(widget.layout.page || 1)),
      });
      continue;
    }

    const artifact = toMetricArtifact(widget);
    const layout = suggestedLayout(normalized, artifact.kind);

    normalized.push({
      id: widget.id || generateWidgetId(),
      title: widget.title || `Widget ${index + 1}`,
      artifact,
      query: null,
      layout,
    });
  }

  return normalized;
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
    }),
  });

  state.currentDashboard = created.dashboard;
  return state.currentDashboard;
}

let saveCanvasTimer = null;
function scheduleCanvasSave() {
  window.clearTimeout(saveCanvasTimer);
  saveCanvasTimer = window.setTimeout(async () => {
    try {
      const dashboard = await ensureDashboard();
      const updated = await api(`/api/dashboards/${dashboard.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: dashboard.name || 'Dashboard Utama',
          config: getCanvasConfig(),
        }),
      });
      state.currentDashboard = updated.dashboard;
      showToast('Layout canvas tersimpan.');
    } catch (error) {
      showToast(`Gagal simpan canvas: ${error.message}`);
    }
  }, 700);
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
        const currentLayout = normalizeLayout(widget.layout || {}, 1);
        const widgetId = String(widget.id || '');
        if ((currentLayout.page || 1) !== state.canvasPage) {
          return {
            ...widget,
            layout: currentLayout,
          };
        }
        return {
          ...widget,
          layout: normalizeLayout(map.get(widgetId) || currentLayout, state.canvasPage),
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
    window.requestAnimationFrame(() => {
      centerCanvasStage();
    });
  }
}

function updateCanvasPagination() {
  const total = allPages();
  state.canvasPagesCount = total;
  if (refs.canvasPageIndicator) {
    refs.canvasPageIndicator.textContent = `Hal ${state.canvasPage} / ${total}`;
  }
  if (refs.canvasPrevPage) {
    refs.canvasPrevPage.disabled = state.canvasPage <= 1;
  }
  if (refs.canvasNextPage) {
    refs.canvasNextPage.disabled = state.canvasPage >= total;
  }
}

function addCanvasPage() {
  const total = allPages();
  state.canvasPagesCount = total + 1;
  state.canvasPage = state.canvasPagesCount;
  state.selectedWidgetId = null;
  renderCanvas();
  if (state.canvasOpen) {
    window.requestAnimationFrame(() => {
      centerCanvasStage();
    });
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
        layout: normalizeLayout(widget.layout || {}, state.canvasPage),
      };
    });
}

function nextWidgetLayout(kind = 'chart') {
  return suggestedLayout(state.canvasWidgets, kind, state.canvasPage || 1);
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

function ensureTimeline(runId, title = 'Agentic Thinking') {
  if (!runId) return;
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
    content: title,
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
  const timeline = state.messages.find((entry) => entry.mode === 'timeline' && entry.timelineRunId === runId);
  if (!timeline || !Array.isArray(timeline.timeline)) {
    state.timelineMessageId = null;
    state.timelineRunId = null;
    return;
  }

  timeline.timeline = timeline.timeline.map((step) => ({
    ...step,
    status: step.status === 'error' ? 'error' : 'done',
  }));
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
  };
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

function removeWidgetById(widgetId) {
  const targetId = String(widgetId || '');
  if (!targetId) {
    return;
  }

  const activePage = state.canvasPage;
  let removed = false;
  let nextWidgets = state.canvasWidgets.filter((entry) => {
    const page = Number(entry.layout?.page || 1);
    if (page !== activePage) {
      return true;
    }
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
  state.isRenderingCanvas = true;
  try {
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
    const response = await api('/api/dashboards');
    state.currentDashboard = (response.dashboards || [])[0] || null;
    state.canvasPagesCount = Math.max(1, Number(state.currentDashboard?.config?.pages || 1));

    const components = state.currentDashboard?.config?.components;
    if (Array.isArray(components) && components.length > 0) {
      state.canvasWidgets = normalizeIncomingWidgets(components);
      const maxWidgetPage = state.canvasWidgets.reduce((max, widget) => Math.max(max, Number(widget.layout?.page || 1)), 1);
      state.canvasPagesCount = Math.max(state.canvasPagesCount, maxWidgetPage);
      state.canvasPage = Math.min(Math.max(1, state.canvasPage), state.canvasPagesCount);
      renderCanvas();
    } else {
      state.canvasWidgets = [];
      state.canvasPage = Math.min(Math.max(1, state.canvasPage), state.canvasPagesCount);
      renderCanvas();
    }
  } catch {
    state.currentDashboard = null;
    state.canvasPagesCount = Math.max(1, state.canvasPagesCount || 1);
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
  if (!state.datasetReady) {
    if (refs.verdictBadge) {
      refs.verdictBadge.className = 'verdict-badge';
      refs.verdictBadge.textContent = 'Verdict: menunggu dataset';
    }
    return;
  }

  try {
    const response = await api('/api/insights/verdict');
    const verdict = response.verdict;

    if (refs.verdictBadge) {
      refs.verdictBadge.className = 'verdict-badge';
      if (verdict.status === 'SEHAT') {
        refs.verdictBadge.classList.add('ok');
      } else if (verdict.status === 'WASPADA') {
        refs.verdictBadge.classList.add('warn');
      } else {
        refs.verdictBadge.classList.add('critical');
      }

      refs.verdictBadge.textContent = `Verdict ${verdict.status}: ${verdict.sentence}`;
    }
  } catch {
    if (refs.verdictBadge) {
      refs.verdictBadge.className = 'verdict-badge';
      refs.verdictBadge.textContent = 'Verdict: belum tersedia';
    }
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
    updateChatHeader();
  } catch {
    state.datasetReady = false;
    if (refs.sourceStats) {
      refs.sourceStats.textContent = 'Data: tidak dapat dimuat';
    }
    setDatasetGateVisible(true);
    updateChatHeader();
  }
}

function conversationPreviewText(conversation) {
  const preview = String(conversation?.last_message_preview || '').trim();
  if (preview) {
    return preview.length > 72 ? `${preview.slice(0, 69).trimEnd()}...` : preview;
  }
  return 'Belum ada pesan. Mulai dengan pertanyaan sederhana.';
}

function formatConversationMeta(value) {
  if (!value) {
    return 'Baru saja';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Baru saja';
  }
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) {
    return 'Baru saja';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} menit lalu`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} jam lalu`;
  }
  const diffDays = Math.round(diffHours / 24);
  if (diffDays <= 6) {
    return `${diffDays} hari lalu`;
  }
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function updateChatHeader() {
  const activeConversation = state.conversations.find((item) => item.id === state.conversationId) || null;
  const headerState = getChatHeaderState({
    activeConversation,
    fallbackTitle: state.conversationTitle,
    hasDatasetReady: state.datasetReady,
    conversationCount: state.conversations.length,
  });
  if (refs.chatTitle) {
    refs.chatTitle.textContent = headerState.title;
  }
  if (refs.chatSubtitle) {
    refs.chatSubtitle.textContent = headerState.subtitle;
  }
  if (refs.openCanvasBtn) {
    refs.openCanvasBtn.hidden = !(Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0);
  }
}

function resetConversationWorkspaceState({ conversationId = null, conversationTitle = '' } = {}) {
  state.conversationId = conversationId;
  state.conversationTitle = conversationTitle;
  state.messages = [];
  state.timelineRunId = null;
  state.timelineMessageId = null;
  state.currentDashboard = null;
  state.canvasWidgets = [];
  state.canvasPage = 1;
  state.canvasPagesCount = 1;
  state.selectedWidgetId = null;
  setCanvasOpen(false);
  renderCanvas();
  renderThread();
  updateChatHeader();
}

function renderConversationList() {
  if (!refs.sessionList) {
    return;
  }

  if (!state.conversations.length) {
    refs.sessionList.innerHTML = `
      <div class="session-empty">
        <strong>Belum ada riwayat.</strong>
        <span>Tekan "Chat Baru" lalu mulai bertanya.</span>
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
      if (conversation.id === state.conversationId) {
        return;
      }
      try {
        await loadConversation(conversation.id);
      } catch (error) {
        showToast(error.message);
      }
    });

    const titleRow = document.createElement('span');
    titleRow.className = 'session-card-title-row';

    const title = document.createElement('span');
    title.className = 'session-card-title';
    title.textContent = conversation.title || 'Percakapan baru';

    const time = document.createElement('span');
    time.className = 'session-card-time';
    time.textContent = formatConversationMeta(conversation.last_message_at || conversation.created_at);

    const preview = document.createElement('span');
    preview.className = 'session-card-preview';
    preview.textContent = conversationPreviewText(conversation);

    const meta = document.createElement('div');
    meta.className = 'session-card-meta';

    const count = document.createElement('span');
    count.className = 'session-card-count';
    count.textContent = `${Number(conversation.message_count || 0)} pesan`;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ghost session-card-delete';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(`Hapus percakapan "${conversation.title || 'Percakapan baru'}"?`);
      if (!confirmed) {
        return;
      }
      try {
        await deleteConversationById(conversation.id);
      } catch (error) {
        showToast(error.message);
      }
    });

    titleRow.append(title, time);
    openBtn.append(titleRow, preview);
    meta.append(count, deleteBtn);
    card.append(openBtn, meta);
    refs.sessionList.append(card);
  });

  updateChatHeader();
}

function upsertConversation(conversation) {
  if (!conversation?.id) {
    return;
  }
  const nextConversation = {
    ...conversation,
    title: conversation.title || 'Percakapan baru',
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
    state.conversationTitle = nextConversation.title;
  }

  renderConversationList();
}

async function refreshConversationList() {
  const response = await api('/api/chat/conversations');
  state.conversations = Array.isArray(response.conversations) ? response.conversations : [];
  renderConversationList();
}

async function refreshChatHistory(conversationId = state.conversationId) {
  const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
  const response = await api(`/api/chat/history${query}`);
  state.conversationId = response.conversation_id;
  state.conversationTitle = response.conversation?.title || 'Percakapan baru';
  upsertConversation(response.conversation);

  state.messages = (response.messages || [])
    .map((item) => {
      const payload = item.payload || {};
      return {
        role: item.role,
        content: item.content,
        artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
        widgets: Array.isArray(payload.widgets) ? payload.widgets : [],
        mode: payload.presentation_mode || 'chat',
        fileName: null,
      };
    })
    .filter((entry) => !(entry.role === 'assistant' && entry.mode === 'chat' && /^selamat datang/i.test(entry.content || '')));

  const lastCanvas = [...state.messages]
    .reverse()
    .find((item) => item.mode === 'canvas' && Array.isArray(item.widgets) && item.widgets.length > 0);

  if (lastCanvas) {
    state.canvasWidgets = normalizeIncomingWidgets(lastCanvas.widgets);
    state.canvasPagesCount = Math.max(
      state.canvasPagesCount,
      state.canvasWidgets.reduce((max, widget) => Math.max(max, Number(widget.layout?.page || 1)), 1),
    );
    state.canvasPage = 1;
    renderCanvas();
  } else {
    state.canvasWidgets = [];
    state.canvasPagesCount = 1;
    state.canvasPage = 1;
    renderCanvas();
  }

  renderThread();
  updateChatHeader();
}

async function loadConversation(conversationId) {
  setCanvasOpen(false);
  await refreshChatHistory(conversationId);
}

async function startNewConversation() {
  const response = await api('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  resetConversationWorkspaceState({
    conversationId: response.conversation?.id || null,
    conversationTitle: response.conversation?.title || 'Percakapan baru',
  });
  upsertConversation(response.conversation);
  ensureWelcomeMessage();
}

async function deleteConversationById(conversationId) {
  await api(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });

  state.conversations = state.conversations.filter((item) => item.id !== conversationId);
  const nextConversationId = resolveNextConversationIdAfterDelete({
    activeConversationId: state.conversationId,
    deletedConversationId: conversationId,
    remainingConversations: state.conversations,
  });

  if (nextConversationId) {
    await loadConversation(nextConversationId);
  } else {
    resetConversationWorkspaceState();
    ensureWelcomeMessage();
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
    populateSchemaOptions();
    renderDataFields();
  } catch {
    state.schema = null;
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
      : ['metric', 'bar', 'line', 'pie', 'table'];
    for (const value of list) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value.toUpperCase();
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

  let response;
  if (demo) {
    response = await api('/api/data/demo/import', {
      method: 'POST',
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

  showToast(demo ? 'Demo dataset berhasil diimport.' : 'Dataset berhasil diupload.');
  return response;
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
  ensureTimeline(runId, 'Agentic Thinking');
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

function applyAssistantResponse(response, options = {}) {
  state.conversationId = response.conversation_id;
  state.conversationTitle = response.conversation?.title || state.conversationTitle || 'Percakapan baru';
  upsertConversation(response.conversation);
  if (response.dashboard) {
    state.currentDashboard = response.dashboard;
  }

  if (options.needsTimeline && !options.skipTraceHydration && !state.timelineRunId) {
    hydrateTimelineFromTrace(response.agent);
  }

  const widgets = response.widgets || [];
  const artifacts = response.artifacts || [];
  const mode = response.presentation_mode || 'chat';
  const isSingleWidget = Array.isArray(widgets) && widgets.length === 1;
  const isSingleArtifact = !isSingleWidget && Array.isArray(artifacts) && artifacts.length === 1;

  if (isSingleWidget) {
    const normalized = normalizeIncomingWidgets(widgets)[0];
    appendMessage({
      role: 'assistant',
      content: response.answer || 'Berikut insight cepat.',
      mode: 'chat',
      widgets: [],
      artifacts: [normalized.artifact],
    });
    return;
  }

  if (isSingleArtifact) {
    appendMessage({
      role: 'assistant',
      content: response.answer || 'Berikut insight cepat.',
      mode: 'chat',
      widgets: [],
      artifacts,
    });
    return;
  }

  appendMessage({
    role: 'assistant',
    content: response.answer || 'Selesai.',
    mode,
    widgets,
    artifacts,
  });

  if (mode === 'canvas' && Array.isArray(widgets) && widgets.length > 0) {
    try {
      state.canvasWidgets = normalizeIncomingWidgets(widgets);
      const maxWidgetPage = state.canvasWidgets.reduce((max, widget) => Math.max(max, Number(widget.layout?.page || 1)), 1);
      const configPages = Number(response.dashboard?.config?.pages || 1);
      state.canvasPagesCount = Math.max(1, configPages, maxWidgetPage);
      state.canvasPage = 1;
      renderCanvas();
      scheduleCanvasSave();
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
      dashboard_id: state.currentDashboard?.id || null,
      client_preferences: state.settings,
    }),
  }, {
    retries: 1,
    baseDelayMs: 450,
  });

  if (!response.ok) {
    throw new Error(`Stream gagal (${response.status})`);
  }
  if (!response.body) {
    throw new Error('Stream tidak tersedia.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

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
        streamState.hadTimeline = true;
        streamState.runId = runId;
        streamState.seenEventKeys.clear();
        streamState.visualStepKeys.clear();
        ensureTimeline(runId, event.title || 'Agentic Thinking');
      } else if (event.type === 'timeline_step') {
        const step = event.step || {};
        const runId = step.timeline_id || streamState.runId || state.timelineRunId || `timeline_${Date.now()}`;
        streamState.hadTimeline = true;
        streamState.runId = runId;
        const eventKey = timelineEventKey(runId, step);
        if (streamState.seenEventKeys.has(eventKey)) {
          continue;
        }
        streamState.seenEventKeys.add(eventKey);
        ensureTimeline(runId, 'Agentic Thinking');
        if (isVisualTimelineStep(step)) {
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
      } else if (event.type === 'final') {
        finalPayload = event.payload || null;
      } else if (event.type === 'error') {
        throw new Error(event.message || 'Stream error.');
      }
    }
  }

  if (!finalPayload) {
    throw new Error('Final payload tidak diterima dari stream.');
  }

  return {
    payload: finalPayload,
    timelineSeen: Boolean(streamState.hadTimeline),
  };
}

async function sendChatMessage(userText) {
  if (!state.datasetReady) {
    setDatasetGateVisible(true);
    appendMessage({
      role: 'assistant',
      content: 'Upload dataset dulu atau gunakan Demo Dataset sebelum bertanya.',
      mode: 'chat',
      artifacts: [],
    });
    return;
  }

  const needsTimeline = /dashboard|grafik|chart|visual|canvas/i.test(userText);
  if (state.timelineRunId) {
    finalizeTimeline(state.timelineRunId);
  }
  showTyping();

  try {
    let response;
    let streamTimelineSeen = false;
    const streamState = createTimelineStreamState();
    try {
      const streamed = await streamChatMessage(userText, streamState);
      response = streamed.payload;
      streamTimelineSeen = Boolean(streamed.timelineSeen);
    } catch {
      streamTimelineSeen = Boolean(streamState.hadTimeline);
      response = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userText,
          conversation_id: state.conversationId,
          dashboard_id: state.currentDashboard?.id || null,
          client_preferences: state.settings,
        }),
      });
    }

    hideTyping();
    applyAssistantResponse(response, {
      needsTimeline,
      skipTraceHydration: streamTimelineSeen,
    });
    if (needsTimeline && state.timelineRunId) {
      finalizeTimeline(state.timelineRunId);
    }
    await refreshVerdict();
  } catch (error) {
    hideTyping();
    finalizeTimeline(state.timelineRunId);
    const text = isNetworkLikeError(error)
      ? 'Koneksi ke server terputus sementara. Coba kirim ulang dalam 2-3 detik.'
      : `Gagal memproses pertanyaan: ${error.message}`;
    appendMessage({
      role: 'assistant',
      content: text,
      mode: 'chat',
      artifacts: [],
    });
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
    height: Math.max(40, body.height - 8),
  });
}

async function downloadCanvasAsJpg() {
  if (!refs.canvasStage || !state.canvasWidgets.length) {
    showToast('Canvas belum tersedia.');
    return;
  }

  const width = 1600;
  const height = 900;
  const outerPad = 24;
  const gap = 10;
  const cellWidth = (width - outerPad * 2 - gap * (GRID_COLS - 1)) / GRID_COLS;
  const cellHeight = (height - outerPad * 2 - gap * (GRID_ROWS - 1)) / GRID_ROWS;

  const pageItems = state.canvasWidgets
    .filter((widget) => Number(widget.layout?.page || 1) === state.canvasPage)
    .map((widget) => ({
      ...widget,
      layout: normalizeLayout(widget.layout || {}, state.canvasPage),
    }));

  if (!pageItems.length) {
    showToast('Halaman ini belum memiliki widget untuk diexport.');
    return;
  }

  const scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    showToast('Browser tidak mendukung export JPG.');
    return;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.fillStyle = '#f8fafc';
  drawRoundedRect(context, 0, 0, width, height, 0);
  context.fill();

  pageItems.forEach((widget) => {
    const layout = widget.layout;
    const x = outerPad + layout.x * (cellWidth + gap);
    const y = outerPad + layout.y * (cellHeight + gap);
    const w = layout.w * cellWidth + (layout.w - 1) * gap;
    const h = layout.h * cellHeight + (layout.h - 1) * gap;
    drawWidgetOnExport(context, widget, { x, y, w, h });
  });

  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/jpeg', 0.92);
  anchor.download = `vistara-dashboard-hal-${state.canvasPage}.jpg`;
  anchor.click();
  showToast('JPG dashboard berhasil diunduh.');
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
  await Promise.allSettled([refreshProfile(), refreshSources(), refreshVerdict(), refreshDashboards(), refreshConversationList(), loadSchema()]);
  const initialConversationId = resolveInitialConversationId(state.conversations);
  if (initialConversationId) {
    await refreshChatHistory(initialConversationId);
  } else {
    resetConversationWorkspaceState();
  }
  ensureWelcomeMessage();
}

refs.chatInput.addEventListener('input', () => {
  refs.chatInput.style.height = 'auto';
  refs.chatInput.style.height = `${Math.min(refs.chatInput.scrollHeight, 180)}px`;
});

refs.chatFile.addEventListener('change', () => {
  const file = refs.chatFile.files[0];
  if (refs.fileLabel) {
    refs.fileLabel.textContent = file ? file.name : 'Tidak ada file';
  }
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

if (refs.openCanvasBtn) {
  refs.openCanvasBtn.addEventListener('click', () => {
    if (Array.isArray(state.canvasWidgets) && state.canvasWidgets.length > 0) {
      setCanvasOpen(true);
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
  } catch (error) {
    showToast(error.message);
  }
});

refs.gateDemoBtn.addEventListener('click', async () => {
  try {
    await uploadDataset({ demo: true });
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
    appendMessage({
      role: 'user',
      content: userText || `Upload dataset ${file.name}`,
      fileName: file.name,
      artifacts: [],
    });

    try {
      await uploadDataset({ file, silent: true });
    } catch (error) {
      appendMessage({
        role: 'assistant',
        content: `Upload gagal: ${error.message}`,
        mode: 'chat',
        artifacts: [],
      });
      return;
    } finally {
      refs.chatFile.value = '';
      if (refs.fileLabel) {
        refs.fileLabel.textContent = 'Tidak ada file';
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

if (refs.closeCanvasBtn) {
  refs.closeCanvasBtn.addEventListener('click', () => {
    setCanvasOpen(false);
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
    addEmptyWidget();
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
    addEmptyWidget();
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

window.addEventListener('resize', () => {
  applyWorkspaceSplitState();
  applyStageDimensions();
  syncGridBounds();
});

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
      showPage('auth');
      return showToast('Login dulu.');
    }

    appendMessage({ role: 'user', content: prompt, artifacts: [] });
    await sendChatMessage(prompt);
  });
});

if (refs.landingCta) {
  refs.landingCta.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('register');
  });
}
if (refs.landingWelcomeCta) {
  refs.landingWelcomeCta.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('register');
  });
}
if (refs.headerLoginBtn) {
  refs.headerLoginBtn.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('login');
  });
}
if (refs.headerCtaBtn) {
  refs.headerCtaBtn.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('register');
  });
}
if (refs.landingCtaBottom) {
  refs.landingCtaBottom.addEventListener('click', () => {
    showPage('auth');
    switchAuthTab('register');
  });
}

async function startDemoSession() {
  const originalText = refs.landingDemo?.textContent || 'Coba Demo (tanpa login)';
  if (refs.landingDemo) {
    refs.landingDemo.disabled = true;
    refs.landingDemo.textContent = 'Menyiapkan Demo...';
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

    showPage('workspace');
    await loadWorkspace();
    setCanvasOpen(false);
    showToast('Demo siap. Login jika ingin simpan histori permanen.');
  } catch (error) {
    try {
      await fallbackStart();
      showPage('workspace');
      await loadWorkspace();
      setCanvasOpen(false);
      showToast('Demo siap. Login jika ingin simpan histori permanen.');
    } catch (fallbackError) {
      showToast(`Gagal masuk demo: ${fallbackError.message || error.message}`);
    }
  } finally {
    if (refs.landingDemo) {
      refs.landingDemo.disabled = false;
      refs.landingDemo.textContent = originalText;
    }
  }
}

if (refs.landingDemo) {
  refs.landingDemo.addEventListener('click', () => {
    startDemoSession();
  });
}

if (refs.landingWelcomeDemo) {
  refs.landingWelcomeDemo.addEventListener('click', () => {
    startDemoSession();
  });
}

if (refs.landingTryNowBtn) {
  refs.landingTryNowBtn.addEventListener('click', () => {
    startDemoSession();
  });
}

if (refs.landingScrollCue) {
  refs.landingScrollCue.addEventListener('click', () => {
    refs.landingHeroStart?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });
}

if (refs.themeToggle) {
  refs.themeToggle.addEventListener('click', toggleTheme);
}

if (refs.headerSettingsBtn) {
  refs.headerSettingsBtn.addEventListener('click', () => {
    syncSettingsForm();
    setSettingsOpen(true);
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
        showToast(`Pengaturan visual tersimpan, update business context gagal: ${error.message}`);
      }
    }

    refreshWelcomeGreeting();
    setSettingsOpen(false);
    showToast('Pengaturan berhasil disimpan.');
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.settingsOpen) {
    setSettingsOpen(false);
  }
});

refs.authTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-auth-tab]');
  if (!button) {
    return;
  }
  switchAuthTab(button.dataset.authTab);
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
      await loadWorkspace();
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

    showPage('context');
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
    showPage('workspace');
    await loadWorkspace();
    setCanvasOpen(false);
    showToast('Workspace siap digunakan.');
  } catch (error) {
    showToast(error.message);
  }
});

refs.editProfileBtn.addEventListener('click', async () => {
  if (!state.token) {
    return showPage('auth');
  }

  try {
    await refreshProfile();
  } catch {
    // continue manual
  }

  showPage('context');
});

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
  state.currentDashboard = null;
  state.canvasWidgets = [];
  state.canvasPage = 1;
  state.canvasPagesCount = 1;
  state.datasetReady = false;
  state.dataPaneCollapsed = false;
  state.configPaneCollapsed = true;
  state.timelineRunId = null;
  state.timelineMessageId = null;

  if (state.grid) {
    if (typeof state.grid.destroy === 'function') {
      state.grid.destroy();
    }
    state.grid = null;
    refs.canvasGrid.innerHTML = '';
  }

  setSettingsOpen(false);
  setCanvasOpen(false);

  renderThread();
  renderConversationList();
  if (refs.sourceStats) {
    refs.sourceStats.textContent = 'Data: 0 source';
  }
  if (refs.verdictBadge) {
    refs.verdictBadge.textContent = 'Verdict: belum tersedia';
  }
  showPage('landing');
  stopPreChatTicker();
  showToast('Logout berhasil.');
});

async function bootstrap() {
  applySettings(readSettings(), { persist: false });
  bindPanelDivider();
  bindCanvasViewportPan();
  applyStageDimensions();
  centerCanvasStage();
  updateCanvasPaneState();
  applyWorkspaceSplitState();
  setEditMode(false);
  bindHintTooltips();
  switchAuthTab('login');
  setCanvasOpen(false);
  updateCanvasPagination();
  setAuth(state.token, null, {
    persist: true,
    isDemo: false,
  });

  if (!state.token) {
    showPage('landing');
    return;
  }

  try {
    await refreshProfile();

    if (!isContextComplete(state.profile)) {
      showPage('context');
      return;
    }

  showPage('workspace');
  await loadWorkspace();
  setCanvasOpen(false);
  showToast('Session dipulihkan.');
  } catch {
    setAuth('', null, {
      persist: false,
      isDemo: false,
    });
    showPage('landing');
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

bootstrap();
