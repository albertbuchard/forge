import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import Fastify from "fastify";

import { SecretsManager } from "../managers/platform/secrets-manager.js";
import { installAccessGateway } from "./access-gateway.js";
import {
  MOBILE_BACKGROUND_REQUEST_PROTOCOL,
  MOBILE_REQUEST_PROTOCOL,
  authenticateMobileCompanionRequest,
  canonicalMobileRequest
} from "./mobile-companion-request.js";
import {
  MobilePairingCredentialVault,
  isSecuredMobilePairingMarker
} from "./mobile-pairing-credential-vault.js";
import { SECURITY_CREDENTIAL_SCHEMA_SQL } from "./sqlite-security-store.js";

function signedHeaders(input: {
  method: string;
  path: string;
  sessionId: string;
  pairingToken: string;
  body: string;
  nonce?: string;
  protocol?:
    | typeof MOBILE_REQUEST_PROTOCOL
    | typeof MOBILE_BACKGROUND_REQUEST_PROTOCOL;
  issuedAt?: string;
  expiresAt?: string;
}) {
  const protocol = input.protocol ?? MOBILE_REQUEST_PROTOCOL;
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const nonce = input.nonce ?? randomBytes(16).toString("base64url");
  const bodySha256 = createHash("sha256")
    .update(input.body, "utf8")
    .digest("hex");
  const signature = createHmac("sha256", input.pairingToken)
    .update(
      canonicalMobileRequest({
        method: input.method,
        path: input.path,
        sessionId: input.sessionId,
        issuedAt,
        expiresAt: input.expiresAt,
        nonce,
        bodySha256,
        protocol
      })
    )
    .digest("hex");
  return {
    "content-type": "application/x-forge-mobile-test",
    "x-forge-mobile-request-protocol": protocol,
    "x-forge-mobile-session-id": input.sessionId,
    "x-forge-mobile-request-issued-at": issuedAt,
    "x-forge-mobile-request-nonce": nonce,
    "x-forge-mobile-body-sha256": bodySha256,
    "x-forge-mobile-request-signature": signature,
    ...(input.expiresAt
      ? { "x-forge-mobile-request-expires-at": input.expiresAt }
      : {})
  };
}

test("mobile proof authenticates before high-limit parsing, binds the body, redacts transport tokens, and rejects replay", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-request-security-")
  );
  await chmod(dataRoot, 0o700);
  const databasePath = path.join(dataRoot, "security.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 50;");
  const app = Fastify({ logger: false });
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE companion_pairing_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pairing_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
    `);
    database.exec(SECURITY_CREDENTIAL_SCHEMA_SQL);
    const sessionId = "pair_mobile_security_001";
    const pairingToken = "mobile-test-secret-001";
    const legacySessionId = "pair_mobile_legacy_002";
    const legacyPairingToken = "legacy-mobile-test-secret-002";
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    database
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, pairing_token, status, expires_at
         ) VALUES (?, 'user_operator', ?, 'paired', ?)`
      )
      .run(sessionId, pairingToken, expiresAt);
    database
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, pairing_token, status, expires_at
         ) VALUES (?, 'user_operator', ?, 'paired', ?)`
      )
      .run(legacySessionId, legacyPairingToken, expiresAt);
    const secrets = new SecretsManager();
    secrets.configure(dataRoot);
    const credentials = new MobilePairingCredentialVault(database, secrets);
    const untouchedLegacyCredential = database
      .prepare(
        "SELECT pairing_token FROM companion_pairing_sessions WHERE id = ?"
      )
      .get(legacySessionId) as { pairing_token: string };
    assert.equal(untouchedLegacyCredential.pairing_token, legacyPairingToken);
    const untouchedLegacyVaultRows = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM security_mobile_pairing_credentials
         WHERE pairing_session_id = ?`
      )
      .get(legacySessionId) as { count: number };
    assert.equal(untouchedLegacyVaultRows.count, 0);

    const interruptedSessionId = "pair_mobile_interrupted_003";
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, pairing_token, status, expires_at
         ) VALUES (?, 'user_operator', ?, 'pending', ?)`
      )
      .run(interruptedSessionId, "interrupted-secret-003", expiresAt);
    credentials.protectInCurrentTransaction(
      interruptedSessionId,
      "interrupted-secret-003"
    );
    database.exec("ROLLBACK");
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM companion_pairing_sessions
             WHERE id = ?`
          )
          .get(interruptedSessionId) as { count: number }
      ).count,
      0
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM security_mobile_pairing_credentials
             WHERE pairing_session_id = ?`
          )
          .get(interruptedSessionId) as { count: number }
      ).count,
      0
    );

    credentials.protect(sessionId, pairingToken);
    const storedCredential = database
      .prepare(
        "SELECT pairing_token FROM companion_pairing_sessions WHERE id = ?"
      )
      .get(sessionId) as { pairing_token: string };
    assert.notEqual(storedCredential.pairing_token, pairingToken);
    assert.equal(
      isSecuredMobilePairingMarker(storedCredential.pairing_token),
      true
    );
    const encryptedCredential = database
      .prepare(
        `SELECT token_ciphertext AS ciphertext
         FROM security_mobile_pairing_credentials
         WHERE pairing_session_id = ?`
      )
      .get(sessionId) as { ciphertext: string };
    assert.equal(encryptedCredential.ciphertext.includes(pairingToken), false);

    let parserEntries = 0;
    let handlerEntries = 0;
    let handlerBody: Record<string, unknown> = {};
    app.addContentTypeParser(
      "application/x-forge-mobile-test",
      { parseAs: "string" },
      (_request, body, done) => {
        parserEntries += 1;
        done(null, JSON.parse(body as string));
      }
    );
    installAccessGateway(app, {
      credentials: {
        authenticate: () => null,
        verifyProtocolEarly(request) {
          const verified = authenticateMobileCompanionRequest(request, {
            database,
            credentials
          });
          return verified
            ? {
                principal: {
                  ...verified,
                  clientId: verified.subjectId,
                  installationId: "install_mobile_test",
                  audience: "urn:forge:test:api",
                  profile: "custom",
                  ownerSecurityEpoch: 1,
                  clientSecurityEpoch: 1
                },
                mode: "verified_protocol",
                csrfSatisfied: false,
                verifyBody: verified.verifyBody
              }
            : null;
        }
      }
    });
    app.post(
      "/api/v1/mobile/healthkit/sync-sessions/:id/chunks",
      { bodyLimit: 40_000_000 },
      async (request) => {
        handlerEntries += 1;
        handlerBody = request.body as Record<string, unknown>;
        return { accepted: true };
      }
    );

    const path = "/api/v1/mobile/healthkit/sync-sessions/upload_1/chunks";
    const anonymousLarge = await app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/x-forge-mobile-test"
      },
      payload: JSON.stringify({ payload: "x".repeat(2_000_000) })
    });
    assert.equal(anonymousLarge.statusCode, 401);
    assert.equal(parserEntries, 0);
    assert.equal(handlerEntries, 0);

    const body = JSON.stringify({ value: "accepted-without-token" });
    const headers = signedHeaders({
      method: "POST",
      path,
      sessionId,
      pairingToken,
      body,
      nonce: "0123456789abcdef0123456789abcdef"
    });
    const accepted = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload: body
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(parserEntries, 1);
    assert.equal(handlerEntries, 1);
    assert.equal(handlerBody?.value, "accepted-without-token");
    assert.equal(handlerBody?.sessionId, sessionId);
    assert.equal(handlerBody?.pairingToken, pairingToken);
    assert.equal(accepted.body.includes(pairingToken), false);
    assert.equal(accepted.body.includes(storedCredential.pairing_token), false);

    const delayedBody = JSON.stringify({ value: "accepted-after-ios-delay" });
    const delayedIssuedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const delayedExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const delayedHeaders = signedHeaders({
      method: "POST",
      path,
      sessionId,
      pairingToken,
      body: delayedBody,
      protocol: MOBILE_BACKGROUND_REQUEST_PROTOCOL,
      issuedAt: delayedIssuedAt,
      expiresAt: delayedExpiresAt,
      nonce: "durable0123456789abcdef0123456789"
    });
    const delayedAccepted = await app.inject({
      method: "POST",
      url: path,
      headers: delayedHeaders,
      payload: delayedBody
    });
    assert.equal(delayedAccepted.statusCode, 200, delayedAccepted.body);
    assert.equal(parserEntries, 2);
    assert.equal(handlerEntries, 2);

    const delayedReplay = await app.inject({
      method: "POST",
      url: path,
      headers: delayedHeaders,
      payload: delayedBody
    });
    assert.equal(delayedReplay.statusCode, 409, delayedReplay.body);

    const expiredBody = JSON.stringify({ value: "expired" });
    const expired = await app.inject({
      method: "POST",
      url: path,
      headers: signedHeaders({
        method: "POST",
        path,
        sessionId,
        pairingToken,
        body: expiredBody,
        protocol: MOBILE_BACKGROUND_REQUEST_PROTOCOL,
        issuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        nonce: "expired0123456789abcdef012345678"
      }),
      payload: expiredBody
    });
    assert.equal(expired.statusCode, 401, expired.body);
    assert.equal((expired.json() as { code: string }).code, "mobile_request_expired");

    const busyBody = JSON.stringify({ value: "retry-after-lock" });
    const blocker = new DatabaseSync(databasePath);
    blocker.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
    try {
      const busy = await app.inject({
        method: "POST",
        url: path,
        headers: signedHeaders({
          method: "POST",
          path,
          sessionId,
          pairingToken,
          body: busyBody,
          nonce: "busylock0123456789abcdef012345678"
        }),
        payload: busyBody
      });
      assert.equal(busy.statusCode, 503, busy.body);
      assert.equal(
        (busy.json() as { code: string }).code,
        "mobile_request_auth_busy"
      );
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
    assert.equal(parserEntries, 2);
    assert.equal(handlerEntries, 2);

    const markerSignedBody = JSON.stringify({ value: "marker-is-not-a-key" });
    const markerSigned = await app.inject({
      method: "POST",
      url: path,
      headers: signedHeaders({
        method: "POST",
        path,
        sessionId,
        pairingToken: storedCredential.pairing_token,
        body: markerSignedBody,
        nonce: "fedcba9876543210fedcba9876543210"
      }),
      payload: markerSignedBody
    });
    assert.equal(markerSigned.statusCode, 401, markerSigned.body);
    assert.equal(parserEntries, 2);
    assert.equal(handlerEntries, 2);

    const replay = await app.inject({
      method: "POST",
      url: path,
      headers,
      payload: body
    });
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(parserEntries, 2);
    assert.equal(handlerEntries, 2);
  } finally {
    await app.close();
    database.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
