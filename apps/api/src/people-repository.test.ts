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
import {
  PeopleAuthorizationError,
  PersonConflictError,
  PersonNotFoundError,
  addPersonAlias,
  addPersonContactMethod,
  addPersonFact,
  bindPersonToActor,
  createPeopleIdempotencyRecord,
  createPerson,
  deletePersonAlias,
  getPersonById,
  getPersonByIdAcrossOwners,
  getPeopleByIdsForUser,
  getPeopleIdempotencyRecord,
  hardDeletePerson,
  listPeople,
  listPersonActorBindings,
  listPersonAliases,
  listPersonContactMethods,
  listPersonFacts,
  restorePerson,
  restorePersonContactMethod,
  restorePersonFact,
  searchPeopleAcrossOwners,
  softDeletePerson,
  softDeletePersonContactMethod,
  softDeletePersonFact,
  updatePerson,
  updatePersonAlias,
  updatePersonContactMethod,
  updatePersonFact
} from "./repositories/people.js";

async function withTemporaryDatabase(
  prefix: string,
  operation: (rootDir: string) => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  try {
    await operation(rootDir);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function insertUser(id: string, handle: string, displayName: string): void {
  const now = "2026-07-15T08:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color, created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#c0c1ff', ?, ?)`
    )
    .run(id, handle, displayName, now, now);
}

test("Person validation and CRUD helpers preserve normalized, optional, and soft-deleted data", async () => {
  await withTemporaryDatabase("forge-people-repository-", () => {
    assert.throws(
      () => createPerson({ userId: "user_operator", displayName: " \t " }),
      /too small|at least 1/i
    );
    assert.throws(
      () =>
        createPerson({
          userId: "user_operator",
          displayName: "Invalid birthday",
          birthdayPrecision: "full",
          birthdayYear: 2024,
          birthdayMonth: 2,
          birthdayDay: 30
        }),
      /calendar date/i
    );
    assert.throws(
      () =>
        createPerson({
          userId: "user_operator",
          displayName: "Mismatched precision",
          birthdayPrecision: "year",
          birthdayYear: 2024,
          birthdayMonth: 2
        }),
      /selected precision/i
    );
    assert.throws(
      () =>
        createPerson({
          userId: "user_operator",
          displayName: "Oversized metadata",
          metadata: { payload: "x".repeat(131_072) }
        }),
      /131072 bytes/i
    );

    const created = createPerson(
      {
        userId: "user_operator",
        displayName: "  Zoë   李  ",
        preferredName: " Zo ",
        pronouns: "she/her",
        relationshipCategory: "friend",
        relationshipLabel: "Close friend",
        importance: 5,
        birthdayPrecision: "month_day",
        birthdayMonth: 2,
        birthdayDay: 29,
        timezone: "Europe/Zurich",
        contactPreferences: { preferredChannels: ["email"] },
        metadata: { fixture: true },
        aliases: [{ alias: " Z ", kind: "nickname" }],
        contacts: [
          {
            kind: "email",
            label: "Personal",
            value: " Zoe@Example.COM ",
            isPrimary: true
          }
        ],
        facts: [
          {
            factType: "interest",
            label: "Music",
            value: { genres: ["jazz"] },
            sensitivity: "private"
          }
        ]
      },
      { id: "person_zoe", now: new Date("2026-07-15T09:00:00.000Z") }
    );
    assert.equal(created.displayName, "Zoë 李");
    assert.equal(created.normalizedDisplayName, "zoë 李");
    assert.equal(created.aliases.length, 1);
    assert.equal(created.contacts[0]!.normalizedValue, "zoe@example.com");
    assert.deepEqual(created.facts[0]!.value, { genres: ["jazz"] });

    const repeatedAlias = addPersonAlias(
      created.id,
      "user_operator",
      { alias: "  Z  ", kind: "nickname" },
      { now: new Date("2026-07-15T09:05:00.000Z") }
    );
    assert.equal(repeatedAlias.id, created.aliases[0]!.id);
    assert.equal(listPersonAliases(created.id, "user_operator").length, 1);

    const formerAlias = addPersonAlias(
      created.id,
      "user_operator",
      { alias: "Zoë Example", kind: "former_name" },
      { id: "alias_former", now: new Date("2026-07-15T09:06:00.000Z") }
    );
    const updatedAlias = updatePersonAlias(
      formerAlias.id,
      created.id,
      "user_operator",
      { alias: "Zoë Muster", kind: "former_name" },
      { now: new Date("2026-07-15T09:07:00.000Z") }
    );
    assert.equal(updatedAlias?.normalizedAlias, "zoë muster");
    assert.equal(
      deletePersonAlias(formerAlias.id, created.id, "user_operator"),
      true
    );

    const workEmail = addPersonContactMethod(
      created.id,
      "user_operator",
      {
        kind: "email",
        label: "Work",
        value: "zoe@work.example",
        isPrimary: true,
        visibility: "selected"
      },
      { id: "contact_work", now: new Date("2026-07-15T09:10:00.000Z") }
    );
    const contactsAfterPrimaryChange = listPersonContactMethods(
      created.id,
      "user_operator"
    );
    assert.equal(
      contactsAfterPrimaryChange.find((contact) => contact.id === workEmail.id)
        ?.isPrimary,
      true
    );
    assert.equal(
      contactsAfterPrimaryChange.find(
        (contact) => contact.id === created.contacts[0]!.id
      )?.isPrimary,
      false
    );
    const updatedContact = updatePersonContactMethod(
      workEmail.id,
      created.id,
      "user_operator",
      { value: "  ZOE@WORK.EXAMPLE " },
      { now: new Date("2026-07-15T09:11:00.000Z") }
    );
    assert.equal(updatedContact?.normalizedValue, "zoe@work.example");
    const deletedContact = softDeletePersonContactMethod(
      workEmail.id,
      created.id,
      "user_operator",
      { now: new Date("2026-07-15T09:12:00.000Z") }
    );
    assert.ok(deletedContact?.deletedAt);
    assert.equal(
      listPersonContactMethods(created.id, "user_operator").some(
        (contact) => contact.id === workEmail.id
      ),
      false
    );
    assert.equal(
      restorePersonContactMethod(workEmail.id, created.id, "user_operator", {
        now: new Date("2026-07-15T09:13:00.000Z")
      })?.deletedAt,
      null
    );

    const fact = addPersonFact(
      created.id,
      "user_operator",
      {
        factType: "meaningful_date",
        label: "Marathon",
        value: { date: "2025-05-01" },
        sensitivity: "sensitive",
        sourceKind: "entity",
        sourceEntityType: "note",
        sourceEntityId: "note_marathon",
        confidence: 0.8
      },
      { id: "fact_marathon", now: new Date("2026-07-15T09:15:00.000Z") }
    );
    assert.equal(
      updatePersonFact(
        fact.id,
        created.id,
        "user_operator",
        { confidence: 0.95, reviewedAt: "2026-07-15T09:16:00.000Z" },
        { now: new Date("2026-07-15T09:16:00.000Z") }
      )?.confidence,
      0.95
    );
    assert.ok(
      softDeletePersonFact(fact.id, created.id, "user_operator", {
        now: new Date("2026-07-15T09:17:00.000Z")
      })?.deletedAt
    );
    assert.equal(listPersonFacts(created.id, "user_operator").length, 1);
    assert.equal(
      restorePersonFact(fact.id, created.id, "user_operator", {
        now: new Date("2026-07-15T09:18:00.000Z")
      })?.deletedAt,
      null
    );

    assert.throws(
      () =>
        updatePerson(created.id, "user_operator", {
          displayName: "Stale update",
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z"
        }),
      PersonConflictError
    );
    const current = getPersonById(created.id, "user_operator")!;
    const updated = updatePerson(
      created.id,
      "user_operator",
      {
        displayName: "Zoë Li",
        birthdayPrecision: "full",
        birthdayYear: 1992,
        birthdayMonth: 2,
        birthdayDay: 29,
        expectedUpdatedAt: current.updatedAt
      },
      { now: new Date("2026-07-15T09:20:00.000Z") }
    );
    assert.equal(updated?.displayName, "Zoë Li");
    assert.equal(updated?.birthdayYear, 1992);

    const search = listPeople({ userId: "user_operator", q: "zoë li" });
    assert.deepEqual(
      search.people.map((person) => person.id),
      [created.id]
    );

    const deleted = softDeletePerson(created.id, "user_operator", {
      now: new Date("2026-07-15T09:30:00.000Z")
    });
    assert.ok(deleted?.deletedAt);
    assert.equal(getPersonById(created.id, "user_operator"), undefined);
    const deletedSnapshot = getPersonById(created.id, "user_operator", {
      includeDeleted: true
    });
    assert.equal(deletedSnapshot?.aliases.length, 1);
    assert.equal(deletedSnapshot?.contacts.length, 2);
    assert.equal(deletedSnapshot?.facts.length, 2);
    assert.equal(
      restorePerson(created.id, "user_operator", {
        now: new Date("2026-07-15T09:31:00.000Z")
      })?.deletedAt,
      null
    );
  });
});

test("Person ownership and actor bindings stay isolated between local users", async () => {
  await withTemporaryDatabase("forge-people-owners-", () => {
    insertUser("user_second", "second", "Second Owner");
    const first = createPerson({
      userId: "user_operator",
      displayName: "Shared Name"
    });
    const second = createPerson({
      userId: "user_second",
      displayName: "Shared Name"
    });

    assert.deepEqual(
      listPeople({ userId: "user_operator" }).people.map((person) => person.id),
      [first.id]
    );
    assert.deepEqual(
      listPeople({ userId: "user_second" }).people.map((person) => person.id),
      [second.id]
    );
    assert.equal(getPersonById(first.id, "user_second"), undefined);
    assert.equal(getPersonByIdAcrossOwners(first.id)?.userId, "user_operator");
    assert.deepEqual(
      searchPeopleAcrossOwners({
        userIds: ["user_second"],
        query: "shared"
      }).map((person) => person.id),
      [second.id]
    );
    assert.equal(
      updatePerson(first.id, "user_second", { displayName: "Forbidden" }),
      undefined
    );
    assert.equal(softDeletePerson(first.id, "user_second"), undefined);
    assert.throws(
      () => addPersonAlias(first.id, "user_second", { alias: "Leak" }),
      PersonNotFoundError
    );

    const selfBinding = bindPersonToActor({
      personId: first.id,
      ownerUserId: "user_operator",
      actorUserId: "user_operator",
      bindingKind: "self"
    });
    assert.equal(
      bindPersonToActor({
        personId: first.id,
        ownerUserId: "user_operator",
        actorUserId: "user_operator",
        bindingKind: "self"
      }).id,
      selfBinding.id
    );
    assert.throws(
      () =>
        bindPersonToActor({
          personId: first.id,
          ownerUserId: "user_operator",
          actorUserId: "user_second",
          bindingKind: "local_actor"
        }),
      PeopleAuthorizationError
    );
    const grantsBefore = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM user_access_grants
           WHERE subject_user_id = 'user_second' AND target_user_id = 'user_operator'`
        )
        .get() as { count: number }
    ).count;
    const crossBinding = bindPersonToActor(
      {
        personId: first.id,
        ownerUserId: "user_operator",
        actorUserId: "user_second",
        bindingKind: "local_actor",
        verifiedAt: "2026-07-15T10:00:00.000Z"
      },
      (request) =>
        request.ownerUserId === "user_operator" &&
        request.actorUserId === "user_second"
    );
    assert.equal(crossBinding.actorUserId, "user_second");
    assert.equal(listPersonActorBindings(first.id, "user_operator").length, 2);
    const grantsAfter = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM user_access_grants
           WHERE subject_user_id = 'user_second' AND target_user_id = 'user_operator'`
        )
        .get() as { count: number }
    ).count;
    assert.equal(grantsAfter, grantsBefore);
    assert.equal(getPersonById(first.id, "user_second"), undefined);

    getDatabase()
      .prepare(
        `INSERT INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type, target_entity_id,
           anchor_key, relationship, created_by_actor, created_at
         ) VALUES ('person', ?, 'person', ?, '', 'knows', 'test', ?)`
      )
      .run(second.id, first.id, "2026-07-15T10:10:00.000Z");
    assert.equal(hardDeletePerson(second.id, "user_operator"), undefined);
    assert.equal(hardDeletePerson(second.id, "user_second")?.id, second.id);
    assert.equal(
      getPersonByIdAcrossOwners(second.id, { includeDeleted: true }),
      undefined
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_links
             WHERE (source_entity_type = 'person' AND source_entity_id = ?)
                OR (target_entity_type = 'person' AND target_entity_id = ?)`
          )
          .get(second.id, second.id) as { count: number }
      ).count,
      0
    );
  });
});

test("bounded Person bulk reads preserve requested order without crossing owners or deletion state", async () => {
  await withTemporaryDatabase("forge-people-bulk-", () => {
    insertUser("user_second", "second", "Second Owner");
    const first = createPerson(
      { userId: "user_operator", displayName: "First Person" },
      { id: "person_bulk_first" }
    );
    const deleted = createPerson(
      { userId: "user_operator", displayName: "Deleted Person" },
      { id: "person_bulk_deleted" }
    );
    const foreign = createPerson(
      { userId: "user_second", displayName: "Foreign Person" },
      { id: "person_bulk_foreign" }
    );
    softDeletePerson(deleted.id, "user_operator");

    assert.deepEqual(
      getPeopleByIdsForUser(
        [deleted.id, first.id, foreign.id, first.id],
        "user_operator"
      ).map((person) => person.id),
      [first.id]
    );
    assert.deepEqual(
      getPeopleByIdsForUser(
        [deleted.id, first.id, foreign.id, first.id],
        "user_operator",
        { includeDeleted: true }
      ).map((person) => person.id),
      [deleted.id, first.id]
    );
    assert.throws(
      () =>
        getPeopleByIdsForUser(
          Array.from({ length: 501 }, (_, index) => `person_${index}`),
          "user_operator"
        ),
      /cannot exceed 500 records/i
    );
  });
});

test("People idempotency keys reject active replacement and can be reused after expiry", async () => {
  await withTemporaryDatabase("forge-people-idempotency-", () => {
    const activeKey = "people-idempotency-active-0001";
    createPeopleIdempotencyRecord({
      ownerUserId: "user_operator",
      operationId: "people.test",
      idempotencyKey: activeKey,
      requestHash: "a".repeat(64),
      responseStatus: 200,
      responseJson: '{"version":1}',
      createdAt: "2026-07-15T10:00:00.000Z",
      expiresAt: "2999-07-15T11:00:00.000Z"
    });
    assert.throws(
      () =>
        createPeopleIdempotencyRecord({
          ownerUserId: "user_operator",
          operationId: "people.test",
          idempotencyKey: activeKey,
          requestHash: "b".repeat(64),
          responseStatus: 200,
          responseJson: '{"version":2}',
          createdAt: "2026-07-15T10:30:00.000Z",
          expiresAt: "2026-07-15T12:00:00.000Z"
        }),
      PersonConflictError
    );

    const expiredKey = "people-idempotency-expired-0001";
    createPeopleIdempotencyRecord({
      ownerUserId: "user_operator",
      operationId: "people.test",
      idempotencyKey: expiredKey,
      requestHash: "b".repeat(64),
      responseStatus: 200,
      responseJson: '{"version":2}',
      createdAt: "2020-07-15T10:00:00.000Z",
      expiresAt: "2020-07-15T11:00:00.000Z"
    });
    createPeopleIdempotencyRecord({
      ownerUserId: "user_operator",
      operationId: "people.test",
      idempotencyKey: expiredKey,
      requestHash: "c".repeat(64),
      responseStatus: 200,
      responseJson: '{"version":3}',
      createdAt: "2026-07-15T11:00:00.000Z",
      expiresAt: "2026-07-15T13:00:00.000Z"
    });
    const replacement = getPeopleIdempotencyRecord(
      "user_operator",
      "people.test",
      expiredKey,
      { now: new Date("2026-07-15T11:30:00.000Z") }
    );
    assert.equal(replacement?.requestHash, "c".repeat(64));
    assert.equal(replacement?.responseJson, '{"version":3}');
  });
});
