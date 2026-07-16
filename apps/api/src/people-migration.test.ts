import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  createPeopleIdempotencyRecord,
  createPerson,
  createWikiPersonAssociationPreviewRecord,
  getPersonById
} from "./repositories/people.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "087_people_and_peer_sharing.sql";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function applyMigrationsBefore087(databasePath: string): Promise<void> {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  try {
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      database.exec("BEGIN");
      try {
        database.exec(sql);
        database
          .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
          .run(file, "2026-07-15T07:00:00.000Z");
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    database.close();
  }
}

function assertGrantVerificationEvidenceRoundTrip(now: string): void {
  const exactGrantHash = "a".repeat(64);
  const signatures = [
    {
      deviceId: "device_owner",
      party: "grantor",
      algorithm: "ed25519",
      signature: "A".repeat(64),
      signedAt: "2026-07-15T08:01:00.000Z"
    },
    {
      deviceId: "device_remote",
      party: "grantee",
      algorithm: "ed25519",
      signature: "B".repeat(64),
      signedAt: "2026-07-15T08:02:00.000Z"
    }
  ];
  const canonicalGrant = {
    id: "grant_fixture",
    ownerUserId: "user_people_sentinel",
    relationshipId: "relationship_fixture",
    direction: "local_to_remote",
    sequence: 1,
    previousVersionHash: null,
    status: "active",
    label: "Fixture grant",
    purpose: "Storage evidence test",
    issuedAt: "2026-07-15T08:00:00.000Z",
    effectiveAt: "2026-07-15T08:03:00.000Z",
    expiresAt: null,
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked",
      maximumRetentionSeconds: 86400,
      purgeOnRevocation: true
    },
    rules: [
      {
        id: "rule_fixture",
        effect: "allow",
        projectionId: "person.profile.v1"
      }
    ],
    signatures,
    protocolVersion: "forge-peer/1",
    schemaVersion: 1
  };
  const database = getDatabase();
  const insertPrincipal = database.prepare(
    `INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id, root_public_key,
       root_key_secret_id, display_label, trust_state, first_verified_at,
       last_verified_at, created_at, updated_at
     ) VALUES (
       ?, 'user_people_sentinel', ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?
     )`
  );
  insertPrincipal.run(
    "principal_owner",
    "local",
    "public-principal-owner",
    "O".repeat(64),
    "secret://principal-owner",
    "Owner",
    now,
    now,
    now,
    now
  );
  insertPrincipal.run(
    "principal_remote",
    "remote",
    "public-principal-remote",
    "R".repeat(64),
    null,
    "Remote",
    now,
    now,
    now,
    now
  );
  const insertDevice = database.prepare(
    `INSERT INTO forge_devices (
       id, owner_user_id, principal_id, certified_public_key, private_key_secret_id,
       certificate, label, device_type, status, added_at, created_at, updated_at
     ) VALUES (
       ?, 'user_people_sentinel', ?, ?, ?, ?, ?, 'test', 'approved', ?, ?, ?
     )`
  );
  insertDevice.run(
    "device_owner",
    "principal_owner",
    "K".repeat(64),
    "secret://device-owner",
    "C".repeat(128),
    "Owner device",
    now,
    now,
    now
  );
  insertDevice.run(
    "device_remote",
    "principal_remote",
    "L".repeat(64),
    null,
    "D".repeat(128),
    "Remote device",
    now,
    now,
    now
  );
  database
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id, status,
         verification_phrase_hash, established_at, created_at, updated_at
       ) VALUES (
         'relationship_fixture', 'user_people_sentinel', 'principal_owner',
         'principal_remote', 'active', ?, ?, ?, ?
       )`
    )
    .run("f".repeat(64), now, now, now);
  const insertRelationshipDevice = database.prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, created_at, updated_at
     ) VALUES (
       'relationship_fixture', 'user_people_sentinel', ?, ?, 'approved', ?, ?, ?
     )`
  );
  insertRelationshipDevice.run("device_owner", "local", now, now, now);
  insertRelationshipDevice.run("device_remote", "remote", now, now, now);
  database
    .prepare(
      `INSERT INTO peer_share_grants (
         id, sequence, owner_user_id, relationship_id, direction, status,
         previous_version_hash, version_hash, label, purpose, canonical_grant_json,
         cache_policy_json, signatures_json, verification_evidence_json,
         issued_at, effective_at, created_at
       ) VALUES (
         'grant_fixture', 1, 'user_people_sentinel', 'relationship_fixture',
         'local_to_remote', 'active', NULL, ?, 'Fixture grant',
         'Storage evidence test', ?, ?, ?, ?, ?, ?, ?
       )`
    )
    .run(
      exactGrantHash,
      JSON.stringify(canonicalGrant),
      JSON.stringify(canonicalGrant.cachePolicy),
      JSON.stringify(signatures),
      JSON.stringify({
        verifiedGrantHash: exactGrantHash,
        verifiedSignerDeviceIds: ["device_owner", "device_remote"],
        approvedRelationshipDeviceIds: ["device_remote"]
      }),
      canonicalGrant.issuedAt,
      canonicalGrant.effectiveAt,
      now
    );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO peer_share_grants (
             id, sequence, owner_user_id, relationship_id, direction, status,
             previous_version_hash, version_hash, label, canonical_grant_json,
             cache_policy_json, signatures_json, issued_at, created_at
           ) VALUES (
             'grant_fixture', 2, 'user_people_sentinel', 'relationship_fixture',
             'local_to_remote', 'draft', ?, ?, 'Wrong chain', ?, ?, '[]', ?, ?
           )`
        )
        .run(
          "0".repeat(64),
          "c".repeat(64),
          JSON.stringify({ ...canonicalGrant, sequence: 2 }),
          JSON.stringify(canonicalGrant.cachePolicy),
          "2026-07-15T08:05:00.000Z",
          now
        ),
    /exact previous version/
  );
  const insertGrantSignature = database.prepare(
    `INSERT INTO peer_grant_signatures (
       grant_id, grant_sequence, owner_user_id, signer_device_id, party,
       algorithm, signature, signed_grant_hash, signed_at,
       verification_evidence_json, created_at
     ) VALUES (
       'grant_fixture', 1, 'user_people_sentinel', ?, ?, 'ed25519', ?, ?, ?, ?, ?
     )`
  );
  for (const signature of signatures) {
    insertGrantSignature.run(
      signature.deviceId,
      signature.party,
      signature.signature,
      exactGrantHash,
      signature.signedAt,
      JSON.stringify({ verifiedParty: signature.party }),
      now
    );
  }
  assert.throws(
    () =>
      insertGrantSignature.run(
        "device_owner",
        "grantee",
        "C".repeat(64),
        exactGrantHash,
        "2026-07-15T08:04:00.000Z",
        "{}",
        now
      ),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () =>
      insertGrantSignature.run(
        "device_owner",
        "grantor",
        "C".repeat(64),
        "0".repeat(64),
        "2026-07-15T08:04:00.000Z",
        "{}",
        now
      ),
    /exact grant version/
  );
  database
    .prepare(
      `INSERT INTO peer_share_rules (
         grant_id, grant_sequence, owner_user_id, id, rule_position,
         projection_id, effect, field_policy_json, time_policy_json,
         approved_device_ids_json, created_at
       ) VALUES (
         'grant_fixture', 1, 'user_people_sentinel', 'rule_fixture', 0,
         'person.profile.v1', 'allow', ?, ?, ?, ?
       )`
    )
    .run(
      JSON.stringify({ include: ["displayName"], exclude: [] }),
      JSON.stringify({ startsAt: null, endsAt: null }),
      JSON.stringify(["device_remote"]),
      now
    );
  database
    .prepare(
      `INSERT INTO peer_grant_verifications (
         id, owner_user_id, relationship_id, grant_id, grant_sequence,
         verified_grant_hash, verified_signatures_json,
         verified_signer_device_ids_json, approved_relationship_device_ids_json,
         requesting_device_id, verification_result, verified_at, created_at
       ) VALUES (
         'verification_fixture', 'user_people_sentinel', 'relationship_fixture',
         'grant_fixture', 1, ?, ?, ?, ?, 'device_remote', 'valid', ?, ?
       )`
    )
    .run(
      exactGrantHash,
      JSON.stringify(signatures),
      JSON.stringify(["device_owner", "device_remote"]),
      JSON.stringify(["device_remote"]),
      now,
      now
    );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO peer_grant_verifications (
             id, owner_user_id, relationship_id, grant_id, grant_sequence,
             verified_grant_hash, verified_signatures_json,
             verified_signer_device_ids_json,
             approved_relationship_device_ids_json, verification_result,
             verified_at, created_at
           ) VALUES (
             'verification_wrong_valid', 'user_people_sentinel',
             'relationship_fixture', 'grant_fixture', 1, ?, '[]', '[]', '[]',
             'valid', ?, ?
           )`
        )
        .run("0".repeat(64), now, now),
    /exact grant version/
  );
  database
    .prepare(
      `INSERT INTO peer_grant_verifications (
         id, owner_user_id, relationship_id, grant_id, grant_sequence,
         verified_grant_hash, verified_signatures_json,
         verified_signer_device_ids_json,
         approved_relationship_device_ids_json, verification_result,
         failure_reason, verified_at, created_at
       ) VALUES (
         'verification_invalid_fixture', 'user_people_sentinel',
         'relationship_fixture', 'grant_fixture', 1, ?, '[]', '[]', '[]',
         'invalid', 'Observed grant hash did not match.', ?, ?
       )`
    )
    .run("0".repeat(64), now, now);
  database
    .prepare(
      `INSERT INTO peer_query_audit (
         id, owner_user_id, relationship_id, projection_id, requester_class,
         requester_id, parameters_hash, decision, grant_id, grant_sequence,
         grant_verification_id, verified_grant_hash, authorization_evidence_json,
         result_count, duration_ms, created_at
       ) VALUES (
         'query_audit_fixture', 'user_people_sentinel', 'relationship_fixture',
         'person.profile.v1', 'peer_device', 'device_remote', ?, 'allowed',
         'grant_fixture', 1, 'verification_fixture', ?, ?, 1, 3, ?
       )`
    )
    .run(
      "b".repeat(64),
      exactGrantHash,
      JSON.stringify({
        requestingDeviceId: "device_remote",
        approvedRelationshipDeviceIds: ["device_remote"]
      }),
      now
    );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO peer_query_audit (
             id, owner_user_id, relationship_id, projection_id, requester_class,
             requester_id, parameters_hash, decision, grant_id, grant_sequence,
             grant_verification_id, verified_grant_hash, result_count,
             duration_ms, created_at
           ) VALUES (
             'query_audit_invalid_fixture', 'user_people_sentinel',
             'relationship_fixture', 'person.profile.v1', 'peer_device',
             'device_remote', ?, 'allowed', 'grant_fixture', 1,
             'verification_invalid_fixture', ?, 0, 1, ?
           )`
        )
        .run("d".repeat(64), "0".repeat(64), now),
    /exact valid grant evidence/
  );

  const storedGrant = database
    .prepare(
      `SELECT canonical_grant_json, signatures_json, version_hash
       FROM peer_share_grants WHERE id = 'grant_fixture' AND sequence = 1`
    )
    .get() as {
    canonical_grant_json: string;
    signatures_json: string;
    version_hash: string;
  };
  const storedVerification = database
    .prepare(
      `SELECT verified_grant_hash, verified_signatures_json,
              verified_signer_device_ids_json,
              approved_relationship_device_ids_json
       FROM peer_grant_verifications WHERE id = 'verification_fixture'`
    )
    .get() as {
    verified_grant_hash: string;
    verified_signatures_json: string;
    verified_signer_device_ids_json: string;
    approved_relationship_device_ids_json: string;
  };
  const storedSignatureRows = database
    .prepare(
      `SELECT signer_device_id, party, signed_grant_hash
       FROM peer_grant_signatures
       WHERE grant_id = 'grant_fixture' AND grant_sequence = 1
       ORDER BY signed_at`
    )
    .all() as Array<{
    signer_device_id: string;
    party: string;
    signed_grant_hash: string;
  }>;
  const storedAudit = database
    .prepare(
      `SELECT grant_verification_id, verified_grant_hash, authorization_evidence_json
       FROM peer_query_audit WHERE id = 'query_audit_fixture'`
    )
    .get() as {
    grant_verification_id: string;
    verified_grant_hash: string;
    authorization_evidence_json: string;
  };
  assert.deepEqual(
    (
      JSON.parse(storedGrant.canonical_grant_json) as typeof canonicalGrant
    ).signatures.map((signature) => signature.party),
    ["grantor", "grantee"]
  );
  assert.deepEqual(
    (JSON.parse(storedGrant.signatures_json) as typeof signatures).map(
      (signature) => [signature.deviceId, signature.party]
    ),
    [
      ["device_owner", "grantor"],
      ["device_remote", "grantee"]
    ]
  );
  assert.equal(storedGrant.version_hash, exactGrantHash);
  assert.deepEqual(
    storedSignatureRows.map((row) => ({ ...row })),
    [
      {
        signer_device_id: "device_owner",
        party: "grantor",
        signed_grant_hash: exactGrantHash
      },
      {
        signer_device_id: "device_remote",
        party: "grantee",
        signed_grant_hash: exactGrantHash
      }
    ]
  );
  assert.equal(storedVerification.verified_grant_hash, exactGrantHash);
  assert.deepEqual(
    (
      JSON.parse(
        storedVerification.verified_signatures_json
      ) as typeof signatures
    ).map((signature) => signature.party),
    ["grantor", "grantee"]
  );
  assert.deepEqual(
    JSON.parse(storedVerification.verified_signer_device_ids_json),
    ["device_owner", "device_remote"]
  );
  assert.deepEqual(
    JSON.parse(storedVerification.approved_relationship_device_ids_json),
    ["device_remote"]
  );
  assert.equal(storedAudit.grant_verification_id, "verification_fixture");
  assert.equal(storedAudit.verified_grant_hash, exactGrantHash);
  assert.deepEqual(JSON.parse(storedAudit.authorization_evidence_json), {
    requestingDeviceId: "device_remote",
    approvedRelationshipDeviceIds: ["device_remote"]
  });
}

function assertHumanPresenceStorageRoundTrip(now: string): void {
  const database = getDatabase();
  const credentialId = Buffer.from("credential-id-fixture-bytes").toString(
    "base64url"
  );
  const publicKeyBase64 = Buffer.alloc(64, 7).toString("base64");
  const sessionBindingHash = "c".repeat(64);
  const challengeHash = "d".repeat(64);
  const capabilityHash = "e".repeat(64);
  const actionDigest = "f".repeat(64);
  const expiresAt = "2026-07-15T08:10:00.000Z";

  database
    .prepare(
      `INSERT INTO forge_webauthn_credentials (
         id, owner_user_id, rp_id, credential_id, public_key_base64,
         counter, transports_json, label, device_type, backed_up, aaguid,
         status, created_at, updated_at
       ) VALUES (
         'credential_fixture', 'user_people_sentinel', 'forge.example.test', ?, ?,
         12, ?, 'Security key', 'multiDevice', 1,
         '12345678-1234-1234-1234-123456789abc', 'active', ?, ?
       )`
    )
    .run(
      credentialId,
      publicKeyBase64,
      JSON.stringify(["usb", "internal"]),
      now,
      now
    );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO forge_webauthn_credentials (
             id, owner_user_id, rp_id, credential_id, public_key_base64,
             counter, transports_json, label, status, created_at, updated_at
           ) VALUES (
             'credential_duplicate', 'user_people_sentinel', 'forge.example.test', ?, ?,
             0, '[]', '', 'active', ?, ?
           )`
        )
        .run(credentialId, publicKeyBase64, now, now),
    /UNIQUE constraint failed/
  );
  database
    .prepare(
      `INSERT INTO forge_webauthn_credentials (
         id, owner_user_id, rp_id, credential_id, public_key_base64,
         counter, transports_json, label, status, created_at, updated_at
       ) VALUES (
         'credential_second', 'user_people_sentinel', 'forge.example.test', ?, ?,
         0, '[]', 'Second credential', 'active', ?, ?
       )`
    )
    .run(
      Buffer.from("second-credential-id-fixture").toString("base64url"),
      Buffer.alloc(64, 6).toString("base64"),
      now,
      now
    );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_webauthn_credentials
           SET public_key_base64 = ? WHERE id = 'credential_fixture'`
        )
        .run(Buffer.alloc(64, 8).toString("base64")),
    /identity is immutable/
  );

  const insertChallenge = database.prepare(
    `INSERT INTO forge_human_presence_challenges (
       id, owner_user_id, principal_class, principal_id, principal_origin,
       ceremony, status, session_binding_keyed_hash, rp_id, expected_origin,
       challenge_keyed_hash, action_digest, credential_set_version,
       credential_label, expires_at, issued_at, updated_at
     ) VALUES (
       ?, 'user_people_sentinel', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )`
  );
  insertChallenge.run(
    "presence_challenge_fixture",
    "operator_session",
    "session_owner",
    "https://forge.example.test",
    "authenticate",
    sessionBindingHash,
    "forge.example.test",
    "https://forge.example.test",
    challengeHash,
    actionDigest,
    "3".repeat(64),
    null,
    expiresAt,
    now,
    now
  );
  insertChallenge.run(
    "registration_challenge_fixture",
    "operator_session",
    "session_owner",
    "https://forge.example.test",
    "register",
    "1".repeat(64),
    "forge.example.test",
    "https://forge.example.test",
    "2".repeat(64),
    null,
    "4".repeat(64),
    "Platform authenticator",
    expiresAt,
    now,
    now
  );
  assert.throws(
    () =>
      insertChallenge.run(
        "presence_challenge_duplicate",
        "companion_consent",
        "companion_device_owner",
        null,
        "companion",
        sessionBindingHash,
        "forge-companion",
        "forge-companion://device-owner",
        challengeHash,
        actionDigest,
        null,
        null,
        expiresAt,
        now,
        now
      ),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_human_presence_challenges
           SET action_digest = ? WHERE id = 'registration_challenge_fixture'`
        )
        .run(actionDigest),
    /binding is immutable/
  );
  database
    .prepare(
      `UPDATE forge_human_presence_challenges
       SET status = 'consumed', verified_credential_id = 'credential_fixture',
           consumed_at = ?, updated_at = ?
       WHERE id = 'presence_challenge_fixture' AND status = 'pending'`
    )
    .run(now, now);

  const insertCapability = database.prepare(
    `INSERT INTO forge_human_presence_capabilities (
       id, owner_user_id, challenge_id, principal_class, principal_id,
       principal_origin, status, session_binding_keyed_hash,
       capability_keyed_hash, action_digest, issued_at, expires_at
     ) VALUES (
       ?, 'user_people_sentinel', 'presence_challenge_fixture',
       ?, ?, ?, 'active', ?, ?, ?, ?, ?
     )`
  );
  insertCapability.run(
    "presence_capability_fixture",
    "operator_session",
    "session_owner",
    "https://forge.example.test",
    sessionBindingHash,
    capabilityHash,
    actionDigest,
    now,
    expiresAt
  );
  assert.throws(
    () =>
      insertCapability.run(
        "presence_capability_duplicate",
        "operator_session",
        "session_owner",
        "https://forge.example.test",
        sessionBindingHash,
        capabilityHash,
        actionDigest,
        now,
        expiresAt
      ),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () =>
      insertCapability.run(
        "presence_capability_wrong_principal",
        "companion_consent",
        "companion_device_owner",
        null,
        sessionBindingHash,
        "9".repeat(64),
        actionDigest,
        now,
        expiresAt
      ),
    /exact consumed challenge/
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_human_presence_capabilities
           SET action_digest = ? WHERE id = 'presence_capability_fixture'`
        )
        .run("0".repeat(64)),
    /binding is immutable/
  );

  const evidence = {
    ceremony: "authenticate",
    credentialId: "credential_fixture",
    actionDigest
  };
  database
    .prepare(
      `INSERT INTO forge_human_presence_audit_events (
         id, owner_user_id, event_type, outcome, session_binding_keyed_hash,
         principal_class, principal_id, principal_origin, credential_id,
         challenge_id, capability_id, action_digest, evidence_json, created_at
       ) VALUES (
         'presence_audit_fixture', 'user_people_sentinel', 'capability_issued',
         'allowed', ?, 'operator_session', 'session_owner',
         'https://forge.example.test', 'credential_fixture',
         'presence_challenge_fixture', 'presence_capability_fixture', ?, ?, ?
       )`
    )
    .run(sessionBindingHash, actionDigest, JSON.stringify(evidence), now);

  const storedCredential = database
    .prepare(
      `SELECT credential_id, public_key_base64, counter, transports_json,
              device_type, backed_up, aaguid
       FROM forge_webauthn_credentials WHERE id = 'credential_fixture'`
    )
    .get() as {
    credential_id: string;
    public_key_base64: string;
    counter: number;
    transports_json: string;
    device_type: string;
    backed_up: number;
    aaguid: string;
  };
  const storedChallenge = database
    .prepare(
      `SELECT principal_class, principal_id, principal_origin, ceremony, status,
              session_binding_keyed_hash, challenge_keyed_hash, action_digest,
              credential_set_version, verified_credential_id
       FROM forge_human_presence_challenges
       WHERE id = 'presence_challenge_fixture'`
    )
    .get() as {
    principal_class: string;
    principal_id: string;
    principal_origin: string;
    ceremony: string;
    status: string;
    session_binding_keyed_hash: string;
    challenge_keyed_hash: string;
    action_digest: string;
    credential_set_version: string;
    verified_credential_id: string;
  };
  const storedCapability = database
    .prepare(
      `SELECT principal_class, principal_id, principal_origin, status,
              session_binding_keyed_hash, capability_keyed_hash, action_digest
       FROM forge_human_presence_capabilities
       WHERE id = 'presence_capability_fixture'`
    )
    .get() as {
    principal_class: string;
    principal_id: string;
    principal_origin: string;
    status: string;
    session_binding_keyed_hash: string;
    capability_keyed_hash: string;
    action_digest: string;
  };
  assert.equal(storedCredential.credential_id, credentialId);
  assert.equal(storedCredential.public_key_base64, publicKeyBase64);
  assert.equal(storedCredential.counter, 12);
  assert.deepEqual(JSON.parse(storedCredential.transports_json), [
    "usb",
    "internal"
  ]);
  assert.equal(storedCredential.device_type, "multiDevice");
  assert.equal(storedCredential.backed_up, 1);
  assert.equal(storedCredential.aaguid, "12345678-1234-1234-1234-123456789abc");
  assert.deepEqual(
    { ...storedChallenge },
    {
      principal_class: "operator_session",
      principal_id: "session_owner",
      principal_origin: "https://forge.example.test",
      ceremony: "authenticate",
      status: "consumed",
      session_binding_keyed_hash: sessionBindingHash,
      challenge_keyed_hash: challengeHash,
      action_digest: actionDigest,
      credential_set_version: "3".repeat(64),
      verified_credential_id: "credential_fixture"
    }
  );
  assert.deepEqual(
    { ...storedCapability },
    {
      principal_class: "operator_session",
      principal_id: "session_owner",
      principal_origin: "https://forge.example.test",
      status: "active",
      session_binding_keyed_hash: sessionBindingHash,
      capability_keyed_hash: capabilityHash,
      action_digest: actionDigest
    }
  );

  database
    .prepare(
      `UPDATE forge_human_presence_capabilities
       SET status = 'consumed', consumed_at = ?
       WHERE id = 'presence_capability_fixture' AND status = 'active'`
    )
    .run(now);
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_human_presence_challenges
           SET status = 'pending', consumed_at = NULL
           WHERE id = 'presence_challenge_fixture'`
        )
        .run(),
    /already terminal/
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_human_presence_capabilities
           SET status = 'active', consumed_at = NULL
           WHERE id = 'presence_capability_fixture'`
        )
        .run(),
    /already terminal/
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_human_presence_audit_events
           SET outcome = 'recorded' WHERE id = 'presence_audit_fixture'`
        )
        .run(),
    /append-only/
  );
  assert.throws(
    () =>
      database
        .prepare(
          "DELETE FROM forge_human_presence_audit_events WHERE id = 'presence_audit_fixture'"
        )
        .run(),
    /append-only/
  );
  database
    .prepare(
      `UPDATE forge_webauthn_credentials
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = 'credential_fixture' AND status = 'active'`
    )
    .run(now, now);
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE forge_webauthn_credentials
           SET status = 'active', revoked_at = NULL, updated_at = ?
           WHERE id = 'credential_fixture'`
        )
        .run(now),
    /already revoked/
  );
  assert.deepEqual(
    JSON.parse(
      (
        database
          .prepare(
            `SELECT evidence_json FROM forge_human_presence_audit_events
             WHERE id = 'presence_audit_fixture'`
          )
          .get() as { evidence_json: string }
      ).evidence_json
    ),
    evidence
  );
}

test("migration 087 is additive, upgrades current data without loss, and replays idempotently", async () => {
  const migrationSql = await readFile(
    path.join(migrationsDir, migrationName),
    "utf8"
  );
  assert.doesNotMatch(
    migrationSql,
    /^\s*(?:ALTER|DROP|TRUNCATE|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/im
  );

  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-people-migration-")
  );
  const databasePath = path.join(rootDir, "forge.sqlite");
  try {
    await applyMigrationsBefore087(databasePath);
    const legacyDatabase = new DatabaseSync(databasePath);
    const now = "2026-07-15T07:30:00.000Z";
    legacyDatabase
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (
           'user_people_sentinel', 'human', 'people_sentinel', 'People Sentinel',
           'Must survive migration 087 unchanged.', '#123456', ?, ?
         )`
      )
      .run(now, now);
    const sentinelBefore = legacyDatabase
      .prepare(
        `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
         FROM users WHERE id = 'user_people_sentinel'`
      )
      .get();
    const usersBefore = (
      legacyDatabase.prepare("SELECT COUNT(*) AS count FROM users").get() as {
        count: number;
      }
    ).count;
    const sentinelHashBefore = sha256(sentinelBefore);
    legacyDatabase.close();

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    configureLegacyWikiAutoImport(false);
    await initializeDatabase();

    const sentinelAfter = getDatabase()
      .prepare(
        `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
         FROM users WHERE id = 'user_people_sentinel'`
      )
      .get();
    const usersAfter = (
      getDatabase().prepare("SELECT COUNT(*) AS count FROM users").get() as {
        count: number;
      }
    ).count;
    assert.equal(sha256(sentinelAfter), sentinelHashBefore);
    assert.equal(usersAfter, usersBefore);
    assert.ok(
      getDatabase()
        .prepare("SELECT id FROM migrations WHERE id = ?")
        .get(migrationName)
    );

    const expectedTables = [
      "people",
      "person_aliases",
      "person_contact_methods",
      "person_facts",
      "person_actor_bindings",
      "forge_principals",
      "forge_devices",
      "forge_webauthn_credentials",
      "forge_human_presence_challenges",
      "forge_human_presence_capabilities",
      "forge_human_presence_audit_events",
      "peer_pairing_invites",
      "peer_relationships",
      "peer_relationship_devices",
      "peer_share_grants",
      "peer_grant_signatures",
      "peer_share_rules",
      "peer_grant_verifications",
      "peer_projection_changes",
      "peer_outbox",
      "peer_inbox",
      "peer_delivery_receipts",
      "peer_command_journal",
      "peer_remote_records",
      "peer_query_audit",
      "peer_audit_events",
      "peer_idempotency_records",
      "people_wiki_association_previews",
      "peer_question_interpretations",
      "peer_mls_group_states",
      "peer_mls_state_checkpoints"
    ];
    const actualTables = new Set(
      (
        getDatabase()
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    );
    for (const table of expectedTables) {
      assert.equal(actualTables.has(table), true, `missing table ${table}`);
    }
    assertGrantVerificationEvidenceRoundTrip(now);
    assertHumanPresenceStorageRoundTrip(now);
    assert.deepEqual(
      getDatabase().prepare("PRAGMA foreign_key_check").all(),
      []
    );
    assert.deepEqual(
      (
        getDatabase().prepare("PRAGMA integrity_check").all() as Array<{
          integrity_check: string;
        }>
      ).map((row) => row.integrity_check),
      ["ok"]
    );

    const person = createPerson(
      {
        userId: "user_people_sentinel",
        displayName: "Replay Sentinel",
        aliases: [{ alias: "Replay", kind: "nickname" }],
        contacts: [
          { kind: "email", value: "replay@example.test", isPrimary: true }
        ],
        facts: [{ factType: "fixture", value: { preserved: true } }]
      },
      { id: "person_replay_sentinel", now: new Date(now) }
    );
    const personHashBefore = sha256(person);
    createWikiPersonAssociationPreviewRecord(
      {
        ownerUserId: "user_people_sentinel",
        previewHash: "a".repeat(64),
        decisionsJson: JSON.stringify([
          { action: "skip", candidateNoteId: "note_replay_sentinel" }
        ]),
        sourceVersionsJson: JSON.stringify({
          rootSlug: "people",
          actor: null,
          candidates: [],
          people: []
        }),
        expiresAt: "2026-07-16T07:30:00.000Z"
      },
      {
        id: "peoplewikipreview_replay_sentinel",
        now: new Date(now)
      }
    );
    createPeopleIdempotencyRecord({
      ownerUserId: "user_people_sentinel",
      operationId: "people.wiki-associations.apply",
      idempotencyKey: "migration-replay-key-0001",
      requestHash: "b".repeat(64),
      responseStatus: 200,
      responseJson: JSON.stringify({ preserved: true }),
      createdAt: now,
      expiresAt: "2999-07-16T07:30:00.000Z"
    });
    assert.throws(
      () =>
        getDatabase()
          .prepare(
            `DELETE FROM peer_idempotency_records
             WHERE owner_user_id = 'user_people_sentinel'
               AND operation_id = 'people.wiki-associations.apply'
               AND idempotency_key = 'migration-replay-key-0001'`
          )
          .run(),
      /unexpired peer idempotency response deletion is forbidden/
    );
    createPeopleIdempotencyRecord({
      ownerUserId: "user_people_sentinel",
      operationId: "people.wiki-associations.apply",
      idempotencyKey: "migration-expired-key-0001",
      requestHash: "c".repeat(64),
      responseStatus: 200,
      responseJson: JSON.stringify({ expired: true }),
      createdAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-02T00:00:00.000Z"
    });
    assert.equal(
      Number(
        getDatabase()
          .prepare(
            `DELETE FROM peer_idempotency_records
             WHERE owner_user_id = 'user_people_sentinel'
               AND operation_id = 'people.wiki-associations.apply'
               AND idempotency_key = 'migration-expired-key-0001'`
          )
          .run().changes
      ),
      1
    );
    const workflowRowsHashBefore = sha256({
      preview: getDatabase()
        .prepare(
          `SELECT id, owner_user_id, preview_hash, decisions_json,
                  source_versions_json, status, expires_at, consumed_at, created_at
           FROM people_wiki_association_previews
           WHERE id = 'peoplewikipreview_replay_sentinel'`
        )
        .get(),
      idempotency: getDatabase()
        .prepare(
          `SELECT owner_user_id, operation_id, idempotency_key, request_hash,
                  response_status, response_json, created_at, expires_at
           FROM peer_idempotency_records
           WHERE owner_user_id = 'user_people_sentinel'
             AND operation_id = 'people.wiki-associations.apply'
             AND idempotency_key = 'migration-replay-key-0001'`
        )
        .get()
    });
    const entityCountsBeforeReplay = {
      people: (
        getDatabase().prepare("SELECT COUNT(*) AS count FROM people").get() as {
          count: number;
        }
      ).count,
      aliases: (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM person_aliases")
          .get() as { count: number }
      ).count,
      contacts: (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM person_contact_methods")
          .get() as { count: number }
      ).count,
      facts: (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM person_facts")
          .get() as {
          count: number;
        }
      ).count,
      previews: (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM people_wiki_association_previews"
          )
          .get() as { count: number }
      ).count,
      idempotencyRecords: (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM peer_idempotency_records")
          .get() as { count: number }
      ).count
    };
    getDatabase()
      .prepare("DELETE FROM migrations WHERE id = ?")
      .run(migrationName);
    await initializeDatabase();

    assert.equal(
      sha256(getPersonById(person.id, "user_people_sentinel")),
      personHashBefore
    );
    assert.deepEqual(
      {
        people: (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM people")
            .get() as {
            count: number;
          }
        ).count,
        aliases: (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM person_aliases")
            .get() as { count: number }
        ).count,
        contacts: (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM person_contact_methods")
            .get() as { count: number }
        ).count,
        facts: (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM person_facts")
            .get() as { count: number }
        ).count,
        previews: (
          getDatabase()
            .prepare(
              "SELECT COUNT(*) AS count FROM people_wiki_association_previews"
            )
            .get() as { count: number }
        ).count,
        idempotencyRecords: (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM peer_idempotency_records")
            .get() as { count: number }
        ).count
      },
      entityCountsBeforeReplay
    );
    assert.equal(
      sha256({
        preview: getDatabase()
          .prepare(
            `SELECT id, owner_user_id, preview_hash, decisions_json,
                    source_versions_json, status, expires_at, consumed_at, created_at
             FROM people_wiki_association_previews
             WHERE id = 'peoplewikipreview_replay_sentinel'`
          )
          .get(),
        idempotency: getDatabase()
          .prepare(
            `SELECT owner_user_id, operation_id, idempotency_key, request_hash,
                    response_status, response_json, created_at, expires_at
             FROM peer_idempotency_records
             WHERE owner_user_id = 'user_people_sentinel'
               AND operation_id = 'people.wiki-associations.apply'
               AND idempotency_key = 'migration-replay-key-0001'`
          )
          .get()
      }),
      workflowRowsHashBefore
    );
    assert.equal(
      sha256(
        getDatabase()
          .prepare(
            `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
             FROM users WHERE id = 'user_people_sentinel'`
          )
          .get()
      ),
      sentinelHashBefore
    );
    assert.deepEqual(
      getDatabase().prepare("PRAGMA foreign_key_check").all(),
      []
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
