import { run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';

export function logAudit({ tenantId = null, userId = null, action, resourceType = null, resourceId = null, metadata = null }) {
  run(
    `
      INSERT INTO audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, metadata_json, created_at)
      VALUES (:id, :tenant_id, :user_id, :action, :resource_type, :resource_id, :metadata_json, :created_at)
    `,
    {
      id: generateId(),
      tenant_id: tenantId,
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      created_at: new Date().toISOString(),
    },
  );
}
