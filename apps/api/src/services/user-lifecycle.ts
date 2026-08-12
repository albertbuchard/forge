import { createHash, randomUUID } from "node:crypto";

import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "../repositories/activity-events.js";
import {
  getUserById,
  listUserOwnershipDefaults,
  listUsers,
  setUserOwnershipDefault
} from "../repositories/users.js";
import {
  userDeactivationPreviewSchema,
  userIdentityEvidenceSchema,
  userLifecycleReceiptSchema,
  type ActivitySource,
  type DeactivateUserInput,
  type ReactivateUserInput,
  type SetUserOwnershipDefaultInput,
  type UserDeactivationPreview,
  type UserIdentityEvidence,
  type UserLifecycleReceipt,
  type UserSummary
} from "../types.js";

type LifecycleContext = {
  actorKey: string;
  actor: string | null;
  source: ActivitySource;
};

type ReceiptRow = {
  request_sha256: string;
  response_json: string;
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function allUsers(): UserSummary[] {
  return [
    ...listUsers({ lifecycleStatus: "active" }),
    ...listUsers({ lifecycleStatus: "inactive" })
  ];
}

function readReceipt(
  actorKey: string,
  idempotencyKey: string,
  requestSha256: string
): UserLifecycleReceipt | null {
  const row = getDatabase()
    .prepare(
      `SELECT request_sha256, response_json
       FROM user_lifecycle_receipts
       WHERE actor_key = ? AND idempotency_key = ?`
    )
    .get(actorKey, idempotencyKey) as ReceiptRow | undefined;
  if (!row) {
    return null;
  }
  if (row.request_sha256 !== requestSha256) {
    throw new HttpError(
      409,
      "user_lifecycle_idempotency_conflict",
      "This lifecycle idempotency key was already used with a different request."
    );
  }
  return userLifecycleReceiptSchema.parse({
    ...(JSON.parse(row.response_json) as UserLifecycleReceipt),
    replayed: true
  });
}

function storeReceipt(input: {
  receipt: UserLifecycleReceipt;
  operation: UserLifecycleReceipt["operation"];
  userId: string;
  replacementUserId: string | null;
  context: LifecycleContext;
  idempotencyKey: string;
  requestSha256: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO user_lifecycle_receipts (
         id, user_id, replacement_user_id, operation, actor_key, actor_label,
         source, idempotency_key, request_sha256, response_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.receipt.id,
      input.userId,
      input.replacementUserId,
      input.operation,
      input.context.actorKey,
      input.context.actor,
      input.context.source,
      input.idempotencyKey,
      input.requestSha256,
      JSON.stringify(input.receipt),
      input.receipt.createdAt
    );
}

export function listUserIdentityEvidence(): UserIdentityEvidence[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         links.user_id,
         links.agent_id,
         identities.provider,
         sessions.id AS session_id,
         sessions.actor_label,
         sessions.status,
         sessions.last_seen_at,
         sessions.last_heartbeat_at,
         sessions.stale_after_seconds,
         sessions.ended_at
       FROM agent_identity_users links
       JOIN agent_identities identities ON identities.id = links.agent_id
       LEFT JOIN agent_runtime_sessions sessions ON sessions.agent_id = links.agent_id
       ORDER BY links.user_id, links.agent_id, sessions.last_seen_at DESC`
    )
    .all() as Array<{
    user_id: string;
    agent_id: string;
    provider: string | null;
    session_id: string | null;
    actor_label: string | null;
    status: string | null;
    last_seen_at: string | null;
    last_heartbeat_at: string | null;
    stale_after_seconds: number | null;
    ended_at: string | null;
  }>;
  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    const current = byUser.get(row.user_id) ?? [];
    current.push(row);
    byUser.set(row.user_id, current);
  }
  const now = Date.now();
  return allUsers().map((user) => {
    const evidenceRows = byUser.get(user.id) ?? [];
    const sessionRows = evidenceRows.filter((row) => row.session_id !== null);
    const activeSessions = sessionRows.filter((row) => {
      if (
        row.ended_at ||
        !["connected", "reconnecting"].includes(row.status ?? "")
      ) {
        return false;
      }
      const heartbeat = Date.parse(row.last_heartbeat_at ?? "");
      return (
        Number.isFinite(heartbeat) &&
        now - heartbeat <= Math.max(1, row.stale_after_seconds ?? 120) * 1_000
      );
    });
    const linkedAgentIds = Array.from(
      new Set(evidenceRows.map((row) => row.agent_id))
    );
    const providers = Array.from(
      new Set(
        evidenceRows
          .map((row) => row.provider)
          .filter((value): value is string => Boolean(value))
      )
    );
    const actorLabels = Array.from(
      new Set(
        sessionRows
          .map((row) => row.actor_label)
          .filter((value): value is string => Boolean(value))
      )
    );
    const lastSeenAt =
      sessionRows
        .map((row) => row.last_seen_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    return userIdentityEvidenceSchema.parse({
      userId: user.id,
      lifecycleStatus: user.lifecycleStatus,
      identityKind:
        user.id === "user_operator"
          ? "human_operator"
          : user.kind === "human"
            ? "human"
            : linkedAgentIds.length > 0
              ? "linked_bot"
              : "unlinked_bot",
      trustState:
        user.lifecycleStatus === "inactive"
          ? "inactive"
          : user.id === "user_operator"
            ? "operator"
            : activeSessions.length > 0
              ? "verified_runtime"
              : "configured",
      linkedAgentIds,
      providers,
      actorLabels,
      sessionCount: new Set(sessionRows.map((row) => row.session_id)).size,
      connectedSessionCount: new Set(
        activeSessions.map((row) => row.session_id)
      ).size,
      lastSeenAt
    });
  });
}

function groupedCounts(
  table: "entity_owners" | "entity_assignments",
  userId: string
) {
  return getDatabase()
    .prepare(
      `SELECT entity_type, COUNT(*) AS count
       FROM ${table}
       WHERE user_id = ?
       GROUP BY entity_type
       ORDER BY count DESC, entity_type ASC`
    )
    .all(userId) as Array<{ entity_type: string; count: number }>;
}

function activeRuntimeSessionCount(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(DISTINCT sessions.id) AS count
       FROM agent_identity_users links
       JOIN agent_runtime_sessions sessions ON sessions.agent_id = links.agent_id
       WHERE links.user_id = ?
         AND links.role = 'primary'
         AND sessions.ended_at IS NULL
         AND sessions.status IN ('connected', 'reconnecting')
         AND julianday(sessions.last_heartbeat_at, '+' || sessions.stale_after_seconds || ' seconds') >= julianday('now')`
    )
    .get(userId) as { count: number };
  return row.count;
}

function activeAgentTokenCount(userId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(DISTINCT tokens.id) AS count
       FROM agent_identity_users links
       JOIN agent_tokens tokens ON tokens.agent_id = links.agent_id
       WHERE links.user_id = ?
         AND links.role = 'primary'
         AND tokens.revoked_at IS NULL`
    )
    .get(userId) as { count: number };
  return row.count;
}

export function previewUserDeactivation(
  userId: string,
  replacementUserId: string
): UserDeactivationPreview {
  const user = getUserById(userId);
  const replacementUser = getUserById(replacementUserId);
  if (!user || !replacementUser) {
    throw new HttpError(
      404,
      "user_lifecycle_user_not_found",
      "The source or replacement user was not found."
    );
  }
  const ownership = groupedCounts("entity_owners", userId).map((row) => ({
    entityType: row.entity_type,
    count: row.count
  }));
  const assignments = groupedCounts("entity_assignments", userId).map(
    (row) => ({
      entityType: row.entity_type,
      count: row.count
    })
  );
  const ownershipDefaultDependents = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM user_ownership_defaults
         WHERE owner_user_id = ? AND subject_user_id != ?`
      )
      .get(userId, userId) as { count: number }
  ).count;
  const activeRuntimeSessions = activeRuntimeSessionCount(userId);
  const activeAgentTokens = activeAgentTokenCount(userId);
  const blockers: string[] = [];
  if (user.id === "user_operator") {
    blockers.push("The primary operator identity cannot be deactivated.");
  }
  if (user.lifecycleStatus !== "active") {
    blockers.push("This user is already inactive.");
  }
  if (user.id === replacementUser.id) {
    blockers.push("Choose a different active replacement user.");
  }
  if (replacementUser.lifecycleStatus !== "active") {
    blockers.push("The replacement user must be active.");
  }
  if (
    user.kind === "human" &&
    listUsers({ kind: "human", lifecycleStatus: "active" }).length <= 1
  ) {
    blockers.push("Forge must retain at least one active human user.");
  }
  return userDeactivationPreviewSchema.parse({
    user,
    replacementUser,
    ownership,
    assignments,
    ownershipDefaultDependents,
    activeRuntimeSessions,
    activeAgentTokens,
    totalOwnedEntities: ownership.reduce((sum, item) => sum + item.count, 0),
    totalAssignments: assignments.reduce((sum, item) => sum + item.count, 0),
    requiresSessionDisconnect: activeRuntimeSessions > 0,
    canDeactivate: blockers.length === 0,
    blockers
  });
}

export function deactivateUser(
  userId: string,
  input: DeactivateUserInput,
  context: LifecycleContext
): UserLifecycleReceipt {
  const requestSha256 = sha256({ operation: "deactivate", userId, ...input });
  return runInTransaction(() => {
    const replay = readReceipt(
      context.actorKey,
      input.idempotencyKey,
      requestSha256
    );
    if (replay) return replay;
    const preview = previewUserDeactivation(userId, input.replacementUserId);
    if (preview.blockers.length > 0) {
      throw new HttpError(
        409,
        "user_deactivation_blocked",
        preview.blockers[0]!,
        {
          blockers: preview.blockers
        }
      );
    }
    if (preview.activeRuntimeSessions > 0 && !input.disconnectActiveSessions) {
      throw new HttpError(
        409,
        "user_deactivation_sessions_active",
        "Disconnect this user's active runtime sessions before deactivation, or explicitly include them in this transfer.",
        { activeRuntimeSessions: preview.activeRuntimeSessions }
      );
    }

    const database = getDatabase();
    const now = new Date().toISOString();
    const ownershipTransferred = Number(
      database
        .prepare(
          `UPDATE entity_owners SET user_id = ?, updated_at = ? WHERE user_id = ?`
        )
        .run(input.replacementUserId, now, userId).changes
    );
    database
      .prepare(
        `INSERT OR IGNORE INTO entity_assignments (
           entity_type, entity_id, user_id, role, created_at, updated_at
         )
         SELECT entity_type, entity_id, ?, role, created_at, ?
         FROM entity_assignments
         WHERE user_id = ?`
      )
      .run(input.replacementUserId, now, userId);
    const assignmentsTransferred = Number(
      database
        .prepare(`DELETE FROM entity_assignments WHERE user_id = ?`)
        .run(userId).changes
    );
    database
      .prepare(
        `UPDATE user_ownership_defaults
         SET owner_user_id = ?, updated_by_actor = ?, updated_at = ?
         WHERE owner_user_id = ?`
      )
      .run(input.replacementUserId, context.actor, now, userId);
    setUserOwnershipDefault(
      userId,
      input.replacementUserId,
      context.actor,
      new Date(now)
    );

    let sessionsDisconnected = 0;
    if (input.disconnectActiveSessions) {
      sessionsDisconnected = Number(
        database
          .prepare(
            `UPDATE agent_runtime_sessions
             SET status = 'disconnected', ended_at = ?, last_error = ?, updated_at = ?
             WHERE agent_id IN (
               SELECT agent_id FROM agent_identity_users
               WHERE user_id = ? AND role = 'primary'
             )
               AND ended_at IS NULL
               AND status IN ('connected', 'reconnecting')`
          )
          .run(
            now,
            "The linked Forge user was deactivated by an operator.",
            now,
            userId
          ).changes
      );
    }
    const tokensRevoked = Number(
      database
        .prepare(
          `UPDATE agent_tokens
           SET revoked_at = ?, updated_at = ?
           WHERE agent_id IN (
             SELECT agent_id FROM agent_identity_users
             WHERE user_id = ? AND role = 'primary'
           )
             AND revoked_at IS NULL`
        )
        .run(now, now, userId).changes
    );
    database
      .prepare(
        `UPDATE users
         SET lifecycle_status = 'inactive', deactivated_at = ?, lifecycle_reason = ?,
             lifecycle_actor = ?, lifecycle_source = ?, updated_at = ?
         WHERE id = ? AND lifecycle_status = 'active'`
      )
      .run(now, input.reason, context.actor, context.source, now, userId);

    const receipt = userLifecycleReceiptSchema.parse({
      id: `ulr_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      operation: "deactivate",
      userId,
      replacementUserId: input.replacementUserId,
      actor: context.actor,
      source: context.source,
      reason: input.reason,
      ownershipTransferred,
      assignmentsTransferred,
      sessionsDisconnected,
      tokensRevoked,
      lifecycleStatus: "inactive",
      defaultOwnerUserId: input.replacementUserId,
      createdAt: now,
      replayed: false
    });
    recordActivityEvent({
      entityType: "system",
      entityId: userId,
      eventType: "user_deactivated",
      title: `User deactivated: ${preview.user.displayName}`,
      description: input.reason,
      actor: context.actor,
      source: context.source,
      metadata: {
        replacementUserId: input.replacementUserId,
        ownershipTransferred,
        assignmentsTransferred,
        sessionsDisconnected,
        tokensRevoked,
        receiptId: receipt.id
      }
    });
    storeReceipt({
      receipt,
      operation: "deactivate",
      userId,
      replacementUserId: input.replacementUserId,
      context,
      idempotencyKey: input.idempotencyKey,
      requestSha256
    });
    return receipt;
  });
}

export function reactivateUser(
  userId: string,
  input: ReactivateUserInput,
  context: LifecycleContext
): UserLifecycleReceipt {
  const requestSha256 = sha256({ operation: "reactivate", userId, ...input });
  return runInTransaction(() => {
    const replay = readReceipt(
      context.actorKey,
      input.idempotencyKey,
      requestSha256
    );
    if (replay) return replay;
    const user = getUserById(userId);
    if (!user) {
      throw new HttpError(404, "user_not_found", "User not found.");
    }
    if (user.lifecycleStatus !== "inactive") {
      throw new HttpError(
        409,
        "user_already_active",
        "This user is already active."
      );
    }
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `UPDATE users
         SET lifecycle_status = 'active', deactivated_at = NULL, lifecycle_reason = ?,
             lifecycle_actor = ?, lifecycle_source = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.reason, context.actor, context.source, now, userId);
    const defaultOwnerUserId =
      listUserOwnershipDefaults().find(
        (entry) => entry.subjectUserId === userId
      )?.ownerUserId ?? userId;
    const receipt = userLifecycleReceiptSchema.parse({
      id: `ulr_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      operation: "reactivate",
      userId,
      replacementUserId: null,
      actor: context.actor,
      source: context.source,
      reason: input.reason,
      ownershipTransferred: 0,
      assignmentsTransferred: 0,
      sessionsDisconnected: 0,
      tokensRevoked: 0,
      lifecycleStatus: "active",
      defaultOwnerUserId,
      createdAt: now,
      replayed: false
    });
    recordActivityEvent({
      entityType: "system",
      entityId: userId,
      eventType: "user_reactivated",
      title: `User reactivated: ${user.displayName}`,
      description: input.reason,
      actor: context.actor,
      source: context.source,
      metadata: { receiptId: receipt.id, defaultOwnerUserId }
    });
    storeReceipt({
      receipt,
      operation: "reactivate",
      userId,
      replacementUserId: null,
      context,
      idempotencyKey: input.idempotencyKey,
      requestSha256
    });
    return receipt;
  });
}

export function updateUserOwnershipDefault(
  userId: string,
  input: SetUserOwnershipDefaultInput,
  context: LifecycleContext
): UserLifecycleReceipt {
  const requestSha256 = sha256({
    operation: "ownership_default",
    userId,
    ...input
  });
  return runInTransaction(() => {
    const replay = readReceipt(
      context.actorKey,
      input.idempotencyKey,
      requestSha256
    );
    if (replay) return replay;
    const user = getUserById(userId);
    if (!user) {
      throw new HttpError(404, "user_not_found", "User not found.");
    }
    const ownershipDefault = setUserOwnershipDefault(
      userId,
      input.ownerUserId,
      context.actor
    );
    const now = ownershipDefault.updatedAt;
    const receipt = userLifecycleReceiptSchema.parse({
      id: `ulr_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      operation: "ownership_default",
      userId,
      replacementUserId: input.ownerUserId,
      actor: context.actor,
      source: context.source,
      reason: "Ownership default updated.",
      ownershipTransferred: 0,
      assignmentsTransferred: 0,
      sessionsDisconnected: 0,
      tokensRevoked: 0,
      lifecycleStatus: user.lifecycleStatus,
      defaultOwnerUserId: input.ownerUserId,
      createdAt: now,
      replayed: false
    });
    recordActivityEvent({
      entityType: "system",
      entityId: userId,
      eventType: "user_ownership_default_updated",
      title: `Ownership default updated: ${user.displayName}`,
      actor: context.actor,
      source: context.source,
      metadata: { ownerUserId: input.ownerUserId, receiptId: receipt.id }
    });
    storeReceipt({
      receipt,
      operation: "ownership_default",
      userId,
      replacementUserId: input.ownerUserId,
      context,
      idempotencyKey: input.idempotencyKey,
      requestSha256
    });
    return receipt;
  });
}
