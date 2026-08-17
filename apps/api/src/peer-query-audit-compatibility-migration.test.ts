import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { prepareLegacyPeerQueryAuditMigration } from "./db.js";

test("migration 134a repairs a published legacy peer query audit schema before later ALTER TABLE migrations", async () => {
  const database = new DatabaseSync(":memory:");
  const now = "2026-08-17T20:00:00.000Z";
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE people (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (id, user_id)
      );
      CREATE TABLE peer_relationships (
        id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        PRIMARY KEY (id, owner_user_id)
      );
      CREATE TABLE peer_share_grants (
        id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL,
        PRIMARY KEY (id, sequence, owner_user_id)
      );
      CREATE TABLE peer_grant_verifications (
        id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        grant_sequence INTEGER NOT NULL,
        verified_grant_hash TEXT NOT NULL,
        verification_result TEXT NOT NULL,
        PRIMARY KEY (id, owner_user_id)
      );

      CREATE TABLE peer_query_audit (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        person_id TEXT,
        relationship_id TEXT NOT NULL,
        projection_id TEXT NOT NULL,
        requester_class TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        parameters_hash TEXT NOT NULL,
        decision TEXT NOT NULL,
        decision_reason TEXT NOT NULL DEFAULT '',
        grant_id TEXT,
        grant_sequence INTEGER,
        result_count INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      INSERT INTO users (id) VALUES ('owner_a');
      INSERT INTO people (id, user_id) VALUES ('person_a', 'owner_a');
      INSERT INTO peer_relationships (id, owner_user_id)
        VALUES ('relationship_a', 'owner_a');
      INSERT INTO peer_query_audit (
        id, owner_user_id, person_id, relationship_id, projection_id,
        requester_class, requester_id, parameters_hash, decision,
        decision_reason, result_count, duration_ms, created_at
      ) VALUES (
        'legacy_denied', 'owner_a', 'person_a', 'relationship_a',
        'person.profile.v1', 'operator_session', 'session_a',
        '${"a".repeat(64)}', 'denied', 'No grant.', 0, 4, '${now}'
      );
    `);

    database.exec("BEGIN");
    prepareLegacyPeerQueryAuditMigration(database);
    const migration = await readFile(
      new URL(
        "../migrations/134a_peer_query_audit_compatibility.sql",
        import.meta.url
      ),
      "utf8"
    );
    database.exec(migration);
    database.exec("COMMIT");

    const columns = new Set(
      (
        database.prepare("PRAGMA table_info(peer_query_audit)").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name)
    );
    assert.equal(columns.has("grant_verification_id"), true);
    assert.equal(columns.has("verified_grant_hash"), true);
    assert.equal(columns.has("authorization_evidence_json"), true);

    const legacyRow = database
      .prepare(
        `SELECT decision, decision_reason AS decisionReason,
                authorization_evidence_json AS evidence
         FROM peer_query_audit WHERE id = 'legacy_denied'`
      )
      .get() as {
      decision: string;
      decisionReason: string;
      evidence: string;
    };
    assert.equal(legacyRow.decision, "denied");
    assert.equal(legacyRow.decisionReason, "No grant.");
    assert.equal(legacyRow.evidence, "{}");

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO peer_query_audit (
            id, owner_user_id, relationship_id, projection_id,
            requester_class, requester_id, parameters_hash, decision,
            result_count, duration_ms, created_at
          ) VALUES (
            'invalid_allowed', 'owner_a', 'relationship_a',
            'person.profile.v1', 'operator_session', 'session_a',
            '${"b".repeat(64)}', 'allowed', 1, 3, '${now}'
          );
        `),
      /exact valid grant evidence/u
    );

    const grantHash = "c".repeat(64);
    database.exec(`
      INSERT INTO peer_share_grants (id, sequence, owner_user_id)
        VALUES ('grant_a', 1, 'owner_a');
      INSERT INTO peer_grant_verifications (
        id, owner_user_id, relationship_id, grant_id, grant_sequence,
        verified_grant_hash, verification_result
      ) VALUES (
        'verification_a', 'owner_a', 'relationship_a', 'grant_a', 1,
        '${grantHash}', 'valid'
      );
      INSERT INTO peer_query_audit (
        id, owner_user_id, relationship_id, projection_id,
        requester_class, requester_id, parameters_hash, decision,
        grant_id, grant_sequence, grant_verification_id,
        verified_grant_hash, authorization_evidence_json,
        result_count, duration_ms, created_at
      ) VALUES (
        'valid_allowed', 'owner_a', 'relationship_a',
        'person.profile.v1', 'operator_session', 'session_a',
        '${"d".repeat(64)}', 'allowed', 'grant_a', 1,
        'verification_a', '${grantHash}', '{"source":"test"}', 1, 2,
        '${now}'
      );
    `);
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM peer_query_audit WHERE id = 'valid_allowed'"
          )
          .get() as { count: number }
      ).count,
      1
    );

    database.exec(`
      CREATE TABLE mutation_receipts (id TEXT PRIMARY KEY);
      ALTER TABLE mutation_receipts RENAME TO mutation_receipts_after_compatibility;
    `);
  } finally {
    database.close();
  }
});
