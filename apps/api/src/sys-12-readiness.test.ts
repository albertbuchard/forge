import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import {
  listEntityLinksForEntity,
  replaceEntityLinksForSource,
  replaceEntityLinksForSourceRelationships
} from "./repositories/entity-links.js";

test("SYS-12 rejects self-links before replacing valid relationships", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-sys-12-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    replaceEntityLinksForSource({
      sourceEntityType: "goal",
      sourceEntityId: "goal_source",
      links: [
        {
          entityType: "project",
          entityId: "project_target",
          relationship: "related"
        }
      ]
    });

    assert.throws(
      () =>
        replaceEntityLinksForSource({
          sourceEntityType: "goal",
          sourceEntityId: "goal_source",
          links: [
            {
              entityType: "goal",
              entityId: "goal_source",
              relationship: "related"
            }
          ]
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.code === "entity_link_self_reference"
    );
    assert.deepEqual(
      listEntityLinksForEntity("goal", "goal_source").map((link) => ({
        targetEntityType: link.targetEntityType,
        targetEntityId: link.targetEntityId,
        relationship: link.relationship
      })),
      [
        {
          targetEntityType: "project",
          targetEntityId: "project_target",
          relationship: "related"
        }
      ]
    );

    assert.throws(
      () =>
        replaceEntityLinksForSourceRelationships({
          sourceEntityType: "goal",
          sourceEntityId: "goal_source",
          relationships: ["supports"],
          links: [
            {
              entityType: "goal",
              entityId: "goal_source",
              relationship: "supports"
            }
          ]
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.code === "entity_link_self_reference"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
