import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { upsertDeletedEntityRecord } from "./repositories/deleted-entities.js";
import { createGoal } from "./repositories/goals.js";
import {
  createArtifactFromUpload,
  replaceArtifactEntityLinks
} from "./services/artifacts.js";

test("ART-08 rejects missing, deleted, and unsupported targets without replacing valid artifact links", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-art-08-link-targets-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const context = {
      source: "ui" as const,
      actor: "ART-08 human operator"
    };
    const validGoal = createGoal({
      title: "ART-08 valid target",
      description: "",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    const deletedGoal = createGoal({
      title: "ART-08 deleted target",
      description: "",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#663399",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    upsertDeletedEntityRecord({
      entityType: "goal",
      entityId: deletedGoal.id,
      title: deletedGoal.title,
      snapshot: deletedGoal,
      deleteReason: "ART-08 deleted-target fixture",
      context
    });
    const created = await createArtifactFromUpload(
      {
        title: "ART-08 relationship fixture",
        originalFileName: "art-08-links.txt",
        contentBase64: Buffer.from("ART-08 link integrity", "utf8").toString(
          "base64"
        )
      },
      context
    );
    const artifactId = created.artifact.id;
    const validLinks = [
      {
        entityType: "goal",
        entityId: validGoal.id,
        relationship: "evidence",
        anchorKey: "accepted-target"
      }
    ];
    const linked = replaceArtifactEntityLinks(artifactId, validLinks, context);
    assert.deepEqual(
      linked?.links.map((link) => ({
        entityType: link.targetEntityType,
        entityId: link.targetEntityId,
        relationship: link.relationship,
        anchorKey: link.anchorKey
      })),
      validLinks
    );

    const auditCountBefore = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM artifact_audit_events
           WHERE artifact_id = ? AND event_type = 'artifact.links_updated'`
        )
        .get(artifactId) as { count: number }
    ).count;
    const rejectedTargets = [
      { entityType: "goal", entityId: "goal_art_08_missing" },
      { entityType: "goal", entityId: deletedGoal.id },
      { entityType: "unknown_record", entityId: "unknown_art_08_target" }
    ];
    for (const target of rejectedTargets) {
      assert.throws(
        () =>
          replaceArtifactEntityLinks(
            artifactId,
            [{ ...target, relationship: "replacement", anchorKey: "" }],
            context
          ),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "artifact_link_target_not_found"
          );
          assert.equal((error as { statusCode?: number }).statusCode, 404);
          return true;
        }
      );
    }

    const persistedLinks = getDatabase()
      .prepare(
        `SELECT target_entity_type, target_entity_id, relationship, anchor_key
         FROM entity_links
         WHERE source_entity_type = 'artifact' AND source_entity_id = ?`
      )
      .all(artifactId) as Array<{
      target_entity_type: string;
      target_entity_id: string;
      relationship: string;
      anchor_key: string;
    }>;
    assert.deepEqual(
      persistedLinks.map((row) => ({ ...row })),
      [
        {
          target_entity_type: "goal",
          target_entity_id: validGoal.id,
          relationship: "evidence",
          anchor_key: "accepted-target"
        }
      ]
    );
    const auditCountAfter = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM artifact_audit_events
           WHERE artifact_id = ? AND event_type = 'artifact.links_updated'`
        )
        .get(artifactId) as { count: number }
    ).count;
    assert.equal(auditCountBefore, 1);
    assert.equal(auditCountAfter, auditCountBefore);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
