import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { createNote } from "./repositories/notes.js";
import { createNoteSchema } from "./types.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userIds: string[]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Notes ownership contract test",
      scopes: ["read", "write"],
      scopePolicy: { userIds, projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("notes route exposes exact bounded pages, query caps, conflict-safe lifecycle, and OpenAPI", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-notes-route-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createdIds: string[] = [];
    for (let index = 0; index < 85; index += 1) {
      const note = createNote(
        createNoteSchema.parse({
          title: `Route note ${index}`,
          contentMarkdown: `Bounded route evidence ${index}`,
          tags: ["route-contract"]
        }),
        { source: "system", actor: "notes-route-test" }
      );
      createdIds.push(note.id);
    }
    createNote(
      createNoteSchema.parse({
        title: "Observed route note",
        contentMarkdown: "This note describes an earlier event.",
        tags: ["observed-route"],
        frontmatter: { observedAt: "2026-05-12T08:30:00.000Z" }
      }),
      { source: "system", actor: "notes-route-test" }
    );
    const foreignNote = createNote(
      createNoteSchema.parse({
        title: "Foreign scoped note",
        contentMarkdown: "This note belongs to another scoped user.",
        tags: ["foreign-scope"],
        userId: "user_forge_bot"
      }),
      { source: "system", actor: "notes-route-test" }
    );
    const foreignPsycheNote = createNote(
      createNoteSchema.parse({
        title: "Foreign scoped Psyche note",
        contentMarkdown: "The note classification must not be disclosed.",
        userId: "user_forge_bot",
        links: [{ entityType: "psyche_value", entityId: "value_foreign" }]
      }),
      { source: "system", actor: "notes-route-test" }
    );

    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/v1/notes?tags=route-contract&limit=40",
      headers: { cookie }
    });
    assert.equal(firstResponse.statusCode, 200);
    const first = firstResponse.json() as {
      notes: Array<{ id: string }>;
      total: number;
      limit: number;
      nextCursor: string | null;
      hasMore: boolean;
    };
    assert.equal(first.total, 85);
    assert.equal(first.limit, 40);
    assert.equal(first.notes.length, 40);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const secondResponse = await app.inject({
      method: "GET",
      url: `/api/v1/notes?tags=route-contract&limit=40&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: { cookie }
    });
    assert.equal(secondResponse.statusCode, 200);
    const second = secondResponse.json() as typeof first;
    assert.equal(second.notes.length, 40);
    assert.equal(second.total, 85);
    assert.ok(second.nextCursor);

    const thirdResponse = await app.inject({
      method: "GET",
      url: `/api/v1/notes?tags=route-contract&limit=40&cursor=${encodeURIComponent(second.nextCursor)}`,
      headers: { cookie }
    });
    assert.equal(thirdResponse.statusCode, 200);
    const third = thirdResponse.json() as typeof first;
    assert.equal(third.notes.length, 5);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursor, null);
    assert.equal(
      new Set(
        [...first.notes, ...second.notes, ...third.notes].map((note) => note.id)
      ).size,
      85
    );

    const observedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/notes?tags=observed-route&observedFrom=2026-05-12&observedTo=2026-05-12",
      headers: { cookie }
    });
    assert.equal(observedResponse.statusCode, 200);
    assert.equal((observedResponse.json() as { total: number }).total, 1);

    const scopedToken = await issueScopedToken(app, cookie, ["user_operator"]);
    const scopedHeaders = { authorization: `Bearer ${scopedToken}` };
    const scopedList = await app.inject({
      method: "GET",
      url: "/api/v1/notes?tags=foreign-scope",
      headers: scopedHeaders
    });
    assert.equal(scopedList.statusCode, 200);
    assert.equal((scopedList.json() as { total: number }).total, 0);
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/notes/${foreignNote.id}`,
        headers: scopedHeaders,
        ...(method === "PATCH"
          ? { payload: { contentMarkdown: "Forbidden overwrite" } }
          : {})
      });
      assert.equal(response.statusCode, 404, method);
    }

    const implicitOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: scopedHeaders,
      payload: {
        title: "Implicit scoped owner",
        contentMarkdown: "The only allowed user becomes the owner."
      }
    });
    assert.equal(implicitOwnerCreate.statusCode, 201, implicitOwnerCreate.body);
    assert.equal(
      (implicitOwnerCreate.json() as { note: { userId: string } }).note.userId,
      "user_operator"
    );

    const foreignOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: scopedHeaders,
      payload: {
        title: "Forbidden scoped owner",
        contentMarkdown: "This owner is outside the token scope.",
        userId: "user_forge_bot"
      }
    });
    assert.equal(foreignOwnerCreate.statusCode, 403, foreignOwnerCreate.body);
    assert.equal(
      (foreignOwnerCreate.json() as { code: string }).code,
      "user_scope_forbidden"
    );

    const multiUserToken = await issueScopedToken(app, cookie, [
      "user_operator",
      "user_forge_bot"
    ]);
    const multiUserHeaders = { authorization: `Bearer ${multiUserToken}` };
    const ambiguousOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: multiUserHeaders,
      payload: {
        title: "Ambiguous scoped owner",
        contentMarkdown: "A multi-user token must choose the owner."
      }
    });
    assert.equal(
      ambiguousOwnerCreate.statusCode,
      400,
      ambiguousOwnerCreate.body
    );
    assert.equal(
      (ambiguousOwnerCreate.json() as { code: string }).code,
      "note_user_selection_required"
    );
    const explicitOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: multiUserHeaders,
      payload: {
        title: "Explicit scoped owner",
        contentMarkdown: "The selected allowed owner is retained.",
        userId: "user_forge_bot"
      }
    });
    assert.equal(explicitOwnerCreate.statusCode, 201, explicitOwnerCreate.body);
    assert.equal(
      (explicitOwnerCreate.json() as { note: { userId: string } }).note.userId,
      "user_forge_bot"
    );

    const securityResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(securityResponse.statusCode, 200, securityResponse.body);
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/notes/${foreignPsycheNote.id}`,
        headers: scopedHeaders,
        ...(method === "PATCH"
          ? { payload: { contentMarkdown: "Forbidden Psyche overwrite" } }
          : {})
      });
      assert.equal(response.statusCode, 404, `${method}: ${response.body}`);
      assert.doesNotMatch(response.body, /psyche|value_foreign/i);
    }

    const goalCreate = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: { title: "Scoped note context goal", userId: "user_operator" }
    });
    assert.equal(goalCreate.statusCode, 201, goalCreate.body);
    const goalId = (goalCreate.json() as { goal: { id: string } }).goal.id;
    const projectCreate = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        title: "Scoped note context project",
        goalId,
        userId: "user_operator"
      }
    });
    assert.equal(projectCreate.statusCode, 201, projectCreate.body);
    const projectId = (projectCreate.json() as { project: { id: string } })
      .project.id;
    createNote(
      createNoteSchema.parse({
        title: "Visible context note",
        contentMarkdown: "Visible context evidence.",
        userId: "user_operator",
        links: [{ entityType: "project", entityId: projectId }]
      }),
      { source: "system", actor: "notes-route-test" }
    );
    createNote(
      createNoteSchema.parse({
        title: "Foreign context secret",
        contentMarkdown: "foreign-context-secret-sentinel",
        userId: "user_forge_bot",
        links: [{ entityType: "project", entityId: projectId }]
      }),
      { source: "system", actor: "notes-route-test" }
    );
    const projectBoard = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/board`,
      headers: scopedHeaders
    });
    assert.equal(projectBoard.statusCode, 200, projectBoard.body);
    assert.equal(
      (
        projectBoard.json() as {
          notesSummaryByEntity: Record<string, { count: number }>;
        }
      ).notesSummaryByEntity[`project:${projectId}`]?.count,
      1
    );
    assert.doesNotMatch(projectBoard.body, /foreign-context-secret-sentinel/i);

    const foreignGoalCreate = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: { title: "Foreign context goal", userId: "user_forge_bot" }
    });
    assert.equal(foreignGoalCreate.statusCode, 201, foreignGoalCreate.body);
    const foreignGoalId = (foreignGoalCreate.json() as { goal: { id: string } })
      .goal.id;
    const foreignProjectCreate = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        title: "Foreign context project",
        goalId: foreignGoalId,
        userId: "user_forge_bot"
      }
    });
    assert.equal(
      foreignProjectCreate.statusCode,
      201,
      foreignProjectCreate.body
    );
    const foreignProjectId = (
      foreignProjectCreate.json() as { project: { id: string } }
    ).project.id;
    const foreignProjectBoard = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${foreignProjectId}/board`,
      headers: scopedHeaders
    });
    assert.equal(foreignProjectBoard.statusCode, 404, foreignProjectBoard.body);

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/api/v1/notes?cursor=not-a-note-cursor",
      headers: { cookie }
    });
    assert.equal(invalidCursor.statusCode, 400);
    assert.equal(
      (invalidCursor.json() as { code: string }).code,
      "invalid_note_cursor"
    );

    const boundedQueries = [
      new URLSearchParams(
        Array.from({ length: 13 }, (_, index) => ["textTerms", `term-${index}`])
      ),
      new URLSearchParams(
        Array.from({ length: 25 }, (_, index) => ["tags", `tag-${index}`])
      ),
      new URLSearchParams(
        Array.from({ length: 25 }, (_, index) => [
          "linkedTo",
          `goal:goal-${index}`
        ])
      ),
      new URLSearchParams(
        Array.from({ length: 33 }, (_, index) => ["userIds", `user-${index}`])
      ),
      new URLSearchParams({ query: "q".repeat(513) }),
      new URLSearchParams({
        query: Array.from({ length: 17 }, (_, index) => `q${index}`).join(" ")
      }),
      new URLSearchParams({
        textTerms: Array.from(
          { length: 13 },
          (_, index) => `term${index}`
        ).join(" ")
      })
    ];
    for (const search of boundedQueries) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/notes?${search.toString()}`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 400);
    }

    const noteId = createdIds[0]!;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie }
    });
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.json() as {
      note: { revisionHash: string };
    };
    const firstPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie },
      payload: {
        contentMarkdown: "Current route revision",
        expectedRevisionHash: detail.note.revisionHash
      }
    });
    assert.equal(firstPatch.statusCode, 200);
    const stalePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie },
      payload: {
        contentMarkdown: "Stale route revision",
        expectedRevisionHash: detail.note.revisionHash
      }
    });
    assert.equal(stalePatch.statusCode, 409);

    const deletedResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie }
    });
    assert.equal(deletedResponse.statusCode, 200);
    const deletedDetail = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie }
    });
    assert.equal(deletedDetail.statusCode, 404);
    const afterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/notes?tags=route-contract&limit=1",
      headers: { cookie }
    });
    assert.equal((afterDelete.json() as { total: number }).total, 84);
    const binResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie }
    });
    assert.ok(
      (
        binResponse.json() as {
          bin: { records: Array<{ entityType: string; entityId: string }> };
        }
      ).bin.records.some(
        (record) => record.entityType === "note" && record.entityId === noteId
      )
    );
    const restoreResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "note", id: noteId }]
      }
    });
    assert.equal(restoreResponse.statusCode, 200);
    assert.equal(
      (
        restoreResponse.json() as {
          results: Array<{ ok: boolean }>;
        }
      ).results[0]?.ok,
      true
    );
    const restoredDetail = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers: { cookie }
    });
    assert.equal(restoredDetail.statusCode, 200);

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApiResponse.statusCode, 200);
    const openApi = openApiResponse.json() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    const noteList = openApi.paths["/api/v1/notes"]?.get as {
      parameters: Array<{ name: string }>;
      responses: Record<string, unknown>;
    };
    const parameterNames = new Set(
      noteList.parameters.map((parameter) => parameter.name)
    );
    for (const name of [
      "kind",
      "spaceId",
      "slug",
      "anchorKey",
      "includeAnchorless",
      "query",
      "linkedTo",
      "tags",
      "textTerms",
      "userIds",
      "updatedFrom",
      "updatedTo",
      "observedFrom",
      "observedTo",
      "limit",
      "cursor"
    ]) {
      assert.equal(parameterNames.has(name), true, `missing ${name}`);
    }
    assert.ok(noteList.responses["400"]);
    assert.ok(openApi.components.schemas.NoteCreateInput);
    assert.ok(openApi.components.schemas.NotePatchInput);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
