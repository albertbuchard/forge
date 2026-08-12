import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, resolveDataDir } from "./db.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

const operatorCookie = issueTestOperatorSessionCookie;

async function uploadTicket(app: TestApp, cookie: string, content: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: { cookie },
    payload: {
      title: "Generic ticket fixture",
      originalFileName: "ticket.txt",
      declaredMimeType: "text/plain",
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { artifact: { id: string } }).artifact.id;
}

test("ticket import derives only from verified active Artifact content", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-ticket-security-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = await operatorCookie(app);
    const artifactId = await uploadTicket(
      app,
      cookie,
      "Flight LX638 ZRH CDG 2026-08-01 07:30 09:10"
    );
    const importResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie },
      payload: { artifactId, createDraft: false }
    });
    assert.equal(importResponse.statusCode, 200, importResponse.body);
    const draft = (
      importResponse.json() as {
        draft: {
          title: string;
          originLabel: string;
          destinationLabel: string;
          extractionSummary: { flightNumber: string };
        };
      }
    ).draft;
    assert.equal(draft.title, "Flight LX638");
    assert.equal(draft.originLabel, "ZRH");
    assert.equal(draft.destinationLabel, "CDG");
    assert.equal(draft.extractionSummary.flightNumber, "LX638");

    for (const artifactState of [
      "blocked",
      "quarantined",
      "archived",
      "metadata_only"
    ]) {
      getDatabase()
        .prepare("UPDATE artifacts SET artifact_state = ? WHERE id = ?")
        .run(artifactState, artifactId);
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/life-events/import-ticket",
        headers: { cookie },
        payload: { artifactId, createDraft: false }
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(
        (response.json() as { code: string }).code,
        "artifact_ticket_import_untrusted"
      );
    }

    getDatabase()
      .prepare("UPDATE artifacts SET artifact_state = 'active' WHERE id = ?")
      .run(artifactId);
    const storage = getDatabase()
      .prepare("SELECT storage_path FROM artifacts WHERE id = ?")
      .get(artifactId) as { storage_path: string };
    assert.ok(storage.storage_path.startsWith(resolveDataDir()));
    await writeFile(storage.storage_path, Buffer.from("corrupt", "utf8"));
    const integrityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie },
      payload: { artifactId, createDraft: false }
    });
    assert.equal(integrityResponse.statusCode, 409, integrityResponse.body);
    assert.equal(
      (integrityResponse.json() as { code: string }).code,
      "artifact_blob_integrity_mismatch"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("ticket preview is stable and confirmation is duplicate-safe without calendar projection", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-ticket-review-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = await operatorCookie(app);
    const artifactId = await uploadTicket(
      app,
      cookie,
      "Booking confirmation with incomplete travel details"
    );
    const artifact = getDatabase()
      .prepare("SELECT created_at FROM artifacts WHERE id = ?")
      .get(artifactId) as { created_at: string };
    const lifeEventCountBefore = (
      getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM life_events")
        .get() as { count: number }
    ).count;
    const calendarEventCountBefore = (
      getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM forge_events")
        .get() as { count: number }
    ).count;

    type PreviewBody = {
      action: string;
      lifeEvent: null;
      previewFingerprint: string;
      draft: {
        startsAt: string;
        endsAt: string;
        calendarProjection: string;
        extractionSummary: {
          reviewStatus: string;
          warnings: string[];
        };
      };
    };
    const previewBodies: PreviewBody[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/life-events/import-ticket",
        headers: { cookie },
        payload: { artifactId, createDraft: false }
      });
      assert.equal(response.statusCode, 200, response.body);
      previewBodies.push(response.json() as PreviewBody);
    }

    assert.equal(previewBodies[0].action, "drafted_from_ticket");
    assert.equal(previewBodies[0].lifeEvent, null);
    assert.match(previewBodies[0].previewFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(
      previewBodies[0].previewFingerprint,
      previewBodies[1].previewFingerprint
    );
    assert.equal(previewBodies[0].draft.startsAt, artifact.created_at);
    assert.equal(
      previewBodies[0].draft.startsAt,
      previewBodies[1].draft.startsAt
    );
    assert.equal(previewBodies[0].draft.endsAt, previewBodies[1].draft.endsAt);
    assert.equal(previewBodies[0].draft.calendarProjection, "none");
    assert.equal(
      previewBodies[0].draft.extractionSummary.reviewStatus,
      "needs_review"
    );
    assert.deepEqual(previewBodies[0].draft.extractionSummary.warnings, [
      "No flight or service number was detected.",
      "Forge could not identify both origin and destination codes.",
      "No travel date was detected. The Artifact creation time is shown as a stable placeholder.",
      "Forge could not identify both departure and arrival times."
    ]);
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM life_events")
          .get() as { count: number }
      ).count,
      lifeEventCountBefore
    );

    const changedPreviewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie },
      payload: {
        artifactId,
        createDraft: true,
        previewFingerprint: "0".repeat(64)
      }
    });
    assert.equal(changedPreviewResponse.statusCode, 409);
    assert.equal(
      (changedPreviewResponse.json() as { code: string }).code,
      "life_event_ticket_preview_changed"
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM life_events")
          .get() as { count: number }
      ).count,
      lifeEventCountBefore
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie },
      payload: {
        artifactId,
        createDraft: true,
        previewFingerprint: previewBodies[0].previewFingerprint
      }
    });
    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const created = createResponse.json() as {
      action: string;
      lifeEvent: { id: string; primaryCalendarEventId: string | null };
    };
    assert.equal(created.action, "created_draft_from_ticket");
    assert.equal(created.lifeEvent.primaryCalendarEventId, null);
    const artifactOwner = getDatabase()
      .prepare(
        `SELECT user_id
         FROM entity_owners
         WHERE entity_type = 'artifact' AND entity_id = ?`
      )
      .get(artifactId) as { user_id: string };
    const lifeEventOwner = getDatabase()
      .prepare(
        `SELECT user_id
         FROM entity_owners
         WHERE entity_type = 'life_event' AND entity_id = ?`
      )
      .get(created.lifeEvent.id) as { user_id: string };
    assert.equal(lifeEventOwner.user_id, artifactOwner.user_id);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie },
      payload: {
        artifactId,
        createDraft: true,
        previewFingerprint: previewBodies[0].previewFingerprint
      }
    });
    assert.equal(replayResponse.statusCode, 200, replayResponse.body);
    const replayed = replayResponse.json() as {
      action: string;
      lifeEvent: { id: string };
    };
    assert.equal(replayed.action, "already_imported_ticket");
    assert.equal(replayed.lifeEvent.id, created.lifeEvent.id);

    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_events
             WHERE source_artifact_id = ? AND deleted_at IS NULL`
          )
          .get(artifactId) as { count: number }
      ).count,
      1
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM forge_events")
          .get() as { count: number }
      ).count,
      calendarEventCountBefore
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
