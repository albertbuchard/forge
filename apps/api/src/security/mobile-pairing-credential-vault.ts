import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SecretsManager } from "../managers/platform/secrets-manager.js";

const MARKER_PREFIX = "secured-mobile-v1:";

type PairingCredentialRow = {
  pairing_session_id: string;
  token_digest: string;
  token_ciphertext: string;
  revoked_at: string | null;
};

export class MobilePairingCredentialVault {
  private readonly digestKey: Uint8Array;

  constructor(
    private readonly database: DatabaseSync,
    private readonly secrets: SecretsManager
  ) {
    this.digestKey = secrets.deriveKey("mobile-pairing-credential-digest/v1");
  }

  private digest(token: string) {
    return createHmac("sha256", this.digestKey)
      .update("forge-mobile-pairing-token/v1\0", "utf8")
      .update(token, "utf8")
      .digest("hex");
  }

  private marker(digest: string) {
    return `${MARKER_PREFIX}${digest}`;
  }

  private writeProtectedCredential(sessionId: string, plaintextToken: string) {
    if (plaintextToken.startsWith(MARKER_PREFIX)) {
      return plaintextToken;
    }
    const digest = this.digest(plaintextToken);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO security_mobile_pairing_credentials (
           pairing_session_id, token_digest, token_ciphertext, created_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        sessionId,
        digest,
        this.secrets.sealJson({ token: plaintextToken }),
        now
      );
    const updated = this.database
      .prepare(
        `UPDATE companion_pairing_sessions
         SET pairing_token = ?
         WHERE id = ? AND pairing_token = ?`
      )
      .run(this.marker(digest), sessionId, plaintextToken);
    if (updated.changes !== 1) {
      throw new Error(
        "Forge could not atomically bind the protected mobile credential."
      );
    }
    return this.marker(digest);
  }

  protect(sessionId: string, plaintextToken: string) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const marker = this.writeProtectedCredential(sessionId, plaintextToken);
      this.database.exec("COMMIT");
      return marker;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  protectInCurrentTransaction(sessionId: string, plaintextToken: string) {
    return this.writeProtectedCredential(sessionId, plaintextToken);
  }

  readPlaintext(sessionId: string, marker: string) {
    if (!marker.startsWith(MARKER_PREFIX)) {
      return marker;
    }
    const row = this.database
      .prepare(
        `SELECT pairing_session_id, token_digest, token_ciphertext, revoked_at
         FROM security_mobile_pairing_credentials
         WHERE pairing_session_id = ? LIMIT 1`
      )
      .get(sessionId) as PairingCredentialRow | undefined;
    if (
      !row ||
      row.revoked_at ||
      !this.secrets.secureEquals(marker, this.marker(row.token_digest))
    ) {
      return null;
    }
    const opened = this.secrets.openJson<{ token: string }>(
      row.token_ciphertext
    );
    if (
      typeof opened.token !== "string" ||
      !this.secrets.secureEquals(this.digest(opened.token), row.token_digest)
    ) {
      return null;
    }
    return opened.token;
  }
}

export const securedMobilePairingMarkerPrefix = MARKER_PREFIX;

export function isSecuredMobilePairingMarker(value: string) {
  return value.startsWith(MARKER_PREFIX);
}
