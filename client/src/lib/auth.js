/**
 * Auth — login/register forms, token management, password toggle, onboarding slides.
 */

import { state, refs } from './state.js';

export function syncHeaderActions() {
  const isAuth = Boolean(state.token);
  const isLanding = state.currentPage === 'landing';
  const isWorkspace = state.currentPage === 'workspace';

  if (refs.headerLoginBtn) {
    refs.headerLoginBtn.hidden = isAuth || isWorkspace;
  }
  if (refs.headerCtaBtn) {
    refs.headerCtaBtn.hidden = isAuth || isWorkspace;
  }
  if (refs.headerSettingsBtn) {
    refs.headerSettingsBtn.hidden = !isAuth;
  }
  if (refs.logoutBtn) {
    refs.logoutBtn.hidden = !isAuth;
  }
}

export function setAuth(token, user = null, options = {}) {
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

export function syncAppHeaderOffset() {
  const headerHeight = refs.appHeader?.offsetHeight || 0;
  document.documentElement.style.setProperty('--app-header-height', `${headerHeight}px`);
}

export function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tab);
  });

  refs.loginForm.classList.toggle('hidden', tab !== 'login');
  refs.registerForm.classList.toggle('hidden', tab !== 'register');
}

export function togglePasswordVisibility(input, toggle) {
  if (!input || !toggle) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  toggle.textContent = showing ? 'Tampilkan' : 'Sembunyikan';
  toggle.setAttribute('aria-label', showing ? 'Tampilkan password' : 'Sembunyikan password');
  toggle.setAttribute('aria-pressed', String(!showing));
}

export function setOnboardingSlide(index = 0) {
  const total = refs.authOnboardingSlides.length;
  if (!total) return;

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

export function fillContextForm(profile) {
  if (!refs.contextForm) return;
  if (profile?.name) refs.contextForm.elements.name.value = profile.name;
  if (profile?.industry) refs.contextForm.elements.industry.value = profile.industry;
  if (profile?.city) refs.contextForm.elements.city.value = profile.city;
  if (profile?.timezone) refs.contextForm.elements.timezone.value = profile.timezone;
  if (profile?.currency) refs.contextForm.elements.currency.value = profile.currency;
}
