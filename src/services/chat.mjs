import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { parseIntent } from './nlu.mjs';
import { executeAnalyticsIntent } from './queryEngine.mjs';
import { ensureDefaultDashboard, applyDashboardModification, getDashboard } from './dashboards.mjs';
import { runDashboardAgent } from './agentRuntime.mjs';
import { generateReport } from './reports.mjs';
import { createGoal } from './goals.mjs';
import { logAudit } from './audit.mjs';

function ensureConversation(tenantId, userId, conversationId = null) {
  if (conversationId) {
    const existing = get(
      `
        SELECT * FROM conversations
        WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id
      `,
      { id: conversationId, tenant_id: tenantId, user_id: userId },
    );

    if (existing) {
      return existing;
    }
  }

  const id = generateId();
  run(
    `
      INSERT INTO conversations (id, tenant_id, user_id, title, created_at)
      VALUES (:id, :tenant_id, :user_id, :title, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      title: 'Percakapan Baru',
      created_at: new Date().toISOString(),
    },
  );

  return get(
    `SELECT * FROM conversations WHERE id = :id AND tenant_id = :tenant_id AND user_id = :user_id`,
    { id, tenant_id: tenantId, user_id: userId },
  );
}

function createMessage({ conversationId, tenantId, userId, role, content, payload = null }) {
  const id = generateId();
  run(
    `
      INSERT INTO chat_messages (id, conversation_id, tenant_id, user_id, role, content, payload_json, created_at)
      VALUES (:id, :conversation_id, :tenant_id, :user_id, :role, :content, :payload_json, :created_at)
    `,
    {
      id,
      conversation_id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
      role,
      content,
      payload_json: payload ? JSON.stringify(payload) : null,
      created_at: new Date().toISOString(),
    },
  );

  return id;
}

function historyForConversation(tenantId, userId, conversationId, limit = 50) {
  return all(
    `
      SELECT id, role, content, payload_json, feedback, created_at
      FROM chat_messages
      WHERE tenant_id = :tenant_id
        AND conversation_id = :conversation_id
        AND (user_id = :user_id OR user_id IS NULL)
      ORDER BY created_at ASC
      LIMIT :limit
    `,
    {
      tenant_id: tenantId,
      conversation_id: conversationId,
      user_id: userId,
      limit,
    },
  ).map((item) => ({
    ...item,
    payload: item.payload_json ? JSON.parse(item.payload_json) : null,
  }));
}

function parseGoalFromMessage(message, intent) {
  if (intent.target_value) {
    return intent.target_value;
  }
  const match = message.match(/(\d+[\d.,]*)/);
  if (!match) {
    return null;
  }
  const raw = match[1].replace(/\./g, '').replace(/,/g, '.');
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizeReportPeriod(intent) {
  if (intent.time_period) {
    return intent.time_period;
  }
  return 'minggu ini';
}

function isComplexDashboardRequest(message, intent) {
  const text = String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return false;
  }

  const hasCanvas = /\b(canvas|kanvas)\b/.test(text);
  const hasDashboard = /\bdashboard\b/.test(text);
  const hasBuildVerb = /\b(buat|buatkan|bikin|generate|susun|siapkan|bangun|create)\b/.test(text);
  const hasComplexQualifier = /\b(lengkap|komplet|full|penuh|multi|beberapa|overview|ringkasan)\b/.test(text);
  const hasVisualTerms = (text.match(/\b(grafik|chart|tabel|widget|visual)\b/g) || []).length;

  if (hasCanvas) {
    return true;
  }

  if (hasDashboard && (hasBuildVerb || hasComplexQualifier || hasVisualTerms >= 1)) {
    return true;
  }

  if (hasVisualTerms >= 2 && hasBuildVerb) {
    return true;
  }

  if (intent.intent === 'modify_dashboard') {
    return hasDashboard || hasCanvas || /\b(widget|layout|komponen|panel)\b/.test(text);
  }

  return false;
}

function hasDataset(tenantId) {
  const readySource = get(
    `
      SELECT id, row_count
      FROM source_files
      WHERE tenant_id = :tenant_id
        AND status = 'ready'
      ORDER BY upload_date DESC
      LIMIT 1
    `,
    { tenant_id: tenantId },
  );

  if (readySource && Number(readySource.row_count || 0) > 0) {
    return true;
  }

  const txCount = get(`SELECT COUNT(*) AS value FROM transactions WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const expenseCount = get(`SELECT COUNT(*) AS value FROM expenses WHERE tenant_id = :tenant_id`, {
    tenant_id: tenantId,
  }) || { value: 0 };

  const storedRows = Number(txCount.value || 0) + Number(expenseCount.value || 0);
  return storedRows > 0;
}

function widgetsToArtifacts(widgets = []) {
  return widgets
    .map((widget) => {
      if (widget.type === 'MetricCard') {
        return {
          kind: 'metric',
          title: widget.title,
          value: widget.displayValue || String(widget.value || 0),
          delta: widget.comparison || null,
        };
      }

      if (widget.type === 'TrendChart') {
        return {
          kind: 'chart',
          chart_type: 'line',
          title: widget.title,
          labels: (widget.points || []).map((point) => point.label),
          series: [
            {
              name: widget.title,
              values: (widget.points || []).map((point) => Number(point.value || 0)),
            },
          ],
        };
      }

      if (widget.type === 'TopList') {
        return {
          kind: 'table',
          title: widget.title,
          columns: ['name', 'value'],
          rows: (widget.items || []).map((item) => ({
            name: item.name || item.label || 'Item',
            value: item.total_revenue ?? item.revenue ?? item.value ?? 0,
          })),
        };
      }

      return null;
    })
    .filter(Boolean);
}

function deterministicDashboardFallback({ tenantId, userId, intent }) {
  const basePeriod = intent?.time_period || '30 hari terakhir';
  const templateIds = [
    'total_revenue',
    'total_profit',
    'margin_percentage',
    'revenue_trend',
    'top_products',
    'branch_performance',
  ];

  const widgets = [];
  const artifacts = [];

  for (const templateId of templateIds) {
    const isRank = templateId === 'top_products' || templateId === 'branch_performance';
    const fallbackIntent = {
      intent: isRank ? 'rank' : 'show_metric',
      metric: templateId,
      template_id: templateId,
      time_period: basePeriod,
      branch: intent?.branch || null,
      channel: intent?.channel || null,
      limit: isRank ? Math.max(5, Number(intent?.limit || 5)) : 1,
      dimension: templateId === 'branch_performance' ? 'branch' : null,
    };

    const analytics = executeAnalyticsIntent({
      tenantId,
      userId,
      intent: fallbackIntent,
    });

    if (Array.isArray(analytics?.widgets)) {
      widgets.push(...analytics.widgets);
    }
    if (Array.isArray(analytics?.artifacts) && analytics.artifacts.length > 0) {
      artifacts.push(...analytics.artifacts);
    } else if (Array.isArray(analytics?.widgets) && analytics.widgets.length > 0) {
      artifacts.push(...widgetsToArtifacts(analytics.widgets));
    }
  }

  const uniqueArtifacts = [];
  const seen = new Set();
  for (const item of artifacts) {
    const key = `${item.kind}:${item.title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueArtifacts.push(item);
  }

  return {
    answer: `Saya siapkan dashboard cepat dari template default. Dashboard berisi ${Math.min(widgets.length, 6)} widget.`,
    widgets: widgets.slice(0, 6),
    artifacts: uniqueArtifacts.slice(0, 6),
    presentation_mode: 'canvas',
    fallback: true,
  };
}

export async function processChatMessage({
  tenantId,
  userId,
  message,
  conversationId,
  dashboardId,
  stream = null,
}) {
  const conversation = ensureConversation(tenantId, userId, conversationId);
  createMessage({
    conversationId: conversation.id,
    tenantId,
    userId,
    role: 'user',
    content: message,
  });

  const history = historyForConversation(tenantId, userId, conversation.id, 12).map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const intent = await parseIntent(message, history);
  const datasetReady = hasDataset(tenantId);

  if (!datasetReady && intent.intent !== 'data_management') {
    const responsePayload = {
      answer:
        'Dataset belum tersedia. Upload file data dulu (CSV/JSON/XLSX/XLS) atau gunakan Demo Dataset, lalu coba pertanyaan ini lagi.',
      widgets: [],
      artifacts: [],
      intent,
      presentation_mode: 'chat',
      requires_dataset: true,
    };

    createMessage({
      conversationId: conversation.id,
      tenantId,
      userId: null,
      role: 'assistant',
      content: responsePayload.answer,
      payload: responsePayload,
    });

    return {
      conversation_id: conversation.id,
      ...responsePayload,
    };
  }

  let responsePayload = {
    answer: 'Permintaan diproses.',
    widgets: [],
    artifacts: [],
    intent,
    presentation_mode: 'chat',
  };

  if (intent.intent === 'modify_dashboard') {
    const dashboard = dashboardId
      ? getDashboard(tenantId, userId, dashboardId)
      : ensureDefaultDashboard(tenantId, userId);

    const result = applyDashboardModification({
      tenantId,
      userId,
      dashboard,
      intent,
      originalMessage: message,
    });

    responsePayload = {
      answer: result.summary,
      widgets: [],
      artifacts: [],
      intent,
      dashboard: result.dashboard,
      presentation_mode: 'canvas',
    };
  } else if (intent.intent === 'generate_report') {
    const report = generateReport({
      tenantId,
      userId,
      period: normalizeReportPeriod(intent),
      title: intent.dashboard_name || null,
    });

    responsePayload = {
      answer: `Laporan siap: ${report.title}`,
      widgets: [],
      artifacts: [
        {
          kind: 'text',
          title: report.title,
          content: report.content,
        },
      ],
      intent,
      report,
      presentation_mode: 'chat',
    };
  } else if (intent.intent === 'set_goal') {
    const targetValue = parseGoalFromMessage(message, intent);
    if (targetValue && targetValue > 0) {
      const metric = intent.metric?.includes('untung') ? 'profit' : intent.metric?.includes('margin') ? 'margin' : 'revenue';
      const goal = createGoal({
        tenantId,
        userId,
        metric,
        targetValue,
        startDate: new Date(),
        endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
      });

      responsePayload = {
        answer: `Goal ${metric} berhasil dibuat dengan target ${targetValue.toLocaleString('id-ID')}.`,
        widgets: [
          {
            type: 'GoalTracker',
            title: `Goal ${metric}`,
            target: goal.target_value,
          },
        ],
        artifacts: [
          {
            kind: 'metric',
            title: `Goal ${metric}`,
            value: `${Number(goal.target_value || 0).toLocaleString('id-ID')}`,
          },
        ],
        intent,
        goal,
        presentation_mode: 'chat',
      };
    } else {
      responsePayload = {
        answer: 'Sebutkan nilai target, contoh: "Target omzet 200000000".',
        widgets: [],
        artifacts: [],
        intent,
        presentation_mode: 'chat',
      };
    }
  } else if (intent.intent === 'data_management') {
    responsePayload = {
      answer: 'Upload file data dari input workspace atau gunakan Demo Dataset untuk mulai analisis.',
      widgets: [],
      artifacts: [],
      intent,
      presentation_mode: 'chat',
    };
  } else {
    const needsCanvas = isComplexDashboardRequest(message, intent);

    if (needsCanvas) {
      const timelineId = generateId();
      if (stream && typeof stream.onTimelineStart === 'function') {
        stream.onTimelineStart({
          timeline_id: timelineId,
          title: 'Agentic Thinking',
        });
      }
      try {
        const complexTimeoutMs = 12000;
        const complex = await Promise.race([
          runDashboardAgent({
            tenantId,
            userId,
            dashboardId,
            goal: message,
            intent,
            hooks: {
              onTimelineEvent: (event) => {
                if (stream && typeof stream.onTimelineStep === 'function') {
                  stream.onTimelineStep({
                    timeline_id: timelineId,
                    ...event,
                  });
                }
              },
            },
          }),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('dashboard_agent_timeout'));
            }, complexTimeoutMs);
          }),
        ]);

        responsePayload = {
          ...complex,
          answer: complex.answer,
          widgets: complex.widgets,
          artifacts: complex.artifacts,
          intent,
          presentation_mode: 'canvas',
        };
      } catch (error) {
        if (stream && typeof stream.onTimelineStep === 'function') {
          stream.onTimelineStep({
            timeline_id: timelineId,
            id: `dashboard_fallback_${Date.now()}`,
            agent: 'system',
            status: 'error',
            title: 'Mode agentic sibuk, gunakan fallback dashboard cepat',
          });
        }
        responsePayload = {
          ...deterministicDashboardFallback({ tenantId, userId, intent }),
          intent,
          agent: {
            mode: 'deterministic_fallback',
            reason: error?.message || 'dashboard_agent_failed',
          },
        };
      } finally {
        if (stream && typeof stream.onTimelineDone === 'function') {
          stream.onTimelineDone({
            timeline_id: timelineId,
          });
        }
      }
    } else {
      const analytics = executeAnalyticsIntent({ tenantId, userId, intent });
      responsePayload = {
        ...analytics,
        artifacts: analytics.artifacts || widgetsToArtifacts(analytics.widgets),
        intent,
        presentation_mode: 'chat',
      };
    }
  }

  createMessage({
    conversationId: conversation.id,
    tenantId,
    userId: null,
    role: 'assistant',
    content: responsePayload.answer,
    payload: responsePayload,
  });

  logAudit({
    tenantId,
    userId,
    action: 'chat_message',
    resourceType: 'conversation',
    resourceId: conversation.id,
    metadata: {
      intent: intent.intent,
      nlu_source: intent.nlu_source,
    },
  });

  return {
    conversation_id: conversation.id,
    ...responsePayload,
  };
}

export function getChatHistory({ tenantId, userId, conversationId = null }) {
  const convo = ensureConversation(tenantId, userId, conversationId);
  return {
    conversation_id: convo.id,
    messages: historyForConversation(tenantId, userId, convo.id, 200),
  };
}

export function setChatFeedback({ tenantId, userId, messageId, feedback }) {
  const target = get(
    `
      SELECT id
      FROM chat_messages
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    { id: messageId, tenant_id: tenantId },
  );

  if (!target) {
    return false;
  }

  run(
    `
      UPDATE chat_messages
      SET feedback = :feedback
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    {
      id: messageId,
      tenant_id: tenantId,
      feedback,
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'chat_feedback',
    resourceType: 'chat_message',
    resourceId: messageId,
    metadata: { feedback },
  });

  return true;
}
