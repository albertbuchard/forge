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
  PERSON_JSON_MAX_DEPTH,
  PERSON_JSON_MAX_KEYS,
  PERSON_JSON_MAX_NODES,
  personContactMethodInputSchema,
  personJsonValueSchema
} from "./people-types.js";
import {
  PersonConflictError,
  addPersonAlias,
  createPerson,
  getPersonById,
  hardDeletePerson,
  listPeople,
  normalizePersonContactValue,
  searchPeopleAcrossOwners,
  updatePerson
} from "./repositories/people.js";

async function withTemporaryDatabase(
  prefix: string,
  operation: () => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
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

test("Person JSON validation is iterative, bounded, and prototype-safe", () => {
  let deepValue: unknown = "leaf";
  for (let depth = 0; depth <= PERSON_JSON_MAX_DEPTH; depth += 1) {
    deepValue = { child: deepValue };
  }
  const deepResult = personJsonValueSchema.safeParse(deepValue);
  assert.equal(deepResult.success, false);
  assert.match(
    deepResult.success ? "" : deepResult.error.message,
    /depth of 32/i
  );

  const nodeResult = personJsonValueSchema.safeParse(
    Array.from({ length: PERSON_JSON_MAX_NODES }, () => null)
  );
  assert.equal(nodeResult.success, false);
  assert.match(
    nodeResult.success ? "" : nodeResult.error.message,
    /20000 nodes/i
  );

  const manyKeys: Record<string, null> = {};
  for (let index = 0; index <= PERSON_JSON_MAX_KEYS; index += 1) {
    manyKeys[`key_${index}`] = null;
  }
  const keyResult = personJsonValueSchema.safeParse(manyKeys);
  assert.equal(keyResult.success, false);
  assert.match(
    keyResult.success ? "" : keyResult.error.message,
    /10000 object keys/i
  );

  for (const unsafeKey of ["__proto__", "constructor", "prototype"]) {
    const value = JSON.parse(`{"${unsafeKey}":{"polluted":true}}`) as unknown;
    const result = personJsonValueSchema.safeParse(value);
    assert.equal(result.success, false, `accepted unsafe key ${unsafeKey}`);
    assert.match(result.success ? "" : result.error.message, /not allowed/i);
  }
  assert.equal(
    (Object.prototype as { polluted?: boolean }).polluted,
    undefined
  );

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(personJsonValueSchema.safeParse(cyclic).success, false);

  let getterCalls = 0;
  const accessorValue: Record<string, unknown> = {};
  Object.defineProperty(accessorValue, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "should-not-run";
    }
  });
  const accessorResult = personJsonValueSchema.safeParse(accessorValue);
  assert.equal(accessorResult.success, false);
  assert.equal(getterCalls, 0);
});

test("structured contacts validate their own syntax without constraining custom identifiers", () => {
  for (const contact of [
    { kind: "email", value: "Alice+work@example.com" },
    { kind: "phone", value: "+41 (0) 79 123 45 67 ext. 42" },
    { kind: "website", value: "https://Example.COM/profile?q=1" },
    { kind: "messaging", value: "@alice:matrix.example" },
    { kind: "custom", value: "not an email, phone, or URL" }
  ] as const) {
    assert.equal(
      personContactMethodInputSchema.safeParse(contact).success,
      true,
      `rejected ${contact.kind} contact`
    );
  }

  for (const contact of [
    { kind: "email", value: "alice@@example.com" },
    { kind: "email", value: "alice@example.com/path" },
    { kind: "phone", value: "call-me" },
    { kind: "phone", value: "12" },
    { kind: "phone", value: "123\n456" },
    { kind: "website", value: "ftp://example.com/file" },
    { kind: "website", value: "javascript:alert(1)" },
    { kind: "website", value: "example.com" },
    { kind: "website", value: "https://user:secret@example.com" }
  ] as const) {
    assert.equal(
      personContactMethodInputSchema.safeParse(contact).success,
      false,
      `accepted invalid ${contact.kind} contact`
    );
  }

  assert.equal(
    normalizePersonContactValue("phone", "+41 (0) 79 123 45 67 ext. 42"),
    "+410791234567x42"
  );
  assert.equal(
    normalizePersonContactValue("website", "https://Example.COM/profile"),
    "https://example.com/profile"
  );
});

test("optimistic Person versions advance monotonically and reject stale writers", async () => {
  await withTemporaryDatabase("forge-people-versions-", () => {
    const initialTime = new Date("2026-07-15T12:00:00.000Z");
    const person = createPerson(
      { userId: "user_operator", displayName: "Versioned Person" },
      { id: "person_versioned", now: initialTime }
    );

    const first = updatePerson(
      person.id,
      person.userId,
      {
        shortDescription: "first writer",
        expectedUpdatedAt: person.updatedAt
      },
      { now: initialTime }
    )!;
    assert.equal(first.updatedAt, "2026-07-15T12:00:00.001Z");

    const second = updatePerson(
      person.id,
      person.userId,
      {
        shortDescription: "second writer",
        expectedUpdatedAt: first.updatedAt
      },
      { now: new Date("2020-01-01T00:00:00.000Z") }
    )!;
    assert.equal(second.updatedAt, "2026-07-15T12:00:00.002Z");

    assert.throws(
      () =>
        updatePerson(
          person.id,
          person.userId,
          {
            shortDescription: "stale overwrite",
            expectedUpdatedAt: person.updatedAt
          },
          { now: initialTime }
        ),
      PersonConflictError
    );
    assert.equal(
      getPersonById(person.id, person.userId)?.shortDescription,
      "second writer"
    );

    addPersonAlias(
      person.id,
      person.userId,
      { alias: "Version Alias" },
      { id: "person_alias_version", now: initialTime }
    );
    const afterAlias = getPersonById(person.id, person.userId)!;
    assert.equal(afterAlias.updatedAt, "2026-07-15T12:00:00.003Z");

    addPersonAlias(
      person.id,
      person.userId,
      { alias: "Version Alias" },
      { now: initialTime }
    );
    assert.equal(
      getPersonById(person.id, person.userId)?.updatedAt,
      afterAlias.updatedAt
    );
  });
});

test("People listing stays stable at scale and explicit empty authorization filters fail closed", async () => {
  await withTemporaryDatabase("forge-people-scale-", () => {
    for (let index = 0; index < 225; index += 1) {
      createPerson(
        {
          userId: "user_operator",
          displayName: `Scale Person ${String(Math.floor(index / 5)).padStart(3, "0")}`
        },
        {
          id: `person_scale_${String(index).padStart(3, "0")}`,
          now: new Date("2026-07-15T13:00:00.000Z")
        }
      );
    }
    createPerson(
      { userId: "user_operator", displayName: "Literal % Person" },
      { id: "person_literal_percent" }
    );

    const pages = [0, 100, 200].map((offset) =>
      listPeople({
        userId: "user_operator",
        limit: 100,
        offset,
        sort: "name"
      })
    );
    assert.deepEqual(
      pages.map((page) => page.people.length),
      [100, 100, 26]
    );
    assert.deepEqual(
      pages.map((page) => page.hasMore),
      [true, true, false]
    );
    const ids = pages.flatMap((page) => page.people.map((person) => person.id));
    assert.equal(ids.length, 226);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      listPeople({ userId: "user_operator", q: "%" }).people.map(
        (person) => person.id
      ),
      ["person_literal_percent"]
    );
    assert.deepEqual(searchPeopleAcrossOwners({ userIds: [] }), []);
    assert.deepEqual(searchPeopleAcrossOwners({ ids: [] }), []);
    assert.throws(
      () => searchPeopleAcrossOwners({ query: "x".repeat(241) }),
      RangeError
    );

    const queryPlan = getDatabase()
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM people
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY normalized_display_name, id LIMIT 100`
      )
      .all("user_operator") as Array<{ detail: string }>;
    assert.match(
      queryPlan.map((row) => row.detail).join("\n"),
      /idx_people_owner_active_name/i
    );
  });
});

test("hard delete refuses preserved peer references without partial cleanup", async () => {
  await withTemporaryDatabase("forge-people-hard-delete-", () => {
    const person = createPerson(
      { userId: "user_operator", displayName: "Peer-bound Person" },
      { id: "person_peer_bound" }
    );
    const now = "2026-07-15T14:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO forge_principals (
           id, owner_user_id, principal_kind, public_principal_id,
           root_public_key, root_key_secret_id, display_label, local_person_id,
           trust_state, metadata_json, created_at, updated_at
         ) VALUES (?, ?, 'local', ?, ?, ?, '', ?, 'verified', '{}', ?, ?)`
      )
      .run(
        "principal_person_bound",
        person.userId,
        "principal-public-id-0001",
        "a".repeat(32),
        "secret-reference",
        person.id,
        now,
        now
      );

    assert.throws(
      () => hardDeletePerson(person.id, person.userId),
      PersonConflictError
    );
    assert.equal(
      getPersonById(person.id, person.userId, { includeDeleted: true })?.id,
      person.id
    );
    assert.ok(
      getDatabase()
        .prepare("SELECT id FROM forge_principals WHERE id = ?")
        .get("principal_person_bound")
    );
    assert.ok(
      getDatabase()
        .prepare(
          `SELECT user_id FROM entity_owners
           WHERE entity_type = 'person' AND entity_id = ?`
        )
        .get(person.id)
    );
  });
});
