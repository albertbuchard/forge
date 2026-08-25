import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import {
  fingerprint,
  nowIso,
  rowToWorkRecord,
  type SqlRow
} from "./repository-helpers.js";

type RollbackClass =
  | "reference_only"
  | "soft_delete_root"
  | "physical_delete_receipt_row"
  | "immutable_receipt";

type InventoryRecord = {
  table: string;
  id: string;
  classification: RollbackClass;
  fingerprint: string;
  identity?: Record<string, unknown>;
};

function rowFingerprint(table: string, id: string) {
  const primaryKey = table === "work_settings" ? "owner_user_id" : "id";
  const row = getDatabase()
    .prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`)
    .get(id) as SqlRow | undefined;
  return row ? fingerprint(rowToWorkRecord(row)) : null;
}

function currentLink(record: InventoryRecord) {
  const identity = record.identity ?? {};
  return getDatabase()
    .prepare(
      `SELECT source_entity_type, source_entity_id, target_entity_type,
              target_entity_id, anchor_key, relationship, created_by_actor, created_at
       FROM entity_links
       WHERE source_entity_type = ? AND source_entity_id = ?
         AND target_entity_type = ? AND target_entity_id = ?
         AND anchor_key = ? AND relationship = ?`
    )
    .get(
      String(identity.sourceEntityType ?? ""),
      String(identity.sourceEntityId ?? ""),
      String(identity.targetEntityType ?? ""),
      String(identity.targetEntityId ?? ""),
      String(identity.anchorKey ?? ""),
      String(identity.relationship ?? "")
    ) as SqlRow | undefined;
}

function currentInventoryFingerprint(record: InventoryRecord) {
  if (record.table === "entity_links") {
    const row = currentLink(record);
    return row ? fingerprint(rowToWorkRecord(row)) : null;
  }
  if (record.table === "entity_owners") return record.fingerprint;
  return rowFingerprint(record.table, record.id);
}

function tablePrimaryKey(table: string) {
  const columns = getDatabase()
    .prepare(`SELECT name, pk FROM pragma_table_info(?) ORDER BY pk`)
    .all(table) as Array<{ name: string; pk: number }>;
  return columns.filter((column) => column.pk > 0).map((column) => column.name);
}

function dependencyConflicts(records: InventoryRecord[]) {
  const conflicts: Array<Record<string, unknown>> = [];
  const chunks = <T>(values: T[], size = 400) =>
    Array.from({ length: Math.ceil(values.length / size) }, (_unused, index) =>
      values.slice(index * size, (index + 1) * size)
    );
  const createdKeys = new Set(
    records.map((record) => `${record.table}:${record.id}`)
  );
  const createdLinks = new Set(
    records
      .filter((record) => record.table === "entity_links")
      .map((record) => record.id)
  );
  const tables = (
    getDatabase()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const rootEntityType: Record<string, string> = {
    work_organizations: "work_organization",
    work_engagements: "work_engagement",
    opportunity_campaigns: "opportunity_campaign",
    job_opportunities: "job_opportunity",
    candidate_positioning_profiles: "candidate_positioning_profile",
    job_applications: "job_application"
  };
  const softRoots = records.filter(
    (record) => record.classification === "soft_delete_root"
  );
  const rootTableByType = new Map(
    Object.entries(rootEntityType).map(([table, entityType]) => [
      entityType,
      table
    ])
  );
  const rootIdsByType = new Map<string, string[]>();
  for (const record of softRoots) {
    const entityType = rootEntityType[record.table];
    if (!entityType) continue;
    const ids = rootIdsByType.get(entityType) ?? [];
    ids.push(record.id);
    rootIdsByType.set(entityType, ids);
  }
  const reportedLinks = new Set<string>();
  for (const [entityType, ids] of rootIdsByType) {
    for (const batch of chunks(ids)) {
      const placeholders = batch.map(() => "?").join(", ");
      const links = getDatabase()
        .prepare(
          `SELECT source_entity_type, source_entity_id, target_entity_type,
                  target_entity_id, anchor_key, relationship, created_by_actor, created_at
           FROM entity_links
           WHERE (source_entity_type = ? AND source_entity_id IN (${placeholders}))
              OR (target_entity_type = ? AND target_entity_id IN (${placeholders}))`
        )
        .all(entityType, ...batch, entityType, ...batch) as SqlRow[];
      for (const link of links) {
        const mapped = rowToWorkRecord(link);
        const identityHash = fingerprint({
          sourceEntityType: mapped.sourceEntityType,
          sourceEntityId: mapped.sourceEntityId,
          targetEntityType: mapped.targetEntityType,
          targetEntityId: mapped.targetEntityId,
          anchorKey: mapped.anchorKey,
          relationship: mapped.relationship
        });
        if (createdLinks.has(identityHash) || reportedLinks.has(identityHash)) {
          continue;
        }
        reportedLinks.add(identityHash);
        conflicts.push({
          kind: "later_entity_link",
          table: rootTableByType.get(entityType),
          entityType,
          link: mapped
        });
      }
    }
  }
  for (const [entityType, ids] of rootIdsByType) {
    for (const batch of chunks(ids, 500)) {
      const placeholders = batch.map(() => "?").join(", ");
      const activities = getDatabase()
        .prepare(
          `SELECT id, entity_id FROM activity_events
           WHERE entity_type = ? AND entity_id IN (${placeholders})`
        )
        .all(entityType, ...batch) as Array<{
        id: string;
        entity_id: string;
      }>;
      for (const activity of activities) {
        if (!createdKeys.has(`activity_events:${activity.id}`)) {
          conflicts.push({
            kind: "later_activity",
            table: rootTableByType.get(entityType),
            id: activity.entity_id,
            activityId: activity.id
          });
        }
      }
    }
  }

  const rollbackTargetIdsByTable = new Map<string, string[]>();
  for (const record of records) {
    if (
      record.classification !== "soft_delete_root" &&
      record.classification !== "physical_delete_receipt_row"
    ) {
      continue;
    }
    const ids = rollbackTargetIdsByTable.get(record.table) ?? [];
    ids.push(record.id);
    rollbackTargetIdsByTable.set(record.table, ids);
  }
  const reportedDependencies = new Set<string>();
  for (const childTable of tables) {
    const primaryKeys = tablePrimaryKey(childTable);
    if (primaryKeys.length !== 1) continue;
    const foreignKeys = getDatabase()
      .prepare(`SELECT * FROM pragma_foreign_key_list(?)`)
      .all(childTable) as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    for (const foreignKey of foreignKeys) {
      if (foreignKey.to !== "id") continue;
      const parentIds = rollbackTargetIdsByTable.get(foreignKey.table);
      if (!parentIds?.length) continue;
      for (const batch of chunks(parentIds, 500)) {
        const placeholders = batch.map(() => "?").join(", ");
        const childRows = getDatabase()
          .prepare(
            `SELECT ${primaryKeys[0]} AS id, ${foreignKey.from} AS parent_id
             FROM ${childTable}
             WHERE ${foreignKey.from} IN (${placeholders})`
          )
          .all(...batch) as Array<{ id: string; parent_id: string }>;
        for (const child of childRows) {
          const childKey = `${childTable}:${String(child.id)}`;
          if (createdKeys.has(childKey)) continue;
          const dependencyKey = `${foreignKey.table}:${String(child.parent_id)}:${childKey}:${foreignKey.from}`;
          if (reportedDependencies.has(dependencyKey)) continue;
          reportedDependencies.add(dependencyKey);
          conflicts.push({
            kind: "later_foreign_key_dependency",
            parentTable: foreignKey.table,
            parentId: child.parent_id,
            childTable,
            childId: child.id,
            foreignKey: foreignKey.from
          });
        }
      }
    }
  }
  return conflicts;
}

function loadImportReceipt(access: WorkAccess, receiptId: string) {
  if (!access.operator) {
    throw new HttpError(
      403,
      "work_import_operator_required",
      "Work import rollback requires an authenticated local operator session."
    );
  }
  const row = getDatabase()
    .prepare(
      `SELECT * FROM work_operation_receipts
       WHERE id = ? AND owner_user_id = ? AND operation_kind = 'work_import_apply'`
    )
    .get(receiptId, access.mutationOwnerUserId) as SqlRow | undefined;
  if (!row) {
    throw new HttpError(
      404,
      "work_import_receipt_not_found",
      "The Work import receipt was not found."
    );
  }
  return rowToWorkRecord(row) as Record<string, unknown>;
}

export function previewWorkImportRollback(
  access: WorkAccess,
  receiptId: string
) {
  const receipt = loadImportReceipt(access, receiptId);
  if (receipt.status === "rolled_back") {
    const previewCore = {
      receiptId,
      status: "rolled_back",
      recordCount: 0,
      classifications: {},
      conflicts: []
    };
    return {
      ...previewCore,
      rollbackPreviewDigest: fingerprint(previewCore),
      canRollback: true,
      replayed: true,
      tombstone: receipt.rollbackTombstone
    };
  }
  const records = (
    Array.isArray(receipt.createdRecords) ? receipt.createdRecords : []
  ) as InventoryRecord[];
  const changed = records.flatMap((record) => {
    if (record.classification === "reference_only") return [];
    const current = currentInventoryFingerprint(record);
    return current === record.fingerprint
      ? []
      : [
          {
            table: record.table,
            id: record.id,
            expectedFingerprint: record.fingerprint,
            currentFingerprint: current
          }
        ];
  });
  const dependencies = dependencyConflicts(records);
  const conflicts = [...changed, ...dependencies];
  const previewCore = {
    receiptId,
    status: receipt.status,
    recordCount: records.length,
    classifications: Object.fromEntries(
      [...new Set(records.map((record) => record.classification))].map(
        (classification) => [
          classification,
          records.filter((record) => record.classification === classification)
            .length
        ]
      )
    ),
    conflicts
  };
  return {
    ...previewCore,
    rollbackPreviewDigest: fingerprint(previewCore),
    canRollback: conflicts.length === 0,
    replayed: false
  };
}

function deleteInventoryRecord(record: InventoryRecord) {
  if (record.table === "entity_links") {
    const identity = record.identity ?? {};
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE source_entity_type = ? AND source_entity_id = ?
           AND target_entity_type = ? AND target_entity_id = ?
           AND anchor_key = ? AND relationship = ?`
      )
      .run(
        String(identity.sourceEntityType ?? ""),
        String(identity.sourceEntityId ?? ""),
        String(identity.targetEntityType ?? ""),
        String(identity.targetEntityId ?? ""),
        String(identity.anchorKey ?? ""),
        String(identity.relationship ?? "")
      );
    return;
  }
  const primaryKey = record.table === "work_settings" ? "owner_user_id" : "id";
  getDatabase()
    .prepare(`DELETE FROM ${record.table} WHERE ${primaryKey} = ?`)
    .run(record.id);
}

export function rollbackWorkImport(input: {
  access: WorkAccess;
  receiptId: string;
  expectedRollbackPreviewDigest: string;
  idempotencyKey: string;
}) {
  if (!input.access.operator) {
    throw new HttpError(
      403,
      "work_import_operator_required",
      "Work import rollback requires an authenticated local operator session."
    );
  }
  const requestFingerprint = fingerprint({
    receiptId: input.receiptId,
    expectedRollbackPreviewDigest: input.expectedRollbackPreviewDigest
  });
  const prior = getDatabase()
    .prepare(
      `SELECT rollback_tombstone_json, status
       FROM work_operation_receipts
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(input.receiptId, input.access.mutationOwnerUserId) as
    | { rollback_tombstone_json: string; status: string }
    | undefined;
  if (prior?.status === "rolled_back") {
    const tombstone = JSON.parse(prior.rollback_tombstone_json) as Record<
      string,
      unknown
    >;
    if (tombstone.idempotencyKey !== input.idempotencyKey) {
      throw new HttpError(
        409,
        "work_import_rollback_replay_conflict",
        "This import was rolled back with another idempotency key."
      );
    }
    if (tombstone.requestFingerprint !== requestFingerprint) {
      throw new HttpError(
        409,
        "work_import_rollback_replay_conflict",
        "The rollback idempotency key was reused with different input."
      );
    }
    return { replayed: true, ...tombstone };
  }
  return runInTransaction(() => {
    const preview = previewWorkImportRollback(input.access, input.receiptId);
    if (preview.rollbackPreviewDigest !== input.expectedRollbackPreviewDigest) {
      throw new HttpError(
        409,
        "work_import_rollback_preview_changed",
        "The rollback preview changed before apply. Review the current dependency closure."
      );
    }
    if (!preview.canRollback) {
      getDatabase()
        .prepare(
          `UPDATE work_operation_receipts
           SET status = 'rollback_conflict', updated_at = ?
           WHERE id = ? AND status = 'applied'`
        )
        .run(nowIso(), input.receiptId);
      throw new HttpError(
        409,
        "work_import_rollback_conflict",
        "Rollback would alter changed or later-created data. Nothing was removed.",
        { conflicts: preview.conflicts }
      );
    }
    const receipt = loadImportReceipt(input.access, input.receiptId);
    const records = (receipt.createdRecords as InventoryRecord[]) ?? [];
    const removed: Array<Record<string, unknown>> = [];
    const softDeleted: Array<Record<string, unknown>> = [];
    const now = nowIso();
    const campaignRootIds = records
      .filter(
        (record) =>
          record.table === "opportunity_campaigns" &&
          record.classification === "soft_delete_root"
      )
      .map((record) => record.id);
    const applicationRootIds = records
      .filter(
        (record) =>
          record.table === "job_applications" &&
          record.classification === "soft_delete_root"
      )
      .map((record) => record.id);
    for (const campaignId of campaignRootIds) {
      getDatabase()
        .prepare(
          `UPDATE opportunity_campaigns
           SET current_criteria_version_id = NULL,
               revision = revision + 1,
               updated_at = ?
           WHERE id = ?`
        )
        .run(now, campaignId);
    }
    for (const applicationId of applicationRootIds) {
      const application = records.find(
        (record) =>
          record.table === "job_applications" && record.id === applicationId
      );
      const result = getDatabase()
        .prepare(
          `UPDATE job_applications
           SET criteria_version_id = NULL, deleted_at = ?,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(now, now, applicationId);
      if (Number(result.changes) !== 1) {
        throw new HttpError(
          409,
          "work_import_rollback_concurrent_change",
          "A receipt-created Application changed while rollback was running."
        );
      }
      softDeleted.push({
        table: "job_applications",
        id: applicationId,
        priorFingerprint: application?.fingerprint ?? null
      });
    }
    for (const record of [...records].reverse()) {
      if (record.classification === "physical_delete_receipt_row") {
        deleteInventoryRecord(record);
        removed.push({
          table: record.table,
          id: record.id,
          fingerprint: record.fingerprint
        });
      }
    }
    for (const record of [...records].reverse()) {
      if (record.classification !== "soft_delete_root") continue;
      if (record.table === "job_applications") continue;
      const lifecycle = (
        {
          work_organizations: { column: "status", value: "archived" },
          work_engagements: { column: "status", value: "archived" },
          opportunity_campaigns: { column: "status", value: "archived" },
          job_opportunities: { column: "disposition", value: "archived" }
        } as Record<string, { column: string; value: string }>
      )[record.table];
      const extra =
        record.table === "opportunity_campaigns"
          ? ", current_criteria_version_id = NULL"
          : "";
      const lifecycleUpdate = lifecycle
        ? `, ${lifecycle.column} = '${lifecycle.value}'`
        : "";
      const result = getDatabase()
        .prepare(
          `UPDATE ${record.table}
           SET deleted_at = ?, revision = revision + 1, updated_at = ?${extra}
               ${lifecycleUpdate}
           WHERE id = ? AND deleted_at IS NULL`
        )
        .run(now, now, record.id);
      if (Number(result.changes) !== 1) {
        throw new HttpError(
          409,
          "work_import_rollback_concurrent_change",
          "A receipt-created root changed while rollback was running."
        );
      }
      softDeleted.push({
        table: record.table,
        id: record.id,
        priorFingerprint: record.fingerprint
      });
    }
    const tombstone = {
      receiptId: input.receiptId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      rollbackPreviewDigest: input.expectedRollbackPreviewDigest,
      rolledBackAt: now,
      removed,
      softDeleted,
      retainedReferences: records
        .filter((record) => record.classification === "reference_only")
        .map((record) => ({ table: record.table, id: record.id }))
    };
    const updated = getDatabase()
      .prepare(
        `UPDATE work_operation_receipts
         SET status = 'rolled_back', rollback_tombstone_json = ?,
             rolled_back_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('applied','rollback_conflict')`
      )
      .run(JSON.stringify(tombstone), now, now, input.receiptId);
    if (Number(updated.changes) !== 1) {
      throw new HttpError(
        409,
        "work_import_rollback_concurrent_change",
        "The import receipt changed while rollback was running."
      );
    }
    return { replayed: false, ...tombstone };
  });
}
