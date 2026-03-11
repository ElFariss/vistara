import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { safeJsonParse } from '../utils/parse.mjs';
import { logAudit } from './audit.mjs';

function defaultDashboardConfig() {
  return {
    mode: 'ai',
    components: [
      { id: generateId(), type: 'MetricCard', title: 'Omzet', metric: 'revenue' },
      { id: generateId(), type: 'MetricCard', title: 'Untung', metric: 'profit' },
      { id: generateId(), type: 'TrendChart', title: 'Trend Omzet', metric: 'revenue', granularity: 'day' },
      { id: generateId(), type: 'TopList', title: 'Produk Terlaris', metric: 'top_products' },
    ],
    updated_by: 'system',
  };
}

function parseDashboard(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    is_default: Boolean(row.is_default),
    config: safeJsonParse(row.config_json, defaultDashboardConfig()),
  };
}

export function ensureDefaultDashboard(tenantId, userId) {
  const existing = get(
    `
      SELECT * FROM dashboards
      WHERE tenant_id = :tenant_id AND user_id = :user_id
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
    `,
    { tenant_id: tenantId, user_id: userId },
  );

  if (existing) {
    return parseDashboard(existing);
  }

  const id = generateId();
  const now = new Date().toISOString();
  const config = defaultDashboardConfig();

  run(
    `
      INSERT INTO dashboards (id, tenant_id, user_id, name, config_json, is_default, created_at, updated_at)
      VALUES (:id, :tenant_id, :user_id, :name, :config_json, 1, :created_at, :updated_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      name: 'Dashboard Utama',
      config_json: JSON.stringify(config),
      created_at: now,
      updated_at: now,
    },
  );

  return {
    id,
    tenant_id: tenantId,
    user_id: userId,
    name: 'Dashboard Utama',
    is_default: true,
    config,
    created_at: now,
    updated_at: now,
  };
}

export function listDashboards(tenantId, userId) {
  const rows = all(
    `
      SELECT *
      FROM dashboards
      WHERE tenant_id = :tenant_id AND user_id = :user_id
      ORDER BY is_default DESC, updated_at DESC
    `,
    { tenant_id: tenantId, user_id: userId },
  );

  return rows.map(parseDashboard);
}

export function getDashboard(tenantId, userId, dashboardId) {
  const row = get(
    `
      SELECT *
      FROM dashboards
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: dashboardId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  return parseDashboard(row);
}

export function getLatestDashboard(tenantId, userId) {
  const row = get(
    `
      SELECT *
      FROM dashboards
      WHERE tenant_id = :tenant_id AND user_id = :user_id
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
    `,
    {
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  return parseDashboard(row);
}

export function createDashboard(tenantId, userId, name, config) {
  const id = generateId();
  const now = new Date().toISOString();
  const payload = config || defaultDashboardConfig();

  run(
    `
      INSERT INTO dashboards (id, tenant_id, user_id, name, config_json, is_default, created_at, updated_at)
      VALUES (:id, :tenant_id, :user_id, :name, :config_json, 0, :created_at, :updated_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      name: name || 'Dashboard Baru',
      config_json: JSON.stringify(payload),
      created_at: now,
      updated_at: now,
    },
  );

  return getDashboard(tenantId, userId, id);
}

export function updateDashboard(tenantId, userId, dashboardId, patch) {
  const existing = getDashboard(tenantId, userId, dashboardId);
  if (!existing) {
    return null;
  }

  const next = {
    name: patch.name ?? existing.name,
    config: patch.config ?? existing.config,
  };

  run(
    `
      UPDATE dashboards
      SET name = :name,
          config_json = :config_json,
          updated_at = :updated_at
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: dashboardId,
      tenant_id: tenantId,
      user_id: userId,
      name: next.name,
      config_json: JSON.stringify(next.config),
      updated_at: new Date().toISOString(),
    },
  );

  return getDashboard(tenantId, userId, dashboardId);
}

export function deleteDashboard(tenantId, userId, dashboardId) {
  const dashboard = getDashboard(tenantId, userId, dashboardId);
  if (!dashboard) {
    return false;
  }

  if (dashboard.is_default) {
    return false;
  }

  run(
    `
      DELETE FROM dashboards
      WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
    `,
    {
      id: dashboardId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  return true;
}

function componentForMetric(metric = 'omzet') {
  const lower = String(metric || '').toLowerCase();
  if (lower.includes('produk')) {
    return { id: generateId(), type: 'TopList', title: 'Produk Terlaris', metric: 'top_products' };
  }
  if (lower.includes('cabang')) {
    return { id: generateId(), type: 'TopList', title: 'Performa Cabang', metric: 'branch_performance' };
  }
  if (lower.includes('trend') || lower.includes('grafik')) {
    return { id: generateId(), type: 'TrendChart', title: 'Trend Omzet', metric: 'revenue', granularity: 'day' };
  }
  if (lower.includes('untung') || lower.includes('laba')) {
    return { id: generateId(), type: 'MetricCard', title: 'Untung', metric: 'profit' };
  }
  if (lower.includes('margin')) {
    return { id: generateId(), type: 'MetricCard', title: 'Margin', metric: 'margin' };
  }
  return { id: generateId(), type: 'MetricCard', title: 'Omzet', metric: 'revenue' };
}

export function applyDashboardModification({ tenantId, userId, dashboard, intent, originalMessage }) {
  const config = {
    ...dashboard.config,
    components: Array.isArray(dashboard.config.components) ? [...dashboard.config.components] : [],
  };

  const action = intent.dashboard_action || 'add_component';
  let summary = 'Dashboard diperbarui.';

  if (action === 'add_component') {
    if (config.components.length >= 8) {
      summary = 'Maksimum 8 komponen tercapai. Hapus satu komponen dulu.';
    } else {
      const component = componentForMetric(intent.dashboard_component || intent.metric);
      config.components.push(component);
      summary = `Komponen ${component.title} ditambahkan.`;
    }
  } else if (action === 'remove_component') {
    if (!config.components.length) {
      summary = 'Tidak ada komponen untuk dihapus.';
    } else {
      const removed = config.components.pop();
      summary = `Komponen ${removed.title} dihapus.`;
    }
  } else if (action === 'focus_metric') {
    const target = componentForMetric(intent.metric);
    config.components = config.components.filter(
      (component) => component.metric === target.metric || component.type === 'TrendChart',
    );
    if (!config.components.find((item) => item.metric === target.metric)) {
      config.components.unshift(target);
    }
    summary = `Dashboard difokuskan ke metrik ${target.title}.`;
  } else if (action === 'change_granularity') {
    const granularity = /harian/i.test(originalMessage || '') ? 'day' : /mingguan/i.test(originalMessage || '') ? 'week' : 'month';
    config.components = config.components.map((component) =>
      component.type === 'TrendChart' ? { ...component, granularity } : component,
    );
    summary = `Granularitas trend diubah ke ${granularity}.`;
  } else if (action === 'save_dashboard') {
    if (intent.dashboard_name) {
      dashboard.name = intent.dashboard_name;
      summary = `Dashboard disimpan sebagai "${intent.dashboard_name}".`;
    } else {
      summary = 'Dashboard disimpan.';
    }
  }

  config.updated_by = 'assistant';
  const updated = updateDashboard(tenantId, userId, dashboard.id, {
    name: intent.dashboard_name || dashboard.name,
    config,
  });

  logAudit({
    tenantId,
    userId,
    action: 'dashboard_modify',
    resourceType: 'dashboard',
    resourceId: dashboard.id,
    metadata: {
      action,
      message: originalMessage,
    },
  });

  return {
    summary,
    dashboard: updated,
  };
}
