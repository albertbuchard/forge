import { describe, expect, it, vi } from "vitest";
import { PEER_API_SCHEMAS } from "../../../../api/src/peer-api-schemas";
import { PEER_ROUTE_CONTRACTS } from "../../../../api/src/peer-route-contract";
import {
  adaptEntityLinkSearchResponse,
  adaptPeopleListResponse,
  adaptPersonContextResponse,
  createHttpPeopleGateway,
  type PeerPresenceAction,
  type PeopleGatewayOptions
} from "@/components/people/people-gateway";
import type {
  PeopleCollectionRequest,
  SavePersonInput,
  ShareGrantDraft
} from "@/components/people/people-types";

const NOW = "2026-07-15T10:30:00.000Z";
const PERSON_UPDATED_AT = "2026-07-14T09:00:00.000Z";
const RELATIONSHIP_UPDATED_AT = "2026-07-14T10:00:00.000Z";
const IDEMPOTENCY_KEY = "people-idempotency-0001";
const PREVIEW_HASH = "a".repeat(64);
const GRANT_HASH = "b".repeat(64);
const TRANSCRIPT_HASH = "c".repeat(64);
const INTERPRETATION_HASH = "d".repeat(64);
const WEBAUTHN_RESPONSE = { credential: "credential_response" };

const serverPerson = {
  id: "person_ada",
  userId: "user_owner",
  displayName: "Ada Lovelace",
  givenName: "Ada",
  middleName: "",
  familyName: "Lovelace",
  preferredName: "Ada",
  pronouns: "she/her",
  relationshipCategory: "friend",
  relationshipLabel: "Research friend",
  closeness: 4,
  importance: 4,
  shortDescription: "Computing pioneer",
  description: "A trusted collaborator.",
  privateNotes: "Keep correspondence private.",
  howWeMet: "At a mathematics salon.",
  metAt: "2025-01-12",
  birthdayYear: 1815,
  birthdayMonth: 12,
  birthdayDay: null,
  birthdayPrecision: "year_month" as const,
  timezone: "Europe/London",
  homePlaceLabel: "London",
  aliases: [{ alias: "Augusta Ada", kind: "name" as const }],
  contacts: [
    {
      id: "contact_ada_email",
      kind: "email" as const,
      label: "Email",
      value: "ada@example.test",
      isPrimary: true,
      deletedAt: null
    }
  ],
  facts: [
    {
      id: "fact_ada_language",
      factType: "language",
      label: "Preferred language",
      value: "English",
      sensitivity: "private" as const,
      sourceKind: "manual" as const,
      reviewedAt: "2026-07-10T10:00:00.000Z",
      deletedAt: null
    }
  ],
  createdAt: "2025-01-01T10:00:00.000Z",
  updatedAt: PERSON_UPDATED_AT,
  deletedAt: null
};

const relationship = {
  id: "relationship_ada",
  localPersonId: serverPerson.id,
  status: "active" as const,
  negotiatedProtocolVersion: "forge-peer/1",
  transportPrivacyMode: "fastest" as const,
  establishedAt: "2026-01-01T10:00:00.000Z",
  lastConnectedAt: "2026-07-15T10:00:00.000Z",
  revokedAt: null,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: RELATIONSHIP_UPDATED_AT,
  remoteDisplayLabel: "Ada's Forge",
  remoteTrustState: "verified"
};

const approvedDevice = {
  relationshipId: relationship.id,
  deviceId: "device_ada_home",
  principalRole: "remote" as const,
  status: "approved" as const,
  label: "Ada Home Forge",
  deviceType: "server",
  lastSeenAt: "2026-07-15T10:00:00.000Z",
  approvedAt: "2026-01-01T10:00:00.000Z",
  removedAt: null,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: RELATIONSHIP_UPDATED_AT
};

const serverGrant = {
  id: "grant_ada_availability",
  ownerUserId: "user_owner",
  relationshipId: relationship.id,
  direction: "local_to_remote" as const,
  sequence: 3,
  previousVersionHash: "e".repeat(64),
  status: "active" as const,
  label: "Availability",
  purpose: "Coordinate calls",
  issuedAt: "2026-07-01T10:00:00.000Z",
  effectiveAt: null,
  expiresAt: "2026-08-01T10:00:00.000Z",
  revokedAt: null,
  cachePolicy: {
    mode: "duration" as const,
    maximumRetentionSeconds: 604_800,
    purgeOnRevocation: true
  },
  rules: [
    {
      id: "rule_availability",
      effect: "allow" as const,
      projectionId: "calendar.availability.v1",
      fields: {
        include: ["startsAt", "endsAt", "state"],
        exclude: [
          "description",
          "participants",
          "linkedEntities",
          "providerRaw"
        ]
      },
      precision: "free_busy",
      approvedDeviceIds: [approvedDevice.deviceId]
    }
  ],
  signatures: [],
  protocolVersion: "forge-peer/1",
  schemaVersion: 1,
  versionHash: GRANT_HASH
};

function contextEnvelope(withRelationship = false) {
  return {
    context: {
      person: serverPerson,
      links: withRelationship
        ? [
            {
              sourceEntityType: "person",
              sourceEntityId: serverPerson.id,
              targetEntityType: "project",
              targetEntityId: "project_analytical_engine",
              anchorKey: null,
              relationship: "collaborator",
              createdAt: "2026-02-01T10:00:00.000Z"
            }
          ]
        : [],
      profilePageLinks: [],
      relationships: withRelationship ? [relationship] : [],
      sharedProjections: withRelationship
        ? [
            {
              projectionId: "calendar.availability.v1",
              projectionVersion: 4,
              asOf: "2026-07-15T08:00:00.000Z",
              receivedAt: "2026-07-15T08:05:00.000Z",
              validUntil: "2026-07-15T09:00:00.000Z",
              completeness: 0.5,
              precision: "free_busy",
              state: "stale",
              relationshipId: relationship.id
            }
          ]
        : [],
      sources: {
        local: true,
        wiki: false,
        shared: withRelationship,
        sharedProjectionCount: 0
      }
    }
  };
}

const devicesEnvelope = {
  devices: [approvedDevice],
  boundedAt: 256,
  truncated: false
};

const grantsEnvelope = {
  grants: [serverGrant],
  page: { limit: 100, hasMore: false, nextCursor: null }
};

const listEnvelope = {
  people: [serverPerson],
  page: { limit: 100, hasMore: false, nextCursor: null }
};

const collectionRequest: PeopleCollectionRequest = {
  query: " Ada ",
  relationship: "friend",
  importance: "high",
  connection: "paired",
  freshness: "any",
  recentContact: "any",
  sort: "recent",
  limit: 100
};

const saveInput: SavePersonInput = {
  displayName: serverPerson.displayName,
  givenName: serverPerson.givenName,
  middleName: null,
  familyName: serverPerson.familyName,
  preferredName: serverPerson.preferredName,
  pronouns: serverPerson.pronouns,
  aliases: ["Augusta Ada"],
  relationshipCategory: "friend",
  relationshipLabel: serverPerson.relationshipLabel,
  closeness: 4,
  importance: "high",
  importanceScore: 4,
  shortDescription: serverPerson.shortDescription,
  description: serverPerson.description,
  privateNotes: serverPerson.privateNotes,
  howWeMet: serverPerson.howWeMet,
  metAt: serverPerson.metAt,
  birthday: {
    year: 1815,
    month: 12,
    day: null,
    precision: "year_month"
  },
  timezone: serverPerson.timezone,
  homePlaceLabel: serverPerson.homePlaceLabel,
  contactMethods: [
    {
      kind: "email",
      label: "Email",
      value: "ada@example.test",
      isPrimary: true
    }
  ],
  facts: [
    {
      label: "Preferred language",
      value: "English",
      sensitivity: "personal",
      sourceLabel: "manual"
    }
  ],
  linkUpdate: { mode: "replace_complete", links: [] }
};

type CapturedRequest = {
  path: string;
  method: string;
  body: unknown;
  credentials: RequestCredentials | undefined;
  headers: Headers;
};

type QueuedValue =
  | unknown
  | ((request: CapturedRequest) => unknown | Promise<unknown>);

function createRequestQueue(...queued: QueuedValue[]) {
  const calls: CapturedRequest[] = [];
  const remaining = [...queued];
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? `${input.pathname}${input.search}`
            : input.url;
      const captured: CapturedRequest = {
        path,
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
        credentials: init?.credentials,
        headers: new Headers(init?.headers)
      };
      calls.push(captured);
      if (remaining.length === 0) {
        throw new Error(
          `Unexpected request: ${captured.method} ${captured.path}`
        );
      }
      const next = remaining.shift();
      const body = typeof next === "function" ? await next(captured) : next;
      if (body instanceof Response) {
        return body;
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );
  return { calls, remaining, request };
}

function createGateway(
  queue: ReturnType<typeof createRequestQueue>,
  overrides: Partial<PeopleGatewayOptions> = {}
) {
  return createHttpPeopleGateway({
    request: queue.request,
    userId: "user_owner",
    peopleRootPageId: "wiki_people_root",
    localDeviceId: "device_local",
    timeZone: "Europe/Zurich",
    includePrivate: false,
    now: () => new Date(NOW),
    idempotencyKey: () => IDEMPOTENCY_KEY,
    performHumanPresence: async () => WEBAUTHN_RESPONSE,
    presenceCeremony: "authenticate",
    ...overrides
  });
}

function presenceOptions(challengeId: string) {
  return {
    challengeId,
    ceremony: "authenticate" as const,
    options: { challenge: `${challengeId}_bytes` }
  };
}

function expectPresenceSequence(
  calls: CapturedRequest[],
  start: number,
  challengeId: string,
  action: PeerPresenceAction,
  finalPath: string
) {
  const contract = PEER_ROUTE_CONTRACTS.find(
    (candidate) =>
      candidate.method === action.method && candidate.path === action.routePath
  );
  expect(
    contract,
    `missing route contract for ${action.routePath}`
  ).toBeDefined();
  const bodyResult = contract
    ? PEER_API_SCHEMAS[contract.operationId].body?.safeParse(action.body)
    : null;
  expect(
    bodyResult?.success,
    bodyResult?.success === false
      ? JSON.stringify(bodyResult.error.issues)
      : `missing body schema for ${action.routePath}`
  ).toBe(true);
  expect(calls[start]).toMatchObject({
    path: "/api/v1/peers/human-presence/options",
    method: "POST",
    credentials: "same-origin",
    body: { ceremony: "authenticate", action }
  });
  expect(calls[start + 1]).toMatchObject({
    path: "/api/v1/peers/human-presence/verify",
    method: "POST",
    credentials: "same-origin",
    body: {
      challengeId,
      action,
      verification: { kind: "webauthn", response: WEBAUTHN_RESPONSE }
    }
  });
  expect(calls[start + 2]).toMatchObject({
    path: finalPath,
    method: action.method,
    body: action.body,
    credentials: "same-origin"
  });
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "request_pairing_ada",
    ownerUserId: "user_owner",
    relationshipId: null,
    kind: "pairing" as const,
    status: "pending" as const,
    version: 7,
    payload: {
      personId: serverPerson.id,
      remoteDisplayLabel: "Ada's Forge",
      deviceLabel: "Ada Home Forge",
      fingerprint: "ADA-FINGERPRINT",
      transcriptHash: TRANSCRIPT_HASH,
      verificationPhrase: "engine river lantern"
    },
    payloadHash: "payload_hash",
    expiresAt: "2026-07-15T10:40:00.000Z",
    decidedAt: null,
    decisionReason: "",
    createdAt: "2026-07-15T10:20:00.000Z",
    updatedAt: "2026-07-15T10:20:00.000Z",
    ...overrides
  };
}

const scannedInvitation = {
  id: "invitation_remote",
  ownerUserId: "user_remote",
  inviterPrincipalId: "principal_remote",
  inviterDeviceId: "device_remote",
  fingerprint: "ABCD-EFGH-JKLM-NPQR",
  expiresAt: "2026-07-15T10:40:00.000Z",
  protocolVersion: "forge-peer/1" as const,
  transportKinds: ["local_direct" as const],
  bootstrap: "A".repeat(32),
  signature: "B".repeat(64)
};

describe("People gateway response adapters", () => {
  it("does not advertise peer operations before runtime discovery", () => {
    const request = vi.fn(async () => new Response("{}"));
    expect(createHttpPeopleGateway({ request }).capabilities).toEqual({
      wikiAssociation: false,
      pairingInvitation: false,
      pairingAcceptance: false
    });
    expect(
      createHttpPeopleGateway({
        request,
        peopleRootPageId: "wiki_people_root",
        localDeviceId: "device_local"
      }).capabilities
    ).toEqual({
      wikiAssociation: true,
      pairingInvitation: false,
      pairingAcceptance: false
    });
  });

  it("maps bounded People records without inventing list-only state", () => {
    const page = adaptPeopleListResponse(listEnvelope, collectionRequest, NOW);

    expect(page).toMatchObject({
      total: null,
      nextCursor: null,
      partial: true,
      connection: { availability: "degraded", checkedAt: NOW }
    });
    expect(page.people).toEqual([
      expect.objectContaining({
        id: serverPerson.id,
        displayName: "Ada Lovelace",
        aliases: ["Augusta Ada"],
        relationshipCategory: "friend",
        importance: "high",
        connectionState: "paired",
        freshnessState: "unavailable",
        lastContactAt: null,
        pendingRequestCount: null
      })
    ]);
  });

  it("treats a successful unfiltered collection as online without a warning", () => {
    const page = adaptPeopleListResponse(
      listEnvelope,
      {
        ...collectionRequest,
        query: "",
        relationship: "any",
        importance: "any",
        connection: "any",
        sort: "name"
      },
      NOW
    );

    expect(page).toMatchObject({
      partial: false,
      connection: {
        availability: "online",
        label: "People are available.",
        checkedAt: NOW
      }
    });
  });

  it("does not treat an unrecorded importance as normal", () => {
    const page = adaptPeopleListResponse(
      {
        ...listEnvelope,
        people: [{ ...serverPerson, importance: null }]
      },
      {
        ...collectionRequest,
        query: "",
        relationship: "any",
        importance: "normal",
        connection: "any",
        sort: "name"
      },
      NOW
    );

    expect(page.people).toEqual([]);
  });

  it("maps realistic context, device, link, and grant read models explicitly", () => {
    const context = adaptPersonContextResponse(contextEnvelope(true), {
      checkedAt: NOW,
      devicesBody: devicesEnvelope,
      grantsBody: grantsEnvelope
    });

    expect(context.person).toMatchObject({
      id: serverPerson.id,
      middleName: null,
      birthday: { year: 1815, month: 12, day: null, precision: "year_month" },
      contactMethods: [expect.objectContaining({ id: "contact_ada_email" })]
    });
    expect(context.peer).toMatchObject({
      id: relationship.id,
      version: RELATIONSHIP_UPDATED_AT,
      status: "paired",
      verificationLabel: null,
      devices: [
        expect.objectContaining({
          id: approvedDevice.deviceId,
          transportLabel: null
        })
      ]
    });
    expect(context.linkedRecords).toEqual([
      expect.objectContaining({
        entityType: "project",
        entityId: "project_analytical_engine",
        direction: "outgoing",
        anchorKey: null,
        title: null,
        href: null
      })
    ]);
    expect(context.outgoingShares).toEqual([
      expect.objectContaining({
        grantId: serverGrant.id,
        state: "active",
        versionHash: GRANT_HASH,
        recipientDeviceIds: [approvedDevice.deviceId]
      })
    ]);
    expect(context.incomingValues).toEqual([
      {
        id: `${relationship.id}:calendar.availability.v1:4`,
        label: "calendar.availability.v1",
        value: null,
        sourcePrincipalId: null,
        sourceLabel: null,
        sourceDeviceLabel: null,
        asOf: "2026-07-15T08:00:00.000Z",
        receivedAt: "2026-07-15T08:05:00.000Z",
        validUntil: "2026-07-15T09:00:00.000Z",
        freshness: "stale",
        precision: "free_busy",
        completeness: "partial",
        redactions: null
      }
    ]);
    expect(context.wikiProfile).toBeNull();
  });

  it("collapses grant history to the newest version even when sequence 2 precedes 1", () => {
    const olderHash = "1".repeat(64);
    const newerHash = "2".repeat(64);
    const context = adaptPersonContextResponse(contextEnvelope(true), {
      checkedAt: NOW,
      devicesBody: devicesEnvelope,
      grantsBody: {
        grants: [
          {
            ...serverGrant,
            sequence: 2,
            issuedAt: "2026-07-02T10:00:00.000Z",
            versionHash: newerHash
          },
          {
            ...serverGrant,
            sequence: 1,
            issuedAt: "2026-07-01T10:00:00.000Z",
            versionHash: olderHash
          }
        ],
        page: { limit: 100, hasMore: false, nextCursor: null }
      }
    });

    expect(context.outgoingShares).toEqual([
      expect.objectContaining({
        grantId: serverGrant.id,
        grantVersion: 2,
        versionHash: newerHash,
        versionKey: `${serverGrant.id}:2:${newerHash}`
      })
    ]);
  });

  it("marks metadata-only and unavailable context without inventing values or routes", () => {
    const body = {
      context: {
        ...contextEnvelope(true).context,
        profilePageLinks: [
          {
            sourceEntityType: "person",
            sourceEntityId: serverPerson.id,
            targetEntityType: "note",
            targetEntityId: "wiki_ada_profile",
            anchorKey: null,
            relationship: "profile_page",
            createdAt: "2026-07-10T08:00:00.000Z"
          }
        ]
      }
    };
    const context = adaptPersonContextResponse(body, { checkedAt: NOW });

    expect(context.wikiProfile).toEqual({
      pageId: "wiki_ada_profile",
      title: null,
      spaceLabel: null,
      excerpt: null,
      href: null,
      associatedAt: "2026-07-10T08:00:00.000Z",
      completeness: "metadata_only"
    });
    expect(context.coverage).toMatchObject({
      wikiProfile: "metadata_only",
      upcomingTogether: "unavailable",
      audit: "unavailable",
      sharedValues: "metadata_only",
      peerDevices: "unavailable",
      grants: "unavailable"
    });
    expect(context.partial).toBe(true);
    expect(context.connection.label).toBe(
      "Saved details remain available. Forge could not load upcoming events, audit history, Wiki page details, shared details, paired devices, or sharing permissions."
    );
  });

  it("maps bounded entity search records and excludes deleted, duplicate, and self matches", () => {
    const candidates = adaptEntityLinkSearchResponse(
      {
        results: [
          {
            ok: true,
            clientRef: "people-entity-links",
            matches: [
              {
                deleted: false,
                entityType: "project",
                id: "project_engine",
                entity: {
                  title: "Analytical Engine",
                  shortDescription: "Build the first general-purpose engine."
                }
              },
              {
                deleted: false,
                entityType: "project",
                id: "project_engine",
                entity: { title: "Duplicate" }
              },
              {
                deleted: true,
                entityType: "note",
                id: "note_deleted",
                entity: { title: "Deleted note" }
              },
              {
                deleted: false,
                entityType: "person",
                id: serverPerson.id,
                entity: { displayName: serverPerson.displayName }
              }
            ]
          }
        ]
      },
      serverPerson.id
    );

    expect(candidates).toEqual([
      {
        entityType: "project",
        entityId: "project_engine",
        label: "Analytical Engine",
        description: "Build the first general-purpose engine."
      }
    ]);
  });
});

describe("People gateway wire contract", () => {
  it("sends exact People list and context query shapes", async () => {
    const queue = createRequestQueue(listEnvelope, contextEnvelope(false));
    const gateway = createGateway(queue);

    await gateway.listPeople(collectionRequest);
    await gateway.getPersonContext(serverPerson.id);

    expect(queue.calls[0]).toMatchObject({
      path: "/api/v1/people?userId=user_owner&query=Ada&relationshipStatus=active&source=both&sort=updated_at&direction=desc&limit=100",
      method: "GET",
      body: undefined,
      credentials: "same-origin"
    });
    expect(queue.calls[1]).toMatchObject({
      path: "/api/v1/people/person_ada/context?includePrivate=false&includeShared=true&linkLimit=200&projectionLimit=40",
      method: "GET",
      body: undefined,
      credentials: "same-origin"
    });
    expect(queue.remaining).toHaveLength(0);
  });

  it("keeps descending recent order and its cursor on the server across two pages", async () => {
    const secondPerson = {
      ...serverPerson,
      id: "person_grace",
      displayName: "Grace Hopper",
      normalizedDisplayName: "grace hopper",
      updatedAt: "2026-07-13T09:00:00.000Z"
    };
    const queue = createRequestQueue(
      {
        people: [serverPerson],
        page: { limit: 1, hasMore: true, nextCursor: "cursor_recent_2" }
      },
      {
        people: [secondPerson],
        page: { limit: 1, hasMore: false, nextCursor: null }
      }
    );
    const gateway = createGateway(queue);
    const first = await gateway.listPeople({
      ...collectionRequest,
      query: "",
      relationship: "any",
      connection: "any",
      limit: 1
    });
    const second = await gateway.listPeople({
      ...collectionRequest,
      query: "",
      relationship: "any",
      connection: "any",
      cursor: first.nextCursor ?? undefined,
      limit: 1
    });

    expect(first.people.map((person) => person.id)).toEqual([serverPerson.id]);
    expect(second.people.map((person) => person.id)).toEqual([secondPerson.id]);
    expect(queue.calls.map((call) => call.path)).toEqual([
      "/api/v1/people?userId=user_owner&source=both&sort=updated_at&direction=desc&limit=1",
      "/api/v1/people?userId=user_owner&source=both&sort=updated_at&direction=desc&cursor=cursor_recent_2&limit=1"
    ]);
  });

  it("resolves the server default user and searches the general entity graph exactly", async () => {
    const queue = createRequestQueue(
      {
        users: [
          { id: "user_human", kind: "human" },
          { id: "user_operator", kind: "human" },
          { id: "user_bot", kind: "bot" }
        ]
      },
      {
        results: [
          {
            ok: true,
            clientRef: "people-entity-links",
            matches: [
              {
                deleted: false,
                entityType: "goal",
                id: "goal_engine",
                entity: { title: "Ship the Analytical Engine" }
              }
            ]
          }
        ]
      }
    );
    const gateway = createGateway(queue, { userId: undefined });

    await expect(
      gateway.searchLinkableEntities({
        query: "  Engine  ",
        excludePersonId: serverPerson.id,
        limit: 25
      })
    ).resolves.toEqual([
      {
        entityType: "goal",
        entityId: "goal_engine",
        label: "Ship the Analytical Engine",
        description: null
      }
    ]);
    expect(queue.calls).toEqual([
      expect.objectContaining({
        path: "/api/v1/users",
        method: "GET",
        body: undefined,
        credentials: "same-origin"
      }),
      expect.objectContaining({
        path: "/api/v1/entities/search",
        method: "POST",
        body: {
          searches: [
            {
              query: "Engine",
              userIds: ["user_operator"],
              includeDeleted: false,
              limit: 25,
              clientRef: "people-entity-links"
            }
          ]
        },
        credentials: "same-origin"
      })
    ]);
  });

  it("discovers the production Wiki root and local peer device before exposing capabilities", async () => {
    const calls: string[] = [];
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      calls.push(path);
      const body =
        path === "/api/v1/peers/human-presence"
          ? {
              methods: {
                webauthn: {
                  available: true,
                  firstCredentialBootstrapAllowed: false
                }
              },
              credentials: [{}],
              peerCore: {
                enabled: true,
                healthy: true,
                localDeviceId: "device_discovered"
              }
            }
          : path.startsWith("/api/v1/wiki/pages?")
            ? {
                pages: [
                  {
                    id: "wiki_people_discovered",
                    title: "People",
                    slug: "people",
                    parentSlug: null
                  }
                ],
                limit: 500,
                offset: 0,
                hasMore: false,
                nextOffset: null
              }
            : path.startsWith(`/api/v1/people/${serverPerson.id}/context?`)
              ? contextEnvelope(false)
              : null;
      return new Response(JSON.stringify(body), {
        status: body ? 200 : 404,
        headers: { "content-type": "application/json" }
      });
    });
    const gateway = createHttpPeopleGateway({
      request,
      userId: "user_owner",
      now: () => new Date(NOW),
      presenceCeremony: "authenticate",
      performHumanPresence: async () => WEBAUTHN_RESPONSE
    });

    expect(gateway.capabilities).toEqual({
      wikiAssociation: false,
      pairingInvitation: false,
      pairingAcceptance: false
    });
    await gateway.getPersonContext(serverPerson.id);
    expect(gateway.capabilities).toEqual({
      wikiAssociation: true,
      pairingInvitation: true,
      pairingAcceptance: true
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        "/api/v1/peers/human-presence",
        "/api/v1/wiki/pages?kind=wiki&limit=500&offset=0"
      ])
    );
  });

  it("keeps pairing unavailable when the discovered peer runtime is unhealthy", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      const body =
        path === "/api/v1/peers/human-presence"
          ? {
              methods: {
                webauthn: {
                  available: true,
                  firstCredentialBootstrapAllowed: false
                }
              },
              credentials: [{}],
              peerCore: {
                enabled: true,
                healthy: false,
                localDeviceId: "device_unhealthy"
              }
            }
          : path.startsWith("/api/v1/wiki/pages?")
            ? {
                pages: [],
                limit: 500,
                offset: 0,
                hasMore: false,
                nextOffset: null
              }
            : path.startsWith(`/api/v1/people/${serverPerson.id}/context?`)
              ? contextEnvelope(false)
              : null;
      return new Response(JSON.stringify(body), {
        status: body ? 200 : 404,
        headers: { "content-type": "application/json" }
      });
    });
    const gateway = createHttpPeopleGateway({
      request,
      userId: "user_owner",
      now: () => new Date(NOW)
    });

    await gateway.getPersonContext(serverPerson.id);

    expect(gateway.capabilities).toEqual({
      wikiAssociation: false,
      pairingInvitation: false,
      pairingAcceptance: false
    });
  });

  it("sends exact create/update batches and rejects operation failures at HTTP 200", async () => {
    const createQueue = createRequestQueue({
      results: [
        {
          ok: false,
          entityType: "person",
          error: { code: "person_duplicate", message: "Person already exists." }
        }
      ]
    });
    const createPersonGateway = createGateway(createQueue);

    await expect(
      createPersonGateway.savePerson(saveInput)
    ).rejects.toMatchObject({
      code: "person_duplicate",
      status: 200
    });
    expect(createQueue.calls[0]).toEqual(
      expect.objectContaining({
        path: "/api/v1/entities/create",
        method: "POST",
        body: {
          atomic: true,
          operations: [
            {
              entityType: "person",
              data: {
                userId: "user_owner",
                displayName: "Ada Lovelace",
                givenName: "Ada",
                middleName: "",
                familyName: "Lovelace",
                preferredName: "Ada",
                pronouns: "she/her",
                relationshipCategory: "friend",
                relationshipLabel: "Research friend",
                closeness: 4,
                importance: 4,
                shortDescription: "Computing pioneer",
                description: "A trusted collaborator.",
                privateNotes: "Keep correspondence private.",
                howWeMet: "At a mathematics salon.",
                metAt: "2025-01-12",
                birthdayYear: 1815,
                birthdayMonth: 12,
                birthdayDay: null,
                birthdayPrecision: "year_month",
                timezone: "Europe/London",
                homePlaceLabel: "London",
                aliases: [{ alias: "Augusta Ada", kind: "name" }],
                contacts: [
                  {
                    kind: "email",
                    label: "Email",
                    value: "ada@example.test",
                    isPrimary: true
                  }
                ],
                facts: [
                  {
                    factType: "Preferred language",
                    label: "Preferred language",
                    value: "English",
                    sensitivity: "private",
                    sourceKind: "manual"
                  }
                ],
                links: []
              }
            }
          ]
        }
      })
    );

    const updateQueue = createRequestQueue(contextEnvelope(false), {
      results: [
        {
          ok: false,
          entityType: "person",
          id: serverPerson.id,
          error: { code: "person_conflict", message: "Person changed." }
        }
      ]
    });
    const updateGateway = createGateway(updateQueue);
    await updateGateway.getPersonContext(serverPerson.id);
    await expect(
      updateGateway.savePerson({
        ...saveInput,
        id: serverPerson.id,
        linkUpdate: { mode: "unchanged" }
      })
    ).rejects.toMatchObject({ code: "person_conflict", status: 200 });
    expect(updateQueue.calls[1]).toMatchObject({
      path: "/api/v1/entities/update",
      method: "POST",
      body: {
        atomic: true,
        operations: [
          {
            entityType: "person",
            id: serverPerson.id,
            patch: expect.objectContaining({
              displayName: "Ada Lovelace",
              birthdayPrecision: "year_month",
              expectedUpdatedAt: PERSON_UPDATED_AT
            })
          }
        ]
      }
    });
    expect(
      (updateQueue.calls[1].body as { operations: Array<{ patch: unknown }> })
        .operations[0]?.patch
    ).not.toHaveProperty("aliases");
    expect(
      (updateQueue.calls[1].body as { operations: Array<{ patch: unknown }> })
        .operations[0]?.patch
    ).not.toHaveProperty("links");
  });

  it("preserves unseen links on scalar edits and replaces only a complete 101-link outgoing set", async () => {
    const mixedLinks = Array.from({ length: 101 }, (_, index) =>
      index < 61
        ? {
            sourceEntityType: "person",
            sourceEntityId: serverPerson.id,
            targetEntityType: index % 2 === 0 ? "project" : "note",
            targetEntityId: `outgoing_${index}`,
            anchorKey: null,
            relationship: "related_to",
            createdAt: "2026-07-01T10:00:00.000Z"
          }
        : {
            sourceEntityType: "goal",
            sourceEntityId: `incoming_${index}`,
            targetEntityType: "person",
            targetEntityId: serverPerson.id,
            anchorKey: null,
            relationship: "mentions",
            createdAt: "2026-07-01T10:00:00.000Z"
          }
    );
    const captureFailure = {
      results: [
        {
          ok: false,
          entityType: "person",
          id: serverPerson.id,
          error: { code: "test_stop", message: "Captured update." }
        }
      ]
    };
    const queue = createRequestQueue(
      {
        context: { ...contextEnvelope(false).context, links: mixedLinks }
      },
      captureFailure,
      captureFailure
    );
    const gateway = createGateway(queue);
    const context = await gateway.getPersonContext(serverPerson.id);
    expect(context.coverage.linkedRecords).toBe("complete");
    expect(context.linkedRecords).toHaveLength(101);

    await expect(
      gateway.savePerson({
        ...saveInput,
        id: serverPerson.id,
        linkUpdate: { mode: "unchanged" }
      })
    ).rejects.toMatchObject({ code: "test_stop" });
    const scalarPatch = (
      queue.calls[1].body as {
        operations: Array<{ patch: Record<string, unknown> }>;
      }
    ).operations[0]!.patch;
    expect(scalarPatch).not.toHaveProperty("links");

    const completeOutgoingLinks = context.linkedRecords
      .filter((link) => link.direction === "outgoing")
      .map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        anchorKey: link.anchorKey,
        relationship: link.relationship
      }));
    await expect(
      gateway.savePerson({
        ...saveInput,
        id: serverPerson.id,
        linkUpdate: {
          mode: "replace_complete",
          links: completeOutgoingLinks
        }
      })
    ).rejects.toMatchObject({ code: "test_stop" });
    const linkPatch = (
      queue.calls[2].body as {
        operations: Array<{ patch: { links: unknown[] } }>;
      }
    ).operations[0]!.patch;
    expect(linkPatch.links).toEqual(completeOutgoingLinks);
    expect(linkPatch.links).toHaveLength(61);
    expect(JSON.stringify(linkPatch.links)).not.toContain("incoming_");
  });

  it("preserves a non-category importance score during unrelated edits", async () => {
    const contextBody = {
      context: {
        ...contextEnvelope(false).context,
        person: { ...serverPerson, importance: 2 }
      }
    };
    const queue = createRequestQueue(contextBody, {
      results: [
        {
          ok: false,
          entityType: "person",
          id: serverPerson.id,
          error: { code: "test_stop", message: "Captured update." }
        }
      ]
    });
    const gateway = createGateway(queue);
    const context = await gateway.getPersonContext(serverPerson.id);
    expect(context.person).toMatchObject({
      importance: "normal",
      importanceScore: 2
    });

    await expect(
      gateway.savePerson({
        ...saveInput,
        id: serverPerson.id,
        importance: "normal",
        importanceScore: 2,
        shortDescription: "Updated description",
        linkUpdate: { mode: "unchanged" }
      })
    ).rejects.toMatchObject({ code: "test_stop" });
    expect(queue.calls[1]).toMatchObject({
      path: "/api/v1/entities/update",
      body: {
        operations: [
          {
            patch: expect.objectContaining({
              importance: 2,
              shortDescription: "Updated description"
            })
          }
        ]
      }
    });
  });

  it("uses the exact Wiki scan, preview, and apply workflow", async () => {
    const candidate = {
      noteId: "wiki_ada",
      rootNoteId: "wiki_people_root",
      spaceId: "space_people",
      title: "Ada Lovelace",
      slug: "ada-lovelace",
      parentSlug: "people",
      aliases: ["Ada"],
      summary: "Computing pioneer",
      updatedAt: "2026-07-13T08:00:00.000Z",
      matchingPersonIds: [serverPerson.id],
      associatedPersonIds: [],
      duplicateCandidateNoteIds: [],
      status: "single_match" as const
    };
    const scanEnvelope = {
      candidates: [candidate],
      root: {
        id: "wiki_people_root",
        slug: "people",
        spaceId: "space_people",
        updatedAt: "2026-07-13T07:00:00.000Z"
      },
      page: { limit: 100, hasMore: false, nextCursor: null },
      scan: { rootCount: 1, scannedCount: 1, truncated: false }
    };
    const queue = createRequestQueue(
      contextEnvelope(false),
      scanEnvelope,
      {
        preview: {
          id: "wiki_preview_1",
          hash: PREVIEW_HASH,
          expiresAt: "2026-07-15T10:35:00.000Z",
          effects: [],
          mutationCount: 1
        }
      },
      {
        previewId: "wiki_preview_1",
        replayed: false,
        results: [
          {
            candidateNoteId: candidate.noteId,
            action: "associate",
            status: "associated",
            personId: serverPerson.id,
            linkCreated: true
          }
        ]
      },
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);
    await gateway.getPersonContext(serverPerson.id);
    await gateway.scanWikiCandidates(serverPerson.id);
    await gateway.applyWikiAssociation({
      personId: serverPerson.id,
      pageId: candidate.noteId,
      decision: "associate"
    });

    expect(queue.calls[1]).toMatchObject({
      path: "/api/v1/people/wiki-candidates/scan",
      method: "POST",
      body: {
        userId: "user_owner",
        peopleRootPageId: "wiki_people_root",
        query: "Ada Lovelace",
        limit: 100
      }
    });
    const decisions = [
      {
        wikiPageId: candidate.noteId,
        action: "associate",
        personId: serverPerson.id,
        expectedWikiVersion: candidate.updatedAt,
        expectedPersonVersion: PERSON_UPDATED_AT
      }
    ];
    expect(queue.calls[2]).toMatchObject({
      path: "/api/v1/people/wiki-associations/preview",
      method: "POST",
      body: {
        userId: "user_owner",
        peopleRootPageId: "wiki_people_root",
        decisions
      }
    });
    expect(queue.calls[3]).toMatchObject({
      path: "/api/v1/people/wiki-associations/apply",
      method: "POST",
      body: {
        userId: "user_owner",
        peopleRootPageId: "wiki_people_root",
        previewId: "wiki_preview_1",
        previewHash: PREVIEW_HASH,
        idempotencyKey: IDEMPOTENCY_KEY,
        decisions
      }
    });
  });

  it("binds request decisions to the reviewed version and exact presence action", async () => {
    const request = pendingRequest();
    const queue = createRequestQueue(
      {
        requests: [request],
        page: { limit: 100, hasMore: false, nextCursor: null }
      },
      presenceOptions("challenge_request"),
      { approved: true },
      { request: { ...request, status: "accepted", version: 8 } }
    );
    const gateway = createGateway(queue);
    const mapped = await gateway.listPendingRequests({ limit: 100 });
    expect(mapped.requests[0]).toMatchObject({
      id: request.id,
      version: "7",
      direction: "incoming",
      identityFingerprint: "ADA-FINGERPRINT",
      verificationPhrase: "engine river lantern"
    });
    await gateway.reviewRequest({
      requestId: request.id,
      decision: "accept",
      recentAuthenticationConfirmed: true
    });

    const action: PeerPresenceAction = {
      ownerUserId: "user_owner",
      method: "POST",
      routePath: "/api/v1/peers/requests/:requestId/accept",
      pathParams: { requestId: request.id },
      expectedVersion: "7",
      body: { expectedVersion: "7", reason: "" }
    };
    expectPresenceSequence(
      queue.calls,
      1,
      "challenge_request",
      action,
      `/api/v1/peers/requests/${request.id}/accept`
    );
  });

  it("traverses pending request cursors without replacing the first-page review cache", async () => {
    const firstRequest = pendingRequest({ id: "request_page_1", version: 4 });
    const secondRequest = pendingRequest({ id: "request_page_2", version: 9 });
    const queue = createRequestQueue(
      {
        requests: [firstRequest],
        page: { limit: 1, hasMore: true, nextCursor: "requests_cursor_2" }
      },
      {
        requests: [secondRequest],
        page: { limit: 1, hasMore: false, nextCursor: null }
      },
      presenceOptions("challenge_second_page"),
      { approved: true },
      { request: { ...secondRequest, status: "rejected", version: 10 } }
    );
    const gateway = createGateway(queue);
    const firstPage = await gateway.listPendingRequests({ limit: 1 });
    const secondPage = await gateway.listPendingRequests({
      cursor: firstPage.nextCursor ?? undefined,
      limit: 1
    });
    expect(firstPage).toMatchObject({
      nextCursor: "requests_cursor_2",
      partial: true
    });
    expect(secondPage.requests[0]).toMatchObject({
      id: secondRequest.id,
      version: "9"
    });

    await gateway.reviewRequest({
      requestId: secondRequest.id,
      decision: "reject",
      recentAuthenticationConfirmed: false
    });
    expect(queue.calls[1].path).toBe(
      "/api/v1/peers/requests?status=pending&limit=1&cursor=requests_cursor_2"
    );
    expectPresenceSequence(
      queue.calls,
      2,
      "challenge_second_page",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/requests/:requestId/reject",
        pathParams: { requestId: secondRequest.id },
        expectedVersion: "9",
        body: { expectedVersion: "9", reason: "" }
      },
      `/api/v1/peers/requests/${secondRequest.id}/reject`
    );
  });

  it("bootstraps fresh-install human presence through the advertised WebAuthn registration ceremony", async () => {
    const request = pendingRequest();
    const performHumanPresence = vi.fn(async () => WEBAUTHN_RESPONSE);
    const action: PeerPresenceAction = {
      ownerUserId: "user_owner",
      method: "POST",
      routePath: "/api/v1/peers/requests/:requestId/accept",
      pathParams: { requestId: request.id },
      expectedVersion: "7",
      body: { expectedVersion: "7", reason: "" }
    };
    const queue = createRequestQueue(
      {
        requests: [request],
        page: { limit: 100, hasMore: false, nextCursor: null }
      },
      {
        methods: {
          webauthn: {
            available: true,
            firstCredentialBootstrapAllowed: true
          }
        },
        credentials: [],
        peerCore: {
          enabled: true,
          healthy: true,
          localDeviceId: "device_local"
        }
      },
      {
        challengeId: "challenge_register",
        ceremony: "register",
        options: { challenge: "AQ" }
      },
      { approved: true },
      { request: { ...request, status: "accepted", version: 8 } }
    );
    const gateway = createGateway(queue, {
      presenceCeremony: undefined,
      performHumanPresence
    });
    await gateway.listPendingRequests({ limit: 100 });
    await gateway.reviewRequest({
      requestId: request.id,
      decision: "accept",
      recentAuthenticationConfirmed: true
    });

    expect(performHumanPresence).toHaveBeenCalledWith({
      ceremony: "register",
      options: { challenge: "AQ" }
    });
    expect(queue.calls[2]).toMatchObject({
      path: "/api/v1/peers/human-presence/options",
      method: "POST",
      body: {
        ceremony: "register",
        credentialLabel: "People approval credential",
        action
      }
    });
    expect(queue.calls[3]).toMatchObject({
      path: "/api/v1/peers/human-presence/verify",
      method: "POST",
      body: {
        challengeId: "challenge_register",
        action,
        verification: {
          kind: "webauthn",
          response: WEBAUTHN_RESPONSE
        }
      }
    });
    expect(queue.calls[4]).toMatchObject({
      path: `/api/v1/peers/requests/${request.id}/accept`,
      method: "POST",
      body: action.body
    });
  });

  it("never substitutes a browser assertion when WebAuthn is unavailable", async () => {
    const request = pendingRequest();
    const queue = createRequestQueue(
      {
        requests: [request],
        page: { limit: 100, hasMore: false, nextCursor: null }
      },
      {
        methods: {
          webauthn: {
            available: true,
            firstCredentialBootstrapAllowed: true
          }
        },
        credentials: [],
        peerCore: {
          enabled: true,
          healthy: true,
          localDeviceId: "device_local"
        }
      },
      {
        challengeId: "challenge_register_no_browser",
        ceremony: "register",
        options: { challenge: "AQ" }
      }
    );
    const gateway = createGateway(queue, {
      presenceCeremony: undefined,
      performHumanPresence: undefined
    });
    await gateway.listPendingRequests({ limit: 100 });

    await expect(
      gateway.reviewRequest({
        requestId: request.id,
        decision: "accept",
        recentAuthenticationConfirmed: true
      })
    ).rejects.toMatchObject({ code: "peer_presence_browser_unsupported" });
    expect(queue.calls).toHaveLength(3);
    expect(
      queue.calls.some(
        (call) =>
          call.path === "/api/v1/peers/human-presence/verify" ||
          call.path.endsWith(`/${request.id}/accept`)
      )
    ).toBe(false);
  });

  it("uses exact invitation, pairing acceptance, and confirmation contracts", async () => {
    const createdInvitation = {
      ...scannedInvitation,
      id: "invitation_local",
      ownerUserId: "user_owner",
      inviterPrincipalId: "principal_local",
      inviterDeviceId: "device_local",
      fingerprint: "QRST-UVWX-YZ23-4567"
    };
    const acceptedRequest = pendingRequest();
    const queue = createRequestQueue(
      presenceOptions("challenge_invite"),
      { approved: true },
      { invitation: createdInvitation },
      {
        invitation: {
          id: createdInvitation.id,
          status: "active",
          fingerprint: createdInvitation.fingerprint,
          expiresAt: createdInvitation.expiresAt,
          updatedAt: "2026-07-15T10:30:01.000Z"
        }
      },
      presenceOptions("challenge_accept"),
      { approved: true },
      { request: acceptedRequest },
      presenceOptions("challenge_confirm"),
      { approved: true },
      { relationshipId: relationship.id, request: acceptedRequest },
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);

    const invitation = await gateway.createPairingInvitation({
      personId: serverPerson.id,
      label: "Ada Lovelace",
      expiresInMinutes: 10
    });
    expect(JSON.parse(invitation.qrPayload!)).toEqual(createdInvitation);
    expect(invitation.verificationPhrase).toBeNull();
    expect(invitation).toMatchObject({
      expectedVersion: "2026-07-15T10:30:01.000Z",
      status: "active"
    });
    const invitationBody = {
      label: "Ada Lovelace",
      expiresInSeconds: 600,
      privacyMode: "fastest",
      transportKinds: ["local_direct"],
      idempotencyKey: IDEMPOTENCY_KEY
    };
    expectPresenceSequence(
      queue.calls,
      0,
      "challenge_invite",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/invitations",
        pathParams: {},
        expectedVersion: null,
        body: invitationBody
      },
      "/api/v1/peers/invitations"
    );

    const review = await gateway.inspectPairingPayload({
      personId: serverPerson.id,
      qrPayload: JSON.stringify(scannedInvitation)
    });
    expect(review).toMatchObject({
      pairingId: acceptedRequest.id,
      expectedVersion: "7",
      transcriptHash: TRANSCRIPT_HASH,
      verificationPhrase: "engine river lantern"
    });
    const acceptBody = {
      invitation: scannedInvitation,
      scannedAt: NOW,
      localDeviceId: "device_local",
      privacyMode: "fastest",
      idempotencyKey: IDEMPOTENCY_KEY
    };
    expectPresenceSequence(
      queue.calls,
      4,
      "challenge_accept",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/pairings/accept",
        pathParams: {},
        expectedVersion: null,
        body: acceptBody
      },
      "/api/v1/peers/pairings/accept"
    );

    await gateway.confirmPairing({
      pairingId: acceptedRequest.id,
      personId: serverPerson.id,
      identityConfirmed: true
    });
    const confirmBody = {
      expectedVersion: "7",
      transcriptHash: TRANSCRIPT_HASH,
      verificationPhrase: "engine river lantern",
      personId: serverPerson.id,
      createPersonDisplayName: null,
      idempotencyKey: IDEMPOTENCY_KEY
    };
    expectPresenceSequence(
      queue.calls,
      7,
      "challenge_confirm",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/pairings/:pairingId/confirm",
        pathParams: { pairingId: acceptedRequest.id },
        expectedVersion: "7",
        body: confirmBody
      },
      `/api/v1/peers/pairings/${acceptedRequest.id}/confirm`
    );
  });

  it("cancels only the reviewed active invitation version with bound human presence", async () => {
    const createdInvitation = {
      ...scannedInvitation,
      id: "invitation_cancel",
      ownerUserId: "user_owner",
      inviterPrincipalId: "principal_local",
      inviterDeviceId: "device_local",
      fingerprint: "QRST-UVWX-YZ23-4567"
    };
    const invitationVersion = "2026-07-15T10:30:01.000Z";
    const queue = createRequestQueue(
      presenceOptions("challenge_invite_cancel_setup"),
      { approved: true },
      { invitation: createdInvitation },
      {
        invitation: {
          id: createdInvitation.id,
          status: "active",
          fingerprint: createdInvitation.fingerprint,
          expiresAt: createdInvitation.expiresAt,
          updatedAt: invitationVersion
        }
      },
      presenceOptions("challenge_invite_cancel"),
      { approved: true },
      { canceled: true, invitationId: createdInvitation.id }
    );
    const gateway = createGateway(queue);
    const invitation = await gateway.createPairingInvitation({
      personId: serverPerson.id,
      label: serverPerson.displayName,
      expiresInMinutes: 10
    });
    await gateway.cancelPairingInvitation({
      invitationId: invitation.id,
      expectedVersion: invitation.expectedVersion
    });

    const cancelBody = { expectedVersion: invitationVersion };
    expectPresenceSequence(
      queue.calls,
      4,
      "challenge_invite_cancel",
      {
        ownerUserId: "user_owner",
        method: "DELETE",
        routePath: "/api/v1/peers/invitations/:invitationId",
        pathParams: { invitationId: createdInvitation.id },
        expectedVersion: invitationVersion,
        body: cancelBody
      },
      `/api/v1/peers/invitations/${createdInvitation.id}`
    );
  });

  it("maps a real selected entity type and binds propose to the exact preview", async () => {
    const draft: ShareGrantDraft = {
      personId: serverPerson.id,
      relationshipId: relationship.id,
      direction: "outgoing",
      preset: "selected_records",
      purpose: "Share the reviewed project summary",
      projections: ["custom.selected_entities.v1"],
      fields: ["title", "summary"],
      selectedRecordIds: ["project_analytical_engine"],
      exclusions: [
        "secret",
        "token",
        "password",
        "artifactBytes",
        "rawHealthSamples",
        "privatePsyche"
      ],
      precision: "selected",
      horizonDays: 30,
      expiresAt: "2026-08-01",
      retentionDays: 7,
      recipientDeviceIds: [approvedDevice.deviceId]
    };
    let previewWireDraft: Record<string, unknown> | null = null;
    const queue = createRequestQueue(
      contextEnvelope(true),
      devicesEnvelope,
      grantsEnvelope,
      (call: CapturedRequest) => {
        const body = call.body as { draft: Record<string, unknown> };
        previewWireDraft = body.draft;
        const rules = body.draft.rules as Array<Record<string, unknown>>;
        return {
          preview: {
            hash: PREVIEW_HASH,
            relationshipVersion: RELATIONSHIP_UPDATED_AT,
            exact: {
              direction: "local_to_remote",
              rules,
              cachePolicy: body.draft.cachePolicy,
              effectiveAt: null,
              expiresAt: body.draft.expiresAt
            },
            worstCase: {
              projectionIds: ["custom.selected_entities.v1"],
              maximumResultCount: 100,
              maximumPayloadBytes: 524_288,
              maximumRetentionSeconds: 604_800,
              allShareableRuleCount: 0,
              currentApprovedDeviceCount: 1
            },
            samples: rules.map((rule) => ({
              ruleId: rule.id,
              projectionId: rule.projectionId,
              fields: (rule.fields as { include: string[] }).include,
              excludedFields: (rule.fields as { exclude: string[] }).exclude,
              precision: rule.precision,
              entitySelector: rule.entitySelector,
              time: rule.time
            }))
          }
        };
      },
      presenceOptions("challenge_propose"),
      { approved: true },
      { grant: serverGrant, versionHash: GRANT_HASH },
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);
    await gateway.getPersonContext(serverPerson.id);
    const preview = await gateway.previewShareGrant(draft);
    expect(preview).toMatchObject({
      draftHash: PREVIEW_HASH,
      recipientDeviceIds: [approvedDevice.deviceId]
    });

    const expectedWireDraft = {
      direction: "local_to_remote",
      label: "selected records share",
      purpose: "Share the reviewed project summary",
      effectiveAt: null,
      expiresAt: "2026-08-01T23:59:59.999Z",
      cachePolicy: {
        mode: "duration",
        maximumRetentionSeconds: 604_800,
        purgeOnRevocation: true
      },
      rules: [
        {
          id: "people-rule-1-1",
          effect: "allow",
          projectionId: "custom.selected_entities.v1",
          entitySelector: {
            mode: "selected",
            entityType: "project",
            entityIds: ["project_analytical_engine"]
          },
          fields: {
            include: ["title", "summary"],
            exclude: [
              "secret",
              "token",
              "password",
              "artifactBytes",
              "rawHealthSamples",
              "privatePsyche"
            ]
          },
          time: {
            startsAt: null,
            endsAt: null,
            rollingPastDays: null,
            rollingFutureDays: null
          },
          precision: "selected",
          aggregation: null,
          approvedDeviceIds: [approvedDevice.deviceId],
          devicePolicy: "explicit",
          maximumResultCount: 100,
          maximumPayloadBytes: 524_288
        }
      ]
    };
    expect(queue.calls[3]).toMatchObject({
      path: `/api/v1/peers/relationships/${relationship.id}/grants/preview`,
      method: "POST",
      body: {
        draft: expectedWireDraft,
        sampleLimit: 25,
        includeWorstCase: true
      }
    });
    expect(previewWireDraft).toEqual(expectedWireDraft);

    await gateway.proposeShareGrant({ draft, previewHash: PREVIEW_HASH });
    const proposeBody = {
      expectedRelationshipVersion: RELATIONSHIP_UPDATED_AT,
      previewHash: PREVIEW_HASH,
      idempotencyKey: IDEMPOTENCY_KEY,
      draft: expectedWireDraft
    };
    expectPresenceSequence(
      queue.calls,
      4,
      "challenge_propose",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/relationships/:relationshipId/grants/propose",
        pathParams: { relationshipId: relationship.id },
        expectedVersion: RELATIONSHIP_UPDATED_AT,
        body: proposeBody
      },
      `/api/v1/peers/relationships/${relationship.id}/grants/propose`
    );
  });

  it("honors broad-share field narrowing and exclusions identically in preview and propose", async () => {
    const draft: ShareGrantDraft = {
      personId: serverPerson.id,
      relationshipId: relationship.id,
      direction: "outgoing",
      preset: "broad",
      purpose: "Share a deliberately narrowed overview",
      projections: [
        "calendar.availability.v1",
        "goals.horizon_summary.v1",
        "person.profile.v1"
      ],
      fields: ["startsAt", "title", "status", "displayName", "timezone"],
      selectedRecordIds: [],
      exclusions: ["title", "pronouns", "privateNotes"],
      precision: "projection_defaults",
      horizonDays: 14,
      expiresAt: null,
      retentionDays: 1,
      recipientDeviceIds: [approvedDevice.deviceId]
    };
    const previewDrafts: Record<string, unknown>[] = [];
    const queue = createRequestQueue(
      contextEnvelope(true),
      devicesEnvelope,
      grantsEnvelope,
      (call: CapturedRequest) => {
        const body = call.body as { draft: Record<string, unknown> };
        previewDrafts.push(body.draft);
        const rules = body.draft.rules as Array<Record<string, unknown>>;
        return {
          preview: {
            hash: PREVIEW_HASH,
            relationshipVersion: RELATIONSHIP_UPDATED_AT,
            exact: {
              direction: "local_to_remote",
              rules,
              cachePolicy: body.draft.cachePolicy,
              effectiveAt: null,
              expiresAt: null
            },
            worstCase: {
              projectionIds: draft.projections,
              maximumResultCount: 300,
              maximumPayloadBytes: 655_360,
              maximumRetentionSeconds: 86_400,
              allShareableRuleCount: 0,
              currentApprovedDeviceCount: 1
            },
            samples: rules.map((rule) => ({
              ruleId: rule.id,
              projectionId: rule.projectionId,
              fields: (rule.fields as { include: string[] }).include,
              excludedFields: (rule.fields as { exclude: string[] }).exclude,
              precision: rule.precision,
              entitySelector: rule.entitySelector,
              time: rule.time
            }))
          }
        };
      },
      presenceOptions("challenge_broad_propose"),
      { approved: true },
      { grant: serverGrant, versionHash: GRANT_HASH },
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);
    await gateway.getPersonContext(serverPerson.id);
    await gateway.previewShareGrant(draft);
    const previewDraft = previewDrafts[0];
    expect(previewDraft).toBeDefined();
    if (!previewDraft) {
      throw new Error("Expected preview draft capture");
    }
    const previewRules = (
      previewDraft as {
        rules: Array<{
          projectionId: string;
          fields: { include: string[]; exclude: string[] };
        }>;
      }
    ).rules;
    expect(previewRules).toEqual([
      expect.objectContaining({
        projectionId: "calendar.availability.v1",
        fields: expect.objectContaining({ include: ["startsAt"] })
      }),
      expect.objectContaining({
        projectionId: "goals.horizon_summary.v1",
        fields: expect.objectContaining({ include: ["status"] })
      }),
      expect.objectContaining({
        projectionId: "person.profile.v1",
        fields: expect.objectContaining({
          include: ["displayName", "timezone"]
        })
      })
    ]);
    for (const rule of previewRules) {
      expect(rule.fields.include).not.toContain("title");
      expect(rule.fields.include).not.toContain("pronouns");
      expect(rule.fields.include).not.toContain("privateNotes");
    }

    await gateway.proposeShareGrant({ draft, previewHash: PREVIEW_HASH });
    expect(
      (queue.calls[6].body as { draft: Record<string, unknown> }).draft
    ).toEqual(previewDraft);
  });

  it("revokes the newest cached grant version when history arrives in 2 then 1 order", async () => {
    const olderHash = "1".repeat(64);
    const newerHash = "2".repeat(64);
    const historyEnvelope = {
      grants: [
        {
          ...serverGrant,
          sequence: 2,
          issuedAt: "2026-07-02T10:00:00.000Z",
          versionHash: newerHash
        },
        {
          ...serverGrant,
          sequence: 1,
          issuedAt: "2026-07-01T10:00:00.000Z",
          versionHash: olderHash
        }
      ],
      page: { limit: 100, hasMore: false, nextCursor: null }
    };
    const queue = createRequestQueue(
      contextEnvelope(true),
      devicesEnvelope,
      historyEnvelope,
      presenceOptions("challenge_newest_grant_revoke"),
      { approved: true },
      {},
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);
    await gateway.getPersonContext(serverPerson.id);
    await gateway.revokeShareGrant({
      grantId: serverGrant.id,
      acknowledgement: true
    });
    const body = {
      expectedVersionHash: newerHash,
      reason: "Revoked from the People security review.",
      purgeManagedCache: true
    };
    expectPresenceSequence(
      queue.calls,
      3,
      "challenge_newest_grant_revoke",
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: "/api/v1/peers/grants/:grantId/revoke",
        pathParams: { grantId: serverGrant.id },
        expectedVersion: newerHash,
        body
      },
      `/api/v1/peers/grants/${serverGrant.id}/revoke`
    );
  });

  it.each([
    {
      name: "grant revocation",
      challengeId: "challenge_grant_revoke",
      routePath: "/api/v1/peers/grants/:grantId/revoke",
      finalPath: `/api/v1/peers/grants/${serverGrant.id}/revoke`,
      pathParams: { grantId: serverGrant.id },
      expectedVersion: GRANT_HASH,
      body: {
        expectedVersionHash: GRANT_HASH,
        reason: "Revoked from the People security review.",
        purgeManagedCache: true
      },
      invoke: (gateway: ReturnType<typeof createGateway>) =>
        gateway.revokeShareGrant({
          grantId: serverGrant.id,
          acknowledgement: true
        })
    },
    {
      name: "relationship revocation",
      challengeId: "challenge_relationship_revoke",
      routePath: "/api/v1/peers/relationships/:relationshipId/revoke",
      finalPath: `/api/v1/peers/relationships/${relationship.id}/revoke`,
      pathParams: { relationshipId: relationship.id },
      expectedVersion: RELATIONSHIP_UPDATED_AT,
      body: {
        expectedVersion: RELATIONSHIP_UPDATED_AT,
        reason: "Revoked from the People security review.",
        purgeManagedCache: true
      },
      invoke: (gateway: ReturnType<typeof createGateway>) =>
        gateway.revokeRelationship({
          relationshipId: relationship.id,
          acknowledgement: true
        })
    },
    {
      name: "device removal",
      challengeId: "challenge_device_remove",
      routePath:
        "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove",
      finalPath: `/api/v1/peers/relationships/${relationship.id}/devices/${approvedDevice.deviceId}/remove`,
      pathParams: {
        relationshipId: relationship.id,
        deviceId: approvedDevice.deviceId
      },
      expectedVersion: RELATIONSHIP_UPDATED_AT,
      body: {
        expectedVersion: RELATIONSHIP_UPDATED_AT,
        reason: "Removed from the People security review."
      },
      invoke: (gateway: ReturnType<typeof createGateway>) =>
        gateway.removePeerDevice({
          relationshipId: relationship.id,
          deviceId: approvedDevice.deviceId,
          acknowledgement: true
        })
    }
  ])("binds $name to the exact reviewed action", async (scenario) => {
    const queue = createRequestQueue(
      contextEnvelope(true),
      devicesEnvelope,
      grantsEnvelope,
      presenceOptions(scenario.challengeId),
      { approved: true },
      {},
      contextEnvelope(false)
    );
    const gateway = createGateway(queue);
    await gateway.getPersonContext(serverPerson.id);
    await scenario.invoke(gateway);
    const pathParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(scenario.pathParams)) {
      if (value !== undefined) {
        pathParams[key] = value;
      }
    }

    expectPresenceSequence(
      queue.calls,
      3,
      scenario.challengeId,
      {
        ownerUserId: "user_owner",
        method: "POST",
        routePath: scenario.routePath,
        pathParams,
        expectedVersion: scenario.expectedVersion,
        body: scenario.body
      },
      scenario.finalPath
    );
  });

  it("sends time-zone-bound interpretation and executes only the returned typed query", async () => {
    const typedQuery = {
      projectionId: "calendar.availability.v1",
      parameters: {
        startsAt: "2026-07-20T00:00:00.000Z",
        endsAt: "2026-07-21T00:00:00.000Z",
        timezone: "Europe/Zurich",
        precision: "free_busy"
      },
      interval: {
        startsAt: "2026-07-20T00:00:00.000Z",
        endsAt: "2026-07-21T00:00:00.000Z",
        timeZone: "Europe/Zurich"
      },
      entityIds: [],
      fields: ["startsAt", "endsAt", "state"],
      precision: "free_busy",
      maximumResultCount: 100
    };
    const queue = createRequestQueue(
      {
        interpretation: {
          supported: true,
          projectionId: "calendar.availability.v1",
          confidence: 0.98,
          requestedPrecision: "free_busy",
          requiresTimeResolution: true,
          id: "interpretation_ada",
          hash: INTERPRETATION_HASH,
          expiresAt: "2026-07-15T10:35:00.000Z",
          query: typedQuery
        }
      },
      {
        result: {
          state: "live",
          payload: { windows: ["09:00-10:00"] },
          metadata: {
            projectionId: "calendar.availability.v1",
            asOf: "2026-07-15T10:29:00.000Z",
            receivedAt: NOW,
            validUntil: "2026-07-15T10:35:00.000Z",
            completeness: 1,
            precision: "free_busy",
            redactedFields: ["title"],
            source: {
              principalId: "principal_remote",
              deviceId: approvedDevice.deviceId,
              relationshipId: relationship.id
            }
          }
        },
        durationMs: 42
      }
    );
    const gateway = createGateway(queue);
    const interpretation = await gateway.interpretQuestion({
      personId: serverPerson.id,
      question: "Is Ada free next Monday?"
    });
    const result = await gateway.executeQuestion({
      personId: serverPerson.id,
      question: "Is Ada free next Monday?",
      typedQueryId: interpretation.typedQueryId!,
      preferLive: true
    });
    expect(result).toMatchObject({
      projectionId: "calendar.availability.v1",
      sourcePrincipalId: "principal_remote",
      sourceDeviceId: approvedDevice.deviceId,
      freshness: "live",
      redactions: ["title"]
    });

    expect(queue.calls[0]).toMatchObject({
      path: `/api/v1/people/${serverPerson.id}/questions/interpret`,
      method: "POST",
      body: {
        question: "Is Ada free next Monday?",
        timeZone: "Europe/Zurich",
        referenceTime: NOW
      }
    });
    expect(queue.calls[1]).toMatchObject({
      path: `/api/v1/people/${serverPerson.id}/questions/execute`,
      method: "POST",
      body: {
        interpretationId: "interpretation_ada",
        interpretationHash: INTERPRETATION_HASH,
        query: typedQuery,
        sourcePreference: "live_then_cache"
      }
    });
    expect(JSON.stringify(queue.calls[1].body)).not.toContain(
      "Is Ada free next Monday?"
    );
  });
});
