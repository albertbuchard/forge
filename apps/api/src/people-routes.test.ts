import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase,
  runInTransaction
} from "./db.js";
import { HttpError } from "./errors.js";
import type { AuthContext } from "./managers/contracts.js";
import { AuthorizationManager } from "./managers/platform/authorization-manager.js";
import { SecretsManager } from "./managers/platform/secrets-manager.js";
import { peerShareGrantVersionSchema } from "./peer-sharing-types.js";
import {
  hashPeerApiValue,
  insertPeerGrantVersion
} from "./repositories/peer-sharing.js";
import { bindPersonToActor, createPerson } from "./repositories/people.js";
import { getDefaultUser } from "./repositories/users.js";
import { registerPeopleRoutes } from "./routes/people.js";
import {
  type PeerCoreGateway,
  UnavailablePeerCoreGateway
} from "./services/peer-core-gateway.js";
import {
  encryptPeerCachePayload,
  peerCacheKeyId
} from "./services/peer-cache-crypto.js";
import { hashPeerGrantVersion } from "./services/peer-grants.js";
import { PeerOperationRateLimiter } from "./services/peer-rate-limit.js";
import { hashPeerQueryCacheIdentity } from "./services/peer-typed-query.js";

function operatorContext(): AuthContext {
  return {
    now: new Date("2026-07-15T12:00:00.000Z"),
    correlationId: null,
    requestId: null,
    origin: "http://127.0.0.1",
    host: "127.0.0.1",
    ip: "127.0.0.1",
    actor: "People route test",
    source: "ui",
    token: null,
    scope: { userIds: [], projectIds: [], tagIds: [] },
    session: {
      id: "session_people_test",
      actorLabel: "Operator",
      expiresAt: "2026-07-15T13:00:00.000Z"
    }
  };
}

function agentContext(userIds: string[], scopes: string[]): AuthContext {
  return {
    ...operatorContext(),
    actor: "People route agent test",
    source: "agent",
    session: null,
    token: {
      id: "token_people_route_test",
      agentId: "agent_people_route_test",
      agentLabel: "People test agent",
      scopes,
      trustLevel: "trusted",
      autonomyMode: "supervised",
      approvalMode: "required",
      bootstrapPolicy: {
        mode: "disabled",
        goalsLimit: 0,
        projectsLimit: 0,
        tasksLimit: 0,
        habitsLimit: 0,
        strategiesLimit: 0,
        peoplePageLimit: 0,
        includePeoplePages: false
      },
      scopePolicy: {
        userIds,
        projectIds: [],
        tagIds: []
      }
    }
  };
}

async function withPeopleApp(
  operation: (input: {
    app: ReturnType<typeof Fastify>;
    ownerUserId: string;
    secrets: SecretsManager;
  }) => Promise<void>,
  options: {
    peerCore?: PeerCoreGateway;
    authenticate?: () => AuthContext;
    rateLimiter?: PeerOperationRateLimiter;
  } = {}
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-people-routes-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  const app = Fastify({ logger: false });
  const secrets = new SecretsManager();
  secrets.configure(rootDir);
  await registerPeopleRoutes(app, {
    authenticate: options.authenticate ?? (() => operatorContext()),
    authorization: new AuthorizationManager(),
    secrets,
    peerCore: options.peerCore ?? new UnavailablePeerCoreGateway(),
    rateLimiter: options.rateLimiter
  });
  try {
    await operation({ app, ownerUserId: getDefaultUser().id, secrets });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function insertUser(id: string, handle: string, displayName: string): void {
  const now = "2026-07-15T08:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color, created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#c0c1ff', ?, ?)`
    )
    .run(id, handle, displayName, now, now);
}

function tamperOpaqueCursor(cursor: string): string {
  const index = Math.max(cursor.lastIndexOf(".") + 1, cursor.length - 12);
  const replacement = cursor[index] === "A" ? "B" : "A";
  return `${cursor.slice(0, index)}${replacement}${cursor.slice(index + 1)}`;
}

function p95(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

function seedRelationship(input: {
  ownerUserId: string;
  personId: string;
  relationshipId: string;
  principalNamespace?: string;
}) {
  const now = "2026-07-15T12:00:00.000Z";
  const principalNamespace = input.principalNamespace ?? input.relationshipId;
  const localPrincipalId = `${principalNamespace}_local`;
  const remotePrincipalId = `${principalNamespace}_remote`;
  getDatabase()
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, local_person_id,
         trust_state, minimum_protocol_version, maximum_protocol_version,
         first_verified_at, last_verified_at, revoked_at, metadata_json,
         created_at, updated_at
       ) VALUES
         (?, ?, 'local', ?, ?, 'secret_local', 'Local Forge', NULL,
          'verified', 1, 1, ?, ?, NULL, '{}', ?, ?),
         (?, ?, 'remote', ?, ?, NULL, 'Shared Forge', ?,
          'verified', 1, 1, ?, ?, NULL, '{}', ?, ?)`
    )
    .run(
      localPrincipalId,
      input.ownerUserId,
      `public_${localPrincipalId}`,
      createHash("sha256")
        .update(`${principalNamespace}:local-root`)
        .digest("hex"),
      now,
      now,
      now,
      now,
      remotePrincipalId,
      input.ownerUserId,
      `public_${remotePrincipalId}`,
      createHash("sha256")
        .update(`${principalNamespace}:remote-root`)
        .digest("hex"),
      input.personId,
      now,
      now,
      now,
      now
    );
  getDatabase()
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, negotiated_protocol_version,
         verification_phrase_hash, transport_privacy_mode,
         highest_received_sequence, highest_sent_sequence, established_at,
         last_connected_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 'forge-peer/1', ?, 'fastest',
                 0, 0, ?, ?, NULL, ?, ?)`
    )
    .run(
      input.relationshipId,
      input.ownerUserId,
      localPrincipalId,
      remotePrincipalId,
      input.personId,
      "a".repeat(64),
      now,
      now,
      now,
      now
    );
  return { localPrincipalId, remotePrincipalId };
}

function seedCalendarQueryGrant(input: {
  ownerUserId: string;
  relationshipId: string;
  localPrincipalId: string;
  remotePrincipalId: string;
}) {
  const now = "2026-07-15T11:00:00.000Z";
  const localDeviceId = `${input.relationshipId}_local_device`;
  const remoteDeviceId = `${input.relationshipId}_remote_device`;
  const insertDevice = getDatabase().prepare(
    `INSERT INTO forge_devices (
       id, owner_user_id, principal_id, certified_public_key,
       private_key_secret_id, certificate, label, device_type, status,
       transport_endpoints_json, capabilities_json, added_at, last_seen_at,
       revoked_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 'approved', '[]', '[]', ?, ?, NULL, ?, ?)`
  );
  insertDevice.run(
    localDeviceId,
    input.ownerUserId,
    input.localPrincipalId,
    createHash("sha256")
      .update(`${input.relationshipId}:local-signing`)
      .digest("hex"),
    `${input.relationshipId}_secret_local_device`,
    createHash("sha512")
      .update(`${input.relationshipId}:local-certificate`)
      .digest("hex"),
    "Local test device",
    now,
    now,
    now,
    now
  );
  insertDevice.run(
    remoteDeviceId,
    input.ownerUserId,
    input.remotePrincipalId,
    createHash("sha256")
      .update(`${input.relationshipId}:remote-signing`)
      .digest("hex"),
    null,
    createHash("sha512")
      .update(`${input.relationshipId}:remote-certificate`)
      .digest("hex"),
    "Remote test device",
    now,
    now,
    now,
    now
  );
  const insertRelationshipDevice = getDatabase().prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, removed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'approved', ?, NULL, ?, ?)`
  );
  insertRelationshipDevice.run(
    input.relationshipId,
    input.ownerUserId,
    localDeviceId,
    "local",
    now,
    now,
    now
  );
  insertRelationshipDevice.run(
    input.relationshipId,
    input.ownerUserId,
    remoteDeviceId,
    "remote",
    now,
    now,
    now
  );

  const signatures = [
    {
      deviceId: remoteDeviceId,
      party: "grantor" as const,
      algorithm: "ed25519" as const,
      signature: "A".repeat(64),
      signedAt: now
    },
    {
      deviceId: localDeviceId,
      party: "grantee" as const,
      algorithm: "ed25519" as const,
      signature: "B".repeat(64),
      signedAt: now
    }
  ];
  const grant = peerShareGrantVersionSchema.parse({
    id: `${input.relationshipId}_grant`,
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    direction: "remote_to_local",
    sequence: 1,
    previousVersionHash: null,
    status: "active",
    label: "Calendar availability",
    purpose: "Route output validation",
    issuedAt: now,
    effectiveAt: now,
    expiresAt: null,
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked",
      maximumRetentionSeconds: 86_400,
      purgeOnRevocation: true
    },
    rules: [
      {
        id: `${input.relationshipId}_rule`,
        effect: "allow",
        projectionId: "calendar.availability.v1",
        entitySelector: null,
        fields: {
          include: ["start", "end", "busyState", "eventTitle"],
          exclude: []
        },
        time: {
          startsAt: null,
          endsAt: null,
          rollingPastDays: null,
          rollingFutureDays: null
        },
        precision: "fifteen_minutes",
        aggregation: null,
        approvedDeviceIds: [localDeviceId],
        devicePolicy: "explicit",
        maximumResultCount: 100,
        maximumPayloadBytes: 16_384
      }
    ],
    signatures,
    protocolVersion: "forge-peer/1",
    schemaVersion: 1
  });
  insertPeerGrantVersion(grant);
  const verifiedGrantHash = hashPeerGrantVersion(grant);
  const verificationId = `${input.relationshipId}_verification`;
  getDatabase()
    .prepare(
      `INSERT INTO peer_grant_verifications (
         id, owner_user_id, relationship_id, grant_id, grant_sequence,
         verified_grant_hash, verified_signatures_json,
         verified_signer_device_ids_json,
         approved_relationship_device_ids_json, requesting_device_id,
         verification_result, failure_reason, verified_at, created_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'valid', '', ?, ?)`
    )
    .run(
      verificationId,
      input.ownerUserId,
      input.relationshipId,
      grant.id,
      verifiedGrantHash,
      JSON.stringify(signatures),
      JSON.stringify([remoteDeviceId, localDeviceId]),
      JSON.stringify([localDeviceId]),
      localDeviceId,
      now,
      now
    );
  return {
    relationshipId: input.relationshipId,
    grantId: grant.id,
    grantSequence: grant.sequence,
    verificationId,
    verifiedGrantHash,
    remotePrincipalId: input.remotePrincipalId,
    remoteDeviceId
  };
}

class CalendarQueryGateway extends UnavailablePeerCoreGateway {
  constructor(
    private readonly payload: unknown,
    private readonly metadataOverrides: Record<string, unknown> = {}
  ) {
    super();
  }

  evidence: ReturnType<typeof seedCalendarQueryGrant> | null = null;
  private readonly evidenceByRelationship = new Map<
    string,
    ReturnType<typeof seedCalendarQueryGrant>
  >();

  setEvidence(evidence: ReturnType<typeof seedCalendarQueryGrant>) {
    this.evidenceByRelationship.set(evidence.relationshipId, evidence);
  }

  override async executeQuery(
    input: Parameters<PeerCoreGateway["executeQuery"]>[0]
  ) {
    const evidence =
      this.evidenceByRelationship.get(input.relationshipId) ?? this.evidence;
    if (!evidence) {
      throw new Error("The test grant evidence was not seeded.");
    }
    return {
      state: "live" as const,
      payload: this.payload,
      metadata: {
        grantId: evidence.grantId,
        grantSequence: evidence.grantSequence,
        grantVerificationId: evidence.verificationId,
        verifiedGrantHash: evidence.verifiedGrantHash,
        projectionId: "calendar.availability.v1",
        projectionVersion: 1,
        source: {
          principalId: evidence.remotePrincipalId,
          deviceId: evidence.remoteDeviceId,
          relationshipId: input.relationshipId
        },
        asOf: "2026-07-15T11:55:00.000Z",
        receivedAt: "2026-07-15T12:00:00.000Z",
        validUntil: "2026-07-15T12:15:00.000Z",
        completeness: 1,
        precision: "fifteen_minutes",
        redactedFields: [],
        state: "live",
        ...this.metadataOverrides
      }
    };
  }
}

async function seedCalendarCache(input: {
  ownerUserId: string;
  relationshipId: string;
  evidence: ReturnType<typeof seedCalendarQueryGrant>;
  secrets: SecretsManager;
  payload: unknown;
  validUntil?: string | null;
  nextEventAt?: string | null;
  encryptionKey?: Uint8Array;
  query?: unknown;
}) {
  const query = input.query ?? {
    projectionId: "calendar.availability.v1",
    parameters: {},
    interval: {
      startsAt: "2026-07-19T22:00:00.000Z",
      endsAt: "2026-07-20T22:00:00.000Z",
      timeZone: "Europe/Zurich"
    },
    entityIds: [],
    fields: ["start", "end", "busyState"],
    precision: "fifteen_minutes",
    maximumResultCount: 100
  };
  const queryHash = hashPeerQueryCacheIdentity(query);
  const sourceRecordId = `${input.relationshipId}_calendar_cache`;
  const sourceVersion = "1";
  const key = new Uint8Array(
    input.encryptionKey ?? input.secrets.deriveKey("peer-remote-cache/v1")
  );
  const keyId = peerCacheKeyId(key);
  let envelope: Awaited<ReturnType<typeof encryptPeerCachePayload>>;
  try {
    envelope = await encryptPeerCachePayload({
      key,
      keyId,
      context: {
        ownerUserId: input.ownerUserId,
        relationshipId: input.relationshipId,
        projectionId: "calendar.availability.v1",
        queryHash,
        sourceRecordId,
        sourceVersion
      },
      payload: input.payload
    });
  } finally {
    key.fill(0);
  }
  const now = "2026-07-15T12:00:00.000Z";
  const serialized = JSON.stringify(input.payload);
  getDatabase()
    .prepare(
      `INSERT INTO peer_remote_records (
         id, owner_user_id, relationship_id, projection_id,
         projection_version, source_record_id, source_version,
         encrypted_payload, encryption_key_id, encryption_nonce, payload_hash,
         query_metadata_json, query_hash, next_event_at, source_timestamp,
         received_at, valid_until,
         completeness, precision, grant_id, grant_sequence, cache_state,
         tombstoned_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'calendar.availability.v1', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 1.0, 'fifteen_minutes', ?, ?, 'current', NULL, NULL, ?, ?)`
    )
    .run(
      `${sourceRecordId}_row`,
      input.ownerUserId,
      input.relationshipId,
      sourceRecordId,
      sourceVersion,
      Buffer.from(envelope.ciphertextBase64, "base64"),
      keyId,
      Buffer.from(envelope.nonceBase64, "base64"),
      createHash("sha256").update(serialized).digest("hex"),
      JSON.stringify({
        grantId: input.evidence.grantId,
        grantSequence: input.evidence.grantSequence,
        grantVerificationId: input.evidence.verificationId,
        verifiedGrantHash: input.evidence.verifiedGrantHash,
        queryHash,
        source: {
          principalId: input.evidence.remotePrincipalId,
          deviceId: input.evidence.remoteDeviceId,
          relationshipId: input.relationshipId
        }
      }),
      queryHash,
      input.nextEventAt ?? null,
      "2026-07-15T11:55:00.000Z",
      now,
      input.validUntil === undefined
        ? "2026-07-15T12:15:00.000Z"
        : input.validUntil,
      input.evidence.grantId,
      input.evidence.grantSequence,
      now,
      now
    );
}

function seedWikiPeoplePage(ownerUserId: string) {
  const createdAt = "2026-07-15T08:30:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO wiki_spaces (
         id, slug, label, description, owner_user_id, visibility,
         created_at, updated_at
       ) VALUES ('space_people_route', 'people-route', 'People', '', ?,
                 'personal', ?, ?)`
    )
    .run(ownerUserId, createdAt, createdAt);
  const insert = getDatabase().prepare(
    `INSERT INTO notes (
       id, content_markdown, content_plain, author, source, kind, title, slug,
       space_id, aliases_json, summary, parent_slug, created_at, updated_at
     ) VALUES (?, ?, ?, 'test', 'manual', 'wiki', ?, ?,
               'space_people_route', '[]', '', ?, ?, ?)`
  );
  insert.run(
    "note_people_route_root",
    "# People",
    "People",
    "People",
    "people",
    null,
    createdAt,
    createdAt
  );
  insert.run(
    "note_people_route_jon",
    "# Jon",
    "Jon",
    "Jon",
    "jon",
    "people",
    createdAt,
    createdAt
  );
  return { createdAt };
}

test("People read routes paginate, distinguish relationship filters, and redact private fields", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    const shared = createPerson({
      userId: ownerUserId,
      displayName: "Ada Shared",
      description: "Private context for Ada"
    });
    const local = createPerson({
      userId: ownerUserId,
      displayName: "Bea Local",
      description: "Private context for Bea"
    });
    createPerson({ userId: ownerUserId, displayName: "Cleo Local" });
    seedRelationship({
      ownerUserId,
      personId: shared.id,
      relationshipId: "relationship_ada"
    });

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=display_name&direction=asc"
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.people.length, 1);
    assert.equal(firstBody.people[0].displayName, "Ada Shared");
    assert.equal(firstBody.people[0].description, "");
    assert.equal(firstBody.page.hasMore, true);
    assert.equal(typeof firstBody.page.nextCursor, "string");

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&sort=display_name&direction=asc&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().people[0].displayName, "Bea Local");

    const unshared = await app.inject({
      method: "GET",
      url: "/api/v1/people?relationshipStatus=none"
    });
    assert.equal(unshared.statusCode, 200);
    assert.deepEqual(
      unshared
        .json()
        .people.map((person: { displayName: string }) => person.displayName),
      ["Bea Local", "Cleo Local"]
    );

    const sharedOnly = await app.inject({
      method: "GET",
      url: "/api/v1/people?source=shared"
    });
    assert.equal(sharedOnly.statusCode, 200);
    assert.deepEqual(
      sharedOnly
        .json()
        .people.map((person: { displayName: string }) => person.displayName),
      ["Ada Shared"]
    );

    const privateContext = await app.inject({
      method: "GET",
      url: `/api/v1/people/${local.id}/context?includePrivate=true`
    });
    assert.equal(privateContext.statusCode, 200);
    assert.equal(
      privateContext.json().context.person.description,
      "Private context for Bea"
    );
  });
});

test("People initial-list exhaustion returns exact 429 details and Retry-After", async () => {
  const limiter = new PeerOperationRateLimiter();
  for (let requestIndex = 0; requestIndex < 179; requestIndex += 1) {
    limiter.consume({
      operationId: "listPeopleReadModel:initial",
      principalId: "session_people_test",
      limit: 180
    });
  }
  await withPeopleApp(
    async ({ app }) => {
      app.setErrorHandler(
        (
          error: FastifyError,
          _request: FastifyRequest,
          reply: FastifyReply
        ) => {
          if (error instanceof HttpError) {
            return reply.code(error.statusCode).send({
              code: error.code,
              error: error.message,
              statusCode: error.statusCode,
              ...(error.details ?? {})
            });
          }
          return reply.code(500).send({
            code: "internal_error",
            error: error instanceof Error ? error.message : "Unknown error.",
            statusCode: 500
          });
        }
      );

      const allowed = await app.inject({
        method: "GET",
        url: "/api/v1/people?limit=1"
      });
      assert.equal(allowed.statusCode, 200, allowed.body);

      const blocked = await app.inject({
        method: "GET",
        url: "/api/v1/people?limit=1"
      });
      assert.equal(blocked.statusCode, 429, blocked.body);
      const retryAfterSeconds = Number(blocked.headers["retry-after"]);
      assert.ok(Number.isInteger(retryAfterSeconds));
      assert.ok(retryAfterSeconds >= 1 && retryAfterSeconds <= 60);
      assert.deepEqual(blocked.json(), {
        code: "peer_rate_limit_exceeded",
        error: "Too many People operations were requested.",
        statusCode: 429,
        operationId: "listPeopleReadModel",
        limit: 180,
        retryAfterSeconds
      });
    },
    { rateLimiter: limiter }
  );
});

test("Person context honors multi-owner token scope and applies each redaction tier", async () => {
  let currentAuth = operatorContext();
  await withPeopleApp(
    async ({ app, ownerUserId }) => {
      insertUser("user_people_second", "people-second", "Second People Owner");
      const person = createPerson({
        userId: "user_people_second",
        displayName: "Scoped Person",
        description: "Private description",
        privateNotes: "Sensitive note",
        howWeMet: "Private history",
        contacts: [
          {
            kind: "email",
            value: "scoped@example.com",
            visibility: "private"
          }
        ],
        facts: [
          { factType: "basic", value: "basic", sensitivity: "basic" },
          { factType: "private", value: "private", sensitivity: "private" },
          {
            factType: "sensitive",
            value: "sensitive",
            sensitivity: "sensitive"
          },
          {
            factType: "restricted",
            value: "restricted",
            sensitivity: "restricted"
          }
        ]
      });
      bindPersonToActor({
        personId: person.id,
        ownerUserId: person.userId,
        actorUserId: person.userId,
        bindingKind: "self"
      });

      currentAuth = agentContext(
        [ownerUserId, "user_people_second"],
        ["people:read:basic"]
      );
      const basic = await app.inject({
        method: "GET",
        url: `/api/v1/people/${person.id}/context`
      });
      assert.equal(basic.statusCode, 200, basic.body);
      assert.equal(basic.json().context.person.description, "");
      assert.deepEqual(basic.json().context.person.contacts, []);
      assert.deepEqual(
        basic
          .json()
          .context.person.facts.map(
            (fact: { factType: string }) => fact.factType
          ),
        ["basic"]
      );
      assert.deepEqual(basic.json().context.person.actorBindings, []);

      currentAuth = agentContext(
        [ownerUserId, "user_people_second"],
        [
          "people:read:basic",
          "people:read:private",
          "people:read:contacts",
          "people:read:sensitive",
          "people:read:restricted"
        ]
      );
      const privilegedAgent = await app.inject({
        method: "GET",
        url: `/api/v1/people/${person.id}/context?includePrivate=true`
      });
      assert.equal(privilegedAgent.statusCode, 200, privilegedAgent.body);
      assert.equal(
        privilegedAgent.json().context.person.description,
        "Private description"
      );
      assert.equal(
        privilegedAgent.json().context.person.privateNotes,
        "Sensitive note"
      );
      assert.equal(privilegedAgent.json().context.person.contacts.length, 1);
      assert.equal(privilegedAgent.json().context.person.facts.length, 4);
      assert.deepEqual(
        privilegedAgent.json().context.person.actorBindings,
        [],
        "local actor IDs must remain operator-only"
      );

      currentAuth = operatorContext();
      const operator = await app.inject({
        method: "GET",
        url: `/api/v1/people/${person.id}/context?includePrivate=true`
      });
      assert.equal(operator.statusCode, 200, operator.body);
      assert.equal(operator.json().context.person.actorBindings.length, 1);

      currentAuth = agentContext([ownerUserId], ["people:read:basic"]);
      const forbidden = await app.inject({
        method: "GET",
        url: `/api/v1/people/${person.id}/context`
      });
      assert.equal(forbidden.statusCode, 404, forbidden.body);
      assert.equal(forbidden.json().code, "person_not_found");
    },
    { authenticate: () => currentAuth }
  );
});

test("People cursors reject signature tampering and reuse across filters or owners", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    createPerson({ userId: ownerUserId, displayName: "Ada Cursor" });
    createPerson({ userId: ownerUserId, displayName: "Bea Cursor" });
    createPerson({ userId: ownerUserId, displayName: "Cleo Cursor" });
    insertUser("user_cursor_second", "cursor-second", "Cursor Second Owner");
    createPerson({
      userId: "user_cursor_second",
      displayName: "Second Owner Person"
    });

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=display_name&direction=asc"
    });
    assert.equal(first.statusCode, 200, first.body);
    const cursor = first.json().page.nextCursor as string;
    assert.equal(typeof cursor, "string");

    const tampered = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&cursor=${encodeURIComponent(tamperOpaqueCursor(cursor))}`
    });
    assert.equal(tampered.statusCode, 400, tampered.body);

    const changedFilter = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&query=Bea&cursor=${encodeURIComponent(cursor)}`
    });
    assert.equal(changedFilter.statusCode, 400, changedFilter.body);

    const changedOwner = await app.inject({
      method: "GET",
      url: `/api/v1/people?userId=user_cursor_second&limit=1&cursor=${encodeURIComponent(cursor)}`
    });
    assert.equal(changedOwner.statusCode, 400, changedOwner.body);
  });
});

test("People cursors fail closed after owner read-model changes without cross-owner invalidation", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    app.setErrorHandler(
      (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
        if (error instanceof HttpError) {
          return reply.code(error.statusCode).send({
            code: error.code,
            message: error.message,
            ...(error.details ?? {})
          });
        }
        return reply.code(500).send({ code: "internal_error" });
      }
    );
    createPerson({ userId: ownerUserId, displayName: "Ada Stable" });
    const bea = createPerson({
      userId: ownerUserId,
      displayName: "Bea Stable"
    });
    createPerson({ userId: ownerUserId, displayName: "Cleo Stable" });

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=display_name&direction=asc"
    });
    assert.equal(first.statusCode, 200, first.body);
    const staleAfterCreate = first.json().page.nextCursor as string;
    createPerson({ userId: ownerUserId, displayName: "Aaron Concurrent" });

    const createContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&sort=display_name&direction=asc&cursor=${encodeURIComponent(staleAfterCreate)}`
    });
    assert.equal(createContinuation.statusCode, 409, createContinuation.body);
    assert.equal(
      createContinuation.json().code,
      "people_cursor_snapshot_changed"
    );
    assert.equal(createContinuation.json().restartRequired, true);

    const crossOwnerFirst = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=display_name&direction=asc"
    });
    assert.equal(crossOwnerFirst.statusCode, 200, crossOwnerFirst.body);
    const crossOwnerCursor = crossOwnerFirst.json().page.nextCursor as string;
    insertUser("user_cursor_isolated", "cursor-isolated", "Cursor Isolated");
    createPerson({
      userId: "user_cursor_isolated",
      displayName: "Unrelated Owner Person"
    });
    const crossOwnerContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&sort=display_name&direction=asc&cursor=${encodeURIComponent(crossOwnerCursor)}`
    });
    assert.equal(
      crossOwnerContinuation.statusCode,
      200,
      crossOwnerContinuation.body
    );

    const renameFirst = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=display_name&direction=asc"
    });
    assert.equal(renameFirst.statusCode, 200, renameFirst.body);
    const staleAfterRename = renameFirst.json().page.nextCursor as string;
    getDatabase()
      .prepare(
        `UPDATE people
         SET display_name = ?, normalized_display_name = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        "Zed Renamed",
        "zed renamed",
        "2026-07-15T12:30:00.000Z",
        bea.id,
        ownerUserId
      );
    const renameContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&sort=display_name&direction=asc&cursor=${encodeURIComponent(staleAfterRename)}`
    });
    assert.equal(renameContinuation.statusCode, 409, renameContinuation.body);

    const relationshipFirst = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&source=both"
    });
    assert.equal(relationshipFirst.statusCode, 200, relationshipFirst.body);
    const staleAfterRelationship = relationshipFirst.json().page
      .nextCursor as string;
    seedRelationship({
      ownerUserId,
      personId: bea.id,
      relationshipId: "relationship_cursor_revision"
    });
    const relationshipContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&source=both&cursor=${encodeURIComponent(staleAfterRelationship)}`
    });
    assert.equal(
      relationshipContinuation.statusCode,
      409,
      relationshipContinuation.body
    );

    const aliasFirst = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&query=stable"
    });
    assert.equal(aliasFirst.statusCode, 200, aliasFirst.body);
    const staleAfterAlias = aliasFirst.json().page.nextCursor as string;
    getDatabase()
      .prepare(
        `INSERT INTO person_aliases (
           id, person_id, alias, normalized_alias, kind, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'nickname', ?, ?)`
      )
      .run(
        "alias_cursor_revision",
        bea.id,
        "Bee Concurrent",
        "bee concurrent",
        "2026-07-15T12:31:00.000Z",
        "2026-07-15T12:31:00.000Z"
      );
    const aliasContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&query=stable&cursor=${encodeURIComponent(staleAfterAlias)}`
    });
    assert.equal(aliasContinuation.statusCode, 409, aliasContinuation.body);
  });
});

test("next shared event sorting keeps people without current event context last", async () => {
  await withPeopleApp(async ({ app, ownerUserId, secrets }) => {
    const later = createPerson({
      userId: ownerUserId,
      displayName: "Later Shared Event"
    });
    const sooner = createPerson({
      userId: ownerUserId,
      displayName: "Sooner Shared Event"
    });
    createPerson({ userId: ownerUserId, displayName: "No Shared Event" });

    for (const fixture of [
      {
        personId: later.id,
        relationshipId: "relationship_event_later",
        sourceTimestamp: "2026-07-22T08:00:00.000Z"
      },
      {
        personId: sooner.id,
        relationshipId: "relationship_event_sooner",
        sourceTimestamp: "2026-07-18T08:00:00.000Z"
      }
    ]) {
      const principals = seedRelationship({
        ownerUserId,
        personId: fixture.personId,
        relationshipId: fixture.relationshipId
      });
      const evidence = seedCalendarQueryGrant({
        ownerUserId,
        relationshipId: fixture.relationshipId,
        ...principals
      });
      await seedCalendarCache({
        ownerUserId,
        relationshipId: fixture.relationshipId,
        evidence,
        secrets,
        payload: {
          records: [
            {
              recordId: `${fixture.relationshipId}_event`,
              fields: {
                start: fixture.sourceTimestamp,
                end: new Date(
                  Date.parse(fixture.sourceTimestamp) + 3_600_000
                ).toISOString(),
                busyState: "busy"
              }
            }
          ]
        },
        nextEventAt: fixture.sourceTimestamp,
        validUntil: "2026-07-30T00:00:00.000Z"
      });
    }

    const ascending = await app.inject({
      method: "GET",
      url: "/api/v1/people?sort=next_shared_event&direction=asc"
    });
    assert.equal(ascending.statusCode, 200, ascending.body);
    assert.deepEqual(
      ascending
        .json()
        .people.map((person: { displayName: string }) => person.displayName),
      ["Sooner Shared Event", "Later Shared Event", "No Shared Event"]
    );

    const descending = await app.inject({
      method: "GET",
      url: "/api/v1/people?sort=next_shared_event&direction=desc"
    });
    assert.equal(descending.statusCode, 200, descending.body);
    assert.deepEqual(
      descending
        .json()
        .people.map((person: { displayName: string }) => person.displayName),
      ["Later Shared Event", "Sooner Shared Event", "No Shared Event"]
    );

    const paged = await app.inject({
      method: "GET",
      url: "/api/v1/people?limit=1&sort=next_shared_event&direction=asc"
    });
    assert.equal(paged.statusCode, 200, paged.body);
    const staleAfterProjection = paged.json().page.nextCursor as string;
    getDatabase()
      .prepare(
        `UPDATE peer_remote_records
         SET next_event_at = ?, updated_at = ?
         WHERE owner_user_id = ? AND relationship_id = ?`
      )
      .run(
        "2026-07-17T08:00:00.000Z",
        "2026-07-15T12:32:00.000Z",
        ownerUserId,
        "relationship_event_later"
      );
    const projectionContinuation = await app.inject({
      method: "GET",
      url: `/api/v1/people?limit=1&sort=next_shared_event&direction=asc&cursor=${encodeURIComponent(staleAfterProjection)}`
    });
    assert.equal(
      projectionContinuation.statusCode,
      409,
      projectionContinuation.body
    );
  });
});

test("Person context reports scoped connection summaries and latest projection freshness", async () => {
  await withPeopleApp(async ({ app, ownerUserId, secrets }) => {
    const person = createPerson({
      userId: ownerUserId,
      displayName: "Shared Context Person"
    });
    const relationshipId = "relationship_context_summary";
    const principals = seedRelationship({
      ownerUserId,
      personId: person.id,
      relationshipId
    });
    const evidence = seedCalendarQueryGrant({
      ownerUserId,
      relationshipId,
      ...principals
    });
    await seedCalendarCache({
      ownerUserId,
      relationshipId,
      evidence,
      secrets,
      payload: { records: [] },
      validUntil: "2026-07-15T11:59:59.000Z"
    });
    getDatabase()
      .prepare(
        `INSERT INTO peer_pending_requests (
           id, owner_user_id, relationship_id, request_kind, status, version,
           payload_json, payload_hash, expires_at, decided_at, decision_reason,
           created_at, updated_at
         ) VALUES (?, ?, ?, 'grant', 'pending', 1, '{}', ?, ?, NULL, '', ?, ?)`
      )
      .run(
        "peer_request_context_summary",
        ownerUserId,
        relationshipId,
        "f".repeat(64),
        "2026-07-16T12:00:00.000Z",
        "2026-07-15T11:00:00.000Z",
        "2026-07-15T11:00:00.000Z"
      );

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/people/${person.id}/context`
    });
    assert.equal(response.statusCode, 200, response.body);
    const context = response.json().context as {
      relationships: Array<Record<string, unknown>>;
      sharedProjections: Array<Record<string, unknown>>;
      sources: Record<string, unknown>;
    };
    assert.equal(context.relationships.length, 1);
    assert.equal(context.relationships[0]?.pendingRequestCount, 1);
    assert.equal(context.relationships[0]?.approvedDeviceCount, 2);
    assert.equal(context.relationships[0]?.pendingDeviceCount, 0);
    assert.equal(context.sharedProjections.length, 1);
    assert.equal(context.sharedProjections[0]?.state, "stale");
    assert.deepEqual(context.sharedProjections[0]?.source, {
      principalId: evidence.remotePrincipalId,
      deviceId: evidence.remoteDeviceId,
      relationshipId
    });
    assert.equal(context.sources.shared, true);
    assert.equal(context.sources.sharedProjectionCount, 1);
  });
});

test("10k People and 10k linked context stay indexed, bounded, and within p95 budgets", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    const database = getDatabase();
    const now = "2026-07-15T12:00:00.000Z";
    const insertPerson = database.prepare(
      `INSERT INTO people (
         id, user_id, display_name, normalized_display_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertOwner = database.prepare(
      `INSERT INTO entity_owners (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, 'owner', ?, ?)`
    );
    runInTransaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        const suffix = String(index).padStart(5, "0");
        const id = `person_scale_10k_${suffix}`;
        const displayName = `Scale Person ${suffix}`;
        insertPerson.run(
          id,
          ownerUserId,
          displayName,
          displayName.toLocaleLowerCase("und"),
          now,
          now
        );
        insertOwner.run("person", id, ownerUserId, now, now);
      }
    });

    const contextPerson = createPerson(
      { userId: ownerUserId, displayName: "Large Context Person" },
      { id: "person_large_context", now: new Date(now) }
    );
    const insertNote = database.prepare(
      `INSERT INTO notes (
         id, content_markdown, content_plain, author, source, kind, title,
         created_at, updated_at
       ) VALUES (?, '', '', 'test', 'manual', 'note', ?, ?, ?)`
    );
    const insertLink = database.prepare(
      `INSERT INTO entity_links (
         source_entity_type, source_entity_id, target_entity_type,
         target_entity_id, anchor_key, relationship, created_by_actor, created_at
       ) VALUES ('person', ?, 'note', ?, ?, 'related', 'test', ?)`
    );
    runInTransaction(() => {
      for (let noteIndex = 0; noteIndex < 100; noteIndex += 1) {
        const noteId = `note_large_context_${String(noteIndex).padStart(3, "0")}`;
        insertNote.run(noteId, `Context note ${noteIndex}`, now, now);
        insertOwner.run("note", noteId, ownerUserId, now, now);
        for (let anchorIndex = 0; anchorIndex < 100; anchorIndex += 1) {
          insertLink.run(
            contextPerson.id,
            noteId,
            `anchor-${String(anchorIndex).padStart(3, "0")}`,
            now
          );
        }
      }
    });

    const peoplePlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM people
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY normalized_display_name, id LIMIT 101`
      )
      .all(ownerUserId) as Array<{ detail: string }>;
    assert.match(
      peoplePlan.map((row) => row.detail).join("\n"),
      /idx_people_owner_active_name/i
    );
    const linkPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT target_entity_id FROM entity_links
         WHERE source_entity_type = 'person' AND source_entity_id = ?
         ORDER BY created_at, source_entity_type, source_entity_id,
                  target_entity_type, target_entity_id, relationship, anchor_key
         LIMIT 400`
      )
      .all(contextPerson.id) as Array<{ detail: string }>;
    assert.match(
      linkPlan.map((row) => row.detail).join("\n"),
      /idx_entity_links_source/i
    );

    const listDurations: number[] = [];
    const contextDurations: number[] = [];
    for (let sample = 0; sample < 12; sample += 1) {
      let startedAt = performance.now();
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/people?limit=100&sort=display_name&direction=asc"
      });
      listDurations.push(performance.now() - startedAt);
      assert.equal(list.statusCode, 200, list.body);
      assert.equal(list.json().people.length, 100);

      startedAt = performance.now();
      const context = await app.inject({
        method: "GET",
        url: `/api/v1/people/${contextPerson.id}/context?linkLimit=100&includeShared=false`
      });
      contextDurations.push(performance.now() - startedAt);
      assert.equal(context.statusCode, 200, context.body);
      assert.equal(context.json().context.links.length, 100);
      assert.deepEqual(context.json().context.relationships, []);
      assert.deepEqual(context.json().context.sharedProjections, []);
    }

    const listP95 = p95(listDurations);
    const contextP95 = p95(contextDurations);
    assert.ok(
      listP95 < 300,
      `10k People list p95 ${listP95.toFixed(1)}ms exceeded 300ms`
    );
    assert.ok(
      contextP95 < 500,
      `10k-link Person context p95 ${contextP95.toFixed(1)}ms exceeded 500ms`
    );

    async function traverseDefaultPages() {
      const personIds = new Set<string>();
      let cursor: string | null = null;
      let pageCount = 0;
      do {
        const response: Awaited<ReturnType<typeof app.inject>> =
          await app.inject({
            method: "GET",
            url: `/api/v1/people?limit=50&sort=display_name&direction=asc${
              cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
            }`
          });
        assert.equal(response.statusCode, 200, response.body);
        const body = response.json() as {
          people: Array<{ id: string }>;
          page: { nextCursor: string | null };
        };
        for (const person of body.people) {
          assert.equal(personIds.has(person.id), false, person.id);
          personIds.add(person.id);
        }
        cursor = body.page.nextCursor;
        pageCount += 1;
        assert.ok(pageCount <= 202, "People traversal did not converge.");
      } while (cursor);
      return { personIds, pageCount };
    }

    const firstTraversal = await traverseDefaultPages();
    const secondTraversal = await traverseDefaultPages();
    assert.equal(firstTraversal.personIds.size, 10_001);
    assert.equal(firstTraversal.pageCount, 201);
    assert.deepEqual(
      [...secondTraversal.personIds].sort(),
      [...firstTraversal.personIds].sort()
    );
    assert.equal(secondTraversal.pageCount, 201);
  });
});

test("Wiki association routes bind previewed versions and replay apply idempotently", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    const { createdAt } = seedWikiPeoplePage(ownerUserId);
    const decisions = [
      {
        wikiPageId: "note_people_route_jon",
        action: "create_person",
        displayName: "Jon Route",
        expectedWikiVersion: createdAt
      }
    ];
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/people/wiki-associations/preview",
      payload: {
        peopleRootPageId: "note_people_route_root",
        decisions
      }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const reviewed = preview.json().preview as {
      id: string;
      hash: string;
      mutationCount: number;
    };
    assert.equal(reviewed.mutationCount, 1);

    const payload = {
      peopleRootPageId: "note_people_route_root",
      previewId: reviewed.id,
      previewHash: reviewed.hash,
      idempotencyKey: "wiki-route-test-0001",
      decisions
    };
    const applied = await app.inject({
      method: "POST",
      url: "/api/v1/people/wiki-associations/apply",
      payload
    });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().replayed, false);
    assert.equal(applied.json().results[0].status, "created");

    getDatabase()
      .prepare("UPDATE notes SET updated_at = ? WHERE id = ?")
      .run("2026-07-15T09:30:00.000Z", "note_people_route_jon");

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/people/wiki-associations/apply",
      payload
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().replayed, true);
    assert.equal(
      replay.json().results[0].personId,
      applied.json().results[0].personId
    );
    const personCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM people
         WHERE user_id = ? AND normalized_display_name = 'jon route'`
      )
      .get(ownerUserId) as { count: number };
    assert.equal(personCount.count, 1);
  });
});

test("Wiki candidate route pages beyond 500 rows and rejects stale or rebound cursors", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    const { createdAt } = seedWikiPeoplePage(ownerUserId);
    const insert = getDatabase().prepare(
      `INSERT INTO notes (
         id, content_markdown, content_plain, author, source, kind, title, slug,
         space_id, aliases_json, summary, parent_slug, created_at, updated_at
       ) VALUES (?, ?, ?, 'test', 'manual', 'wiki', ?, ?,
                 'space_people_route', '[]', '', 'people', ?, ?)`
    );
    runInTransaction(() => {
      for (let index = 0; index < 550; index += 1) {
        const suffix = String(index).padStart(3, "0");
        insert.run(
          `note_people_candidate_${suffix}`,
          `# Candidate ${suffix}`,
          `Candidate ${suffix}`,
          `Candidate ${suffix}`,
          `candidate-${suffix}`,
          createdAt,
          createdAt
        );
      }
    });

    const candidates = new Set<string>();
    let cursor: string | undefined;
    let firstCursor: string | undefined;
    do {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/people/wiki-candidates/scan",
        payload: {
          peopleRootPageId: "note_people_route_root",
          limit: 100,
          ...(cursor ? { cursor } : {})
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json() as {
        candidates: Array<{ noteId: string }>;
        page: { nextCursor: string | null };
        scan: { scannedCount: number; truncated: boolean };
      };
      for (const candidate of body.candidates) {
        candidates.add(candidate.noteId);
      }
      firstCursor ??= body.page.nextCursor ?? undefined;
      cursor = body.page.nextCursor ?? undefined;
      assert.equal(body.scan.scannedCount, 551);
      assert.equal(body.scan.truncated, false);
    } while (cursor);

    assert.equal(candidates.size, 551);
    assert.ok(candidates.has("note_people_candidate_549"));
    assert.ok(firstCursor);

    const rebound = await app.inject({
      method: "POST",
      url: "/api/v1/people/wiki-candidates/scan",
      payload: {
        peopleRootPageId: "note_people_route_root",
        query: "Candidate",
        cursor: firstCursor,
        limit: 100
      }
    });
    assert.equal(rebound.statusCode, 400, rebound.body);

    getDatabase()
      .prepare("UPDATE notes SET updated_at = ? WHERE id = ?")
      .run("2026-07-15T10:00:00.000Z", "note_people_candidate_000");
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/people/wiki-candidates/scan",
      payload: {
        peopleRootPageId: "note_people_route_root",
        cursor: firstCursor,
        limit: 100
      }
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, "wiki_people_scan_changed");
  });
});

async function interpretAvailabilityQuestion(
  app: ReturnType<typeof Fastify>,
  personId: string,
  question = "Is Jon free next Monday?"
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/people/${personId}/questions/interpret`,
    payload: {
      question,
      timeZone: "Europe/Zurich",
      referenceTime: "2026-07-15T12:00:00.000Z"
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  const interpretation = response.json().interpretation as {
    supported: boolean;
    id: string;
    hash: string;
    query: Record<string, unknown>;
  };
  assert.equal(interpretation.supported, true);
  return interpretation;
}

test("typed People questions resolve relative dates and bounded horizons deterministically", async () => {
  await withPeopleApp(async ({ app, ownerUserId }) => {
    const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
    const interpret = async (question: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/people/${person.id}/questions/interpret`,
        payload: {
          question,
          timeZone: "Europe/Zurich",
          referenceTime: "2026-07-15T12:00:00.000Z"
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json().interpretation.query as {
        parameters: Record<string, unknown>;
        interval: {
          startsAt: string;
          endsAt: string;
          timeZone: string;
        } | null;
      };
    };

    const tomorrow = await interpret("Is Jon free tomorrow?");
    assert.deepEqual(tomorrow.interval, {
      startsAt: "2026-07-15T22:00:00.000Z",
      endsAt: "2026-07-16T22:00:00.000Z",
      timeZone: "Europe/Zurich"
    });

    const nextMonday = await interpret("Is Jon free next Monday?");
    assert.equal(nextMonday.interval?.startsAt, "2026-07-19T22:00:00.000Z");
    assert.equal(nextMonday.interval?.endsAt, "2026-07-20T22:00:00.000Z");

    const cycling = await interpret("How much is Jon cycling this month?");
    assert.equal(cycling.interval?.startsAt, "2026-06-30T22:00:00.000Z");
    assert.equal(cycling.interval?.endsAt, "2026-07-15T22:00:00.000Z");

    const goals = await interpret("What is Jon's goal for the next 6 months?");
    assert.deepEqual(goals.interval, {
      startsAt: "2026-07-14T22:00:00.000Z",
      endsAt: "2027-01-14T23:00:00.000Z",
      timeZone: "Europe/Zurich"
    });
    assert.deepEqual(goals.parameters, {});

    for (const question of [
      "Is Jon free on 2026-02-30?",
      "How much was Jon cycling in the past 999 days?"
    ]) {
      const invalid = await app.inject({
        method: "POST",
        url: `/api/v1/people/${person.id}/questions/interpret`,
        payload: {
          question,
          timeZone: "Europe/Zurich",
          referenceTime: "2026-07-15T12:00:00.000Z"
        }
      });
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
  });
});

test("typed question execution redacts a valid live payload at the active grant boundary", async () => {
  const gateway = new CalendarQueryGateway({
    records: [
      {
        recordId: null,
        fields: {
          start: "2026-07-20T08:00:00.000Z",
          end: "2026-07-20T09:00:00.000Z",
          busyState: "busy",
          eventTitle: "Private appointment"
        }
      }
    ]
  });
  await withPeopleApp(
    async ({ app, ownerUserId }) => {
      const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
      const principals = seedRelationship({
        ownerUserId,
        personId: person.id,
        relationshipId: "relationship_query"
      });
      gateway.evidence = seedCalendarQueryGrant({
        ownerUserId,
        relationshipId: "relationship_query",
        ...principals
      });
      const interpretation = await interpretAvailabilityQuestion(
        app,
        person.id
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/people/${person.id}/questions/execute`,
        payload: {
          interpretationId: interpretation.id,
          interpretationHash: interpretation.hash,
          query: interpretation.query,
          sourcePreference: "live_only"
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      const result = response.json().result as {
        payload: { records: Array<{ fields: Record<string, unknown> }> };
        metadata: { redactedFields: string[]; precision: string };
      };
      assert.deepEqual(result.payload.records[0]?.fields, {
        start: "2026-07-20T08:00:00.000Z",
        end: "2026-07-20T09:00:00.000Z",
        busyState: "busy"
      });
      assert.deepEqual(result.metadata.redactedFields, ["eventTitle"]);
      assert.equal(result.metadata.precision, "fifteen_minutes");
      const audit = getDatabase()
        .prepare(
          `SELECT decision, result_count AS resultCount,
                  authorization_evidence_json AS evidenceJson
           FROM peer_query_audit ORDER BY created_at DESC LIMIT 1`
        )
        .get() as {
        decision: string;
        resultCount: number;
        evidenceJson: string;
      };
      assert.equal(audit.decision, "allowed");
      assert.equal(audit.resultCount, 1);
      assert.equal(JSON.parse(audit.evidenceJson).maximumResultCount, 100);
    },
    { peerCore: gateway }
  );
});

test("live query cache IDs isolate owners and relationships while replaying idempotently", async () => {
  const gateway = new CalendarQueryGateway({
    records: [
      {
        recordId: null,
        fields: {
          start: "2026-07-20T08:00:00.000Z",
          end: "2026-07-20T09:00:00.000Z",
          busyState: "busy"
        }
      }
    ]
  });
  await withPeopleApp(
    async ({ app, ownerUserId }) => {
      const secondOwnerUserId = "user_projection_owner_two";
      insertUser(secondOwnerUserId, "projection-owner-two", "Second owner");
      const sharedPrincipalNamespace = "shared_projection_peer";
      const fixtures = [
        {
          ownerUserId,
          person: createPerson({ userId: ownerUserId, displayName: "Jon One" }),
          relationshipId: "relationship_projection_owner_one_a",
          principalNamespace: sharedPrincipalNamespace
        },
        {
          ownerUserId,
          person: createPerson({ userId: ownerUserId, displayName: "Jon Two" }),
          relationshipId: "relationship_projection_owner_one_b"
        },
        {
          ownerUserId: secondOwnerUserId,
          person: createPerson({
            userId: secondOwnerUserId,
            displayName: "Jon Three"
          }),
          relationshipId: "relationship_projection_owner_two",
          principalNamespace: sharedPrincipalNamespace
        }
      ];
      const remotePrincipalIds = fixtures.map((fixture) => {
        const principals = seedRelationship({
          ownerUserId: fixture.ownerUserId,
          personId: fixture.person.id,
          relationshipId: fixture.relationshipId,
          principalNamespace: fixture.principalNamespace
        });
        gateway.setEvidence(
          seedCalendarQueryGrant({
            ownerUserId: fixture.ownerUserId,
            relationshipId: fixture.relationshipId,
            ...principals
          })
        );
        return principals.remotePrincipalId;
      });
      assert.equal(remotePrincipalIds[0], remotePrincipalIds[2]);

      const executeLiveQuery = async (personId: string, question?: string) => {
        const interpretation = await interpretAvailabilityQuestion(
          app,
          personId,
          question
        );
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/people/${personId}/questions/execute`,
          payload: {
            interpretationId: interpretation.id,
            interpretationHash: interpretation.hash,
            query: interpretation.query,
            sourcePreference: "live_only"
          }
        });
        assert.equal(response.statusCode, 200, response.body);
      };

      await executeLiveQuery(fixtures[0]!.person.id);
      const initialRow = getDatabase()
        .prepare(
          `SELECT id FROM peer_remote_records
           WHERE owner_user_id = ? AND relationship_id = ?`
        )
        .get(ownerUserId, fixtures[0]!.relationshipId) as { id: string };
      const initialId = initialRow.id;
      assert.match(initialId, /^peer_remote_[a-f0-9]{64}$/u);

      await executeLiveQuery(fixtures[1]!.person.id);
      await executeLiveQuery(fixtures[2]!.person.id);
      await executeLiveQuery(
        fixtures[0]!.person.id,
        "Is Jon available next Monday?"
      );

      const rows = getDatabase()
        .prepare(
          `SELECT id, owner_user_id AS ownerUserId,
                  relationship_id AS relationshipId,
                  projection_id AS projectionId,
                  projection_version AS projectionVersion,
                  query_hash AS queryHash
           FROM peer_remote_records
           ORDER BY owner_user_id, relationship_id`
        )
        .all() as Array<{
        id: string;
        ownerUserId: string;
        relationshipId: string;
        projectionId: string;
        projectionVersion: number;
        queryHash: string;
      }>;
      assert.equal(rows.length, 3);
      assert.equal(new Set(rows.map((row) => row.id)).size, 3);
      assert.equal(new Set(rows.map((row) => row.queryHash)).size, 1);
      assert.equal(
        rows.filter(
          (row) =>
            row.ownerUserId === ownerUserId &&
            row.relationshipId === fixtures[0]!.relationshipId
        ).length,
        1
      );
      assert.equal(
        rows.find(
          (row) =>
            row.ownerUserId === ownerUserId &&
            row.relationshipId === fixtures[0]!.relationshipId
        )?.id,
        initialId
      );
      for (const row of rows) {
        assert.equal(
          row.id,
          `peer_remote_${hashPeerApiValue({
            ownerUserId: row.ownerUserId,
            relationshipId: row.relationshipId,
            projectionId: row.projectionId,
            projectionVersion: row.projectionVersion,
            queryHash: row.queryHash
          })}`
        );
        assert.match(row.id, /^peer_remote_[a-f0-9]{64}$/u);
        assert.equal(row.id.length, "peer_remote_".length + 64);
        assert.equal(row.id.includes(row.ownerUserId), false);
        assert.equal(row.id.includes(row.relationshipId), false);
        assert.equal(row.id.includes(row.projectionId), false);
      }
    },
    { peerCore: gateway }
  );
});

test("typed question execution audits and withholds an oversized live result", async () => {
  const gateway = new CalendarQueryGateway({
    records: Array.from({ length: 101 }, (_, index) => ({
      recordId: null,
      fields: {
        start: `2026-07-20T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
        end: `2026-07-20T09:${String(index % 60).padStart(2, "0")}:00.000Z`,
        busyState: "busy"
      }
    }))
  });
  await withPeopleApp(
    async ({ app, ownerUserId }) => {
      const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
      const principals = seedRelationship({
        ownerUserId,
        personId: person.id,
        relationshipId: "relationship_query"
      });
      gateway.evidence = seedCalendarQueryGrant({
        ownerUserId,
        relationshipId: "relationship_query",
        ...principals
      });
      const interpretation = await interpretAvailabilityQuestion(
        app,
        person.id
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/people/${person.id}/questions/execute`,
        payload: {
          interpretationId: interpretation.id,
          interpretationHash: interpretation.hash,
          query: interpretation.query,
          sourcePreference: "live_only"
        }
      });
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().code, "peer_query_unavailable");
      const audit = getDatabase()
        .prepare(
          `SELECT decision, decision_reason AS decisionReason,
                  result_count AS resultCount
           FROM peer_query_audit ORDER BY created_at DESC LIMIT 1`
        )
        .get() as {
        decision: string;
        decisionReason: string;
        resultCount: number;
      };
      assert.equal(audit.decision, "error");
      assert.match(audit.decisionReason, /record authorization ceiling/);
      assert.equal(audit.resultCount, 0);
    },
    { peerCore: gateway }
  );
});

test("typed question execution revalidates decrypted cache payloads before serving them", async () => {
  await withPeopleApp(async ({ app, ownerUserId, secrets }) => {
    const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
    const principals = seedRelationship({
      ownerUserId,
      personId: person.id,
      relationshipId: "relationship_query"
    });
    const evidence = seedCalendarQueryGrant({
      ownerUserId,
      relationshipId: "relationship_query",
      ...principals
    });
    await seedCalendarCache({
      ownerUserId,
      relationshipId: "relationship_query",
      evidence,
      secrets,
      payload: {
        records: [
          {
            recordId: null,
            fields: {
              start: "2026-07-20T08:00:00.000Z",
              end: "2026-07-20T09:00:00.000Z",
              busyState: "busy",
              providerRaw: "must never leave the managed cache"
            }
          }
        ]
      }
    });
    const interpretation = await interpretAvailabilityQuestion(app, person.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/people/${person.id}/questions/execute`,
      payload: {
        interpretationId: interpretation.id,
        interpretationHash: interpretation.hash,
        query: interpretation.query,
        sourcePreference: "cache_only"
      }
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, "peer_query_unavailable");
    const audit = getDatabase()
      .prepare(
        `SELECT decision, decision_reason AS decisionReason, result_count AS resultCount
         FROM peer_query_audit ORDER BY created_at DESC LIMIT 1`
      )
      .get() as {
      decision: string;
      decisionReason: string;
      resultCount: number;
    };
    assert.equal(audit.decision, "error");
    assert.match(audit.decisionReason, /providerRaw|unrecognized key/);
    assert.equal(audit.resultCount, 0);
  });
});

test("typed question execution rejects a result attributed to an unapproved remote device", async () => {
  const gateway = new CalendarQueryGateway(
    {
      records: [
        {
          recordId: null,
          fields: {
            start: "2026-07-20T08:00:00.000Z",
            end: "2026-07-20T09:00:00.000Z",
            busyState: "busy"
          }
        }
      ]
    },
    {
      source: {
        principalId: "relationship_query_remote",
        deviceId: "unapproved_remote_device",
        relationshipId: "relationship_query"
      }
    }
  );
  await withPeopleApp(
    async ({ app, ownerUserId }) => {
      const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
      const principals = seedRelationship({
        ownerUserId,
        personId: person.id,
        relationshipId: "relationship_query"
      });
      gateway.evidence = seedCalendarQueryGrant({
        ownerUserId,
        relationshipId: "relationship_query",
        ...principals
      });
      const interpretation = await interpretAvailabilityQuestion(
        app,
        person.id
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/people/${person.id}/questions/execute`,
        payload: {
          interpretationId: interpretation.id,
          interpretationHash: interpretation.hash,
          query: interpretation.query,
          sourcePreference: "live_only"
        }
      });
      assert.equal(response.statusCode, 503, response.body);
      const audit = getDatabase()
        .prepare(
          `SELECT decision, decision_reason AS decisionReason
           FROM peer_query_audit ORDER BY created_at DESC LIMIT 1`
        )
        .get() as { decision: string; decisionReason: string };
      assert.equal(audit.decision, "error");
      assert.match(audit.decisionReason, /approved remote device/);
    },
    { peerCore: gateway }
  );
});

test("an expired authenticated cache row is returned explicitly as stale", async () => {
  await withPeopleApp(async ({ app, ownerUserId, secrets }) => {
    const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
    const principals = seedRelationship({
      ownerUserId,
      personId: person.id,
      relationshipId: "relationship_query"
    });
    const evidence = seedCalendarQueryGrant({
      ownerUserId,
      relationshipId: "relationship_query",
      ...principals
    });
    await seedCalendarCache({
      ownerUserId,
      relationshipId: "relationship_query",
      evidence,
      secrets,
      validUntil: "2026-07-15T11:59:59.000Z",
      payload: {
        records: [
          {
            recordId: null,
            fields: {
              start: "2026-07-20T08:00:00.000Z",
              end: "2026-07-20T09:00:00.000Z",
              busyState: "busy"
            }
          }
        ]
      }
    });
    const interpretation = await interpretAvailabilityQuestion(app, person.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/people/${person.id}/questions/execute`,
      payload: {
        interpretationId: interpretation.id,
        interpretationHash: interpretation.hash,
        query: interpretation.query,
        sourcePreference: "cache_only"
      }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().result.state, "stale");
    assert.equal(response.json().result.metadata.state, "stale");
    assert.equal(
      response.json().result.metadata.source.deviceId,
      evidence.remoteDeviceId
    );
  });
});

test("cache key loss marks only the managed projection as recoverable and requires resync", async () => {
  await withPeopleApp(async ({ app, ownerUserId, secrets }) => {
    const person = createPerson({ userId: ownerUserId, displayName: "Jon" });
    const principals = seedRelationship({
      ownerUserId,
      personId: person.id,
      relationshipId: "relationship_query"
    });
    const evidence = seedCalendarQueryGrant({
      ownerUserId,
      relationshipId: "relationship_query",
      ...principals
    });
    await seedCalendarCache({
      ownerUserId,
      relationshipId: "relationship_query",
      evidence,
      secrets,
      encryptionKey: new Uint8Array(32).fill(9),
      payload: {
        records: [
          {
            recordId: null,
            fields: {
              start: "2026-07-20T08:00:00.000Z",
              end: "2026-07-20T09:00:00.000Z",
              busyState: "busy"
            }
          }
        ]
      }
    });
    const interpretation = await interpretAvailabilityQuestion(app, person.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/people/${person.id}/questions/execute`,
      payload: {
        interpretationId: interpretation.id,
        interpretationHash: interpretation.hash,
        query: interpretation.query,
        sourcePreference: "cache_only"
      }
    });
    assert.equal(response.statusCode, 503, response.body);
    const row = getDatabase()
      .prepare(
        `SELECT cache_state AS cacheState
         FROM peer_remote_records
         WHERE owner_user_id = ? AND relationship_id = ?`
      )
      .get(ownerUserId, "relationship_query") as { cacheState: string };
    assert.equal(row.cacheState, "key_unavailable");
    const audit = getDatabase()
      .prepare(
        `SELECT decision, decision_reason AS decisionReason
         FROM peer_query_audit ORDER BY created_at DESC LIMIT 1`
      )
      .get() as { decision: string; decisionReason: string };
    assert.equal(audit.decision, "error");
    assert.match(audit.decisionReason, /request a resync/);
  });
});
