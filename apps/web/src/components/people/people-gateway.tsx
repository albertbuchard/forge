import { createContext, useContext, type ReactNode } from "react";
import { z, ZodError } from "zod";
import { resolveForgePath } from "@/lib/runtime-paths";
import type {
  PairingInvitation,
  PairingReview,
  PeerTypedQuestion,
  PeopleCollectionPage,
  PeopleCollectionRequest,
  PeopleEntityLinkCandidate,
  PeopleFreshnessState,
  PeopleGateway,
  PeoplePendingRequest,
  PersonConnectionState,
  PersonContext,
  PersonLocalProfile,
  PersonSummary,
  QuestionInterpretation,
  QuestionResult,
  RequestReviewDecision,
  SavePersonInput,
  ShareGrantDraft,
  SharedProjection,
  SharePreview,
  WikiAssociationInput,
  WikiCandidate,
  WikiPeopleEnrichment,
  WikiPersonImportDraft
} from "@/components/people/people-types";

export class PeopleGatewayError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; status?: number | null; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "PeopleGatewayError";
    this.code = options.code ?? "people_gateway_error";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

type PeopleRequest = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type PeerTransportKind = "local_direct" | "iroh" | "tor_onion" | "http_mailbox";
type PeerTransportPrivacyMode = "fastest" | "hide_network_address" | "custom";
type PresenceCeremony = "register" | "authenticate";

export type PeerPresenceAction = {
  ownerUserId: string;
  method: "POST" | "DELETE";
  routePath: string;
  pathParams: Record<string, string>;
  expectedVersion: string | null;
  body: unknown;
};

export type PeopleGatewayOptions = {
  request?: PeopleRequest;
  userId?: string;
  peopleRootPageId?: string;
  localDeviceId?: string;
  timeZone?: string;
  includePrivate?: boolean;
  privacyMode?: PeerTransportPrivacyMode;
  transportKinds?: PeerTransportKind[];
  now?: () => Date;
  idempotencyKey?: () => string;
  presenceCeremony?: PresenceCeremony;
  credentialLabel?: string;
  performHumanPresence?: (input: {
    ceremony: PresenceCeremony;
    options: unknown;
  }) => Promise<unknown>;
  decodePairingInvitation?: (payload: string) => unknown;
};

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FIELD_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;
const PEOPLE_PROFILE_CACHE_LIMIT = 500;
const PEOPLE_RELATIONSHIP_CACHE_LIMIT = 500;
const PEOPLE_EPHEMERAL_REVIEW_LIMIT = 32;

function setBoundedMap<TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  value: TValue,
  limit: number
) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    map.delete(oldestKey);
  }
}

const PEER_PROJECTION_IDS = new Set([
  "calendar.availability.v1",
  "calendar.selected_events.v1",
  "goals.horizon_summary.v1",
  "health.cycling.aggregate.v1",
  "person.profile.v1",
  "life_events.selected.v1",
  "movement.aggregate.v1",
  "custom.selected_entities.v1"
]);

type ProjectionPolicy = {
  defaultFields: readonly string[];
  shareableFields: readonly string[] | null;
  permanentExclusions: readonly string[];
  allowedPrecisions: readonly string[];
  defaultPrecision: string;
  aggregate: boolean;
  broadShareEligible: boolean;
  maximumPayloadBytes: number;
  timeDirection: "future" | "past" | "none";
  requiresSelectedEntities: boolean;
};

const PEER_PROJECTION_POLICIES = new Map<string, ProjectionPolicy>([
  [
    "calendar.availability.v1",
    {
      defaultFields: ["startsAt", "endsAt", "state"],
      shareableFields: ["startsAt", "endsAt", "state", "title", "location"],
      permanentExclusions: [
        "description",
        "participants",
        "linkedEntities",
        "providerRaw"
      ],
      allowedPrecisions: ["free_busy", "named"],
      defaultPrecision: "free_busy",
      aggregate: false,
      broadShareEligible: true,
      maximumPayloadBytes: 262_144,
      timeDirection: "future",
      requiresSelectedEntities: false
    }
  ],
  [
    "calendar.selected_events.v1",
    {
      defaultFields: ["title", "startsAt", "endsAt", "location"],
      shareableFields: [
        "title",
        "startsAt",
        "endsAt",
        "location",
        "shortDescription",
        "allDay",
        "status"
      ],
      permanentExclusions: ["privateNotes", "providerRaw"],
      allowedPrecisions: ["selected"],
      defaultPrecision: "selected",
      aggregate: false,
      broadShareEligible: false,
      maximumPayloadBytes: 524_288,
      timeDirection: "future",
      requiresSelectedEntities: true
    }
  ],
  [
    "goals.horizon_summary.v1",
    {
      defaultFields: ["title", "shortDescription", "status", "horizon"],
      shareableFields: [
        "title",
        "shortDescription",
        "status",
        "horizon",
        "progress"
      ],
      permanentExclusions: ["privateNotes", "psycheLinks", "agentHistory"],
      allowedPrecisions: ["summary"],
      defaultPrecision: "summary",
      aggregate: false,
      broadShareEligible: true,
      maximumPayloadBytes: 262_144,
      timeDirection: "future",
      requiresSelectedEntities: false
    }
  ],
  [
    "health.cycling.aggregate.v1",
    {
      defaultFields: ["duration", "distance", "activityCount", "units"],
      shareableFields: [
        "duration",
        "distance",
        "activityCount",
        "energy",
        "units",
        "period"
      ],
      permanentExclusions: [
        "rawSamples",
        "route",
        "places",
        "startLocation",
        "endLocation"
      ],
      allowedPrecisions: ["aggregate"],
      defaultPrecision: "aggregate",
      aggregate: true,
      broadShareEligible: false,
      maximumPayloadBytes: 131_072,
      timeDirection: "past",
      requiresSelectedEntities: false
    }
  ],
  [
    "person.profile.v1",
    {
      defaultFields: [
        "displayName",
        "pronouns",
        "shortDescription",
        "timezone"
      ],
      shareableFields: [
        "displayName",
        "pronouns",
        "shortDescription",
        "timezone",
        "homePlaceLabel",
        "contactMethods",
        "facts"
      ],
      permanentExclusions: ["privateNotes", "actorBinding", "peerAudit"],
      allowedPrecisions: ["profile"],
      defaultPrecision: "profile",
      aggregate: false,
      broadShareEligible: true,
      maximumPayloadBytes: 131_072,
      timeDirection: "none",
      requiresSelectedEntities: false
    }
  ],
  [
    "life_events.selected.v1",
    {
      defaultFields: [
        "title",
        "startsAt",
        "endsAt",
        "placeLabel",
        "shortDescription"
      ],
      shareableFields: [
        "title",
        "startsAt",
        "endsAt",
        "placeLabel",
        "shortDescription",
        "eventType",
        "status",
        "originLabel",
        "destinationLabel",
        "transportMode"
      ],
      permanentExclusions: [
        "bookingReference",
        "ticketArtifact",
        "privateNotes"
      ],
      allowedPrecisions: ["selected"],
      defaultPrecision: "selected",
      aggregate: false,
      broadShareEligible: false,
      maximumPayloadBytes: 524_288,
      timeDirection: "future",
      requiresSelectedEntities: true
    }
  ],
  [
    "movement.aggregate.v1",
    {
      defaultFields: [
        "distance",
        "duration",
        "tripCount",
        "activeDays",
        "units"
      ],
      shareableFields: [
        "distance",
        "duration",
        "tripCount",
        "activeDays",
        "units",
        "period"
      ],
      permanentExclusions: ["timeline", "places", "route", "rawPoints"],
      allowedPrecisions: ["aggregate"],
      defaultPrecision: "aggregate",
      aggregate: true,
      broadShareEligible: false,
      maximumPayloadBytes: 131_072,
      timeDirection: "past",
      requiresSelectedEntities: false
    }
  ],
  [
    "custom.selected_entities.v1",
    {
      defaultFields: [],
      shareableFields: null,
      permanentExclusions: [
        "secret",
        "token",
        "password",
        "artifactBytes",
        "rawHealthSamples",
        "privatePsyche"
      ],
      allowedPrecisions: ["selected"],
      defaultPrecision: "selected",
      aggregate: false,
      broadShareEligible: false,
      maximumPayloadBytes: 524_288,
      timeDirection: "none",
      requiresSelectedEntities: true
    }
  ]
]);

const ROUTES = {
  humanPresenceStatus: "/api/v1/peers/human-presence",
  humanPresenceOptions: "/api/v1/peers/human-presence/options",
  humanPresenceVerify: "/api/v1/peers/human-presence/verify",
  invitations: "/api/v1/peers/invitations",
  invitationCancel: "/api/v1/peers/invitations/:invitationId",
  pairingAccept: "/api/v1/peers/pairings/accept",
  pairingConfirm: "/api/v1/peers/pairings/:pairingId/confirm",
  requestAccept: "/api/v1/peers/requests/:requestId/accept",
  requestReject: "/api/v1/peers/requests/:requestId/reject",
  relationshipRevoke: "/api/v1/peers/relationships/:relationshipId/revoke",
  deviceRemove:
    "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove",
  grantPropose: "/api/v1/peers/relationships/:relationshipId/grants/propose",
  grantRevoke: "/api/v1/peers/grants/:grantId/revoke"
} as const;

const nullableStringSchema = z.string().nullable();
const personAliasSchema = z
  .object({
    alias: z.string(),
    kind: z.enum(["name", "nickname", "former_name", "handle"])
  })
  .passthrough();
const personContactSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "email",
      "phone",
      "messaging",
      "social",
      "address",
      "website",
      "custom"
    ]),
    label: z.string(),
    value: z.string(),
    isPrimary: z.boolean(),
    deletedAt: nullableStringSchema
  })
  .passthrough();
const personFactSchema = z
  .object({
    id: z.string(),
    factType: z.string(),
    label: z.string(),
    value: z.unknown(),
    sensitivity: z.enum(["basic", "private", "sensitive", "restricted"]),
    sourceKind: z.enum([
      "manual",
      "imported",
      "observed",
      "inferred",
      "entity"
    ]),
    reviewedAt: nullableStringSchema,
    deletedAt: nullableStringSchema
  })
  .passthrough();
const serverPersonSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    displayName: z.string(),
    givenName: z.string(),
    middleName: z.string(),
    familyName: z.string(),
    preferredName: z.string(),
    pronouns: z.string(),
    relationshipCategory: z.string(),
    relationshipLabel: z.string(),
    closeness: z.number().int().min(0).max(5).nullable(),
    importance: z.number().int().min(0).max(5).nullable(),
    shortDescription: z.string(),
    description: z.string(),
    privateNotes: z.string(),
    howWeMet: z.string(),
    metAt: nullableStringSchema,
    birthdayYear: z.number().int().nullable(),
    birthdayMonth: z.number().int().nullable(),
    birthdayDay: z.number().int().nullable(),
    birthdayPrecision: z.enum([
      "unknown",
      "year",
      "month_day",
      "year_month",
      "full"
    ]),
    timezone: z.string(),
    homePlaceLabel: z.string(),
    aliases: z.array(personAliasSchema).max(256),
    contacts: z.array(personContactSchema).max(256),
    facts: z.array(personFactSchema).max(1000),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: nullableStringSchema
  })
  .passthrough();

const pageSchema = z
  .object({
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextCursor: nullableStringSchema
  })
  .strict();
const peopleListResponseSchema = z
  .object({
    people: z.array(serverPersonSchema).max(100),
    page: pageSchema
  })
  .strict();

const personLinkSchema = z
  .object({
    sourceEntityType: z.string(),
    sourceEntityId: z.string(),
    targetEntityType: z.string(),
    targetEntityId: z.string(),
    anchorKey: nullableStringSchema,
    relationship: z.string(),
    createdAt: z.string()
  })
  .passthrough();
const relationshipSchema = z
  .object({
    id: z.string(),
    localPersonId: nullableStringSchema,
    status: z.enum([
      "pending_verification",
      "active",
      "paused",
      "revoked",
      "recovery_required"
    ]),
    negotiatedProtocolVersion: z.string(),
    transportPrivacyMode: z.enum(["fastest", "hide_network_address", "custom"]),
    establishedAt: nullableStringSchema,
    lastConnectedAt: nullableStringSchema,
    revokedAt: nullableStringSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    remoteDisplayLabel: z.string(),
    remoteTrustState: z.string()
  })
  .passthrough();
const sharedProjectionMetadataSchema = z
  .object({
    projectionId: z.string(),
    projectionVersion: z.union([z.string(), z.number()]),
    asOf: z.string(),
    receivedAt: z.string(),
    validUntil: nullableStringSchema,
    completeness: z.union([z.number(), z.string()]),
    precision: z.string(),
    state: z.string(),
    relationshipId: z.string()
  })
  .passthrough();
const personContextResponseSchema = z
  .object({
    context: z
      .object({
        person: serverPersonSchema,
        links: z.array(personLinkSchema).max(200),
        profilePageLinks: z.array(personLinkSchema).max(200),
        relationships: z.array(relationshipSchema).max(100),
        sharedProjections: z.array(sharedProjectionMetadataSchema).max(100),
        sources: z
          .object({
            local: z.boolean(),
            wiki: z.boolean(),
            shared: z.boolean(),
            sharedProjectionCount: z.number().int().nonnegative()
          })
          .strict()
      })
      .strict()
  })
  .strict();

const peerDeviceSchema = z
  .object({
    relationshipId: z.string(),
    deviceId: z.string(),
    principalRole: z.enum(["local", "remote"]),
    status: z.enum([
      "pending",
      "approved",
      "removed",
      "revoked",
      "compromised"
    ]),
    label: z.string(),
    deviceType: z.string(),
    lastSeenAt: nullableStringSchema,
    approvedAt: nullableStringSchema,
    removedAt: nullableStringSchema,
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .passthrough();
const devicesResponseSchema = z
  .object({ devices: z.array(peerDeviceSchema).max(256) })
  .passthrough();

const peerGrantRuleSchema = z
  .object({
    id: z.string(),
    effect: z.enum(["allow", "deny"]),
    projectionId: z.string(),
    fields: z
      .object({
        include: z.array(z.string()).max(256),
        exclude: z.array(z.string()).max(256)
      })
      .strict(),
    precision: z.string(),
    approvedDeviceIds: z.array(z.string()).max(128)
  })
  .passthrough();
const peerGrantSchema = z
  .object({
    id: z.string(),
    relationshipId: z.string(),
    direction: z.enum(["local_to_remote", "remote_to_local"]),
    sequence: z.number().int().positive(),
    status: z.enum([
      "draft",
      "proposed",
      "active",
      "countered",
      "rejected",
      "revoked",
      "superseded",
      "expired",
      "conflicted"
    ]),
    label: z.string(),
    purpose: z.string(),
    issuedAt: z.string(),
    effectiveAt: nullableStringSchema,
    expiresAt: nullableStringSchema,
    revokedAt: nullableStringSchema,
    cachePolicy: z
      .object({
        mode: z.enum(["none", "until_expiry", "until_revoked", "duration"]),
        maximumRetentionSeconds: z.number().int().nonnegative(),
        purgeOnRevocation: z.boolean()
      })
      .strict(),
    rules: z.array(peerGrantRuleSchema).max(256)
  })
  .passthrough();
const directGrantListItemSchema = peerGrantSchema.extend({
  versionHash: z.string().regex(HASH_PATTERN).optional()
});
const wrappedGrantListItemSchema = z
  .object({
    grant: peerGrantSchema,
    versionHash: z.string().regex(HASH_PATTERN)
  })
  .passthrough();
const grantListItemSchema = z.union([
  directGrantListItemSchema,
  wrappedGrantListItemSchema
]);
const grantsResponseSchema = z
  .object({
    grants: z.array(grantListItemSchema).max(10_000),
    page: pageSchema
  })
  .strict();

const pendingRequestSchema = z
  .object({
    id: z.string(),
    relationshipId: nullableStringSchema,
    kind: z.enum(["pairing", "device", "grant"]),
    status: z.enum(["pending", "accepted", "rejected", "expired"]),
    version: z.union([z.string(), z.number().int().nonnegative()]),
    payload: z.record(z.string(), z.unknown()),
    payloadHash: z.string(),
    expiresAt: z.string(),
    decidedAt: nullableStringSchema,
    decisionReason: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .passthrough();
const requestsResponseSchema = z
  .object({
    requests: z.array(pendingRequestSchema).max(100),
    page: pageSchema
  })
  .strict();

const wikiCandidateSchema = z
  .object({
    noteId: z.string(),
    rootNoteId: z.string(),
    spaceId: z.string(),
    title: z.string(),
    slug: z.string(),
    parentSlug: nullableStringSchema,
    aliases: z.array(z.string()).max(256),
    summary: z.string(),
    updatedAt: z.string(),
    matchingPersonIds: z.array(z.string()).max(256),
    associatedPersonIds: z.array(z.string()).max(256),
    duplicateCandidateNoteIds: z.array(z.string()).max(256),
    status: z.enum(["unmatched", "single_match", "ambiguous", "associated"])
  })
  .strict();
const wikiScanResponseSchema = z
  .object({
    candidates: z.array(wikiCandidateSchema).max(100),
    root: z
      .object({
        id: z.string(),
        slug: z.string(),
        spaceId: z.string(),
        updatedAt: z.string()
      })
      .passthrough(),
    page: pageSchema,
    scan: z
      .object({
        rootCount: z.number().int().nonnegative(),
        scannedCount: z.number().int().nonnegative(),
        truncated: z.boolean()
      })
      .strict()
  })
  .strict();
const wikiPeopleEnrichmentResponseSchema = z
  .object({
    llmAvailable: z.boolean(),
    enriched: z.boolean(),
    profile: z
      .object({ id: z.string(), label: z.string(), model: z.string() })
      .strict()
      .nullable(),
    suggestions: z
      .array(
        z
          .object({
            pageId: z.string(),
            displayName: z.string(),
            preferredName: z.string(),
            relationshipCategory: z.enum([
              "family",
              "friend",
              "partner",
              "colleague",
              "community",
              "professional",
              "other"
            ]),
            relationshipLabel: z.string(),
            shortDescription: z.string(),
            aliases: z.array(z.string()).max(32)
          })
          .strict()
      )
      .max(20)
  })
  .strict();
const wikiPreviewResponseSchema = z
  .object({
    preview: z
      .object({
        id: z.string(),
        hash: z.string().regex(HASH_PATTERN),
        expiresAt: z.string(),
        effects: z.array(z.unknown()).max(100),
        mutationCount: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();
const wikiApplyResponseSchema = z
  .object({
    previewId: z.string(),
    replayed: z.boolean(),
    results: z
      .array(
        z
          .object({
            candidateNoteId: z.string(),
            action: z.enum(["associate", "create", "skip"]),
            status: z.enum([
              "associated",
              "already_associated",
              "created",
              "skipped"
            ]),
            personId: nullableStringSchema,
            linkCreated: z.boolean()
          })
          .strict()
      )
      .max(100)
  })
  .strict();

const peerPairingInviteSchema = z
  .object({
    id: z.string(),
    ownerUserId: z.string(),
    inviterPrincipalId: z.string(),
    inviterDeviceId: z.string(),
    fingerprint: z.string().regex(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3,7}$/),
    expiresAt: z.string().datetime({ offset: true }),
    protocolVersion: z.literal("forge-peer/1"),
    transportKinds: z
      .array(z.enum(["local_direct", "iroh", "tor_onion", "http_mailbox"]))
      .min(1)
      .max(4),
    bootstrap: z.string().regex(/^[A-Za-z0-9_-]{32,1024}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{64,256}$/)
  })
  .strict();
const invitationResponseSchema = z
  .object({
    invitation: peerPairingInviteSchema
  })
  .strict();
const invitationStatusResponseSchema = z
  .object({
    invitation: z
      .object({
        id: z.string(),
        status: z.enum(["active", "expired", "canceled", "consumed"]),
        fingerprint: z.string(),
        expiresAt: z.string(),
        updatedAt: z.string()
      })
      .passthrough()
  })
  .strict();
const pairingAcceptanceResponseSchema = z
  .object({
    request: pendingRequestSchema
  })
  .strict();

const peerTypedQuestionSchema: z.ZodType<PeerTypedQuestion> = z
  .object({
    projectionId: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    interval: z
      .object({
        startsAt: z.string(),
        endsAt: z.string(),
        timeZone: z.string()
      })
      .strict()
      .nullable(),
    entityIds: z.array(z.string()).max(100),
    fields: z.array(z.string()).max(64),
    precision: z.string(),
    maximumResultCount: z.number().int().positive()
  })
  .strict();
const interpretationResponseSchema = z
  .object({
    interpretation: z.union([
      z
        .object({
          supported: z.literal(false),
          reason: z.enum(["unsupported_projection", "question_empty"])
        })
        .strict(),
      z
        .object({
          supported: z.literal(true),
          projectionId: z.string(),
          confidence: z.number().min(0).max(1),
          requestedPrecision: z.string(),
          requiresTimeResolution: z.boolean(),
          id: z.string(),
          hash: z.string().regex(HASH_PATTERN),
          expiresAt: z.string(),
          query: peerTypedQuestionSchema
        })
        .strict()
    ])
  })
  .strict();
const questionResultResponseSchema = z
  .object({
    result: z
      .object({
        state: z.enum(["live", "cached", "stale", "unavailable"]),
        payload: z.unknown(),
        metadata: z
          .object({
            projectionId: z.string(),
            asOf: z.string(),
            receivedAt: z.string(),
            validUntil: nullableStringSchema,
            completeness: z.number().min(0).max(1),
            precision: z.string(),
            redactedFields: z.array(z.string()).max(256),
            source: z
              .object({
                principalId: z.string(),
                deviceId: z.string(),
                relationshipId: z.string()
              })
              .passthrough()
          })
          .passthrough()
      })
      .strict(),
    durationMs: z.number().int().nonnegative()
  })
  .strict();

const batchResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            ok: z.boolean(),
            entityType: z.string().optional(),
            id: z.string().optional(),
            entity: z.unknown().optional(),
            error: z
              .object({ code: z.string(), message: z.string() })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .min(1)
      .max(100)
  })
  .strict();
const userDirectoryResponseSchema = z
  .object({
    users: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["human", "bot"])
        })
        .passthrough()
    )
  })
  .strict();
const entitySearchResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            ok: z.boolean(),
            clientRef: z.string().optional(),
            matches: z
              .array(
                z
                  .object({
                    deleted: z.boolean(),
                    entityType: z.string(),
                    id: z.string(),
                    entity: z.record(z.string(), z.unknown())
                  })
                  .passthrough()
              )
              .optional(),
            error: z
              .object({ code: z.string(), message: z.string() })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .min(1)
      .max(50)
  })
  .strict();
const presenceOptionsResponseSchema = z
  .object({
    challengeId: z.string(),
    ceremony: z.enum(["register", "authenticate"]),
    options: z.unknown()
  })
  .strict();
const presenceStatusResponseSchema = z
  .object({
    methods: z
      .object({
        webauthn: z
          .object({
            available: z.boolean(),
            firstCredentialBootstrapAllowed: z.boolean().optional(),
            credentialSetVersion: z.string().optional(),
            rpId: z.string().optional()
          })
          .passthrough(),
        companionConsent: z.unknown().optional()
      })
      .passthrough(),
    credentials: z.array(z.unknown()),
    peerCore: z
      .object({
        enabled: z.boolean(),
        healthy: z.boolean(),
        localDeviceId: nullableStringSchema
      })
      .passthrough()
  })
  .passthrough();
const wikiPageSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    parentSlug: nullableStringSchema
  })
  .passthrough();
const wikiPageListResponseSchema = z
  .object({
    pages: z.array(wikiPageSummarySchema).max(500),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable()
  })
  .strict();

type ServerPerson = z.infer<typeof serverPersonSchema>;
type ServerRelationship = z.infer<typeof relationshipSchema>;
type ServerDevice = z.infer<typeof peerDeviceSchema>;
type ServerGrant = z.infer<typeof peerGrantSchema>;
type ServerWikiCandidate = z.infer<typeof wikiCandidateSchema>;
type GrantDraftWire = ReturnType<typeof toGrantDraftWire>;

function appendQuery(
  path: string,
  values: Record<string, string | number | boolean | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function getErrorMessage(body: unknown, fallback: string) {
  const parsed = z
    .object({ error: z.string().optional(), message: z.string().optional() })
    .passthrough()
    .safeParse(body);
  return parsed.success
    ? (parsed.data.error ?? parsed.data.message ?? fallback)
    : fallback;
}

function getErrorCode(body: unknown, status: number) {
  const parsed = z
    .object({ code: z.string().optional() })
    .passthrough()
    .safeParse(body);
  if (parsed.success && parsed.data.code) {
    return parsed.data.code;
  }
  return status === 409 ? "people_conflict" : `people_http_${status}`;
}

function contractError(label: string, error: ZodError) {
  const issue = error.issues[0];
  const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  return new PeopleGatewayError(
    `${label} did not match the declared API response${location}.`,
    { code: "people_response_contract_invalid" }
  );
}

function parseContract<TValue>(
  schema: z.ZodType<TValue>,
  body: unknown,
  label: string
): TValue {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw contractError(label, error);
    }
    throw error;
  }
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function displayJsonValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return "Unavailable";
  }
  return serialized.length <= 4_000
    ? serialized
    : `${serialized.slice(0, 3_997)}...`;
}

function mapImportance(value: number | null): PersonSummary["importance"] {
  if (value !== null && value >= 5) {
    return "essential";
  }
  if (value !== null && value >= 4) {
    return "high";
  }
  if (value !== null && value <= 1) {
    return "low";
  }
  return "normal";
}

function toServerImportance(value: PersonSummary["importance"]) {
  switch (value) {
    case "essential":
      return 5;
    case "high":
      return 4;
    case "normal":
      return 3;
    case "low":
      return 1;
  }
}

function mapRelationshipCategory(
  value: string
): PersonSummary["relationshipCategory"] {
  switch (value) {
    case "family":
    case "friend":
    case "partner":
    case "colleague":
    case "community":
    case "professional":
    case "other":
      return value;
    default:
      return "other";
  }
}

function mapRelationshipStatus(
  status: ServerRelationship["status"]
): PersonConnectionState {
  switch (status) {
    case "pending_verification":
      return "pending";
    case "active":
      return "paired";
    case "paused":
      return "paused";
    case "revoked":
      return "revoked";
    case "recovery_required":
      return "conflict";
  }
}

function mapConnectionFilter(
  value: PeopleCollectionRequest["connection"]
): "none" | "pending" | "active" | "paused" | "revoked" | undefined {
  switch (value) {
    case "local_only":
      return "none";
    case "invited":
    case "pending":
      return "pending";
    case "paired":
      return "active";
    case "paused":
      return "paused";
    case "revoked":
      return "revoked";
    default:
      return undefined;
  }
}

function connectionStateFromFilter(
  value: ReturnType<typeof mapConnectionFilter>
): PersonConnectionState {
  switch (value) {
    case "none":
      return "local_only";
    case "pending":
      return "pending";
    case "active":
      return "paired";
    case "paused":
      return "paused";
    case "revoked":
      return "revoked";
    default:
      return "unknown";
  }
}

function mapPersonProfile(person: ServerPerson): PersonLocalProfile {
  return {
    id: person.id,
    displayName: person.displayName,
    givenName: nullableText(person.givenName),
    middleName: nullableText(person.middleName),
    familyName: nullableText(person.familyName),
    preferredName: nullableText(person.preferredName),
    pronouns: nullableText(person.pronouns),
    aliases: person.aliases.map((alias) => alias.alias),
    relationshipCategory: mapRelationshipCategory(person.relationshipCategory),
    relationshipLabel: nullableText(person.relationshipLabel),
    closeness: person.closeness,
    importance: mapImportance(person.importance),
    importanceScore: person.importance,
    shortDescription: nullableText(person.shortDescription),
    description: nullableText(person.description),
    privateNotes: nullableText(person.privateNotes),
    howWeMet: nullableText(person.howWeMet),
    metAt: person.metAt,
    birthday: {
      year: person.birthdayYear,
      month: person.birthdayMonth,
      day: person.birthdayDay,
      precision: person.birthdayPrecision
    },
    timezone: nullableText(person.timezone),
    homePlaceLabel: nullableText(person.homePlaceLabel),
    contactMethods: person.contacts
      .filter((contact) => contact.deletedAt === null)
      .map((contact) => ({
        id: contact.id,
        kind: contact.kind,
        label: contact.label,
        value: contact.value,
        isPrimary: contact.isPrimary
      })),
    facts: person.facts
      .filter((fact) => fact.deletedAt === null)
      .map((fact) => ({
        id: fact.id,
        label: fact.label || fact.factType,
        value: displayJsonValue(fact.value),
        sensitivity:
          fact.sensitivity === "basic"
            ? "ordinary"
            : fact.sensitivity === "private"
              ? "personal"
              : "sensitive",
        sourceLabel: fact.sourceKind,
        reviewedAt: fact.reviewedAt
      })),
    updatedAt: person.updatedAt
  };
}

function mapPersonSummary(
  person: ServerPerson,
  relationshipStatus: ReturnType<typeof mapConnectionFilter>
): PersonSummary {
  return {
    id: person.id,
    displayName: person.displayName,
    preferredName: nullableText(person.preferredName),
    aliases: person.aliases.map((alias) => alias.alias),
    relationshipCategory: mapRelationshipCategory(person.relationshipCategory),
    relationshipLabel: nullableText(person.relationshipLabel),
    importance: mapImportance(person.importance),
    shortDescription: nullableText(person.shortDescription),
    connectionState: connectionStateFromFilter(relationshipStatus),
    freshnessState: "unavailable",
    freshnessLabel: "Not included in the list response",
    sourceLabel: "Local Person record",
    lastContactAt: null,
    updatedAt: person.updatedAt,
    pendingRequestCount: null
  };
}

function matchesClientFilters(
  person: PersonSummary,
  request: PeopleCollectionRequest
) {
  if (
    request.relationship !== "any" &&
    person.relationshipCategory !== request.relationship
  ) {
    return false;
  }
  if (
    request.connection !== "any" &&
    person.connectionState !== request.connection
  ) {
    return false;
  }
  if (
    request.freshness !== "any" &&
    person.freshnessState !== request.freshness
  ) {
    return false;
  }
  if (request.recentContact !== "any") {
    return request.recentContact === "none" && person.lastContactAt === null;
  }
  return true;
}

export function adaptPeopleListResponse(
  body: unknown,
  request: PeopleCollectionRequest,
  checkedAt: string
): PeopleCollectionPage {
  const response = parseContract(
    peopleListResponseSchema,
    body,
    "People list response"
  );
  const relationshipStatus = mapConnectionFilter(request.connection);
  const people = response.people
    .filter(
      (person) =>
        request.importance === "any" ||
        (person.importance !== null &&
          mapImportance(person.importance) === request.importance)
    )
    .map((person) => mapPersonSummary(person, relationshipStatus))
    .filter((person) => matchesClientFilters(person, request));
  const hasClientOnlyBehavior =
    request.relationship !== "any" ||
    request.importance !== "any" ||
    request.freshness !== "any" ||
    request.recentContact !== "any" ||
    request.connection === "conflict" ||
    request.connection === "unknown";
  return {
    people,
    total: null,
    nextCursor: response.page.nextCursor,
    partial: hasClientOnlyBehavior,
    connection: {
      availability: hasClientOnlyBehavior ? "degraded" : "online",
      label: hasClientOnlyBehavior
        ? "Some filters apply only to the People already loaded."
        : "People are available.",
      checkedAt,
      cachedAt: null
    }
  };
}

function mapDevice(device: ServerDevice) {
  return {
    id: device.deviceId,
    label: device.label,
    deviceType: device.deviceType,
    trustState: device.status,
    lastSeenAt: device.lastSeenAt,
    transportLabel: null,
    freshness: "unavailable" as const
  };
}

function mapRemoteFreshness(value: string): PeopleFreshnessState {
  switch (value) {
    case "live":
      return "live";
    case "current":
    case "cached":
      return "cached";
    case "stale":
      return "stale";
    case "offline":
      return "offline";
    case "revoked":
    case "withdrawn":
      return "revoked";
    default:
      return "unavailable";
  }
}

function mapCompleteness(
  value: number | string
): "complete" | "partial" | "unknown" {
  if (typeof value === "number") {
    return value >= 1 ? "complete" : value > 0 ? "partial" : "unknown";
  }
  return value === "complete" || value === "partial" ? value : "unknown";
}

function unwrapGrant(item: z.infer<typeof grantListItemSchema>): {
  grant: ServerGrant;
  versionHash: string | null;
} {
  const wrapped = wrappedGrantListItemSchema.safeParse(item);
  if (wrapped.success) {
    return {
      grant: wrapped.data.grant,
      versionHash: wrapped.data.versionHash
    };
  }
  const direct = directGrantListItemSchema.parse(item);
  return { grant: direct, versionHash: direct.versionHash ?? null };
}

function mapGrant(input: {
  grant: ServerGrant;
  versionHash: string | null;
}): SharedProjection {
  const precisions = Array.from(
    new Set(input.grant.rules.map((rule) => rule.precision))
  );
  return {
    projectionIds: Array.from(
      new Set(input.grant.rules.map((rule) => rule.projectionId))
    ),
    label: input.grant.label,
    direction:
      input.grant.direction === "local_to_remote" ? "outgoing" : "incoming",
    grantId: input.grant.id,
    grantVersion: input.grant.sequence,
    versionKey: `${input.grant.id}:${input.grant.sequence}:${input.versionHash ?? input.grant.issuedAt}`,
    state: input.grant.status,
    purpose: nullableText(input.grant.purpose),
    expiresAt: input.grant.expiresAt,
    precisions,
    fields: Array.from(
      new Set(input.grant.rules.flatMap((rule) => rule.fields.include))
    ),
    exclusions: Array.from(
      new Set(input.grant.rules.flatMap((rule) => rule.fields.exclude))
    ),
    recipientDeviceIds: Array.from(
      new Set(input.grant.rules.flatMap((rule) => rule.approvedDeviceIds))
    ),
    retentionLabel:
      input.grant.cachePolicy.mode === "none"
        ? "No managed cache"
        : `${input.grant.cachePolicy.maximumRetentionSeconds} seconds maximum`,
    issuedAt: input.grant.issuedAt,
    versionHash: input.versionHash
  };
}

function newerGrantVersion(
  left: { grant: ServerGrant; versionHash: string | null },
  right: { grant: ServerGrant; versionHash: string | null }
) {
  if (left.grant.sequence !== right.grant.sequence) {
    return left.grant.sequence > right.grant.sequence ? left : right;
  }
  const issuedDelta =
    Date.parse(left.grant.issuedAt) - Date.parse(right.grant.issuedAt);
  if (issuedDelta !== 0) {
    return issuedDelta > 0 ? left : right;
  }
  return (left.versionHash ?? "").localeCompare(right.versionHash ?? "") >= 0
    ? left
    : right;
}

export function collapseGrantVersions(
  versions: Array<{ grant: ServerGrant; versionHash: string | null }>
) {
  const currentByGrantId = new Map<
    string,
    { grant: ServerGrant; versionHash: string | null }
  >();
  for (const version of versions) {
    const current = currentByGrantId.get(version.grant.id);
    currentByGrantId.set(
      version.grant.id,
      current ? newerGrantVersion(current, version) : version
    );
  }
  return [...currentByGrantId.values()].sort(
    (left, right) =>
      Date.parse(right.grant.issuedAt) - Date.parse(left.grant.issuedAt) ||
      left.grant.id.localeCompare(right.grant.id)
  );
}

export function adaptPersonContextResponse(
  body: unknown,
  options: {
    checkedAt: string;
    devicesBody?: unknown;
    grantsBody?: unknown;
    grantsComplete?: boolean;
    peerDetailsUnavailable?: boolean;
  }
): PersonContext {
  const response = parseContract(
    personContextResponseSchema,
    body,
    "Person context response"
  );
  const primaryRelationship = response.context.relationships[0] ?? null;
  const devices =
    options.devicesBody === undefined
      ? []
      : parseContract(
          devicesResponseSchema,
          options.devicesBody,
          "Peer devices response"
        ).devices;
  const grants =
    options.grantsBody === undefined
      ? []
      : parseContract(
          grantsResponseSchema,
          options.grantsBody,
          "Peer grants response"
        ).grants.map(unwrapGrant);
  const peer = primaryRelationship
    ? {
        id: primaryRelationship.id,
        version: primaryRelationship.updatedAt,
        displayLabel: primaryRelationship.remoteDisplayLabel,
        status: mapRelationshipStatus(primaryRelationship.status),
        verifiedAt: primaryRelationship.establishedAt,
        lastReachableAt: primaryRelationship.lastConnectedAt,
        transportPrivacyMode: primaryRelationship.transportPrivacyMode,
        availability: "unknown" as const,
        freshness: "unavailable" as const,
        verificationLabel: null,
        devices: devices
          .filter((device) => device.relationshipId === primaryRelationship.id)
          .map(mapDevice)
      }
    : null;
  const links = response.context.links.map((link) => {
    const personIsSource =
      link.sourceEntityType === "person" &&
      link.sourceEntityId === response.context.person.id;
    const entityType = personIsSource
      ? link.targetEntityType
      : link.sourceEntityType;
    const entityId = personIsSource ? link.targetEntityId : link.sourceEntityId;
    return {
      id: `${link.sourceEntityType}:${link.sourceEntityId}:${link.targetEntityType}:${link.targetEntityId}:${link.relationship}`,
      entityType,
      entityId,
      title: null,
      direction: personIsSource ? ("outgoing" as const) : ("incoming" as const),
      anchorKey: link.anchorKey,
      relationship: link.relationship,
      href: null,
      state: "active" as const
    };
  });
  const mappedGrants = collapseGrantVersions(grants).map(mapGrant);
  const incomingValues = response.context.sharedProjections.map(
    (projection) => ({
      id: `${projection.relationshipId}:${projection.projectionId}:${String(projection.projectionVersion)}`,
      label: projection.projectionId,
      value: null,
      sourcePrincipalId: null,
      sourceLabel: null,
      sourceDeviceLabel: null,
      asOf: projection.asOf,
      receivedAt: projection.receivedAt,
      validUntil: projection.validUntil,
      freshness: mapRemoteFreshness(projection.state),
      precision: projection.precision,
      completeness: mapCompleteness(projection.completeness),
      redactions: null
    })
  );
  const profilePageLink = response.context.profilePageLinks[0] ?? null;
  const profilePageId = profilePageLink
    ? profilePageLink.sourceEntityType === "person" &&
      profilePageLink.sourceEntityId === response.context.person.id
      ? profilePageLink.targetEntityId
      : profilePageLink.sourceEntityId
    : null;
  const coverage: PersonContext["coverage"] = {
    linkedRecords:
      response.context.links.length >= 200 ? "bounded" : "complete",
    wikiProfile: profilePageId ? "metadata_only" : "none",
    upcomingTogether: "unavailable",
    audit: "unavailable",
    sharedValues: incomingValues.length > 0 ? "metadata_only" : "none",
    peerDevices:
      !primaryRelationship || options.devicesBody !== undefined
        ? "complete"
        : "unavailable",
    grants:
      !primaryRelationship ||
      (options.grantsBody !== undefined && options.grantsComplete !== false)
        ? "complete"
        : "unavailable"
  };
  const unavailableSections = [
    coverage.upcomingTogether === "unavailable" ? "upcoming events" : null,
    coverage.audit === "unavailable" ? "audit history" : null,
    coverage.wikiProfile === "metadata_only" ? "Wiki page details" : null,
    coverage.sharedValues === "metadata_only" ? "shared details" : null,
    coverage.peerDevices === "unavailable" ? "paired devices" : null,
    coverage.grants === "unavailable" ? "sharing permissions" : null,
    coverage.linkedRecords === "bounded" ? "more linked records" : null
  ].filter((label): label is string => label !== null);
  const unavailableSummary =
    unavailableSections.length <= 1
      ? (unavailableSections[0] ?? "")
      : unavailableSections.length === 2
        ? unavailableSections.join(" or ")
        : `${unavailableSections.slice(0, -1).join(", ")}, or ${unavailableSections.at(-1)}`;
  const partial = unavailableSections.length > 0;
  return {
    person: mapPersonProfile(response.context.person),
    peer,
    incomingValues,
    outgoingShares: mappedGrants.filter(
      (grant) => grant.direction === "outgoing"
    ),
    incomingShares: mappedGrants.filter(
      (grant) => grant.direction === "incoming"
    ),
    upcomingTogether: [],
    linkedRecords: links,
    wikiProfile:
      profilePageId && profilePageLink
        ? {
            pageId: profilePageId,
            title: null,
            spaceLabel: null,
            excerpt: null,
            href: null,
            associatedAt: profilePageLink.createdAt,
            completeness: "metadata_only"
          }
        : null,
    audit: [],
    coverage,
    connection: {
      availability: "unknown",
      label:
        unavailableSections.length > 0
          ? `Saved details remain available. Forge could not load ${unavailableSummary}.`
          : "Person context loaded from Forge.",
      checkedAt: options.checkedAt,
      cachedAt: null
    },
    partial,
    conflictMessage:
      primaryRelationship?.status === "recovery_required"
        ? "The peer relationship requires recovery."
        : null,
    revocationMessage:
      primaryRelationship?.status === "revoked"
        ? "The peer relationship is revoked."
        : null
  };
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown) {
  const parsed = z.array(z.string()).max(256).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function firstEntityText(
  entity: Record<string, unknown>,
  keys: readonly string[]
) {
  for (const key of keys) {
    const value = entity[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function adaptEntityLinkSearchResponse(
  body: unknown,
  excludePersonId?: string
): PeopleEntityLinkCandidate[] {
  const response = parseContract(
    entitySearchResponseSchema,
    body,
    "Entity link search response"
  );
  const operation = response.results[0]!;
  if (!operation.ok) {
    throw new PeopleGatewayError(
      operation.error?.message ?? "Forge entity link search failed.",
      {
        code: operation.error?.code ?? "people_entity_search_failed",
        status: 200
      }
    );
  }
  const seen = new Set<string>();
  const candidates: PeopleEntityLinkCandidate[] = [];
  for (const match of operation.matches ?? []) {
    const key = `${match.entityType}\u0000${match.id}`;
    if (
      match.deleted ||
      seen.has(key) ||
      (match.entityType === "person" && match.id === excludePersonId)
    ) {
      continue;
    }
    seen.add(key);
    const label =
      firstEntityText(match.entity, [
        "displayName",
        "title",
        "name",
        "label"
      ]) ?? `${match.entityType.replaceAll("_", " ")} ${match.id}`;
    candidates.push({
      entityType: match.entityType,
      entityId: match.id,
      label,
      description: firstEntityText(match.entity, [
        "shortDescription",
        "summary",
        "description"
      ])
    });
  }
  return candidates;
}

function requestScope(payload: Record<string, unknown>) {
  const directProjections = readStringArray(payload.projections);
  const directFields = readStringArray(payload.fields);
  if (directProjections.length > 0 || directFields.length > 0) {
    return { projections: directProjections, fields: directFields };
  }
  const draft = z
    .object({
      rules: z
        .array(
          z
            .object({
              projectionId: z.string(),
              fields: z
                .object({ include: z.array(z.string()).max(256) })
                .passthrough()
            })
            .passthrough()
        )
        .max(256)
    })
    .passthrough()
    .safeParse(payload.draft);
  return draft.success
    ? {
        projections: Array.from(
          new Set(draft.data.rules.map((rule) => rule.projectionId))
        ),
        fields: Array.from(
          new Set(draft.data.rules.flatMap((rule) => rule.fields.include))
        )
      }
    : { projections: [], fields: [] };
}

function mapPendingRequest(
  request: z.infer<typeof pendingRequestSchema>
): PeoplePendingRequest {
  const scope = requestScope(request.payload);
  const wireDirection = readString(request.payload, "direction");
  const direction =
    wireDirection === "local_to_remote" || wireDirection === "outgoing"
      ? "outgoing"
      : wireDirection === "remote_to_local" || wireDirection === "incoming"
        ? "incoming"
        : request.kind === "pairing" || request.kind === "device"
          ? "incoming"
          : "unknown";
  const title =
    request.kind === "pairing"
      ? "Pairing request"
      : request.kind === "device"
        ? "Device approval request"
        : "Sharing grant request";
  return {
    id: request.id,
    version: String(request.version),
    kind: request.kind,
    personId: readString(request.payload, "personId"),
    personLabel:
      readString(request.payload, "personLabel") ??
      readString(request.payload, "remoteDisplayLabel") ??
      "Peer identity not included",
    title,
    summary: `Review the exact ${request.kind} payload before deciding.`,
    receivedAt: request.createdAt,
    expiresAt: request.expiresAt,
    direction,
    identityFingerprint: readString(request.payload, "fingerprint"),
    verificationPhrase: readString(request.payload, "verificationPhrase"),
    requestedProjections: scope.projections,
    requestedFields: scope.fields,
    requestedDeviceLabel:
      readString(request.payload, "deviceLabel") ??
      readString(request.payload, "label"),
    consequence:
      request.kind === "grant"
        ? "Acceptance activates only the reviewed directional grant version."
        : request.kind === "device"
          ? "Acceptance approves only the reviewed device."
          : "Acceptance advances only this reviewed pairing request."
  };
}

function mapWikiCandidate(candidate: ServerWikiCandidate): WikiCandidate {
  return {
    pageId: candidate.noteId,
    title: candidate.title,
    spaceLabel: candidate.spaceId,
    pathLabel: candidate.parentSlug
      ? `${candidate.parentSlug}/${candidate.slug}`
      : candidate.slug,
    excerpt: nullableText(candidate.summary),
    aliases: candidate.aliases,
    matchReason: candidate.status.replaceAll("_", " "),
    alreadyAssociatedPersonId: candidate.associatedPersonIds[0] ?? null,
    expectedWikiVersion: candidate.updatedAt
  };
}

function normalizeGrantExpiry(value: string | null) {
  if (value === null) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59.999Z`
    : value;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new PeopleGatewayError("Enter a valid grant expiry.", {
      code: "peer_grant_expiry_invalid"
    });
  }
  return new Date(timestamp).toISOString();
}

function toGrantDraftWire(
  input: ShareGrantDraft,
  linkedEntityTypes: ReadonlyMap<string, ReadonlySet<string>>
) {
  const projectionIds = [...new Set(input.projections)];
  if (projectionIds.length === 0) {
    throw new PeopleGatewayError("Select at least one registered projection.", {
      code: "peer_grant_projection_required"
    });
  }
  for (const projectionId of projectionIds) {
    if (!PEER_PROJECTION_IDS.has(projectionId)) {
      throw new PeopleGatewayError(
        `${projectionId} is not a registered peer projection.`,
        { code: "peer_grant_projection_unsupported" }
      );
    }
  }
  for (const field of [...input.fields, ...input.exclusions]) {
    if (!FIELD_PATH_PATTERN.test(field)) {
      throw new PeopleGatewayError(
        `${field} is not a structured peer field path.`,
        { code: "peer_grant_field_invalid" }
      );
    }
  }
  const requiresSelectedEntities = projectionIds.some(
    (projectionId) =>
      PEER_PROJECTION_POLICIES.get(projectionId)?.requiresSelectedEntities
  );
  if (requiresSelectedEntities && input.selectedRecordIds.length === 0) {
    throw new PeopleGatewayError(
      "Selected-entity grants require at least one exact record.",
      { code: "peer_grant_entity_selection_required" }
    );
  }
  if (
    !Number.isFinite(input.retentionDays) ||
    !Number.isFinite(input.horizonDays)
  ) {
    throw new PeopleGatewayError(
      "Grant horizon and retention must be finite numbers.",
      { code: "peer_grant_window_invalid" }
    );
  }
  const cacheSeconds = Math.max(
    0,
    Math.min(31_536_000, Math.round(input.retentionDays * 86_400))
  );
  const approvedDeviceIds = [...new Set(input.recipientDeviceIds)];
  if (approvedDeviceIds.length === 0) {
    throw new PeopleGatewayError(
      "Select at least one explicitly approved recipient device.",
      { code: "peer_grant_device_required" }
    );
  }
  const selectedByType = new Map<string, string[]>();
  for (const entityId of requiresSelectedEntities
    ? new Set(input.selectedRecordIds)
    : []) {
    const entityTypes = linkedEntityTypes.get(entityId);
    if (!entityTypes || entityTypes.size !== 1) {
      throw new PeopleGatewayError(
        `The linked record ${entityId} has no unambiguous server entity type. Reload the Person before previewing.`,
        { code: "peer_grant_entity_type_unavailable" }
      );
    }
    const [entityType] = entityTypes;
    if (!entityType) {
      throw new PeopleGatewayError(
        `The linked record ${entityId} has no server entity type.`,
        { code: "peer_grant_entity_type_unavailable" }
      );
    }
    selectedByType.set(entityType, [
      ...(selectedByType.get(entityType) ?? []),
      entityId
    ]);
  }
  const requestedFields = [...new Set(input.fields)];
  const requestedExclusions = [...new Set(input.exclusions)];
  const horizonDays = Math.max(
    0,
    Math.min(3_650, Math.round(input.horizonDays))
  );
  const rules = projectionIds.flatMap((projectionId, projectionIndex) => {
    const policy = PEER_PROJECTION_POLICIES.get(projectionId);
    if (!policy) {
      throw new PeopleGatewayError(
        `${projectionId} has no bounded People grant adapter.`,
        { code: "peer_grant_projection_unsupported" }
      );
    }
    if (input.preset === "broad" && !policy.broadShareEligible) {
      throw new PeopleGatewayError(
        `${projectionId} is not eligible for a broad peer grant.`,
        { code: "peer_grant_broad_projection_forbidden" }
      );
    }
    const knownExclusions =
      policy.shareableFields === null
        ? requestedExclusions
        : requestedExclusions.filter(
            (field) =>
              policy.shareableFields?.includes(field) ||
              policy.permanentExclusions.includes(field)
          );
    const excluded = [
      ...new Set([...policy.permanentExclusions, ...knownExclusions])
    ];
    const excludedSet = new Set(excluded);
    const include = (
      policy.shareableFields === null
        ? requestedFields
        : requestedFields.filter((field) =>
            policy.shareableFields?.includes(field)
          )
    ).filter((field) => !excludedSet.has(field));
    if (include.length === 0) {
      throw new PeopleGatewayError(
        `Select at least one non-excluded server-supported field for ${projectionId}.`,
        { code: "peer_grant_projection_field_required" }
      );
    }
    const requestedPrecision = input.precision.trim();
    const usesProjectionDefaults =
      input.preset === "broad" && requestedPrecision === "projection_defaults";
    if (
      !usesProjectionDefaults &&
      !policy.allowedPrecisions.includes(requestedPrecision)
    ) {
      throw new PeopleGatewayError(
        `${projectionId} does not support precision ${requestedPrecision || "(empty)"}.`,
        { code: "peer_grant_precision_unsupported" }
      );
    }
    const precision = usesProjectionDefaults
      ? policy.defaultPrecision
      : requestedPrecision;
    const entityGroups = policy.requiresSelectedEntities
      ? [...selectedByType.entries()]
      : [[null, []] as const];
    return entityGroups.map(([entityType, entityIds], entityIndex) => ({
      id: `people-rule-${projectionIndex + 1}-${entityIndex + 1}`,
      effect: "allow" as const,
      projectionId,
      entitySelector:
        entityType === null
          ? null
          : {
              mode: "selected" as const,
              entityType,
              entityIds
            },
      fields: { include, exclude: excluded },
      time: {
        startsAt: null,
        endsAt: null,
        rollingPastDays:
          policy.timeDirection === "past"
            ? horizonDays
            : policy.timeDirection === "future"
              ? 0
              : null,
        rollingFutureDays:
          policy.timeDirection === "future"
            ? horizonDays
            : policy.timeDirection === "past"
              ? 0
              : null
      },
      precision,
      aggregation: policy.aggregate
        ? {
            minimumRecords: 3,
            granularity: "week" as const,
            privacyBudget: 30,
            maximumQueriesPerDay: 30
          }
        : null,
      approvedDeviceIds,
      devicePolicy: "explicit" as const,
      maximumResultCount: 100,
      maximumPayloadBytes: policy.maximumPayloadBytes
    }));
  });
  return {
    direction: "local_to_remote" as const,
    label: `${input.preset.replaceAll("_", " ")} share`,
    purpose: input.purpose.trim(),
    effectiveAt: null,
    expiresAt: normalizeGrantExpiry(input.expiresAt),
    cachePolicy: {
      mode: cacheSeconds === 0 ? ("none" as const) : ("duration" as const),
      maximumRetentionSeconds: cacheSeconds,
      purgeOnRevocation: true
    },
    rules
  };
}

const grantPreviewPayloadSchema = z
  .object({
    hash: z.string().regex(HASH_PATTERN),
    relationshipVersion: z.string(),
    exact: z
      .object({
        direction: z.enum(["local_to_remote", "remote_to_local"]),
        rules: z.array(peerGrantRuleSchema).max(256),
        cachePolicy: z
          .object({
            mode: z.enum(["none", "until_expiry", "until_revoked", "duration"]),
            maximumRetentionSeconds: z.number().int().nonnegative(),
            purgeOnRevocation: z.boolean()
          })
          .strict(),
        effectiveAt: nullableStringSchema,
        expiresAt: nullableStringSchema
      })
      .strict(),
    worstCase: z
      .object({
        projectionIds: z.array(z.string()).max(8),
        maximumResultCount: z.number().int().nonnegative(),
        maximumPayloadBytes: z.number().int().nonnegative(),
        maximumRetentionSeconds: z.number().int().nonnegative(),
        allShareableRuleCount: z.number().int().nonnegative(),
        currentApprovedDeviceCount: z.number().int().nonnegative()
      })
      .strict(),
    samples: z
      .array(
        z
          .object({
            ruleId: z.string(),
            projectionId: z.string(),
            fields: z.array(z.string()).max(256),
            excludedFields: z.array(z.string()).max(256),
            precision: z.string(),
            entitySelector: z.unknown().nullable(),
            time: z.unknown()
          })
          .strict()
      )
      .max(100)
  })
  .strict();
const grantPreviewResponseSchema = z
  .object({ preview: grantPreviewPayloadSchema })
  .strict();

function mapSharePreview(body: unknown): {
  preview: SharePreview;
  relationshipVersion: string;
} {
  const response = parseContract(
    grantPreviewResponseSchema,
    body,
    "Peer grant preview response"
  );
  const recipientDeviceIds = Array.from(
    new Set(
      response.preview.exact.rules.flatMap((rule) => rule.approvedDeviceIds)
    )
  );
  return {
    relationshipVersion: response.preview.relationshipVersion,
    preview: {
      draftHash: response.preview.hash,
      directionLabel: response.preview.exact.direction,
      representativeOutput: response.preview.samples.map(displayJsonValue),
      worstCaseOutput: [displayJsonValue(response.preview.worstCase)],
      excludedOutput: Array.from(
        new Set(
          response.preview.samples.flatMap((sample) => sample.excludedFields)
        )
      ),
      expiryLabel: response.preview.exact.expiresAt ?? "No expiry",
      freshnessLabel: "Not included in the preview response",
      retentionLabel: `${response.preview.exact.cachePolicy.maximumRetentionSeconds} seconds maximum`,
      recipientDeviceIds,
      warnings: []
    }
  };
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

const authenticationOptionsSchema = z
  .object({
    challenge: z.string(),
    timeout: z.number().optional(),
    rpId: z.string().optional(),
    userVerification: z
      .enum(["discouraged", "preferred", "required"])
      .optional(),
    allowCredentials: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.literal("public-key"),
            transports: z.array(z.string()).optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

const registrationOptionsSchema = z
  .object({
    challenge: z.string(),
    rp: z.object({ name: z.string(), id: z.string().optional() }).passthrough(),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        displayName: z.string()
      })
      .passthrough(),
    pubKeyCredParams: z.array(
      z.object({ type: z.literal("public-key"), alg: z.number().int() })
    ),
    timeout: z.number().optional(),
    excludeCredentials: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.literal("public-key"),
            transports: z.array(z.string()).optional()
          })
          .passthrough()
      )
      .optional(),
    authenticatorSelection: z
      .object({
        authenticatorAttachment: z
          .enum(["platform", "cross-platform"])
          .optional(),
        residentKey: z
          .enum(["discouraged", "preferred", "required"])
          .optional(),
        requireResidentKey: z.boolean().optional(),
        userVerification: z
          .enum(["discouraged", "preferred", "required"])
          .optional()
      })
      .passthrough()
      .optional(),
    attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional()
  })
  .passthrough();

async function performBrowserHumanPresence(input: {
  ceremony: PresenceCeremony;
  options: unknown;
}) {
  if (
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof PublicKeyCredential === "undefined"
  ) {
    throw new PeopleGatewayError(
      "This browser does not provide the credential API required for peer approval.",
      { code: "peer_presence_browser_unsupported" }
    );
  }
  if (input.ceremony === "register") {
    const options = parseContract(
      registrationOptionsSchema,
      input.options,
      "Peer WebAuthn registration options"
    );
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: base64UrlToBytes(options.challenge),
        rp: options.rp,
        user: {
          id: base64UrlToBytes(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName
        },
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        excludeCredentials: options.excludeCredentials?.map((descriptor) => ({
          id: base64UrlToBytes(descriptor.id),
          type: "public-key" as const,
          transports: descriptor.transports as
            | AuthenticatorTransport[]
            | undefined
        })),
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation
      }
    });
    if (!(credential instanceof PublicKeyCredential)) {
      throw new PeopleGatewayError("Peer approval setup was canceled.", {
        code: "peer_presence_canceled"
      });
    }
    const jsonCredential = credential as PublicKeyCredential & {
      toJSON?: () => unknown;
    };
    if (typeof jsonCredential.toJSON === "function") {
      return jsonCredential.toJSON();
    }
    if (
      typeof AuthenticatorAttestationResponse === "undefined" ||
      !(credential.response instanceof AuthenticatorAttestationResponse)
    ) {
      throw new PeopleGatewayError(
        "The browser returned an unsupported approval setup response.",
        { code: "peer_presence_response_unsupported" }
      );
    }
    return {
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      response: {
        clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
        attestationObject: bytesToBase64Url(
          credential.response.attestationObject
        ),
        transports: credential.response.getTransports()
      },
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
      type: credential.type
    };
  }
  const options = parseContract(
    authenticationOptionsSchema,
    input.options,
    "Peer WebAuthn options"
  );
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToBytes(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials?.map((descriptor) => ({
        id: base64UrlToBytes(descriptor.id),
        type: "public-key" as const,
        transports: descriptor.transports as
          | AuthenticatorTransport[]
          | undefined
      }))
    }
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new PeopleGatewayError("Peer approval was canceled.", {
      code: "peer_presence_canceled"
    });
  }
  const jsonCredential = credential as PublicKeyCredential & {
    toJSON?: () => unknown;
  };
  if (typeof jsonCredential.toJSON === "function") {
    return jsonCredential.toJSON();
  }
  if (
    typeof AuthenticatorAssertionResponse === "undefined" ||
    !(credential.response instanceof AuthenticatorAssertionResponse)
  ) {
    throw new PeopleGatewayError(
      "The browser returned an unsupported approval response.",
      { code: "peer_presence_response_unsupported" }
    );
  }
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    response: {
      clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
      authenticatorData: bytesToBase64Url(
        credential.response.authenticatorData
      ),
      signature: bytesToBase64Url(credential.response.signature),
      ...(credential.response.userHandle
        ? { userHandle: bytesToBase64Url(credential.response.userHandle) }
        : {})
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    type: credential.type
  };
}

function defaultIdempotencyKey() {
  return `people-${crypto.randomUUID()}`;
}

function requireConfigured(
  value: string | undefined,
  code: string,
  label: string
) {
  if (value?.trim()) {
    return value.trim();
  }
  throw new PeopleGatewayError(`${label} is not configured for People.`, {
    code
  });
}

function asIsoNow(now: () => Date) {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new PeopleGatewayError("People received an invalid reference time.", {
      code: "people_reference_time_invalid"
    });
  }
  return value.toISOString();
}

function defaultPairingDecoder(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    throw new PeopleGatewayError(
      "This invitation encoding has no decoder in the current API contract.",
      { code: "peer_pairing_codec_unavailable" }
    );
  }
}

function scalarPersonInput(input: SavePersonInput) {
  const blank = (value: string | null) => value ?? "";
  const importance =
    mapImportance(input.importanceScore) === input.importance
      ? input.importanceScore
      : toServerImportance(input.importance);
  return {
    displayName: input.displayName,
    givenName: blank(input.givenName),
    middleName: blank(input.middleName),
    familyName: blank(input.familyName),
    preferredName: blank(input.preferredName),
    pronouns: blank(input.pronouns),
    relationshipCategory: input.relationshipCategory,
    relationshipLabel: blank(input.relationshipLabel),
    closeness: input.closeness,
    importance,
    shortDescription: blank(input.shortDescription),
    description: blank(input.description),
    privateNotes: blank(input.privateNotes),
    howWeMet: blank(input.howWeMet),
    metAt: input.metAt,
    birthdayYear: input.birthday.year,
    birthdayMonth: input.birthday.month,
    birthdayDay: input.birthday.day,
    birthdayPrecision: input.birthday.precision,
    timezone: blank(input.timezone),
    homePlaceLabel: blank(input.homePlaceLabel)
  };
}

function nestedPersonInput(input: SavePersonInput) {
  return {
    aliases: input.aliases.map((alias) => ({ alias, kind: "name" as const })),
    contacts: input.contactMethods.map((contact) => ({
      kind: contact.kind,
      label: contact.label,
      value: contact.value,
      isPrimary: contact.isPrimary
    })),
    facts: input.facts.map((fact) => ({
      factType: fact.label || "note",
      label: fact.label,
      value: fact.value,
      sensitivity:
        fact.sensitivity === "ordinary"
          ? ("basic" as const)
          : fact.sensitivity === "personal"
            ? ("private" as const)
            : ("sensitive" as const),
      sourceKind: "manual" as const
    }))
  };
}

function nestedPersonChanged(
  input: SavePersonInput,
  current: PersonLocalProfile
) {
  const normalizedContacts = current.contactMethods.map(
    ({ id: _id, ...contact }) => contact
  );
  const normalizedFacts = current.facts.map(
    ({ id: _id, reviewedAt: _reviewedAt, ...fact }) => fact
  );
  return (
    JSON.stringify(input.aliases) !== JSON.stringify(current.aliases) ||
    JSON.stringify(input.contactMethods) !==
      JSON.stringify(normalizedContacts) ||
    JSON.stringify(input.facts) !== JSON.stringify(normalizedFacts)
  );
}

export function createHttpPeopleGateway(
  options: PeopleGatewayOptions = {}
): PeopleGateway {
  const request = options.request ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const makeIdempotencyKey = options.idempotencyKey ?? defaultIdempotencyKey;
  const performHumanPresence =
    options.performHumanPresence ?? performBrowserHumanPresence;
  const decodePairingInvitation =
    options.decodePairingInvitation ?? defaultPairingDecoder;
  let peopleRootPageId = options.peopleRootPageId?.trim() || undefined;
  let localDeviceId = options.localDeviceId?.trim() || undefined;
  const explicitlyConfiguredPeerApproval = Boolean(
    localDeviceId && options.presenceCeremony && options.performHumanPresence
  );
  const capabilities = {
    wikiAssociation: Boolean(peopleRootPageId),
    pairingInvitation: explicitlyConfiguredPeerApproval,
    pairingAcceptance: explicitlyConfiguredPeerApproval
  };
  const personRecords = new Map<string, ServerPerson>();
  const personProfiles = new Map<string, PersonLocalProfile>();
  const wikiCandidates = new Map<string, ServerWikiCandidate>();
  const pendingRequests = new Map<
    string,
    z.infer<typeof pendingRequestSchema>
  >();
  const relationships = new Map<string, ServerRelationship>();
  const relationshipPersonIds = new Map<string, string>();
  const linkedEntityTypesByPerson = new Map<
    string,
    Map<string, ReadonlySet<string>>
  >();
  const outgoingLinkSnapshots = new Map<
    string,
    { complete: boolean; links: PersonContext["linkedRecords"] }
  >();
  const grants = new Map<
    string,
    { grant: ServerGrant; versionHash: string | null }
  >();
  const pairingReviews = new Map<string, PairingReview>();
  const pairingInvitations = new Map<
    string,
    { expectedVersion: string; status: PairingInvitation["status"] }
  >();
  const questionExecutions = new Map<
    string,
    {
      execution: NonNullable<QuestionInterpretation["execution"]>;
      question: string;
    }
  >();
  const grantPreviews = new Map<
    string,
    {
      relationshipId: string;
      relationshipVersion: string;
      draft: GrantDraftWire;
    }
  >();
  let resolvedOwnerUserId: Promise<string> | null = null;
  let runtimeDiscovery: Promise<void> | null = null;

  async function requestJson(path: string, init?: RequestInit) {
    let response: Response;
    try {
      const headers = new Headers(init?.headers);
      if (init?.body !== undefined && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      response = await request(resolveForgePath(path), {
        ...init,
        credentials: "same-origin",
        headers
      });
    } catch (error) {
      throw new PeopleGatewayError(
        error instanceof Error
          ? error.message
          : "Forge is unreachable from this browser.",
        { code: "people_offline", retryable: true }
      );
    }

    let body: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    try {
      body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new PeopleGatewayError(
        getErrorMessage(body, `People request failed (${response.status}).`),
        {
          code: getErrorCode(body, response.status),
          status: response.status,
          retryable: response.status >= 500 || response.status === 408
        }
      );
    }
    return body;
  }

  async function readPresenceStatus() {
    return parseContract(
      presenceStatusResponseSchema,
      await requestJson(ROUTES.humanPresenceStatus),
      "Peer human-presence status response"
    );
  }

  async function discoverPeopleWikiRoot() {
    const matches = new Map<string, z.infer<typeof wikiPageSummarySchema>>();
    let offset = 0;
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = parseContract(
        wikiPageListResponseSchema,
        await requestJson(
          appendQuery("/api/v1/wiki/pages", {
            kind: "wiki",
            limit: 500,
            offset
          })
        ),
        "Wiki page list response"
      );
      for (const candidate of page.pages) {
        if (
          (candidate.slug.toLocaleLowerCase() === "people" ||
            candidate.title.trim().toLocaleLowerCase() === "people")
        ) {
          matches.set(candidate.id, candidate);
        }
      }
      if (!page.hasMore || page.nextOffset === null) {
        break;
      }
      if (page.nextOffset <= offset) {
        throw new PeopleGatewayError(
          "Wiki page discovery returned a non-advancing cursor.",
          { code: "people_wiki_cursor_invalid" }
        );
      }
      offset = page.nextOffset;
    }
    return matches.size === 1 ? [...matches.keys()][0] : undefined;
  }

  async function ensureRuntimeCapabilities() {
    if (runtimeDiscovery) {
      await runtimeDiscovery;
      return;
    }
    if (peopleRootPageId && localDeviceId && capabilities.pairingInvitation) {
      return;
    }
    runtimeDiscovery = (async () => {
      const [presenceResult, wikiResult] = await Promise.allSettled([
        readPresenceStatus(),
        peopleRootPageId
          ? Promise.resolve(peopleRootPageId)
          : discoverPeopleWikiRoot()
      ]);
      if (presenceResult.status === "fulfilled") {
        localDeviceId =
          localDeviceId ??
          presenceResult.value.peerCore.localDeviceId ??
          undefined;
        const pairingAvailable =
          Boolean(localDeviceId) &&
          presenceResult.value.peerCore.enabled &&
          presenceResult.value.peerCore.healthy &&
          presenceResult.value.methods.webauthn.available;
        capabilities.pairingAcceptance = pairingAvailable;
        capabilities.pairingInvitation = pairingAvailable;
      }
      if (wikiResult.status === "fulfilled") {
        peopleRootPageId = peopleRootPageId ?? wikiResult.value;
        capabilities.wikiAssociation = Boolean(peopleRootPageId);
      }
    })().finally(() => {
      runtimeDiscovery = null;
    });
    await runtimeDiscovery;
  }

  async function authorizeHumanAction(action: PeerPresenceAction) {
    let ceremony = options.presenceCeremony;
    if (!ceremony) {
      const status = await readPresenceStatus();
      if (!status.methods.webauthn.available) {
        throw new PeopleGatewayError(
          "This Forge session does not advertise browser human-presence approval.",
          { code: "peer_presence_unavailable" }
        );
      }
      ceremony = status.methods.webauthn.firstCredentialBootstrapAllowed
        ? "register"
        : "authenticate";
    }
    const optionsBody = {
      ceremony,
      action,
      ...(ceremony === "register"
        ? {
            credentialLabel:
              options.credentialLabel ?? "People approval credential"
          }
        : {})
    };
    const optionsResponse = parseContract(
      presenceOptionsResponseSchema,
      await requestJson(ROUTES.humanPresenceOptions, {
        method: "POST",
        body: JSON.stringify(optionsBody)
      }),
      "Peer human-presence options response"
    );
    const verificationResponse = await performHumanPresence({
      ceremony: optionsResponse.ceremony,
      options: optionsResponse.options
    });
    await requestJson(ROUTES.humanPresenceVerify, {
      method: "POST",
      body: JSON.stringify({
        challengeId: optionsResponse.challengeId,
        action,
        verification: {
          kind: "webauthn",
          response: verificationResponse
        }
      })
    });
  }

  async function approvedMutation(path: string, action: PeerPresenceAction) {
    await authorizeHumanAction(action);
    return requestJson(path, {
      method: action.method,
      body: JSON.stringify(action.body)
    });
  }

  async function loadGrantVersions(relationshipId: string) {
    const versions: z.infer<typeof grantListItemSchema>[] = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = parseContract(
        grantsResponseSchema,
        await requestJson(
          appendQuery(
            `/api/v1/peers/relationships/${encodeURIComponent(relationshipId)}/grants`,
            { limit: 100, cursor }
          )
        ),
        "Peer grants response"
      );
      versions.push(...page.grants);
      if (!page.page.hasMore) {
        return {
          body: {
            grants: versions,
            page: { limit: 100, hasMore: false, nextCursor: null }
          },
          complete: true
        };
      }
      if (!page.page.nextCursor || page.page.nextCursor === cursor) {
        throw new PeopleGatewayError(
          "Peer grant history returned a non-advancing cursor.",
          { code: "peer_grant_cursor_invalid" }
        );
      }
      cursor = page.page.nextCursor;
    }
    return {
      body: {
        grants: versions,
        page: { limit: 100, hasMore: true, nextCursor: cursor ?? null }
      },
      complete: false
    };
  }

  async function reloadContext(personId: string) {
    await ensureRuntimeCapabilities();
    const contextPath = appendQuery(
      `/api/v1/people/${encodeURIComponent(personId)}/context`,
      {
        includePrivate: options.includePrivate ?? true,
        includeShared: true,
        linkLimit: 200,
        projectionLimit: 40
      }
    );
    const body = await requestJson(contextPath);
    const parsed = parseContract(
      personContextResponseSchema,
      body,
      "Person context response"
    );
    const primaryRelationship = parsed.context.relationships[0] ?? null;
    const linkedEntityTypes = new Map<string, Set<string>>();
    for (const link of parsed.context.links) {
      const personIsSource =
        link.sourceEntityType === "person" &&
        link.sourceEntityId === parsed.context.person.id;
      const entityId = personIsSource
        ? link.targetEntityId
        : link.sourceEntityId;
      const entityType = personIsSource
        ? link.targetEntityType
        : link.sourceEntityType;
      linkedEntityTypes.set(
        entityId,
        new Set([...(linkedEntityTypes.get(entityId) ?? []), entityType])
      );
    }
    setBoundedMap(
      linkedEntityTypesByPerson,
      personId,
      linkedEntityTypes,
      PEOPLE_PROFILE_CACHE_LIMIT
    );
    let devicesBody: unknown;
    let grantsBody: unknown;
    let grantsComplete = true;
    let peerDetailsUnavailable = false;
    if (primaryRelationship) {
      setBoundedMap(
        relationships,
        primaryRelationship.id,
        primaryRelationship,
        PEOPLE_RELATIONSHIP_CACHE_LIMIT
      );
      setBoundedMap(
        relationshipPersonIds,
        primaryRelationship.id,
        personId,
        PEOPLE_RELATIONSHIP_CACHE_LIMIT
      );
      const [devicesResult, grantsResult] = await Promise.allSettled([
        requestJson(
          `/api/v1/peers/relationships/${encodeURIComponent(primaryRelationship.id)}/devices`
        ),
        loadGrantVersions(primaryRelationship.id)
      ]);
      if (devicesResult.status === "fulfilled") {
        devicesBody = devicesResult.value;
      } else {
        peerDetailsUnavailable = true;
      }
      if (grantsResult.status === "fulfilled") {
        grantsBody = grantsResult.value.body;
        grantsComplete = grantsResult.value.complete;
        const parsedGrants = parseContract(
          grantsResponseSchema,
          grantsBody,
          "Peer grants response"
        );
        for (const grant of collapseGrantVersions(
          parsedGrants.grants.map(unwrapGrant)
        )) {
          setBoundedMap(
            grants,
            grant.grant.id,
            grant,
            PEOPLE_RELATIONSHIP_CACHE_LIMIT
          );
        }
      } else {
        peerDetailsUnavailable = true;
      }
    }
    const context = adaptPersonContextResponse(body, {
      checkedAt: asIsoNow(now),
      devicesBody,
      grantsBody,
      grantsComplete,
      peerDetailsUnavailable
    });
    setBoundedMap(
      personRecords,
      parsed.context.person.id,
      parsed.context.person,
      PEOPLE_PROFILE_CACHE_LIMIT
    );
    setBoundedMap(
      personProfiles,
      context.person.id,
      context.person,
      PEOPLE_PROFILE_CACHE_LIMIT
    );
    setBoundedMap(
      outgoingLinkSnapshots,
      personId,
      {
        complete: context.coverage.linkedRecords === "complete",
        links: context.linkedRecords.filter(
          (link) => link.direction === "outgoing" && link.state === "active"
        )
      },
      PEOPLE_PROFILE_CACHE_LIMIT
    );
    return context;
  }

  async function ownerUserId() {
    if (options.userId !== undefined) {
      return requireConfigured(
        options.userId,
        "people_user_required",
        "A Forge user id"
      );
    }
    if (!resolvedOwnerUserId) {
      resolvedOwnerUserId = (async () => {
        const response = parseContract(
          userDirectoryResponseSchema,
          await requestJson("/api/v1/users"),
          "Forge user directory response"
        );
        const owner =
          response.users.find((user) => user.id === "user_operator") ??
          response.users.find((user) => user.kind === "human") ??
          response.users[0];
        if (!owner) {
          throw new PeopleGatewayError("Forge has no configured users.", {
            code: "people_user_required"
          });
        }
        return owner.id;
      })().catch((error) => {
        resolvedOwnerUserId = null;
        throw error;
      });
    }
    return resolvedOwnerUserId;
  }

  function relationshipForMutation(relationshipId: string) {
    const relationship = relationships.get(relationshipId);
    if (!relationship) {
      throw new PeopleGatewayError(
        "Reload this Person before changing the peer relationship.",
        { code: "peer_relationship_version_missing" }
      );
    }
    return relationship;
  }

  return {
    capabilities,

    async listPeople(input) {
      if (input.connection === "invited" || input.connection === "conflict") {
        throw new PeopleGatewayError(
          "The People list API does not distinguish invitations or recovery conflicts.",
          { code: "people_list_connection_filter_unavailable" }
        );
      }
      if (input.freshness !== "any" && input.freshness !== "unavailable") {
        throw new PeopleGatewayError(
          "The People list API does not return per-person freshness.",
          { code: "people_list_freshness_filter_unavailable" }
        );
      }
      if (input.recentContact === "7d" || input.recentContact === "30d") {
        throw new PeopleGatewayError(
          "The People list API does not return last-contact timestamps.",
          { code: "people_list_contact_filter_unavailable" }
        );
      }
      const relationshipStatus = mapConnectionFilter(input.connection);
      const recentSort = input.sort === "recent";
      const sort = recentSort ? "updated_at" : "display_name";
      const path = appendQuery("/api/v1/people", {
        userId: options.userId?.trim() || undefined,
        query: input.query.trim() || undefined,
        relationshipStatus,
        source: "both",
        sort,
        direction: recentSort ? "desc" : "asc",
        cursor: input.cursor,
        limit: Math.min(100, Math.max(1, input.limit))
      });
      const body = await requestJson(path);
      const parsed = parseContract(
        peopleListResponseSchema,
        body,
        "People list response"
      );
      for (const person of parsed.people) {
        setBoundedMap(
          personRecords,
          person.id,
          person,
          PEOPLE_PROFILE_CACHE_LIMIT
        );
        setBoundedMap(
          personProfiles,
          person.id,
          mapPersonProfile(person),
          PEOPLE_PROFILE_CACHE_LIMIT
        );
      }
      return adaptPeopleListResponse(body, input, asIsoNow(now));
    },

    getPersonContext: reloadContext,

    async searchLinkableEntities(input) {
      const query = input.query.trim();
      if (query.length < 2) {
        return [];
      }
      const body = await requestJson("/api/v1/entities/search", {
        method: "POST",
        body: JSON.stringify({
          searches: [
            {
              query,
              userIds: [await ownerUserId()],
              includeDeleted: false,
              limit: Math.min(100, Math.max(1, input.limit ?? 40)),
              clientRef: "people-entity-links"
            }
          ]
        })
      });
      return adaptEntityLinkSearchResponse(body, input.excludePersonId);
    },

    async savePerson(input) {
      if (input.id) {
        const current = personProfiles.get(input.id);
        if (
          (!current &&
            (input.aliases.length > 0 ||
              input.contactMethods.length > 0 ||
              input.facts.length > 0)) ||
          (current && nestedPersonChanged(input, current))
        ) {
          throw new PeopleGatewayError(
            "The entity update contract cannot mutate Person aliases, contacts, or facts. Save scalar profile changes separately.",
            { code: "people_nested_update_unavailable" }
          );
        }
        const expectedUpdatedAt =
          input.expectedUpdatedAt ?? personRecords.get(input.id)?.updatedAt;
        if (!expectedUpdatedAt) {
          throw new PeopleGatewayError(
            "Reload this Person before saving so the reviewed version can be sent.",
            { code: "person_version_missing" }
          );
        }
        const patch: Record<string, unknown> = {
          ...scalarPersonInput(input),
          expectedUpdatedAt
        };
        if (input.linkUpdate.mode === "replace_complete") {
          const snapshot = outgoingLinkSnapshots.get(input.id);
          if (!snapshot?.complete) {
            throw new PeopleGatewayError(
              "Reload all linked records before changing Person links. The current link snapshot is bounded or unavailable.",
              { code: "people_links_snapshot_incomplete" }
            );
          }
          patch.links = input.linkUpdate.links;
        }
        const body = parseContract(
          batchResponseSchema,
          await requestJson("/api/v1/entities/update", {
            method: "POST",
            body: JSON.stringify({
              atomic: true,
              operations: [
                {
                  entityType: "person",
                  id: input.id,
                  patch
                }
              ]
            })
          }),
          "Person update batch response"
        );
        const result = body.results[0]!;
        if (!result.ok) {
          throw new PeopleGatewayError(
            result.error?.message ?? "Person update failed inside the batch.",
            {
              code: result.error?.code ?? "people_update_batch_failed",
              status: 200
            }
          );
        }
        if (result.entityType !== "person" || result.id !== input.id) {
          throw new PeopleGatewayError(
            "Person update returned an unexpected operation result.",
            { code: "people_update_response_invalid" }
          );
        }
        return reloadContext(input.id);
      }

      if (input.linkUpdate.mode !== "replace_complete") {
        throw new PeopleGatewayError(
          "A new Person must provide its complete initial link set.",
          { code: "people_create_links_required" }
        );
      }

      const body = parseContract(
        batchResponseSchema,
        await requestJson("/api/v1/entities/create", {
          method: "POST",
          body: JSON.stringify({
            atomic: true,
            operations: [
              {
                entityType: "person",
                data: {
                  userId: await ownerUserId(),
                  ...scalarPersonInput(input),
                  ...nestedPersonInput(input),
                  links: input.linkUpdate.links
                }
              }
            ]
          })
        }),
        "Person create batch response"
      );
      const result = body.results[0]!;
      if (!result.ok) {
        throw new PeopleGatewayError(
          result.error?.message ?? "Person create failed inside the batch.",
          {
            code: result.error?.code ?? "people_create_batch_failed",
            status: 200
          }
        );
      }
      if (result.entityType !== "person" || !result.id) {
        throw new PeopleGatewayError(
          "Person create returned no Person identifier.",
          { code: "people_create_response_invalid" }
        );
      }
      return reloadContext(result.id);
    },

    async listPendingRequests(input) {
      const body = await requestJson(
        appendQuery("/api/v1/peers/requests", {
          status: "pending",
          limit: Math.min(100, Math.max(1, input.limit)),
          cursor: input.cursor
        })
      );
      const response = parseContract(
        requestsResponseSchema,
        body,
        "Peer requests response"
      );
      if (!input.cursor) {
        pendingRequests.clear();
      }
      for (const request of response.requests) {
        pendingRequests.set(request.id, request);
      }
      return {
        requests: response.requests.map(mapPendingRequest),
        nextCursor: response.page.nextCursor,
        partial: response.page.hasMore
      };
    },

    async reviewRequest(input: RequestReviewDecision) {
      const reviewed = pendingRequests.get(input.requestId);
      if (!reviewed) {
        throw new PeopleGatewayError(
          "Reload pending requests before deciding so the reviewed version is available.",
          { code: "peer_request_version_missing" }
        );
      }
      const body = {
        expectedVersion: String(reviewed.version),
        reason: ""
      };
      const accepting = input.decision === "accept";
      const routePath = accepting ? ROUTES.requestAccept : ROUTES.requestReject;
      const path = `/api/v1/peers/requests/${encodeURIComponent(input.requestId)}/${accepting ? "accept" : "reject"}`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath,
        pathParams: { requestId: input.requestId },
        expectedVersion: String(reviewed.version),
        body
      });
      pendingRequests.delete(input.requestId);
    },

    async scanWikiCandidates(personId) {
      await ensureRuntimeCapabilities();
      const query = personId
        ? (personProfiles.get(personId)?.displayName ??
          personRecords.get(personId)?.displayName)
        : undefined;
      const body = await requestJson("/api/v1/people/wiki-candidates/scan", {
        method: "POST",
        body: JSON.stringify({
          userId: await ownerUserId(),
          peopleRootPageId: requireConfigured(
            peopleRootPageId,
            "people_root_page_required",
            "A Wiki People root page id"
          ),
          ...(query ? { query } : {}),
          limit: 100
        })
      });
      const response = parseContract(
        wikiScanResponseSchema,
        body,
        "Wiki People candidate response"
      );
      wikiCandidates.clear();
      for (const candidate of response.candidates) {
        wikiCandidates.set(candidate.noteId, candidate);
      }
      return response.candidates.map(mapWikiCandidate);
    },

    async enrichWikiCandidates(pageIds): Promise<WikiPeopleEnrichment> {
      await ensureRuntimeCapabilities();
      return parseContract(
        wikiPeopleEnrichmentResponseSchema,
        await requestJson("/api/v1/people/wiki-candidates/enrich", {
          method: "POST",
          body: JSON.stringify({
            userId: await ownerUserId(),
            peopleRootPageId: requireConfigured(
              peopleRootPageId,
              "people_root_page_required",
              "A Wiki People root page id"
            ),
            candidateIds: pageIds
          })
        }),
        "Wiki People enrichment response"
      );
    },

    async applyWikiAssociation(input: WikiAssociationInput) {
      const candidate = wikiCandidates.get(input.pageId);
      if (!candidate) {
        throw new PeopleGatewayError(
          "Scan Wiki candidates again before applying an association.",
          { code: "wiki_candidate_version_missing" }
        );
      }
      const person = personRecords.get(input.personId);
      if (input.decision === "associate" && !person) {
        throw new PeopleGatewayError(
          "Reload this Person before associating the Wiki page.",
          { code: "person_version_missing" }
        );
      }
      const decision =
        input.decision === "associate"
          ? {
              wikiPageId: input.pageId,
              action: "associate" as const,
              personId: input.personId,
              expectedWikiVersion: candidate.updatedAt,
              expectedPersonVersion: person!.updatedAt
            }
          : input.decision === "create_person"
            ? {
                wikiPageId: input.pageId,
                action: "create_person" as const,
                displayName:
                  input.personDraft?.displayName.trim() || candidate.title,
                preferredName: input.personDraft?.preferredName ?? "",
                relationshipCategory:
                  input.personDraft?.relationshipCategory ?? "other",
                relationshipLabel:
                  input.personDraft?.relationshipLabel ?? "",
                shortDescription:
                  input.personDraft?.shortDescription ?? candidate.summary,
                aliases: input.personDraft?.aliases ?? candidate.aliases,
                expectedWikiVersion: candidate.updatedAt
              }
            : {
                wikiPageId: input.pageId,
                action: "skip" as const,
                expectedWikiVersion: candidate.updatedAt
              };
      const common = {
        userId: await ownerUserId(),
        peopleRootPageId: requireConfigured(
          peopleRootPageId,
          "people_root_page_required",
          "A Wiki People root page id"
        ),
        decisions: [decision]
      };
      const preview = parseContract(
        wikiPreviewResponseSchema,
        await requestJson("/api/v1/people/wiki-associations/preview", {
          method: "POST",
          body: JSON.stringify(common)
        }),
        "Wiki association preview response"
      );
      const applied = parseContract(
        wikiApplyResponseSchema,
        await requestJson("/api/v1/people/wiki-associations/apply", {
          method: "POST",
          body: JSON.stringify({
            ...common,
            previewId: preview.preview.id,
            previewHash: preview.preview.hash,
            idempotencyKey: makeIdempotencyKey()
          })
        }),
        "Wiki association apply response"
      );
      const personId =
        input.decision === "create_person"
          ? applied.results[0]?.personId
          : input.personId;
      if (!personId) {
        throw new PeopleGatewayError(
          "Wiki association apply did not identify the affected Person.",
          { code: "wiki_apply_person_missing" }
        );
      }
      return reloadContext(personId);
    },

    async importWikiPeople(
      inputs: WikiPersonImportDraft[]
    ): Promise<PersonContext[]> {
      if (inputs.length === 0 || inputs.length > 20) {
        throw new PeopleGatewayError(
          "Choose between 1 and 20 Wiki People pages to import at once.",
          { code: "wiki_people_import_size" }
        );
      }
      const decisions = inputs.map((input) => {
        const candidate = wikiCandidates.get(input.pageId);
        if (!candidate) {
          throw new PeopleGatewayError(
            "Scan Wiki candidates again before importing People.",
            { code: "wiki_candidate_version_missing" }
          );
        }
        return {
          wikiPageId: input.pageId,
          action: "create_person" as const,
          displayName: input.displayName,
          preferredName: input.preferredName,
          relationshipCategory: input.relationshipCategory,
          relationshipLabel: input.relationshipLabel,
          shortDescription: input.shortDescription,
          aliases: input.aliases,
          expectedWikiVersion: candidate.updatedAt
        };
      });
      const common = {
        userId: await ownerUserId(),
        peopleRootPageId: requireConfigured(
          peopleRootPageId,
          "people_root_page_required",
          "A Wiki People root page id"
        ),
        decisions
      };
      const preview = parseContract(
        wikiPreviewResponseSchema,
        await requestJson("/api/v1/people/wiki-associations/preview", {
          method: "POST",
          body: JSON.stringify(common)
        }),
        "Wiki People import preview response"
      );
      const applied = parseContract(
        wikiApplyResponseSchema,
        await requestJson("/api/v1/people/wiki-associations/apply", {
          method: "POST",
          body: JSON.stringify({
            ...common,
            previewId: preview.preview.id,
            previewHash: preview.preview.hash,
            idempotencyKey: makeIdempotencyKey()
          })
        }),
        "Wiki People import response"
      );
      const personIds = applied.results.flatMap((result) =>
        result.personId ? [result.personId] : []
      );
      if (personIds.length !== inputs.length) {
        throw new PeopleGatewayError(
          "Wiki People import did not return every created Person.",
          { code: "wiki_people_import_incomplete" }
        );
      }
      return Promise.all(personIds.map((personId) => reloadContext(personId)));
    },

    async createPairingInvitation(input) {
      await ensureRuntimeCapabilities();
      if (!capabilities.pairingInvitation) {
        throw new PeopleGatewayError(
          "The local peer runtime is not ready to create an invitation.",
          { code: "peer_invitation_runtime_unavailable", retryable: true }
        );
      }
      const body = {
        label:
          input.label ??
          personProfiles.get(input.personId)?.displayName ??
          personRecords.get(input.personId)?.displayName ??
          "",
        expiresInSeconds: Math.max(
          60,
          Math.min(900, Math.round(input.expiresInMinutes * 60))
        ),
        privacyMode: options.privacyMode ?? "fastest",
        transportKinds: options.transportKinds ?? ["local_direct"],
        idempotencyKey: makeIdempotencyKey()
      };
      if (!body.label.trim()) {
        throw new PeopleGatewayError(
          "Reload this Person before creating a labeled pairing invitation.",
          { code: "peer_invitation_label_missing" }
        );
      }
      const response = parseContract(
        invitationResponseSchema,
        await approvedMutation(ROUTES.invitations, {
          ownerUserId: await ownerUserId(),
          method: "POST",
          routePath: ROUTES.invitations,
          pathParams: {},
          expectedVersion: null,
          body
        }),
        "Peer invitation response"
      );
      const status = parseContract(
        invitationStatusResponseSchema,
        await requestJson(
          `/api/v1/peers/invitations/${encodeURIComponent(response.invitation.id)}`
        ),
        "Peer invitation status response"
      );
      if (
        status.invitation.id !== response.invitation.id ||
        status.invitation.status !== "active"
      ) {
        throw new PeopleGatewayError(
          "The created invitation is no longer active.",
          { code: "peer_invitation_state_invalid" }
        );
      }
      setBoundedMap(
        pairingInvitations,
        response.invitation.id,
        {
          expectedVersion: status.invitation.updatedAt,
          status: "active"
        },
        PEOPLE_EPHEMERAL_REVIEW_LIMIT
      );
      return {
        id: response.invitation.id,
        qrPayload: JSON.stringify(response.invitation),
        expiresAt: response.invitation.expiresAt,
        verificationPhrase: null,
        fingerprint: response.invitation.fingerprint,
        oneUse: true,
        expectedVersion: status.invitation.updatedAt,
        status: "active"
      } satisfies PairingInvitation;
    },

    async cancelPairingInvitation(input) {
      const reviewed = pairingInvitations.get(input.invitationId);
      if (
        !reviewed ||
        reviewed.status !== "active" ||
        reviewed.expectedVersion !== input.expectedVersion
      ) {
        throw new PeopleGatewayError(
          "Reload or recreate this invitation before cancellation so its current version can be approved.",
          { code: "peer_invitation_version_missing" }
        );
      }
      const body = { expectedVersion: input.expectedVersion };
      const path = `/api/v1/peers/invitations/${encodeURIComponent(input.invitationId)}`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "DELETE",
        routePath: ROUTES.invitationCancel,
        pathParams: { invitationId: input.invitationId },
        expectedVersion: input.expectedVersion,
        body
      });
      pairingInvitations.set(input.invitationId, {
        expectedVersion: input.expectedVersion,
        status: "canceled"
      });
    },

    async inspectPairingPayload(input) {
      await ensureRuntimeCapabilities();
      const invitation = parseContract(
        peerPairingInviteSchema,
        decodePairingInvitation(input.qrPayload),
        "Scanned peer invitation"
      );
      const body = {
        invitation,
        scannedAt: asIsoNow(now),
        localDeviceId: requireConfigured(
          localDeviceId,
          "peer_local_device_required",
          "A local peer device id"
        ),
        privacyMode: options.privacyMode ?? "fastest",
        idempotencyKey: makeIdempotencyKey()
      };
      const response = parseContract(
        pairingAcceptanceResponseSchema,
        await approvedMutation(ROUTES.pairingAccept, {
          ownerUserId: await ownerUserId(),
          method: "POST",
          routePath: ROUTES.pairingAccept,
          pathParams: {},
          expectedVersion: null,
          body
        }),
        "Peer pairing acceptance response"
      );
      const pairing = response.request.payload;
      const pairingId = response.request.id;
      const review: PairingReview = {
        pairingId,
        expectedVersion: String(response.request.version),
        transcriptHash: readString(pairing, "transcriptHash"),
        personId: input.personId,
        remoteLabel:
          readString(pairing, "remoteLabel") ?? invitation.inviterPrincipalId,
        identityFingerprint: invitation.fingerprint,
        verificationPhrase: readString(pairing, "verificationPhrase"),
        expiresAt: response.request.expiresAt,
        deviceLabel:
          readString(pairing, "deviceLabel") ?? invitation.inviterDeviceId
      };
      setBoundedMap(
        pairingReviews,
        pairingId,
        review,
        PEOPLE_EPHEMERAL_REVIEW_LIMIT
      );
      return review;
    },

    async confirmPairing(input) {
      if (!input.identityConfirmed) {
        throw new PeopleGatewayError(
          "Confirm the out-of-band peer identity before pairing.",
          { code: "pairing_identity_unconfirmed" }
        );
      }
      const review = pairingReviews.get(input.pairingId);
      if (
        !review?.expectedVersion ||
        !review.transcriptHash ||
        !review.verificationPhrase
      ) {
        throw new PeopleGatewayError(
          "The pairing API did not return the version, transcript hash, and verification phrase required by confirm.",
          { code: "peer_pairing_confirmation_material_missing" }
        );
      }
      const body = {
        expectedVersion: review.expectedVersion,
        transcriptHash: review.transcriptHash,
        verificationPhrase: review.verificationPhrase,
        personId: input.personId,
        createPersonDisplayName: null,
        idempotencyKey: makeIdempotencyKey()
      };
      const path = `/api/v1/peers/pairings/${encodeURIComponent(input.pairingId)}/confirm`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath: ROUTES.pairingConfirm,
        pathParams: { pairingId: input.pairingId },
        expectedVersion: review.expectedVersion,
        body
      });
      pairingReviews.delete(input.pairingId);
      return reloadContext(input.personId);
    },

    async previewShareGrant(input: ShareGrantDraft) {
      relationshipForMutation(input.relationshipId);
      const draft = toGrantDraftWire(
        input,
        linkedEntityTypesByPerson.get(input.personId) ?? new Map()
      );
      const body = {
        draft,
        sampleLimit: 25,
        includeWorstCase: true as const
      };
      const response = await requestJson(
        `/api/v1/peers/relationships/${encodeURIComponent(input.relationshipId)}/grants/preview`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const mapped = mapSharePreview(response);
      setBoundedMap(
        grantPreviews,
        mapped.preview.draftHash,
        {
          relationshipId: input.relationshipId,
          relationshipVersion: mapped.relationshipVersion,
          draft
        },
        PEOPLE_EPHEMERAL_REVIEW_LIMIT
      );
      return mapped.preview;
    },

    async proposeShareGrant(input) {
      relationshipForMutation(input.draft.relationshipId);
      const reviewed = grantPreviews.get(input.previewHash);
      const draft = toGrantDraftWire(
        input.draft,
        linkedEntityTypesByPerson.get(input.draft.personId) ?? new Map()
      );
      if (
        !reviewed ||
        reviewed.relationshipId !== input.draft.relationshipId ||
        JSON.stringify(reviewed.draft) !== JSON.stringify(draft)
      ) {
        throw new PeopleGatewayError(
          "Preview this exact grant draft again before proposing it.",
          { code: "peer_grant_preview_stale" }
        );
      }
      const body = {
        expectedRelationshipVersion: reviewed.relationshipVersion,
        previewHash: input.previewHash,
        idempotencyKey: makeIdempotencyKey(),
        draft
      };
      const path = `/api/v1/peers/relationships/${encodeURIComponent(input.draft.relationshipId)}/grants/propose`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath: ROUTES.grantPropose,
        pathParams: { relationshipId: input.draft.relationshipId },
        expectedVersion: reviewed.relationshipVersion,
        body
      });
      grantPreviews.delete(input.previewHash);
      return reloadContext(input.draft.personId);
    },

    async revokeShareGrant(input) {
      if (!input.acknowledgement) {
        throw new PeopleGatewayError(
          "Review the revocation consequence first.",
          {
            code: "peer_revocation_acknowledgement_required"
          }
        );
      }
      const reviewed = grants.get(input.grantId);
      if (!reviewed?.versionHash) {
        throw new PeopleGatewayError(
          "The grant list API did not return the version hash required for revocation.",
          { code: "peer_grant_version_hash_missing" }
        );
      }
      const body = {
        expectedVersionHash: reviewed.versionHash,
        reason: "Revoked from the People security review.",
        purgeManagedCache: true
      };
      const path = `/api/v1/peers/grants/${encodeURIComponent(input.grantId)}/revoke`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath: ROUTES.grantRevoke,
        pathParams: { grantId: input.grantId },
        expectedVersion: reviewed.versionHash,
        body
      });
      const personId = relationshipPersonIds.get(reviewed.grant.relationshipId);
      if (!personId) {
        throw new PeopleGatewayError(
          "Reload the Person to refresh this revoked grant.",
          { code: "peer_grant_person_missing" }
        );
      }
      return reloadContext(personId);
    },

    async revokeRelationship(input) {
      if (!input.acknowledgement) {
        throw new PeopleGatewayError(
          "Review the revocation consequence first.",
          {
            code: "peer_revocation_acknowledgement_required"
          }
        );
      }
      const relationship = relationshipForMutation(input.relationshipId);
      const body = {
        expectedVersion: relationship.updatedAt,
        reason: "Revoked from the People security review.",
        purgeManagedCache: true
      };
      const path = `/api/v1/peers/relationships/${encodeURIComponent(input.relationshipId)}/revoke`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath: ROUTES.relationshipRevoke,
        pathParams: { relationshipId: input.relationshipId },
        expectedVersion: relationship.updatedAt,
        body
      });
      const personId = relationshipPersonIds.get(input.relationshipId);
      if (!personId) {
        throw new PeopleGatewayError(
          "Reload the Person to refresh this revoked relationship.",
          { code: "peer_relationship_person_missing" }
        );
      }
      return reloadContext(personId);
    },

    async removePeerDevice(input) {
      if (!input.acknowledgement) {
        throw new PeopleGatewayError(
          "Review the device-removal consequence first.",
          {
            code: "peer_revocation_acknowledgement_required"
          }
        );
      }
      const relationship = relationshipForMutation(input.relationshipId);
      const body = {
        expectedVersion: relationship.updatedAt,
        reason: "Removed from the People security review."
      };
      const path = `/api/v1/peers/relationships/${encodeURIComponent(input.relationshipId)}/devices/${encodeURIComponent(input.deviceId)}/remove`;
      await approvedMutation(path, {
        ownerUserId: await ownerUserId(),
        method: "POST",
        routePath: ROUTES.deviceRemove,
        pathParams: {
          relationshipId: input.relationshipId,
          deviceId: input.deviceId
        },
        expectedVersion: relationship.updatedAt,
        body
      });
      const personId = relationshipPersonIds.get(input.relationshipId);
      if (!personId) {
        throw new PeopleGatewayError(
          "Reload the Person to refresh the removed device.",
          { code: "peer_device_person_missing" }
        );
      }
      return reloadContext(personId);
    },

    async interpretQuestion(input) {
      const timeZone =
        options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timeZone) {
        throw new PeopleGatewayError(
          "A valid IANA time zone is required to interpret People questions.",
          { code: "people_time_zone_required" }
        );
      }
      const body = await requestJson(
        `/api/v1/people/${encodeURIComponent(input.personId)}/questions/interpret`,
        {
          method: "POST",
          body: JSON.stringify({
            question: input.question,
            timeZone,
            referenceTime: asIsoNow(now)
          })
        }
      );
      const response = parseContract(
        interpretationResponseSchema,
        body,
        "Person question interpretation response"
      );
      if (!response.interpretation.supported) {
        return {
          status: "unsupported",
          typedQueryId: null,
          projectionId: null,
          interpretationLabel: response.interpretation.reason.replaceAll(
            "_",
            " "
          ),
          timeRangeLabel: null,
          requiredGrantLabel: null,
          liveRefreshPossible: false,
          explanation:
            "The question did not map to a registered People projection.",
          execution: null
        } satisfies QuestionInterpretation;
      }
      const execution = {
        interpretationId: response.interpretation.id,
        interpretationHash: response.interpretation.hash,
        query: response.interpretation.query
      };
      setBoundedMap(
        questionExecutions,
        response.interpretation.id,
        { execution, question: input.question.trim() },
        PEOPLE_EPHEMERAL_REVIEW_LIMIT
      );
      return {
        status: "supported",
        typedQueryId: response.interpretation.id,
        projectionId: response.interpretation.projectionId,
        interpretationLabel: response.interpretation.projectionId,
        timeRangeLabel: response.interpretation.query.interval
          ? `${response.interpretation.query.interval.startsAt} to ${response.interpretation.query.interval.endsAt}`
          : null,
        requiredGrantLabel: response.interpretation.projectionId,
        liveRefreshPossible: true,
        explanation: `Mapped with ${response.interpretation.requestedPrecision} precision.`,
        execution
      } satisfies QuestionInterpretation;
    },

    async executeQuestion(input) {
      const reviewed = questionExecutions.get(input.typedQueryId);
      if (!reviewed) {
        throw new PeopleGatewayError(
          "Interpret this question again before executing its exact typed query.",
          { code: "people_question_interpretation_missing" }
        );
      }
      if (reviewed.question !== input.question.trim()) {
        throw new PeopleGatewayError(
          "The question changed after interpretation. Interpret the current question before executing it.",
          { code: "people_question_interpretation_stale" }
        );
      }
      const { execution } = reviewed;
      const body = await requestJson(
        `/api/v1/people/${encodeURIComponent(input.personId)}/questions/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            interpretationId: execution.interpretationId,
            interpretationHash: execution.interpretationHash,
            query: execution.query,
            sourcePreference: input.preferLive
              ? "live_then_cache"
              : "cache_only"
          })
        }
      );
      const response = parseContract(
        questionResultResponseSchema,
        body,
        "Person question result response"
      );
      questionExecutions.delete(input.typedQueryId);
      return {
        typedQueryId: input.typedQueryId,
        answer: displayJsonValue(response.result.payload),
        projectionId:
          response.result.metadata.projectionId ?? execution.query.projectionId,
        sourcePrincipalId: response.result.metadata.source?.principalId ?? null,
        sourceDeviceId: response.result.metadata.source?.deviceId ?? null,
        asOf: response.result.metadata.asOf,
        receivedAt: response.result.metadata.receivedAt,
        freshness:
          response.result.state === "unavailable"
            ? "unavailable"
            : response.result.state,
        precision: response.result.metadata.precision,
        completeness: mapCompleteness(response.result.metadata.completeness),
        redactions: response.result.metadata.redactedFields ?? [],
        live: response.result.state === "live"
      } satisfies QuestionResult;
    }
  };
}

export const defaultPeopleGateway = createHttpPeopleGateway();

const PeopleGatewayContext = createContext<PeopleGateway>(defaultPeopleGateway);

export function PeopleGatewayProvider({
  gateway,
  children
}: {
  gateway: PeopleGateway;
  children: ReactNode;
}) {
  return (
    <PeopleGatewayContext.Provider value={gateway}>
      {children}
    </PeopleGatewayContext.Provider>
  );
}

export function usePeopleGateway() {
  return useContext(PeopleGatewayContext);
}
