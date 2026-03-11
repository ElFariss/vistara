import { get, run } from '../db.mjs';
import { safeJsonParse } from '../utils/parse.mjs';

function parseStateRow(row) {
  if (!row) {
    return null;
  }

  return {
    conversation_id: row.conversation_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    memory: safeJsonParse(row.memory_json, {}),
    dataset_profile: safeJsonParse(row.dataset_profile_json, null),
    draft_dashboard: safeJsonParse(row.draft_dashboard_json, null),
    pending_approval: safeJsonParse(row.pending_approval_json, null),
    active_run: safeJsonParse(row.active_run_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getConversationAgentState({ tenantId, userId, conversationId }) {
  const row = get(
    `
      SELECT *
      FROM conversation_agent_state
      WHERE conversation_id = :conversation_id
        AND tenant_id = :tenant_id
        AND user_id = :user_id
      LIMIT 1
    `,
    {
      conversation_id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
    },
  );

  return parseStateRow(row);
}

export function ensureConversationAgentState({ tenantId, userId, conversationId }) {
  const existing = getConversationAgentState({ tenantId, userId, conversationId });
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  run(
    `
      INSERT INTO conversation_agent_state (
        conversation_id,
        tenant_id,
        user_id,
        memory_json,
        dataset_profile_json,
        draft_dashboard_json,
        pending_approval_json,
        active_run_json,
        created_at,
        updated_at
      ) VALUES (
        :conversation_id,
        :tenant_id,
        :user_id,
        :memory_json,
        :dataset_profile_json,
        :draft_dashboard_json,
        :pending_approval_json,
        :active_run_json,
        :created_at,
        :updated_at
      )
    `,
    {
      conversation_id: conversationId,
      tenant_id: tenantId,
      user_id: userId,
      memory_json: JSON.stringify({}),
      dataset_profile_json: null,
      draft_dashboard_json: null,
      pending_approval_json: null,
      active_run_json: null,
      created_at: now,
      updated_at: now,
    },
  );

  return getConversationAgentState({ tenantId, userId, conversationId });
}

function serializeField(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return JSON.stringify(value);
}

export function updateConversationAgentState({
  tenantId,
  userId,
  conversationId,
  memory,
  datasetProfile,
  draftDashboard,
  pendingApproval,
  activeRun,
} = {}) {
  ensureConversationAgentState({ tenantId, userId, conversationId });
  const now = new Date().toISOString();
  const fields = [];
  const params = {
    conversation_id: conversationId,
    tenant_id: tenantId,
    user_id: userId,
    updated_at: now,
  };

  if (memory !== undefined) {
    fields.push('memory_json = :memory_json');
    params.memory_json = serializeField(memory);
  }
  if (datasetProfile !== undefined) {
    fields.push('dataset_profile_json = :dataset_profile_json');
    params.dataset_profile_json = serializeField(datasetProfile);
  }
  if (draftDashboard !== undefined) {
    fields.push('draft_dashboard_json = :draft_dashboard_json');
    params.draft_dashboard_json = serializeField(draftDashboard);
  }
  if (pendingApproval !== undefined) {
    fields.push('pending_approval_json = :pending_approval_json');
    params.pending_approval_json = serializeField(pendingApproval);
  }
  if (activeRun !== undefined) {
    fields.push('active_run_json = :active_run_json');
    params.active_run_json = serializeField(activeRun);
  }

  if (fields.length === 0) {
    return getConversationAgentState({ tenantId, userId, conversationId });
  }

  fields.push('updated_at = :updated_at');
  run(
    `
      UPDATE conversation_agent_state
      SET ${fields.join(', ')}
      WHERE conversation_id = :conversation_id
        AND tenant_id = :tenant_id
        AND user_id = :user_id
    `,
    params,
  );

  return getConversationAgentState({ tenantId, userId, conversationId });
}

export function mergeConversationAgentMemory({ tenantId, userId, conversationId, patch = {} } = {}) {
  const existing = ensureConversationAgentState({ tenantId, userId, conversationId });
  return updateConversationAgentState({
    tenantId,
    userId,
    conversationId,
    memory: {
      ...(existing?.memory || {}),
      ...(patch && typeof patch === 'object' ? patch : {}),
    },
  });
}
