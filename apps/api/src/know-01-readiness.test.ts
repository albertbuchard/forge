import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { listActivityEvents } from "./repositories/activity-events.js";
import {
  cleanupExpiredNotes,
  createNote,
  filterNoteActivityEventsForScope
} from "./repositories/notes.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createNoteSchema } from "./types.js";

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
      scopePolicy: { userIds, projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function bearer(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "x-forge-source": "agent",
    "x-forge-actor": "KNOW-01 readiness"
  };
}

test("KNOW-01 preserves authority, canonical links, search parity, and batch result truth", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-know-01-core-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const readToken = await issueToken(
      app,
      cookie,
      "Read-only note authority",
      ["read"]
    );
    const writeToken = await issueToken(
      app,
      cookie,
      "Writable note authority",
      ["read", "write"]
    );

    for (const request of [
      {
        method: "POST" as const,
        url: "/api/v1/notes",
        payload: { links: "not-an-array" }
      },
      {
        method: "PATCH" as const,
        url: "/api/v1/notes/note_missing_authority",
        payload: { links: "not-an-array" }
      },
      {
        method: "DELETE" as const,
        url: "/api/v1/notes/note_missing_authority"
      }
    ]) {
      const response = await app.inject({
        ...request,
        headers: bearer(readToken)
      });
      assert.equal(
        response.statusCode,
        403,
        `${request.method}: ${response.body}`
      );
      assert.doesNotMatch(response.body, /not-an-array|missing_authority/i);
    }

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      payload: { links: "not-an-array" }
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie },
      payload: {
        title: "Authority and anchor contract",
        contentMarkdown: "owner-author-anchor-search-sentinel",
        author: "Forge Bot",
        links: [
          { entityType: "goal", entityId: "goal:a", anchorKey: "b:c" },
          { entityType: "goal", entityId: "goal:a:b", anchorKey: "c" },
          { entityType: "goal", entityId: "goal:a", anchorKey: " b:c " },
          { entityType: "goal", entityId: "goal_blank", anchorKey: "   " },
          { entityType: "goal", entityId: "goal_blank", anchorKey: null }
        ]
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const note = (
      created.json() as {
        note: {
          id: string;
          userId: string;
          links: Array<{
            entityType: string;
            entityId: string;
            anchorKey: string | null;
          }>;
        };
      }
    ).note;
    assert.equal(note.userId, "user_operator");
    const storedLinks = getDatabase()
      .prepare(
        `SELECT entity_id, anchor_key
         FROM note_links
         WHERE note_id = ?
         ORDER BY rowid ASC`
      )
      .all(note.id) as Array<{ entity_id: string; anchor_key: string }>;
    assert.deepEqual(
      storedLinks.map((link) => [link.entity_id, link.anchor_key || null]),
      [
        ["goal:a", "b:c"],
        ["goal:a:b", "c"],
        ["goal_blank", null]
      ]
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT user_id FROM entity_owners
             WHERE entity_type = 'note' AND entity_id = ?`
          )
          .get(note.id) as { user_id: string }
      ).user_id,
      "user_operator"
    );
    const createdActivity = getDatabase()
      .prepare(
        `SELECT actor FROM activity_events
         WHERE json_extract(metadata_json, '$.noteId') = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(note.id) as { actor: string | null };
    assert.notEqual(createdActivity.actor, "Forge Bot");
    assert.ok(createdActivity.actor);

    const liveMatch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(writeToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [note.id],
            query: "owner author anchor search sentinel",
            limit: 10
          },
          {
            entityTypes: ["note"],
            ids: ["note_wrong_identity"],
            query: "owner author anchor search sentinel",
            limit: 10
          },
          {
            entityTypes: ["note"],
            ids: [note.id],
            query: "definitely absent note text",
            limit: 10
          }
        ]
      }
    });
    assert.equal(liveMatch.statusCode, 200, liveMatch.body);
    const liveResults = liveMatch.json() as {
      results: Array<{ matches: Array<{ id: string; deleted: boolean }> }>;
    };
    assert.equal(liveResults.results[0]?.matches.length, 1);
    assert.equal(liveResults.results[0]?.matches[0]?.id, note.id);
    assert.equal(liveResults.results[0]?.matches[0]?.deleted, false);
    assert.deepEqual(liveResults.results[1]?.matches, []);
    assert.deepEqual(liveResults.results[2]?.matches, []);

    const deleted = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: bearer(writeToken),
      payload: { operations: [{ entityType: "note", id: note.id }] }
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const deletedMatch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(writeToken),
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [note.id],
            query: "owner author anchor search sentinel",
            includeDeleted: true,
            limit: 10
          },
          {
            entityTypes: ["note"],
            ids: [note.id],
            query: "definitely absent note text",
            includeDeleted: true,
            limit: 10
          }
        ]
      }
    });
    assert.equal(deletedMatch.statusCode, 200, deletedMatch.body);
    const deletedResults = deletedMatch.json() as {
      results: Array<{ matches: Array<{ id: string; deleted: boolean }> }>;
    };
    assert.equal(deletedResults.results[0]?.matches[0]?.id, note.id);
    assert.equal(deletedResults.results[0]?.matches[0]?.deleted, true);
    assert.deepEqual(deletedResults.results[1]?.matches, []);

    const atomicFailure = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(writeToken),
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "note",
            clientRef: "rolled-back-note",
            data: {
              title: "Must roll back",
              contentMarkdown: "This result must not claim a committed entity."
            }
          },
          {
            entityType: "note",
            clientRef: "invalid-note",
            data: { links: "not-an-array" }
          }
        ]
      }
    });
    assert.equal(atomicFailure.statusCode, 200, atomicFailure.body);
    const failureResults = (
      atomicFailure.json() as {
        results: Array<Record<string, unknown> & { ok: boolean }>;
      }
    ).results;
    assert.equal(failureResults.length, 2);
    for (const result of failureResults) {
      assert.equal(result.ok, false);
      assert.equal(result.entityType, "note");
      assert.ok(result.error);
      assert.equal("entity" in result, false);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("KNOW-01 keeps scoped summaries and activity truthful after floods and cleanup", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-know-01-activity-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const operatorToken = await issueToken(
      app,
      cookie,
      "Operator activity reader",
      ["read", "write"]
    );
    const botToken = await issueToken(
      app,
      cookie,
      "Assigned Note activity reader",
      ["read", "write"],
      ["user_forge_bot"]
    );
    const operatorHeaders = bearer(operatorToken);

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: { title: "KNOW-01 activity goal", userId: "user_operator" }
    });
    assert.equal(goalResponse.statusCode, 201, goalResponse.body);
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        title: "KNOW-01 activity project",
        goalId,
        userId: "user_operator"
      }
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const projectId = (projectResponse.json() as { project: { id: string } })
      .project.id;

    const visibleNote = createNote(
      createNoteSchema.parse({
        title: "Older visible note activity",
        contentMarkdown: "visible-activity-after-hidden-flood",
        userId: "user_operator",
        links: [{ entityType: "project", entityId: projectId }]
      }),
      { source: "ui", actor: "operator-session-authority" }
    );
    const hiddenNoteIds = new Set<string>();
    for (let index = 0; index < 45; index += 1) {
      hiddenNoteIds.add(
        createNote(
          createNoteSchema.parse({
            title: `Newer hidden note ${index}`,
            contentMarkdown: `hidden-activity-flood-${index}`,
            userId: "user_forge_bot",
            links: [{ entityType: "project", entityId: projectId }]
          }),
          { source: "agent", actor: "foreign-agent-authority" }
        ).id
      );
    }

    const boardResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/board`,
      headers: operatorHeaders
    });
    assert.equal(boardResponse.statusCode, 200, boardResponse.body);
    const board = boardResponse.json() as {
      activity: Array<{ metadata: Record<string, unknown> }>;
      notesSummaryByEntity: Record<
        string,
        { count: number; latestNoteId: string }
      >;
    };
    const activityNoteIds = board.activity
      .map((event) => event.metadata.noteId)
      .filter((noteId): noteId is string => typeof noteId === "string");
    assert.ok(activityNoteIds.includes(visibleNote.id));
    assert.equal(
      activityNoteIds.some((noteId) => hiddenNoteIds.has(noteId)),
      false
    );
    assert.equal(board.notesSummaryByEntity[`project:${projectId}`]?.count, 1);
    assert.equal(
      board.notesSummaryByEntity[`project:${projectId}`]?.latestNoteId,
      visibleNote.id
    );

    const expiringNote = createNote(
      createNoteSchema.parse({
        title: "Durable cleanup visibility",
        contentMarkdown: "cleanup-owner-visibility-sentinel",
        userId: "user_operator",
        destroyAt: "2099-01-01T00:00:00.000Z",
        links: [{ entityType: "goal", entityId: goalId }]
      }),
      { source: "ui", actor: "cleanup-authority" }
    );
    getDatabase()
      .prepare(`UPDATE notes SET space_id = 'wiki_space_shared' WHERE id = ?`)
      .run(expiringNote.id);
    getDatabase()
      .prepare(
        `INSERT INTO entity_assignments (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('note', ?, 'user_forge_bot', 'assignee', ?, ?)`
      )
      .run(
        expiringNote.id,
        "2098-12-31T23:00:00.000Z",
        "2098-12-31T23:00:00.000Z"
      );
    const assignedTargetActivityResponse = await app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=goal&entityId=${goalId}`,
      headers: bearer(botToken)
    });
    assert.equal(
      assignedTargetActivityResponse.statusCode,
      200,
      assignedTargetActivityResponse.body
    );
    assert.equal(
      (
        assignedTargetActivityResponse.json() as {
          activity: Array<{ metadata: Record<string, unknown> }>;
        }
      ).activity.some((event) => event.metadata.noteId === expiringNote.id),
      false
    );
    assert.equal(cleanupExpiredNotes(new Date("2100-01-01T00:00:00.000Z")), 1);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_owners
             WHERE entity_type = 'note' AND entity_id = ?`
          )
          .get(expiringNote.id) as { count: number }
      ).count,
      0
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_assignments
             WHERE entity_type = 'note' AND entity_id = ?`
          )
          .get(expiringNote.id) as { count: number }
      ).count,
      0
    );

    const cleanupEvents = listActivityEvents({
      entityType: "goal",
      entityId: goalId,
      limit: undefined
    }).filter((event) => event.metadata.noteId === expiringNote.id);
    const operatorVisible = filterNoteActivityEventsForScope(cleanupEvents, {
      userIds: ["user_operator"],
      includePsyche: true
    });
    const foreignVisible = filterNoteActivityEventsForScope(cleanupEvents, {
      userIds: ["user_forge_bot"],
      includePsyche: true
    });
    assert.ok(
      operatorVisible.some((event) => event.eventType === "note.deleted")
    );
    assert.deepEqual(
      foreignVisible.map((event) => event.eventType),
      ["note.deleted"]
    );
    for (const event of [...operatorVisible, ...foreignVisible]) {
      assert.equal("noteVisibility" in event.metadata, false);
    }
    assert.equal(operatorVisible[0]?.actor, null);
    assert.equal(foreignVisible[0]?.actor, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
