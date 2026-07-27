import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { closeDatabase } from "../db.js";
import { setEntityOwner } from "../repositories/entity-ownership.js";
import { createUser } from "../repositories/users.js";
import {
  CRUD_OWNERSHIP_AUTHORIZATION_MATRIX,
  crudEntityIsVisible,
  createEntities,
  deleteEntities,
  entityMatchesCrudScope,
  getCrudEntityCapabilityMatrix,
  restoreEntities,
  searchEntities,
  updateEntities
} from "../services/entity-crud.js";
import { crudEntityTypeSchema, type CrudEntityType } from "../types.js";

test("the ownership inventory exactly covers every supported batch repository and action", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-object-matrix-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  try {
    const allowed = createUser({
      kind: "human",
      handle: "object-matrix-allowed",
      displayName: "Object matrix allowed",
      description: "",
      accentColor: "#336699"
    });
    const foreign = createUser({
      kind: "human",
      handle: "object-matrix-foreign",
      displayName: "Object matrix foreign",
      description: "",
      accentColor: "#663399"
    });
    assert.deepEqual(
      CRUD_OWNERSHIP_AUTHORIZATION_MATRIX.map(
        (entry) => entry.entityType
      ).sort(),
      [...crudEntityTypeSchema.options].sort()
    );
    const capabilities = new Map(
      getCrudEntityCapabilityMatrix().map((entry) => [entry.entityType, entry])
    );
    for (const entry of CRUD_OWNERSHIP_AUTHORIZATION_MATRIX) {
      const capability = capabilities.get(entry.entityType);
      assert.ok(capability);
      assert.deepEqual(
        entry.actions,
        capability.inBin
          ? [
              ...(entry.entityType === "artifact" ? [] : ["create"]),
              "read",
              "update",
              "delete",
              "restore",
              "search"
            ]
          : ["create", "read", "update", "delete", "search"]
      );
      const allowedId = `${entry.entityType}_matrix_allowed`;
      const foreignId = `${entry.entityType}_matrix_foreign`;
      setEntityOwner(entry.entityType, allowedId, allowed.id);
      setEntityOwner(entry.entityType, foreignId, foreign.id);
      for (const action of entry.actions) {
        assert.equal(
          entityMatchesCrudScope(
            entry.entityType,
            { id: allowedId },
            { userIds: [allowed.id] }
          ),
          true,
          `${entry.entityType}.${action} must admit its owner`
        );
        assert.equal(
          entityMatchesCrudScope(
            entry.entityType,
            { id: foreignId },
            { userIds: [allowed.id] }
          ),
          false,
          `${entry.entityType}.${action} must deny a different owner`
        );
      }
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("every ownership inventory row exercises real create, read, update, delete, search, and supported restore effects", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-object-matrix-effects-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  try {
    const ownerId = "user_operator";
    const createdIds = new Map<string, string>();
    for (const capability of getCrudEntityCapabilityMatrix()) {
      if (capability.entityType === "artifact") {
        continue;
      }
      const payload = structuredClone(capability.minimalCreatePayload);
      for (const key of ["userId"]) {
        if (key in payload) payload[key] = ownerId;
      }
      if (
        capability.entityType === "sleep_session" ||
        capability.entityType === "workout_session"
      ) {
        payload.userId = ownerId;
      }
      for (const key of ["startAt", "startsAt", "startedAt", "metAt"]) {
        if (key in payload) payload[key] = "2026-07-26T08:00:00.000Z";
      }
      for (const key of ["endAt", "endsAt", "endedAt"]) {
        if (key in payload) payload[key] = "2026-07-26T09:00:00.000Z";
      }
      if ("timezone" in payload) payload.timezone = "UTC";
      if ("weekDays" in payload) payload.weekDays = [1];
      if ("endMinute" in payload) payload.endMinute = 60;
      if ("goalId" in payload) payload.goalId = createdIds.get("goal");
      if (capability.entityType === "task") {
        payload.projectId = createdIds.get("project");
      }
      if (capability.entityType === "strategy") {
        payload.graph = {
          nodes: [
            {
              id: "matrix-strategy-node",
              entityType: "project",
              entityId: createdIds.get("project"),
              title: "Matrix project"
            }
          ],
          edges: []
        };
      }
      if (capability.entityType === "mode_guide_session") {
        payload.answers = [
          { questionKey: "matrix-question", value: "matrix-answer" }
        ];
      }
      if ("taskId" in payload) payload.taskId = createdIds.get("task");
      if (capability.entityType === "task_timebox") {
        payload.overrideReason = "Bounded authorization matrix fixture";
      }
      if ("catalogId" in payload) {
        payload.catalogId = createdIds.get("preference_catalog");
      }
      if (
        capability.entityType === "questionnaire_instrument" &&
        typeof payload.definition === "object" &&
        payload.definition
      ) {
        payload.userId = ownerId;
        payload.definition = {
          locale: "en",
          instructions: "Answer the bounded fixture.",
          completionNote: "",
          presentationMode: "single_question",
          responseStyle: "four_point_frequency",
          itemIds: ["matrix_item"],
          items: [
            {
              id: "matrix_item",
              prompt: "Fixture question",
              shortLabel: "",
              description: "",
              helperText: "",
              required: true,
              tags: [],
              options: [
                {
                  key: "0",
                  label: "No",
                  value: 0,
                  description: ""
                },
                {
                  key: "1",
                  label: "Yes",
                  value: 1,
                  description: ""
                }
              ]
            }
          ],
          sections: [
            {
              id: "matrix_section",
              title: "Fixture",
              description: "",
              itemIds: ["matrix_item"]
            }
          ],
          pageSize: null
        };
        payload.scoring = {
          scores: [
            {
              key: "total",
              label: "Total",
              description: "",
              valueType: "number",
              expression: { kind: "sum", itemIds: ["matrix_item"] },
              dependsOnItemIds: ["matrix_item"],
              missingPolicy: { mode: "require_all" },
              bands: [],
              roundTo: null,
              unitLabel: ""
            }
          ]
        };
        payload.provenance = {
          retrievalDate: "2026-07-26",
          sourceClass: "public_domain",
          scoringNotes: "",
          sources: [
            {
              label: "Bounded fixture",
              url: "https://example.invalid/fixture",
              citation: "Bounded fixture",
              notes: ""
            }
          ]
        };
      }
      const result = createEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: capability.entityType,
              clientRef: `matrix-${capability.entityType}`,
              data: payload
            }
          ]
        },
        {
          source: "agent",
          actor: ownerId,
          userIds: [ownerId]
        }
      ).results[0]!;
      assert.equal(
        result.ok,
        true,
        `${capability.entityType} real create failed: ${JSON.stringify(result)}`
      );
      assert.ok(result.id);
      createdIds.set(capability.entityType, result.id);
    }

    const foreign = createUser({
      kind: "human",
      handle: "object-matrix-effects-foreign",
      displayName: "Object matrix effects foreign",
      description: "",
      accentColor: "#663399"
    });
    for (const [entityType, id] of createdIds) {
      assert.equal(
        crudEntityIsVisible(
          entityType as Parameters<typeof crudEntityIsVisible>[0],
          id,
          { userIds: [foreign.id] }
        ),
        false,
        `${entityType} read must not disclose an owner-scoped record`
      );
      const update = updateEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: entityType as Parameters<
                typeof updateEntities
              >[0]["operations"][number]["entityType"],
              id,
              patch: {}
            }
          ]
        },
        {
          source: "agent",
          actor: foreign.id,
          userIds: [foreign.id]
        }
      ).results[0]!;
      assert.equal(
        update.ok,
        false,
        `${entityType} update must deny a different owner`
      );
      const deletion = deleteEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: entityType as Parameters<
                typeof deleteEntities
              >[0]["operations"][number]["entityType"],
              id,
              mode: "hard",
              reason: "cross-owner denial fixture"
            }
          ]
        },
        {
          source: "agent",
          actor: foreign.id,
          userIds: [foreign.id]
        }
      ).results[0]!;
      assert.equal(
        deletion.ok,
        false,
        `${entityType} delete must deny a different owner`
      );
      const search = searchEntities({
        searches: [
          {
            entityTypes: [entityType as CrudEntityType],
            ids: [id],
            userIds: [foreign.id],
            includeDeleted: true,
            limit: 10
          }
        ]
      }).results[0]!;
      assert.equal(
        Array.isArray(search.matches) &&
          search.matches.some(
            (match) =>
              typeof match === "object" &&
              match !== null &&
              "id" in match &&
              match.id === id
          ),
        false,
        `${entityType} search must not disclose a different owner's record`
      );
    }
    for (const entry of [...CRUD_OWNERSHIP_AUTHORIZATION_MATRIX].reverse()) {
      if (!entry.actions.includes("restore")) {
        continue;
      }
      const id = createdIds.get(entry.entityType);
      if (!id) {
        continue;
      }
      const removed = deleteEntities(
        {
          atomic: true,
          operations: [
            {
              entityType: entry.entityType,
              id,
              mode: "soft",
              reason: "restore ownership fixture"
            }
          ]
        },
        {
          source: "agent",
          actor: ownerId,
          userIds: [ownerId]
        }
      ).results[0]!;
      assert.equal(
        removed.ok,
        true,
        `${entry.entityType} owner soft delete failed: ${JSON.stringify(removed)}`
      );
      const deniedRestore = restoreEntities(
        {
          atomic: true,
          operations: [{ entityType: entry.entityType, id }]
        },
        {
          source: "agent",
          actor: foreign.id,
          userIds: [foreign.id]
        }
      ).results[0]!;
      assert.equal(
        deniedRestore.ok,
        false,
        `${entry.entityType} restore must deny a different owner`
      );
      const ownerRestore = restoreEntities(
        {
          atomic: true,
          operations: [{ entityType: entry.entityType, id }]
        },
        {
          source: "agent",
          actor: ownerId,
          userIds: [ownerId]
        }
      ).results[0]!;
      assert.equal(
        ownerRestore.ok,
        true,
        `${entry.entityType} owner restore failed: ${JSON.stringify(ownerRestore)}`
      );
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("project and tag restrictions intersect owner scope instead of widening it", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-object-scope-intersection-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  try {
    const allowed = createUser({
      kind: "human",
      handle: "object-scope-intersection",
      displayName: "Object scope intersection",
      description: "",
      accentColor: "#336699"
    });
    setEntityOwner("task", "task_scope_intersection", allowed.id);
    const task = {
      id: "task_scope_intersection",
      projectId: "project_allowed",
      tagIds: ["tag_allowed"]
    };
    assert.equal(
      entityMatchesCrudScope("task", task, {
        userIds: [allowed.id],
        projectIds: ["project_allowed"],
        tagIds: ["tag_allowed"]
      }),
      true
    );
    assert.equal(
      entityMatchesCrudScope("task", task, {
        userIds: [allowed.id],
        projectIds: ["project_foreign"],
        tagIds: ["tag_allowed"]
      }),
      false
    );
    assert.equal(
      entityMatchesCrudScope("task", task, {
        userIds: [allowed.id],
        projectIds: ["project_allowed"],
        tagIds: ["tag_foreign"]
      }),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
