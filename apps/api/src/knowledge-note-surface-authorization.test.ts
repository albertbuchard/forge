import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { isNoteVisibleToScope } from "./repositories/notes.js";
import type { Note } from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

const issueOperatorCookie = issueTestOperatorSessionCookie;

async function issueToken(
  app: TestApp,
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
    "x-forge-actor": "Knowledge authorization test"
  };
}

async function createGoal(app: TestApp, cookie: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/goals",
    headers: { cookie },
    payload: {
      title: "Knowledge authorization target",
      userId: "user_operator"
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { goal: { id: string } }).goal.id;
}

async function createPsycheNote(
  app: TestApp,
  cookie: string,
  goalId: string,
  privateBeliefId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/notes",
    headers: { cookie },
    payload: {
      title: "PSYCHE_NOTE_TITLE_SENTINEL",
      summary: "PSYCHE_NOTE_SUMMARY_SENTINEL",
      contentMarkdown: "PSYCHE_NOTE_CONTENT_SENTINEL",
      userId: "user_operator",
      links: [
        { entityType: "belief_entry", entityId: privateBeliefId },
        { entityType: "goal", entityId: goalId }
      ]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { note: { id: string } }).note.id;
}

async function createPrivateBelief(app: TestApp, cookie: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/psyche/beliefs",
    headers: { cookie },
    payload: {
      statement: "PSYCHE_BELIEF_STATEMENT_SENTINEL",
      beliefType: "absolute",
      userId: "user_operator"
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { belief: { id: string } }).belief.id;
}

async function createForeignWikiNote(
  app: TestApp,
  cookie: string,
  goalId: string
) {
  const spaceResponse = await app.inject({
    method: "POST",
    url: "/api/v1/wiki/spaces",
    headers: { cookie },
    payload: {
      label: "Foreign private Wiki",
      ownerUserId: "user_forge_bot",
      visibility: "personal"
    }
  });
  assert.equal(spaceResponse.statusCode, 201, spaceResponse.body);
  const spaceId = (spaceResponse.json() as { space: { id: string } }).space.id;
  const pageResponse = await app.inject({
    method: "POST",
    url: "/api/v1/wiki/pages",
    headers: { cookie },
    payload: {
      spaceId,
      title: "FOREIGN_WIKI_TITLE_SENTINEL",
      summary: "FOREIGN_WIKI_SUMMARY_SENTINEL",
      contentMarkdown: "# Foreign Wiki\n\nFOREIGN_WIKI_CONTENT_SENTINEL",
      links: [{ entityType: "goal", entityId: goalId }]
    }
  });
  assert.equal(pageResponse.statusCode, 201, pageResponse.body);
  return {
    noteId: (pageResponse.json() as { page: { id: string } }).page.id,
    spaceId
  };
}

function insertPagedGraphNotes() {
  const statement = getDatabase().prepare(
    `INSERT INTO notes (
       id, kind, title, slug, space_id, parent_slug, index_order, show_in_index,
       aliases_json, summary, content_markdown, content_plain, author, source,
       tags_json, destroy_at, source_path, frontmatter_json, revision_hash,
       last_synced_at, created_at, updated_at
     ) VALUES (?, 'evidence', ?, ?, 'wiki_space_shared', NULL, 0, 1,
       '[]', '', ?, ?, 'Forge test', 'system', '[]', NULL, '', '{}', '', NULL,
       ?, ?)`
  );
  const createdAt = "2026-07-16T12:00:00.000Z";
  for (let index = 0; index < 105; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const isTarget = index === 0;
    const title = isTarget
      ? "GRAPH_PAGE_TARGET_SENTINEL"
      : `Graph pagination filler ${suffix}`;
    statement.run(
      `note_graph_page_${suffix}`,
      title,
      `graph-page-${suffix}`,
      title,
      title,
      createdAt,
      createdAt
    );
  }
}

async function readAuthorizedEventStream(input: {
  port: number;
  token: string;
  goalId: string;
  privateNoteId: string;
}) {
  let body = "";
  let triggered = false;
  await new Promise<void>((resolve, reject) => {
    let streamResponse: http.IncomingMessage | undefined;
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for SSE payload: ${body}`)),
      3_000
    );
    const request = http.get(
      {
        host: "127.0.0.1",
        port: input.port,
        path: "/api/v1/events/stream",
        headers: bearer(input.token)
      },
      (response) => {
        streamResponse = response;
        if (response.statusCode !== 200) {
          finish(
            new Error(
              `Expected SSE status 200, received ${response.statusCode}`
            )
          );
          return;
        }
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
          if (!triggered && body.includes("event: snapshot")) {
            triggered = true;
            recordActivityEvent({
              entityType: "goal",
              entityId: input.goalId,
              eventType: "test.private_note_event",
              title: "Hidden private Note event",
              source: "system",
              metadata: {
                noteId: input.privateNoteId,
                privateMarker: "SSE_PRIVATE_METADATA_SENTINEL"
              }
            });
            setTimeout(() => {
              recordActivityEvent({
                entityType: "goal",
                entityId: input.goalId,
                eventType: "test.public_event",
                title: "Visible public event",
                source: "system",
                metadata: { publicMarker: "SSE_PUBLIC_EVENT_SENTINEL" }
              });
            }, 40);
          }
          if (body.includes("SSE_PUBLIC_EVENT_SENTINEL")) {
            finish();
          }
        });
        response.on("error", finish);
      }
    );

    function finish(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      streamResponse?.destroy();
      request.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    request.on("error", finish);
  });

  return body;
}

test("all nested knowledge surfaces enforce the centralized Note read scope", async () => {
  assert.equal(
    isNoteVisibleToScope(
      {
        kind: "evidence",
        spaceId: "wiki_space_shared",
        userId: null,
        links: []
      } as unknown as Note,
      {
        userIds: ["user_operator"],
        accessibleSpaceIds: ["wiki_space_shared"],
        includePsyche: false
      }
    ),
    false
  );
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-knowledge-note-scope-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false,
    peerRuntime: false,
    eventStreamPollIntervalMs: 20
  });

  try {
    const cookie = await issueOperatorCookie(app);
    const goalId = await createGoal(app, cookie);
    const privateBeliefId = await createPrivateBelief(app, cookie);
    const psycheNoteId = await createPsycheNote(
      app,
      cookie,
      goalId,
      privateBeliefId
    );
    const foreignWiki = await createForeignWikiNote(app, cookie, goalId);
    const foreignWikiNoteId = foreignWiki.noteId;
    insertPagedGraphNotes();

    const ordinaryToken = await issueToken(app, cookie, "Read without Psyche", [
      "read"
    ]);
    const psycheToken = await issueToken(app, cookie, "Read with Psyche", [
      "read",
      "psyche.read"
    ]);
    const ordinaryHeaders = bearer(ordinaryToken);
    const psycheHeaders = bearer(psycheToken);

    recordActivityEvent({
      entityType: "note",
      entityId: psycheNoteId,
      eventType: "test.direct_private_note_event",
      title: "DIRECT_NOTE_ACTIVITY_TITLE_SENTINEL",
      source: "system"
    });

    const securityResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(securityResponse.statusCode, 200, securityResponse.body);

    for (const url of [
      `/api/v1/notes/${psycheNoteId}`,
      "/api/v1/operator/overview",
      "/api/v1/settings/bin",
      "/api/v1/knowledge-graph",
      "/api/v1/knowledge-graph/focus?entityType=note&entityId=missing",
      "/api/v1/activity",
      "/api/v1/events/stream"
    ]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 401, `${url}: ${response.body}`);
    }

    const directPsycheDenial = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${psycheNoteId}`,
      headers: ordinaryHeaders
    });
    assert.equal(directPsycheDenial.statusCode, 403, directPsycheDenial.body);
    const directWikiDenial = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${foreignWikiNoteId}`,
      headers: ordinaryHeaders
    });
    assert.equal(directWikiDenial.statusCode, 404, directWikiDenial.body);
    const directPsycheAccess = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${psycheNoteId}`,
      headers: psycheHeaders
    });
    assert.equal(directPsycheAccess.statusCode, 200, directPsycheAccess.body);
    assert.match(directPsycheAccess.body, /PSYCHE_NOTE_CONTENT_SENTINEL/);

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview",
      headers: ordinaryHeaders
    });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.doesNotMatch(overview.body, /PSYCHE_NOTE_.*_SENTINEL/);
    assert.doesNotMatch(overview.body, /FOREIGN_WIKI_.*_SENTINEL/);
    assert.doesNotMatch(overview.body, new RegExp(psycheNoteId));
    assert.doesNotMatch(overview.body, new RegExp(foreignWikiNoteId));
    assert.doesNotMatch(overview.body, /DIRECT_NOTE_ACTIVITY_TITLE_SENTINEL/);

    const graph = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph",
      headers: ordinaryHeaders
    });
    assert.equal(graph.statusCode, 200, graph.body);
    assert.doesNotMatch(graph.body, /PSYCHE_NOTE_.*_SENTINEL/);
    assert.doesNotMatch(graph.body, /FOREIGN_WIKI_.*_SENTINEL/);
    assert.doesNotMatch(graph.body, new RegExp(psycheNoteId));
    assert.doesNotMatch(graph.body, new RegExp(foreignWikiNoteId));
    assert.doesNotMatch(graph.body, /PSYCHE_BELIEF_STATEMENT_SENTINEL/);
    assert.doesNotMatch(graph.body, new RegExp(privateBeliefId));
    assert.doesNotMatch(graph.body, /Foreign private Wiki/);
    assert.doesNotMatch(graph.body, new RegExp(foreignWiki.spaceId));

    for (const noteId of [psycheNoteId, foreignWikiNoteId]) {
      const focus = await app.inject({
        method: "GET",
        url: `/api/v1/knowledge-graph/focus?entityType=note&entityId=${encodeURIComponent(noteId)}`,
        headers: ordinaryHeaders
      });
      assert.equal(focus.statusCode, 200, focus.body);
      assert.doesNotMatch(focus.body, new RegExp(noteId));
      assert.doesNotMatch(focus.body, /_SENTINEL/);
    }

    const rawScopeBypass = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?userIds=user_forge_bot",
      headers: ordinaryHeaders
    });
    assert.equal(rawScopeBypass.statusCode, 403, rawScopeBypass.body);

    const authorizedPsycheGraph = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?entityKind=note",
      headers: psycheHeaders
    });
    assert.equal(
      authorizedPsycheGraph.statusCode,
      200,
      authorizedPsycheGraph.body
    );
    assert.match(authorizedPsycheGraph.body, new RegExp(psycheNoteId));
    assert.match(authorizedPsycheGraph.body, /PSYCHE_NOTE_TITLE_SENTINEL/);
    assert.doesNotMatch(authorizedPsycheGraph.body, /FOREIGN_WIKI_.*_SENTINEL/);

    const authorizedPsycheEntityGraph = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?entityKind=belief&q=PSYCHE_BELIEF_STATEMENT_SENTINEL",
      headers: psycheHeaders
    });
    assert.equal(
      authorizedPsycheEntityGraph.statusCode,
      200,
      authorizedPsycheEntityGraph.body
    );
    assert.match(authorizedPsycheEntityGraph.body, new RegExp(privateBeliefId));

    const pagedGraph = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph?entityKind=note&q=GRAPH_PAGE_TARGET_SENTINEL&limit=20",
      headers: { cookie }
    });
    assert.equal(pagedGraph.statusCode, 200, pagedGraph.body);
    assert.match(pagedGraph.body, /GRAPH_PAGE_TARGET_SENTINEL/);

    const deleteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [
          { entityType: "note", id: psycheNoteId, mode: "soft" },
          { entityType: "note", id: foreignWikiNoteId, mode: "soft" }
        ]
      }
    });
    assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);

    const bin = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: ordinaryHeaders
    });
    assert.equal(bin.statusCode, 403, bin.body);
    assert.equal(bin.json().code, "gateway_profile_forbidden");
    assert.doesNotMatch(bin.body, new RegExp(psycheNoteId));
    assert.doesNotMatch(bin.body, new RegExp(foreignWikiNoteId));
    assert.doesNotMatch(bin.body, /_SENTINEL/);

    const operatorBin = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie }
    });
    assert.equal(operatorBin.statusCode, 200, operatorBin.body);
    assert.match(operatorBin.body, new RegExp(psycheNoteId));
    assert.match(operatorBin.body, new RegExp(foreignWikiNoteId));

    const activity = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100",
      headers: ordinaryHeaders
    });
    assert.equal(activity.statusCode, 200, activity.body);
    assert.doesNotMatch(activity.body, new RegExp(psycheNoteId));
    assert.doesNotMatch(activity.body, new RegExp(foreignWikiNoteId));
    assert.doesNotMatch(activity.body, new RegExp(privateBeliefId));
    assert.doesNotMatch(activity.body, /DIRECT_NOTE_ACTIVITY_TITLE_SENTINEL/);

    const psycheActivity = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100",
      headers: psycheHeaders
    });
    assert.equal(psycheActivity.statusCode, 200, psycheActivity.body);
    assert.match(psycheActivity.body, new RegExp(psycheNoteId));
    assert.match(psycheActivity.body, /DIRECT_NOTE_ACTIVITY_TITLE_SENTINEL/);
    assert.doesNotMatch(psycheActivity.body, new RegExp(foreignWikiNoteId));

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const streamBody = await readAuthorizedEventStream({
      port: address.port,
      token: ordinaryToken,
      goalId,
      privateNoteId: psycheNoteId
    });
    assert.match(streamBody, /SSE_PUBLIC_EVENT_SENTINEL/);
    assert.doesNotMatch(streamBody, /SSE_PRIVATE_METADATA_SENTINEL/);
    assert.doesNotMatch(streamBody, new RegExp(psycheNoteId));
    assert.doesNotMatch(streamBody, new RegExp(privateBeliefId));

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { cookie }
    });
    assert.equal(openApiResponse.statusCode, 200, openApiResponse.body);
    const paths = (
      openApiResponse.json() as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
      }
    ).paths;
    for (const route of [
      "/api/v1/operator/overview",
      "/api/v1/settings/bin",
      "/api/v1/knowledge-graph",
      "/api/v1/knowledge-graph/focus",
      "/api/v1/activity",
      "/api/v1/events/stream"
    ]) {
      const operation = paths[route]?.get;
      assert.ok(operation, `Missing source OpenAPI operation for ${route}`);
      assert.deepEqual(operation.security, [
        { operatorSession: [] },
        { bearerAuth: [] }
      ]);
      assert.ok((operation.responses as Record<string, unknown>)["401"]);
      assert.ok((operation.responses as Record<string, unknown>)["403"]);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
