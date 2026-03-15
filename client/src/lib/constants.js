/**
 * Application-wide constants and configuration values.
 * No dependencies — this is the bottom of the import tree.
 */

export const GRID_COLS = 16;
export const GRID_ROWS = 9;
export const GRID_GAP = 10;
export const MOBILE_BREAKPOINT = 768;
export const MIN_CANVAS_PCT = 28;
export const MAX_CANVAS_PCT = 92;
export const DEFAULT_CANVAS_PCT = 58;
export const STAGE_BASE_WIDTH = 1280;
export const STAGE_BASE_HEIGHT = 720;
export const MIN_STAGE_ZOOM = 0.5;
export const MAX_STAGE_ZOOM = 1.75;
export const ZOOM_STEP = 0.1;
export const SETTINGS_STORAGE_KEY = 'vistara_settings';
export const PRECHAT_ROTATE_MS = 5000;
export const PRECHAT_FADE_MS = 320;

export const UPLOAD_ALLOWED_EXTENSIONS = new Set([
  '.csv', '.tsv', '.ssv', '.dsv',
  '.xlsx', '.xls', '.json',
  '.pdf', '.doc', '.docx',
  '.db', '.sqlite', '.sqlite3', '.sql',
  '.mdb', '.accdb', '.dbf',
  '.parquet', '.duckdb',
]);

export const UPLOAD_BLOCKED_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.py',
]);

export const UPLOAD_ALLOWED_LABEL = 'CSV, TSV, SSV, DSV, XLSX, XLS, JSON, PDF, DOC/DOCX, dan file database';

const runtimeConfig = window.__VISTARA_RUNTIME__ || {};
export const API_BASE_URL = String(runtimeConfig.API_BASE_URL || '').trim().replace(/\/+$/, '');
export const HOSTNAME = window.location.hostname || '';
export const IS_DEMO_HOST = /^demo[.-]/.test(HOSTNAME)
  || HOSTNAME.includes('.demo.')
  || HOSTNAME.includes('-demo');
export const TOKEN_STORAGE_KEY = IS_DEMO_HOST ? 'umkm_demo_token' : 'umkm_token';
export const DEFAULT_API_TIMEOUT_MS = 30000;
export const UPLOAD_API_TIMEOUT_MS = 180000;
export const STREAM_API_TIMEOUT_MS = 0;

export const DEFAULT_SETTINGS = {
  theme_mode: 'system',
  accent_color: 'orange',
  nickname: '',
  response_style: 'ringkas',
  assistant_character: 'proaktif',
  personalization_focus: '',
};

export const ACCENT_PRESETS = {
  orange: { accent: '#f97316', hover: '#fb8a2c', light: '#fef0e4' },
  blue:   { accent: '#2563eb', hover: '#3b82f6', light: '#dbeafe' },
  green:  { accent: '#16a34a', hover: '#22c55e', light: '#dcfce7' },
  rose:   { accent: '#e11d48', hover: '#f43f5e', light: '#ffe4e6' },
};
