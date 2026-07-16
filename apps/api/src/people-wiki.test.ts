import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import type { PersonEntityAuthorizationCallback } from "./people-types.js";
import {
  PeopleAuthorizationError,
  PersonConflictError,
  PersonNotFoundError,
  createPerson,
  getPersonById,
  listAuthorizedPersonLinks,
  listPeople,
  replaceAuthorizedPersonLinks,
  upsertAuthorizedPersonLink,
  updatePerson
} from "./repositories/people.js";
import {
  applyWikiPersonAssociationDecisions,
  applyWikiPersonAssociationDecision,
  applyWikiPersonAssociationPreview,
  getPersonContextReadModel,
  previewWikiPersonAssociationDecisions,
  scanWikiPeopleCandidates
} from "./services/people.js";

async function withTemporaryDatabase(
  operation: () => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-people-wiki-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  try {
    await operation();
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function insertUser(id: string, handle: string): void {
  const now = "2026-07-15T08:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color, created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#c0c1ff', ?, ?)`
    )
    .run(id, handle, handle, now, now);
}

function insertWikiSpace(id: string, slug: string, ownerUserId: string): void {
  const now = "2026-07-15T08:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO wiki_spaces (
         id, slug, label, description, owner_user_id, visibility, created_at, updated_at
       ) VALUES (?, ?, ?, '', ?, 'personal', ?, ?)`
    )
    .run(id, slug, slug, ownerUserId, now, now);
}

function insertWikiPage(input: {
  id: string;
  spaceId: string;
  title: string;
  slug: string;
  parentSlug: string | null;
  aliases?: string[];
  summary?: string;
  content?: string;
}): void {
  const now = "2026-07-15T08:30:00.000Z";
  const content =
    input.content ?? `# ${input.title}\n\nSynthetic profile fixture.`;
  getDatabase()
    .prepare(
      `INSERT INTO notes (
         id, content_markdown, content_plain, author, source, kind, title, slug,
         space_id, aliases_json, summary, parent_slug, created_at, updated_at
       ) VALUES (?, ?, ?, 'test', 'manual', 'wiki', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      content,
      content,
      input.title,
      input.slug,
      input.spaceId,
      JSON.stringify(input.aliases ?? []),
      input.summary ?? "",
      input.parentSlug,
      now,
      now
    );
}

function markWikiPageDeleted(noteId: string): void {
  const now = "2026-07-15T08:45:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO deleted_entities (
         entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor,
         deleted_source, delete_reason, snapshot_json
       ) VALUES ('note', ?, 'Deleted', '', ?, 'test', 'test', '', '{}')`
    )
    .run(noteId, now);
}

test("Wiki People discovery is bounded, ambiguity-aware, idempotent, and non-destructive", async () => {
  await withTemporaryDatabase(() => {
    insertUser("user_second", "second");
    insertWikiSpace("space_owner", "owner-people", "user_operator");
    insertWikiSpace("space_second", "second-people", "user_second");
    insertWikiPage({
      id: "note_people_root",
      spaceId: "space_owner",
      title: "People",
      slug: "people",
      parentSlug: null
    });
    insertWikiPage({
      id: "note_jon",
      spaceId: "space_owner",
      title: "Jon",
      slug: "jon",
      parentSlug: "people",
      aliases: ["Johnny"],
      summary: "Friend from Geneva.",
      content: "# Jon\n\nPrivate synthetic profile content."
    });
    insertWikiPage({
      id: "note_jon_duplicate",
      spaceId: "space_owner",
      title: "Jon",
      slug: "jon-duplicate",
      parentSlug: "people"
    });
    insertWikiPage({
      id: "note_sam_nested",
      spaceId: "space_owner",
      title: "Sam",
      slug: "sam",
      parentSlug: "jon",
      aliases: ["Samantha"]
    });
    insertWikiPage({
      id: "note_deleted",
      spaceId: "space_owner",
      title: "Deleted Person",
      slug: "deleted-person",
      parentSlug: "people"
    });
    markWikiPageDeleted("note_deleted");
    insertWikiPage({
      id: "note_second_root",
      spaceId: "space_second",
      title: "People",
      slug: "people",
      parentSlug: null
    });
    insertWikiPage({
      id: "note_second_private",
      spaceId: "space_second",
      title: "Second Owner Person",
      slug: "second-owner-person",
      parentSlug: "people"
    });

    const jonOne = createPerson({
      userId: "user_operator",
      displayName: "Jon",
      aliases: [{ alias: "Johnny", kind: "nickname" }]
    });
    const jonTwo = createPerson({
      userId: "user_operator",
      displayName: "Jon"
    });
    const secondOwnerJon = createPerson({
      userId: "user_second",
      displayName: "Jon"
    });

    const allowedNotes = new Set([
      "note_people_root",
      "note_jon",
      "note_jon_duplicate",
      "note_sam_nested"
    ]);
    const authorize: PersonEntityAuthorizationCallback = (request) => {
      if (request.entityType === "note") {
        return allowedNotes.has(request.entityId);
      }
      if (request.entityType === "person") {
        return Boolean(
          getPersonById(request.entityId, request.userId, {
            includeDeleted: true
          })
        );
      }
      return false;
    };
    const dependencies = {
      authorizeEntity: authorize,
      now: () => new Date("2026-07-15T10:00:00.000Z")
    };

    const scan = scanWikiPeopleCandidates(
      { userId: "user_operator", limit: 20 },
      dependencies
    );
    assert.equal(scan.rootCount, 1);
    assert.equal(scan.scannedCount, 3);
    assert.deepEqual(
      scan.candidates.map((candidate) => candidate.noteId).sort(),
      ["note_jon", "note_jon_duplicate", "note_sam_nested"]
    );
    assert.equal(
      scan.candidates.some((candidate) => candidate.noteId === "note_deleted"),
      false
    );
    assert.equal(
      scan.candidates.some(
        (candidate) => candidate.noteId === "note_second_private"
      ),
      false
    );
    const jonCandidate = scan.candidates.find(
      (candidate) => candidate.noteId === "note_jon"
    )!;
    assert.equal(jonCandidate.status, "ambiguous");
    assert.deepEqual(
      jonCandidate.matchingPersonIds.sort(),
      [jonOne.id, jonTwo.id].sort()
    );
    assert.equal(
      jonCandidate.matchingPersonIds.includes(secondOwnerJon.id),
      false
    );
    assert.deepEqual(jonCandidate.duplicateCandidateNoteIds, [
      "note_jon_duplicate"
    ]);

    const noteBefore = getDatabase()
      .prepare(
        `SELECT title, slug, aliases_json, summary, content_markdown, content_plain,
                parent_slug, updated_at
         FROM notes WHERE id = 'note_jon'`
      )
      .get();
    const associated = applyWikiPersonAssociationDecision(
      {
        userId: "user_operator",
        actor: "people-wiki-test",
        decision: {
          action: "associate",
          candidateNoteId: "note_jon",
          personId: jonOne.id
        }
      },
      dependencies
    );
    assert.equal(associated.status, "associated");
    assert.equal(associated.linkCreated, true);
    const repeated = applyWikiPersonAssociationDecision(
      {
        userId: "user_operator",
        actor: "people-wiki-test",
        decision: {
          action: "associate",
          candidateNoteId: "note_jon",
          personId: jonOne.id
        }
      },
      dependencies
    );
    assert.equal(repeated.status, "already_associated");
    assert.equal(repeated.linkCreated, false);
    const linkCount = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM entity_links
           WHERE source_entity_type = 'person' AND source_entity_id = ?
             AND target_entity_type = 'note' AND target_entity_id = 'note_jon'
             AND relationship = 'profile_page'`
        )
        .get(jonOne.id) as { count: number }
    ).count;
    assert.equal(linkCount, 1);
    const noteAfter = getDatabase()
      .prepare(
        `SELECT title, slug, aliases_json, summary, content_markdown, content_plain,
                parent_slug, updated_at
         FROM notes WHERE id = 'note_jon'`
      )
      .get();
    assert.deepEqual(noteAfter, noteBefore);

    assert.throws(
      () =>
        applyWikiPersonAssociationDecision(
          {
            userId: "user_operator",
            decision: {
              action: "associate",
              candidateNoteId: "note_jon",
              personId: jonTwo.id
            }
          },
          dependencies
        ),
      PersonConflictError
    );
    assert.throws(
      () =>
        applyWikiPersonAssociationDecision(
          {
            userId: "user_operator",
            decision: {
              action: "associate",
              candidateNoteId: "note_jon_duplicate",
              personId: secondOwnerJon.id
            }
          },
          dependencies
        ),
      PersonNotFoundError
    );

    const created = applyWikiPersonAssociationDecision(
      {
        userId: "user_operator",
        decision: {
          action: "create",
          candidateNoteId: "note_sam_nested",
          person: { relationshipCategory: "friend" }
        }
      },
      dependencies
    );
    assert.equal(created.status, "created");
    const createdPerson = getPersonById(created.personId!, "user_operator")!;
    assert.equal(createdPerson.displayName, "Sam");
    assert.deepEqual(
      createdPerson.aliases.map((alias) => alias.alias),
      ["Samantha"]
    );
    const repeatedCreate = applyWikiPersonAssociationDecision(
      {
        userId: "user_operator",
        decision: {
          action: "create",
          candidateNoteId: "note_sam_nested",
          person: {}
        }
      },
      dependencies
    );
    assert.equal(repeatedCreate.status, "already_associated");
    assert.equal(repeatedCreate.personId, created.personId);
    assert.equal(
      listPeople({ userId: "user_operator", q: "Sam" }).people.length,
      1
    );

    const skipped = applyWikiPersonAssociationDecision(
      {
        userId: "user_operator",
        decision: {
          action: "skip",
          candidateNoteId: "note_jon_duplicate"
        }
      },
      dependencies
    );
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.personId, null);

    const context = getPersonContextReadModel(
      { userId: "user_operator", personId: jonOne.id },
      dependencies
    );
    assert.equal(context?.profilePageLinks.length, 1);
    assert.equal(context?.profilePageLinks[0]!.targetEntityId, "note_jon");
  });
});

test("injected link authorization blocks cross-owner targets and preserves quarantined legacy links", async () => {
  await withTemporaryDatabase(() => {
    const person = createPerson({
      userId: "user_operator",
      displayName: "Authorized Person"
    });
    const authorize: PersonEntityAuthorizationCallback = (request) =>
      (request.entityType === "person" && request.entityId === person.id) ||
      (request.entityType === "note" && request.entityId === "note_allowed");

    assert.throws(
      () =>
        upsertAuthorizedPersonLink(
          {
            userId: "user_operator",
            personId: person.id,
            link: {
              targetEntityType: "note",
              targetEntityId: "note_hidden",
              relationship: "profile_page"
            }
          },
          authorize
        ),
      PeopleAuthorizationError
    );
    const now = "2026-07-15T11:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type, target_entity_id,
           anchor_key, relationship, created_by_actor, created_at
         ) VALUES ('person', ?, 'note', 'note_hidden', '', 'legacy', 'legacy', ?)`
      )
      .run(person.id, now);
    const replacement = replaceAuthorizedPersonLinks(
      {
        userId: "user_operator",
        personId: person.id,
        links: [
          {
            targetEntityType: "note",
            targetEntityId: "note_allowed",
            relationship: "profile_page"
          }
        ]
      },
      authorize,
      { now: new Date(now) }
    );
    assert.equal(replacement.preservedUnauthorizedCount, 1);
    assert.deepEqual(
      replacement.links.map((link) => link.targetEntityId),
      ["note_allowed"]
    );
    const storedTargets = (
      getDatabase()
        .prepare(
          `SELECT target_entity_id
           FROM entity_links
           WHERE source_entity_type = 'person' AND source_entity_id = ?
           ORDER BY target_entity_id`
        )
        .all(person.id) as Array<{ target_entity_id: string }>
    ).map((row) => row.target_entity_id);
    assert.deepEqual(storedTargets, ["note_allowed", "note_hidden"]);
    assert.deepEqual(
      listAuthorizedPersonLinks(
        { userId: "user_operator", personId: person.id },
        authorize
      ).map((link) => link.targetEntityId),
      ["note_allowed"]
    );
  });
});

test("Wiki association previews bind versions and apply atomically with durable idempotency", async () => {
  await withTemporaryDatabase(() => {
    insertWikiSpace("space_preview", "preview-people", "user_operator");
    insertWikiPage({
      id: "note_preview_root",
      spaceId: "space_preview",
      title: "People",
      slug: "people",
      parentSlug: null
    });
    for (const [id, title, slug] of [
      ["note_preview_alice", "Alice", "alice"],
      ["note_preview_bob", "Bob", "bob"],
      ["note_preview_charlie", "Charlie", "charlie"]
    ] as const) {
      insertWikiPage({
        id,
        spaceId: "space_preview",
        title,
        slug,
        parentSlug: "people"
      });
    }

    const alice = createPerson(
      { userId: "user_operator", displayName: "Alice Existing" },
      {
        id: "person_preview_alice",
        now: new Date("2026-07-15T09:00:00.000Z")
      }
    );
    const alternate = createPerson(
      { userId: "user_operator", displayName: "Alternate Existing" },
      {
        id: "person_preview_alternate",
        now: new Date("2026-07-15T09:00:00.000Z")
      }
    );
    const allowedNotes = new Set([
      "note_preview_root",
      "note_preview_alice",
      "note_preview_bob",
      "note_preview_charlie"
    ]);
    const authorize: PersonEntityAuthorizationCallback = (request) =>
      request.entityType === "note"
        ? allowedNotes.has(request.entityId)
        : request.entityType === "person"
          ? Boolean(
              getPersonById(request.entityId, request.userId, {
                includeDeleted: true
              })
            )
          : false;
    let clock = new Date("2026-07-15T10:00:00.000Z");
    const dependencies = {
      authorizeEntity: authorize,
      now: () => new Date(clock.getTime())
    };

    const firstScan = scanWikiPeopleCandidates(
      { userId: "user_operator", limit: 20 },
      dependencies
    );
    const aliceCandidate = firstScan.candidates.find(
      (candidate) => candidate.noteId === "note_preview_alice"
    )!;
    const firstDecision = {
      action: "associate" as const,
      candidateNoteId: aliceCandidate.noteId,
      personId: alice.id,
      expectedWikiVersion: aliceCandidate.updatedAt,
      expectedPersonVersion: alice.updatedAt
    };
    const firstPreview = previewWikiPersonAssociationDecisions(
      {
        userId: "user_operator",
        actor: "people-preview-test",
        decisions: [firstDecision]
      },
      dependencies
    );
    assert.equal(
      firstPreview.decisions[0]!.candidateNoteId,
      aliceCandidate.noteId
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT status FROM people_wiki_association_previews WHERE id = ?`
          )
          .get(firstPreview.previewId) as { status: string }
      ).status,
      "active"
    );

    assert.throws(
      () =>
        applyWikiPersonAssociationPreview(
          {
            userId: "user_operator",
            previewId: firstPreview.previewId,
            previewHash: firstPreview.previewHash,
            idempotencyKey: "wiki-preview-tamper-0001",
            actor: "people-preview-test",
            decisions: [
              {
                ...firstDecision,
                personId: alternate.id,
                expectedPersonVersion: alternate.updatedAt
              }
            ]
          },
          dependencies
        ),
      PersonConflictError
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_links
             WHERE target_entity_id = 'note_preview_alice'
               AND relationship = 'profile_page'`
          )
          .get() as { count: number }
      ).count,
      0
    );

    getDatabase()
      .prepare(`UPDATE notes SET title = ?, updated_at = ? WHERE id = ?`)
      .run("Alice Updated", "2026-07-15T10:00:01.000Z", "note_preview_alice");
    assert.throws(
      () =>
        applyWikiPersonAssociationPreview(
          {
            userId: "user_operator",
            previewId: firstPreview.previewId,
            previewHash: firstPreview.previewHash,
            idempotencyKey: "wiki-preview-stale-00001",
            actor: "people-preview-test",
            decisions: firstPreview.decisions
          },
          dependencies
        ),
      PersonConflictError
    );

    clock = new Date("2026-07-15T10:01:00.000Z");
    const freshCandidate = scanWikiPeopleCandidates(
      { userId: "user_operator", limit: 20 },
      dependencies
    ).candidates.find(
      (candidate) => candidate.noteId === "note_preview_alice"
    )!;
    const freshDecision = {
      ...firstDecision,
      expectedWikiVersion: freshCandidate.updatedAt
    };
    const freshPreview = previewWikiPersonAssociationDecisions(
      {
        userId: "user_operator",
        actor: "people-preview-test",
        decisions: [freshDecision]
      },
      dependencies
    );
    const applyInput = {
      userId: "user_operator",
      previewId: freshPreview.previewId,
      previewHash: freshPreview.previewHash,
      idempotencyKey: "wiki-preview-apply-00001",
      actor: "people-preview-test",
      decisions: freshPreview.decisions
    };
    const applied = applyWikiPersonAssociationPreview(applyInput, dependencies);
    assert.equal(applied.replayed, false);
    assert.equal(applied.results[0]!.status, "associated");
    const replayed = applyWikiPersonAssociationPreview(
      applyInput,
      dependencies
    );
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.results, applied.results);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_links
             WHERE source_entity_id = ? AND target_entity_id = ?
               AND relationship = 'profile_page'`
          )
          .get(alice.id, "note_preview_alice") as { count: number }
      ).count,
      1
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT status FROM people_wiki_association_previews WHERE id = ?`
          )
          .get(freshPreview.previewId) as { status: string }
      ).status,
      "consumed"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM peer_idempotency_records
             WHERE owner_user_id = 'user_operator'
               AND operation_id = 'people.wiki-associations.apply'`
          )
          .get() as { count: number }
      ).count,
      1
    );
    assert.throws(
      () =>
        applyWikiPersonAssociationPreview(
          { ...applyInput, actor: "tampered-actor" },
          dependencies
        ),
      PersonConflictError
    );
    assert.throws(
      () =>
        applyWikiPersonAssociationPreview(
          { ...applyInput, idempotencyKey: "wiki-preview-apply-00002" },
          dependencies
        ),
      PersonConflictError
    );

    const bobCandidate = scanWikiPeopleCandidates(
      { userId: "user_operator", limit: 20 },
      dependencies
    ).candidates.find((candidate) => candidate.noteId === "note_preview_bob")!;
    const alternateBefore = getPersonById(alternate.id, alternate.userId)!;
    const stalePersonPreview = previewWikiPersonAssociationDecisions(
      {
        userId: "user_operator",
        decisions: [
          {
            action: "associate",
            candidateNoteId: bobCandidate.noteId,
            personId: alternate.id,
            expectedWikiVersion: bobCandidate.updatedAt,
            expectedPersonVersion: alternateBefore.updatedAt
          }
        ]
      },
      dependencies
    );
    updatePerson(
      alternate.id,
      alternate.userId,
      {
        shortDescription: "changed after preview",
        expectedUpdatedAt: alternateBefore.updatedAt
      },
      { now: clock }
    );
    assert.throws(
      () =>
        applyWikiPersonAssociationPreview(
          {
            userId: "user_operator",
            previewId: stalePersonPreview.previewId,
            previewHash: stalePersonPreview.previewHash,
            idempotencyKey: "wiki-preview-person-0001",
            decisions: stalePersonPreview.decisions
          },
          dependencies
        ),
      PersonConflictError
    );

    assert.throws(
      () =>
        applyWikiPersonAssociationDecisions(
          {
            userId: "user_operator",
            atomic: true,
            decisions: [
              {
                action: "create",
                candidateNoteId: "note_preview_bob",
                person: {}
              },
              {
                action: "associate",
                candidateNoteId: "note_preview_charlie",
                personId: "person_missing"
              }
            ]
          },
          dependencies
        ),
      PersonNotFoundError
    );
    assert.equal(
      listPeople({ userId: "user_operator", q: "Bob" }).people.length,
      0
    );
    assert.throws(
      () =>
        applyWikiPersonAssociationDecisions(
          {
            userId: "user_operator",
            atomic: false,
            decisions: [{ action: "skip", candidateNoteId: "note_preview_bob" }]
          } as never,
          dependencies
        ),
      /Invalid literal|expected true/i
    );

    clock = new Date("2026-07-16T10:01:00.000Z");
    assert.throws(
      () => applyWikiPersonAssociationPreview(applyInput, dependencies),
      /terminal state/
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM peer_idempotency_records
             WHERE owner_user_id = 'user_operator'
               AND operation_id = 'people.wiki-associations.apply'
               AND idempotency_key = 'wiki-preview-apply-00001'`
          )
          .get() as { count: number }
      ).count,
      1,
      "expired idempotency reads must not delete durable records"
    );
  });
});
