/**
 * Dashboard Switcher — pill tabs for selecting dashboard versions
 *
 * Renders dashboard pills above the composer when a conversation has
 * multiple dashboards. Listens for dashboard list updates from the
 * legacy app via custom events.
 */

let switcherContainer = null;
let dashboards = [];
let activeId = null;

function renderPills() {
  if (!switcherContainer) return;

  if (dashboards.length <= 1) {
    switcherContainer.classList.add('hidden');
    switcherContainer.innerHTML = '';
    return;
  }

  switcherContainer.classList.remove('hidden');
  switcherContainer.innerHTML = '';

  dashboards.forEach((dashboard, index) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'dashboard-pill';
    pill.textContent = dashboard.title || `Dashboard ${index + 1}`;
    pill.dataset.dashboardId = dashboard.id;

    if (dashboard.id === activeId) {
      pill.classList.add('active');
      pill.setAttribute('aria-current', 'true');
    }

    pill.addEventListener('click', () => {
      if (dashboard.id === activeId) return;
      activeId = dashboard.id;
      renderPills();

      // Notify the legacy app to switch dashboard
      document.dispatchEvent(new CustomEvent('vistara:switch-dashboard', {
        detail: { dashboardId: dashboard.id },
      }));
    });

    switcherContainer.appendChild(pill);
  });
}

export function initDashboardSwitcher() {
  switcherContainer = document.getElementById('dashboardSwitcher');
  if (!switcherContainer) return;

  // Listen for dashboard list updates from legacy app
  document.addEventListener('vistara:dashboards-updated', (event) => {
    const detail = event.detail || {};
    dashboards = Array.isArray(detail.dashboards) ? detail.dashboards : [];
    activeId = detail.activeId || (dashboards[0]?.id ?? null);
    renderPills();
  });

  // Listen for active dashboard change
  document.addEventListener('vistara:dashboard-activated', (event) => {
    const detail = event.detail || {};
    if (detail.dashboardId) {
      activeId = detail.dashboardId;
      renderPills();
    }
  });
}
