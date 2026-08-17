import assert from "node:assert/strict";
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes
} from "node:crypto";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import type { VerifiedBrowserSession } from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import {
  KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";
import { SqliteSecurityStore } from "./sqlite-security-store.js";
import { TrustedBrowserService } from "./trusted-browser-service.js";

type TestCbor =
  | number
  | string
  | Uint8Array
  | ReadonlyMap<number | string, TestCbor>;

function cborHeader(major: number, length: number) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 0xff) return Buffer.from([(major << 5) | 24, length]);
  if (length <= 0xffff) {
    const result = Buffer.alloc(3);
    result[0] = (major << 5) | 25;
    result.writeUInt16BE(length, 1);
    return result;
  }
  throw new Error("Test CBOR value exceeds its bounded encoder.");
}

function encodeTestCbor(value: TestCbor): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? cborHeader(0, value) : cborHeader(1, -1 - value);
  }
  if (typeof value === "string") {
    const encoded = Buffer.from(value, "utf8");
    return Buffer.concat([cborHeader(3, encoded.length), encoded]);
  }
  if (value instanceof Uint8Array) {
    const encoded = Buffer.from(value);
    return Buffer.concat([cborHeader(2, encoded.length), encoded]);
  }
  const entries = [...value.entries()];
  return Buffer.concat([
    cborHeader(5, entries.length),
    ...entries.flatMap(([key, entry]) => [
      encodeTestCbor(key),
      encodeTestCbor(entry)
    ])
  ]);
}

function registrationResponse(input: {
  challenge: string;
  origin: string;
  rpId: string;
}) {
  const credentialId = randomBytes(32);
  const keyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = keyPair.publicKey.export({ format: "jwk" });
  const cosePublicKey = encodeTestCbor(
    new Map<number, TestCbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(publicJwk.x!, "base64url")],
      [-3, Buffer.from(publicJwk.y!, "base64url")]
    ])
  );
  const credentialLength = Buffer.alloc(2);
  credentialLength.writeUInt16BE(credentialId.length);
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(input.rpId).digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    credentialLength,
    credentialId,
    cosePublicKey
  ]);
  const attestationObject = encodeTestCbor(
    new Map<string, TestCbor>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authenticatorData]
    ])
  );
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false
    })
  );
  const id = credentialId.toString("base64url");
  return {
    id,
    privateKey: keyPair.privateKey,
    response: {
      id,
      rawId: id,
      response: {
        clientDataJSON: clientData.toString("base64url"),
        attestationObject: attestationObject.toString("base64url"),
        transports: ["internal" as const]
      },
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
      type: "public-key" as const
    }
  };
}

function authenticationResponse(input: {
  challenge: string;
  origin: string;
  rpId: string;
  credentialId: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  counter: number;
}) {
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false
    })
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(input.counter);
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(input.rpId).digest(),
    Buffer.from([0x05]),
    counter
  ]);
  const signature = createSign("SHA256")
    .update(
      Buffer.concat([
        authenticatorData,
        createHash("sha256").update(clientData).digest()
      ])
    )
    .end()
    .sign(input.privateKey);
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url")
    },
    authenticatorAttachment: "platform" as const,
    clientExtensionResults: {},
    type: "public-key" as const
  };
}

class MutableClock implements SecurityClock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  advance(seconds: number) {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }
}

class TestSecrets implements OpaqueSecretSource {
  bytes(length: number) {
    return new Uint8Array(length).fill(29);
  }
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  const clock = new MutableClock(new Date("2026-08-18T08:00:00.000Z"));
  const opaque = new TestSecrets();
  const store = new SqliteSecurityStore(
    database,
    clock,
    opaque,
    new KeyedSecretDigester(new Uint8Array(32).fill(31))
  );
  store.initializeSchema();
  const ownerId = "owner_test";
  store.ensureOwner(ownerId);
  const installationId = store.ensureInstallation();
  const subjectId = "pair_1234567890123456";
  const clientId = "client_1234567890123456";
  const now = clock.now().toISOString();
  database.exec(`
    INSERT INTO security_pairing_requests (
      id, owner_id, owner_epoch, installation_id, client_name,
      client_key_thumbprint, audience, requested_scopes_json,
      requested_profile, device_digest, user_code_digest, status,
      poll_interval_seconds, next_poll_at, expires_at, approval_json,
      created_at, updated_at
    ) VALUES (
      '${subjectId}', '${ownerId}', 1, '${installationId}', 'Example iPhone',
      '${"k".repeat(43)}', 'https://forge.test/api', '["read","write"]',
      'trusted_personal_assistant', '${"d".repeat(64)}', '${"u".repeat(64)}',
      'consumed', 5, '${now}', '2026-08-19T08:00:00.000Z', NULL,
      '${now}', '${now}'
    );
    INSERT INTO security_pairing_client_metadata (pairing_request_id, client_type)
    VALUES ('${subjectId}', 'browser');
  `);
  store.registerClient({
    id: clientId,
    ownerId,
    subjectId,
    installationId,
    keyThumbprint: "k".repeat(43),
    audience: "https://forge.test/api",
    profile: "trusted_personal_assistant",
    scopes: ["read", "write"],
    selectedUserIds: ["user_primary"]
  });
  const principal: ForgePrincipal = {
    kind: "paired_client",
    subjectId,
    ownerId,
    clientId,
    installationId,
    audience: "https://forge.test/api",
    scopes: ["read", "write"],
    selectedUserIds: ["user_primary"],
    clientType: "browser",
    profile: "trusted_personal_assistant",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: now
  };
  const session = {
    sessionId: "ses_trusted_browser_test",
    principal,
    authenticatedAt: now,
    absoluteExpiresAt: "2026-08-19T08:00:00.000Z"
  } as unknown as VerifiedBrowserSession;
  const secrets = {
    deriveKey: () => new Uint8Array(32).fill(47)
  } as unknown as SecretsManager;
  const service = new TrustedBrowserService(
    database,
    clock,
    secrets,
    store,
    installationId,
    "/tmp/forge-trusted-browser-test"
  );
  return {
    database,
    clock,
    store,
    service,
    session,
    clientId,
    ownerId,
    installationId,
    secrets
  };
}

async function registerTrustedBrowser(
  context: ReturnType<typeof fixture>,
  origin = "https://forge.test"
) {
  const registration = await context.service.beginRegistration({
    session: context.session,
    origin,
    directLocalTransport: false,
    label: "Example iPhone"
  });
  const authenticator = registrationResponse({
    challenge: registration.options.challenge,
    origin,
    rpId: new URL(origin).hostname
  });
  const credential = await context.service.finishRegistration({
    session: context.session,
    origin,
    directLocalTransport: false,
    challengeId: registration.challengeId,
    response: authenticator.response
  });
  return { authenticator, credential };
}

test("trusted browser restores one exact paired authority and consumes assertions once", async () => {
  const context = fixture();
  try {
    const origin = "https://forge.test";
    const registration = await context.service.beginRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      label: "Example iPhone"
    });
    const authenticator = registrationResponse({
      challenge: registration.options.challenge,
      origin,
      rpId: "forge.test"
    });
    const credential = await context.service.finishRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      challengeId: registration.challengeId,
      response: authenticator.response
    });
    assert.equal(credential.clientId, context.clientId);
    assert.equal(credential.profile, "trusted_personal_assistant");
    assert.deepEqual(credential.scopes, ["read", "write"]);
    assert.deepEqual(credential.selectedUserIds, ["user_primary"]);

    const authentication = await context.service.beginAuthentication({
      origin,
      networkPartition: "test:successful-restoration"
    });
    assert.deepEqual(authentication.options.allowCredentials, []);
    assert.equal(
      JSON.stringify(authentication).includes(authenticator.id),
      false,
      "discoverable authentication must not enumerate credential ids"
    );
    const assertion = authenticationResponse({
      challenge: authentication.options.challenge,
      origin,
      rpId: "forge.test",
      credentialId: authenticator.id,
      privateKey: authenticator.privateKey,
      counter: 1
    });
    const restored = await context.service.finishAuthentication({
      origin,
      challengeId: authentication.challengeId,
      response: assertion
    });
    assert.equal(restored.client.id, context.clientId);
    assert.equal(restored.client.profile, "trusted_personal_assistant");

    const rollback = await context.service.beginAuthentication({
      origin,
      networkPartition: "test:counter-rollback"
    });
    await assert.rejects(
      context.service.finishAuthentication({
        origin,
        challengeId: rollback.challengeId,
        response: authenticationResponse({
          challenge: rollback.options.challenge,
          origin,
          rpId: "forge.test",
          credentialId: authenticator.id,
          privateKey: authenticator.privateKey,
          counter: 1
        })
      }),
      /counter/i
    );
    await assert.rejects(
      context.service.finishAuthentication({
        origin,
        challengeId: authentication.challengeId,
        response: assertion
      }),
      /missing, expired, replayed, or stale/
    );
  } finally {
    context.database.close();
  }
});

test("authority drift revokes trust and expired ceremonies fail closed", async () => {
  const context = fixture();
  try {
    const origin = "https://forge.test";
    const registration = await context.service.beginRegistration({
      session: context.session,
      origin,
      directLocalTransport: false
    });
    const authenticator = registrationResponse({
      challenge: registration.options.challenge,
      origin,
      rpId: "forge.test"
    });
    await context.service.finishRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      challengeId: registration.challengeId,
      response: authenticator.response
    });

    context.database
      .prepare("UPDATE security_clients SET scopes_json = ? WHERE id = ?")
      .run('["read"]', context.clientId);
    const [revoked] = context.service.list(context.ownerId);
    assert.ok(revoked?.revokedAt);
    assert.equal(revoked?.revocationReason, "client_authority_changed");

    const expired = await context.service.beginAuthentication({
      origin,
      networkPartition: "test:expired-restoration"
    });
    context.clock.advance(121);
    await assert.rejects(
      context.service.finishAuthentication({
        origin,
        challengeId: expired.challengeId,
        response: authenticationResponse({
          challenge: expired.options.challenge,
          origin,
          rpId: "forge.test",
          credentialId: authenticator.id,
          privateKey: authenticator.privateKey,
          counter: 1
        })
      }),
      /missing, expired, replayed, or stale/
    );
  } finally {
    context.database.close();
  }
});

test("client-key mutation advances the epoch and rejects the stale paired session", async () => {
  const context = fixture();
  try {
    await registerTrustedBrowser(context);
    context.database
      .prepare("UPDATE security_clients SET key_thumbprint = ? WHERE id = ?")
      .run("z".repeat(43), context.clientId);

    assert.equal(
      context.store.readClient(context.clientId)?.clientSecurityEpoch,
      2,
      "the database guard must invalidate sessions even when direct SQL omits an epoch update"
    );
    assert.equal(
      context.service.list(context.ownerId)[0]?.revocationReason,
      "client_authority_changed"
    );
    await assert.rejects(
      context.service.beginRegistration({
        session: context.session,
        origin: "https://forge.test",
        directLocalTransport: false
      }),
      /no longer matches its exact client authority/
    );
  } finally {
    context.database.close();
  }
});

test("selected-user restriction and owner reassignment invalidate exact authority", async () => {
  for (const scenario of ["selected-user", "owner"] as const) {
    const context = fixture();
    try {
      await registerTrustedBrowser(context);
      if (scenario === "selected-user") {
        context.database
          .prepare(
            "UPDATE security_clients SET selected_user_ids_json = ? WHERE id = ?"
          )
          .run('["user_other"]', context.clientId);
      } else {
        context.database
          .prepare(
            `INSERT INTO security_owners (
               owner_id, security_epoch, created_at, recovered_at
             ) VALUES (?, 1, ?, NULL)`
          )
          .run("owner_reassigned", context.clock.now().toISOString());
        context.database
          .prepare("UPDATE security_clients SET owner_id = ? WHERE id = ?")
          .run("owner_reassigned", context.clientId);
      }
      assert.equal(
        context.store.readClient(context.clientId)?.clientSecurityEpoch,
        2
      );
      const [credential] = context.service.list(context.ownerId);
      assert.ok(credential?.revokedAt);
      assert.equal(credential?.revocationReason, "client_authority_changed");
      await assert.rejects(
        context.service.beginRegistration({
          session: context.session,
          origin: "https://forge.test",
          directLocalTransport: false
        }),
        scenario === "owner"
          ? /selected paired-browser authority is unavailable/
          : /no longer matches its exact client authority/
      );
    } finally {
      context.database.close();
    }
  }
});

for (const mutation of [
  {
    name: "profile change",
    sql: "UPDATE security_clients SET profile = 'viewer' WHERE id = ?",
    reason: "client_authority_changed"
  },
  {
    name: "subject reassignment",
    sql: "UPDATE security_clients SET subject_id = 'pair_reassigned_123456' WHERE id = ?",
    reason: "client_authority_changed"
  },
  {
    name: "explicit client epoch change",
    sql: "UPDATE security_clients SET client_epoch = client_epoch + 1 WHERE id = ?",
    reason: "client_authority_changed"
  },
  {
    name: "client deactivation",
    sql: "UPDATE security_clients SET revoked_at = '2026-08-18T08:01:00.000Z' WHERE id = ?",
    reason: "client_authority_changed"
  }
] as const) {
  test(`${mutation.name} immediately revokes trusted-browser authority`, async () => {
    const context = fixture();
    try {
      await registerTrustedBrowser(context);
      context.database.prepare(mutation.sql).run(context.clientId);
      const [credential] = context.service.list(context.ownerId);
      assert.ok(credential?.revokedAt);
      assert.equal(credential?.revocationReason, mutation.reason);
    } finally {
      context.database.close();
    }
  });
}

test("owner epoch, installation identity, and client deletion revoke trust", async () => {
  for (const scenario of ["owner", "installation", "delete"] as const) {
    const context = fixture();
    try {
      await registerTrustedBrowser(context);
      if (scenario === "owner") {
        context.database
          .prepare(
            "UPDATE security_owners SET security_epoch = security_epoch + 1 WHERE owner_id = ?"
          )
          .run(context.ownerId);
      } else if (scenario === "installation") {
        context.database
          .prepare(
            "UPDATE security_installation SET installation_id = ? WHERE singleton = 1"
          )
          .run("install_changed_1234567890");
      } else {
        context.database
          .prepare("DELETE FROM security_clients WHERE id = ?")
          .run(context.clientId);
      }
      const [credential] = context.service.list(context.ownerId);
      assert.ok(credential?.revokedAt, `${scenario} must revoke the credential`);
      assert.equal(
        credential?.revocationReason,
        scenario === "owner"
          ? "owner_epoch_changed"
          : scenario === "installation"
            ? "installation_identity_changed"
            : "client_deleted"
      );
    } finally {
      context.database.close();
    }
  }
});

test("trusted credentials persist across service reconstruction and reject another data root", async () => {
  const context = fixture();
  try {
    const { authenticator } = await registerTrustedBrowser(context);
    const restarted = new TrustedBrowserService(
      context.database,
      context.clock,
      context.secrets,
      context.store,
      context.installationId,
      "/tmp/forge-trusted-browser-test"
    );
    const restoredChallenge = await restarted.beginAuthentication({
      origin: "https://forge.test",
      networkPartition: "test:restart"
    });
    const restored = await restarted.finishAuthentication({
      origin: "https://forge.test",
      challengeId: restoredChallenge.challengeId,
      response: authenticationResponse({
        challenge: restoredChallenge.options.challenge,
        origin: "https://forge.test",
        rpId: "forge.test",
        credentialId: authenticator.id,
        privateKey: authenticator.privateKey,
        counter: 1
      })
    });
    assert.equal(restored.client.id, context.clientId);

    const wrongRoot = new TrustedBrowserService(
      context.database,
      context.clock,
      context.secrets,
      context.store,
      context.installationId,
      "/tmp/another-forge-data-root"
    );
    const wrongRootChallenge = await wrongRoot.beginAuthentication({
      origin: "https://forge.test",
      networkPartition: "test:wrong-root"
    });
    await assert.rejects(
      wrongRoot.finishAuthentication({
        origin: "https://forge.test",
        challengeId: wrongRootChallenge.challengeId,
        response: authenticationResponse({
          challenge: wrongRootChallenge.options.challenge,
          origin: "https://forge.test",
          rpId: "forge.test",
          credentialId: authenticator.id,
          privateKey: authenticator.privateKey,
          counter: 2
        })
      }),
      /authority is revoked or stale/
    );
  } finally {
    context.database.close();
  }
});

test("owner revocation blocks the next trusted-browser restoration immediately", async () => {
  const context = fixture();
  try {
    const { authenticator, credential } = await registerTrustedBrowser(context);
    assert.equal(context.service.revoke(context.ownerId, credential.id), true);
    const challenge = await context.service.beginAuthentication({
      origin: "https://forge.test",
      networkPartition: "test:revoked"
    });
    await assert.rejects(
      context.service.finishAuthentication({
        origin: "https://forge.test",
        challengeId: challenge.challengeId,
        response: authenticationResponse({
          challenge: challenge.options.challenge,
          origin: "https://forge.test",
          rpId: "forge.test",
          credentialId: authenticator.id,
          privateKey: authenticator.privateKey,
          counter: 1
        })
      }),
      /not accepted/
    );
  } finally {
    context.database.close();
  }
});

test("transport policy permits direct loopback and HTTPS but rejects remote HTTP", async () => {
  const context = fixture();
  try {
    await assert.rejects(
      context.service.beginRegistration({
        session: context.session,
        origin: "http://127.0.0.1",
        directLocalTransport: false
      }),
      /direct local connection/
    );
    await assert.doesNotReject(
      context.service.beginRegistration({
        session: context.session,
        origin: "http://127.0.0.1",
        directLocalTransport: true
      })
    );
    await assert.doesNotReject(
      context.service.beginRegistration({
        session: context.session,
        origin: "https://forge.test",
        directLocalTransport: false
      })
    );
    await assert.rejects(
      context.service.beginAuthentication({
        origin: "http://forge.test",
        networkPartition: "test:remote-http"
      }),
      /HTTPS/
    );
  } finally {
    context.database.close();
  }
});

test("the 64-credential boundary remains usable, manageable, and race-safe", async () => {
  const context = fixture();
  try {
    const origin = "https://forge.test";
    for (let index = 0; index < 63; index += 1) {
      await registerTrustedBrowser(context, origin);
    }
    const firstRace = await context.service.beginRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      label: "Boundary credential A"
    });
    const secondRace = await context.service.beginRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      label: "Boundary credential B"
    });
    const firstAuthenticator = registrationResponse({
      challenge: firstRace.options.challenge,
      origin,
      rpId: "forge.test"
    });
    const secondAuthenticator = registrationResponse({
      challenge: secondRace.options.challenge,
      origin,
      rpId: "forge.test"
    });
    await context.service.finishRegistration({
      session: context.session,
      origin,
      directLocalTransport: false,
      challengeId: firstRace.challengeId,
      response: firstAuthenticator.response
    });
    await assert.rejects(
      context.service.finishRegistration({
        session: context.session,
        origin,
        directLocalTransport: false,
        challengeId: secondRace.challengeId,
        response: secondAuthenticator.response
      }),
      /missing, expired, replayed, or stale/
    );

    const allActive = context.service.list(context.ownerId);
    assert.equal(allActive.length, 64);
    assert.equal(allActive.every((credential) => !credential.revokedAt), true);
    assert.throws(
      () =>
        context.database
          .prepare(
            `INSERT INTO security_trusted_browser_credentials (
               id, credential_id, owner_id, installation_id,
               data_root_binding, client_id, client_subject_id,
               client_key_thumbprint, client_type, audience, profile,
               scopes_json, selected_user_ids_json, owner_epoch, client_epoch,
               authority_digest, rp_id, origin, public_key_base64, counter,
               transports_json, label, device_type, backed_up, aaguid,
               created_at, last_used_at, revoked_at, revocation_reason
             )
             SELECT ?, ?, owner_id, installation_id, data_root_binding,
                    client_id, client_subject_id, client_key_thumbprint,
                    client_type, audience, profile, scopes_json,
                    selected_user_ids_json, owner_epoch, client_epoch,
                    authority_digest, rp_id, origin, public_key_base64,
                    counter, transports_json, label, device_type, backed_up,
                    aaguid, created_at, last_used_at, NULL, NULL
             FROM security_trusted_browser_credentials WHERE id = ?`
          )
          .run(
            "tbr_capacity_overflow_65",
            "capacity_overflow_65",
            allActive[0]!.id
          ),
      /active credential limit reached/
    );
    await assert.rejects(
      context.service.beginRegistration({
        session: context.session,
        origin,
        directLocalTransport: false
      }),
      /maximum number of active trusted-device credentials/
    );

    assert.equal(
      context.service.revoke(context.ownerId, allActive[0]!.id),
      true
    );
    const manageable = context.service.list(context.ownerId);
    assert.equal(manageable.length, 64);
    assert.equal(
      manageable.filter((credential) => !credential.revokedAt).length,
      63
    );
    await assert.doesNotReject(
      context.service.beginRegistration({
        session: context.session,
        origin,
        directLocalTransport: false
      })
    );
  } finally {
    context.database.close();
  }
});

test("public trusted-browser starts are partition-limited without storing network material", async () => {
  const context = fixture();
  try {
    const networkPartition = "socket:203.0.113.45";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await context.service.beginAuthentication({
        origin: "https://forge.test",
        networkPartition
      });
    }
    await assert.rejects(
      context.service.beginAuthentication({
        origin: "https://forge.test",
        networkPartition
      }),
      /temporarily limiting/
    );
    const buckets = context.database
      .prepare(
        "SELECT bucket_key FROM security_pairing_rate_limits WHERE bucket_key LIKE 'trusted-browser:%'"
      )
      .all() as Array<{ bucket_key: string }>;
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]!.bucket_key.includes("203.0.113.45"), false);
  } finally {
    context.database.close();
  }
});
