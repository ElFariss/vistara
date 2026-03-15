/**
 * Landing page — scroll reveal animations and CTA positioning.
 */

import { state, refs } from './state.js';
import { shouldDockLandingFinalCta } from '@/navigation/workspaceState.js';

export function initLandingReveal() {
  const nodes = Array.from(document.querySelectorAll('.landing-page .reveal-on-scroll'));
  if (nodes.length === 0) return;

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
      if (!entry.isIntersecting) return;
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

export function syncLandingScrollCue() {
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
