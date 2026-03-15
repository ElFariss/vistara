/**
 * Settings panel — read, apply, sync, and persist user settings.
 */

import { state, refs } from './state.js';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from './constants.js';
import { setTheme, setAccent } from './theme.js';
import { showToast } from './utils.js';

export function normalizeSettings(input = {}) {
  return {
    theme_mode: ['light', 'dark', 'system'].includes(input.theme_mode)
      ? input.theme_mode
      : DEFAULT_SETTINGS.theme_mode,
    accent_color: ['orange', 'blue', 'green', 'rose'].includes(input.accent_color)
      ? input.accent_color
      : DEFAULT_SETTINGS.accent_color,
    nickname: String(input.nickname || '').trim().slice(0, 40),
    response_style: ['ringkas', 'detail', 'formal', 'santai'].includes(input.response_style)
      ? input.response_style
      : DEFAULT_SETTINGS.response_style,
    assistant_character: ['proaktif', 'teliti', 'tegas', 'suportif'].includes(input.assistant_character)
      ? input.assistant_character
      : DEFAULT_SETTINGS.assistant_character,
    personalization_focus: String(input.personalization_focus || '').trim().slice(0, 400),
  };
}

export function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function syncSettingsForm() {
  if (refs.settingsThemeMode) refs.settingsThemeMode.value = state.settings.theme_mode;
  if (refs.settingsAccentColor) refs.settingsAccentColor.value = state.settings.accent_color;
  if (refs.settingsNickname) refs.settingsNickname.value = state.settings.nickname;
  if (refs.settingsResponseStyle) refs.settingsResponseStyle.value = state.settings.response_style;
  if (refs.settingsAssistantCharacter) refs.settingsAssistantCharacter.value = state.settings.assistant_character;
  if (refs.settingsPersonalizationFocus) refs.settingsPersonalizationFocus.value = state.settings.personalization_focus;
}

export function syncBusinessSettingsFields() {
  if (!state.profile) return;
  if (refs.settingsBusinessName) refs.settingsBusinessName.value = state.profile.name || '';
  if (refs.settingsBusinessIndustry) refs.settingsBusinessIndustry.value = state.profile.industry || '';
  if (refs.settingsBusinessCity) refs.settingsBusinessCity.value = state.profile.city || '';
}

export function applySettings(nextSettings, options = {}) {
  const normalized = normalizeSettings(nextSettings);
  state.settings = normalized;

  setTheme(normalized.theme_mode);
  setAccent(normalized.accent_color);
  syncSettingsForm();
  syncBusinessSettingsFields();

  if (options.persist !== false) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // storage full — ignore
    }
  }
}

export function syncSettingsGroupUi() {
  const group = state.settingsGroup || 'user';
  if (refs.settingsGroupUserBtn) {
    refs.settingsGroupUserBtn.classList.toggle('is-active', group === 'user');
    refs.settingsGroupUserBtn.setAttribute('aria-selected', String(group === 'user'));
    refs.settingsGroupUserBtn.setAttribute('aria-pressed', String(group === 'user'));
  }
  if (refs.settingsGroupAgentBtn) {
    refs.settingsGroupAgentBtn.classList.toggle('is-active', group === 'agent');
    refs.settingsGroupAgentBtn.setAttribute('aria-selected', String(group === 'agent'));
    refs.settingsGroupAgentBtn.setAttribute('aria-pressed', String(group === 'agent'));
  }
  if (refs.settingsUserGroup) refs.settingsUserGroup.classList.toggle('hidden', group !== 'user');
  if (refs.settingsAgentGroup) refs.settingsAgentGroup.classList.toggle('hidden', group !== 'agent');
}

export function setSettingsGroup(group = 'user') {
  state.settingsGroup = group;
  syncSettingsGroupUi();
}

export function setSettingsOpen(open, options = {}) {
  state.settingsOpen = Boolean(open);
  refs.settingsPanel?.classList.toggle('hidden', !state.settingsOpen);
  refs.settingsBackdrop?.classList.toggle('hidden', !state.settingsOpen);
  refs.settingsPanel?.setAttribute('aria-hidden', String(!state.settingsOpen));
  if (refs.settingsPanel && 'inert' in refs.settingsPanel) {
    refs.settingsPanel.inert = !state.settingsOpen;
  }

  if (state.settingsOpen) {
    state.settingsReturnFocus = document.activeElement || null;
    syncSettingsForm();
    syncBusinessSettingsFields();
    syncSettingsGroupUi();
    refs.settingsPanel?.focus();
  } else if (state.settingsReturnFocus) {
    state.settingsReturnFocus.focus?.();
    state.settingsReturnFocus = null;
  }
}
