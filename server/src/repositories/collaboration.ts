import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import { recordActivityEvent } from "./activity-events.js";
import { recordEventLog } from "./event-log.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";
import { recordInsightAppliedReward } from "./rewards.js";
import {
  agentActionSchema,
  approvalRequestSchema,
  createAgentActionSchema,
  createInsightFeedbackSchema,
  createInsightSchema,
  insightFeedbackSchema,
  insightSchema,
  updateInsightSchema,
  type ActivitySource,
  type AgentAction,
  type AgentTokenSummary,
  type ApprovalRequest,
  type CreateAgentActionInput,
  type CreateInsightFeedbackInput,
  type CreateInsightInput,
  type Insight,
  type InsightFeedback,
  type UpdateInsightInput
} from "../types.js";

type InsightRow = {
  id: string;
  origin_type: Insight["originType"];
  origin_agent_id: string | null;
  origin_label: string | null;
  visibility: Insight["visibility"];
  status: Insight["status"];
  entity_type: string | null;
  entity_id: string | null;
  timeframe_label: string | null;
  title: string;
  summary: string;
  recommendation: string;
  rationale: string;
  confidence: number;
  cta_label: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
};

type InsightFeedbackRow = {
  id: string;
  insight_id: string;
  actor: string | null;
  feedback_type: InsightFeedback["feedbackType"];
  note: string;
  created_at: string;
};

type ApprovalRequestRow = {
  id: string;
  action_type: string;
  status: ApprovalRequest["status"];
  title: string;
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  requested_by_agent_id: string | null;
  requested_by_token_id: string | null;
  requested_payload_json: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  resolution_note: string;
  created_at: string;
  updated_at: string;
};

type AgentActionRow = {
  id: string;
  agent_id: string | null;
  token_id: string | null;
  action_type: string;
  risk_level: AgentAction["riskLevel"];
  status: AgentAction["status"];
  title: string;
  summary: string;
  payload_json: string;
  idempotency_key: string | null;
  approval_request_id: string | null;
  outcome_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type MetadataValue = string | number | boolean | null;

export type CollaborationContext = {
  source: ActivitySource;
  actor?: string | null;
  token?: AgentTokenSummary | null;
};

function mapInsight(row: InsightRow): Insight {
  return insightSchema.parse({
    id: row.id,
    originType: row.origin_type,
    originAgentId: row.origin_agent_id,
    originLabel: row.origin_label,
    visibility: row.visibility,
    status: row.status,
    entityType: row.entity_type,
    entityId: row.entity_id,
    timeframeLabel: row.timeframe_label,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    rationale: row.rationale,
    confidence: row.confidence,
    ctaLabel: row.cta_label,
    evidence: JSON.parse(row.evidence_json) as Insight["evidence"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapFeedback(row: InsightFeedbackRow): InsightFeedback {
  return insightFeedbackSchema.parse({
    id: row.id,
    insightId: row.insight_id,
    actor: row.actor,
    feedbackType: row.feedback_type,
    note: row.note,
    createdAt: row.created_at
  });
}

function mapApproval(row: ApprovalRequestRow): ApprovalRequest {
  return approvalRequestSchema.parse({
    id: row.id,
    actionType: row.action_type,
    status: row.status,
    title: row.title,
    summary: row.summary,
    entityType: row.entity_type,
    entityId: row.entity_id,
    requestedByAgentId: row.requested_by_agent_id,
    requestedByTokenId: row.requested_by_token_id,
    requestedPayload: JSON.parse(row.requested_payload_json) as Record<string, unknown>,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapAction(row: AgentActionRow): AgentAction {
  return agentActionSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    tokenId: row.token_id,
    actionType: row.action_type,
    riskLevel: row.risk_level,
    status: row.status,
    title: row.title,
    summary: row.summary,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    approvalRequestId: row.approval_request_id,
    outcome: JSON.parse(row.outcome_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  });
}

function shouldRequireApproval(input: CreateAgentActionInput, token?: AgentTokenSummary | null): boolean {
  if (!token) {
    return input.riskLevel !== "low";
  }
  if (token.autonomyMode === "approval_required") {
    return true;
  }
  if (input.riskLevel === "high") {
    return token.approvalMode !== "none";
  }
  if (token.approvalMode === "approval_by_default") {
    return true;
  }
  return false;
}

function getInsightRowById(insightId: string): InsightRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT
         id, origin_type, origin_agent_id, origin_label, visibility, status, entity_type, entity_id,
         timeframe_label, title, summary, recommendation, rationale, confidence, cta_label, evidence_json, created_at, updated_at
       FROM insights
       WHERE id = ?`
    )
    .get(insightId) as InsightRow | undefined;
}

export function listInsights(filters: { entityType?: string; entityId?: string; status?: Insight["status"]; limit?: number } = {}): Insight[] {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.entityType) {
    whereClauses.push("entity_type = ?");
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    whereClauses.push("entity_id = ?");
    params.push(filters.entityId);
  }
  if (filters.status) {
    whereClauses.push("status = ?");
    params.push(filters.status);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limitSql = filters.limit ? "LIMIT ?" : "";
  if (filters.limit) {
    params.push(filters.limit);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, origin_type, origin_agent_id, origin_label, visibility, status, entity_type, entity_id,
         timeframe_label, title, summary, recommendation, rationale, confidence, cta_label, evidence_json, created_at, updated_at
       FROM insights
       ${whereSql}
       ORDER BY created_at DESC
       ${limitSql}`
    )
    .all(...params) as InsightRow[];
  return filterDeletedEntities("insight", rows.map(mapInsight));
}

export function getInsightById(insightId: string): Insight | undefined {
  if (isEntityDeleted("insight", insightId)) {
    return undefined;
  }
  const row = getInsightRowById(insightId);
  return row ? mapInsight(row) : undefined;
}

export function createInsight(input: CreateInsightInput, context: CollaborationContext): Insight {
  const parsed = createInsightSchema.parse(input);
  const now = new Date().toISOString();
  const insightId = `ins_${randomUUID().replaceAll("-", "").slice(0, 10)}`;

  getDatabase()
    .prepare(
      `INSERT INTO insights (
        id, origin_type, origin_agent_id, origin_label, visibility, status, entity_type, entity_id, timeframe_label,
        title, summary, recommendation, rationale, confidence, cta_label, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      insightId,
      parsed.originType,
      parsed.originAgentId,
      parsed.originLabel,
      parsed.visibility,
      parsed.status,
      parsed.entityType,
      parsed.entityId,
      parsed.timeframeLabel,
      parsed.title,
      parsed.summary,
      parsed.recommendation,
      parsed.rationale,
      parsed.confidence,
      parsed.ctaLabel,
      JSON.stringify(parsed.evidence),
      now,
      now
    );

  recordActivityEvent({
    entityType: "insight",
    entityId: insightId,
    eventType: "insight_created",
    title: `Insight captured: ${parsed.title}`,
    description: parsed.summary,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      originType: parsed.originType,
      entityType: parsed.entityType ?? "",
      entityId: parsed.entityId ?? ""
    }
  });
  recordEventLog({
    eventKind: "insight.created",
    entityType: "insight",
    entityId: insightId,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      originType: parsed.originType,
      confidence: parsed.confidence
    }
  });

  return getInsightById(insightId)!;
}

export function updateInsight(insightId: string, input: UpdateInsightInput, context: CollaborationContext): Insight | undefined {
  const current = getInsightById(insightId);
  if (!current) {
    return undefined;
  }
  const parsed = updateInsightSchema.parse(input);
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE insights
       SET visibility = ?, status = ?, entity_type = ?, entity_id = ?, timeframe_label = ?, title = ?, summary = ?,
           recommendation = ?, rationale = ?, confidence = ?, cta_label = ?, evidence_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.visibility ?? current.visibility,
      parsed.status ?? current.status,
      parsed.entityType === undefined ? current.entityType : parsed.entityType,
      parsed.entityId === undefined ? current.entityId : parsed.entityId,
      parsed.timeframeLabel === undefined ? current.timeframeLabel : parsed.timeframeLabel,
      parsed.title ?? current.title,
      parsed.summary ?? current.summary,
      parsed.recommendation ?? current.recommendation,
      parsed.rationale ?? current.rationale,
      parsed.confidence ?? current.confidence,
      parsed.ctaLabel ?? current.ctaLabel,
      JSON.stringify(parsed.evidence ?? current.evidence),
      updatedAt,
      insightId
    );

  recordEventLog({
    eventKind: "insight.updated",
    entityType: "insight",
    entityId: insightId,
    actor: context.actor ?? null,
    source: context.source
  });
  return getInsightById(insightId);
}

export function deleteInsight(insightId: string, context: CollaborationContext): Insight | undefined {
  const existing = getInsightRowById(insightId);
  if (!existing) {
    return undefined;
  }

  getDatabase().prepare(`DELETE FROM insight_feedback WHERE insight_id = ?`).run(insightId);
  getDatabase().prepare(`DELETE FROM insights WHERE id = ?`).run(insightId);

  recordActivityEvent({
    entityType: "insight",
    entityId: insightId,
    eventType: "insight_deleted",
    title: `Insight deleted: ${existing.title}`,
    description: existing.summary,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      entityType: existing.entity_type ?? "",
      entityId: existing.entity_id ?? ""
    }
  });
  recordEventLog({
    eventKind: "insight.deleted",
    entityType: "insight",
    entityId: insightId,
    actor: context.actor ?? null,
    source: context.source
  });

  return mapInsight(existing);
}

export function listInsightFeedback(insightId: string): InsightFeedback[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, insight_id, actor, feedback_type, note, created_at
       FROM insight_feedback
       WHERE insight_id = ?
       ORDER BY created_at DESC`
    )
    .all(insightId) as InsightFeedbackRow[];
  return rows.map(mapFeedback);
}

export function createInsightFeedback(insightId: string, input: CreateInsightFeedbackInput, context: CollaborationContext): InsightFeedback | undefined {
  const insight = getInsightById(insightId);
  if (!insight) {
    return undefined;
  }

  const parsed = createInsightFeedbackSchema.parse(input);
  const feedbackId = `fbk_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const createdAt = new Date().toISOString();
  getDatabase()
    .prepare(`INSERT INTO insight_feedback (id, insight_id, actor, feedback_type, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(feedbackId, insightId, parsed.actor ?? context.actor ?? null, parsed.feedbackType, parsed.note, createdAt);

  const nextStatus =
    parsed.feedbackType === "accepted"
      ? "accepted"
      : parsed.feedbackType === "dismissed"
        ? "dismissed"
        : parsed.feedbackType === "applied"
          ? "applied"
          : "snoozed";
  getDatabase().prepare(`UPDATE insights SET status = ?, updated_at = ? WHERE id = ?`).run(nextStatus, createdAt, insightId);

  if (parsed.feedbackType === "applied" && insight.entityType && insight.entityId) {
    recordInsightAppliedReward(insightId, insight.entityType, insight.entityId, {
      actor: parsed.actor ?? context.actor ?? null,
      source: context.source
    });
  }

  recordActivityEvent({
    entityType: "insight",
    entityId: insightId,
    eventType: "insight_feedback_recorded",
    title: `Insight ${nextStatus}: ${insight.title}`,
    description: parsed.note || `Insight marked ${nextStatus}.`,
    actor: parsed.actor ?? context.actor ?? null,
    source: context.source,
    metadata: {
      feedbackType: parsed.feedbackType
    }
  });

  return listInsightFeedback(insightId)[0];
}

function insertApprovalRequest(input: {
  actionType: string;
  title: string;
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  requestedByAgentId?: string | null;
  requestedByTokenId?: string | null;
  requestedPayload: Record<string, unknown>;
}): ApprovalRequest {
  const approvalId = `apr_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO approval_requests (
        id, action_type, status, title, summary, entity_type, entity_id, requested_by_agent_id, requested_by_token_id,
        requested_payload_json, resolution_note, created_at, updated_at
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
    )
    .run(
      approvalId,
      input.actionType,
      input.title,
      input.summary,
      input.entityType ?? null,
      input.entityId ?? null,
      input.requestedByAgentId ?? null,
      input.requestedByTokenId ?? null,
      JSON.stringify(input.requestedPayload),
      now,
      now
    );
  recordEventLog({
    eventKind: "approval.requested",
    entityType: "approval_request",
    entityId: approvalId,
    actor: null,
    source: "agent",
    metadata: {
      actionType: input.actionType
    }
  });
  return listApprovalRequests().find((entry) => entry.id === approvalId)!;
}

export function listApprovalRequests(status?: ApprovalRequest["status"]): ApprovalRequest[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, action_type, status, title, summary, entity_type, entity_id, requested_by_agent_id, requested_by_token_id,
         requested_payload_json, approved_by, approved_at, rejected_by, rejected_at, resolution_note, created_at, updated_at
       FROM approval_requests
       ${status ? "WHERE status = ?" : ""}
       ORDER BY created_at DESC`
    )
    .all(...(status ? [status] : [])) as ApprovalRequestRow[];
  return rows.map(mapApproval);
}

function getApprovalRequestRow(id: string): ApprovalRequestRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT
         id, action_type, status, title, summary, entity_type, entity_id, requested_by_agent_id, requested_by_token_id,
         requested_payload_json, approved_by, approved_at, rejected_by, rejected_at, resolution_note, created_at, updated_at
       FROM approval_requests
       WHERE id = ?`
    )
    .get(id) as ApprovalRequestRow | undefined;
}

function executeAgentAction(action: AgentAction, context: CollaborationContext): Record<string, unknown> {
  if (action.actionType === "create_insight") {
    const insight = createInsight(createInsightSchema.parse(action.payload), context);
    return { insightId: insight.id };
  }
  if (action.actionType === "create_task") {
    const task = createTask(action.payload as never, { source: context.source, actor: context.actor ?? null });
    return { taskId: task.id };
  }
  if (action.actionType === "create_project") {
    const project = createProject(action.payload as never, { source: context.source, actor: context.actor ?? null });
    return { projectId: project.id };
  }
  return { deferred: true };
}

export function createAgentAction(
  input: CreateAgentActionInput,
  context: CollaborationContext,
  idempotencyKey?: string | null
): { action: AgentAction; approvalRequest: ApprovalRequest | null } {
  const parsed = createAgentActionSchema.parse(input);
  if (idempotencyKey) {
    const existing = getDatabase()
      .prepare(
        `SELECT
           id, agent_id, token_id, action_type, risk_level, status, title, summary, payload_json, idempotency_key,
           approval_request_id, outcome_json, created_at, updated_at, completed_at
         FROM agent_actions
         WHERE idempotency_key = ?`
      )
      .get(idempotencyKey) as AgentActionRow | undefined;
    if (existing) {
      return {
        action: mapAction(existing),
        approvalRequest: existing.approval_request_id
          ? listApprovalRequests().find((entry) => entry.id === existing.approval_request_id) ?? null
          : null
      };
    }
  }

  const now = new Date().toISOString();
  const actionId = `act_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const requiresApproval = shouldRequireApproval(parsed, context.token);
  const approvalRequest = requiresApproval
    ? insertApprovalRequest({
        actionType: parsed.actionType,
        title: parsed.title,
        summary: parsed.summary,
        entityType: typeof parsed.payload.entityType === "string" ? parsed.payload.entityType : null,
        entityId: typeof parsed.payload.entityId === "string" ? parsed.payload.entityId : null,
        requestedByAgentId: parsed.agentId ?? context.token?.agentId ?? null,
        requestedByTokenId: parsed.tokenId ?? context.token?.id ?? null,
        requestedPayload: parsed.payload
      })
    : null;

  const status: AgentAction["status"] = requiresApproval ? "pending_approval" : "executed";
  const actionSeed = agentActionSchema.parse({
    id: actionId,
    agentId: parsed.agentId ?? context.token?.agentId ?? null,
    tokenId: parsed.tokenId ?? context.token?.id ?? null,
    actionType: parsed.actionType,
    riskLevel: parsed.riskLevel,
    status,
    title: parsed.title,
    summary: parsed.summary,
    payload: parsed.payload,
    idempotencyKey: idempotencyKey ?? null,
    approvalRequestId: approvalRequest?.id ?? null,
    outcome: {},
    createdAt: now,
    updatedAt: now,
    completedAt: requiresApproval ? null : now
  });
  const outcome = requiresApproval ? {} : executeAgentAction(actionSeed, context);

  getDatabase()
    .prepare(
      `INSERT INTO agent_actions (
        id, agent_id, token_id, action_type, risk_level, status, title, summary, payload_json, idempotency_key,
        approval_request_id, outcome_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      actionId,
      actionSeed.agentId,
      actionSeed.tokenId,
      actionSeed.actionType,
      actionSeed.riskLevel,
      actionSeed.status,
      actionSeed.title,
      actionSeed.summary,
      JSON.stringify(actionSeed.payload),
      actionSeed.idempotencyKey,
      actionSeed.approvalRequestId,
      JSON.stringify(outcome),
      actionSeed.createdAt,
      actionSeed.updatedAt,
      actionSeed.completedAt
    );

  recordActivityEvent({
    entityType: "agent_action",
    entityId: actionId,
    eventType: requiresApproval ? "agent_action_requested" : "agent_action_executed",
    title: requiresApproval ? `Approval requested: ${parsed.title}` : `Agent action executed: ${parsed.title}`,
    description: parsed.summary,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      actionType: parsed.actionType,
      riskLevel: parsed.riskLevel
    }
  });

  const actionRow = getDatabase()
    .prepare(
      `SELECT
         id, agent_id, token_id, action_type, risk_level, status, title, summary, payload_json, idempotency_key,
         approval_request_id, outcome_json, created_at, updated_at, completed_at
       FROM agent_actions
       WHERE id = ?`
    )
    .get(actionId) as AgentActionRow;

  return { action: mapAction(actionRow), approvalRequest };
}

export function listAgentActions(agentId: string): AgentAction[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, agent_id, token_id, action_type, risk_level, status, title, summary, payload_json, idempotency_key,
         approval_request_id, outcome_json, created_at, updated_at, completed_at
       FROM agent_actions
       WHERE agent_id = ?
       ORDER BY created_at DESC`
    )
    .all(agentId) as AgentActionRow[];
  return rows.map(mapAction);
}

export function approveApprovalRequest(approvalId: string, note: string, actor: string | null): ApprovalRequest | undefined {
  const row = getApprovalRequestRow(approvalId);
  if (!row || row.status !== "pending") {
    return row ? mapApproval(row) : undefined;
  }

  const approvedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE approval_requests
       SET status = 'approved', approved_by = ?, approved_at = ?, resolution_note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(actor, approvedAt, note, approvedAt, approvalId);

  const actionRow = getDatabase()
    .prepare(
      `SELECT
         id, agent_id, token_id, action_type, risk_level, status, title, summary, payload_json, idempotency_key,
         approval_request_id, outcome_json, created_at, updated_at, completed_at
       FROM agent_actions
       WHERE approval_request_id = ?`
    )
    .get(approvalId) as AgentActionRow | undefined;

  if (actionRow) {
    const action = mapAction(actionRow);
    const outcome = executeAgentAction(action, {
      actor,
      source: "ui",
      token: null
    });
    getDatabase()
      .prepare(
        `UPDATE agent_actions
         SET status = 'executed', outcome_json = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(outcome), approvedAt, approvedAt, action.id);
    getDatabase().prepare(`UPDATE approval_requests SET status = 'executed', updated_at = ? WHERE id = ?`).run(approvedAt, approvalId);
  }

  recordActivityEvent({
    entityType: "approval_request",
    entityId: approvalId,
    eventType: "approval_request_approved",
    title: `Approval request approved`,
    description: note || "A pending agent action was approved.",
    actor,
    source: "ui",
    metadata: {}
  });

  return mapApproval(getApprovalRequestRow(approvalId)!);
}

export function rejectApprovalRequest(approvalId: string, note: string, actor: string | null): ApprovalRequest | undefined {
  const row = getApprovalRequestRow(approvalId);
  if (!row || row.status !== "pending") {
    return row ? mapApproval(row) : undefined;
  }

  const rejectedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE approval_requests
       SET status = 'rejected', rejected_by = ?, rejected_at = ?, resolution_note = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(actor, rejectedAt, note, rejectedAt, approvalId);
  getDatabase()
    .prepare(`UPDATE agent_actions SET status = 'rejected', updated_at = ? WHERE approval_request_id = ?`)
    .run(rejectedAt, approvalId);

  recordActivityEvent({
    entityType: "approval_request",
    entityId: approvalId,
    eventType: "approval_request_rejected",
    title: `Approval request rejected`,
    description: note || "A pending agent action was rejected.",
    actor,
    source: "ui",
    metadata: {}
  });

  return mapApproval(getApprovalRequestRow(approvalId)!);
}
