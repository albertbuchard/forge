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

test("wiki link navigation is lifecycle-aware, scoped, deduplicated, cyclic, and bounded", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-links-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createPage = async (input: {
      title: string;
      contentMarkdown: string;
      spaceId?: string;
    }) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: { cookie },
        payload: {
          ...input,
          summary: `Summary for ${input.title}`,
          links: []
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      return (response.json() as { page: { id: string; slug: string } }).page;
    };
    const readPage = async (id: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/pages/${id}`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json() as {
        outboundLinks: Array<{
          rawTarget: string;
          label: string;
          status: "available" | "missing" | "unavailable" | "unverified";
          targetPage: { id: string; slug: string; spaceId: string } | null;
          isSelfLink: boolean;
        }>;
        outboundLinksTruncated: boolean;
        outboundLinkLimit: number;
        backlinks: Array<{
          sourceNoteId: string;
          targetNoteId: string | null;
          label: string;
        }>;
        backlinksTruncated: boolean;
        backlinkLimit: number;
        backlinksBySourceId: Record<
          string,
          { id: string; slug: string; spaceId: string } | null
        >;
      };
    };

    const target = await createPage({
      title: "Target page",
      contentMarkdown: "# Target page"
    });
    const expiringTarget = await createPage({
      title: "Expiring target",
      contentMarkdown: "# Expiring target"
    });
    const deletedTarget = await createPage({
      title: "Deleted target",
      contentMarkdown: "# Deleted target"
    });
    const source = await createPage({
      title: "Source page",
      contentMarkdown: [
        "# Source page",
        "",
        "[[Target page|Primary citation]]",
        "[[Target page|Primary citation]]",
        "[[Target page|Secondary | context]]",
        "[[Source page|Self reference]]",
        "[[Missing page|Broken citation]]",
        "[[Expiring target|Expiring citation]]",
        "[[Deleted target|Deleted citation]]",
        "[[forge:task:task_plugin_surface|Plugin task]]"
      ].join("\n")
    });

    getDatabase()
      .prepare("UPDATE notes SET destroy_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", expiringTarget.id);
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${deletedTarget.id}`,
      headers: { cookie }
    });
    assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);

    const sourceDetail = await readPage(source.id);
    assert.deepEqual(
      sourceDetail.outboundLinks.map((link) => link.rawTarget).sort(),
      [
        "Deleted target",
        "Expiring target",
        "Missing page",
        "Source page",
        "Target page",
        "Target page",
        "forge:task:task_plugin_surface"
      ].sort()
    );
    assert.deepEqual(
      sourceDetail.outboundLinks
        .filter((link) => link.rawTarget === "Target page")
        .map((link) => link.label),
      ["Primary citation", "Secondary | context"]
    );
    const selfLink = sourceDetail.outboundLinks.find(
      (link) => link.rawTarget === "Source page"
    );
    assert.equal(selfLink?.status, "available");
    assert.equal(selfLink?.targetPage?.id, source.id);
    assert.equal(selfLink?.isSelfLink, true);
    assert.equal(
      sourceDetail.outboundLinks.find(
        (link) => link.rawTarget === "Missing page"
      )?.status,
      "missing"
    );
    assert.equal(
      sourceDetail.outboundLinks.find(
        (link) => link.rawTarget === "Expiring target"
      )?.status,
      "missing"
    );
    assert.equal(
      sourceDetail.outboundLinks.find(
        (link) => link.rawTarget === "Deleted target"
      )?.status,
      "unavailable"
    );
    assert.equal(
      sourceDetail.outboundLinks.find((link) =>
        link.rawTarget.startsWith("forge:task:")
      )?.status,
      "unverified"
    );
    assert.deepEqual(sourceDetail.backlinks, []);

    const targetDetail = await readPage(target.id);
    assert.deepEqual(
      targetDetail.backlinks.map((backlink) => backlink.label).sort(),
      ["Primary citation", "Secondary | context"]
    );
    assert.equal(targetDetail.backlinksBySourceId[source.id]?.id, source.id);

    const firstCyclePage = await createPage({
      title: "First cycle page",
      contentMarkdown: "# First cycle page\n\n[[Later cycle page|Future link]]"
    });
    const laterCyclePage = await createPage({
      title: "Later cycle page",
      contentMarkdown: "# Later cycle page\n\n[[First cycle page|Return link]]"
    });
    const refreshedFirstCycle = await readPage(firstCyclePage.id);
    assert.equal(refreshedFirstCycle.outboundLinks[0]?.status, "available");
    assert.equal(
      refreshedFirstCycle.outboundLinks[0]?.targetPage?.id,
      laterCyclePage.id
    );
    const laterCycleDetail = await readPage(laterCyclePage.id);
    assert.equal(
      laterCycleDetail.backlinks.some(
        (backlink) => backlink.sourceNoteId === firstCyclePage.id
      ),
      true
    );

    const personalSpaceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/spaces",
      headers: { cookie },
      payload: {
        label: "Other personal space",
        ownerUserId: "user_forge_bot",
        visibility: "personal"
      }
    });
    assert.equal(personalSpaceResponse.statusCode, 201);
    const personalSpaceId = (
      personalSpaceResponse.json() as { space: { id: string } }
    ).space.id;
    await createPage({
      title: "Cross-space secret",
      contentMarkdown: "# Cross-space secret",
      spaceId: personalSpaceId
    });
    const crossSpaceSource = await createPage({
      title: "Cross-space source",
      contentMarkdown:
        "# Cross-space source\n\n[[Cross-space secret|Private citation]]"
    });
    const crossSpaceDetail = await readPage(crossSpaceSource.id);
    assert.equal(crossSpaceDetail.outboundLinks[0]?.status, "missing");
    assert.equal(crossSpaceDetail.outboundLinks[0]?.targetPage, null);

    const largeOutboundSource = await createPage({
      title: "Large outbound source",
      contentMarkdown: [
        "# Large outbound source",
        ...Array.from(
          { length: 502 },
          (_, index) => `[[Missing target ${index}|Citation ${index}]]`
        )
      ].join("\n")
    });
    const largeOutboundDetail = await readPage(largeOutboundSource.id);
    assert.equal(largeOutboundDetail.outboundLinks.length, 500);
    assert.equal(largeOutboundDetail.outboundLinkLimit, 500);
    assert.equal(largeOutboundDetail.outboundLinksTruncated, true);

    const backlinkTarget = await createPage({
      title: "Backlink bound target",
      contentMarkdown: "# Backlink bound target"
    });
    for (let index = 0; index < 102; index += 1) {
      await createPage({
        title: `Backlink source ${index}`,
        contentMarkdown: `# Backlink source ${index}\n\n[[Backlink bound target|Citation ${index}]]`
      });
    }
    const boundedBacklinks = await readPage(backlinkTarget.id);
    assert.equal(boundedBacklinks.backlinks.length, 100);
    assert.equal(boundedBacklinks.backlinkLimit, 100);
    assert.equal(boundedBacklinks.backlinksTruncated, true);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
