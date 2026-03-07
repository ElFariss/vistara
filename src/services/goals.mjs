import { all, get, run } from '../db.mjs';
import { generateId } from '../utils/ids.mjs';
import { parseFlexibleDate } from '../utils/parse.mjs';
import { logAudit } from './audit.mjs';

function goalActualValue(tenantId, goal) {
  if (!goal) {
    return 0;
  }

  if (goal.metric === 'profit') {
    const row = get(
      `
        SELECT COALESCE(SUM(total_revenue - COALESCE(cogs, 0) - COALESCE(discount, 0)), 0) AS value
        FROM transactions
        WHERE tenant_id = :tenant_id
          AND transaction_date BETWEEN :start_date AND :end_date
      `,
      {
        tenant_id: tenantId,
        start_date: goal.start_date,
        end_date: goal.end_date,
      },
    );
    return Number(row?.value || 0);
  }

  if (goal.metric === 'margin') {
    const row = get(
      `
        SELECT
          CASE WHEN SUM(total_revenue) = 0 THEN 0
               ELSE (SUM(total_revenue - COALESCE(cogs,0) - COALESCE(discount,0)) / SUM(total_revenue)) * 100
          END AS value
        FROM transactions
        WHERE tenant_id = :tenant_id
          AND transaction_date BETWEEN :start_date AND :end_date
      `,
      {
        tenant_id: tenantId,
        start_date: goal.start_date,
        end_date: goal.end_date,
      },
    );
    return Number(row?.value || 0);
  }

  const revenue = get(
    `
      SELECT COALESCE(SUM(total_revenue), 0) AS value
      FROM transactions
      WHERE tenant_id = :tenant_id
        AND transaction_date BETWEEN :start_date AND :end_date
    `,
    {
      tenant_id: tenantId,
      start_date: goal.start_date,
      end_date: goal.end_date,
    },
  );

  return Number(revenue?.value || 0);
}

export function createGoal({ tenantId, userId, metric = 'revenue', targetValue, startDate, endDate }) {
  const start = parseFlexibleDate(startDate) || new Date();
  const end = parseFlexibleDate(endDate) || new Date(new Date().setMonth(new Date().getMonth() + 1));

  if (!(targetValue > 0)) {
    throw new Error('Target goal harus lebih dari 0.');
  }

  const id = generateId();
  run(
    `
      INSERT INTO goals (id, tenant_id, user_id, metric, target_value, start_date, end_date, status, created_at)
      VALUES (:id, :tenant_id, :user_id, :metric, :target_value, :start_date, :end_date, :status, :created_at)
    `,
    {
      id,
      tenant_id: tenantId,
      user_id: userId,
      metric,
      target_value: targetValue,
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    },
  );

  logAudit({
    tenantId,
    userId,
    action: 'goal_create',
    resourceType: 'goal',
    resourceId: id,
    metadata: { metric, targetValue },
  });

  return getGoal(tenantId, userId, id);
}

export function listGoals(tenantId, userId) {
  return all(
    `
      SELECT id, metric, target_value, start_date, end_date, status, created_at
      FROM goals
      WHERE tenant_id = :tenant_id AND user_id = :user_id
      ORDER BY created_at DESC
    `,
    { tenant_id: tenantId, user_id: userId },
  );
}

export function getGoal(tenantId, userId, goalId) {
  return get(
    `
      SELECT id, metric, target_value, start_date, end_date, status, created_at
      FROM goals
      WHERE tenant_id = :tenant_id AND user_id = :user_id AND id = :id
    `,
    { tenant_id: tenantId, user_id: userId, id: goalId },
  );
}

export function getGoalProgress(tenantId, userId, goalId) {
  const goal = getGoal(tenantId, userId, goalId);
  if (!goal) {
    return null;
  }

  const actual = goalActualValue(tenantId, goal);
  const target = Number(goal.target_value || 0);
  const progressPct = target <= 0 ? 0 : (actual / target) * 100;

  const now = new Date();
  const end = new Date(goal.end_date);
  const remainingDays = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  const remainingValue = Math.max(0, target - actual);
  const perDayNeeded = remainingDays > 0 ? remainingValue / remainingDays : remainingValue;

  return {
    goal,
    actual_value: Number(actual.toFixed(2)),
    target_value: target,
    progress_pct: Number(progressPct.toFixed(2)),
    remaining_value: Number(remainingValue.toFixed(2)),
    remaining_days: remainingDays,
    required_per_day: Number(perDayNeeded.toFixed(2)),
  };
}
