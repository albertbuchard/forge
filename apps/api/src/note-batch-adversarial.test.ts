import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createNote } from "./repositories/notes.js";
import { createNoteSchema } from "./types.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  label: string,
  scopes: string[],
  userIds = ["user_operator"]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label,
      agentLabel: label,
      agentType: "assistant",
      trustLevel: "standard",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes,
      scopePolicy: {
        userIds,
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function bearer(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "x-forge-source": "agent",
    "x-forge-actor": "KNOW-01 adversarial test"
  };
}

test("batch Notes preserve Psyche authorization and indexed search parity", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-note-batch-adversarial-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const ordinaryToken = await issueToken(app, cookie, "Ordinary note agent", [
      "read",
      "write"
    ]);
    const psycheToken = await issueToken(app, cookie, "Psyche note agent", [
      "read",
      "write",
      "psyche.read",
      "psyche.note"
    ]);

    const createDirect = async (
      title: string,
      contentMarkdown: string,
      links: Array<{ entityType: string; entityId: string }>,
      userId = "user_operator"
    ) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/notes",
        headers: { cookie },
        payload: { title, contentMarkdown, links, userId }
      });
      assert.equal(response.statusCode, 201, response.body);
      return (response.json() as { note: { id: string } }).note.id;
    };

    const ordinaryNoteId = await createDirect(
      "Ordinary batch-visible note",
      "ordinary-note-search-sentinel",
      []
    );
    const psycheNoteId = await createDirect(
      "Private Psyche batch note",
      "private-psyche-search-sentinel",
      [{ entityType: "psyche_value", entityId: "value_private" }]
    );
    const foreignPsycheNoteId = await createDirect(
      "Foreign private Psyche note",
      "foreign-private-psyche-sentinel",
      [{ entityType: "psyche_value", entityId: "value_foreign" }],
      "user_forge_bot"
    );
    const foreignOrdinaryNoteId = await createDirect(
      "Foreign ordinary batch note",
      "foreign-ordinary-note-sentinel",
      [{ entityType: "goal", entityId: "goal_foreign_context" }],
      "user_forge_bot"
    );
    const taxonomyNoteIds = await Promise.all(
      ["mode_guide_session", "event_type", "emotion_definition"].map(
        (entityType) =>
          createDirect(
            `Private ${entityType} note`,
            `private-${entityType}-sentinel`,
            [{ entityType, entityId: `${entityType}_private` }]
          )
      )
    );

    const securityResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(securityResponse.statusCode, 200, securityResponse.body);

    const ordinarySearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: {
        searches: [{ entityTypes: ["note"], query: "sentinel", limit: 20 }]
      }
    });
    assert.equal(ordinarySearch.statusCode, 200, ordinarySearch.body);
    const ordinaryMatches = (
      ordinarySearch.json() as {
        results: Array<{ matches: Array<{ id: string }> }>;
      }
    ).results[0]!.matches;
    assert.deepEqual(
      ordinaryMatches.map((match) => match.id),
      [ordinaryNoteId]
    );
    assert.doesNotMatch(ordinarySearch.body, /private-psyche-search-sentinel/);
    for (const taxonomyNoteId of taxonomyNoteIds) {
      assert.equal(
        ordinaryMatches.some((match) => match.id === taxonomyNoteId),
        false
      );
    }

    const psycheSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(psycheToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [psycheNoteId],
            query: "private psyche",
            limit: 20
          }
        ]
      }
    });
    assert.equal(psycheSearch.statusCode, 200, psycheSearch.body);
    assert.deepEqual(
      (
        psycheSearch.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]!.matches.map((match) => match.id),
      [psycheNoteId]
    );

    const blockedMutations = [
      {
        route: "/api/v1/entities/create",
        payload: {
          operations: [
            {
              entityType: "note",
              data: {
                title: "Blocked Psyche create",
                contentMarkdown: "must not be created",
                links: [
                  { entityType: "psyche_value", entityId: "value_private" }
                ]
              }
            }
          ]
        }
      },
      {
        route: "/api/v1/entities/update",
        payload: {
          operations: [
            {
              entityType: "note",
              id: ordinaryNoteId,
              patch: {
                links: [
                  { entityType: "psyche_value", entityId: "value_private" }
                ]
              }
            }
          ]
        }
      },
      {
        route: "/api/v1/entities/update",
        payload: {
          operations: [
            {
              entityType: "note",
              id: psycheNoteId,
              patch: { contentMarkdown: "blocked overwrite" }
            }
          ]
        }
      },
      {
        route: "/api/v1/entities/delete",
        payload: {
          operations: [{ entityType: "note", id: psycheNoteId }]
        }
      }
    ];
    for (const mutation of blockedMutations) {
      const response = await app.inject({
        method: "POST",
        url: mutation.route,
        headers: bearer(ordinaryToken),
        payload: mutation.payload
      });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(
        (response.json() as { code: string }).code,
        "insufficient_scope"
      );
    }

    const foreignMutation = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [{ entityType: "note", id: foreignPsycheNoteId }]
      }
    });
    assert.equal(foreignMutation.statusCode, 200, foreignMutation.body);
    const foreignResult = (
      foreignMutation.json() as {
        results: Array<{ ok: boolean; error?: { code: string } }>;
      }
    ).results[0];
    assert.equal(foreignResult?.ok, false);
    assert.match(foreignResult?.error?.code ?? "", /note_not_found/);
    assert.doesNotMatch(foreignMutation.body, /psyche|value_foreign/i);

    for (const route of [
      "/api/v1/entities/update",
      "/api/v1/entities/delete"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: route,
        headers: bearer(ordinaryToken),
        payload: route.endsWith("update")
          ? {
              operations: [
                {
                  entityType: "note",
                  id: foreignOrdinaryNoteId,
                  patch: { contentMarkdown: "forbidden overwrite" }
                }
              ]
            }
          : {
              operations: [{ entityType: "note", id: foreignOrdinaryNoteId }]
            }
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(
        (
          response.json() as {
            results: Array<{ ok: boolean; error?: { code: string } }>;
          }
        ).results[0]?.error?.code,
        "note_not_found"
      );
      assert.doesNotMatch(response.body, /foreign-ordinary-note-sentinel/);
    }
    const operatorForeignDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "note", id: foreignOrdinaryNoteId }]
      }
    });
    assert.equal(
      operatorForeignDelete.statusCode,
      200,
      operatorForeignDelete.body
    );
    const foreignRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [{ entityType: "note", id: foreignOrdinaryNoteId }]
      }
    });
    assert.equal(foreignRestore.statusCode, 200, foreignRestore.body);
    assert.equal(
      (
        foreignRestore.json() as {
          results: Array<{ error?: { code: string } }>;
        }
      ).results[0]?.error?.code,
      "note_not_found"
    );

    const implicitOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              title: "Batch implicit owner",
              contentMarkdown: "The sole scoped user owns this note."
            }
          }
        ]
      }
    });
    assert.equal(implicitOwnerCreate.statusCode, 200, implicitOwnerCreate.body);
    assert.equal(
      (
        implicitOwnerCreate.json() as {
          results: Array<{ ok: boolean; entity: { userId: string } }>;
        }
      ).results[0]?.entity.userId,
      "user_operator"
    );

    const foreignOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              title: "Batch forbidden owner",
              contentMarkdown: "The requested owner is outside scope.",
              userId: "user_forge_bot"
            }
          }
        ]
      }
    });
    assert.equal(foreignOwnerCreate.statusCode, 200, foreignOwnerCreate.body);
    assert.equal(
      (
        foreignOwnerCreate.json() as {
          results: Array<{ ok: boolean; error: { code: string } }>;
        }
      ).results[0]?.error.code,
      "user_scope_forbidden"
    );

    const multiUserToken = await issueToken(
      app,
      cookie,
      "Multi-user note agent",
      ["read", "write"],
      ["user_operator", "user_forge_bot"]
    );
    const ambiguousOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(multiUserToken),
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              title: "Batch ambiguous owner",
              contentMarkdown: "A multi-user token must choose a userId."
            }
          }
        ]
      }
    });
    assert.equal(
      ambiguousOwnerCreate.statusCode,
      200,
      ambiguousOwnerCreate.body
    );
    assert.equal(
      (
        ambiguousOwnerCreate.json() as {
          results: Array<{ ok: boolean; error: { code: string } }>;
        }
      ).results[0]?.error.code,
      "note_user_selection_required"
    );

    const explicitOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(multiUserToken),
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              title: "Batch explicit owner",
              contentMarkdown: "The selected allowed user owns this note.",
              userId: "user_forge_bot"
            }
          }
        ]
      }
    });
    assert.equal(explicitOwnerCreate.statusCode, 200, explicitOwnerCreate.body);
    assert.equal(
      (
        explicitOwnerCreate.json() as {
          results: Array<{ ok: boolean; entity: { userId: string } }>;
        }
      ).results[0]?.entity.userId,
      "user_forge_bot"
    );

    const nestedOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(multiUserToken),
      payload: {
        operations: [
          {
            entityType: "goal",
            data: {
              title: "Bot-owned goal with evidence",
              description: "",
              horizon: "year",
              status: "active",
              targetPoints: 100,
              themeColor: "#7dd3fc",
              userId: "user_forge_bot",
              notes: [
                {
                  contentMarkdown: "nested-owner-inheritance-sentinel"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(nestedOwnerCreate.statusCode, 200, nestedOwnerCreate.body);
    const botOnlyToken = await issueToken(
      app,
      cookie,
      "Bot-owned note reader",
      ["read", "write"],
      ["user_forge_bot"]
    );
    const nestedOwnerSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(botOnlyToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            query: "nested owner inheritance sentinel",
            limit: 10
          }
        ]
      }
    });
    assert.equal(nestedOwnerSearch.statusCode, 200, nestedOwnerSearch.body);
    assert.equal(
      (
        nestedOwnerSearch.json() as {
          results: Array<{ matches: Array<{ entity: { userId: string } }> }>;
        }
      ).results[0]?.matches[0]?.entity.userId,
      "user_forge_bot"
    );

    const authorizedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(psycheToken),
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              title: "Authorized Psyche create",
              contentMarkdown: "authorized-psyche-create-sentinel",
              links: [{ entityType: "psyche_value", entityId: "value_private" }]
            }
          }
        ]
      }
    });
    assert.equal(authorizedCreate.statusCode, 200, authorizedCreate.body);
    assert.equal(
      (authorizedCreate.json() as { results: Array<{ ok: boolean }> })
        .results[0]?.ok,
      true
    );

    const operatorDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/notes/${psycheNoteId}`,
      headers: { cookie }
    });
    assert.equal(operatorDelete.statusCode, 200, operatorDelete.body);

    const hiddenDeletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [psycheNoteId],
            includeDeleted: true,
            limit: 20
          }
        ]
      }
    });
    assert.equal(hiddenDeletedSearch.statusCode, 200, hiddenDeletedSearch.body);
    assert.deepEqual(
      (
        hiddenDeletedSearch.json() as {
          results: Array<{ matches: unknown[] }>;
        }
      ).results[0]?.matches,
      []
    );

    const blockedRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [{ entityType: "note", id: psycheNoteId }]
      }
    });
    assert.equal(blockedRestore.statusCode, 403, blockedRestore.body);

    const authorizedRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: bearer(psycheToken),
      payload: {
        operations: [{ entityType: "note", id: psycheNoteId }]
      }
    });
    assert.equal(authorizedRestore.statusCode, 200, authorizedRestore.body);
    assert.equal(
      (authorizedRestore.json() as { results: Array<{ ok: boolean }> })
        .results[0]?.ok,
      true
    );

    const older = createNote(
      createNoteSchema.parse({
        title: "Older indexed thesis evidence",
        contentMarkdown: "The needle remains recoverable.",
        userId: "user_operator",
        links: [{ entityType: "goal", entityId: "goal_indexed_search" }]
      }),
      { source: "system", actor: "KNOW-01 test" }
    );
    for (let index = 0; index < 120; index += 1) {
      createNote(
        createNoteSchema.parse({
          title: `Newer filler note ${index}`,
          contentMarkdown: `newer filler ${index}`,
          userId: "user_operator"
        }),
        { source: "system", actor: "KNOW-01 test" }
      );
    }
    const olderSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            query: "older needle",
            linkedTo: { entityType: "goal", id: "goal_indexed_search" },
            limit: 10
          }
        ]
      }
    });
    assert.equal(olderSearch.statusCode, 200, olderSearch.body);
    assert.deepEqual(
      (
        olderSearch.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]!.matches.map((match) => match.id),
      [older.id]
    );

    const deletedSearchNoteId = await createDirect(
      "Deleted indexed evidence",
      "recoverable deletion needle",
      [{ entityType: "goal", entityId: "goal_deleted_search" }]
    );
    const deleteSearchNote = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: bearer(ordinaryToken),
      payload: {
        operations: [{ entityType: "note", id: deletedSearchNoteId }]
      }
    });
    assert.equal(deleteSearchNote.statusCode, 200, deleteSearchNote.body);
    assert.equal(
      (deleteSearchNote.json() as { results: Array<{ ok: boolean }> })
        .results[0]?.ok,
      true
    );
    const deletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [deletedSearchNoteId],
            query: "deletion needle",
            linkedTo: { entityType: "goal", id: "goal_deleted_search" },
            includeDeleted: true,
            limit: 1
          }
        ]
      }
    });
    assert.equal(deletedSearch.statusCode, 200, deletedSearch.body);
    assert.deepEqual(
      (
        deletedSearch.json() as {
          results: Array<{
            matches: Array<{ id: string; deleted: boolean }>;
          }>;
        }
      ).results[0]?.matches.map((match) => ({
        id: match.id,
        deleted: match.deleted
      })),
      [{ id: deletedSearchNoteId, deleted: true }]
    );

    const unicodeNoteId = await createDirect(
      "Ｆｏｒｇｅ normalization evidence",
      "Composed café evidence",
      []
    );
    for (const includeDeleted of [false, true]) {
      if (includeDeleted) {
        const deletedUnicode = await app.inject({
          method: "POST",
          url: "/api/v1/entities/delete",
          headers: bearer(ordinaryToken),
          payload: {
            operations: [{ entityType: "note", id: unicodeNoteId }]
          }
        });
        assert.equal(deletedUnicode.statusCode, 200, deletedUnicode.body);
      }
      const unicodeSearch = await app.inject({
        method: "POST",
        url: "/api/v1/entities/search",
        headers: bearer(ordinaryToken),
        payload: {
          searches: [
            {
              entityTypes: ["note"],
              ids: [unicodeNoteId],
              query: "forge cafe\u0301",
              includeDeleted,
              limit: 10
            }
          ]
        }
      });
      assert.equal(unicodeSearch.statusCode, 200, unicodeSearch.body);
      assert.deepEqual(
        (
          unicodeSearch.json() as {
            results: Array<{ matches: Array<{ id: string }> }>;
          }
        ).results[0]?.matches.map((match) => match.id),
        [unicodeNoteId]
      );
    }

    const assigneeNoteId = await createDirect(
      "Assignee-visible deleted note",
      "assignee-deleted-parity-sentinel",
      []
    );
    getDatabase()
      .prepare(`UPDATE notes SET space_id = 'wiki_space_shared' WHERE id = ?`)
      .run(assigneeNoteId);
    getDatabase()
      .prepare(
        `INSERT INTO entity_assignments (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('note', ?, 'user_forge_bot', 'assignee', ?, ?)`
      )
      .run(
        assigneeNoteId,
        "2026-07-16T12:00:00.000Z",
        "2026-07-16T12:00:00.000Z"
      );
    const assigneeLiveSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(botOnlyToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [assigneeNoteId],
            limit: 10
          }
        ]
      }
    });
    assert.equal(assigneeLiveSearch.statusCode, 200, assigneeLiveSearch.body);
    assert.deepEqual(
      (
        assigneeLiveSearch.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]?.matches.map((match) => match.id),
      [assigneeNoteId]
    );
    const deleteAssigneeNote = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: bearer(ordinaryToken),
      payload: { operations: [{ entityType: "note", id: assigneeNoteId }] }
    });
    assert.equal(deleteAssigneeNote.statusCode, 200, deleteAssigneeNote.body);
    const assigneeDeletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(botOnlyToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [assigneeNoteId],
            includeDeleted: true,
            limit: 10
          }
        ]
      }
    });
    assert.equal(
      assigneeDeletedSearch.statusCode,
      200,
      assigneeDeletedSearch.body
    );
    assert.deepEqual(
      (
        assigneeDeletedSearch.json() as {
          results: Array<{ matches: Array<{ id: string }> }>;
        }
      ).results[0]?.matches.map((match) => match.id),
      [assigneeNoteId]
    );

    getDatabase()
      .prepare(
        `UPDATE activity_events
         SET description = CASE
           WHEN json_extract(metadata_json, '$.noteId') = ? THEN 'foreign-context-leak-sentinel'
           WHEN json_extract(metadata_json, '$.noteId') = ? THEN 'psyche-context-leak-sentinel'
           ELSE description
         END`
      )
      .run(foreignOrdinaryNoteId, psycheNoteId);
    for (const url of [
      "/api/v1/context",
      "/api/dashboard",
      "/api/openclaw/context"
    ]) {
      const contextResponse = await app.inject({
        method: "GET",
        url,
        headers: bearer(ordinaryToken)
      });
      assert.equal(contextResponse.statusCode, 200, contextResponse.body);
      assert.doesNotMatch(
        contextResponse.body,
        /foreign-context-leak-sentinel|psyche-context-leak-sentinel/
      );
    }

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(openApiResponse.statusCode, 200, openApiResponse.body);
    const paths = (
      openApiResponse.json() as {
        paths: Record<
          string,
          {
            post?: {
              description?: string;
              responses?: Record<string, unknown>;
            };
          }
        >;
      }
    ).paths;
    assert.match(
      paths["/api/v1/entities/search"]?.post?.description ?? "",
      /psyche\.read/i
    );
    for (const route of [
      "/api/v1/entities/create",
      "/api/v1/entities/update",
      "/api/v1/entities/delete",
      "/api/v1/entities/restore"
    ]) {
      assert.match(paths[route]?.post?.description ?? "", /psyche\.note/i);
      assert.ok(paths[route]?.post?.responses?.["403"]);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
