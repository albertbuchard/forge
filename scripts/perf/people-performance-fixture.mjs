import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PEOPLE_FIXTURE_ID,
  PEOPLE_FIXTURE_MANIFEST,
  PEOPLE_FIXTURE_MARKER,
  PEOPLE_PERFORMANCE_SCHEMA_VERSION,
  assertNotProtectedDataRoot,
  canonicalJson,
  logicalFixtureSha256,
  sha256
} from "./people-performance-contract.mjs";

export const PEOPLE_FIXTURE_OWNER_ID = "user_operator";
export const PEOPLE_FIXTURE_SUBJECT_ID = "person_perf_00000";
export const PEOPLE_FIXTURE_RELATIONSHIP_ID = "relationship_perf_context";

const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z";
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

function personRow(index) {
  const suffix = String(index).padStart(5, "0");
  const displayName = `Benchmark Person ${suffix}`;
  return {
    table: "people",
    id: `person_perf_${suffix}`,
    userId: PEOPLE_FIXTURE_OWNER_ID,
    displayName,
    normalizedDisplayName: displayName.toLocaleLowerCase("und"),
    relationshipCategory: index % 2 === 0 ? "friend" : "colleague",
    relationshipLabel: index % 2 === 0 ? "Friend" : "Colleague",
    importance: index % 6,
    shortDescription: `Deterministic People performance fixture row ${suffix}.`,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP
  };
}

function ownerRow(index) {
  return {
    table: "entity_owners",
    entityType: "person",
    entityId: personRow(index).id,
    userId: PEOPLE_FIXTURE_OWNER_ID,
    role: "owner",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP
  };
}

function linkRow(index) {
  return {
    table: "entity_links",
    sourceEntityType: "person",
    sourceEntityId: PEOPLE_FIXTURE_SUBJECT_ID,
    targetEntityType: "person",
    targetEntityId: personRow(index + 1).id,
    anchorKey: `perf-link-${String(index).padStart(4, "0")}`,
    relationship: "related",
    createdByActor: "people-performance-fixture",
    createdAt: FIXTURE_TIMESTAMP
  };
}

function projectionRow(index) {
  const suffix = String(index).padStart(4, "0");
  const projectionId = PROJECTION_IDS[index % PROJECTION_IDS.length];
  const queryHash = sha256(`people-performance-query-${suffix}`);
  const receivedAt = new Date(
    Date.parse(FIXTURE_TIMESTAMP) + index * 1_000
  ).toISOString();
  return {
    table: "peer_remote_records",
    id: `remote_perf_${suffix}`,
    ownerUserId: PEOPLE_FIXTURE_OWNER_ID,
    relationshipId: PEOPLE_FIXTURE_RELATIONSHIP_ID,
    projectionId,
    projectionVersion: 1,
    sourceRecordId: `source-perf-${suffix}`,
    sourceVersion: "fixture-v1",
    encryptionKeyId: "perf-fixture-key",
    payloadHash: sha256(`people-performance-payload-${suffix}`),
    queryMetadataJson: canonicalJson({ queryHash }),
    sourceTimestamp: receivedAt,
    receivedAt,
    validUntil: "2099-01-01T00:00:00.000Z",
    completeness: 1,
    precision: "exact",
    cacheState: "current",
    queryHash,
    nextEventAt: projectionId.startsWith("calendar.")
      ? "2099-01-02T00:00:00.000Z"
      : null,
    createdAt: receivedAt,
    updatedAt: receivedAt
  };
}

function fixtureSetupRows() {
  return [
    {
      table: "forge_principals",
      id: "principal_perf_local",
      ownerUserId: PEOPLE_FIXTURE_OWNER_ID,
      principalKind: "local",
      publicPrincipalId: "perf-local-principal-0001",
      rootPublicKey: "a".repeat(64),
      rootKeySecretId: "perf-local-secret",
      displayLabel: "People performance local principal",
      trustState: "verified",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP
    },
    {
      table: "forge_principals",
      id: "principal_perf_remote",
      ownerUserId: PEOPLE_FIXTURE_OWNER_ID,
      principalKind: "remote",
      publicPrincipalId: "perf-remote-principal-0001",
      rootPublicKey: "b".repeat(64),
      rootKeySecretId: null,
      displayLabel: "People performance remote principal",
      trustState: "verified",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP
    },
    {
      table: "peer_relationships",
      id: PEOPLE_FIXTURE_RELATIONSHIP_ID,
      ownerUserId: PEOPLE_FIXTURE_OWNER_ID,
      localPrincipalId: "principal_perf_local",
      remotePrincipalId: "principal_perf_remote",
      localPersonId: PEOPLE_FIXTURE_SUBJECT_ID,
      status: "active",
      negotiatedProtocolVersion: "forge-peer/1",
      verificationPhraseHash: "c".repeat(64),
      transportPrivacyMode: "fastest",
      establishedAt: FIXTURE_TIMESTAMP,
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP
    }
  ];
}

export function expectedLogicalFixtureRows(profile) {
  const rows = [];
  for (let index = 0; index < profile.fixture.people; index += 1) {
    rows.push(personRow(index));
  }
  for (let index = 0; index < profile.fixture.people; index += 1) {
    rows.push(ownerRow(index));
  }
  for (let index = 0; index < profile.fixture.links; index += 1) {
    rows.push(linkRow(index));
  }
  rows.push(...fixtureSetupRows());
  for (let index = 0; index < profile.fixture.projections; index += 1) {
    rows.push(projectionRow(index));
  }
  return rows;
}

function tableColumns(database, table) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
  );
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function prepareOwnedRoot(dataRoot, repositoryRoot, mode) {
  assertNotProtectedDataRoot(dataRoot, repositoryRoot);
  await mkdir(dataRoot, { recursive: true });
  const markerPath = path.join(dataRoot, PEOPLE_FIXTURE_MARKER);
  const entries = await readdir(dataRoot);
  if (entries.length > 0 && !entries.includes(PEOPLE_FIXTURE_MARKER)) {
    throw new Error(
      `People performance data root is not empty and has no ownership marker: ${dataRoot}`
    );
  }
  if (entries.includes(PEOPLE_FIXTURE_MARKER)) {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (marker.fixtureId !== PEOPLE_FIXTURE_ID || marker.mode !== mode) {
      throw new Error(
        `People performance data-root marker mismatch: ${markerPath}`
      );
    }
    return markerPath;
  }
  await writeFile(
    markerPath,
    `${canonicalJson({
      schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
      fixtureId: PEOPLE_FIXTURE_ID,
      mode
    })}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  return markerPath;
}

function seedFixture(database, profile) {
  const existingPeople = database
    .prepare("SELECT COUNT(*) AS count FROM people")
    .get().count;
  if (existingPeople !== 0) {
    throw new Error(
      `Isolated People fixture database unexpectedly contains ${existingPeople} Person rows.`
    );
  }
  const owner = database
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(PEOPLE_FIXTURE_OWNER_ID);
  if (!owner) {
    throw new Error("The isolated Forge database has no user_operator owner.");
  }

  const insertPerson = database.prepare(
    `INSERT INTO people (
       id, user_id, display_name, normalized_display_name,
       relationship_category, relationship_label, importance, short_description,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertOwner = database.prepare(
    `INSERT INTO entity_owners (
       entity_type, entity_id, user_id, role, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertLink = database.prepare(
    `INSERT INTO entity_links (
       source_entity_type, source_entity_id, target_entity_type,
       target_entity_id, anchor_key, relationship, created_by_actor, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  database.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < profile.fixture.people; index += 1) {
      const person = personRow(index);
      insertPerson.run(
        person.id,
        person.userId,
        person.displayName,
        person.normalizedDisplayName,
        person.relationshipCategory,
        person.relationshipLabel,
        person.importance,
        person.shortDescription,
        person.createdAt,
        person.updatedAt
      );
      const ownerRowValue = ownerRow(index);
      insertOwner.run(
        ownerRowValue.entityType,
        ownerRowValue.entityId,
        ownerRowValue.userId,
        ownerRowValue.role,
        ownerRowValue.createdAt,
        ownerRowValue.updatedAt
      );
    }
    for (let index = 0; index < profile.fixture.links; index += 1) {
      const link = linkRow(index);
      insertLink.run(
        link.sourceEntityType,
        link.sourceEntityId,
        link.targetEntityType,
        link.targetEntityId,
        link.anchorKey,
        link.relationship,
        link.createdByActor,
        link.createdAt
      );
    }

    const [localPrincipal, remotePrincipal, relationship] = fixtureSetupRows();
    const insertPrincipal = database.prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, trust_state,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const principal of [localPrincipal, remotePrincipal]) {
      insertPrincipal.run(
        principal.id,
        principal.ownerUserId,
        principal.principalKind,
        principal.publicPrincipalId,
        principal.rootPublicKey,
        principal.rootKeySecretId,
        principal.displayLabel,
        principal.trustState,
        principal.createdAt,
        principal.updatedAt
      );
    }
    database
      .prepare(
        `INSERT INTO peer_relationships (
           id, owner_user_id, local_principal_id, remote_principal_id,
           local_person_id, status, negotiated_protocol_version,
           verification_phrase_hash, transport_privacy_mode, established_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        relationship.id,
        relationship.ownerUserId,
        relationship.localPrincipalId,
        relationship.remotePrincipalId,
        relationship.localPersonId,
        relationship.status,
        relationship.negotiatedProtocolVersion,
        relationship.verificationPhraseHash,
        relationship.transportPrivacyMode,
        relationship.establishedAt,
        relationship.createdAt,
        relationship.updatedAt
      );

    const remoteColumns = tableColumns(database, "peer_remote_records");
    const optionalColumns = ["query_hash", "next_event_at"].filter((column) =>
      remoteColumns.has(column)
    );
    if (optionalColumns.length !== 2) {
      throw new Error(
        "People performance fixture requires query_hash and next_event_at projection columns."
      );
    }
    const insertProjection = database.prepare(
      `INSERT INTO peer_remote_records (
         id, owner_user_id, relationship_id, projection_id, projection_version,
         source_record_id, source_version, encrypted_payload, encryption_key_id,
         encryption_nonce, payload_hash, query_metadata_json, source_timestamp,
         received_at, valid_until, completeness, precision, cache_state,
         query_hash, next_event_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let index = 0; index < profile.fixture.projections; index += 1) {
      const projection = projectionRow(index);
      insertProjection.run(
        projection.id,
        projection.ownerUserId,
        projection.relationshipId,
        projection.projectionId,
        projection.projectionVersion,
        projection.sourceRecordId,
        projection.sourceVersion,
        Buffer.from(`payload-${projection.id}`),
        projection.encryptionKeyId,
        Buffer.alloc(24, index % 251),
        projection.payloadHash,
        projection.queryMetadataJson,
        projection.sourceTimestamp,
        projection.receivedAt,
        projection.validUntil,
        projection.completeness,
        projection.precision,
        projection.cacheState,
        projection.queryHash,
        projection.nextEventAt,
        projection.createdAt,
        projection.updatedAt
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readActualLogicalRows(database) {
  const rows = [];
  const people = database
    .prepare(
      `SELECT id, user_id AS userId, display_name AS displayName,
              normalized_display_name AS normalizedDisplayName,
              relationship_category AS relationshipCategory,
              relationship_label AS relationshipLabel, importance,
              short_description AS shortDescription,
              created_at AS createdAt, updated_at AS updatedAt
       FROM people ORDER BY id`
    )
    .all();
  rows.push(...people.map((row) => ({ table: "people", ...row })));
  const owners = database
    .prepare(
      `SELECT entity_type AS entityType, entity_id AS entityId,
              user_id AS userId, role, created_at AS createdAt,
              updated_at AS updatedAt
       FROM entity_owners
       WHERE entity_type = 'person'
       ORDER BY entity_id`
    )
    .all();
  rows.push(...owners.map((row) => ({ table: "entity_owners", ...row })));
  const links = database
    .prepare(
      `SELECT source_entity_type AS sourceEntityType,
              source_entity_id AS sourceEntityId,
              target_entity_type AS targetEntityType,
              target_entity_id AS targetEntityId, anchor_key AS anchorKey,
              relationship, created_by_actor AS createdByActor,
              created_at AS createdAt
       FROM entity_links
       WHERE anchor_key LIKE 'perf-link-%'
       ORDER BY anchor_key`
    )
    .all();
  rows.push(...links.map((row) => ({ table: "entity_links", ...row })));
  const principals = database
    .prepare(
      `SELECT id, owner_user_id AS ownerUserId, principal_kind AS principalKind,
              public_principal_id AS publicPrincipalId,
              root_public_key AS rootPublicKey,
              root_key_secret_id AS rootKeySecretId,
              display_label AS displayLabel, trust_state AS trustState,
              created_at AS createdAt, updated_at AS updatedAt
       FROM forge_principals
       WHERE id IN ('principal_perf_local', 'principal_perf_remote')
       ORDER BY id`
    )
    .all();
  rows.push(
    ...principals.map((row) => ({ table: "forge_principals", ...row }))
  );
  const relationships = database
    .prepare(
      `SELECT id, owner_user_id AS ownerUserId,
              local_principal_id AS localPrincipalId,
              remote_principal_id AS remotePrincipalId,
              local_person_id AS localPersonId, status,
              negotiated_protocol_version AS negotiatedProtocolVersion,
              verification_phrase_hash AS verificationPhraseHash,
              transport_privacy_mode AS transportPrivacyMode,
              established_at AS establishedAt, created_at AS createdAt,
              updated_at AS updatedAt
       FROM peer_relationships WHERE id = ?`
    )
    .all(PEOPLE_FIXTURE_RELATIONSHIP_ID);
  rows.push(
    ...relationships.map((row) => ({ table: "peer_relationships", ...row }))
  );
  const projections = database
    .prepare(
      `SELECT id, owner_user_id AS ownerUserId,
              relationship_id AS relationshipId, projection_id AS projectionId,
              projection_version AS projectionVersion,
              source_record_id AS sourceRecordId, source_version AS sourceVersion,
              encryption_key_id AS encryptionKeyId, payload_hash AS payloadHash,
              query_metadata_json AS queryMetadataJson,
              source_timestamp AS sourceTimestamp, received_at AS receivedAt,
              valid_until AS validUntil, completeness, precision,
              cache_state AS cacheState, query_hash AS queryHash,
              next_event_at AS nextEventAt, created_at AS createdAt,
              updated_at AS updatedAt
       FROM peer_remote_records
       WHERE id LIKE 'remote_perf_%'
       ORDER BY id`
    )
    .all();
  rows.push(
    ...projections.map((row) => ({ table: "peer_remote_records", ...row }))
  );
  return rows;
}

function fixtureCounts(database) {
  return {
    people: database.prepare("SELECT COUNT(*) AS count FROM people").get()
      .count,
    personOwners: database
      .prepare(
        "SELECT COUNT(*) AS count FROM entity_owners WHERE entity_type = 'person'"
      )
      .get().count,
    links: database
      .prepare(
        "SELECT COUNT(*) AS count FROM entity_links WHERE anchor_key LIKE 'perf-link-%'"
      )
      .get().count,
    projections: database
      .prepare(
        "SELECT COUNT(*) AS count FROM peer_remote_records WHERE id LIKE 'remote_perf_%'"
      )
      .get().count,
    relationships: database
      .prepare("SELECT COUNT(*) AS count FROM peer_relationships WHERE id = ?")
      .get(PEOPLE_FIXTURE_RELATIONSHIP_ID).count
  };
}

function verifyDatabase(database, profile, expectedHash) {
  const counts = fixtureCounts(database);
  const expectedCounts = {
    people: profile.fixture.people,
    personOwners: profile.fixture.people,
    links: profile.fixture.links,
    projections: profile.fixture.projections,
    relationships: 1
  };
  if (canonicalJson(counts) !== canonicalJson(expectedCounts)) {
    throw new Error(
      `People fixture row counts are incomplete: expected ${canonicalJson(expectedCounts)}, received ${canonicalJson(counts)}.`
    );
  }
  const totalLinks = database
    .prepare("SELECT COUNT(*) AS count FROM entity_links")
    .get().count;
  const totalProjections = database
    .prepare("SELECT COUNT(*) AS count FROM peer_remote_records")
    .get().count;
  if (
    totalLinks !== profile.fixture.links ||
    totalProjections !== profile.fixture.projections
  ) {
    throw new Error(
      `People fixture contains unexpected context rows: expected ${profile.fixture.links} total links and ${profile.fixture.projections} total projections, received ${totalLinks} and ${totalProjections}.`
    );
  }
  const logicalSha256 = logicalFixtureSha256(readActualLogicalRows(database));
  if (logicalSha256 !== expectedHash) {
    throw new Error(
      `People fixture SHA-256 mismatch: expected ${expectedHash}, received ${logicalSha256}.`
    );
  }
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(
      `People fixture SQLite integrity check failed: ${canonicalJson(integrity)}`
    );
  }
  return { counts, logicalSha256 };
}

export async function createPeoplePerformanceFixture({
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
  const expectedRows = expectedLogicalFixtureRows(profile);
  const expectedHash = logicalFixtureSha256(expectedRows);
  let verified;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    seedFixture(database, profile);
    signal?.throwIfAborted();
    verified = verifyDatabase(database, profile, expectedHash);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }

  const manifest = {
    schemaVersion: PEOPLE_PERFORMANCE_SCHEMA_VERSION,
    fixtureId: PEOPLE_FIXTURE_ID,
    mode: profile.mode,
    deterministicSeed: PEOPLE_FIXTURE_ID,
    counts: verified.counts,
    logicalSha256: verified.logicalSha256,
    databaseSha256: await fileSha256(databasePath),
    databasePath,
    dataRoot,
    markerPath,
    subjectPersonId: PEOPLE_FIXTURE_SUBJECT_ID,
    relationshipId: PEOPLE_FIXTURE_RELATIONSHIP_ID,
    searchQuery: "Benchmark Person 00"
  };
  const manifestPath = path.join(dataRoot, PEOPLE_FIXTURE_MANIFEST);
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return { ...manifest, manifestPath };
}

export async function verifyPeoplePerformanceFixture({
  dataRoot,
  repositoryRoot,
  profile
}) {
  assertNotProtectedDataRoot(dataRoot, repositoryRoot);
  const marker = JSON.parse(
    await readFile(path.join(dataRoot, PEOPLE_FIXTURE_MARKER), "utf8")
  );
  if (marker.fixtureId !== PEOPLE_FIXTURE_ID || marker.mode !== profile.mode) {
    throw new Error(
      "People performance root marker is missing or incompatible."
    );
  }
  const expectedHash = logicalFixtureSha256(
    expectedLogicalFixtureRows(profile)
  );
  const database = new DatabaseSync(path.join(dataRoot, "forge.sqlite"), {
    readOnly: true
  });
  try {
    return verifyDatabase(database, profile, expectedHash);
  } finally {
    database.close();
  }
}
