import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { deleteEntities } from "./services/entity-crud.js";
import {
  createArtifactFromUpload,
  getArtifactById,
  patchArtifactTrust,
  rescanArtifact
} from "./services/artifacts.js";

function artifactState(artifactId: string) {
  return getDatabase()
    .prepare(
      `SELECT artifact_state, download_policy, danger_score, danger_level,
              scan_results_json, storage_key, stored_content_sha256,
              stored_byte_size, content_protection_mode, updated_at
       FROM artifacts
       WHERE id = ?`
    )
    .get(artifactId) as Record<string, unknown>;
}

function artifactEvidence(artifactId: string) {
  return {
    audit: getDatabase()
      .prepare(
        `SELECT id, event_type, metadata_json, created_at
         FROM artifact_audit_events
         WHERE artifact_id = ?
         ORDER BY rowid`
      )
      .all(artifactId),
    eventLog: getDatabase()
      .prepare(
        `SELECT id, event_kind, metadata_json, created_at
         FROM event_log
         WHERE entity_type = 'artifact' AND entity_id = ?
         ORDER BY rowid`
      )
      .all(artifactId)
  };
}

async function expectScanConflict(scan: Promise<unknown>) {
  await assert.rejects(scan, (error: unknown) => {
    assert.equal((error as { code?: string }).code, "artifact_scan_conflict");
    assert.equal((error as { statusCode?: number }).statusCode, 409);
    return true;
  });
}

test("ART-07 rejects stale scan completions without overwriting newer trust or deletion state", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-art-07-stale-scan-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const context = {
      source: "ui" as const,
      actor: "ART-07 human operator"
    };
    const trustFixture = await createArtifactFromUpload(
      {
        title: "ART-07 trust precedence",
        originalFileName: "art-07-trust.txt",
        contentBase64: Buffer.from(
          "Human trust decisions remain authoritative.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const trustArtifactId = trustFixture.artifact.id;
    const staleTrustScan = rescanArtifact(trustArtifactId, context);
    const humanTrustDecision = patchArtifactTrust(
      trustArtifactId,
      {
        artifactState: "quarantined",
        downloadPolicy: "disabled",
        reason: "A human quarantined the artifact while rescan was pending."
      },
      context
    );
    assert.equal(humanTrustDecision?.artifactState, "quarantined");
    assert.equal(humanTrustDecision?.downloadPolicy, "disabled");
    const stateAfterTrustDecision = artifactState(trustArtifactId);
    const evidenceAfterTrustDecision = artifactEvidence(trustArtifactId);

    await expectScanConflict(staleTrustScan);
    assert.deepEqual(artifactState(trustArtifactId), stateAfterTrustDecision);
    assert.deepEqual(
      artifactEvidence(trustArtifactId),
      evidenceAfterTrustDecision
    );
    assert.equal(
      getArtifactById(trustArtifactId, context)?.artifactState,
      "quarantined"
    );

    const policyFixture = await createArtifactFromUpload(
      {
        title: "ART-07 download-policy precedence",
        originalFileName: "art-07-download-policy.txt",
        contentBase64: Buffer.from(
          "A human-only download restriction remains authoritative.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const policyArtifactId = policyFixture.artifact.id;
    const stalePolicyScan = rescanArtifact(policyArtifactId, context);
    const humanPolicyDecision = patchArtifactTrust(
      policyArtifactId,
      {
        artifactState: policyFixture.artifact.artifactState,
        downloadPolicy: "disabled",
        reason: "A human disabled downloads without changing scan state."
      },
      context
    );
    assert.equal(
      humanPolicyDecision?.artifactState,
      policyFixture.artifact.artifactState
    );
    assert.equal(humanPolicyDecision?.downloadPolicy, "disabled");
    const stateAfterPolicyDecision = artifactState(policyArtifactId);
    const evidenceAfterPolicyDecision = artifactEvidence(policyArtifactId);

    await expectScanConflict(stalePolicyScan);
    assert.deepEqual(artifactState(policyArtifactId), stateAfterPolicyDecision);
    assert.deepEqual(
      artifactEvidence(policyArtifactId),
      evidenceAfterPolicyDecision
    );
    assert.equal(
      getArtifactById(policyArtifactId, context)?.downloadPolicy,
      "disabled"
    );

    const deletionFixture = await createArtifactFromUpload(
      {
        title: "ART-07 deletion precedence",
        originalFileName: "art-07-delete.txt",
        contentBase64: Buffer.from(
          "Deleted artifact metadata remains deleted.",
          "utf8"
        ).toString("base64")
      },
      context
    );
    const deletedArtifactId = deletionFixture.artifact.id;
    const staleDeletedScan = rescanArtifact(deletedArtifactId, context);
    const deletion = deleteEntities(
      {
        atomic: true,
        operations: [
          {
            entityType: "artifact",
            id: deletedArtifactId,
            mode: "soft",
            reason: "ART-07 deletion won while rescan was pending."
          }
        ]
      },
      context
    );
    assert.equal(deletion.results[0]?.ok, true);
    const stateAfterDeletion = artifactState(deletedArtifactId);
    const evidenceAfterDeletion = artifactEvidence(deletedArtifactId);
    const tombstoneAfterDeletion = getDatabase()
      .prepare(
        `SELECT entity_type, entity_id, delete_reason, snapshot_json
         FROM deleted_entities
         WHERE entity_type = 'artifact' AND entity_id = ?`
      )
      .get(deletedArtifactId);
    assert.ok(tombstoneAfterDeletion);

    await expectScanConflict(staleDeletedScan);
    assert.deepEqual(artifactState(deletedArtifactId), stateAfterDeletion);
    assert.deepEqual(
      artifactEvidence(deletedArtifactId),
      evidenceAfterDeletion
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT entity_type, entity_id, delete_reason, snapshot_json
           FROM deleted_entities
           WHERE entity_type = 'artifact' AND entity_id = ?`
        )
        .get(deletedArtifactId),
      tombstoneAfterDeletion
    );
    assert.equal(getArtifactById(deletedArtifactId, context), undefined);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
