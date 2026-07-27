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
