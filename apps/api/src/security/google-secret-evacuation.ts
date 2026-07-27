import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SecretsManager } from "../managers/platform/secrets-manager.js";

export type GoogleSecretEvacuationAuthorizationRequest = {
  ownerId: string;
  installationId: string;
  localControlAssertionId: string;
  exclusiveDatabaseWindowId: string;
  backupReceiptId: string;
  backupReceiptSha256: string;
};

export type GoogleSecretEvacuationVerification = {
  authorized: true;
  ownerId: string;
  installationId: string;
  localControlAssertionId: string;
  exclusiveDatabaseWindowId: string;
  backupReceiptId: string;
  backupReceiptSha256: string;
  verifiedAt: string;
  expiresAt: string;
};

export type GoogleSecretEvacuationAuthorizationVerifier = {
  verify(
    request: GoogleSecretEvacuationAuthorizationRequest
  ):
    | Promise<GoogleSecretEvacuationVerification | null>
    | GoogleSecretEvacuationVerification
    | null;
};

export type VerifiedGoogleSecretEvacuationAuthorization = Readonly<{
  ownerId: string;
  installationId: string;
  exclusiveDatabaseWindowId: string;
  backupReceiptId: string;
  backupReceiptSha256: string;
  expiresAt: string;
}>;

export type GoogleSecretEvacuationReceipt = {
  status: "evacuated" | "already_encrypted" | "no_legacy_secret";
  secretId: string | null;
  ownerId: string;
  installationId: string;
  evacuatedAt: string;
  backupReceiptId: string;
  backupReceiptSha256: string;
  legacyPlaintextRemoved: boolean;
  rotationRequired: boolean;
};

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/u.test(value);
}

function requireBoundVerification(
  request: GoogleSecretEvacuationAuthorizationRequest,
  verification: GoogleSecretEvacuationVerification | null,
  now: Date
) {
  if (!verification?.authorized) {
    throw new Error("Google secret evacuation authorization was denied.");
  }
  for (const field of [
    "ownerId",
    "installationId",
    "localControlAssertionId",
    "exclusiveDatabaseWindowId",
    "backupReceiptId",
    "backupReceiptSha256"
  ] as const) {
    if (!request[field].trim() || request[field] !== verification[field]) {
      throw new Error(
        "Google secret evacuation verification is not bound to the request."
      );
    }
  }
  if (!isSha256(verification.backupReceiptSha256)) {
    throw new Error(
      "Google secret evacuation requires a verified backup receipt."
    );
  }
  const verifiedAt = Date.parse(verification.verifiedAt);
  const expiresAt = Date.parse(verification.expiresAt);
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(expiresAt) ||
    verifiedAt > now.getTime() + 30_000 ||
    expiresAt <= now.getTime() ||
    expiresAt - verifiedAt > 5 * 60_000
  ) {
    throw new Error(
      "Google secret evacuation verification is expired or invalid."
    );
  }
}

export function createGoogleSecretEvacuationService(input: {
  database: DatabaseSync;
  secrets: SecretsManager;
  verifier: GoogleSecretEvacuationAuthorizationVerifier;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const verifiedAuthorizations =
    new WeakSet<VerifiedGoogleSecretEvacuationAuthorization>();

  return Object.freeze({
    async authorize(
      request: GoogleSecretEvacuationAuthorizationRequest
    ): Promise<VerifiedGoogleSecretEvacuationAuthorization> {
      const verification = await input.verifier.verify(request);
      requireBoundVerification(request, verification, now());
      const authorization = Object.freeze({
        ownerId: verification!.ownerId,
        installationId: verification!.installationId,
        exclusiveDatabaseWindowId: verification!.exclusiveDatabaseWindowId,
        backupReceiptId: verification!.backupReceiptId,
        backupReceiptSha256: verification!.backupReceiptSha256,
        expiresAt: verification!.expiresAt
      });
      verifiedAuthorizations.add(authorization);
      return authorization;
    },

    evacuate(
      authorization: VerifiedGoogleSecretEvacuationAuthorization
    ): GoogleSecretEvacuationReceipt {
      if (
        !verifiedAuthorizations.has(authorization) ||
        Date.parse(authorization.expiresAt) <= now().getTime()
      ) {
        throw new Error(
          "Google secret evacuation requires a current verifier-issued authorization."
        );
      }
      verifiedAuthorizations.delete(authorization);
      const evacuatedAt = now().toISOString();
      input.database.exec("BEGIN IMMEDIATE");
      try {
        const row = input.database
          .prepare(
            `SELECT google_client_secret, google_client_secret_id
             FROM app_settings
             WHERE id = 1`
          )
          .get() as
          | {
              google_client_secret: string;
              google_client_secret_id: string | null;
            }
          | undefined;
        if (!row) {
          throw new Error("Forge settings row is missing.");
        }
        if (!row.google_client_secret) {
          input.database.exec("COMMIT");
          return {
            status: row.google_client_secret_id
              ? "already_encrypted"
              : "no_legacy_secret",
            secretId: row.google_client_secret_id,
            ownerId: authorization.ownerId,
            installationId: authorization.installationId,
            evacuatedAt,
            backupReceiptId: authorization.backupReceiptId,
            backupReceiptSha256: authorization.backupReceiptSha256,
            legacyPlaintextRemoved: true,
            rotationRequired: Boolean(row.google_client_secret_id)
          };
        }
        if (row.google_client_secret_id) {
          throw new Error(
            "Google secret evacuation refused conflicting legacy and encrypted values."
          );
        }

        const secretId = `google_oauth_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
        const cipherText = input.secrets.sealJson({
          kind: "google_oauth_client_secret",
          clientSecret: row.google_client_secret,
          ownerId: authorization.ownerId,
          installationId: authorization.installationId
        });
        input.database
          .prepare(
            `INSERT INTO stored_secrets (
               id, cipher_text, description, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            secretId,
            cipherText,
            "Evacuated legacy Google OAuth client secret",
            evacuatedAt,
            evacuatedAt
          );
        const updated = input.database
          .prepare(
            `UPDATE app_settings
             SET google_client_secret = '',
                 google_client_secret_id = ?,
                 updated_at = ?
             WHERE id = 1
               AND google_client_secret = ?
               AND google_client_secret_id IS NULL`
          )
          .run(secretId, evacuatedAt, row.google_client_secret);
        if (updated.changes !== 1) {
          throw new Error(
            "Google secret evacuation lost its exclusive database state."
          );
        }
        input.database.exec("COMMIT");
        return {
          status: "evacuated",
          secretId,
          ownerId: authorization.ownerId,
          installationId: authorization.installationId,
          evacuatedAt,
          backupReceiptId: authorization.backupReceiptId,
          backupReceiptSha256: authorization.backupReceiptSha256,
          legacyPlaintextRemoved: true,
          rotationRequired: true
        };
      } catch (error) {
        input.database.exec("ROLLBACK");
        throw error;
      }
    }
  });
}
