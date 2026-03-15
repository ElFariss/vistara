/**
 * Theme management — light/dark mode and accent color.
 */

import { state, refs } from './state.js';
import { ACCENT_PRESETS } from './constants.js';

export function resolveThemeMode(mode = 'light') {
  if (mode === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
      ? 'dark'
      : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

export function syncBrowserThemeChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#faf7f2');
  }
}

export function setTheme(mode) {
  const resolved = resolveThemeMode(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  document.body.classList.toggle('dark-mode', resolved === 'dark');
  syncBrowserThemeChrome(resolved);
}

export function setAccent(accentKey = 'orange') {
  const preset = ACCENT_PRESETS[accentKey] || ACCENT_PRESETS.orange;
  document.documentElement.style.setProperty('--accent', preset.accent);
  document.documentElement.style.setProperty('--accent-hover', preset.hover);
  document.documentElement.style.setProperty('--accent-light', preset.light);
}

export function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const nextMode = isDark ? 'light' : 'dark';
  state.settings.theme_mode = nextMode;
  setTheme(nextMode);
}
