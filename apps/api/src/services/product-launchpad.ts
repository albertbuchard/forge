import { createHash, randomUUID } from "node:crypto";

import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  productFeedbackEventSchema,
  productFeedbackSettingsSchema,
  productImportCommitSchema,
  productImportPreviewSchema,
  productImportRollbackSchema,
  productOnboardingUpdateSchema,
  productPackageInstallSchema,
  productPackagePreviewSchema,
  productPackageRemoveSchema,
  productPackageSchema,
  productReviewDecisionSchema,
  type ProductImportItem,
  type ProductPackage
} from "../product-launchpad-types.js";
import { getUserById } from "../repositories/users.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import {
  approveApprovalRequest,
  listApprovalRequests,
  rejectApprovalRequest
} from "../repositories/collaboration.js";
import type { CrudEntityType } from "../types.js";
import {
  createEntities,
  deleteEntity,
  type CrudContext
} from "./entity-crud.js";
import {
  decideRelationshipProposal,
  listOwnerRelationshipProposals
} from "./relationship-proposals.js";
import {
  applyArtifactEnrichmentProposal,
  listArtifacts,
  rejectArtifactEnrichmentProposal
} from "./artifacts.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function withManifestHash(
  value: Omit<ProductPackage, "manifestSha256">
): ProductPackage {
  return productPackageSchema.parse({
    ...value,
    manifestSha256: sha256(canonicalJson(value))
  });
}

const PRODUCT_PACKAGES: ProductPackage[] = [
  withManifestHash({
    id: "starter.plan-week",
    version: "1.0.0",
    kind: "starter_pack",
    title: "Plan a useful week",
    summary:
      "Create one weekly outcome and three immediately actionable tasks without filling Forge with sample noise.",
    outcomeKey: "plan_week",
    author: "Forge",
    reviewState: "forge_reviewed",
    compatibility: "Forge 0.3.55 or newer",
    permissions: ["Create one Goal", "Create three Tasks", "Link Tasks to the new Goal"],
    records: [
      {
        ref: "goal",
        entityType: "goal",
        title: "Make this week count",
        description: "A starter outcome you can rename after choosing the result that matters most.",
        dependsOn: [],
        data: { horizon: "quarter", targetPoints: 200 }
      },
      ...[
        ["choose", "Choose the week's most important result", "Write one observable result that would make the week worthwhile."],
        ["block", "Protect time for the important work", "Move the first work session into the calendar."],
        ["review", "Review the week and choose the next move", "Close the loop while the evidence is fresh."]
      ].map(([ref, title, description]) => ({
        ref,
        entityType: "task" as const,
        title,
        description,
        dependsOn: ["goal"],
        data: { goalIdRef: "goal", effort: "deep", points: 40 }
      }))
    ],
    setupHref: null
  }),
  withManifestHash({
    id: "starter.daily-reflection",
    version: "1.0.0",
    kind: "starter_pack",
    title: "Build a daily reflection loop",
    summary:
      "Create a lightweight reflection habit and a durable prompt Note without forcing a full journal system.",
    outcomeKey: "daily_reflection",
    author: "Forge",
    reviewState: "forge_reviewed",
    compatibility: "Forge 0.3.55 or newer",
    permissions: ["Create one Habit", "Create one Note"],
    records: [
      {
        ref: "habit",
        entityType: "habit",
        title: "Reflect on the day",
        description: "Record one thing learned and one useful next step.",
        dependsOn: [],
        data: { polarity: "positive", frequency: "daily", targetCount: 1 }
      },
      {
        ref: "prompt",
        entityType: "note",
        title: "Daily reflection prompt",
        description: "A short reusable reflection prompt.",
        dependsOn: [],
        data: {
          contentMarkdown: "# Daily reflection\n\n- What mattered today?\n- What did I learn?\n- What is the smallest useful next move?"
        }
      }
    ],
    setupHref: null
  }),
  withManifestHash({
    id: "starter.research-project",
    version: "1.0.0",
    kind: "starter_pack",
    title: "Start a research project",
    summary:
      "Create a research outcome, one project, and a compact evidence-to-synthesis workflow.",
    outcomeKey: "research_project",
    author: "Forge",
    reviewState: "forge_reviewed",
    compatibility: "Forge 0.3.55 or newer",
    permissions: ["Create one Goal", "Create one Project", "Create three linked Tasks"],
    records: [
      {
        ref: "goal",
        entityType: "goal",
        title: "Answer the research question",
        description: "Define the decision, explanation, or contribution the research must support.",
        dependsOn: [],
        data: { horizon: "year", targetPoints: 400 }
      },
      {
        ref: "project",
        entityType: "project",
        title: "Research project",
        description: "Collect evidence, evaluate it, and produce a defensible synthesis.",
        dependsOn: ["goal"],
        data: { goalIdRef: "goal", targetPoints: 240 }
      },
      ...[
        ["question", "Define the research question", "State the exact uncertainty and acceptance criterion."],
        ["evidence", "Collect and appraise the evidence", "Preserve sources and distinguish observations from interpretation."],
        ["synthesis", "Write the evidence-backed synthesis", "Answer the question and state limitations explicitly."]
      ].map(([ref, title, description]) => ({
        ref,
        entityType: "task" as const,
        title,
        description,
        dependsOn: ["goal", "project"],
        data: { goalIdRef: "goal", projectIdRef: "project", effort: "deep", points: 60 }
      }))
    ],
    setupHref: null
  }),
  ...[
    ["integration.markdown", "Markdown and Obsidian", "Import Markdown notes with source paths and conflict review."],
    ["integration.notion", "Notion", "Review exported pages and tasks before they become Forge records."],
    ["integration.todoist", "Todoist", "Map tasks and completion state through the import assistant."],
    ["integration.apple-reminders", "Apple Reminders", "Review reminder exports before task creation."],
    ["integration.calendars", "Calendars", "Use Forge's provider connections for calendar evidence."],
    ["integration.github", "GitHub Issues", "Import issue exports with their source URLs preserved."],
    ["integration.linear", "Linear", "Import issue exports with source identity and conflict review."]
  ].map(([id, title, summary]) =>
    withManifestHash({
      id,
      version: "1.0.0",
      kind: "integration",
      title,
      summary,
      outcomeKey: null,
      author: "Forge",
      reviewState: "forge_reviewed",
      compatibility: "Forge 0.3.55 or newer",
      permissions: ["Read only the export you choose", "Preview before any Forge write"],
      records: [],
      setupHref: "/launchpad?tab=imports"
    })
  )
];

function requireOwner(ownerUserId: string) {
  const owner = getUserById(ownerUserId);
  if (!owner) {
    throw new HttpError(
      404,
      "product_owner_unavailable",
      "The selected person is unavailable."
    );
  }
  return owner;
}

function packageById(packageId: string) {
  const productPackage = PRODUCT_PACKAGES.find((entry) => entry.id === packageId);
  if (!productPackage) {
    throw new HttpError(404, "product_package_unavailable", "That package is unavailable.");
  }
  return productPackage;
}

function titleExists(entityType: string, title: string, ownerUserId: string) {
  const tableByType: Record<string, string> = {
    goal: "goals",
    project: "projects",
    task: "tasks",
    habit: "habits",
    note: "notes",
    calendar_event: "calendar_events"
  };
  const table = tableByType[entityType];
  if (!table) return false;
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1
         FROM ${table}
         JOIN entity_owners owner
           ON owner.entity_type = ?
          AND owner.entity_id = ${table}.id
          AND owner.user_id = ?
         LEFT JOIN deleted_entities deleted
           ON deleted.entity_type = ?
          AND deleted.entity_id = ${table}.id
         WHERE forge_nfkc_lower(${table}.title) = forge_nfkc_lower(?)
           AND deleted.entity_id IS NULL
         LIMIT 1`
      )
      .get(entityType, ownerUserId, entityType, title)
  );
}

export function listProductPackages() {
  return PRODUCT_PACKAGES.map((entry) => ({ ...entry }));
}

export function listProductPackageInstalls(ownerUserId: string) {
  requireOwner(ownerUserId);
  return getDatabase()
    .prepare(
      `SELECT id, package_id, package_version, manifest_sha256, status,
              created_entity_refs_json, installed_at, removed_at, updated_at
       FROM product_package_installs
       WHERE owner_user_id = ?
       ORDER BY installed_at DESC, id DESC
       LIMIT 100`
    )
    .all(ownerUserId)
    .map((value) => {
      const row = value as Record<string, unknown>;
      return {
        id: row.id,
        packageId: row.package_id,
        packageVersion: row.package_version,
        manifestSha256: row.manifest_sha256,
        status: row.status,
        createdEntities: JSON.parse(String(row.created_entity_refs_json)),
        installedAt: row.installed_at,
        removedAt: row.removed_at,
        updatedAt: row.updated_at
      };
    });
}

export function getOnboardingState(ownerUserId: string) {
  requireOwner(ownerUserId);
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id, outcome_key, current_step, status,
              installed_package_id, last_result_href, created_at, updated_at
       FROM product_onboarding_state WHERE owner_user_id = ?`
    )
    .get(ownerUserId) as
    | {
        owner_user_id: string;
        outcome_key: string | null;
        current_step: string;
        status: string;
        installed_package_id: string | null;
        last_result_href: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  return row
    ? {
        ownerUserId: row.owner_user_id,
        outcomeKey: row.outcome_key,
        currentStep: row.current_step,
        status: row.status,
        installedPackageId: row.installed_package_id,
        lastResultHref: row.last_result_href,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : {
        ownerUserId,
        outcomeKey: null,
        currentStep: "choose_outcome",
        status: "not_started",
        installedPackageId: null,
        lastResultHref: null,
        createdAt: null,
        updatedAt: null
      };
}

export function updateOnboardingState(inputValue: unknown) {
  const input = productOnboardingUpdateSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO product_onboarding_state (
         owner_user_id, outcome_key, current_step, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         outcome_key = excluded.outcome_key,
         current_step = excluded.current_step,
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .run(
      input.ownerUserId,
      input.outcomeKey,
      input.currentStep,
      input.status,
      now,
      now
    );
  return getOnboardingState(input.ownerUserId);
}

export function previewProductPackage(inputValue: unknown) {
  const input = productPackagePreviewSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const productPackage = packageById(input.packageId);
  const collisions = productPackage.records
    .filter((record) => titleExists(record.entityType, record.title, input.ownerUserId))
    .map((record) => ({
      ref: record.ref,
      entityType: record.entityType,
      title: record.title,
      reason: "A visible record of this type already has the same normalized title."
    }));
  return {
    package: productPackage,
    ownerUserId: input.ownerUserId,
    changes: productPackage.records.map((record) => ({
      ref: record.ref,
      entityType: record.entityType,
      title: record.title,
      description: record.description,
      dependsOn: record.dependsOn
    })),
    permissions: productPackage.permissions,
    collisions,
    canInstall: productPackage.kind === "starter_pack" && collisions.length === 0
  };
}

function recordData(
  productPackage: ProductPackage,
  record: ProductPackage["records"][number],
  ownerUserId: string,
  refs: Map<string, string>
) {
  const data = { ...record.data } as Record<string, unknown>;
  const goalRef = typeof data.goalIdRef === "string" ? data.goalIdRef : null;
  const projectRef = typeof data.projectIdRef === "string" ? data.projectIdRef : null;
  delete data.goalIdRef;
  delete data.projectIdRef;
  if (goalRef) data.goalId = refs.get(goalRef) ?? null;
  if (projectRef) data.projectId = refs.get(projectRef) ?? null;
  const provenance = {
    packageId: productPackage.id,
    packageVersion: productPackage.version,
    manifestSha256: productPackage.manifestSha256,
    recordRef: record.ref
  };
  if (record.entityType === "note") {
    return {
      title: record.title,
      contentMarkdown: String(data.contentMarkdown ?? record.description),
      userId: ownerUserId,
      frontmatter: { starterPack: provenance }
    };
  }
  return {
    title: record.title,
    description: record.description,
    ...data,
    userId: ownerUserId,
    ...(record.entityType === "task"
      ? {
          notes: [
            {
              title: "Starter pack provenance",
              contentMarkdown: `Created by ${productPackage.title} ${productPackage.version}.`,
              frontmatter: { starterPack: provenance }
            }
          ]
        }
      : {})
  };
}

function entityHref(entityType: string, entityId: string) {
  const paths: Record<string, string> = {
    goal: `/goals/${encodeURIComponent(entityId)}`,
    project: `/projects/${encodeURIComponent(entityId)}`,
    task: `/tasks/${encodeURIComponent(entityId)}`,
    habit: "/habits",
    note: `/notes?focus=${encodeURIComponent(entityId)}`
  };
  return paths[entityType] ?? "/overview";
}

export function installProductPackage(inputValue: unknown, context: CrudContext) {
  const input = productPackageInstallSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const productPackage = packageById(input.packageId);
  if (productPackage.kind !== "starter_pack") {
    throw new HttpError(
      409,
      "product_package_external_setup",
      "This gallery entry uses its dedicated setup flow instead of installing records."
    );
  }
  if (input.manifestSha256 !== productPackage.manifestSha256) {
    throw new HttpError(
      409,
      "product_package_manifest_changed",
      "The package changed after review. Review the current manifest before installing."
    );
  }
  const keyHash = sha256(input.idempotencyKey);
  const existing = getDatabase()
    .prepare(
      `SELECT id, package_id, package_version, manifest_sha256, status,
              created_entity_refs_json, installed_at
       FROM product_package_installs
       WHERE owner_user_id = ? AND idempotency_key_hash = ?`
    )
    .get(input.ownerUserId, keyHash) as
    | {
        id: string;
        package_id: string;
        package_version: string;
        manifest_sha256: string;
        status: string;
        created_entity_refs_json: string;
        installed_at: string;
      }
    | undefined;
  if (existing) {
    if (
      existing.package_id !== productPackage.id ||
      existing.manifest_sha256 !== productPackage.manifestSha256
    ) {
      throw new HttpError(
        409,
        "product_package_idempotency_conflict",
        "That installation key was already used for another reviewed package."
      );
    }
    return {
      installId: existing.id,
      packageId: existing.package_id,
      packageVersion: existing.package_version,
      manifestSha256: existing.manifest_sha256,
      status: existing.status,
      createdEntities: JSON.parse(existing.created_entity_refs_json) as unknown[],
      installedAt: existing.installed_at,
      replayed: true
    };
  }
  const preview = previewProductPackage({
    ownerUserId: input.ownerUserId,
    packageId: input.packageId
  });
  if (!preview.canInstall) {
    throw new HttpError(
      409,
      "product_package_collision",
      "The package conflicts with existing records. Resolve those records before installing."
    );
  }

  const installId = `package_install_${randomUUID()}`;
  const installedAt = nowIso();
  const createdEntities = runInTransaction(() => {
    const refs = new Map<string, string>();
    const created: Array<{
      ref: string;
      entityType: CrudEntityType;
      entityId: string;
      title: string;
      href: string;
    }> = [];
    for (const record of productPackage.records) {
      for (const dependency of record.dependsOn) {
        if (!refs.has(dependency)) {
          throw new HttpError(
            409,
            "product_package_dependency_unavailable",
            "The reviewed package has an unresolved record dependency."
          );
        }
      }
      const result = createEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: record.entityType,
              data: recordData(productPackage, record, input.ownerUserId, refs),
              clientRef: record.ref,
              idempotencyKey: `package:${sha256(input.idempotencyKey).slice(0, 48)}:${record.ref}`
            }
          ]
        },
        { ...context, userIds: [input.ownerUserId] }
      ).results[0];
      if (!result?.ok || !result.id) {
        throw new HttpError(
          409,
          "product_package_record_failed",
          result?.error?.message ?? "Forge could not create a reviewed package record."
        );
      }
      refs.set(record.ref, result.id);
      created.push({
        ref: record.ref,
        entityType: record.entityType,
        entityId: result.id,
        title: record.title,
        href: entityHref(record.entityType, result.id)
      });
    }
    getDatabase()
      .prepare(
        `INSERT INTO product_package_installs (
           id, owner_user_id, package_id, package_version, manifest_sha256,
           idempotency_key_hash, status, created_entity_refs_json,
           installed_at, removed_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'installed', ?, ?, NULL, ?)`
      )
      .run(
        installId,
        input.ownerUserId,
        productPackage.id,
        productPackage.version,
        productPackage.manifestSha256,
        keyHash,
        JSON.stringify(created),
        installedAt,
        installedAt
      );
    const firstResultHref = created[0]?.href ?? "/overview";
    getDatabase()
      .prepare(
        `INSERT INTO product_onboarding_state (
           owner_user_id, outcome_key, current_step, status,
           installed_package_id, last_result_href, created_at, updated_at
         ) VALUES (?, ?, 'first_result', 'in_progress', ?, ?, ?, ?)
         ON CONFLICT(owner_user_id) DO UPDATE SET
           outcome_key = excluded.outcome_key,
           current_step = excluded.current_step,
           status = excluded.status,
           installed_package_id = excluded.installed_package_id,
           last_result_href = excluded.last_result_href,
           updated_at = excluded.updated_at`
      )
      .run(
        input.ownerUserId,
        productPackage.outcomeKey,
        productPackage.id,
        firstResultHref,
        installedAt,
        installedAt
      );
    return created;
  });
  return {
    installId,
    packageId: productPackage.id,
    packageVersion: productPackage.version,
    manifestSha256: productPackage.manifestSha256,
    status: "installed",
    createdEntities,
    installedAt,
    replayed: false
  };
}

export function removeProductPackage(
  installId: string,
  inputValue: unknown,
  context: CrudContext
) {
  const input = productPackageRemoveSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const row = getDatabase()
    .prepare(
      `SELECT status, created_entity_refs_json
       FROM product_package_installs WHERE id = ? AND owner_user_id = ?`
    )
    .get(installId, input.ownerUserId) as
    | { status: "installed" | "removed"; created_entity_refs_json: string }
    | undefined;
  if (!row) {
    throw new HttpError(404, "product_package_install_unavailable", "That installation is unavailable.");
  }
  if (row.status === "removed") {
    return { installId, status: "removed", replayed: true };
  }
  const refs = JSON.parse(row.created_entity_refs_json) as Array<{
    entityType: CrudEntityType;
    entityId: string;
  }>;
  const removedAt = nowIso();
  runInTransaction(() => {
    for (const ref of [...refs].reverse()) {
      deleteEntity(
        ref.entityType,
        ref.entityId,
        { mode: "soft", reason: `Removed starter pack installation ${installId}.` },
        { ...context, userIds: [input.ownerUserId] }
      );
    }
    getDatabase()
      .prepare(
        `UPDATE product_package_installs
         SET status = 'removed', removed_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'installed'`
      )
      .run(removedAt, removedAt, installId, input.ownerUserId);
  });
  return { installId, status: "removed", removedAt, replayed: false };
}

function importTargetTitle(item: ProductImportItem) {
  return item.title.replace(/\s+/gu, " ").trim();
}

function importItemData(
  item: ProductImportItem,
  ownerUserId: string,
  provenance: Record<string, unknown>
) {
  if (item.recordType === "note") {
    return {
      title: importTargetTitle(item),
      contentMarkdown: item.content || importTargetTitle(item),
      userId: ownerUserId,
      sourcePath: item.sourceUrl ?? "",
      frontmatter: { importProvenance: provenance }
    };
  }
  if (item.recordType === "calendar_event") {
    const startAt = item.dueAt ?? nowIso();
    return {
      title: importTargetTitle(item),
      description: item.content,
      startAt,
      endAt: new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString(),
      userId: ownerUserId,
      categories: ["Imported"],
      eventType: "imported"
    };
  }
  return {
    title: importTargetTitle(item),
    description: item.content,
    userId: ownerUserId,
    status: item.status === "done" || item.status === "completed" ? "done" : "backlog",
    dueDate: item.dueAt ? item.dueAt.slice(0, 10) : null,
    notes: [
      {
        title: "Import provenance",
        contentMarkdown: `Imported from ${String(provenance.sourceLabel)}.`,
        frontmatter: { importProvenance: provenance }
      }
    ]
  };
}

export function previewProductImport(inputValue: unknown) {
  const input = productImportPreviewSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const normalizedItems = input.items.map((item) => ({
    ...item,
    title: importTargetTitle(item)
  }));
  const payloadFingerprint = sha256(
    canonicalJson({
      ownerUserId: input.ownerUserId,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      items: normalizedItems
    })
  );
  const previewId = `import_preview_${payloadFingerprint.slice(0, 32)}`;
  const items = normalizedItems.map((item) => {
    const duplicate = titleExists(item.recordType, item.title, input.ownerUserId);
    return {
      ...item,
      duplicate,
      proposedAction: duplicate ? "review" : "create",
      provenance: {
        sourceKind: input.sourceKind,
        sourceLabel: input.sourceLabel,
        sourceId: item.sourceId,
        sourceUrl: item.sourceUrl,
        payloadFingerprint
      }
    };
  });
  const preview = {
    previewId,
    ownerUserId: input.ownerUserId,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    payloadFingerprint,
    items,
    counts: {
      total: items.length,
      create: items.filter((item) => !item.duplicate).length,
      conflicts: items.filter((item) => item.duplicate).length
    }
  };
  const now = nowIso();
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO product_import_runs (
           id, owner_user_id, source_kind, source_label, payload_fingerprint,
           idempotency_key_hash, status, preview_json, receipt_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, 'preview', ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET preview_json = excluded.preview_json,
           source_label = excluded.source_label, updated_at = excluded.updated_at
         WHERE product_import_runs.status = 'preview'`
      )
      .run(
        previewId,
        input.ownerUserId,
        input.sourceKind,
        input.sourceLabel,
        payloadFingerprint,
        JSON.stringify(preview),
        now,
        now
      );
    for (const item of items.filter((entry) => entry.duplicate)) {
      const id = `review_import_${sha256(`${previewId}\0${item.sourceId}`).slice(0, 32)}`;
      getDatabase()
        .prepare(
          `INSERT INTO product_review_items (
             id, owner_user_id, kind, source_type, source_id, revision,
             status, title, summary, proposed_action_json, evidence_json,
             resolution_json, created_at, resolved_at, updated_at
           ) VALUES (?, ?, 'import_conflict', 'product_import', ?, 1,
             'pending', ?, ?, ?, ?, NULL, ?, NULL, ?)
           ON CONFLICT(owner_user_id, kind, source_type, source_id) DO UPDATE SET
             revision = product_review_items.revision + 1,
             status = 'pending', title = excluded.title, summary = excluded.summary,
             proposed_action_json = excluded.proposed_action_json,
             evidence_json = excluded.evidence_json, resolution_json = NULL,
             resolved_at = NULL, updated_at = excluded.updated_at`
        )
        .run(
          id,
          input.ownerUserId,
          `${previewId}:${item.sourceId}`,
          item.title,
          "A visible record already has the same normalized title.",
          JSON.stringify({ previewId, sourceId: item.sourceId, action: "create" }),
          JSON.stringify([
            { label: "Source", value: input.sourceLabel },
            { label: "Record type", value: item.recordType }
          ]),
          now,
          now
        );
    }
  });
  return preview;
}

export function commitProductImport(inputValue: unknown, context: CrudContext) {
  const input = productImportCommitSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const keyHash = sha256(input.idempotencyKey);
  const commitFingerprint = sha256(
    canonicalJson({
      ownerUserId: input.ownerUserId,
      previewId: input.previewId,
      payloadFingerprint: input.payloadFingerprint,
      decisions: [...input.decisions].sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId)
      )
    })
  );
  const keyReplay = getDatabase()
    .prepare(
      `SELECT id, payload_fingerprint, commit_fingerprint, receipt_json
       FROM product_import_runs
       WHERE owner_user_id = ? AND idempotency_key_hash = ?`
    )
    .get(input.ownerUserId, keyHash) as
    | {
        id: string;
        payload_fingerprint: string;
        commit_fingerprint: string | null;
        receipt_json: string | null;
      }
    | undefined;
  if (keyReplay) {
    if (
      keyReplay.payload_fingerprint !== input.payloadFingerprint ||
      keyReplay.commit_fingerprint !== commitFingerprint
    ) {
      throw new HttpError(
        409,
        "product_import_idempotency_conflict",
        "That import key was already used for a different reviewed import request."
      );
    }
    return { ...(JSON.parse(keyReplay.receipt_json ?? "{}") as object), replayed: true };
  }
  const row = getDatabase()
    .prepare(
      `SELECT preview_json, payload_fingerprint, status
       FROM product_import_runs WHERE id = ? AND owner_user_id = ?`
    )
    .get(input.previewId, input.ownerUserId) as
    | { preview_json: string; payload_fingerprint: string; status: string }
    | undefined;
  if (!row || row.status !== "preview") {
    throw new HttpError(404, "product_import_preview_unavailable", "That import preview is unavailable.");
  }
  if (row.payload_fingerprint !== input.payloadFingerprint) {
    throw new HttpError(
      409,
      "product_import_preview_changed",
      "The import payload changed after preview. Review it again before importing."
    );
  }
  const preview = JSON.parse(row.preview_json) as {
    sourceKind: string;
    sourceLabel: string;
    items: Array<ProductImportItem & {
      duplicate: boolean;
      provenance: Record<string, unknown>;
    }>;
  };
  const decisions = new Map(input.decisions.map((entry) => [entry.sourceId, entry.action]));
  const createdAt = nowIso();
  const receipt = runInTransaction(() => {
    const created: Array<{
      sourceId: string;
      entityType: CrudEntityType;
      entityId: string;
      title: string;
      href: string;
    }> = [];
    const skipped: Array<{ sourceId: string; reason: string }> = [];
    for (const item of preview.items) {
      const action = decisions.get(item.sourceId) ?? (item.duplicate ? "skip" : "create");
      if (action === "skip") {
        skipped.push({ sourceId: item.sourceId, reason: item.duplicate ? "duplicate" : "operator_choice" });
        continue;
      }
      const result = createEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: item.recordType,
              data: importItemData(item, input.ownerUserId, item.provenance),
              clientRef: item.sourceId,
              idempotencyKey: `import:${sha256(input.idempotencyKey).slice(0, 48)}:${sha256(item.sourceId).slice(0, 24)}`
            }
          ]
        },
        { ...context, userIds: [input.ownerUserId] }
      ).results[0];
      if (!result?.ok || !result.id) {
        throw new HttpError(
          409,
          "product_import_record_failed",
          result?.error?.message ?? "Forge could not create one reviewed import record."
        );
      }
      created.push({
        sourceId: item.sourceId,
        entityType: item.recordType,
        entityId: result.id,
        title: item.title,
        href: entityHref(item.recordType, result.id)
      });
    }
    const value = {
      importId: input.previewId,
      sourceKind: preview.sourceKind,
      sourceLabel: preview.sourceLabel,
      status: "committed",
      created,
      skipped,
      committedAt: createdAt
    };
    getDatabase()
      .prepare(
        `UPDATE product_import_runs
         SET idempotency_key_hash = ?, commit_fingerprint = ?, status = 'committed', receipt_json = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'preview'`
      )
      .run(
        keyHash,
        commitFingerprint,
        JSON.stringify(value),
        createdAt,
        input.previewId,
        input.ownerUserId
      );
    getDatabase()
      .prepare(
        `UPDATE product_review_items SET status = 'superseded', resolved_at = ?, updated_at = ?
         WHERE owner_user_id = ? AND kind = 'import_conflict'
           AND source_id LIKE ? AND status = 'pending'`
      )
      .run(createdAt, createdAt, input.ownerUserId, `${input.previewId}:%`);
    return value;
  });
  return { ...receipt, replayed: false };
}

export function listProductImportRuns(ownerUserId: string) {
  requireOwner(ownerUserId);
  return getDatabase()
    .prepare(
      `SELECT id, source_kind, source_label, status, receipt_json, created_at, updated_at
       FROM product_import_runs
       WHERE owner_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`
    )
    .all(ownerUserId)
    .map((row) => {
      const value = row as {
        id: string;
        source_kind: string;
        source_label: string;
        status: "preview" | "committed" | "rolled_back";
        receipt_json: string | null;
        created_at: string;
        updated_at: string;
      };
      const receipt = value.receipt_json
        ? (JSON.parse(value.receipt_json) as {
            created?: Array<{
              sourceId: string;
              entityType: CrudEntityType;
              entityId: string;
              title: string;
              href: string;
            }>;
            skipped?: Array<{ sourceId: string; reason: string }>;
            committedAt?: string;
          })
        : null;
      return {
        id: value.id,
        sourceKind: value.source_kind,
        sourceLabel: value.source_label,
        status: value.status,
        created: receipt?.created ?? [],
        skipped: receipt?.skipped ?? [],
        committedAt: receipt?.committedAt ?? null,
        createdAt: value.created_at,
        updatedAt: value.updated_at
      };
    });
}

export function rollbackProductImport(
  importId: string,
  inputValue: unknown,
  context: CrudContext
) {
  const input = productImportRollbackSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const row = getDatabase()
    .prepare(
      `SELECT status, receipt_json FROM product_import_runs
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(importId, input.ownerUserId) as
    | { status: "preview" | "committed" | "rolled_back"; receipt_json: string | null }
    | undefined;
  if (!row) {
    throw new HttpError(404, "product_import_unavailable", "That import is unavailable.");
  }
  if (row.status === "rolled_back") {
    return { importId, status: "rolled_back", replayed: true };
  }
  if (row.status !== "committed" || !row.receipt_json) {
    throw new HttpError(409, "product_import_not_committed", "Only a committed import can be rolled back.");
  }
  const receipt = JSON.parse(row.receipt_json) as {
    created: Array<{ entityType: CrudEntityType; entityId: string }>;
  };
  const rolledBackAt = nowIso();
  runInTransaction(() => {
    for (const ref of [...receipt.created].reverse()) {
      deleteEntity(
        ref.entityType,
        ref.entityId,
        { mode: "soft", reason: `Rolled back import ${importId}.` },
        { ...context, userIds: [input.ownerUserId] }
      );
    }
    getDatabase()
      .prepare(
        `UPDATE product_import_runs SET status = 'rolled_back', updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'committed'`
      )
      .run(rolledBackAt, importId, input.ownerUserId);
  });
  return { importId, status: "rolled_back", rolledBackAt, replayed: false };
}

export function listProductReviewItems(
  ownerUserId: string,
  context: CrudContext
) {
  requireOwner(ownerUserId);
  const storedItems = getDatabase()
    .prepare(
      `SELECT id, kind, source_type, source_id, revision, status, title, summary,
              proposed_action_json, evidence_json, resolution_json,
              created_at, resolved_at, updated_at
       FROM product_review_items
       WHERE owner_user_id = ? AND status = 'pending'
       ORDER BY created_at ASC, id ASC LIMIT 100`
    )
    .all(ownerUserId)
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: value.id,
        kind: value.kind,
        sourceType: value.source_type,
        sourceId: value.source_id,
        revision: value.revision,
        status: value.status,
        title: value.title,
        summary: value.summary,
        proposedAction: JSON.parse(String(value.proposed_action_json)),
        evidence: JSON.parse(String(value.evidence_json)),
        resolution: value.resolution_json
          ? JSON.parse(String(value.resolution_json))
          : null,
        createdAt: value.created_at,
        resolvedAt: value.resolved_at,
        updatedAt: value.updated_at
      };
    });
  const relationshipItems = listOwnerRelationshipProposals(ownerUserId, 20).proposals.map(
    (proposal) => ({
      id: `relationship:${proposal.id}`,
      kind: "relationship_proposal" as const,
      sourceType: "relationship_proposal",
      sourceId: proposal.id,
      revision: proposal.revision,
      status: "pending" as const,
      title: `Link ${proposal.source.title} to ${proposal.target.title}`,
      summary: proposal.explanation,
      proposedAction: {
        relationship: proposal.relationship,
        source: proposal.source,
        target: proposal.target,
        confidence: proposal.confidence
      },
      evidence: proposal.evidence,
      resolution: null,
      createdAt: proposal.createdAt,
      resolvedAt: null,
      updatedAt: proposal.updatedAt
    })
  );
  const approvalItems = listApprovalRequests("pending")
    .filter((approval) => {
      if (approval.entityType && approval.entityId) {
        return getEntityOwnerId(approval.entityType, approval.entityId) === ownerUserId;
      }
      const payload = approval.requestedPayload as Record<string, unknown>;
      return payload.ownerUserId === ownerUserId || payload.userId === ownerUserId;
    })
    .map((approval) => ({
      id: `approval:${approval.id}`,
      kind: "agent_proposal" as const,
      sourceType: "approval_request",
      sourceId: approval.id,
      revision: 1,
      status: "pending" as const,
      title: approval.title,
      summary: approval.summary,
      proposedAction: {
        actionType: approval.actionType,
        entityType: approval.entityType,
        entityId: approval.entityId
      },
      evidence: [
        {
          requestedByAgentId: approval.requestedByAgentId,
          requestedAt: approval.createdAt,
          requestedPayload: approval.requestedPayload
        }
      ],
      resolution: null,
      createdAt: approval.createdAt,
      resolvedAt: null,
      updatedAt: approval.updatedAt
    }));
  const artifactItems = listArtifacts(
    { limit: 100, offset: 0 },
    { ...context, userIds: [ownerUserId] }
  )
    .filter(
      (artifact) =>
        artifact.enrichmentResults.status === "proposed" &&
        typeof artifact.enrichmentResults.proposalId === "string"
    )
    .map((artifact) => ({
      id: `artifact:${artifact.id}:${String(artifact.enrichmentResults.proposalId)}`,
      kind: "artifact_enrichment" as const,
      sourceType: "artifact",
      sourceId: artifact.id,
      revision: 1,
      status: "pending" as const,
      title: `Review metadata for ${artifact.title || artifact.originalFileName}`,
      summary: "An enrichment provider proposed metadata. Nothing changes until you accept this exact proposal.",
      proposedAction: artifact.enrichmentResults.output ?? {},
      evidence: [
        {
          proposalId: artifact.enrichmentResults.proposalId,
          provider: artifact.enrichmentResults.provider,
          model: artifact.enrichmentResults.model,
          artifactHref: `/artifacts/${artifact.id}`
        }
      ],
      resolution: null,
      createdAt: String(artifact.enrichmentResults.generatedAt ?? artifact.updatedAt),
      resolvedAt: null,
      updatedAt: artifact.updatedAt
    }));
  return [...storedItems, ...relationshipItems, ...approvalItems, ...artifactItems]
    .sort(
      (left, right) =>
        String(left.createdAt).localeCompare(String(right.createdAt)) ||
        String(left.id).localeCompare(String(right.id))
    )
    .slice(0, 100);
}

export function decideProductReviewItem(
  itemId: string,
  inputValue: unknown,
  context: CrudContext
) {
  const input = productReviewDecisionSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  if (itemId.startsWith("relationship:")) {
    const result = decideRelationshipProposal({
      proposalId: itemId.slice("relationship:".length),
      ownerUserId: input.ownerUserId,
      expectedRevision: input.expectedRevision,
      action: input.decision,
      actor: context.actor ?? null
    });
    if (result.status === "not_found" || result.status === "unavailable" || result.status === "expired") {
      throw new HttpError(
        404,
        "product_review_item_unavailable",
        "That review item is no longer available."
      );
    }
    if (result.status === "conflict") {
      throw new HttpError(
        409,
        "product_review_revision_conflict",
        "This review item changed or was already resolved. Refresh before deciding."
      );
    }
    if (result.status !== "accepted" && result.status !== "rejected") {
      throw new HttpError(
        409,
        "product_review_revision_conflict",
        "This review item changed before the decision committed."
      );
    }
    return {
      itemId,
      decision: input.decision,
      revision: result.revision,
      resolvedAt: nowIso(),
      linkCreated: result.linkCreated,
      replayed: result.replayed
    };
  }
  if (itemId.startsWith("approval:")) {
    const approvalId = itemId.slice("approval:".length);
    const approval = listApprovalRequests("pending").find(
      (entry) => entry.id === approvalId
    );
    const payload = approval?.requestedPayload as Record<string, unknown> | undefined;
    const owned = Boolean(
      approval &&
        ((approval.entityType && approval.entityId
          ? getEntityOwnerId(approval.entityType, approval.entityId) ===
            input.ownerUserId
          : payload?.ownerUserId === input.ownerUserId ||
            payload?.userId === input.ownerUserId))
    );
    if (!owned || input.expectedRevision !== 1) {
      throw new HttpError(
        409,
        "product_review_revision_conflict",
        "This approval changed or is no longer available. Refresh before deciding."
      );
    }
    const resolved =
      input.decision === "accept"
        ? approveApprovalRequest(
            approvalId,
            "Accepted from the universal review queue.",
            context.actor ?? null
          )
        : rejectApprovalRequest(
            approvalId,
            "Rejected from the universal review queue.",
            context.actor ?? null
          );
    if (!resolved) {
      throw new HttpError(
        409,
        "product_review_revision_conflict",
        "This approval changed before the decision committed."
      );
    }
    return {
      itemId,
      decision: input.decision,
      revision: 2,
      resolvedAt: nowIso()
    };
  }
  if (itemId.startsWith("artifact:")) {
    const [, artifactId, proposalId] = itemId.split(":");
    if (!artifactId || !proposalId || input.expectedRevision !== 1) {
      throw new HttpError(
        409,
        "product_review_revision_conflict",
        "This enrichment proposal changed. Refresh before deciding."
      );
    }
    const artifactContext = { ...context, userIds: [input.ownerUserId] };
    const artifact =
      input.decision === "accept"
        ? applyArtifactEnrichmentProposal(
            artifactId,
            { proposalId },
            artifactContext
          )
        : rejectArtifactEnrichmentProposal(
            artifactId,
            proposalId,
            artifactContext
          );
    if (!artifact) {
      throw new HttpError(
        404,
        "product_review_item_unavailable",
        "That artifact proposal is unavailable."
      );
    }
    return {
      itemId,
      decision: input.decision,
      revision: 2,
      resolvedAt: nowIso(),
      artifactId
    };
  }
  const storedItem = getDatabase()
    .prepare(
      `SELECT kind FROM product_review_items
       WHERE id = ? AND owner_user_id = ? AND status = 'pending' AND revision = ?`
    )
    .get(itemId, input.ownerUserId, input.expectedRevision) as
    | { kind: string }
    | undefined;
  if (!storedItem) {
    throw new HttpError(
      409,
      "product_review_revision_conflict",
      "This review item changed or was already resolved. Refresh before deciding."
    );
  }
  if (storedItem.kind === "import_conflict" && input.decision === "accept") {
    throw new HttpError(
      409,
      "product_import_conflict_requires_import_review",
      "Open the import preview to choose create or skip with the complete source context."
    );
  }
  const now = nowIso();
  const result = getDatabase()
    .prepare(
      `UPDATE product_review_items
       SET status = ?, revision = revision + 1, resolution_json = ?,
           resolved_at = ?, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND status = 'pending' AND revision = ?`
    )
    .run(
      input.decision === "accept" ? "accepted" : "rejected",
      JSON.stringify({ decision: input.decision, actor: context.actor ?? null }),
      now,
      now,
      itemId,
      input.ownerUserId,
      input.expectedRevision
    );
  if (Number(result.changes) !== 1) {
    throw new HttpError(
      409,
      "product_review_revision_conflict",
      "This review item changed or was already resolved. Refresh before deciding."
    );
  }
  return {
    itemId,
    decision: input.decision,
    revision: input.expectedRevision + 1,
    resolvedAt: now
  };
}

export function getProductFeedback(ownerUserId: string) {
  requireOwner(ownerUserId);
  const setting = getDatabase()
    .prepare(
      `SELECT enabled, consent_version, consented_at, updated_at
       FROM product_feedback_settings WHERE owner_user_id = ?`
    )
    .get(ownerUserId) as
    | {
        enabled: number;
        consent_version: string | null;
        consented_at: string | null;
        updated_at: string;
      }
    | undefined;
  const events = getDatabase()
    .prepare(
      `SELECT id, event_name, outcome_key, surface_key, success,
              duration_bucket, created_at
       FROM product_feedback_events WHERE owner_user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 500`
    )
    .all(ownerUserId)
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: value.id,
        eventName: value.event_name,
        outcomeKey: value.outcome_key,
        surfaceKey: value.surface_key,
        success:
          value.success === null || value.success === undefined
            ? null
            : value.success === 1,
        durationBucket: value.duration_bucket,
        createdAt: value.created_at
      };
    });
  return {
    settings: {
      ownerUserId,
      enabled: setting?.enabled === 1,
      consentVersion: setting?.consent_version ?? null,
      consentedAt: setting?.consented_at ?? null,
      updatedAt: setting?.updated_at ?? null
    },
    events,
    policy: {
      transport: "local_only",
      allowedFields: [
        "eventName",
        "outcomeKey",
        "surfaceKey",
        "success",
        "durationBucket",
        "createdAt"
      ],
      prohibitedFields: [
        "record content",
        "record titles",
        "file paths",
        "credentials",
        "stable device identifiers"
      ],
      retentionDays: 90
    }
  };
}

export function updateProductFeedbackSettings(inputValue: unknown) {
  const input = productFeedbackSettingsSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  if (input.enabled && input.consentVersion !== "privacy-feedback-v1") {
    throw new HttpError(
      400,
      "product_feedback_consent_required",
      "Enable feedback only after accepting the current privacy feedback consent."
    );
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO product_feedback_settings (
         owner_user_id, enabled, consent_version, consented_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         enabled = excluded.enabled,
         consent_version = excluded.consent_version,
         consented_at = excluded.consented_at,
         updated_at = excluded.updated_at`
    )
    .run(
      input.ownerUserId,
      input.enabled ? 1 : 0,
      input.enabled ? input.consentVersion : null,
      input.enabled ? now : null,
      now
    );
  return getProductFeedback(input.ownerUserId);
}

export function recordProductFeedbackEvent(inputValue: unknown) {
  const input = productFeedbackEventSchema.parse(inputValue);
  requireOwner(input.ownerUserId);
  const enabled = getDatabase()
    .prepare(
      `SELECT 1 FROM product_feedback_settings
       WHERE owner_user_id = ? AND enabled = 1 LIMIT 1`
    )
    .get(input.ownerUserId);
  if (!enabled) return { recorded: false, reason: "not_enabled" };
  const createdAt = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO product_feedback_events (
         id, owner_user_id, event_name, outcome_key, surface_key,
         success, duration_bucket, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `feedback_${randomUUID()}`,
      input.ownerUserId,
      input.eventName,
      input.outcomeKey,
      input.surfaceKey,
      input.success === null ? null : input.success ? 1 : 0,
      input.durationBucket,
      createdAt
    );
  getDatabase()
    .prepare(
      `DELETE FROM product_feedback_events
       WHERE owner_user_id = ? AND created_at < datetime('now', '-90 days')`
    )
    .run(input.ownerUserId);
  return { recorded: true, createdAt };
}

export function deleteProductFeedback(ownerUserId: string) {
  requireOwner(ownerUserId);
  const result = getDatabase()
    .prepare("DELETE FROM product_feedback_events WHERE owner_user_id = ?")
    .run(ownerUserId);
  return { deleted: Number(result.changes) };
}
