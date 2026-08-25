import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migration137 = "137_trusted_browser_credentials.sql";
const migration138 = "138_work_and_opportunity_management.sql";
const migration139 = "139_work_opportunity_schema_compatibility.sql";
const now = "2026-08-25T08:00:00.000Z";
const later = "2026-08-25T09:00:00.000Z";

function openDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.function(
    "forge_nfkc_lower",
    { deterministic: true },
    (value: unknown) =>
      String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
  );
  database.function(
    "forge_tag_key",
    { deterministic: true },
    (value: unknown) =>
      String(value ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/gu, " ")
        .toLowerCase()
  );
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function replaceRequired(
  source: string,
  before: string,
  after: string
): string {
  const first = source.indexOf(before);
  assert.notEqual(
    first,
    -1,
    `Expected the canonical schema to contain ${before}`
  );
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `Expected a unique schema fragment for ${before}`
  );
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRequiredInTable(
  source: string,
  table: string,
  before: string,
  after: string
): string {
  const marker = `CREATE TABLE ${table} (`;
  const start = source.indexOf(marker);
  const endMarker = "\n) STRICT;";
  const end = start < 0 ? -1 : source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Expected table ${table}`);
  assert.notEqual(end, -1, `Expected the end of table ${table}`);
  const tableEnd = end + endMarker.length;
  const tableSchema = source.slice(start, tableEnd);
  const updated = replaceRequired(tableSchema, before, after);
  return source.slice(0, start) + updated + source.slice(tableEnd);
}

function buildObservedEarly138Schema(canonical: string): string {
  let schema = canonical;
  const replacements = [
    [
      "  current_criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL,",
      "  current_criteria_version_id TEXT,"
    ],
    [
      "  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id),\n  evaluation_version INTEGER NOT NULL CHECK (evaluation_version >= 1),",
      "  criteria_version_id TEXT NOT NULL REFERENCES campaign_criteria_versions(id),\n  evaluation_version INTEGER NOT NULL CHECK (evaluation_version >= 1),"
    ],
    [
      "  preferred_default_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,\n",
      ""
    ],
    [
      "  confidentiality TEXT NOT NULL DEFAULT 'private' CHECK (confidentiality IN ('private', 'restricted', 'shareable')),\n  retention_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(retention_policy_json) AND json_type(retention_policy_json) = 'object'),\n  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),\n  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),\n  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),\n",
      ""
    ],
    [
      "  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),\n  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),\n  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),\n  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  import_receipt_id TEXT\n) STRICT;\n\nCREATE TABLE job_applications",
      "  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  import_receipt_id TEXT\n) STRICT;\n\nCREATE TABLE job_applications"
    ],
    [
      "  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id),\n  candidate_user_id TEXT NOT NULL REFERENCES users(id),",
      "  candidate_user_id TEXT NOT NULL REFERENCES users(id),"
    ],
    [
      "  reapplication_of_application_id TEXT REFERENCES job_applications(id) ON DELETE SET NULL,\n  reapplication_reason TEXT NOT NULL DEFAULT '',\n  reapplication_reviewed_at TEXT,\n",
      ""
    ],
    [
      "  import_receipt_id TEXT,\n  CHECK (deleted_at IS NOT NULL OR criteria_version_id IS NOT NULL)\n) STRICT;\n\nCREATE INDEX idx_job_applications_owner_status",
      "  import_receipt_id TEXT\n) STRICT;\n\nCREATE INDEX idx_job_applications_owner_status"
    ],
    [
      "-- Immutable snapshots for revisioned supporting records. Specialized domain\n-- histories (such as job_offer_revisions) remain authoritative for their\n-- structured semantics; this table preserves every accepted supporting-data\n-- mutation for audit and conflict reconstruction.\nCREATE TABLE work_supporting_revisions (\n  id TEXT PRIMARY KEY,\n  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  record_kind TEXT NOT NULL,\n  record_id TEXT NOT NULL,\n  version INTEGER NOT NULL CHECK (version >= 1),\n  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'object'),\n  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),\n  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),\n  created_at TEXT NOT NULL,\n  import_receipt_id TEXT,\n  UNIQUE (record_kind, record_id, version)\n) STRICT;\n\nCREATE INDEX idx_work_supporting_revisions_record\n  ON work_supporting_revisions (record_kind, record_id, version DESC);\n\n",
      ""
    ],
    [
      "  guard_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(guard_context_json) AND json_type(guard_context_json) = 'object'),\n",
      ""
    ]
  ] as const;
  for (const [before, after] of replacements) {
    schema = replaceRequired(schema, before, after);
  }
  schema = replaceRequiredInTable(
    schema,
    "job_offers",
    "  negotiation_asks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negotiation_asks_json) AND json_type(negotiation_asks_json) = 'array'),\n  response TEXT NOT NULL DEFAULT '',\n  artifact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_ids_json) AND json_type(artifact_ids_json) = 'array'),\n  expires_at TEXT,",
    "  expires_at TEXT,"
  );
  schema = replaceRequiredInTable(
    schema,
    "job_offer_revisions",
    "  status TEXT NOT NULL CHECK (status IN ('expected', 'received', 'negotiating', 'revised', 'accepted', 'declined', 'expired', 'withdrawn')),\n",
    ""
  );
  schema = replaceRequiredInTable(
    schema,
    "job_offer_revisions",
    "  contingencies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contingencies_json) AND json_type(contingencies_json) = 'array'),\n",
    ""
  );
  schema = replaceRequiredInTable(
    schema,
    "job_offer_revisions",
    "  expires_at TEXT,\n  decision TEXT NOT NULL DEFAULT '',\n  rationale TEXT NOT NULL DEFAULT '',\n  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL,\n  planned_engagement_id TEXT REFERENCES work_engagements(id) ON DELETE SET NULL,\n  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),",
    "  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),"
  );
  return schema;
}

async function applyMigrationsThrough137(
  database: DatabaseSync
): Promise<void> {
  database.exec(`
    CREATE TABLE migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file <= migration137)
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function applyObservedEarly138(database: DatabaseSync): Promise<void> {
  const canonical = await readFile(
    path.join(migrationsDir, migration138),
    "utf8"
  );
  database.exec(buildObservedEarly138Schema(canonical));
  database
    .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
    .run(migration138, now);
}

function seedLegacyWorkGraph(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES ('user_work_139', 'human', 'work-139', 'Work 139', '', '#123456', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO work_organizations (
         id, owner_user_id, name, normalized_name, created_at, updated_at
       ) VALUES ('org_work_139', 'user_work_139', 'Example organization', 'example organization', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO work_engagements (
         id, owner_user_id, organization_id, title, status, created_at, updated_at
       ) VALUES ('engagement_work_139', 'user_work_139', 'org_work_139', 'Planned role', 'planned', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO opportunity_campaigns (
         id, owner_user_id, source_engagement_id, title, status,
         current_criteria_version_id, created_at, updated_at
       ) VALUES (
         'campaign_work_139', 'user_work_139', 'engagement_work_139',
         'Representative campaign', 'active', 'criteria_work_139', ?, ?
       )`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO campaign_criteria_versions (
         id, campaign_id, version, criteria_json, effective_at, created_at
       ) VALUES ('criteria_work_139', 'campaign_work_139', 1, '{}', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO job_opportunities (
         id, owner_user_id, organization_id, dedupe_key, title,
         first_seen_at, created_at, updated_at
       ) VALUES (
         'opportunity_work_139', 'user_work_139', 'org_work_139',
         'example-role', 'Example role', ?, ?, ?
       )`
    )
    .run(now, now, now);
  database
    .prepare(
      `INSERT INTO campaign_opportunity_evaluations (
         id, campaign_id, opportunity_id, criteria_version_id,
         evaluation_version, evaluated_at, evaluator_json, created_at
       ) VALUES (
         'evaluation_work_139', 'campaign_work_139', 'opportunity_work_139',
         'criteria_work_139', 1, ?, '{}', ?
       )`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO candidate_positioning_profiles (
         id, owner_user_id, title, created_at, updated_at
       ) VALUES ('profile_work_139', 'user_work_139', 'Research profile', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO candidate_document_sets (
         id, owner_user_id, profile_id, title, created_at, updated_at
       ) VALUES (
         'documents_work_139', 'user_work_139', 'profile_work_139',
         'Research documents', ?, ?
       )`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO application_response_templates (
         id, owner_user_id, exact_question, normalized_category, answer,
         created_at, updated_at
       ) VALUES (
         'response_work_139', 'user_work_139', 'Why this role?', 'motivation',
         'Evidence-based answer', ?, ?
       )`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO job_applications (
         id, owner_user_id, opportunity_id, primary_campaign_id,
         candidate_user_id, positioning_profile_id, document_set_id,
         status, created_at, updated_at
       ) VALUES (
         'application_work_139', 'user_work_139', 'opportunity_work_139',
         'campaign_work_139', 'user_work_139', 'profile_work_139',
         'documents_work_139', 'preparing', ?, ?
       )`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO job_offers (
         id, application_id, status, contingencies_json, expires_at,
         decision, rationale, criteria_version_id, planned_engagement_id,
         created_at, updated_at
       ) VALUES (
         'offer_work_139', 'application_work_139', 'negotiating', '["review"]', ?,
         'pending', 'Compare against the campaign', 'criteria_work_139',
         'engagement_work_139', ?, ?
       )`
    )
    .run(later, now, now);
  database
    .prepare(
      `INSERT INTO job_offer_revisions (
         id, offer_id, version, terms_json, negotiation_asks_json,
         response, artifact_ids_json, created_at
       ) VALUES (
         'offer_revision_work_139', 'offer_work_139', 1, '{}', '["title"]',
         'Pending', '[]', ?
       )`
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO application_transmission_previews (
         id, owner_user_id, application_id, destination_json, fields_json,
         preview_digest, expires_at, created_at, updated_at
       ) VALUES (
         'preview_work_139', 'user_work_139', 'application_work_139', '{}', '{}',
         ?, ?, ?, ?
       )`
    )
    .run("a".repeat(64), later, now, now);
}

test("migration 139 upgrades the observed early Work schema atomically and preserves linked rows", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-work-139-"));
  const databasePath = path.join(rootDir, "forge.sqlite");
  let database = openDatabase(databasePath);
  try {
    await applyMigrationsThrough137(database);
    await applyObservedEarly138(database);
    seedLegacyWorkGraph(database);
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'work_supporting_revisions'"
          )
          .get() as { count: number }
      ).count,
      0
    );
    database.close();

    configureLegacyWikiAutoImport(false);
    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    await initializeDatabase();
    database = getDatabase();

    assert.ok(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration139)
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'work_supporting_revisions'"
          )
          .get() as { count: number }
      ).count,
      1
    );

    const application = database
      .prepare(
        `SELECT criteria_version_id, reapplication_reason, provenance_json
         FROM job_applications WHERE id = 'application_work_139'`
      )
      .get() as {
      criteria_version_id: string;
      reapplication_reason: string;
      provenance_json: string;
    };
    assert.equal(application.criteria_version_id, "criteria_work_139");
    assert.equal(application.reapplication_reason, "");
    assert.equal(
      JSON.parse(application.provenance_json).compatibilityMigrations
        .workOpportunity139.basis,
      "campaign_current_or_latest"
    );

    const offerRevision = database
      .prepare(
        `SELECT status, contingencies_json, expires_at, decision, rationale,
                criteria_version_id, planned_engagement_id, provenance_json
         FROM job_offer_revisions WHERE id = 'offer_revision_work_139'`
      )
      .get() as Record<string, string>;
    assert.equal(offerRevision.status, "negotiating");
    assert.equal(offerRevision.contingencies_json, '["review"]');
    assert.equal(offerRevision.expires_at, later);
    assert.equal(offerRevision.decision, "pending");
    assert.equal(offerRevision.criteria_version_id, "criteria_work_139");
    assert.equal(offerRevision.planned_engagement_id, "engagement_work_139");
    assert.equal(
      JSON.parse(offerRevision.provenance_json).compatibilityMigrations
        .workOpportunity139.basis,
      "parent_offer_snapshot"
    );

    const expectedDefaults = [
      ["candidate_document_sets", "confidentiality", "private"],
      ["candidate_document_sets", "retention_policy_json", "{}"],
      ["application_response_templates", "scope_project_ids_json", "[]"],
      ["job_offers", "negotiation_asks_json", "[]"],
      ["application_transmission_previews", "guard_context_json", "{}"]
    ] as const;
    for (const [table, column, expected] of expectedDefaults) {
      const row = database
        .prepare(`SELECT ${column} AS value FROM ${table} LIMIT 1`)
        .get() as { value: string };
      assert.equal(row.value, expected, `${table}.${column}`);
    }

    const evaluationCriteria = database
      .prepare(
        `SELECT "notnull" AS required
         FROM pragma_table_info('campaign_opportunity_evaluations')
         WHERE name = 'criteria_version_id'`
      )
      .get() as { required: number };
    assert.equal(evaluationCriteria.required, 0);
    const campaignForeignKeys = database
      .prepare(
        `SELECT "table" AS target
         FROM pragma_foreign_key_list('opportunity_campaigns')
         WHERE "from" = 'current_criteria_version_id'`
      )
      .all() as Array<{ target: string }>;
    assert.deepEqual(
      campaignForeignKeys.map((foreignKey) => foreignKey.target),
      ["campaign_criteria_versions"]
    );

    assert.throws(
      () =>
        database.exec(
          "UPDATE job_applications SET criteria_version_id = NULL, revision = revision + 1 WHERE id = 'application_work_139'"
        ),
      /CHECK constraint failed/u
    );
    database.exec(
      "UPDATE job_applications SET deleted_at = updated_at, criteria_version_id = NULL, revision = revision + 1 WHERE id = 'application_work_139'"
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const preservedCounts = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM opportunity_campaigns) AS campaigns,
           (SELECT COUNT(*) FROM campaign_opportunity_evaluations) AS evaluations,
           (SELECT COUNT(*) FROM candidate_positioning_profiles) AS profiles,
           (SELECT COUNT(*) FROM candidate_document_sets) AS document_sets,
           (SELECT COUNT(*) FROM application_response_templates) AS responses,
           (SELECT COUNT(*) FROM job_applications) AS applications,
           (SELECT COUNT(*) FROM job_offers) AS offers,
           (SELECT COUNT(*) FROM job_offer_revisions) AS offer_revisions,
           (SELECT COUNT(*) FROM application_transmission_previews) AS previews`
      )
      .get();
    assert.deepEqual(
      { ...preservedCounts },
      {
        campaigns: 1,
        evaluations: 1,
        profiles: 1,
        document_sets: 1,
        responses: 1,
        applications: 1,
        offers: 1,
        offer_revisions: 1,
        previews: 1
      }
    );

    closeDatabase();
    await initializeDatabase();
    database = getDatabase();
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM migrations WHERE id = ?")
          .get(migration139) as { count: number }
      ).count,
      1
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("migration 139 fails closed and rolls back when an active legacy application has no criteria provenance", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-work-139-unresolved-")
  );
  const databasePath = path.join(rootDir, "forge.sqlite");
  let database = openDatabase(databasePath);
  try {
    await applyMigrationsThrough137(database);
    await applyObservedEarly138(database);
    database
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES (
           'user_work_139_unresolved', 'human', 'work-139-unresolved',
           'Work 139 unresolved', '', '#123456', ?, ?
         )`
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO opportunity_campaigns (
           id, owner_user_id, title, status, created_at, updated_at
         ) VALUES (
           'campaign_work_139_unresolved', 'user_work_139_unresolved',
           'Campaign without criteria', 'active', ?, ?
         )`
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO job_opportunities (
           id, owner_user_id, dedupe_key, title, first_seen_at,
           created_at, updated_at
         ) VALUES (
           'opportunity_work_139_unresolved', 'user_work_139_unresolved',
           'unresolved-role', 'Unresolved role', ?, ?, ?
         )`
      )
      .run(now, now, now);
    database
      .prepare(
        `INSERT INTO job_applications (
           id, owner_user_id, opportunity_id, primary_campaign_id,
           candidate_user_id, status, created_at, updated_at
         ) VALUES (
           'application_work_139_unresolved', 'user_work_139_unresolved',
           'opportunity_work_139_unresolved', 'campaign_work_139_unresolved',
           'user_work_139_unresolved', 'preparing', ?, ?
         )`
      )
      .run(now, now);
    database.close();

    configureLegacyWikiAutoImport(false);
    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    await assert.rejects(
      initializeDatabase(),
      /cannot establish criteria provenance for 1 active job application/u
    );
    database = getDatabase();
    assert.equal(
      (
        database.prepare("PRAGMA foreign_keys").get() as {
          foreign_keys: number;
        }
      ).foreign_keys,
      1
    );
    assert.equal(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration139),
      undefined
    );
    assert.equal(
      database
        .prepare(
          "SELECT 1 FROM pragma_table_info('job_applications') WHERE name = 'criteria_version_id'"
        )
        .get(),
      undefined
    );
    assert.ok(
      database
        .prepare(
          "SELECT 1 FROM job_applications WHERE id = 'application_work_139_unresolved'"
        )
        .get()
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
