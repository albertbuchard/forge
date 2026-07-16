import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

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

test("wiki browse and search are ranked, paginated, compact, bounded, and user-scoped", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-browse-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createPage = async (input: {
      title: string;
      contentMarkdown: string;
      aliases?: string[];
      spaceId?: string;
      showInIndex?: boolean;
      links?: Array<{ entityType: "goal"; entityId: string }>;
    }) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: { cookie },
        payload: {
          ...input,
          summary: `Summary for ${input.title}`,
          aliases: input.aliases ?? [],
          showInIndex: input.showInIndex ?? true,
          links: input.links ?? []
        }
      });
      assert.equal(response.statusCode, 201);
      return (response.json() as { page: { id: string } }).page.id;
    };

    const exactTitleId = await createPage({
      title: "Memory protocol",
      contentMarkdown: "# Memory protocol\n\nPrimary operating procedure."
    });
    const exactAliasId = await createPage({
      title: "Recall handbook",
      aliases: ["memory protocol"],
      contentMarkdown: "# Recall handbook\n\nAlias-oriented reference."
    });
    const contentMatchId = await createPage({
      title: "Archive field note",
      contentMarkdown:
        "# Archive field note\n\nThe memory protocol appears only in document content."
    });

    const firstSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: {
        mode: "text",
        query: "memory protocol",
        limit: 1,
        offset: 0
      }
    });
    assert.equal(firstSearch.statusCode, 200);
    const firstSearchBody = firstSearch.json() as {
      results: Array<{
        page: Record<string, unknown> & { id: string };
        matchKind: string;
        snippet: string;
      }>;
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
    assert.equal(firstSearchBody.results[0]?.page.id, exactTitleId);
    assert.equal(firstSearchBody.results[0]?.matchKind, "title");
    assert.ok(firstSearchBody.results[0]?.snippet.length);
    assert.equal(firstSearchBody.limit, 1);
    assert.equal(firstSearchBody.offset, 0);
    assert.equal(firstSearchBody.hasMore, true);
    assert.equal(firstSearchBody.nextOffset, 1);
    assert.equal("contentMarkdown" in firstSearchBody.results[0]!.page, false);

    const secondSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: {
        mode: "text",
        query: "memory protocol",
        limit: 1,
        offset: firstSearchBody.nextOffset
      }
    });
    assert.equal(secondSearch.statusCode, 200);
    const secondSearchBody = secondSearch.json() as {
      results: Array<{ page: { id: string }; matchKind: string }>;
      nextOffset: number | null;
    };
    assert.equal(secondSearchBody.results[0]?.page.id, exactAliasId);
    assert.equal(secondSearchBody.results[0]?.matchKind, "alias");

    const thirdSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: {
        mode: "text",
        query: "memory protocol",
        limit: 1,
        offset: secondSearchBody.nextOffset
      }
    });
    assert.equal(thirdSearch.statusCode, 200);
    const thirdSearchBody = thirdSearch.json() as {
      results: Array<{ page: { id: string }; matchKind: string }>;
      hasMore: boolean;
      nextOffset: number | null;
    };
    assert.equal(thirdSearchBody.results[0]?.page.id, contentMatchId);
    assert.equal(thirdSearchBody.results[0]?.matchKind, "content");
    assert.equal(thirdSearchBody.hasMore, false);
    assert.equal(thirdSearchBody.nextOffset, null);

    const exactFallbackId = await createPage({
      title: "Ranking sentinel",
      contentMarkdown: "# Ranking sentinel\n\nExact direct-title fallback."
    });
    for (let index = 0; index < 101; index += 1) {
      await createPage({
        title: `Ranking sentinel partial ${String(index).padStart(3, "0")}`,
        contentMarkdown: `# Ranking sentinel partial ${index}`
      });
    }
    getDatabase()
      .prepare("DELETE FROM wiki_pages_fts WHERE note_id = ?")
      .run(exactFallbackId);
    const directFallbackSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: {
        mode: "text",
        query: "ranking sentinel",
        limit: 10
      }
    });
    assert.equal(directFallbackSearch.statusCode, 200);
    assert.equal(
      (
        directFallbackSearch.json() as {
          results: Array<{ page: { id: string }; matchKind: string }>;
        }
      ).results[0]?.page.id,
      exactFallbackId
    );
    assert.equal(directFallbackSearch.json().results[0]?.matchKind, "title");

    const recentSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "text", query: "", limit: 2 }
    });
    assert.equal(recentSearch.statusCode, 200);
    assert.equal(recentSearch.json().results.length, 2);
    assert.ok(
      recentSearch
        .json()
        .results.every(
          (result: { matchKind: string }) => result.matchKind === "recent"
        )
    );

    const tieLink = { entityType: "goal" as const, entityId: "goal_wiki_tie" };
    const tiePageIds = [
      await createPage({
        title: "Deterministic entity page A",
        contentMarkdown: "# Deterministic entity page A",
        links: [tieLink]
      }),
      await createPage({
        title: "Deterministic entity page B",
        contentMarkdown: "# Deterministic entity page B",
        links: [tieLink]
      })
    ];
    getDatabase()
      .prepare(
        `UPDATE notes SET updated_at = ? WHERE id IN (${tiePageIds.map(() => "?").join(", ")})`
      )
      .run("2026-01-01T00:00:00.000Z", ...tiePageIds);
    const tieSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "entity", linkedEntity: tieLink, limit: 10 }
    });
    assert.equal(tieSearch.statusCode, 200);
    assert.deepEqual(
      (tieSearch.json() as { results: Array<{ page: { id: string } }> }).results
        .map((result) => result.page.id)
        .filter((id) => tiePageIds.includes(id)),
      [...tiePageIds].sort((left, right) => left.localeCompare(right))
    );

    const pageList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?limit=2&offset=1",
      headers: { cookie }
    });
    assert.equal(pageList.statusCode, 200);
    const pageListBody = pageList.json() as {
      pages: Array<Record<string, unknown>>;
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
    assert.equal(pageListBody.pages.length, 2);
    assert.equal(pageListBody.limit, 2);
    assert.equal(pageListBody.offset, 1);
    assert.equal(pageListBody.hasMore, true);
    assert.equal(pageListBody.nextOffset, 3);
    assert.ok(pageListBody.pages.every((page) => !("contentMarkdown" in page)));

    const hiddenPageId = await createPage({
      title: "Hidden lifecycle sentinel",
      contentMarkdown: "# Hidden lifecycle sentinel",
      showInIndex: false
    });
    const expiredPageId = await createPage({
      title: "Expired lifecycle sentinel",
      contentMarkdown: "# Expired lifecycle sentinel"
    });
    getDatabase()
      .prepare("UPDATE notes SET destroy_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", expiredPageId);
    const deletedPageId = await createPage({
      title: "Deleted lifecycle sentinel",
      contentMarkdown: "# Deleted lifecycle sentinel"
    });
    const deletePage = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${deletedPageId}`,
      headers: { cookie }
    });
    assert.equal(deletePage.statusCode, 200);

    const defaultLifecycleList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?limit=500",
      headers: { cookie }
    });
    assert.equal(defaultLifecycleList.statusCode, 200);
    const defaultLifecycleIds = (
      defaultLifecycleList.json() as { pages: Array<{ id: string }> }
    ).pages.map((page) => page.id);
    assert.equal(defaultLifecycleIds.includes(hiddenPageId), false);
    assert.equal(defaultLifecycleIds.includes(expiredPageId), false);
    assert.equal(defaultLifecycleIds.includes(deletedPageId), false);

    const hiddenLifecycleList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?limit=500&includeHidden=true",
      headers: { cookie }
    });
    assert.equal(hiddenLifecycleList.statusCode, 200);
    const hiddenLifecycleIds = (
      hiddenLifecycleList.json() as { pages: Array<{ id: string }> }
    ).pages.map((page) => page.id);
    assert.equal(hiddenLifecycleIds.includes(hiddenPageId), true);
    assert.equal(hiddenLifecycleIds.includes(expiredPageId), false);
    assert.equal(hiddenLifecycleIds.includes(deletedPageId), false);

    const lifecycleSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "text", query: "lifecycle sentinel", limit: 50 }
    });
    assert.equal(lifecycleSearch.statusCode, 200);
    assert.deepEqual(lifecycleSearch.json().results, []);
    const lifecycleTree = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/tree?limit=500",
      headers: { cookie }
    });
    assert.equal(lifecycleTree.statusCode, 200);
    assert.doesNotMatch(
      lifecycleTree.body,
      /Hidden lifecycle sentinel|Expired lifecycle sentinel|Deleted lifecycle sentinel/
    );

    const treeSaturationPageId = await createPage({
      title: "ZZ tree saturation sentinel",
      contentMarkdown: "# ZZ tree saturation sentinel"
    });
    const treeSaturationPage = getDatabase()
      .prepare("SELECT space_id FROM notes WHERE id = ?")
      .get(treeSaturationPageId) as { space_id: string };
    const insertEvidence = getDatabase().prepare(
      `INSERT INTO notes (
         id, content_markdown, content_plain, author, source, kind, title, slug,
         space_id, aliases_json, summary, parent_slug, created_at, updated_at
       ) VALUES (?, ?, ?, 'test', 'manual', 'evidence', ?, ?, ?, '[]', '', NULL, ?, ?)`
    );
    const saturationTimestamp = "2026-07-15T10:00:00.000Z";
    for (let index = 0; index < 501; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const title = `AA evidence saturation ${suffix}`;
      insertEvidence.run(
        `note_tree_evidence_${suffix}`,
        `# ${title}`,
        title,
        title,
        `aa-evidence-saturation-${suffix}`,
        treeSaturationPage.space_id,
        saturationTimestamp,
        saturationTimestamp
      );
    }
    const saturatedTree = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/tree?spaceId=${encodeURIComponent(treeSaturationPage.space_id)}&limit=500`,
      headers: { cookie }
    });
    assert.equal(saturatedTree.statusCode, 200);
    assert.match(saturatedTree.body, /ZZ tree saturation sentinel/);

    for (const pageId of [expiredPageId, deletedPageId]) {
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/pages/${pageId}`,
        headers: { cookie }
      });
      assert.equal(detail.statusCode, 404);
    }
    for (const slug of [
      "expired-lifecycle-sentinel",
      "deleted-lifecycle-sentinel"
    ]) {
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/by-slug/${slug}`,
        headers: { cookie }
      });
      assert.equal(detail.statusCode, 404);
    }

    const invalidList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?limit=501",
      headers: { cookie }
    });
    assert.equal(invalidList.statusCode, 400);
    const terminalList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?limit=500&offset=9999",
      headers: { cookie }
    });
    assert.equal(terminalList.statusCode, 200);
    assert.equal(terminalList.json().hasMore, false);
    assert.equal(terminalList.json().nextOffset, null);
    const pastTerminalList = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/pages?offset=10000",
      headers: { cookie }
    });
    assert.equal(pastTerminalList.statusCode, 400);
    const invalidSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "text", query: "memory", offset: 1000 }
    });
    assert.equal(invalidSearch.statusCode, 400);
    const terminalSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "text", query: "memory", limit: 50, offset: 999 }
    });
    assert.equal(terminalSearch.statusCode, 200);
    assert.equal(terminalSearch.json().hasMore, false);
    assert.equal(terminalSearch.json().nextOffset, null);
    const oversizedQuery = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: { cookie },
      payload: { mode: "text", query: "x".repeat(501) }
    });
    assert.equal(oversizedQuery.statusCode, 400);

    const createSpace = async (label: string, ownerUserId: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/spaces",
        headers: { cookie },
        payload: { label, ownerUserId, visibility: "personal" }
      });
      assert.equal(response.statusCode, 201);
      return (response.json() as { space: { id: string } }).space.id;
    };
    const operatorSpaceId = await createSpace(
      "Operator private wiki",
      "user_operator"
    );
    const botSpaceId = await createSpace("Bot private wiki", "user_forge_bot");
    const operatorPageId = await createPage({
      title: "Operator private memory",
      contentMarkdown: "# Operator private memory\n\noperator-only-wiki-signal",
      spaceId: operatorSpaceId
    });
    const botPageId = await createPage({
      title: "Bot private memory",
      contentMarkdown: "# Bot private memory\n\nbot-only-wiki-signal",
      spaceId: botSpaceId
    });
    const backlinkTimestamp = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_link_edges (
          source_note_id, target_type, target_note_id, target_entity_type, target_entity_id,
          label, raw_target, is_embed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        botPageId,
        "page",
        operatorPageId,
        null,
        null,
        "Foreign private backlink",
        "BOT_BACKLINK_PRIVATE_SENTINEL",
        0,
        backlinkTimestamp,
        backlinkTimestamp
      );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Operator wiki read scope",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const authorization = { authorization: `Bearer ${token}` };

    const scopedSpaces = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/spaces",
      headers: authorization
    });
    assert.equal(scopedSpaces.statusCode, 200);
    const scopedSpaceIds = (
      scopedSpaces.json() as { spaces: Array<{ id: string }> }
    ).spaces.map((space) => space.id);
    assert.ok(scopedSpaceIds.includes("wiki_space_shared"));
    assert.ok(scopedSpaceIds.includes(operatorSpaceId));
    assert.equal(scopedSpaceIds.includes(botSpaceId), false);

    const scopedOwnedPage = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${operatorPageId}`,
      headers: authorization
    });
    assert.equal(scopedOwnedPage.statusCode, 200);
    assert.doesNotMatch(
      scopedOwnedPage.body,
      /BOT_BACKLINK_PRIVATE_SENTINEL|Foreign private backlink/
    );

    const forbiddenSpaceList = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages?spaceId=${encodeURIComponent(botSpaceId)}`,
      headers: authorization
    });
    assert.equal(forbiddenSpaceList.statusCode, 404);
    const forbiddenPage = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${botPageId}`,
      headers: authorization
    });
    assert.equal(forbiddenPage.statusCode, 404);
    const forbiddenSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: authorization,
      payload: {
        spaceId: botSpaceId,
        mode: "text",
        query: "bot-only-wiki-signal"
      }
    });
    assert.equal(forbiddenSearch.statusCode, 404);
    const scopedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: authorization,
      payload: { mode: "text", query: "bot-only-wiki-signal" }
    });
    assert.equal(scopedSearch.statusCode, 200, scopedSearch.body);
    assert.deepEqual(
      (scopedSearch.json() as { results: unknown[] }).results,
      []
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
