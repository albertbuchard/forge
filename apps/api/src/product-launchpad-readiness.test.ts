import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("Launchpad reaches a first result, imports with receipts and rollback, and keeps feedback local and optional", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-launchpad-ready-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const cookie = issueTestOperatorSessionCookie(app);
  const ownerUserId = "user_operator";

  try {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/launchpad/packages"
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const packagesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/launchpad/packages",
      headers: { cookie }
    });
    assert.equal(packagesResponse.statusCode, 200, packagesResponse.body);
    const packages = (packagesResponse.json() as {
      packages: Array<{ id: string; manifestSha256: string; kind: string }>;
    }).packages;
    assert.equal(packages.filter((entry) => entry.kind === "starter_pack").length, 3);
    assert.ok(packages.some((entry) => entry.id === "integration.notion"));
    const starter = packages.find((entry) => entry.id === "starter.plan-week");
    assert.ok(starter);

    const onboarding = await app.inject({
      method: "PUT",
      url: "/api/v1/launchpad/onboarding",
      headers: { cookie },
      payload: {
        ownerUserId,
        outcomeKey: "plan_week",
        currentStep: "review_pack",
        status: "in_progress"
      }
    });
    assert.equal(onboarding.statusCode, 200, onboarding.body);

    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/packages/preview",
      headers: { cookie },
      payload: { ownerUserId, packageId: starter.id }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(
      (preview.json() as { preview: { canInstall: boolean; changes: unknown[] } })
        .preview.canInstall,
      true
    );

    const installPayload = {
      ownerUserId,
      packageId: starter.id,
      manifestSha256: starter.manifestSha256,
      idempotencyKey: "starter-plan-week-stable-key"
    };
    const installed = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/packages/install",
      headers: { cookie },
      payload: installPayload
    });
    assert.equal(installed.statusCode, 201, installed.body);
    const install = (installed.json() as {
      install: { installId: string; createdEntities: Array<{ href: string }>; replayed: boolean };
    }).install;
    assert.equal(install.createdEntities.length, 4);
    assert.equal(install.replayed, false);

    const installReplay = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/packages/install",
      headers: { cookie },
      payload: installPayload
    });
    assert.equal(installReplay.statusCode, 200, installReplay.body);
    assert.equal(installReplay.headers["idempotency-replayed"], "true");

    const duplicatePreview = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/imports/preview",
      headers: { cookie },
      payload: {
        ownerUserId,
        sourceKind: "todoist",
        sourceLabel: "todoist-export.json",
        items: [
          {
            sourceId: "duplicate-task",
            recordType: "task",
            title: "Choose the week's most important result",
            content: "Duplicate import candidate",
            status: "open",
            dueAt: null,
            sourceUrl: null,
            metadata: {}
          }
        ]
      }
    });
    assert.equal(duplicatePreview.statusCode, 200, duplicatePreview.body);
    assert.equal(
      (duplicatePreview.json() as { preview: { counts: { conflicts: number } } })
        .preview.counts.conflicts,
      1
    );
    const reviews = await app.inject({
      method: "GET",
      url: `/api/v1/launchpad/reviews?ownerUserId=${ownerUserId}`,
      headers: { cookie }
    });
    assert.equal(reviews.statusCode, 200, reviews.body);
    const importConflict = (reviews.json() as {
      items: Array<{ id: string; kind: string; revision: number }>;
    }).items.find((entry) => entry.kind === "import_conflict");
    assert.ok(importConflict);
    const unsafeAccept = await app.inject({
      method: "POST",
      url: `/api/v1/launchpad/reviews/${encodeURIComponent(importConflict.id)}/decision`,
      headers: { cookie },
      payload: {
        ownerUserId,
        expectedRevision: importConflict.revision,
        decision: "accept"
      }
    });
    assert.equal(unsafeAccept.statusCode, 409, unsafeAccept.body);

    const importPreviewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/imports/preview",
      headers: { cookie },
      payload: {
        ownerUserId,
        sourceKind: "notion",
        sourceLabel: "notion-export.json",
        items: [
          {
            sourceId: "page-1",
            recordType: "note",
            title: "Imported product decision",
            content: "The accepted decision and source evidence.",
            status: null,
            dueAt: null,
            sourceUrl: "https://example.com/page-1",
            metadata: { workspace: "example" }
          }
        ]
      }
    });
    assert.equal(importPreviewResponse.statusCode, 200, importPreviewResponse.body);
    const importPreview = (importPreviewResponse.json() as {
      preview: { previewId: string; payloadFingerprint: string };
    }).preview;
    const importPayload = {
      ownerUserId,
      previewId: importPreview.previewId,
      payloadFingerprint: importPreview.payloadFingerprint,
      idempotencyKey: "notion-import-stable-key",
      decisions: [{ sourceId: "page-1", action: "create" }]
    };
    const committed = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/imports/commit",
      headers: { cookie },
      payload: importPayload
    });
    assert.equal(committed.statusCode, 201, committed.body);
    assert.equal(
      (committed.json() as { import: { created: unknown[] } }).import.created.length,
      1
    );

    const importsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/launchpad/imports?ownerUserId=${ownerUserId}`,
      headers: { cookie }
    });
    assert.equal(importsResponse.statusCode, 200, importsResponse.body);
    const importRun = (importsResponse.json() as {
      imports: Array<{ id: string; status: string; created: unknown[] }>;
    }).imports.find((entry) => entry.id === importPreview.previewId);
    assert.equal(importRun?.status, "committed");
    assert.equal(importRun?.created.length, 1);

    const rollback = await app.inject({
      method: "POST",
      url: `/api/v1/launchpad/imports/${encodeURIComponent(importPreview.previewId)}/rollback`,
      headers: { cookie },
      payload: { ownerUserId, expectedStatus: "committed" }
    });
    assert.equal(rollback.statusCode, 200, rollback.body);
    assert.equal(
      (rollback.json() as { rollback: { status: string } }).rollback.status,
      "rolled_back"
    );

    const feedbackBefore = await app.inject({
      method: "GET",
      url: `/api/v1/launchpad/feedback?ownerUserId=${ownerUserId}`,
      headers: { cookie }
    });
    assert.equal(feedbackBefore.statusCode, 200, feedbackBefore.body);
    assert.equal(
      (feedbackBefore.json() as { feedback: { settings: { enabled: boolean }; events: unknown[] } })
        .feedback.settings.enabled,
      false
    );
    const ignoredBeforeConsent = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/feedback/events",
      headers: { cookie },
      payload: {
        ownerUserId,
        eventName: "onboarding_completed",
        outcomeKey: "plan_week",
        surfaceKey: "launchpad",
        success: true,
        durationBucket: "1m_to_5m"
      }
    });
    assert.equal(ignoredBeforeConsent.statusCode, 200, ignoredBeforeConsent.body);
    assert.equal(
      (ignoredBeforeConsent.json() as { recorded: boolean }).recorded,
      false
    );

    const enabled = await app.inject({
      method: "PUT",
      url: "/api/v1/launchpad/feedback",
      headers: { cookie },
      payload: { ownerUserId, enabled: true, consentVersion: "privacy-feedback-v1" }
    });
    assert.equal(enabled.statusCode, 200, enabled.body);
    const recorded = await app.inject({
      method: "POST",
      url: "/api/v1/launchpad/feedback/events",
      headers: { cookie },
      payload: {
        ownerUserId,
        eventName: "onboarding_completed",
        outcomeKey: "plan_week",
        surfaceKey: "launchpad",
        success: true,
        durationBucket: "1m_to_5m"
      }
    });
    assert.equal(recorded.statusCode, 200, recorded.body);

    const removed = await app.inject({
      method: "POST",
      url: `/api/v1/launchpad/package-installs/${encodeURIComponent(install.installId)}/remove`,
      headers: { cookie },
      payload: { ownerUserId, expectedStatus: "installed" }
    });
    assert.equal(removed.statusCode, 200, removed.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
