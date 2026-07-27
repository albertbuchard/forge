import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  createGoogleSecretEvacuationService,
  type GoogleSecretEvacuationAuthorizationRequest,
  type GoogleSecretEvacuationVerification
} from "./google-secret-evacuation.js";

async function fixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-secret-evacuation-")
  );
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE stored_secrets (
      id TEXT PRIMARY KEY,
      cipher_text TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY,
      google_client_secret TEXT NOT NULL DEFAULT '',
      google_client_secret_id TEXT REFERENCES stored_secrets(id),
      updated_at TEXT NOT NULL
    );
  `);
  const secrets = new SecretsManager();
  secrets.configure(root);
  return { root, database, secrets };
}

const authorizationRequest = {
  ownerId: "owner",
  installationId: "installation",
  localControlAssertionId: "local-control-assertion",
  exclusiveDatabaseWindowId: "exclusive-window",
  backupReceiptId: "backup-receipt",
  backupReceiptSha256: "a".repeat(64)
} as const;

test("explicit evacuation encrypts and removes a synthetic legacy secret atomically", async () => {
  const { root, database, secrets } = await fixture();
  const sentinel = "forge-synthetic-legacy-google-secret";
  try {
    database
      .prepare(
        `INSERT INTO app_settings (
           id, google_client_secret, google_client_secret_id, updated_at
         ) VALUES (1, ?, NULL, ?)`
      )
      .run(sentinel, "2026-07-26T00:00:00.000Z");

    const service = createGoogleSecretEvacuationService({
      database,
      secrets,
      verifier: {
        verify(request) {
          return {
            authorized: true,
            ...request,
            verifiedAt: "2026-07-26T21:59:00.000Z",
            expiresAt: "2026-07-26T22:04:00.000Z"
          };
        }
      },
      now: () => new Date("2026-07-26T22:00:00.000Z")
    });
    const authorization = await service.authorize(authorizationRequest);
    const receipt = service.evacuate(authorization);
    assert.equal(receipt.status, "evacuated");
    assert.equal(JSON.stringify(receipt).includes(sentinel), false);

    const row = database
      .prepare(
        `SELECT google_client_secret, google_client_secret_id
         FROM app_settings WHERE id = 1`
      )
      .get() as {
      google_client_secret: string;
      google_client_secret_id: string;
    };
    assert.equal(row.google_client_secret, "");
    assert.equal(row.google_client_secret_id, receipt.secretId);
    const encrypted = database
      .prepare(`SELECT cipher_text FROM stored_secrets WHERE id = ?`)
      .get(receipt.secretId) as { cipher_text: string };
    assert.equal(encrypted.cipher_text.includes(sentinel), false);
    assert.equal(
      secrets.openJson<{ clientSecret: string }>(encrypted.cipher_text)
        .clientSecret,
      sentinel
    );

    const repeatedAuthorization = await service.authorize(authorizationRequest);
    const repeated = service.evacuate(repeatedAuthorization);
    assert.equal(repeated.status, "already_encrypted");
    assert.throws(
      () => service.evacuate(repeatedAuthorization),
      /verifier-issued authorization/u
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("evacuation denial paths do not read, copy, or mutate the legacy value", async () => {
  const { root, database, secrets } = await fixture();
  const sentinel = "forge-synthetic-denied-google-secret";
  try {
    database
      .prepare(
        `INSERT INTO app_settings (
           id, google_client_secret, google_client_secret_id, updated_at
         ) VALUES (1, ?, NULL, ?)`
      )
      .run(sentinel, "2026-07-26T00:00:00.000Z");

    const service = createGoogleSecretEvacuationService({
      database,
      secrets,
      verifier: {
        verify() {
          return null;
        }
      }
    });
    await assert.rejects(
      service.authorize(authorizationRequest),
      /authorization was denied/u
    );
    assert.throws(
      () =>
        service.evacuate({
          ownerId: authorizationRequest.ownerId,
          installationId: authorizationRequest.installationId,
          exclusiveDatabaseWindowId:
            authorizationRequest.exclusiveDatabaseWindowId,
          backupReceiptId: authorizationRequest.backupReceiptId,
          backupReceiptSha256: authorizationRequest.backupReceiptSha256,
          expiresAt: "2099-01-01T00:00:00.000Z"
        }),
      /verifier-issued authorization/u
    );
    assert.equal(
      (
        database
          .prepare(`SELECT google_client_secret FROM app_settings WHERE id = 1`)
          .get() as { google_client_secret: string }
      ).google_client_secret,
      sentinel
    );
    assert.equal(
      (
        database
          .prepare(`SELECT count(*) AS count FROM stored_secrets`)
          .get() as { count: number }
      ).count,
      0
    );
    await assert.rejects(
      readFile(path.join(root, ".forge-secrets.key"), "utf8"),
      /ENOENT/u
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("authorization rejects forged owner, installation, and backup receipt bindings", async () => {
  const { root, database, secrets } = await fixture();
  try {
    for (const mismatch of [
      { ownerId: "forged-owner" },
      { installationId: "forged-installation" },
      { backupReceiptId: "forged-receipt" },
      { backupReceiptSha256: "b".repeat(64) }
    ]) {
      const service = createGoogleSecretEvacuationService({
        database,
        secrets,
        verifier: {
          verify(
            request: GoogleSecretEvacuationAuthorizationRequest
          ): GoogleSecretEvacuationVerification {
            return {
              authorized: true,
              ...request,
              ...mismatch,
              verifiedAt: new Date(Date.now() - 1_000).toISOString(),
              expiresAt: new Date(Date.now() + 60_000).toISOString()
            };
          }
        }
      });
      await assert.rejects(
        service.authorize(authorizationRequest),
        /not bound to the request/u
      );
    }
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("authorization issued by one evacuation service is rejected by another", async () => {
  const first = await fixture();
  const second = await fixture();
  const verifier = {
    verify(request: GoogleSecretEvacuationAuthorizationRequest) {
      return {
        authorized: true as const,
        ...request,
        verifiedAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    }
  };
  try {
    const firstService = createGoogleSecretEvacuationService({
      database: first.database,
      secrets: first.secrets,
      verifier
    });
    const secondService = createGoogleSecretEvacuationService({
      database: second.database,
      secrets: second.secrets,
      verifier
    });
    const authorization = await firstService.authorize(authorizationRequest);
    assert.throws(
      () => secondService.evacuate(authorization),
      /verifier-issued authorization/u
    );
  } finally {
    first.database.close();
    second.database.close();
    await rm(first.root, { recursive: true, force: true });
    await rm(second.root, { recursive: true, force: true });
  }
});
