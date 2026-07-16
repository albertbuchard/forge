import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migration099 = "099_people_owner_partition_identity.sql";
const migration100 = "100_people_read_model_revision.sql";
const timestamp = "2026-07-16T08:00:00.000Z";
const maxSafeRevision = Number.MAX_SAFE_INTEGER;

const peopleTriggerTargets = [
  ["trg_people_read_model_person_insert", "INSERT", "people"],
  ["trg_people_read_model_person_update", "UPDATE", "people"],
  ["trg_people_read_model_person_delete", "DELETE", "people"],
  ["trg_people_read_model_alias_insert", "INSERT", "person_aliases"],
  ["trg_people_read_model_alias_update", "UPDATE", "person_aliases"],
  ["trg_people_read_model_alias_delete", "DELETE", "person_aliases"],
  ["trg_people_read_model_fact_insert", "INSERT", "person_facts"],
  ["trg_people_read_model_fact_update", "UPDATE", "person_facts"],
  ["trg_people_read_model_fact_delete", "DELETE", "person_facts"],
  ["trg_people_read_model_relationship_insert", "INSERT", "peer_relationships"],
  ["trg_people_read_model_relationship_update", "UPDATE", "peer_relationships"],
  ["trg_people_read_model_relationship_delete", "DELETE", "peer_relationships"],
  [
    "trg_people_read_model_remote_record_insert",
    "INSERT",
    "peer_remote_records"
  ],
  [
    "trg_people_read_model_remote_record_update",
    "UPDATE",
    "peer_remote_records"
  ],
  [
    "trg_people_read_model_remote_record_delete",
    "DELETE",
    "peer_remote_records"
  ]
] as const;

async function migrationFilesThrough(lastMigration: string): Promise<string[]> {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file <= lastMigration)
    .sort();
}

async function applyMigrationsThrough(
  database: DatabaseSync,
  lastMigration: string
): Promise<void> {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const file of await migrationFilesThrough(lastMigration)) {
    if (database.prepare("SELECT 1 FROM migrations WHERE id = ?").get(file)) {
      continue;
    }
    database.exec("BEGIN");
    try {
      database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, timestamp);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function withDatabase(
  operation: (database: DatabaseSync) => Promise<void> | void
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-people-cursor-"));
  const database = new DatabaseSync(path.join(root, "forge.sqlite"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim().toLowerCase();
}

function peopleTriggerDefinitions(
  database: DatabaseSync
): Record<string, string> {
  const rows = database
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE 'trg_people_read_model_%'
       ORDER BY name`
    )
    .all() as Array<{ name: string; sql: string }>;
  return Object.fromEntries(
    rows.map((row) => [row.name, normalizeSql(row.sql)])
  );
}

function seedStalePeopleTriggers(database: DatabaseSync): void {
  for (const [name, event, table] of peopleTriggerTargets) {
    database.exec(`
      CREATE TRIGGER ${name}
      AFTER ${event} ON ${table}
      BEGIN
        SELECT 'stale-noop';
      END
    `);
  }
}

function seedUser(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#123456', ?, ?)`
    )
    .run(id, id, id, timestamp, timestamp);
}

function seedPerson(
  database: DatabaseSync,
  id: string,
  ownerUserId: string
): void {
  database
    .prepare(
      `INSERT INTO people (
         id, user_id, display_name, normalized_display_name,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, ownerUserId, id, id, timestamp, timestamp);
}

function seedAlias(database: DatabaseSync, id: string, personId: string): void {
  database
    .prepare(
      `INSERT INTO person_aliases (
         id, person_id, alias, normalized_alias, kind, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'nickname', ?, ?)`
    )
    .run(id, personId, id, id, timestamp, timestamp);
}

function seedFact(input: {
  database: DatabaseSync;
  id: string;
  personId: string;
  sensitivity: "basic" | "private";
}): void {
  input.database
    .prepare(
      `INSERT INTO person_facts (
         id, person_id, fact_type, label, value_json, sensitivity,
         source_kind, created_at, updated_at
       ) VALUES (?, ?, 'profile', ?, ?, ?, 'manual', ?, ?)`
    )
    .run(
      input.id,
      input.personId,
      input.id,
      JSON.stringify({ value: input.id }),
      input.sensitivity,
      timestamp,
      timestamp
    );
}

function seedRelationship(input: {
  database: DatabaseSync;
  id: string;
  ownerUserId: string;
  personId: string | null;
  status?: "active" | "paused";
}): void {
  const localPrincipalId = `principal_local_${input.id}`;
  const remotePrincipalId = `principal_remote_${input.id}`;
  const insertPrincipal = input.database.prepare(
    `INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id,
       root_public_key, root_key_secret_id, display_label,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertPrincipal.run(
    localPrincipalId,
    input.ownerUserId,
    "local",
    `public_local_${input.id}`,
    `root_local_${input.id}`.padEnd(48, "l"),
    `secret_${input.id}`,
    "Local",
    timestamp,
    timestamp
  );
  insertPrincipal.run(
    remotePrincipalId,
    input.ownerUserId,
    "remote",
    `public_remote_${input.id}`,
    `root_remote_${input.id}`.padEnd(48, "r"),
    null,
    "Remote",
    timestamp,
    timestamp
  );
  input.database
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, verification_phrase_hash,
         established_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      localPrincipalId,
      remotePrincipalId,
      input.personId,
      input.status ?? "active",
      "a".repeat(64),
      timestamp,
      timestamp,
      timestamp
    );
}

function seedRemoteRecord(input: {
  database: DatabaseSync;
  id: string;
  ownerUserId: string;
  relationshipId: string;
  projectionId: string;
  nextEventAt: string | null;
  cacheState?: "current" | "stale";
}): void {
  const queryHash = "b".repeat(64);
  input.database
    .prepare(
      `INSERT INTO peer_remote_records (
         id, owner_user_id, relationship_id, projection_id,
         source_record_id, source_version, encrypted_payload,
         encryption_key_id, encryption_nonce, payload_hash,
         query_metadata_json, query_hash, next_event_at, source_timestamp,
         received_at, valid_until, cache_state, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.relationshipId,
      input.projectionId,
      `source_${input.id}`,
      Buffer.from(`payload_${input.id}`),
      `key_${input.id}`,
      Buffer.alloc(12, 1),
      "c".repeat(64),
      JSON.stringify({ queryHash }),
      queryHash,
      input.nextEventAt,
      timestamp,
      timestamp,
      "2026-08-01T00:00:00.000Z",
      input.cacheState ?? "current",
      timestamp,
      timestamp
    );
}

function revision(database: DatabaseSync, ownerUserId: string): number | null {
  const row = database
    .prepare(
      `SELECT revision
       FROM people_read_model_revisions
       WHERE owner_user_id = ?`
    )
    .get(ownerUserId) as { revision: number } | undefined;
  return row?.revision ?? null;
}

function assertRevisionDelta(input: {
  database: DatabaseSync;
  ownerUserId: string;
  expectedDelta: 0 | 1;
  label: string;
  mutate: () => void;
}): void {
  const before = revision(input.database, input.ownerUserId);
  if (before === null) {
    assert.fail(`Missing revision before ${input.label}.`);
  }
  input.mutate();
  assert.equal(
    revision(input.database, input.ownerUserId),
    before + input.expectedDelta,
    input.label
  );
}

test("migration 100 upgrades populated People data without deleting content", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(
      database,
      "098_artifact_recursive_sanitization_and_blob_retention.sql"
    );
    seedUser(database, "user_cursor_upgrade");
    seedPerson(database, "person_cursor_upgrade", "user_cursor_upgrade");
    seedAlias(database, "alias_cursor_upgrade", "person_cursor_upgrade");
    seedFact({
      database,
      id: "fact_cursor_upgrade",
      personId: "person_cursor_upgrade",
      sensitivity: "basic"
    });
    const before = {
      people: database.prepare("SELECT * FROM people ORDER BY id").all(),
      aliases: database
        .prepare("SELECT * FROM person_aliases ORDER BY id")
        .all(),
      facts: database.prepare("SELECT * FROM person_facts ORDER BY id").all()
    };

    await applyMigrationsThrough(database, migration100);

    assert.deepEqual(
      {
        people: database.prepare("SELECT * FROM people ORDER BY id").all(),
        aliases: database
          .prepare("SELECT * FROM person_aliases ORDER BY id")
          .all(),
        facts: database.prepare("SELECT * FROM person_facts ORDER BY id").all()
      },
      before
    );
    assert.equal(revision(database, "user_cursor_upgrade"), 1);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      (
        database.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        }
      ).integrity_check,
      "ok"
    );
    assert.ok(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration100)
    );
  });
});

test("migration 100 replaces stale same-name triggers with exact normalized definitions", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration099);
    seedStalePeopleTriggers(database);
    const staleDefinitions = peopleTriggerDefinitions(database);
    assert.equal(
      Object.keys(staleDefinitions).length,
      peopleTriggerTargets.length
    );
    assert.ok(
      Object.values(staleDefinitions).every((definition) =>
        definition.includes("select 'stale-noop'")
      )
    );

    await applyMigrationsThrough(database, migration100);
    const replacedDefinitions = peopleTriggerDefinitions(database);
    let canonicalDefinitions: Record<string, string> = {};
    await withDatabase(async (canonicalDatabase) => {
      await applyMigrationsThrough(canonicalDatabase, migration100);
      canonicalDefinitions = peopleTriggerDefinitions(canonicalDatabase);
    });

    assert.deepEqual(replacedDefinitions, canonicalDefinitions);
    assert.deepEqual(
      Object.keys(replacedDefinitions),
      peopleTriggerTargets.map(([name]) => name).sort()
    );
    const rolloverSql =
      "when people_read_model_revisions.revision >= 9007199254740991 then 0 else people_read_model_revisions.revision + 1 end";
    for (const definition of Object.values(replacedDefinitions)) {
      assert.doesNotMatch(definition, /stale-noop|if not exists/u);
      assert.ok(definition.includes(rolloverSql), definition);
    }
    assert.match(
      replacedDefinitions.trg_people_read_model_relationship_update!,
      /after update of owner_user_id, local_person_id, status on peer_relationships/u
    );
    assert.match(
      replacedDefinitions.trg_people_read_model_remote_record_update!,
      /after update of owner_user_id, relationship_id, projection_id, query_hash, next_event_at, cache_state, valid_until on peer_remote_records/u
    );
    assert.doesNotMatch(
      replacedDefinitions.trg_people_read_model_person_update!,
      /private_notes|contact_preferences_json|metadata_json/u
    );
    assert.doesNotMatch(
      replacedDefinitions.trg_people_read_model_remote_record_update!,
      /encrypted_payload|source_version|received_at/u
    );
    const tableSql = (
      database
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE type = 'table' AND name = 'people_read_model_revisions'`
        )
        .get() as { sql: string }
    ).sql;
    assert.match(
      normalizeSql(tableSql),
      /check \(revision between 0 and 9007199254740991\)/u
    );

    seedUser(database, "user_stale_trigger_replaced");
    seedPerson(
      database,
      "person_stale_trigger_replaced",
      "user_stale_trigger_replaced"
    );
    assert.equal(revision(database, "user_stale_trigger_replaced"), 1);
  });
});

test("migration 100 invalidates only People list dependencies per owner", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration100);
    const ownerUserId = "user_cursor_owner";
    const otherUserId = "user_cursor_other";
    const personId = "person_cursor_owner";
    seedUser(database, ownerUserId);
    seedUser(database, otherUserId);
    seedPerson(database, personId, ownerUserId);
    seedPerson(database, "person_cursor_other", otherUserId);
    assert.equal(revision(database, ownerUserId), 1);
    assert.equal(revision(database, otherUserId), 1);

    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "a no-op visible Person update must not invalidate",
      mutate: () => {
        database
          .prepare("UPDATE people SET display_name = display_name WHERE id = ?")
          .run(personId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "a private-only Person update must not invalidate the public list",
      mutate: () => {
        database
          .prepare("UPDATE people SET private_notes = ? WHERE id = ?")
          .run("Private-only change", personId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered Person rename must invalidate",
      mutate: () => {
        database
          .prepare(
            `UPDATE people
             SET display_name = ?, normalized_display_name = ?
             WHERE id = ?`
          )
          .run("Renamed Person", "renamed person", personId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "the updated_at sort key must invalidate",
      mutate: () => {
        database
          .prepare("UPDATE people SET updated_at = ? WHERE id = ?")
          .run("2026-07-16T08:01:00.000Z", personId);
      }
    });

    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered alias insert must invalidate",
      mutate: () => seedAlias(database, "alias_cursor_owner", personId)
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "a no-op alias update must not invalidate",
      mutate: () => {
        database
          .prepare("UPDATE person_aliases SET alias = alias WHERE id = ?")
          .run("alias_cursor_owner");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered alias update must invalidate",
      mutate: () => {
        database
          .prepare(
            `UPDATE person_aliases
             SET alias = ?, normalized_alias = ?
             WHERE id = ?`
          )
          .run("Changed Alias", "changed alias", "alias_cursor_owner");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered alias delete must invalidate",
      mutate: () => {
        database
          .prepare("DELETE FROM person_aliases WHERE id = ?")
          .run("alias_cursor_owner");
      }
    });

    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "a private fact is not rendered by the public list",
      mutate: () =>
        seedFact({
          database,
          id: "fact_cursor_private",
          personId,
          sensitivity: "private"
        })
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "private fact content remains outside the public list",
      mutate: () => {
        database
          .prepare("UPDATE person_facts SET label = ? WHERE id = ?")
          .run("Still private", "fact_cursor_private");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "making a fact public must invalidate rendered context",
      mutate: () => {
        database
          .prepare("UPDATE person_facts SET sensitivity = 'basic' WHERE id = ?")
          .run("fact_cursor_private");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered basic fact update must invalidate",
      mutate: () => {
        database
          .prepare("UPDATE person_facts SET label = ? WHERE id = ?")
          .run("Visible fact", "fact_cursor_private");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a rendered basic fact delete must invalidate",
      mutate: () => {
        database
          .prepare("DELETE FROM person_facts WHERE id = ?")
          .run("fact_cursor_private");
      }
    });

    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a Person insert changes list membership",
      mutate: () => seedPerson(database, "person_cursor_temporary", ownerUserId)
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "a Person delete changes list membership",
      mutate: () => {
        database
          .prepare("DELETE FROM people WHERE id = ?")
          .run("person_cursor_temporary");
      }
    });

    const relationshipId = "relationship_cursor_owner";
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "an unlinked relationship cannot change a People list",
      mutate: () =>
        seedRelationship({
          database,
          id: relationshipId,
          ownerUserId,
          personId: null
        })
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "connection sequence churn must not invalidate",
      mutate: () => {
        database
          .prepare(
            `UPDATE peer_relationships
             SET highest_received_sequence = 1,
                 highest_sent_sequence = 1,
                 last_connected_at = ?,
                 updated_at = ?
             WHERE id = ?`
          )
          .run(
            "2026-07-16T08:02:00.000Z",
            "2026-07-16T08:02:00.000Z",
            relationshipId
          );
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "linking a relationship changes source/status filters",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_relationships SET local_person_id = ? WHERE id = ?"
          )
          .run(personId, relationshipId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "transport preference is not a People list dependency",
      mutate: () => {
        database
          .prepare(
            `UPDATE peer_relationships
             SET transport_privacy_mode = 'hide_network_address'
             WHERE id = ?`
          )
          .run(relationshipId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "relationship status changes list membership and filters",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_relationships SET status = 'paused' WHERE id = ?"
          )
          .run(relationshipId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "reactivating a relationship changes list membership and filters",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_relationships SET status = 'active' WHERE id = ?"
          )
          .run(relationshipId);
      }
    });

    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "a non-calendar projection cannot affect People list context",
      mutate: () =>
        seedRemoteRecord({
          database,
          id: "remote_cursor_non_calendar",
          ownerUserId,
          relationshipId,
          projectionId: "health.summary.v1",
          nextEventAt: null
        })
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "non-calendar projection state churn must not invalidate",
      mutate: () => {
        database
          .prepare(
            `UPDATE peer_remote_records
             SET cache_state = 'stale', source_version = '2', updated_at = ?
             WHERE id = ?`
          )
          .run("2026-07-16T08:03:00.000Z", "remote_cursor_non_calendar");
      }
    });

    const calendarRecordId = "remote_cursor_calendar";
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "an eligible calendar projection changes next-event context",
      mutate: () =>
        seedRemoteRecord({
          database,
          id: calendarRecordId,
          ownerUserId,
          relationshipId,
          projectionId: "calendar.availability.v1",
          nextEventAt: "2026-07-20T08:00:00.000Z"
        })
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "calendar payload churn does not change People list context",
      mutate: () => {
        database
          .prepare(
            `UPDATE peer_remote_records
             SET encrypted_payload = ?, payload_hash = ?,
                 source_version = '2', received_at = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            Buffer.from("changed-calendar-payload"),
            "d".repeat(64),
            "2026-07-16T08:04:00.000Z",
            "2026-07-16T08:04:00.000Z",
            calendarRecordId
          );
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "calendar next-event changes must invalidate",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET next_event_at = ? WHERE id = ?"
          )
          .run("2026-07-21T08:00:00.000Z", calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "calendar validity changes must invalidate",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET valid_until = ? WHERE id = ?"
          )
          .run("2026-08-02T00:00:00.000Z", calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label:
        "switching between calendar projection kinds preserves eligibility",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET projection_id = ? WHERE id = ?"
          )
          .run("calendar.selected_events.v1", calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "making calendar context stale must invalidate",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET cache_state = 'stale' WHERE id = ?"
          )
          .run(calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "stale calendar rows cannot affect list context",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET next_event_at = ? WHERE id = ?"
          )
          .run("2026-07-22T08:00:00.000Z", calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "restoring current calendar context must invalidate",
      mutate: () => {
        database
          .prepare(
            "UPDATE peer_remote_records SET cache_state = 'current' WHERE id = ?"
          )
          .run(calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "deleting eligible calendar context must invalidate",
      mutate: () => {
        database
          .prepare("DELETE FROM peer_remote_records WHERE id = ?")
          .run(calendarRecordId);
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 0,
      label: "deleting a non-calendar projection must not invalidate",
      mutate: () => {
        database
          .prepare("DELETE FROM peer_remote_records WHERE id = ?")
          .run("remote_cursor_non_calendar");
      }
    });
    assertRevisionDelta({
      database,
      ownerUserId,
      expectedDelta: 1,
      label: "deleting a linked relationship changes list filters",
      mutate: () => {
        database
          .prepare("DELETE FROM peer_relationships WHERE id = ?")
          .run(relationshipId);
      }
    });

    assert.equal(revision(database, otherUserId), 1);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("migration 100 revises only owners affected by moved rendered children", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration100);
    const firstOwnerId = "user_cursor_move_first";
    const secondOwnerId = "user_cursor_move_second";
    const firstPersonId = "person_cursor_move_first";
    const secondPersonId = "person_cursor_move_second";
    seedUser(database, firstOwnerId);
    seedUser(database, secondOwnerId);
    seedPerson(database, firstPersonId, firstOwnerId);
    seedPerson(database, secondPersonId, secondOwnerId);

    seedFact({
      database,
      id: "fact_cursor_move",
      personId: firstPersonId,
      sensitivity: "private"
    });
    database
      .prepare("UPDATE person_facts SET person_id = ? WHERE id = ?")
      .run(secondPersonId, "fact_cursor_move");
    assert.equal(revision(database, firstOwnerId), 1);
    assert.equal(revision(database, secondOwnerId), 1);

    database
      .prepare("UPDATE person_facts SET sensitivity = 'basic' WHERE id = ?")
      .run("fact_cursor_move");
    assert.equal(revision(database, firstOwnerId), 1);
    assert.equal(revision(database, secondOwnerId), 2);

    database
      .prepare("UPDATE person_facts SET person_id = ? WHERE id = ?")
      .run(firstPersonId, "fact_cursor_move");
    assert.equal(revision(database, firstOwnerId), 2);
    assert.equal(revision(database, secondOwnerId), 3);

    seedAlias(database, "alias_cursor_move", firstPersonId);
    assert.equal(revision(database, firstOwnerId), 3);
    assert.equal(revision(database, secondOwnerId), 3);
    database
      .prepare("UPDATE person_aliases SET person_id = ? WHERE id = ?")
      .run(secondPersonId, "alias_cursor_move");
    assert.equal(revision(database, firstOwnerId), 4);
    assert.equal(revision(database, secondOwnerId), 4);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("migration 100 rolls revisions over within the JS safe-integer boundary", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration100);
    const ownerUserId = "user_cursor_boundary";
    const personId = "person_cursor_boundary";
    seedUser(database, ownerUserId);
    seedPerson(database, personId, ownerUserId);

    database
      .prepare(
        `UPDATE people_read_model_revisions
         SET revision = ?
         WHERE owner_user_id = ?`
      )
      .run(maxSafeRevision - 1, ownerUserId);
    database
      .prepare("UPDATE people SET short_description = ? WHERE id = ?")
      .run("At the boundary", personId);
    assert.equal(revision(database, ownerUserId), maxSafeRevision);
    assert.equal(Number.isSafeInteger(revision(database, ownerUserId)), true);

    database
      .prepare("UPDATE people SET short_description = ? WHERE id = ?")
      .run("Rolled over", personId);
    assert.equal(revision(database, ownerUserId), 0);
    assert.equal(Number.isSafeInteger(revision(database, ownerUserId)), true);

    seedAlias(database, "alias_cursor_boundary", personId);
    assert.equal(revision(database, ownerUserId), 1);
    assert.throws(() => {
      database.exec(
        `UPDATE people_read_model_revisions
         SET revision = 9007199254740992
         WHERE owner_user_id = 'user_cursor_boundary'`
      );
    });
    assert.equal(revision(database, ownerUserId), 1);
  });
});

test("migration 100 rolls trigger replacement back atomically on failure", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration099);
    seedUser(database, "user_cursor_rollback");
    seedPerson(database, "person_cursor_rollback", "user_cursor_rollback");
    database.exec(`
      CREATE TRIGGER trg_people_read_model_person_insert
      AFTER INSERT ON people
      BEGIN
        SELECT 'stale-noop';
      END
    `);
    const staleDefinition =
      peopleTriggerDefinitions(database).trg_people_read_model_person_insert;
    const migrationSql = await readFile(
      path.join(migrationsDir, migration100),
      "utf8"
    );

    database.exec("BEGIN");
    assert.throws(() => {
      database.exec(migrationSql);
      database.exec("INSERT INTO table_that_does_not_exist VALUES (1)");
    });
    database.exec("ROLLBACK");

    assert.equal(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'people_read_model_revisions'`
        )
        .get(),
      undefined
    );
    assert.equal(
      peopleTriggerDefinitions(database).trg_people_read_model_person_insert,
      staleDefinition
    );
    assert.equal(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration100),
      undefined
    );
    assert.deepEqual(
      {
        ...(database
          .prepare("SELECT id, user_id FROM people WHERE id = ?")
          .get("person_cursor_rollback") as {
          id: string;
          user_id: string;
        })
      },
      {
        id: "person_cursor_rollback",
        user_id: "user_cursor_rollback"
      }
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
});
