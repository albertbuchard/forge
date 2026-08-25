import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { buildRootScopeClause } from "./access.js";
import {
  fingerprint,
  getAuthorizedRoot,
  getOperationReceipt,
  newWorkId,
  nowIso,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";

export function recordSearchRun(input: {
  access: WorkAccess;
  campaignId: string;
  criteriaVersionId: string;
  data: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  idempotencyKey: string;
}) {
  getAuthorizedRoot("opportunity_campaign", input.campaignId, input.access);
  const criteria = getDatabase()
    .prepare(
      `SELECT 1 AS present FROM campaign_criteria_versions
       WHERE id = ? AND campaign_id = ? LIMIT 1`
    )
    .get(input.criteriaVersionId, input.campaignId);
  if (!criteria) {
    throw new HttpError(
      409,
      "work_search_run_criteria_mismatch",
      "The Search Run criteria version does not belong to this Opportunity Campaign."
    );
  }
  for (const item of input.items) {
    if (item.opportunityId !== null && item.opportunityId !== undefined) {
      if (
        typeof item.opportunityId !== "string" ||
        !item.opportunityId.trim()
      ) {
        throw new HttpError(
          400,
          "work_search_run_opportunity_invalid",
          "Every Search Run opportunity reference must be a non-empty identifier."
        );
      }
      getAuthorizedRoot("job_opportunity", item.opportunityId, input.access);
    }
  }
  const requestFingerprint = fingerprint(input);
  const replay = getOperationReceipt({
    ownerUserId: input.access.mutationOwnerUserId,
    operationKind: "job_search_run",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint
  });
  if (replay)
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  return runInTransaction(() => {
    const id = newWorkId("jsrun");
    const now = nowIso();
    const data = input.data;
    const status = String(data.status ?? "completed");
    const endedAt = Object.hasOwn(data, "endedAt")
      ? data.endedAt
      : status === "running"
        ? null
        : now;
    const row: Record<string, unknown> = {
      id,
      owner_user_id: input.access.mutationOwnerUserId,
      campaign_id: input.campaignId,
      criteria_version_id: input.criteriaVersionId,
      agent_json: JSON.stringify(data.agent ?? input.access.actor),
      started_at: data.startedAt ?? now,
      ended_at: endedAt,
      status,
      sources_json: JSON.stringify(data.sources ?? []),
      queries_json: JSON.stringify(data.queries ?? []),
      counts_json: JSON.stringify(data.counts ?? {}),
      failures_json: JSON.stringify(data.failures ?? []),
      cost_json: JSON.stringify(data.cost ?? {}),
      evidence_json: JSON.stringify(data.evidence ?? []),
      idempotency_key: input.idempotencyKey,
      request_fingerprint: requestFingerprint,
      created_at: now,
      updated_at: now,
      import_receipt_id: null
    };
    const columns = Object.keys(row);
    getDatabase()
      .prepare(
        `INSERT INTO job_search_runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column] as never));
    const itemInsert = getDatabase().prepare(
      "INSERT INTO job_search_run_items (id, run_id, opportunity_id, result_kind, evidence_json, created_at, import_receipt_id) VALUES (?, ?, ?, ?, ?, ?, NULL)"
    );
    const itemIds: string[] = [];
    for (const item of input.items) {
      const itemId = newWorkId("jsri");
      itemIds.push(itemId);
      itemInsert.run(
        itemId,
        id,
        typeof item.opportunityId === "string" ? item.opportunityId : null,
        String(item.resultKind),
        JSON.stringify(item.evidence ?? {}),
        now
      );
    }
    const response = {
      run: rowToWorkRecord(
        getDatabase()
          .prepare("SELECT * FROM job_search_runs WHERE id = ?")
          .get(id) as SqlRow,
        input.access
      ),
      items: itemIds.map((itemId) =>
        rowToWorkRecord(
          getDatabase()
            .prepare("SELECT * FROM job_search_run_items WHERE id = ?")
            .get(itemId) as SqlRow,
          input.access
        )
      )
    };
    storeOperationReceipt({
      ownerUserId: input.access.mutationOwnerUserId,
      operationKind: "job_search_run",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response,
      createdRecords: [
        { table: "job_search_runs", id },
        ...itemIds.map((itemId) => ({
          table: "job_search_run_items",
          id: itemId
        }))
      ]
    });
    return { replayed: false, ...response };
  });
}

export function listSearchRuns(input: {
  access: WorkAccess;
  campaignId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  if (input.campaignId) {
    getAuthorizedRoot("opportunity_campaign", input.campaignId, input.access);
  }
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);
  const scope = buildRootScopeClause(
    input.access,
    "run.owner_user_id",
    "campaign.scope_project_ids_json",
    "campaign.scope_tag_ids_json"
  );
  const clauses = [scope.sql];
  const values: Array<string | number> = [...scope.values];
  if (input.campaignId) {
    clauses.push("run.campaign_id = ?");
    values.push(input.campaignId);
  }
  if (input.status) {
    clauses.push("run.status = ?");
    values.push(input.status);
  }
  const where = clauses.join(" AND ");
  const total = Number(
    (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM job_search_runs run
           JOIN opportunity_campaigns campaign ON campaign.id = run.campaign_id
           WHERE ${where} AND campaign.deleted_at IS NULL`
        )
        .get(...values) as { count: number }
    ).count
  );
  const rows = getDatabase()
    .prepare(
      `SELECT run.*
       FROM job_search_runs run
       JOIN opportunity_campaigns campaign ON campaign.id = run.campaign_id
       WHERE ${where} AND campaign.deleted_at IS NULL
       ORDER BY run.started_at DESC, run.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as SqlRow[];
  return {
    items: rows.map((row) => rowToWorkRecord(row, input.access)),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total
  };
}

export function getSearchRunDetail(input: {
  access: WorkAccess;
  id: string;
  limit?: number;
  offset?: number;
}) {
  const row = getDatabase()
    .prepare("SELECT * FROM job_search_runs WHERE id = ? LIMIT 1")
    .get(input.id) as SqlRow | undefined;
  if (!row) {
    throw new HttpError(
      404,
      "work_search_run_not_found",
      "The requested Search Run was not found."
    );
  }
  getAuthorizedRoot(
    "opportunity_campaign",
    String(row.campaign_id),
    input.access
  );
  if (!input.access.ownerUserIds.includes(String(row.owner_user_id))) {
    throw new HttpError(
      404,
      "work_search_run_not_found",
      "The requested Search Run was not found."
    );
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const totalItemCount = Number(
    (
      getDatabase()
        .prepare(
          "SELECT COUNT(*) AS count FROM job_search_run_items WHERE run_id = ?"
        )
        .get(input.id) as { count: number }
    ).count
  );
  const rawItems = getDatabase()
    .prepare(
      `SELECT * FROM job_search_run_items
       WHERE run_id = ?
       ORDER BY created_at, id
       LIMIT ? OFFSET ?`
    )
    .all(input.id, limit, offset) as SqlRow[];
  let restrictedItemCount = 0;
  const items = rawItems.flatMap((item) => {
    const opportunityId = item.opportunity_id;
    if (typeof opportunityId === "string" && opportunityId) {
      try {
        getAuthorizedRoot("job_opportunity", opportunityId, input.access);
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          restrictedItemCount += 1;
          return [];
        }
        throw error;
      }
    }
    return [rowToWorkRecord(item, input.access)];
  });
  return {
    run: rowToWorkRecord(row, input.access),
    items,
    restrictedItemCount,
    page: {
      limit,
      offset,
      returned: items.length,
      total: totalItemCount,
      hasMore: offset + rawItems.length < totalItemCount,
      nextOffset:
        offset + rawItems.length < totalItemCount
          ? offset + rawItems.length
          : null
    }
  };
}
