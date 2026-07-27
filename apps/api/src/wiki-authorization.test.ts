import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

const operatorCookie = issueTestOperatorSessionCookie;

test("wiki writes, maintenance, and ingest jobs enforce personal-space authorization", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-auth-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await operatorCookie(app);
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
    const ownSpaceId = await createSpace(
      "Scoped operator Wiki",
      "user_operator"
    );
    const foreignSpaceId = await createSpace(
      "Foreign bot Wiki",
      "user_forge_bot"
    );
    const createPage = async (spaceId: string, title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: { cookie },
        payload: {
          spaceId,
          title,
          contentMarkdown: `# ${title}\n\nprivate-wiki-body`,
          summary: "private-wiki-summary",
          links: []
        }
      });
      assert.equal(response.statusCode, 201);
      return (response.json() as { page: { id: string } }).page.id;
    };
    const ownPageId = await createPage(ownSpaceId, "Owned wiki page");
    const foreignPageId = await createPage(
      foreignSpaceId,
      "FOREIGN_PAGE_TITLE_SENTINEL"
    );
    const foreignHome = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/home?spaceId=${encodeURIComponent(foreignSpaceId)}`,
      headers: { cookie }
    });
    assert.equal(foreignHome.statusCode, 200);
    const foreignHomeId = (foreignHome.json() as { page: { id: string } }).page
      .id;

    const foreignJobResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: { cookie },
      payload: {
        spaceId: foreignSpaceId,
        titleHint: "FOREIGN_JOB_TITLE_SENTINEL",
        sourceKind: "raw_text",
        sourceText: "Foreign ingest source",
        entityProposalMode: "none"
      }
    });
    assert.equal(foreignJobResponse.statusCode, 201, foreignJobResponse.body);
    const foreignJobId = (
      foreignJobResponse.json() as { job: { job: { id: string } } }
    ).job.job.id;

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Scoped wiki writer",
        scopes: ["read", "write"],
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

    const unauthenticatedForeignNote = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${foreignPageId}`
    });
    assert.equal(unauthenticatedForeignNote.statusCode, 401);

    const scopedForeignNote = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${foreignPageId}`,
      headers: authorization
    });
    assert.equal(scopedForeignNote.statusCode, 404);
    assert.doesNotMatch(scopedForeignNote.body, /FOREIGN_PAGE_TITLE_SENTINEL/);

    const scopedNoteList = await app.inject({
      method: "GET",
      url: "/api/v1/notes",
      headers: authorization
    });
    assert.equal(scopedNoteList.statusCode, 200);
    assert.doesNotMatch(scopedNoteList.body, /FOREIGN_PAGE_TITLE_SENTINEL/);

    const blockedLegacyNoteCreate = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: authorization,
      payload: {
        spaceId: foreignSpaceId,
        title: "Blocked legacy note",
        contentMarkdown: "# Blocked legacy note"
      }
    });
    assert.equal(blockedLegacyNoteCreate.statusCode, 404);

    const blockedLegacyNoteUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${foreignPageId}`,
      headers: authorization,
      payload: { summary: "Blocked legacy update" }
    });
    assert.equal(blockedLegacyNoteUpdate.statusCode, 404);

    const blockedLegacyNoteDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/notes/${foreignPageId}`,
      headers: authorization
    });
    assert.equal(blockedLegacyNoteDelete.statusCode, 404);

    const batchForeignSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: authorization,
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [foreignPageId],
            limit: 10
          }
        ]
      }
    });
    assert.equal(batchForeignSearch.statusCode, 200);
    const batchForeignSearchBody = batchForeignSearch.json() as {
      results: Array<{ matches?: Array<{ id: string }> }>;
    };
    assert.deepEqual(batchForeignSearchBody.results[0]?.matches, []);
    assert.doesNotMatch(batchForeignSearch.body, /FOREIGN_PAGE_TITLE_SENTINEL/);

    for (const response of [
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/create",
        headers: authorization,
        payload: {
          operations: [
            {
              entityType: "note",
              data: {
                spaceId: foreignSpaceId,
                title: "Blocked foreign batch note",
                contentMarkdown: "# Blocked foreign batch note"
              }
            }
          ]
        }
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/update",
        headers: authorization,
        payload: {
          operations: [
            {
              entityType: "note",
              id: foreignPageId,
              patch: { summary: "Blocked foreign batch update" }
            }
          ]
        }
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: authorization,
        payload: {
          operations: [{ entityType: "note", id: foreignPageId }]
        }
      })
    ]) {
      assert.equal(response.statusCode, 200, response.body);
      const result = (
        response.json() as {
          results: Array<{ ok: boolean; error?: { code: string } }>;
        }
      ).results[0];
      assert.equal(result?.ok, false);
      assert.match(
        result?.error?.code ?? "",
        /wiki_space_not_found|note_not_found/
      );
      assert.doesNotMatch(response.body, /FOREIGN_PAGE_TITLE_SENTINEL/);
    }

    const allowedBatchNoteCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: authorization,
      payload: {
        operations: [
          {
            entityType: "note",
            data: {
              spaceId: ownSpaceId,
              title: "Owned batch note",
              contentMarkdown: "# Owned batch note"
            }
          }
        ]
      }
    });
    assert.equal(allowedBatchNoteCreate.statusCode, 200);
    assert.equal(
      (
        allowedBatchNoteCreate.json() as {
          results: Array<{ ok: boolean }>;
        }
      ).results[0]?.ok,
      true
    );

    const allowedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: authorization,
      payload: {
        spaceId: ownSpaceId,
        title: "Scoped writer page",
        contentMarkdown: "# Scoped writer page",
        links: []
      }
    });
    assert.equal(allowedCreate.statusCode, 201, allowedCreate.body);
    const deletablePageId = (allowedCreate.json() as { page: { id: string } })
      .page.id;

    const foreignRequests = [
      await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: authorization,
        payload: {
          spaceId: foreignSpaceId,
          title: "Blocked foreign page",
          contentMarkdown: "# Blocked foreign page",
          links: []
        }
      }),
      await app.inject({
        method: "PATCH",
        url: `/api/v1/wiki/pages/${foreignPageId}`,
        headers: authorization,
        payload: { title: "Blocked title change" }
      }),
      await app.inject({
        method: "DELETE",
        url: `/api/v1/wiki/pages/${foreignPageId}`,
        headers: authorization
      }),
      await app.inject({
        method: "DELETE",
        url: `/api/v1/wiki/pages/${foreignHomeId}`,
        headers: authorization
      }),
      await app.inject({
        method: "GET",
        url: `/api/v1/wiki/health?spaceId=${encodeURIComponent(foreignSpaceId)}`,
        headers: authorization
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/wiki/sync",
        headers: authorization,
        payload: { spaceId: foreignSpaceId }
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/wiki/reindex",
        headers: authorization,
        payload: { spaceId: foreignSpaceId }
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/wiki/ingest-jobs",
        headers: authorization,
        payload: {
          spaceId: foreignSpaceId,
          titleHint: "Blocked foreign ingest",
          sourceKind: "local_path",
          sourcePath: "/private/foreign/source.txt"
        }
      })
    ];
    for (const response of foreignRequests) {
      assert.equal(response.statusCode, 404, response.body);
      assert.doesNotMatch(
        response.body,
        /FOREIGN_PAGE_TITLE_SENTINEL|FOREIGN_JOB_TITLE_SENTINEL|private\/foreign|home page cannot be deleted/i
      );
    }

    const blockedMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/wiki/pages/${ownPageId}`,
      headers: authorization,
      payload: { spaceId: foreignSpaceId, title: "Should not move" }
    });
    assert.equal(blockedMove.statusCode, 404);
    const ownPageAfterMove = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${ownPageId}`,
      headers: authorization
    });
    assert.equal(ownPageAfterMove.statusCode, 200);
    assert.equal(
      (ownPageAfterMove.json() as { page: { spaceId: string; title: string } })
        .page.spaceId,
      ownSpaceId
    );
    assert.equal(
      (ownPageAfterMove.json() as { page: { title: string } }).page.title,
      "Owned wiki page"
    );

    for (const route of ["sync", "reindex"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/wiki/${route}`,
        headers: authorization,
        payload: {}
      });
      assert.equal(response.statusCode, 400, response.body);
    }

    const blockedOwnerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/spaces",
      headers: authorization,
      payload: {
        label: "Blocked owner space",
        ownerUserId: "user_forge_bot",
        visibility: "personal"
      }
    });
    assert.equal(blockedOwnerCreate.statusCode, 403);

    const blockedUserIngest = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: authorization,
      payload: {
        userId: "user_forge_bot",
        sourceKind: "raw_text",
        sourceText: "blocked"
      }
    });
    assert.equal(blockedUserIngest.statusCode, 403);

    const boundary = "forge-wiki-auth-boundary";
    const multipartPayload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="spaceId"',
        "",
        foreignSpaceId,
        `--${boundary}`,
        'Content-Disposition: form-data; name="titleHint"',
        "",
        "FOREIGN_UPLOAD_TITLE_SENTINEL",
        `--${boundary}--`,
        ""
      ].join("\r\n")
    );
    const blockedUpload = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs/uploads",
      headers: {
        ...authorization,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartPayload
    });
    assert.equal(blockedUpload.statusCode, 404, blockedUpload.body);
    assert.doesNotMatch(blockedUpload.body, /FOREIGN_UPLOAD_TITLE_SENTINEL/);

    const scopedJobs = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/ingest-jobs",
      headers: authorization
    });
    assert.equal(scopedJobs.statusCode, 200);
    assert.equal(scopedJobs.body.includes(foreignJobId), false);
    assert.equal(scopedJobs.body.includes("FOREIGN_JOB_TITLE_SENTINEL"), false);
    assert.equal(scopedJobs.body.includes(rootDir), false);
    const explicitForeignJobs = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/ingest-jobs?spaceId=${encodeURIComponent(foreignSpaceId)}`,
      headers: authorization
    });
    assert.equal(explicitForeignJobs.statusCode, 404);

    const foreignJobRequests = [
      await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${foreignJobId}`,
        headers: authorization
      }),
      await app.inject({
        method: "POST",
        url: `/api/v1/wiki/ingest-jobs/${foreignJobId}/rerun`,
        headers: authorization
      }),
      await app.inject({
        method: "POST",
        url: `/api/v1/wiki/ingest-jobs/${foreignJobId}/resume`,
        headers: authorization
      }),
      await app.inject({
        method: "DELETE",
        url: `/api/v1/wiki/ingest-jobs/${foreignJobId}`,
        headers: authorization
      }),
      await app.inject({
        method: "POST",
        url: `/api/v1/wiki/ingest-jobs/${foreignJobId}/review`,
        headers: authorization,
        payload: { decisions: [] }
      })
    ];
    for (const response of foreignJobRequests) {
      assert.equal(response.statusCode, 404, response.body);
      assert.doesNotMatch(
        response.body,
        new RegExp(
          `FOREIGN_JOB_TITLE_SENTINEL|${rootDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
        )
      );
    }

    const operatorSoftDeleteForeignNote = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "note", id: foreignPageId, mode: "soft" }]
      }
    });
    assert.equal(operatorSoftDeleteForeignNote.statusCode, 200);
    assert.equal(
      (
        operatorSoftDeleteForeignNote.json() as {
          results: Array<{ ok: boolean }>;
        }
      ).results[0]?.ok,
      true
    );

    const scopedDeletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: authorization,
      payload: {
        searches: [
          {
            entityTypes: ["note"],
            ids: [foreignPageId],
            includeDeleted: true,
            limit: 10
          }
        ]
      }
    });
    assert.equal(scopedDeletedSearch.statusCode, 200);
    assert.deepEqual(
      (
        scopedDeletedSearch.json() as {
          results: Array<{ matches?: Array<{ id: string }> }>;
        }
      ).results[0]?.matches,
      []
    );
    assert.doesNotMatch(
      scopedDeletedSearch.body,
      /FOREIGN_PAGE_TITLE_SENTINEL/
    );

    const scopedBin = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: authorization
    });
    assert.equal(scopedBin.statusCode, 403);
    assert.equal(scopedBin.json().code, "gateway_profile_forbidden");
    assert.doesNotMatch(scopedBin.body, /FOREIGN_PAGE_TITLE_SENTINEL/);

    const blockedRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: authorization,
      payload: {
        operations: [{ entityType: "note", id: foreignPageId }]
      }
    });
    assert.equal(blockedRestore.statusCode, 200);
    const blockedRestoreResult = (
      blockedRestore.json() as {
        results: Array<{ ok: boolean; error?: { code: string } }>;
      }
    ).results[0];
    assert.equal(blockedRestoreResult?.ok, false);
    assert.equal(blockedRestoreResult?.error?.code, "note_not_found");
    assert.doesNotMatch(blockedRestore.body, /FOREIGN_PAGE_TITLE_SENTINEL/);

    const allowedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${deletablePageId}`,
      headers: authorization
    });
    assert.equal(allowedDelete.statusCode, 200, allowedDelete.body);
    assert.deepEqual(allowedDelete.json(), {
      deleted: { id: deletablePageId }
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
