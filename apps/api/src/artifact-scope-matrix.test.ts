import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTag } from "./repositories/tags.js";
import { searchEntities } from "./services/entity-crud.js";
import { readArtifactDownload } from "./services/artifacts.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function operatorCookie(app: TestApp) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function artifactToken(
  app: TestApp,
  cookie: string,
  scopePolicy: { userIds: string[]; projectIds: string[]; tagIds: string[] }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Artifact exact link scope matrix",
      agentLabel: "Artifact exact link scope matrix",
      trustLevel: "trusted",
      scopes: [
        "read",
        "write",
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata",
        "artifact.updateMetadata",
        "artifact.link",
        "artifact.manageTrust",
        "artifact.enrichWithLlm"
      ],
      scopePolicy
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

async function upload(input: {
  app: TestApp;
  cookie: string;
  title: string;
  projectIds: string[];
  tagIds: string[];
  actingForUserId?: string;
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: { cookie: input.cookie },
    payload: {
      title: input.title,
      originalFileName: "ticket.txt",
      declaredMimeType: "text/plain",
      actingForUserId: input.actingForUserId ?? "user_operator",
      contentBase64: Buffer.from(
        `Flight LX638 ZRH CDG 2026-08-01 07:30 09:10 ${input.title}`,
        "utf8"
      ).toString("base64"),
      links: [
        ...input.projectIds.map((entityId) => ({
          entityType: "project",
          entityId,
          relationship: "project_context"
        })),
        ...input.tagIds.map((entityId) => ({
          entityType: "tag",
          entityId,
          relationship: "tag_context"
        }))
      ]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { artifact: { id: string } }).artifact.id;
}

function firstResult(response: {
  statusCode: number;
  body: string;
  json: () => unknown;
}) {
  assert.equal(response.statusCode, 200, response.body);
  return (
    response.json() as {
      results: Array<{
        ok: boolean;
        matches?: Array<{ id: string }>;
        error?: { code: string };
      }>;
    }
  ).results[0]!;
}

test("Artifact routes and batch CRUD enforce exact project and tag links", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-scope-matrix-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = await operatorCookie(app);
    const allowedGoal = createGoal({
      title: "Artifact allowed goal",
      description: "",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    const foreignGoal = createGoal({
      title: "Artifact foreign goal",
      description: "",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#663399",
      tagIds: [],
      notes: [],
      userId: "user_forge_bot"
    });
    const allowedProject = createProject({
      goalId: allowedGoal.id,
      title: "Artifact allowed project",
      userId: "user_operator"
    });
    const foreignProject = createProject({
      goalId: foreignGoal.id,
      title: "Artifact foreign project",
      userId: "user_forge_bot"
    });
    const allowedTag = createTag({
      name: "artifact-allowed-tag",
      kind: "category",
      color: "#336699",
      description: "",
      userId: "user_operator"
    });
    const foreignTag = createTag({
      name: "artifact-foreign-tag",
      kind: "category",
      color: "#663399",
      description: "",
      userId: "user_forge_bot"
    });
    const inScopeId = await upload({
      app,
      cookie,
      title: "ARTSCOPE allowed",
      projectIds: [allowedProject.id],
      tagIds: [allowedTag.id]
    });
    const wrongProjectId = await upload({
      app,
      cookie,
      title: "ARTSCOPE wrong project",
      projectIds: [foreignProject.id],
      tagIds: [allowedTag.id]
    });
    const wrongTagId = await upload({
      app,
      cookie,
      title: "ARTSCOPE wrong tag",
      projectIds: [allowedProject.id],
      tagIds: [foreignTag.id]
    });
    const mixedScopeId = await upload({
      app,
      cookie,
      title: "ARTSCOPE mixed project",
      projectIds: [allowedProject.id, foreignProject.id],
      tagIds: [allowedTag.id]
    });
    const wrongUserId = await upload({
      app,
      cookie,
      title: "ARTSCOPE wrong user",
      projectIds: [allowedProject.id],
      tagIds: [allowedTag.id],
      actingForUserId: "user_forge_bot"
    });
    const unknownId = "artifact_scope_unknown";
    const token = await artifactToken(app, cookie, {
      userIds: ["user_operator"],
      projectIds: [allowedProject.id],
      tagIds: [allowedTag.id]
    });
    const headers = { authorization: `Bearer ${token}` };

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?query=ARTSCOPE&limit=100",
      headers
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(
      (list.json() as { artifacts: Array<{ id: string }> }).artifacts.map(
        (artifact) => artifact.id
      ),
      [inScopeId]
    );

    const dedicatedCalls = (id: string) => [
      app.inject({ method: "GET", url: `/api/v1/artifacts/${id}`, headers }),
      app.inject({
        method: "PATCH",
        url: `/api/v1/artifacts/${id}`,
        headers,
        payload: { shortDescription: "Scoped update" }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/scan`,
        headers
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/enrich`,
        headers,
        payload: {}
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/links`,
        headers,
        payload: {
          links: [
            {
              entityType: "project",
              entityId: allowedProject.id,
              relationship: "project_context"
            },
            {
              entityType: "tag",
              entityId: allowedTag.id,
              relationship: "tag_context"
            }
          ]
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/trust`,
        headers,
        payload: { artifactState: "active", reason: "Scope matrix" }
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}/versions`,
        headers
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}/audit`,
        headers
      })
    ];
    const allowedResponses = await Promise.all(dedicatedCalls(inScopeId));
    for (const response of allowedResponses) {
      assert.equal(response.statusCode, 200, response.body);
    }
    for (const hiddenId of [
      wrongProjectId,
      wrongTagId,
      mixedScopeId,
      wrongUserId
    ]) {
      const [hiddenResponses, unknownResponses] = await Promise.all([
        Promise.all(dedicatedCalls(hiddenId)),
        Promise.all(dedicatedCalls(unknownId))
      ]);
      for (let index = 0; index < hiddenResponses.length; index += 1) {
        assert.equal(hiddenResponses[index]!.statusCode, 404);
        assert.equal(unknownResponses[index]!.statusCode, 404);
        assert.deepEqual(
          hiddenResponses[index]!.json(),
          unknownResponses[index]!.json()
        );
      }
    }

    const ticketImport = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers,
      payload: { artifactId: inScopeId, createDraft: false }
    });
    assert.equal(ticketImport.statusCode, 200, ticketImport.body);
    for (const hiddenId of [
      wrongProjectId,
      wrongTagId,
      mixedScopeId,
      wrongUserId
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/life-events/import-ticket",
        headers,
        payload: { artifactId: hiddenId, createDraft: false }
      });
      assert.equal(response.statusCode, 404, response.body);
    }

    const invalidRelink = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${inScopeId}/links`,
      headers,
      payload: {
        links: [
          {
            entityType: "project",
            entityId: foreignProject.id,
            relationship: "project_context"
          },
          {
            entityType: "tag",
            entityId: allowedTag.id,
            relationship: "tag_context"
          }
        ]
      }
    });
    assert.equal(invalidRelink.statusCode, 404, invalidRelink.body);
    const missingTargetRelink = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${inScopeId}/links`,
      headers,
      payload: {
        links: [
          {
            entityType: "project",
            entityId: "project_scope_missing",
            relationship: "project_context"
          },
          {
            entityType: "tag",
            entityId: allowedTag.id,
            relationship: "tag_context"
          }
        ]
      }
    });
    assert.equal(missingTargetRelink.statusCode, 404, missingTargetRelink.body);
    const afterInvalidRelink = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${inScopeId}`,
      headers
    });
    assert.equal(afterInvalidRelink.statusCode, 200, afterInvalidRelink.body);

    const scopedUploadWithoutLinks = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers,
      payload: {
        idempotencyKey: "artifact-scope-missing-links",
        title: "ARTSCOPE missing links",
        originalFileName: "ticket.txt",
        actingForUserId: "user_operator",
        contentBase64: Buffer.from("Flight LX1 ZRH CDG").toString("base64")
      }
    });
    assert.equal(scopedUploadWithoutLinks.statusCode, 404);

    const batchSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: {
        searches: [
          {
            entityTypes: ["artifact"],
            query: "ARTSCOPE",
            includeDeleted: false,
            limit: 100
          }
        ]
      }
    });
    assert.deepEqual(
      firstResult(batchSearch).matches?.map((match) => match.id),
      [inScopeId]
    );
    const directBatchSearch = searchEntities(
      {
        searches: [
          {
            entityTypes: ["artifact"],
            query: "ARTSCOPE",
            includeDeleted: false,
            limit: 100
          }
        ]
      },
      {
        artifactScope: {
          userIds: ["user_operator"],
          projectIds: [allowedProject.id],
          tagIds: [allowedTag.id]
        }
      }
    );
    assert.deepEqual(
      (
        directBatchSearch.results[0] as {
          matches: Array<{ id: string }>;
        }
      ).matches.map((match) => match.id),
      [inScopeId]
    );

    const batchMutation = (
      route: "update" | "delete" | "restore",
      id: string,
      extra: Record<string, unknown> = {}
    ) =>
      app.inject({
        method: "POST",
        url: `/api/v1/entities/${route}`,
        headers,
        payload: {
          operations: [
            route === "update"
              ? { entityType: "artifact", id, patch: { title: "Scoped" } }
              : { entityType: "artifact", id, ...extra }
          ]
        }
      });
    for (const route of ["update", "delete", "restore"] as const) {
      for (const hiddenId of [
        wrongProjectId,
        wrongTagId,
        mixedScopeId,
        wrongUserId
      ]) {
        const [hidden, unknown] = await Promise.all([
          batchMutation(route, hiddenId),
          batchMutation(route, unknownId)
        ]);
        assert.equal(firstResult(hidden).error?.code, "not_found");
        assert.equal(firstResult(unknown).error?.code, "not_found");
      }
    }
    const softDelete = await batchMutation("delete", inScopeId, {
      mode: "soft",
      reason: "Scope matrix"
    });
    assert.equal(firstResult(softDelete).ok, true);
    const hiddenSoftDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "artifact",
            id: wrongUserId,
            mode: "soft",
            reason: "Scope matrix hidden restore"
          }
        ]
      }
    });
    assert.equal(firstResult(hiddenSoftDelete).ok, true);
    const directDeletedSearch = searchEntities(
      {
        searches: [
          {
            entityTypes: ["artifact"],
            ids: [inScopeId, wrongUserId],
            includeDeleted: true,
            limit: 100
          }
        ]
      },
      {
        artifactScope: {
          userIds: ["user_operator"],
          projectIds: [allowedProject.id],
          tagIds: [allowedTag.id]
        }
      }
    );
    assert.deepEqual(
      (
        directDeletedSearch.results[0] as {
          matches: Array<{ id: string; deleted: boolean }>;
        }
      ).matches.map((match) => ({ id: match.id, deleted: match.deleted })),
      [{ id: inScopeId, deleted: true }]
    );
    const [hiddenRestore, unknownRestore] = await Promise.all([
      batchMutation("restore", wrongUserId),
      batchMutation("restore", unknownId)
    ]);
    assert.equal(firstResult(hiddenRestore).error?.code, "not_found");
    assert.equal(firstResult(unknownRestore).error?.code, "not_found");
    const restore = await batchMutation("restore", inScopeId);
    assert.equal(firstResult(restore).ok, true);

    const hardDeleteId = await upload({
      app,
      cookie,
      title: "ARTSCOPE hard delete",
      projectIds: [allowedProject.id],
      tagIds: [allowedTag.id]
    });
    const hardDelete = await batchMutation("delete", hardDeleteId, {
      mode: "hard",
      reason: "Scope matrix hard delete"
    });
    assert.equal(firstResult(hardDelete).ok, true);

    const scopedHumanContext = {
      source: "ui" as const,
      actor: "Artifact scope download test",
      userIds: ["user_operator"],
      projectIds: [allowedProject.id],
      tagIds: [allowedTag.id]
    };
    const allowedDownload = await readArtifactDownload(
      inScopeId,
      "",
      scopedHumanContext
    );
    assert.ok(allowedDownload);
    assert.equal(
      allowedDownload.bytes.toString("utf8").includes("ARTSCOPE allowed"),
      true
    );
    for (const hiddenId of [
      wrongProjectId,
      wrongTagId,
      mixedScopeId,
      wrongUserId,
      unknownId
    ]) {
      assert.equal(
        await readArtifactDownload(hiddenId, "", scopedHumanContext),
        null
      );
    }

    for (const id of [
      inScopeId,
      wrongProjectId,
      wrongTagId,
      wrongUserId,
      unknownId
    ]) {
      const download = await app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}/download`,
        headers
      });
      assert.equal(download.statusCode, 401, download.body);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
