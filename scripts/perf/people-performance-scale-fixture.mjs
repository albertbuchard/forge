import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  PEOPLE_PERFORMANCE_SCHEMA_VERSION,
  PEOPLE_SCALE_FIXTURE_ID,
  PEOPLE_SCALE_FIXTURE_MANIFEST,
  PEOPLE_SCALE_FIXTURE_MARKER,
  assertNotProtectedDataRoot,
  canonicalJson
} from "./people-performance-contract.mjs";
import {
  PEOPLE_FIXTURE_OWNER_ID,
  PEOPLE_FIXTURE_SUBJECT_ID
} from "./people-performance-fixture.mjs";

const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const FIXTURE_EXPIRY = "2099-01-01T00:00:00.000Z";
const FIXTURE_NEXT_EVENT = "2099-01-02T00:00:00.000Z";
const PROJECTION_IDS = [
  "calendar.availability.v1",
  "calendar.selected_events.v1",
  "goals.horizon_summary.v1",
  "health.cycling.aggregate.v1",
  "person.profile.v1",
  "life_events.selected.v1",
  "movement.aggregate.v1",
  "custom.selected_entities.v1"
];

function fixedHex(index, width = 64) {
  return index.toString(16).padStart(width, "0").slice(-width);
}

function personIdentity(index) {
  const suffix = String(index).padStart(5, "0");
  const displayName = `Benchmark Person ${suffix}`;
  return {
    id: `person_perf_${suffix}`,
    displayName,
    normalizedDisplayName: displayName.toLocaleLowerCase("und")
  };
}

function relationshipIdentity(index) {
  const suffix = String(index).padStart(3, "0");
  return {
    relationshipId: `relationship_perf_scale_${suffix}`,
    remotePrincipalId: `principal_perf_scale_remote_${suffix}`,
    remoteDeviceId: `device_perf_scale_remote_${suffix}`,
    channelId: `channel_perf_scale_${suffix}`
  };
}

function projectionIdentity(index, relationshipCount) {
  const suffix = String(index).padStart(6, "0");
  const relationship = relationshipIdentity(index % relationshipCount);
  const projectionId =
    PROJECTION_IDS[
      Math.floor(index / relationshipCount) % PROJECTION_IDS.length
    ];
  const queryHash = fixedHex(index + 1);
  return {
    id: `remote_perf_scale_${suffix}`,
    relationshipId: relationship.relationshipId,
    projectionId,
    sourceRecordId: `source-perf-scale-${suffix}`,
    queryHash,
    payloadHash: fixedHex(index + 100_001),
    nextEventAt: projectionId.startsWith("calendar.")
      ? FIXTURE_NEXT_EVENT
      : null
  };
}

function outboxIdentity(index, relationshipCount) {
  const suffix = String(index).padStart(7, "0");
  const relationshipIndex = index % relationshipCount;
  const relationship = relationshipIdentity(relationshipIndex);
  return {
    envelopeId: `outbox_perf_scale_${suffix}`,
    relationshipId: relationship.relationshipId,
    recipientDeviceId: relationship.remoteDeviceId,
    channelId: relationship.channelId,
    sequence: Math.floor(index / relationshipCount) + 1,
    ciphertextHash: fixedHex(index + 1_000_001)
  };
}

function updateDigest(hash, table, values) {
  hash.update(canonicalJson({ table, values }));
  hash.update("\n");
}

async function fileSha256(filePath, signal = null) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function prepareOwnedRoot(dataRoot, repositoryRoot, mode) {
  assertNotProtectedDataRoot(dataRoot, repositoryRoot);
  await mkdir(dataRoot, { recursive: true });
  const markerPath = path.join(dataRoot, PEOPLE_SCALE_FIXTURE_MARKER);
  const entries = await readdir(dataRoot);
  if (entries.length > 0 && !entries.includes(PEOPLE_SCALE_FIXTURE_MARKER)) {
    throw new Error(
      `People scale data root is not empty and has no ownership marker: ${dataRoot}`
    );
  }
  if (entries.includes(PEOPLE_SCALE_FIXTURE_MARKER)) {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (marker.fixtureId !== PEOPLE_SCALE_FIXTURE_ID || marker.mode !== mode) {
      throw new Error(`People scale data-root marker mismatch: ${markerPath}`);
    }
    return markerPath;
  }
  await writeFile(
    markerPath,
    `${canonicalJson({
      schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
      fixtureId: PEOPLE_SCALE_FIXTURE_ID,
      mode
    })}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  return markerPath;
}

async function runBatches(database, count, batchSize, insert, signal) {
  const startedAt = performance.now();
  let committedBatches = 0;
  for (let start = 0; start < count; start += batchSize) {
    signal?.throwIfAborted();
    const end = Math.min(count, start + batchSize);
    database.exec("BEGIN IMMEDIATE");
    try {
      for (let index = start; index < end; index += 1) insert(index);
      database.exec("COMMIT");
      committedBatches += 1;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    await yieldToEventLoop();
  }
  const durationMs = performance.now() - startedAt;
  return {
    rows: count,
    batchSize,
    committedBatches,
    durationMs,
    rowsPerSecond: count === 0 ? 0 : count / (durationMs / 1_000)
  };
}

function assertFreshScaleDatabase(database) {
  const tables = [
    "people",
    "peer_relationships",
    "peer_remote_records",
    "peer_outbox"
  ];
  for (const table of tables) {
    const count = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get().count;
    if (count !== 0) {
      throw new Error(
        `Isolated People scale database unexpectedly contains ${count} rows in ${table}.`
      );
    }
  }
}

async function seedPeople(database, profile, expectedDigest, signal) {
  const insertPerson = database.prepare(
    `INSERT INTO people (
       id, user_id, display_name, normalized_display_name,
       relationship_category, relationship_label, importance,
       short_description, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertOwner = database.prepare(
    `INSERT INTO entity_owners (
       entity_type, entity_id, user_id, role, created_at, updated_at
     ) VALUES ('person', ?, ?, 'owner', ?, ?)`
  );
  return runBatches(
    database,
    profile.scale.people,
    Math.min(profile.scale.insertBatchSize, 5_000),
    (index) => {
      const person = personIdentity(index);
      const category = index % 2 === 0 ? "friend" : "colleague";
      const label = index % 2 === 0 ? "Friend" : "Colleague";
      const description = `Deterministic People scale row ${String(index).padStart(5, "0")}.`;
      insertPerson.run(
        person.id,
        PEOPLE_FIXTURE_OWNER_ID,
        person.displayName,
        person.normalizedDisplayName,
        category,
        label,
        index % 6,
        description,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      insertOwner.run(
        person.id,
        PEOPLE_FIXTURE_OWNER_ID,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      updateDigest(expectedDigest, "people", [
        person.id,
        PEOPLE_FIXTURE_OWNER_ID,
        person.normalizedDisplayName,
        FIXTURE_TIMESTAMP
      ]);
    },
    signal
  );
}

async function seedLinks(database, profile, expectedDigest, signal) {
  const insert = database.prepare(
    `INSERT INTO entity_links (
       source_entity_type, source_entity_id, target_entity_type,
       target_entity_id, anchor_key, relationship, created_by_actor, created_at
     ) VALUES ('person', ?, 'person', ?, ?, 'related',
               'people-performance-fixture', ?)`
  );
  return runBatches(
    database,
    profile.scale.links,
    Math.min(profile.scale.insertBatchSize, 5_000),
    (index) => {
      const target = personIdentity(index + 1);
      const anchorKey = `perf-scale-link-${String(index).padStart(4, "0")}`;
      insert.run(
        PEOPLE_FIXTURE_SUBJECT_ID,
        target.id,
        anchorKey,
        FIXTURE_TIMESTAMP
      );
      updateDigest(expectedDigest, "entity_links", [
        PEOPLE_FIXTURE_SUBJECT_ID,
        target.id,
        anchorKey
      ]);
    },
    signal
  );
}

async function seedRelationships(database, profile, expectedDigest, signal) {
  const localPrincipalId = "principal_perf_scale_local";
  database
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, trust_state,
         created_at, updated_at
       ) VALUES (?, ?, 'local', ?, ?, 'perf-scale-local-secret', ?,
                 'verified', ?, ?)`
    )
    .run(
      localPrincipalId,
      PEOPLE_FIXTURE_OWNER_ID,
      "perf-scale-local-principal",
      "perf-scale-local-root-key-material-0001",
      "People scale local principal",
      FIXTURE_TIMESTAMP,
      FIXTURE_TIMESTAMP
    );
  const insertPrincipal = database.prepare(
    `INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id,
       root_public_key, root_key_secret_id, display_label, trust_state,
       created_at, updated_at
     ) VALUES (?, ?, 'remote', ?, ?, NULL, ?, 'verified', ?, ?)`
  );
  const insertDevice = database.prepare(
    `INSERT INTO forge_devices (
       id, owner_user_id, principal_id, certified_public_key,
       private_key_secret_id, certificate, label, device_type, status,
       transport_endpoints_json, capabilities_json, added_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'desktop', 'approved', '[]', '[]',
               ?, ?, ?)`
  );
  const insertRelationship = database.prepare(
    `INSERT INTO peer_relationships (
       id, owner_user_id, local_principal_id, remote_principal_id,
       local_person_id, status, negotiated_protocol_version,
       verification_phrase_hash, transport_privacy_mode, established_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'active', 'forge-peer/1', ?, 'fastest', ?, ?, ?)`
  );
  const insertRelationshipDevice = database.prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'remote', 'approved', ?, ?, ?)`
  );
  return runBatches(
    database,
    profile.scale.relationships,
    Math.min(profile.scale.insertBatchSize, 1_000),
    (index) => {
      const identity = relationshipIdentity(index);
      const suffix = String(index).padStart(3, "0");
      const person = personIdentity(index % profile.scale.people);
      insertPrincipal.run(
        identity.remotePrincipalId,
        PEOPLE_FIXTURE_OWNER_ID,
        `perf-scale-remote-principal-${suffix}`,
        `perf-scale-remote-root-key-${suffix}-${"r".repeat(16)}`,
        `People scale remote ${suffix}`,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      insertDevice.run(
        identity.remoteDeviceId,
        PEOPLE_FIXTURE_OWNER_ID,
        identity.remotePrincipalId,
        `perf-scale-signing-key-${suffix}-${"s".repeat(16)}`,
        `perf-scale-certificate-${suffix}-${"c".repeat(48)}`,
        `Scale device ${suffix}`,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      insertRelationship.run(
        identity.relationshipId,
        PEOPLE_FIXTURE_OWNER_ID,
        localPrincipalId,
        identity.remotePrincipalId,
        person.id,
        fixedHex(index + 1),
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      insertRelationshipDevice.run(
        identity.relationshipId,
        PEOPLE_FIXTURE_OWNER_ID,
        identity.remoteDeviceId,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      updateDigest(expectedDigest, "peer_relationships", [
        identity.relationshipId,
        PEOPLE_FIXTURE_OWNER_ID,
        identity.remotePrincipalId,
        person.id
      ]);
    },
    signal
  );
}

async function seedProjections(database, profile, expectedDigest, signal) {
  const insert = database.prepare(
    `INSERT INTO peer_remote_records (
       id, owner_user_id, relationship_id, projection_id, projection_version,
       source_record_id, source_version, encrypted_payload, encryption_key_id,
       encryption_nonce, payload_hash, query_metadata_json, source_timestamp,
       received_at, valid_until, completeness, precision, cache_state,
       query_hash, next_event_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, 'fixture-v1', ?, 'perf-scale-key', ?, ?, ?,
               ?, ?, ?, 1, 'exact', 'current', ?, ?, ?, ?)`
  );
  const payload = Buffer.from("people-scale-projection");
  const nonce = Buffer.alloc(24, 7);
  return runBatches(
    database,
    profile.scale.projections,
    profile.scale.insertBatchSize,
    (index) => {
      const projection = projectionIdentity(index, profile.scale.relationships);
      const queryMetadata = canonicalJson({ queryHash: projection.queryHash });
      insert.run(
        projection.id,
        PEOPLE_FIXTURE_OWNER_ID,
        projection.relationshipId,
        projection.projectionId,
        projection.sourceRecordId,
        payload,
        nonce,
        projection.payloadHash,
        queryMetadata,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        FIXTURE_EXPIRY,
        projection.queryHash,
        projection.nextEventAt,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      updateDigest(expectedDigest, "peer_remote_records", [
        projection.id,
        projection.relationshipId,
        projection.projectionId,
        projection.sourceRecordId,
        projection.queryHash
      ]);
    },
    signal
  );
}

async function seedOutbox(database, profile, expectedDigest, signal) {
  const insert = database.prepare(
    `INSERT INTO peer_outbox (
       envelope_id, owner_user_id, relationship_id, recipient_device_id,
       channel_id, sequence, previous_acknowledgement, message_kind,
       mls_epoch, ciphertext, ciphertext_hash, size_bytes, status,
       attempt_count, next_attempt_at, last_attempt_at, acknowledged_at,
       expires_at, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 'projection_delta', 1, ?, ?, 1, ?, 0,
               ?, NULL, ?, ?, '', ?, ?)`
  );
  const ciphertext = Buffer.from([1]);
  return runBatches(
    database,
    profile.scale.outbox,
    profile.scale.insertBatchSize,
    (index) => {
      const envelope = outboxIdentity(index, profile.scale.relationships);
      const acknowledged = index % 20 === 19;
      const failed = !acknowledged && index % 20 === 18;
      const status = acknowledged
        ? "acknowledged"
        : failed
          ? "failed"
          : "pending";
      insert.run(
        envelope.envelopeId,
        PEOPLE_FIXTURE_OWNER_ID,
        envelope.relationshipId,
        envelope.recipientDeviceId,
        envelope.channelId,
        envelope.sequence,
        ciphertext,
        envelope.ciphertextHash,
        status,
        FIXTURE_TIMESTAMP,
        acknowledged ? FIXTURE_TIMESTAMP : null,
        FIXTURE_EXPIRY,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP
      );
      updateDigest(expectedDigest, "peer_outbox", [
        envelope.envelopeId,
        envelope.relationshipId,
        envelope.recipientDeviceId,
        envelope.channelId,
        envelope.sequence,
        envelope.ciphertextHash
      ]);
    },
    signal
  );
}

function readCounts(database) {
  const count = (table, where = "", parameters = []) =>
    database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
      .get(...parameters).count;
  return {
    people: count("people"),
    personOwners: count("entity_owners", "WHERE entity_type = 'person'"),
    links: count("entity_links", "WHERE anchor_key LIKE 'perf-scale-link-%'"),
    relationships: count("peer_relationships"),
    relationshipDevices: count("peer_relationship_devices"),
    projections: count("peer_remote_records"),
    outbox: count("peer_outbox")
  };
}

async function streamActualDigest(database, signal = null) {
  const hash = createHash("sha256");
  const stream = async (table, sql, map) => {
    let rowCount = 0;
    for (const row of database.prepare(sql).iterate()) {
      updateDigest(hash, table, map(row));
      rowCount += 1;
      if (rowCount % 25_000 === 0) {
        signal?.throwIfAborted();
        await yieldToEventLoop();
      }
    }
  };
  await stream(
    "people",
    `SELECT id, user_id, normalized_display_name, created_at
     FROM people ORDER BY id`,
    (row) => [row.id, row.user_id, row.normalized_display_name, row.created_at]
  );
  await stream(
    "entity_links",
    `SELECT source_entity_id, target_entity_id, anchor_key
     FROM entity_links WHERE anchor_key LIKE 'perf-scale-link-%'
     ORDER BY anchor_key`,
    (row) => [row.source_entity_id, row.target_entity_id, row.anchor_key]
  );
  await stream(
    "peer_relationships",
    `SELECT id, owner_user_id, remote_principal_id, local_person_id
     FROM peer_relationships ORDER BY id`,
    (row) => [
      row.id,
      row.owner_user_id,
      row.remote_principal_id,
      row.local_person_id
    ]
  );
  await stream(
    "peer_remote_records",
    `SELECT id, relationship_id, projection_id, source_record_id, query_hash
     FROM peer_remote_records ORDER BY id`,
    (row) => [
      row.id,
      row.relationship_id,
      row.projection_id,
      row.source_record_id,
      row.query_hash
    ]
  );
  await stream(
    "peer_outbox",
    `SELECT envelope_id, relationship_id, recipient_device_id, channel_id,
            sequence, ciphertext_hash
     FROM peer_outbox ORDER BY envelope_id`,
    (row) => [
      row.envelope_id,
      row.relationship_id,
      row.recipient_device_id,
      row.channel_id,
      row.sequence,
      row.ciphertext_hash
    ]
  );
  signal?.throwIfAborted();
  return hash.digest("hex");
}

function expectedCounts(profile) {
  return {
    people: profile.scale.people,
    personOwners: profile.scale.people,
    links: profile.scale.links,
    relationships: profile.scale.relationships,
    relationshipDevices: profile.scale.relationships,
    projections: profile.scale.projections,
    outbox: profile.scale.outbox
  };
}

async function verifyDatabase(
  database,
  profile,
  expectedLogicalSha256,
  signal = null
) {
  const counts = readCounts(database);
  if (canonicalJson(counts) !== canonicalJson(expectedCounts(profile))) {
    throw new Error(
      `People scale fixture counts are incomplete: expected ${canonicalJson(expectedCounts(profile))}, received ${canonicalJson(counts)}.`
    );
  }
  const logicalSha256 = await streamActualDigest(database, signal);
  if (logicalSha256 !== expectedLogicalSha256) {
    throw new Error(
      `People scale logical SHA-256 mismatch: expected ${expectedLogicalSha256}, received ${logicalSha256}.`
    );
  }
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(
      `People scale SQLite integrity check failed: ${canonicalJson(integrity)}`
    );
  }
  const foreignKeyViolations = [
    ...database.prepare("PRAGMA foreign_key_check").iterate()
  ];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `People scale foreign-key check found ${foreignKeyViolations.length} violations.`
    );
  }
  return {
    counts,
    logicalSha256,
    sqliteIntegrity: "ok",
    foreignKeyViolations: 0
  };
}

export async function createPeopleScalePerformanceFixture({
  dataRoot,
  repositoryRoot,
  profile,
  initializeDatabase,
  signal = null
}) {
  signal?.throwIfAborted();
  const markerPath = await prepareOwnedRoot(
    dataRoot,
    repositoryRoot,
    profile.mode
  );
  await initializeDatabase(dataRoot, signal);
  signal?.throwIfAborted();
  const databasePath = path.join(dataRoot, "forge.sqlite");
  const database = new DatabaseSync(databasePath);
  const seedStartedAt = performance.now();
  let seed;
  let verified;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    assertFreshScaleDatabase(database);
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec("PRAGMA synchronous = OFF");
    database.exec("PRAGMA temp_store = MEMORY");
    database.exec("PRAGMA cache_size = -131072");

    const expectedDigest = createHash("sha256");
    seed = {
      people: await seedPeople(database, profile, expectedDigest, signal),
      links: await seedLinks(database, profile, expectedDigest, signal),
      relationships: await seedRelationships(
        database,
        profile,
        expectedDigest,
        signal
      ),
      projections: await seedProjections(
        database,
        profile,
        expectedDigest,
        signal
      ),
      outbox: await seedOutbox(database, profile, expectedDigest, signal)
    };
    signal?.throwIfAborted();
    const expectedLogicalSha256 = expectedDigest.digest("hex");
    database.exec("ANALYZE");
    database.exec("PRAGMA optimize");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    verified = await verifyDatabase(
      database,
      profile,
      expectedLogicalSha256,
      signal
    );
  } finally {
    database.close();
  }
  signal?.throwIfAborted();

  const manifest = {
    schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
    fixtureId: PEOPLE_SCALE_FIXTURE_ID,
    mode: profile.mode,
    deterministicSeed: PEOPLE_SCALE_FIXTURE_ID,
    counts: verified.counts,
    logicalSha256: verified.logicalSha256,
    databaseSha256: await fileSha256(databasePath, signal),
    sqliteIntegrity: verified.sqliteIntegrity,
    foreignKeyViolations: verified.foreignKeyViolations,
    seed: {
      ...seed,
      fixtureBuildDurationMs: performance.now() - seedStartedAt,
      strategy:
        "prepared statements in bounded transactions; production indexes retained"
    },
    databasePath,
    dataRoot,
    markerPath,
    subjectPersonId: PEOPLE_FIXTURE_SUBJECT_ID,
    relationshipId: relationshipIdentity(0).relationshipId,
    searchQuery: "Benchmark Person 00"
  };
  const manifestPath = path.join(dataRoot, PEOPLE_SCALE_FIXTURE_MANIFEST);
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return { ...manifest, manifestPath };
}

export async function verifyPeopleScalePerformanceFixture({
  dataRoot,
  repositoryRoot,
  profile,
  signal = null
}) {
  assertNotProtectedDataRoot(dataRoot, repositoryRoot);
  const marker = JSON.parse(
    await readFile(path.join(dataRoot, PEOPLE_SCALE_FIXTURE_MARKER), "utf8")
  );
  if (
    marker.fixtureId !== PEOPLE_SCALE_FIXTURE_ID ||
    marker.mode !== profile.mode
  ) {
    throw new Error("People scale root marker is missing or incompatible.");
  }
  const manifest = JSON.parse(
    await readFile(path.join(dataRoot, PEOPLE_SCALE_FIXTURE_MANIFEST), "utf8")
  );
  const database = new DatabaseSync(path.join(dataRoot, "forge.sqlite"), {
    readOnly: true
  });
  try {
    return await verifyDatabase(
      database,
      profile,
      manifest.logicalSha256,
      signal
    );
  } finally {
    database.close();
  }
}
