import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getDatabase } from "./db.js";
import { withWorkTestServer } from "./work-test-support.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const migrationNames = [
  "138_work_and_opportunity_management.sql",
  "139_work_opportunity_schema_compatibility.sql",
  "140_work_opportunity_history_correction.sql",
  "141_work_scope_relationship_authority.sql"
] as const;

const expectedWorkTables = [
  "application_artifact_uses",
  "application_events",
  "application_questions",
  "application_response_templates",
  "application_transmission_previews",
  "campaign_criteria_versions",
  "campaign_opportunity_evaluations",
  "campaign_organization_targets",
  "campaign_role_targets",
  "candidate_document_sets",
  "candidate_positioning_profiles",
  "job_applications",
  "job_automation_policies",
  "job_interviews",
  "job_offer_revisions",
  "job_offers",
  "job_opportunities",
  "job_opportunity_sources",
  "job_saved_queries",
  "job_search_run_items",
  "job_search_runs",
  "job_search_sources",
  "opportunity_campaigns",
  "work_check_ins",
  "work_engagement_events",
  "work_engagements",
  "work_metric_definitions",
  "work_metric_observations",
  "work_operation_receipts",
  "work_organizations",
  "work_outreach",
  "work_settings",
  "work_supporting_revisions"
].sort();

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

test("migration 138 creates the complete relational Work ontology without foreign-key violations", async () => {
  await withWorkTestServer("migration-readiness", async () => {
    const tables = (
      getDatabase()
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND (
             name LIKE 'work_%' OR name LIKE 'job_%' OR
             name LIKE 'campaign_%' OR name LIKE 'candidate_%' OR
             name LIKE 'application_%' OR name = 'opportunity_campaigns'
           )
           ORDER BY name`
        )
        .all() as Array<{ name: string }>
    )
      .map((entry) => entry.name)
      .filter((name) => expectedWorkTables.includes(name));
    assert.deepEqual(tables, expectedWorkTables);

    const foreignKeyFailures = getDatabase()
      .prepare("PRAGMA foreign_key_check")
      .all();
    assert.deepEqual(foreignKeyFailures, []);

    const applicationForeignKeys = getDatabase()
      .prepare("PRAGMA foreign_key_list(job_applications)")
      .all() as Array<{ table: string; from: string; to: string }>;
    assert.ok(
      applicationForeignKeys.some(
        (entry) =>
          entry.table === "job_opportunities" &&
          entry.from === "opportunity_id" &&
          entry.to === "id"
      )
    );
    assert.ok(
      applicationForeignKeys.some(
        (entry) =>
          entry.table === "opportunity_campaigns" &&
          entry.from === "primary_campaign_id" &&
          entry.to === "id"
      )
    );
  });
});

test("Work migrations are byte-identical across every installable runtime surface", () => {
  const destinations = [
    "plugins/openclaw/server/migrations",
    "plugins/openclaw/dist/server/apps/api/migrations",
    "plugins/codex/runtime/server/migrations",
    "plugins/codex/runtime/dist/server/apps/api/migrations",
    "plugins/hermes/forge_hermes/runtime/apps/api/migrations",
    "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/migrations"
  ];
  for (const migrationName of migrationNames) {
    const sourcePath = path.join(
      repoRoot,
      "apps/api/migrations",
      migrationName
    );
    const source = readFileSync(sourcePath);
    for (const destination of destinations) {
      const copy = path.join(repoRoot, destination, migrationName);
      assert.equal(
        existsSync(copy),
        true,
        `${destination} is missing ${migrationName}`
      );
      assert.deepEqual(
        readFileSync(copy),
        source,
        `${destination}/${migrationName}`
      );
    }
  }
});

test("published plugin OpenAPI copies include the full Work route family", () => {
  const paths = [
    "plugins/openclaw/docs/openapi.json",
    "plugins/openclaw/docs/api/openapi.json"
  ];
  for (const relativePath of paths) {
    const document = JSON.parse(
      readFileSync(path.join(repoRoot, relativePath), "utf8")
    ) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    const workPaths = Object.keys(document.paths ?? {}).filter(
      (entry) => entry === "/api/v1/work" || entry.startsWith("/api/v1/work/")
    );
    assert.ok(
      workPaths.length >= 37,
      `${relativePath} contains ${workPaths.length} Work paths`
    );
    for (const required of [
      "/api/v1/work/context",
      "/api/v1/work/check-ins",
      "/api/v1/work/campaigns",
      "/api/v1/work/opportunities/upsert",
      "/api/v1/work/applications/{id}/transitions",
      "/api/v1/work/transmissions/verified-submissions"
    ]) {
      assert.ok(
        document.paths?.[required],
        `${relativePath} is missing ${required}`
      );
    }
    assert.ok(document.components?.schemas?.WorkContext);
    assert.ok(document.components?.schemas?.WorkImportManifest);
  }
});

test("handwritten Work modules stay bounded and public production sources contain no personal planning leakage", () => {
  const moduleRoots = [
    path.join(repoRoot, "apps/api/src/work"),
    path.join(repoRoot, "apps/web/src/components/work"),
    path.join(repoRoot, "apps/web/src/pages")
  ];
  const modules = moduleRoots.flatMap(filesBelow).filter((file) => {
    const name = path.basename(file);
    return (
      /\.(ts|tsx)$/u.test(file) &&
      !/\.test\.(ts|tsx)$/u.test(file) &&
      (file.includes(`${path.sep}work${path.sep}`) || name.startsWith("work-"))
    );
  });
  assert.ok(modules.length >= 35);
  for (const file of modules) {
    const nonblank = readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0).length;
    assert.ok(
      nonblank <= 1_200,
      `${path.relative(repoRoot, file)} has ${nonblank} nonblank lines`
    );
  }

  const publicProductionPaths = [
    ...modules,
    ...filesBelow(path.join(repoRoot, "apps/api/src")).filter((file) =>
      /^work-openapi.*\.ts$/u.test(path.basename(file))
    ),
    ...migrationNames.map((migrationName) =>
      path.join(repoRoot, "apps/api/migrations", migrationName)
    ),
    path.join(repoRoot, "scripts/database/import-work-data.mjs")
  ];
  const prohibited = [
    /\/Users\//u,
    /omarclaw/iu,
    /\bAlbert\b/u,
    /GPT Pro/iu,
    /source_thread_id/iu,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu
  ];
  for (const file of publicProductionPaths) {
    assert.equal(statSync(file).isFile(), true);
    const source = readFileSync(file, "utf8");
    for (const pattern of prohibited) {
      assert.doesNotMatch(source, pattern, path.relative(repoRoot, file));
    }
  }
});
