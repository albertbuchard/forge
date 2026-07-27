import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function createAgentToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  trustLevel: "standard" | "trusted";
  scopes: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
      agentLabel: input.label,
      trustLevel: input.trustLevel,
      scopes: input.scopes
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function getArtifactStoragePath(artifactId: string): string {
  const row = getDatabase()
    .prepare("SELECT storage_path FROM artifacts WHERE id = ?")
    .get(artifactId) as { storage_path: string } | undefined;
  assert.ok(row);
  return row.storage_path;
}

test("artifact trust changes require the reasoned route and are atomic with audit", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-trust-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const metadataToken = await createAgentToken({
      app,
      cookie,
      label: "Metadata-only Artifact Agent",
      trustLevel: "standard",
      scopes: ["artifact.readMetadata", "artifact.updateMetadata"]
    });
    const trustToken = await createAgentToken({
      app,
      cookie,
      label: "Trusted Artifact Reviewer",
      trustLevel: "trusted",
      scopes: ["artifact.readMetadata", "artifact.manageTrust"]
    });
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Trust contract fixture",
        originalFileName: "trust.csv",
        contentBase64: Buffer.from("name,value\ntrust,1\n").toString("base64")
      }
    });
    assert.equal(upload.statusCode, 201);
    const artifactId = (upload.json() as { artifact: { id: string } }).artifact
      .id;

    const ordinaryPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/artifacts/${artifactId}`,
      headers: { authorization: `Bearer ${metadataToken}` },
      payload: {
        title: "This must not be applied",
        artifactState: "archived",
        downloadPolicy: "disabled"
      }
    });
    assert.equal(ordinaryPatch.statusCode, 400);
    assert.equal(
      (ordinaryPatch.json() as { code: string }).code,
      "artifact_trust_route_required"
    );

    const deniedTrust = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/trust`,
      headers: { authorization: `Bearer ${metadataToken}` },
      payload: { artifactState: "archived", reason: "Not authorized" }
    });
    assert.equal(deniedTrust.statusCode, 403);

    const missingReason = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/trust`,
      headers: { authorization: `Bearer ${trustToken}` },
      payload: { artifactState: "archived" }
    });
    assert.equal(missingReason.statusCode, 400);

    const trustedPatch = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/trust`,
      headers: { authorization: `Bearer ${trustToken}` },
      payload: {
        artifactState: "archived",
        downloadPolicy: "disabled",
        reason: "Reviewed by a trusted artifact operator"
      }
    });
    assert.equal(trustedPatch.statusCode, 200);

    const disabledDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${artifactId}/download`,
      headers: { cookie }
    });
    assert.equal(disabledDownload.statusCode, 409);
    assert.equal(
      (disabledDownload.json() as { code: string }).code,
      "artifact_download_unavailable"
    );

    const versionPage = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${artifactId}/versions?limit=1&offset=0`,
      headers: { cookie }
    });
    assert.equal(versionPage.statusCode, 200);
    const versionPageBody = versionPage.json() as {
      versions: unknown[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    assert.equal(versionPageBody.versions.length, 1);
    assert.equal(versionPageBody.total, 1);
    assert.equal(versionPageBody.limit, 1);
    assert.equal(versionPageBody.offset, 0);
    assert.equal(versionPageBody.hasMore, false);
    assert.equal(versionPage.body.includes("trust,1"), false);
    assert.equal(versionPage.body.includes("extractedTextSample"), false);

    const auditPage = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${artifactId}/audit?limit=1&offset=0`,
      headers: { cookie }
    });
    assert.equal(auditPage.statusCode, 200);
    const auditPageBody = auditPage.json() as {
      events: unknown[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    assert.equal(auditPageBody.events.length, 1);
    assert.ok(auditPageBody.total >= 2);
    assert.equal(auditPageBody.limit, 1);
    assert.equal(auditPageBody.offset, 0);
    assert.equal(auditPageBody.hasMore, true);

    const oversizedHistoryPage = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${artifactId}/audit?limit=101`,
      headers: { cookie }
    });
    assert.equal(oversizedHistoryPage.statusCode, 400);

    getDatabase().exec(`
      CREATE TRIGGER fail_artifact_trust_audit
      BEFORE INSERT ON artifact_audit_events
      WHEN NEW.event_type = 'artifact.trust_state_updated'
      BEGIN
        SELECT RAISE(ABORT, 'forced trust audit failure');
      END;
    `);
    const failedAtomicPatch = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/trust`,
      headers: { cookie },
      payload: {
        artifactState: "blocked",
        reason: "Exercise transaction rollback"
      }
    });
    assert.equal(failedAtomicPatch.statusCode, 500);

    const afterFailure = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${artifactId}`,
      headers: { cookie }
    });
    assert.equal(afterFailure.statusCode, 200);
    const afterFailureArtifact = (
      afterFailure.json() as {
        artifact: {
          title: string;
          artifactState: string;
          downloadPolicy: string;
        };
      }
    ).artifact;
    assert.equal(afterFailureArtifact.title, "Trust contract fixture");
    assert.equal(afterFailureArtifact.artifactState, "archived");
    assert.equal(afterFailureArtifact.downloadPolicy, "disabled");
    const trustEventCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM event_log
         WHERE entity_id = ? AND event_kind = 'artifact.trust_state_updated'`
      )
      .get(artifactId) as { count: number };
    assert.equal(trustEventCount.count, 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact blobs are verified before reuse and download without deletion", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-integrity-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const reusableBytes = Buffer.from("name,value\nreuse,11\n");
    const reusableUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Reuse integrity fixture",
        originalFileName: "reuse.csv",
        contentBase64: reusableBytes.toString("base64")
      }
    });
    assert.equal(reusableUpload.statusCode, 201);
    const reusableArtifact = (
      reusableUpload.json() as {
        artifact: { id: string };
      }
    ).artifact;
    assert.equal("storagePath" in reusableArtifact, false);
    const reusableStoragePath = getArtifactStoragePath(reusableArtifact.id);
    const sameSizeCorruption = Buffer.alloc(reusableBytes.byteLength, 0x78);
    await writeFile(reusableStoragePath, sameSizeCorruption);

    const rejectedReuse = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Rejected duplicate",
        originalFileName: "reuse-copy.csv",
        contentBase64: reusableBytes.toString("base64")
      }
    });
    assert.equal(rejectedReuse.statusCode, 409);
    assert.equal(
      (rejectedReuse.json() as { code: string }).code,
      "artifact_blob_integrity_mismatch"
    );
    assert.deepEqual(await readFile(reusableStoragePath), sameSizeCorruption);

    const reusableMetadata = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${reusableArtifact.id}`,
      headers: { cookie }
    });
    assert.equal(reusableMetadata.statusCode, 200);
    assert.equal(
      (
        reusableMetadata.json() as {
          artifact: { artifactState: string };
        }
      ).artifact.artifactState,
      "blocked"
    );

    const downloadBytes = Buffer.from("name,value\ndownload,22\n");
    const downloadUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        title: "Download integrity fixture",
        originalFileName: "download.csv",
        contentBase64: downloadBytes.toString("base64")
      }
    });
    assert.equal(downloadUpload.statusCode, 201);
    const downloadArtifact = (
      downloadUpload.json() as {
        artifact: { id: string };
      }
    ).artifact;
    assert.equal("storagePath" in downloadArtifact, false);
    const downloadStoragePath = getArtifactStoragePath(downloadArtifact.id);
    const wrongSizedCorruption = Buffer.concat([
      downloadBytes,
      Buffer.from("unexpected")
    ]);
    await writeFile(downloadStoragePath, wrongSizedCorruption);

    const rejectedDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${downloadArtifact.id}/download`,
      headers: { cookie }
    });
    assert.equal(rejectedDownload.statusCode, 409);
    assert.equal(
      (rejectedDownload.json() as { code: string }).code,
      "artifact_blob_integrity_mismatch"
    );
    assert.equal(rejectedDownload.body.includes("storageKey"), false);
    assert.equal(rejectedDownload.body.includes("sha256/"), false);
    assert.deepEqual(await readFile(downloadStoragePath), wrongSizedCorruption);

    const rejectedRescan = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${downloadArtifact.id}/scan`,
      headers: { cookie }
    });
    assert.equal(rejectedRescan.statusCode, 409, rejectedRescan.body);
    assert.equal(
      (rejectedRescan.json() as { code: string }).code,
      "artifact_blob_integrity_mismatch"
    );
    assert.equal(rejectedRescan.body.includes("storageKey"), false);
    assert.equal(rejectedRescan.body.includes("sha256/"), false);

    const downloadMetadata = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${downloadArtifact.id}`,
      headers: { cookie }
    });
    assert.equal(downloadMetadata.statusCode, 200);
    assert.equal(
      (
        downloadMetadata.json() as {
          artifact: { artifactState: string };
        }
      ).artifact.artifactState,
      "blocked"
    );
    const integrityAudit = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${downloadArtifact.id}/audit?limit=10`,
      headers: { cookie }
    });
    assert.equal(integrityAudit.statusCode, 200);
    assert.ok(
      (
        integrityAudit.json() as { events: Array<{ eventType: string }> }
      ).events.some(
        (event) => event.eventType === "artifact.blob_integrity_mismatch"
      )
    );
    const persistedIntegrityHistory = JSON.stringify({
      audit: getDatabase()
        .prepare(
          `SELECT metadata_json FROM artifact_audit_events
           WHERE artifact_id = ?`
        )
        .all(downloadArtifact.id),
      events: getDatabase()
        .prepare(
          `SELECT metadata_json FROM event_log
           WHERE entity_type = 'artifact' AND entity_id = ?`
        )
        .all(downloadArtifact.id)
    });
    assert.equal(persistedIntegrityHistory.includes("storageKey"), false);
    assert.equal(persistedIntegrityHistory.includes("sha256/"), false);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
