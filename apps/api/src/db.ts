import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { logForgeDebug } from "./debug.js";
import { ensureQuestionnaireSeeds } from "./repositories/questionnaires.js";
import { getMonorepoRuntimePreferencePath } from "./runtime-data-root.js";

function nowIso(): string {
  return new Date().toISOString();
}

function dateOffsetIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(moduleDir, "..");
const migrationsDir = path.join(apiRoot, "migrations");
const userSharedForgeDataRoot = path.join(os.homedir(), ".forge");
const PEOPLE_LEGACY_SCHEMA_REPAIR_MIGRATION =
  "104_people_legacy_schema_repair.sql";
const SECURITY_PAIRING_METADATA_COMPATIBILITY_MIGRATION =
  "120_security_pairing_metadata_compatibility.sql";
const COURSE_DEFINITION_INTEGRITY_MIGRATION =
  "121_course_definition_integrity.sql";
const PEER_QUERY_AUDIT_COMPATIBILITY_MIGRATION =
  "134a_peer_query_audit_compatibility.sql";
const WORK_OPPORTUNITY_SCHEMA_COMPATIBILITY_MIGRATION =
  "139_work_opportunity_schema_compatibility.sql";
const WORK_OPPORTUNITY_CANONICAL_SCHEMA_MIGRATION =
  "138_work_and_opportunity_management.sql";

const WORK_OPPORTUNITY_COMPATIBILITY_TABLES = [
  "opportunity_campaigns",
  "campaign_opportunity_evaluations",
  "candidate_positioning_profiles",
  "candidate_document_sets",
  "application_response_templates",
  "job_applications",
  "job_offers",
  "job_offer_revisions",
  "application_transmission_previews"
] as const;

const WORK_OPPORTUNITY_COMPATIBILITY_INDEXES = [
  "idx_opportunity_campaigns_owner_status",
  "idx_campaign_opportunity_evaluations_latest",
  "idx_job_applications_owner_status",
  "idx_job_applications_active_duplicate_guard",
  "idx_application_transmission_previews_application"
] as const;

const WORK_OPPORTUNITY_COMPATIBILITY_TRIGGERS = [
  "trg_opportunity_campaign_revision_history",
  "trg_job_application_revision_history"
] as const;

const PEOPLE_HARDENING_COLUMNS = [
  {
    table: "forge_devices",
    column: "key_agreement_public_key",
    definition: "key_agreement_public_key TEXT"
  },
  {
    table: "forge_devices",
    column: "certificate_serial",
    definition: "certificate_serial TEXT"
  },
  {
    table: "forge_devices",
    column: "certificate_hash",
    definition: "certificate_hash TEXT"
  },
  {
    table: "peer_idempotency_records",
    column: "response_ciphertext",
    definition:
      "response_ciphertext TEXT CHECK (response_ciphertext IS NULL OR length(response_ciphertext) BETWEEN 32 AND 2097152)"
  },
  {
    table: "peer_idempotency_records",
    column: "response_reference",
    definition:
      "response_reference TEXT CHECK (response_reference IS NULL OR length(response_reference) BETWEEN 1 AND 240)"
  },
  {
    table: "peer_remote_records",
    column: "query_hash",
    definition:
      "query_hash TEXT CHECK (query_hash IS NULL OR (length(query_hash) = 64 AND query_hash NOT GLOB '*[^0-9a-f]*'))"
  },
  {
    table: "peer_remote_records",
    column: "next_event_at",
    definition:
      "next_event_at TEXT CHECK (next_event_at IS NULL OR (projection_id IN ('calendar.availability.v1', 'calendar.selected_events.v1') AND julianday(next_event_at) IS NOT NULL))"
  }
] as const;

const PEOPLE_OBSOLETE_GLOBAL_IDENTITY_INDEXES = [
  "idx_forge_principals_public_id_global",
  "idx_forge_principals_root_key_global",
  "idx_forge_devices_signing_key_global",
  "idx_forge_devices_agreement_key_global",
  "idx_forge_devices_certificate_global",
  "idx_forge_devices_certificate_hash_global",
  "idx_forge_devices_private_key_handle_global"
] as const;

const PEOPLE_OWNER_PARTITION_INDEXES_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_principals_owner_root_key
  ON forge_principals (owner_user_id, root_public_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_signing_key
  ON forge_devices (owner_user_id, certified_public_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_agreement_key
  ON forge_devices (owner_user_id, key_agreement_public_key)
  WHERE key_agreement_public_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_certificate
  ON forge_devices (owner_user_id, certificate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_certificate_hash
  ON forge_devices (owner_user_id, certificate_hash)
  WHERE certificate_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_private_key_handle
  ON forge_devices (owner_user_id, private_key_secret_id)
  WHERE private_key_secret_id IS NOT NULL;
`;

function hasDatabaseColumn(
  database: DatabaseSync,
  table: string,
  column: string
) {
  return (
    database
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ? LIMIT 1`)
      .get(table, column) !== undefined
  );
}

export async function repairLegacyPeopleSchema(database: DatabaseSync) {
  // Early 087/088 builds were released before those migration files reached
  // their final additive form. Restore missing objects without reinstating the
  // global identity indexes that migration 099 replaced with owner partitions.
  const peopleSchema = await readFile(
    path.join(migrationsDir, "087_people_and_peer_sharing.sql"),
    "utf8"
  );
  database.exec(peopleSchema);

  for (const repair of PEOPLE_HARDENING_COLUMNS) {
    if (!hasDatabaseColumn(database, repair.table, repair.column)) {
      database.exec(
        `ALTER TABLE ${repair.table} ADD COLUMN ${repair.definition}`
      );
    }
  }

  const hardeningSchema = await readFile(
    path.join(migrationsDir, "088_people_peer_identity_hardening.sql"),
    "utf8"
  );
  let repairSchema = hardeningSchema.replace(/ALTER TABLE[\s\S]*?;\s*/gu, "");
  for (const indexName of PEOPLE_OBSOLETE_GLOBAL_IDENTITY_INDEXES) {
    repairSchema = repairSchema.replace(
      new RegExp(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}\\s+[\\s\\S]*?;\\s*`,
        "gu"
      ),
      ""
    );
    database.exec(`DROP INDEX IF EXISTS ${indexName}`);
  }
  database.exec(repairSchema);
  database.exec(PEOPLE_OWNER_PARTITION_INDEXES_SQL);
}

export function prepareLegacyPeerQueryAuditMigration(database: DatabaseSync) {
  // Early published revisions of migration 087 created peer_query_audit before
  // the exact grant-verification evidence columns were added. Migration 104
  // replayed the final 087 schema with CREATE TABLE IF NOT EXISTS, which could
  // create the final trigger against that older table without adding its
  // columns. Drop the potentially invalid trigger before any ALTER TABLE, add
  // the columns conditionally, and let migration 134a rebuild the table with
  // the complete foreign-key and CHECK constraint contract.
  database.exec(
    "DROP TRIGGER IF EXISTS trg_peer_query_audit_exact_allowed_verification"
  );
  const repairs = [
    {
      column: "grant_verification_id",
      definition: "grant_verification_id TEXT"
    },
    {
      column: "verified_grant_hash",
      definition:
        "verified_grant_hash TEXT CHECK (verified_grant_hash IS NULL OR length(verified_grant_hash) = 64)"
    },
    {
      column: "authorization_evidence_json",
      definition:
        "authorization_evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(authorization_evidence_json) AND json_type(authorization_evidence_json) = 'object' AND length(authorization_evidence_json) <= 262144)"
    }
  ] as const;
  for (const repair of repairs) {
    if (!hasDatabaseColumn(database, "peer_query_audit", repair.column)) {
      database.exec(
        `ALTER TABLE peer_query_audit ADD COLUMN ${repair.definition}`
      );
    }
  }
}

function assertSqlIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(identifier)) {
    throw new Error(
      `Unsafe SQL identifier in compatibility migration: ${identifier}`
    );
  }
  return identifier;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${assertSqlIdentifier(identifier)}"`;
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string
) {
  if (hasDatabaseColumn(database, table, column)) return;
  database.exec(
    `ALTER TABLE ${quoteSqlIdentifier(table)} ADD COLUMN ${definition}`
  );
}

function extractCanonicalTableStatement(source: string, table: string): string {
  const marker = `CREATE TABLE ${assertSqlIdentifier(table)} (`;
  const start = source.indexOf(marker);
  const terminator = "\n) STRICT;";
  const end = start < 0 ? -1 : source.indexOf(terminator, start);
  if (start < 0 || end < 0) {
    throw new Error(`Canonical Work schema is missing table ${table}.`);
  }
  return source.slice(start, end + terminator.length);
}

function extractCanonicalIndexStatement(source: string, index: string): string {
  const safeIndex = assertSqlIdentifier(index);
  const pattern = new RegExp(
    `CREATE (?:UNIQUE )?INDEX ${safeIndex}\\b[\\s\\S]*?;`,
    "u"
  );
  const statement = source.match(pattern)?.[0];
  if (!statement) {
    throw new Error(`Canonical Work schema is missing index ${index}.`);
  }
  return statement;
}

function extractCanonicalTriggerStatement(
  source: string,
  trigger: string
): string {
  const marker = `CREATE TRIGGER ${assertSqlIdentifier(trigger)}\n`;
  const start = source.indexOf(marker);
  const terminator = "\nEND;";
  const end = start < 0 ? -1 : source.indexOf(terminator, start);
  if (start < 0 || end < 0) {
    throw new Error(`Canonical Work schema is missing trigger ${trigger}.`);
  }
  return source.slice(start, end + terminator.length);
}

function rebuildTableFromCanonicalWorkSchema(
  database: DatabaseSync,
  canonicalSchema: string,
  table: string
) {
  const safeTable = assertSqlIdentifier(table);
  const stagingTable = `_forge_139_${safeTable}`;
  const existingStaging = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(stagingTable);
  if (existingStaging) {
    throw new Error(
      `Compatibility migration found unexpected staging table ${stagingTable}.`
    );
  }

  const canonicalStatement = extractCanonicalTableStatement(
    canonicalSchema,
    safeTable
  );
  database.exec(
    canonicalStatement.replace(
      `CREATE TABLE ${safeTable} (`,
      `CREATE TABLE ${stagingTable} (`
    )
  );

  const targetColumns = database
    .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
    .all(stagingTable) as Array<{ name: string }>;
  const sourceColumns = new Set(
    (
      database
        .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
        .all(safeTable) as Array<{ name: string }>
    ).map((row) => row.name)
  );
  const missingColumns = targetColumns
    .map((row) => row.name)
    .filter((column) => !sourceColumns.has(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `Compatibility migration cannot rebuild ${safeTable}; missing columns: ${missingColumns.join(", ")}.`
    );
  }

  const quotedColumns = targetColumns
    .map((row) => quoteSqlIdentifier(row.name))
    .join(", ");
  const sourceCount = (
    database
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(safeTable)}`)
      .get() as { count: number }
  ).count;
  database.exec(
    `INSERT INTO ${quoteSqlIdentifier(stagingTable)} (${quotedColumns}) ` +
      `SELECT ${quotedColumns} FROM ${quoteSqlIdentifier(safeTable)}`
  );
  const copiedCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(stagingTable)}`
      )
      .get() as { count: number }
  ).count;
  if (copiedCount !== sourceCount) {
    throw new Error(
      `Compatibility migration copied ${copiedCount} of ${sourceCount} rows for ${safeTable}.`
    );
  }

  database.exec(`DROP TABLE ${quoteSqlIdentifier(safeTable)}`);
  database.exec(
    `ALTER TABLE ${quoteSqlIdentifier(stagingTable)} RENAME TO ${quoteSqlIdentifier(safeTable)}`
  );
}

function annotateDanglingCampaignCriteria(database: DatabaseSync) {
  database.exec(`
    UPDATE opportunity_campaigns
    SET provenance_json = json_set(
          provenance_json,
          '$.compatibilityMigrations.workOpportunity139',
          json_object(
            'action', 'cleared_dangling_current_criteria',
            'previousCriteriaVersionId', current_criteria_version_id
          )
        ),
        current_criteria_version_id = NULL,
        revision = revision + 1
    WHERE current_criteria_version_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM campaign_criteria_versions
        WHERE id = opportunity_campaigns.current_criteria_version_id
      )
  `);
}

function backfillLegacyApplicationCriteria(database: DatabaseSync) {
  database.exec(`
    UPDATE job_applications
    SET criteria_version_id = COALESCE(
          (
            SELECT criteria.id
            FROM opportunity_campaigns AS campaign
            JOIN campaign_criteria_versions AS criteria
              ON criteria.id = campaign.current_criteria_version_id
             AND criteria.campaign_id = campaign.id
            WHERE campaign.id = job_applications.primary_campaign_id
          ),
          (
            SELECT criteria.id
            FROM campaign_criteria_versions AS criteria
            WHERE criteria.campaign_id = job_applications.primary_campaign_id
            ORDER BY criteria.version DESC, criteria.id DESC
            LIMIT 1
          )
        ),
        provenance_json = json_set(
          provenance_json,
          '$.compatibilityMigrations.workOpportunity139',
          json_object(
            'basis', 'campaign_current_or_latest',
            'reason', 'earlier schema did not retain the application criteria link'
          )
        ),
        revision = revision + 1
    WHERE criteria_version_id IS NULL
      AND deleted_at IS NULL
  `);

  const unresolved = (
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM job_applications
         WHERE deleted_at IS NULL AND criteria_version_id IS NULL`
      )
      .get() as { count: number }
  ).count;
  if (unresolved > 0) {
    throw new Error(
      `Compatibility migration cannot establish criteria provenance for ${unresolved} active job application(s).`
    );
  }
}

function backfillLegacyOfferRevisionSnapshots(database: DatabaseSync) {
  database.exec(`
    UPDATE job_offer_revisions
    SET status = COALESCE(
          (SELECT status FROM job_offers WHERE id = job_offer_revisions.offer_id),
          'received'
        ),
        contingencies_json = COALESCE(
          (SELECT contingencies_json FROM job_offers WHERE id = job_offer_revisions.offer_id),
          '[]'
        ),
        expires_at = (
          SELECT expires_at FROM job_offers WHERE id = job_offer_revisions.offer_id
        ),
        decision = COALESCE(
          (SELECT decision FROM job_offers WHERE id = job_offer_revisions.offer_id),
          ''
        ),
        rationale = COALESCE(
          (SELECT rationale FROM job_offers WHERE id = job_offer_revisions.offer_id),
          ''
        ),
        criteria_version_id = (
          SELECT criteria_version_id FROM job_offers WHERE id = job_offer_revisions.offer_id
        ),
        planned_engagement_id = (
          SELECT planned_engagement_id FROM job_offers WHERE id = job_offer_revisions.offer_id
        ),
        provenance_json = json_set(
          provenance_json,
          '$.compatibilityMigrations.workOpportunity139',
          json_object(
            'basis', 'parent_offer_snapshot',
            'limitation', 'these fields were unavailable in the earlier revision schema'
          )
        )
  `);
}

export async function prepareWorkOpportunitySchemaCompatibilityMigration(
  database: DatabaseSync
) {
  const canonicalSchema = await readFile(
    path.join(migrationsDir, WORK_OPPORTUNITY_CANONICAL_SCHEMA_MIGRATION),
    "utf8"
  );

  addColumnIfMissing(
    database,
    "candidate_positioning_profiles",
    "preferred_default_artifact_id",
    "preferred_default_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL"
  );
  const additiveColumns = [
    [
      "candidate_document_sets",
      "confidentiality",
      "confidentiality TEXT NOT NULL DEFAULT 'private' CHECK (confidentiality IN ('private', 'restricted', 'shareable'))"
    ],
    [
      "candidate_document_sets",
      "retention_policy_json",
      "retention_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(retention_policy_json) AND json_type(retention_policy_json) = 'object')"
    ],
    [
      "candidate_document_sets",
      "scope_project_ids_json",
      "scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array')"
    ],
    [
      "candidate_document_sets",
      "scope_tag_ids_json",
      "scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array')"
    ],
    [
      "candidate_document_sets",
      "provenance_json",
      "provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object')"
    ],
    [
      "application_response_templates",
      "scope_project_ids_json",
      "scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array')"
    ],
    [
      "application_response_templates",
      "scope_tag_ids_json",
      "scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array')"
    ],
    [
      "application_response_templates",
      "provenance_json",
      "provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object')"
    ],
    [
      "job_applications",
      "criteria_version_id",
      "criteria_version_id TEXT REFERENCES campaign_criteria_versions(id)"
    ],
    [
      "job_applications",
      "reapplication_of_application_id",
      "reapplication_of_application_id TEXT REFERENCES job_applications(id) ON DELETE SET NULL"
    ],
    [
      "job_applications",
      "reapplication_reason",
      "reapplication_reason TEXT NOT NULL DEFAULT ''"
    ],
    [
      "job_applications",
      "reapplication_reviewed_at",
      "reapplication_reviewed_at TEXT"
    ],
    [
      "job_offers",
      "negotiation_asks_json",
      "negotiation_asks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negotiation_asks_json) AND json_type(negotiation_asks_json) = 'array')"
    ],
    ["job_offers", "response", "response TEXT NOT NULL DEFAULT ''"],
    [
      "job_offers",
      "artifact_ids_json",
      "artifact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_ids_json) AND json_type(artifact_ids_json) = 'array')"
    ],
    [
      "job_offer_revisions",
      "status",
      "status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('expected', 'received', 'negotiating', 'revised', 'accepted', 'declined', 'expired', 'withdrawn'))"
    ],
    [
      "job_offer_revisions",
      "contingencies_json",
      "contingencies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contingencies_json) AND json_type(contingencies_json) = 'array')"
    ],
    ["job_offer_revisions", "expires_at", "expires_at TEXT"],
    ["job_offer_revisions", "decision", "decision TEXT NOT NULL DEFAULT ''"],
    ["job_offer_revisions", "rationale", "rationale TEXT NOT NULL DEFAULT ''"],
    [
      "job_offer_revisions",
      "criteria_version_id",
      "criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL"
    ],
    [
      "job_offer_revisions",
      "planned_engagement_id",
      "planned_engagement_id TEXT REFERENCES work_engagements(id) ON DELETE SET NULL"
    ],
    [
      "application_transmission_previews",
      "guard_context_json",
      "guard_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(guard_context_json) AND json_type(guard_context_json) = 'object')"
    ]
  ] as const;

  const applicationCriteriaWasMissing = !hasDatabaseColumn(
    database,
    "job_applications",
    "criteria_version_id"
  );
  const offerRevisionStatusWasMissing = !hasDatabaseColumn(
    database,
    "job_offer_revisions",
    "status"
  );
  for (const [table, column, definition] of additiveColumns) {
    addColumnIfMissing(database, table, column, definition);
  }

  annotateDanglingCampaignCriteria(database);
  if (applicationCriteriaWasMissing) {
    backfillLegacyApplicationCriteria(database);
  }
  if (offerRevisionStatusWasMissing) {
    backfillLegacyOfferRevisionSnapshots(database);
  }

  for (const table of WORK_OPPORTUNITY_COMPATIBILITY_TABLES) {
    rebuildTableFromCanonicalWorkSchema(database, canonicalSchema, table);
  }
  for (const index of WORK_OPPORTUNITY_COMPATIBILITY_INDEXES) {
    database.exec(extractCanonicalIndexStatement(canonicalSchema, index));
  }
  for (const trigger of WORK_OPPORTUNITY_COMPATIBILITY_TRIGGERS) {
    database.exec(extractCanonicalTriggerStatement(canonicalSchema, trigger));
  }
}

function assertNoForeignKeyViolations(
  database: DatabaseSync,
  migration: string
) {
  const violations = database
    .prepare("PRAGMA foreign_key_check")
    .all() as Array<{
    table: string;
  }>;
  if (violations.length === 0) return;
  const tables = [...new Set(violations.map((violation) => violation.table))]
    .sort()
    .join(", ");
  throw new Error(
    `${migration} produced ${violations.length} foreign-key violation(s) in: ${tables}.`
  );
}

function backfillLegacyPairingClientMetadata(database: DatabaseSync) {
  if (
    !hasDatabaseColumn(database, "security_pairing_requests", "client_type")
  ) {
    return;
  }
  database.exec(`
    INSERT OR IGNORE INTO security_pairing_client_metadata (
      pairing_request_id,
      client_type
    )
    SELECT id, client_type
    FROM security_pairing_requests
  `);
}

function backfillCourseDefinitionIntegrity(database: DatabaseSync) {
  const courseIds = database
    .prepare(
      `SELECT id FROM courses
       WHERE definition_sha256 IS NULL
       ORDER BY id`
    )
    .all() as Array<{ id: string }>;
  const readCourse = database.prepare(
    "SELECT definition_json FROM courses WHERE id = ?"
  );
  const updateCourse = database.prepare(
    "UPDATE courses SET definition_sha256 = ? WHERE id = ?"
  );
  for (const { id } of courseIds) {
    const row = readCourse.get(id) as { definition_json: string } | undefined;
    if (!row) continue;
    updateCourse.run(
      createHash("sha256").update(row.definition_json).digest("hex"),
      id
    );
  }

  const releaseIds = database
    .prepare(
      `SELECT course_id, version FROM course_releases
       WHERE definition_sha256 IS NULL
       ORDER BY course_id, version`
    )
    .all() as Array<{ course_id: string; version: string }>;
  const readRelease = database.prepare(
    `SELECT definition_json FROM course_releases
     WHERE course_id = ? AND version = ?`
  );
  const updateRelease = database.prepare(
    `UPDATE course_releases SET definition_sha256 = ?
     WHERE course_id = ? AND version = ?`
  );
  for (const { course_id: courseId, version } of releaseIds) {
    const row = readRelease.get(courseId, version) as
      | { definition_json: string }
      | undefined;
    if (!row) continue;
    updateRelease.run(
      createHash("sha256").update(row.definition_json).digest("hex"),
      courseId,
      version
    );
  }
}

function findSourceProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "apps", "api", "migrations")) &&
      existsSync(path.join(current, "apps", "web", "src"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const sourceProjectRoot = findSourceProjectRoot(apiRoot);
const monorepoForgeDataRoot = sourceProjectRoot
  ? path.resolve(sourceProjectRoot, "..", "..", "data", "forge")
  : null;

function resolveCanonicalDataDir(root = dataRoot): string {
  return path.resolve(root);
}

function resolveLegacyDataDir(root = dataRoot): string {
  return path.join(path.resolve(root), "data");
}

function resolveCanonicalDatabasePath(root = dataRoot): string {
  return path.join(resolveCanonicalDataDir(root), "forge.sqlite");
}

function resolveLegacyDatabasePath(root = dataRoot): string {
  return path.join(resolveLegacyDataDir(root), "forge.sqlite");
}

function hasCanonicalRuntimeLayout(root = dataRoot): boolean {
  const canonicalRoot = resolveCanonicalDataDir(root);
  return (
    existsSync(resolveCanonicalDatabasePath(root)) ||
    existsSync(path.join(canonicalRoot, "wiki-ingest")) ||
    existsSync(path.join(canonicalRoot, ".forge-secrets.key"))
  );
}

function hasLegacyRuntimeLayout(root = dataRoot): boolean {
  const legacyRoot = resolveLegacyDataDir(root);
  return (
    existsSync(resolveLegacyDatabasePath(root)) ||
    existsSync(path.join(legacyRoot, "wiki-ingest")) ||
    existsSync(path.join(legacyRoot, ".forge-secrets.key"))
  );
}

export function resolveDatabasePathForDataRoot(root = dataRoot): string {
  if (existsSync(resolveCanonicalDatabasePath(root))) {
    return resolveCanonicalDatabasePath(root);
  }
  if (existsSync(resolveLegacyDatabasePath(root))) {
    return resolveLegacyDatabasePath(root);
  }
  return resolveCanonicalDatabasePath(root);
}

export function resolveDefaultDataRoot(
  currentWorkingDir = process.cwd()
): string {
  const configured = process.env.FORGE_DATA_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  if (existsSync(getMonorepoRuntimePreferencePath())) {
    try {
      const raw = readFileSync(getMonorepoRuntimePreferencePath(), "utf8");
      const parsed = JSON.parse(raw) as { dataRoot?: unknown };
      if (
        typeof parsed.dataRoot === "string" &&
        parsed.dataRoot.trim().length > 0
      ) {
        return path.resolve(parsed.dataRoot);
      }
    } catch {
      // Ignore invalid local runtime preference files and continue to defaults.
    }
  }

  // Inside the private monorepo, prefer the tracked shared Forge data root so
  // the local app, Hermes, OpenClaw, and repo-managed data all point at the
  // same state by default.
  if (monorepoForgeDataRoot && existsSync(monorepoForgeDataRoot)) {
    return monorepoForgeDataRoot;
  }

  return path.resolve(userSharedForgeDataRoot || currentWorkingDir);
}

let dataRoot = resolveDefaultDataRoot();
let seedDemoDataEnabled = false;
let legacyWikiAutoImportEnabled = true;

let db: DatabaseSync | null = null;
let transactionDepth = 0;
let savepointCounter = 0;

function getDataDir(): string {
  const databasePath = resolveDatabasePathForDataRoot();
  if (databasePath === resolveCanonicalDatabasePath()) {
    return resolveCanonicalDataDir();
  }
  if (databasePath === resolveLegacyDatabasePath()) {
    return resolveLegacyDataDir();
  }
  if (hasCanonicalRuntimeLayout()) {
    return resolveCanonicalDataDir();
  }
  if (hasLegacyRuntimeLayout()) {
    return resolveLegacyDataDir();
  }
  return resolveCanonicalDataDir();
}

export function resolveDataDir(): string {
  return getDataDir();
}

export function getEffectiveDataRoot(): string {
  return dataRoot;
}

function getDatabasePath(): string {
  return resolveDatabasePathForDataRoot();
}

export function getDatabase(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(getDatabasePath());
    db.function("forge_nfkc_lower", { deterministic: true }, (value: unknown) =>
      String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
    );
    db.function("forge_tag_key", { deterministic: true }, (value: unknown) =>
      String(value ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/gu, " ")
        .toLowerCase()
    );
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA synchronous = FULL;");
    db.prepare("PRAGMA journal_mode = WAL;").get();
  }
  return db;
}

export function runInTransaction<T>(operation: () => T): T {
  const database = getDatabase();
  const isNested = transactionDepth > 0;
  const savepointName = isNested ? `forge_sp_${++savepointCounter}` : null;
  if (isNested) {
    database.exec(`SAVEPOINT ${savepointName}`);
  } else {
    database.exec("BEGIN IMMEDIATE");
  }
  transactionDepth += 1;
  try {
    const result = operation();
    if (isNested) {
      database.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } else {
      database.exec("COMMIT");
    }
    return result;
  } catch (error) {
    if (isNested) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      database.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } else {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    transactionDepth = Math.max(0, transactionDepth - 1);
  }
}

export function configureDatabase(
  options: { dataRoot?: string; seedDemoData?: boolean } = {}
): void {
  if (options.dataRoot) {
    dataRoot = path.resolve(options.dataRoot);
    closeDatabase();
  }
  if (typeof options.seedDemoData === "boolean") {
    seedDemoDataEnabled = options.seedDemoData;
  }
}

export function configureLegacyWikiAutoImport(enabled: boolean): void {
  legacyWikiAutoImportEnabled = enabled;
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

function countRows(tableName: string): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
    .get() as {
    count: number;
  };
  return row.count;
}

function seedData(): void {
  if (countRows("goals") > 0) {
    return;
  }

  const database = getDatabase();
  const now = nowIso();
  const insertGoal = database.prepare(`
    INSERT INTO goals (id, title, description, horizon, status, target_points, theme_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = database.prepare(`
    INSERT INTO tags (id, name, kind, color, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertGoalTag = database.prepare(`
    INSERT INTO goal_tags (goal_id, tag_id)
    VALUES (?, ?)
  `);
  const insertProject = database.prepare(`
    INSERT INTO projects (id, goal_id, title, description, status, theme_color, target_points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = database.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points, sort_order, completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTaskTag = database.prepare(`
    INSERT INTO task_tags (task_id, tag_id)
    VALUES (?, ?)
  `);

  const goals = [
    {
      id: "goal_be_a_good_person",
      title: "Be a good person",
      description:
        "Live in a way that is kind, honest, and helpful to other people.",
      horizon: "lifetime",
      status: "active",
      targetPoints: 1000,
      themeColor: "#f5efe6"
    },
    {
      id: "goal_build_forge",
      title: "Build Forge into a premium operating system",
      description:
        "Turn Forge into a sharp, trustworthy life system with strong daily execution.",
      horizon: "year",
      status: "active",
      targetPoints: 720,
      themeColor: "#9dc4ff"
    },
    {
      id: "goal_train_body",
      title: "Train with consistency",
      description:
        "Keep health, training, and recovery visible in the weekly operating rhythm.",
      horizon: "quarter",
      status: "active",
      targetPoints: 360,
      themeColor: "#f4b97a"
    }
  ];

  for (const goal of goals) {
    insertGoal.run(
      goal.id,
      goal.title,
      goal.description,
      goal.horizon,
      goal.status,
      goal.targetPoints,
      goal.themeColor,
      now,
      now
    );
  }

  const tags = [
    [
      "tag_vitality",
      "Vitality",
      "value",
      "#f59e0b",
      "Health, training, and physical energy."
    ],
    [
      "tag_deep_work",
      "Deep Work",
      "execution",
      "#8b5cf6",
      "Protected focus and cognitively demanding work."
    ],
    [
      "tag_relationships",
      "Relationships",
      "value",
      "#ef4444",
      "Important human connection and maintenance."
    ],
    [
      "tag_systems",
      "Systems",
      "category",
      "#14b8a6",
      "Operational scaffolding, review, and maintenance."
    ],
    [
      "tag_craft",
      "Craft",
      "category",
      "#60a5fa",
      "Making the product sharper and more intentional."
    ],
    [
      "tag_recovery",
      "Recovery",
      "execution",
      "#22c55e",
      "Recovery, decompression, and reset work."
    ]
  ] as const;

  for (const [id, name, kind, color, description] of tags) {
    insertTag.run(id, name, kind, color, description, now);
  }

  insertGoalTag.run("goal_be_a_good_person", "tag_relationships");
  insertGoalTag.run("goal_build_forge", "tag_craft");
  insertGoalTag.run("goal_build_forge", "tag_systems");
  insertGoalTag.run("goal_train_body", "tag_vitality");
  insertGoalTag.run("goal_train_body", "tag_recovery");

  insertProject.run(
    "project_relationships_ritual",
    "goal_be_a_good_person",
    "Keep the relationship ritual visible",
    "Protect simple weekly actions that maintain important relationships and personal integrity.",
    "active",
    "#fb7185",
    90,
    now,
    now
  );
  insertProject.run(
    "project_forge_mobile",
    "goal_build_forge",
    "Ship the Forge flagship workflow",
    "Tighten the main execution loop, Kanban, and OpenClaw collaboration surface.",
    "active",
    "#7dd3fc",
    240,
    now,
    now
  );
  insertProject.run(
    "project_strength_cycle",
    "goal_train_body",
    "Run the current strength cycle",
    "Keep the training block visible with recovery and progression.",
    "active",
    "#f59e0b",
    120,
    now,
    now
  );

  const tasks = [
    {
      id: "task_flagship_review",
      title: "Review the Forge flagship flow",
      description:
        "Walk Overview, Today, Kanban, and Psyche to identify friction before the next pass.",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalId: "goal_build_forge",
      projectId: "project_forge_mobile",
      dueDate: dateOffsetIso(1),
      effort: "deep",
      energy: "high",
      points: 55,
      sortOrder: 100,
      completedAt: null
    },
    {
      id: "task_plugin_surface",
      title: "Slim the OpenClaw plugin surface",
      description:
        "Keep the plugin focused on overview, batch entities, insights, and UI entry.",
      status: "in_progress",
      priority: "high",
      owner: "Albert",
      goalId: "goal_build_forge",
      projectId: "project_forge_mobile",
      dueDate: dateOffsetIso(0),
      effort: "deep",
      energy: "high",
      points: 34,
      sortOrder: 200,
      completedAt: null
    },
    {
      id: "task_weekly_review",
      title: "Prepare the weekly review ritual",
      description:
        "Make sure the review captures drift, signals, and visible wins.",
      status: "backlog",
      priority: "medium",
      owner: "Albert",
      goalId: "goal_be_a_good_person",
      projectId: "project_relationships_ritual",
      dueDate: dateOffsetIso(3),
      effort: "deep",
      energy: "steady",
      points: 21,
      sortOrder: 300,
      completedAt: null
    },
    {
      id: "task_strength_session",
      title: "Complete the lower-body strength session",
      description: "Keep the training cycle alive with one deliberate session.",
      status: "blocked",
      priority: "medium",
      owner: "Albert",
      goalId: "goal_train_body",
      projectId: "project_strength_cycle",
      dueDate: dateOffsetIso(-1),
      effort: "deep",
      energy: "steady",
      points: 18,
      sortOrder: 400,
      completedAt: null
    },
    {
      id: "task_recovery_walk",
      title: "Take the recovery walk",
      description: "Short reset to keep energy stable after the work block.",
      status: "done",
      priority: "low",
      owner: "Albert",
      goalId: "goal_train_body",
      projectId: "project_strength_cycle",
      dueDate: dateOffsetIso(-2),
      effort: "light",
      energy: "low",
      points: 60,
      sortOrder: 500,
      completedAt: now
    }
  ];

  for (const task of tasks) {
    insertTask.run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.owner,
      task.goalId,
      task.projectId,
      task.dueDate,
      task.effort,
      task.energy,
      task.points,
      task.sortOrder,
      task.completedAt,
      now,
      now
    );
  }

  const taskTags = [
    ["task_flagship_review", "tag_deep_work"],
    ["task_flagship_review", "tag_craft"],
    ["task_plugin_surface", "tag_systems"],
    ["task_plugin_surface", "tag_craft"],
    ["task_weekly_review", "tag_relationships"],
    ["task_strength_session", "tag_vitality"],
    ["task_recovery_walk", "tag_recovery"]
  ] as const;

  for (const [taskId, tagId] of taskTags) {
    insertTaskTag.run(taskId, tagId);
  }
}

export async function initializeDatabase(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
  const database = getDatabase();
  const migrationFiles = await listMigrationFiles();
  const pendingMigrations: string[] = [];

  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database
    .prepare("SELECT id FROM migrations ORDER BY id")
    .all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }
    pendingMigrations.push(file);
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const requiresForeignKeysDisabled =
      file === WORK_OPPORTUNITY_SCHEMA_COMPATIBILITY_MIGRATION;
    if (requiresForeignKeysDisabled) {
      database.exec("PRAGMA foreign_keys = OFF");
    }
    let migrationFailed = false;
    let migrationFailure: unknown;
    try {
      database.exec("BEGIN");
      try {
        if (file === PEOPLE_LEGACY_SCHEMA_REPAIR_MIGRATION) {
          await repairLegacyPeopleSchema(database);
        }
        if (file === PEER_QUERY_AUDIT_COMPATIBILITY_MIGRATION) {
          prepareLegacyPeerQueryAuditMigration(database);
        }
        if (file === WORK_OPPORTUNITY_SCHEMA_COMPATIBILITY_MIGRATION) {
          await prepareWorkOpportunitySchemaCompatibilityMigration(database);
        }
        database.exec(sql);
        if (file === SECURITY_PAIRING_METADATA_COMPATIBILITY_MIGRATION) {
          backfillLegacyPairingClientMetadata(database);
        }
        if (file === COURSE_DEFINITION_INTEGRITY_MIGRATION) {
          backfillCourseDefinitionIntegrity(database);
        }
        if (requiresForeignKeysDisabled) {
          assertNoForeignKeyViolations(database, file);
        }
        database
          .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
          .run(file, nowIso());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      migrationFailed = true;
      migrationFailure = error;
    }

    let foreignKeyRestoreFailed = false;
    let foreignKeyRestoreFailure: unknown;
    if (requiresForeignKeysDisabled) {
      try {
        database.exec("PRAGMA foreign_keys = ON");
        const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as {
          foreign_keys: number;
        };
        if (foreignKeys.foreign_keys !== 1) {
          throw new Error(
            `${file} could not restore SQLite foreign-key enforcement.`
          );
        }
      } catch (error) {
        foreignKeyRestoreFailed = true;
        foreignKeyRestoreFailure = error;
      }
    }
    if (migrationFailed && foreignKeyRestoreFailed) {
      throw new AggregateError(
        [migrationFailure, foreignKeyRestoreFailure],
        `${file} failed and SQLite foreign-key enforcement could not be restored.`
      );
    }
    if (migrationFailed) throw migrationFailure;
    if (foreignKeyRestoreFailed) throw foreignKeyRestoreFailure;
  }

  logForgeDebug(
    `[forge-db] initialized database path=${getDatabasePath()} applied_count=${appliedRows.length} pending_applied=${pendingMigrations.length} pending_list=${pendingMigrations.join(",") || "none"}`
  );

  if (seedDemoDataEnabled) {
    seedData();
  }

  ensureQuestionnaireSeeds();
  if (legacyWikiAutoImportEnabled) {
    const { importLegacyWikiMarkdownOnStartup } =
      await import("./services/legacy-wiki-markdown-import.js");
    const legacyWikiImport =
      await importLegacyWikiMarkdownOnStartup(getDataDir());
    if (legacyWikiImport.scanned > 0) {
      logForgeDebug(
        `[forge-db] imported legacy wiki markdown scanned=${legacyWikiImport.scanned} inserted=${legacyWikiImport.inserted} updated=${legacyWikiImport.updated} backed_up=${legacyWikiImport.backedUp} backup_path=${legacyWikiImport.backupPath}`
      );
    }
  }
}

export function configureDatabaseSeeding(enabled: boolean): void {
  seedDemoDataEnabled = enabled;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
