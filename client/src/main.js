/**
 * Vistara — main entrypoint
 * Imports global CSS and boots the legacy app (which self-initialises).
 * New UX modules (dropzone, spam guard, dashboard switcher) are loaded
 * here so they can hook into the DOM that legacy-app.js creates.
 */

import '@/styles/main.css';

// Boot the legacy monolith — it runs bootstrap() on import
import '@/legacy-app.js';

// New UX enhancements
import { initDropzone } from '@/upload/dropzone.js';
import { initSpamGuard } from '@/chat/composer.js';
import { initDashboardSwitcher } from '@/dashboard/switcher.js';

// Wait for the legacy bootstrap to finish its first tick, then hook in
requestAnimationFrame(() => {
  initDropzone();
  initSpamGuard();
  initDashboardSwitcher();
});
