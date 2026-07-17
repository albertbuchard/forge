import { PeopleGatewayError } from "@/components/people/people-gateway";
import type {
  PairingInvitation,
  PairingReview,
  PeopleCollectionFilters,
  PeopleConnectionSummary,
  PeopleFreshnessState,
  PeopleGateway,
  PeoplePendingRequest,
  PersonConnectionState,
  PersonContext,
  PersonImportance,
  PersonLocalProfile,
  PersonRelationshipCategory,
  PersonSummary,
  QuestionInterpretation,
  QuestionResult,
  SavePersonInput,
  ShareGrantDraft,
  SharePreview,
  WikiCandidate
} from "@/components/people/people-types";

export const PEOPLE_FIXTURE_NOW = "2026-07-15T12:00:00.000Z";

const GIVEN_NAMES = [
  "Ari",
  "Bea",
  "Cleo",
  "Dara",
  "Eli",
  "Farah",
  "Gio",
  "Hana",
  "Imani",
  "Jules",
  "Kai",
  "Lina",
  "Mara",
  "Nico",
  "Oren",
  "Priya",
  "Quinn",
  "Ravi",
  "Sora",
  "Tala",
  "Uma",
  "Vera",
  "Wren",
  "Xavi",
  "Yara",
  "Zane"
] as const;

const FAMILY_NAMES = [
  "Alden",
  "Bell",
  "Chen",
  "Davis",
  "Evans",
  "Flores",
  "Gupta",
  "Haddad",
  "Ito",
  "Jones",
  "Khan",
  "Lopez",
  "Meyer",
  "Novak",
  "Okafor",
  "Patel",
  "Reed",
  "Silva",
  "Tran",
  "Usman",
  "Vega",
  "Weber",
  "Xu",
  "Young",
  "Zoric"
] as const;

const RELATIONSHIPS: PersonRelationshipCategory[] = [
  "family",
  "friend",
  "partner",
  "colleague",
  "community",
  "professional",
  "other"
];

const IMPORTANCE: PersonImportance[] = ["normal", "high", "essential", "low"];

const CONNECTIONS: PersonConnectionState[] = [
  "paired",
  "local_only",
  "paired",
  "revoked",
  "pending",
  "invited",
  "conflict"
];

const FRESHNESS: PeopleFreshnessState[] = [
  "live",
  "cached",
  "stale",
  "revoked",
  "offline",
  "cached",
  "unavailable"
];

const RELATIONSHIP_LABELS: Record<PersonRelationshipCategory, string> = {
  family: "Family",
  friend: "Friend",
  partner: "Partner",
  colleague: "Colleague",
  community: "Community",
  professional: "Professional contact",
  other: "Personal contact"
};

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function isoOffset(days: number, hours = 0) {
  const date = new Date(PEOPLE_FIXTURE_NOW);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function freshnessLabel(state: PeopleFreshnessState, index: number) {
  switch (state) {
    case "live":
      return "Live now";
    case "cached":
      return `Cached ${1 + (index % 8)}h ago`;
    case "stale":
      return `Stale ${2 + (index % 5)}d`;
    case "offline":
      return "Offline cache";
    case "revoked":
      return "Access revoked";
    case "unavailable":
      return "Unavailable";
  }
}

export function buildSyntheticPeople(count = 72): PersonSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const givenName = GIVEN_NAMES[index % GIVEN_NAMES.length];
    const familyName =
      FAMILY_NAMES[
        Math.floor(index / GIVEN_NAMES.length) % FAMILY_NAMES.length
      ];
    const cycle = Math.floor(
      index / (GIVEN_NAMES.length * FAMILY_NAMES.length)
    );
    const displayName = `${givenName} ${familyName}${cycle ? ` ${cycle + 1}` : ""}`;
    const relationshipCategory = RELATIONSHIPS[index % RELATIONSHIPS.length];
    const freshnessState = FRESHNESS[index % FRESHNESS.length];
    const connectionState = CONNECTIONS[index % CONNECTIONS.length];
    return {
      id: `person_${String(index + 1).padStart(6, "0")}`,
      displayName,
      preferredName: index % 4 === 0 ? givenName : null,
      aliases:
        index % 6 === 0
          ? [`${givenName[0]}. ${familyName}`, `${givenName}y`]
          : [`${givenName[0]}. ${familyName}`],
      relationshipCategory,
      relationshipLabel: RELATIONSHIP_LABELS[relationshipCategory],
      importance: IMPORTANCE[index % IMPORTANCE.length],
      shortDescription:
        index % 3 === 0
          ? "Connected through shared projects and regular check-ins."
          : index % 3 === 1
            ? "Local profile with private relationship context."
            : "Plans and availability are selectively shared.",
      connectionState,
      freshnessState,
      freshnessLabel: freshnessLabel(freshnessState, index),
      sourceLabel:
        connectionState === "local_only" ? "This Forge" : displayName,
      lastContactAt: index % 9 === 0 ? null : isoOffset(-(index % 45), -2),
      updatedAt: isoOffset(-(index % 30)),
      pendingRequestCount: connectionState === "pending" ? 1 : 0
    };
  });
}

function buildLocalProfile(person: PersonSummary): PersonLocalProfile {
  const [givenName, ...familyParts] = person.displayName.split(" ");
  return {
    id: person.id,
    displayName: person.displayName,
    givenName,
    middleName: null,
    familyName: familyParts.join(" ") || null,
    preferredName: person.preferredName,
    pronouns: "they/them",
    aliases: person.aliases,
    relationshipCategory: person.relationshipCategory,
    relationshipLabel: person.relationshipLabel,
    closeness: person.importance === "essential" ? 5 : 3,
    importance: person.importance,
    importanceScore:
      person.importance === "essential"
        ? 5
        : person.importance === "high"
          ? 4
          : person.importance === "normal"
            ? 3
            : 1,
    shortDescription: person.shortDescription,
    description:
      "A synthetic Person fixture used to exercise local context, links, and selective sharing.",
    privateNotes: "Synthetic private note: prefers quiet planning sessions.",
    howWeMet: "Through a synthetic community project.",
    metAt: "2024-05-18",
    birthday: {
      year: null,
      month: 10,
      day: 14,
      precision: "month_day"
    },
    timezone: "Europe/Zurich",
    homePlaceLabel: "Zurich",
    contactMethods: [
      {
        id: `contact_${person.id}`,
        kind: "messaging",
        label: "Signal",
        value: `synthetic-${person.id}`,
        isPrimary: true
      }
    ],
    facts: [
      {
        id: `fact_${person.id}`,
        label: "Preferred check-in",
        value: "Weekday afternoons",
        sensitivity: "personal",
        sourceLabel: "This Forge",
        reviewedAt: isoOffset(-12)
      }
    ],
    updatedAt: person.updatedAt
  };
}

function buildConnection(
  availability: "online" | "degraded" | "offline"
): PeopleConnectionSummary {
  return {
    availability,
    label:
      availability === "online"
        ? "Forge is online"
        : availability === "degraded"
          ? "Using incomplete cached data"
          : "Forge is offline; showing cached local data",
    checkedAt: PEOPLE_FIXTURE_NOW,
    cachedAt: availability === "online" ? null : isoOffset(0, -3)
  };
}

export function buildSyntheticPersonContext(
  person: PersonSummary,
  state: SyntheticPeopleState = "live"
): PersonContext {
  const isRevoked = state === "revoked" || person.connectionState === "revoked";
  const isConflict =
    state === "conflict" || person.connectionState === "conflict";
  const isOffline = state === "offline";
  const isStale = state === "stale" || person.freshnessState === "stale";
  const remoteFreshness: PeopleFreshnessState = isRevoked
    ? "revoked"
    : isOffline
      ? "offline"
      : isStale
        ? "stale"
        : "live";
  const hasPeer = person.connectionState !== "local_only";
  const relationshipId = `relationship_${person.id}`;

  return {
    person: buildLocalProfile(person),
    peer: hasPeer
      ? {
          id: relationshipId,
          version: isoOffset(-1),
          displayLabel: `${person.displayName}'s Forge`,
          status: isRevoked ? "revoked" : isConflict ? "conflict" : "paired",
          verifiedAt: isoOffset(-90),
          lastReachableAt: isOffline ? isoOffset(0, -8) : isoOffset(0, -1),
          transportPrivacyMode: isOffline ? "hide_network_address" : "fastest",
          availability: isOffline ? "offline" : isStale ? "degraded" : "online",
          freshness: remoteFreshness,
          verificationLabel: "ember-lantern-river",
          devices: [
            {
              id: `device_primary_${person.id}`,
              label: "Home Forge",
              deviceType: "server",
              trustState: "approved",
              lastSeenAt: isOffline ? isoOffset(0, -8) : isoOffset(0, -1),
              transportLabel: "Iroh direct",
              freshness: remoteFreshness
            },
            {
              id: `device_pending_${person.id}`,
              label: "New laptop",
              deviceType: "desktop",
              trustState: "pending",
              lastSeenAt: null,
              transportLabel: "Not approved for shared data",
              freshness: "unavailable"
            }
          ]
        }
      : null,
    incomingValues: hasPeer
      ? [
          {
            id: `remote_availability_${person.id}`,
            label: "Availability next Monday",
            value: isRevoked ? null : "Free before 10:00 and after 16:30",
            sourcePrincipalId: `principal_${person.id}`,
            sourceLabel: `${person.displayName}'s Forge`,
            sourceDeviceLabel: "Home Forge",
            asOf: isoOffset(0, -2),
            receivedAt: isoOffset(0, -1),
            validUntil: isoOffset(7),
            freshness: remoteFreshness,
            precision: "30-minute free/busy blocks",
            completeness: isOffline || isStale ? "partial" : "complete",
            redactions: ["Event titles", "Participants", "Locations"]
          },
          {
            id: `remote_goal_${person.id}`,
            label: "Current goal horizon",
            value: isRevoked
              ? null
              : "Complete the community garden proposal this quarter.",
            sourcePrincipalId: `principal_${person.id}`,
            sourceLabel: `${person.displayName}'s Forge`,
            sourceDeviceLabel: "Home Forge",
            asOf: isoOffset(-2),
            receivedAt: isoOffset(-1),
            validUntil: isoOffset(14),
            freshness: remoteFreshness,
            precision: "Quarter summary",
            completeness: "partial",
            redactions: ["Private milestones", "Linked tasks"]
          }
        ]
      : [],
    outgoingShares: hasPeer
      ? [
          {
            projectionIds: ["calendar.availability.v1"],
            label: "Availability",
            direction: "outgoing",
            grantId: `grant_out_${person.id}`,
            grantVersion: 3,
            versionKey: `grant_out_${person.id}:3:${"a".repeat(64)}`,
            state: isRevoked ? "revoked" : isConflict ? "conflicted" : "active",
            purpose: "Coordinate recurring check-ins",
            expiresAt: isoOffset(90),
            precisions: ["free_busy"],
            fields: ["Availability blocks"],
            exclusions: ["Titles", "Locations", "Participants"],
            recipientDeviceIds: [`device_primary_${person.id}`],
            retentionLabel: "Managed cache for 7 days",
            issuedAt: isoOffset(-4),
            versionHash: "a".repeat(64)
          }
        ]
      : [],
    incomingShares: hasPeer
      ? [
          {
            projectionIds: ["goals.horizon_summary.v1"],
            label: "Plans",
            direction: "incoming",
            grantId: `grant_in_${person.id}`,
            grantVersion: 2,
            versionKey: `grant_in_${person.id}:2:${"b".repeat(64)}`,
            state: isRevoked ? "revoked" : "active",
            purpose: "Share current priorities",
            expiresAt: isoOffset(60),
            precisions: ["summary"],
            fields: ["Selected goal title", "Summary", "Horizon"],
            exclusions: ["Private notes", "Task details"],
            recipientDeviceIds: [`device_primary_${person.id}`],
            retentionLabel: "Managed cache for 14 days",
            issuedAt: isoOffset(-7),
            versionHash: "b".repeat(64)
          }
        ]
      : [],
    upcomingTogether: [
      {
        id: `upcoming_${person.id}`,
        title: "Planning check-in",
        startsAt: isoOffset(5, 3),
        endsAt: isoOffset(5, 4),
        source: "local",
        sourceLabel: "This Forge calendar",
        freshness: "live",
        precision: "Exact local event"
      },
      ...(hasPeer
        ? [
            {
              id: `upcoming_remote_${person.id}`,
              title: "Shared busy block",
              startsAt: isoOffset(8, 1),
              endsAt: isoOffset(8, 3),
              source: "remote" as const,
              sourceLabel: `${person.displayName}'s Forge`,
              freshness: remoteFreshness,
              precision: "Free/busy only"
            }
          ]
        : [])
    ],
    linkedRecords: [
      {
        id: `link_project_${person.id}`,
        entityType: "project",
        entityId: "project_synthetic_garden",
        title: "Community garden proposal",
        direction: "outgoing",
        anchorKey: null,
        relationship: "collaborator",
        href: "/projects/project_synthetic_garden",
        state: "active"
      },
      {
        id: `link_event_${person.id}`,
        entityType: "life_event",
        entityId: "life_event_synthetic_retreat",
        title: "Autumn planning retreat",
        direction: "outgoing",
        anchorKey: null,
        relationship: "participant",
        href: "/life-events?focus=life_event_synthetic_retreat",
        state: "active"
      }
    ],
    wikiProfile: {
      pageId: `wiki_${person.id}`,
      title: person.displayName,
      spaceLabel: "People",
      excerpt: "Synthetic Wiki profile preserved as an associated page.",
      href: `/wiki/page/${encodeURIComponent(person.displayName)}`,
      associatedAt: isoOffset(-40),
      completeness: "complete"
    },
    audit: [
      {
        id: `audit_1_${person.id}`,
        eventType: "person.updated",
        summary: "Local relationship context updated.",
        actorLabel: "Operator",
        occurredAt: isoOffset(-2),
        source: "local"
      },
      {
        id: `audit_2_${person.id}`,
        eventType: isRevoked ? "share.revoked" : "projection.received",
        summary: isRevoked
          ? "Future projection access stopped and managed cache withdrawal applied."
          : "A bounded owner-authoritative projection was received.",
        actorLabel: isRevoked ? "Operator" : `${person.displayName}'s Forge`,
        occurredAt: isoOffset(-1),
        source: isRevoked ? "local" : "remote"
      }
    ],
    coverage: {
      linkedRecords: "complete",
      wikiProfile: "complete",
      upcomingTogether: "complete",
      audit: "complete",
      sharedValues: "complete",
      peerDevices: "complete",
      grants: "complete"
    },
    connection: buildConnection(
      isOffline ? "offline" : isStale ? "degraded" : "online"
    ),
    partial: state === "partial" || isOffline || isStale,
    conflictMessage: isConflict
      ? "Two signed grant versions conflict. Review both versions and issue a new version; Forge will not merge or reactivate either automatically."
      : null,
    revocationMessage: isRevoked
      ? "Future access has stopped. Managed Forge caches followed the signed withdrawal policy. Information already viewed or copied outside Forge cannot be made unseen."
      : null
  };
}

export const SYNTHETIC_WIKI_CANDIDATES: WikiCandidate[] = [
  {
    pageId: "wiki_candidate_mara",
    title: "Mara Alden",
    spaceLabel: "People",
    pathLabel: "People / Friends / Mara Alden",
    excerpt: "Met through the community garden project.",
    aliases: ["Mara", "M. Alden"],
    matchReason: "Exact display-name and alias match",
    alreadyAssociatedPersonId: null,
    expectedWikiVersion: isoOffset(-1)
  },
  {
    pageId: "wiki_candidate_mara_notes",
    title: "Mara - planning notes",
    spaceLabel: "People",
    pathLabel: "People / Archive / Mara - planning notes",
    excerpt: "Older planning context that may describe the same person.",
    aliases: ["Mara"],
    matchReason: "Ambiguous alias match",
    alreadyAssociatedPersonId: null,
    expectedWikiVersion: isoOffset(-2)
  },
  {
    pageId: "wiki_candidate_associated",
    title: "Ari Alden",
    spaceLabel: "People",
    pathLabel: "People / Ari Alden",
    excerpt: "Already associated with another Person record.",
    aliases: ["Ari"],
    matchReason: "Exact name match with an existing association",
    alreadyAssociatedPersonId: "person_999999",
    expectedWikiVersion: isoOffset(-3)
  }
];

export const SYNTHETIC_PENDING_REQUESTS: PeoplePendingRequest[] = [
  {
    id: "request_pairing_001",
    version: "1",
    kind: "pairing",
    personId: "person_000005",
    personLabel: "Eli Alden",
    title: "Verify a new Forge relationship",
    summary: "A pairing transcript is ready for identity verification.",
    receivedAt: isoOffset(0, -1),
    expiresAt: isoOffset(3650),
    direction: "incoming",
    identityFingerprint: "8D4A 72B1 3F90 6CE2",
    verificationPhrase: "ember lantern river",
    requestedProjections: [],
    requestedFields: [],
    requestedDeviceLabel: "Eli's Home Forge",
    consequence:
      "Accepting establishes the verified relationship but shares no projections by itself."
  },
  {
    id: "request_device_001",
    version: "2",
    kind: "device",
    personId: "person_000001",
    personLabel: "Ari Alden",
    title: "Approve a new recipient device",
    summary: "Ari added a laptop. It has no projection access until approved.",
    receivedAt: isoOffset(0, -3),
    expiresAt: null,
    direction: "incoming",
    identityFingerprint: "541C 0E77 9A25 11B4",
    verificationPhrase: null,
    requestedProjections: ["calendar.availability.v1"],
    requestedFields: ["Free/busy blocks"],
    requestedDeviceLabel: "New laptop",
    consequence:
      "Approval allows active grants that explicitly permit approved current devices to reach this device."
  },
  {
    id: "request_grant_001",
    version: "3",
    kind: "grant",
    personId: "person_000003",
    personLabel: "Cleo Alden",
    title: "Review an incoming Plans grant",
    summary: "Cleo proposes sharing selected goal summaries for 60 days.",
    receivedAt: isoOffset(-1),
    expiresAt: isoOffset(3650),
    direction: "incoming",
    identityFingerprint: null,
    verificationPhrase: null,
    requestedProjections: ["goals.horizon_summary.v1"],
    requestedFields: ["Selected goal title", "Summary", "Horizon"],
    requestedDeviceLabel: "Cleo's Home Forge",
    consequence:
      "Acceptance stores only the signed bounded projection and its stated cache policy."
  }
];

export type SyntheticPeopleState =
  | "live"
  | "empty"
  | "offline"
  | "partial"
  | "error"
  | "stale"
  | "revoked"
  | "conflict"
  | "large";

export type SyntheticGatewayCall = {
  operation: keyof PeopleGateway;
  input: unknown;
};

export type SyntheticGatewaySnapshot = {
  people: PersonSummary[];
  pendingRequests: PeoplePendingRequest[];
  calls: SyntheticGatewayCall[];
};

export type SyntheticPeopleGateway = PeopleGateway & {
  inspect(): SyntheticGatewaySnapshot;
};

function matchesFilters(
  person: PersonSummary,
  filters: PeopleCollectionFilters
) {
  const needle = filters.query.trim().toLocaleLowerCase();
  if (
    needle &&
    ![
      person.displayName,
      person.preferredName ?? "",
      ...person.aliases,
      person.shortDescription ?? "",
      person.relationshipLabel ?? ""
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle)
  ) {
    return false;
  }
  if (
    filters.relationship !== "any" &&
    person.relationshipCategory !== filters.relationship
  ) {
    return false;
  }
  if (
    filters.importance !== "any" &&
    person.importance !== filters.importance
  ) {
    return false;
  }
  if (
    filters.connection !== "any" &&
    person.connectionState !== filters.connection
  ) {
    return false;
  }
  if (
    filters.freshness !== "any" &&
    person.freshnessState !== filters.freshness
  ) {
    return false;
  }
  if (filters.recentContact !== "any") {
    if (filters.recentContact === "none") {
      return person.lastContactAt === null;
    }
    if (!person.lastContactAt) {
      return false;
    }
    const days = filters.recentContact === "7d" ? 7 : 30;
    const threshold = Date.parse(PEOPLE_FIXTURE_NOW) - days * 86_400_000;
    if (Date.parse(person.lastContactAt) < threshold) {
      return false;
    }
  }
  return true;
}

function sortPeople(
  people: PersonSummary[],
  sort: PeopleCollectionFilters["sort"]
) {
  return [...people].sort((left, right) => {
    if (sort === "recent") {
      return (right.lastContactAt ?? "").localeCompare(
        left.lastContactAt ?? ""
      );
    }
    return left.displayName.localeCompare(right.displayName);
  });
}

export function createSyntheticPeopleGateway({
  state = "live",
  count = state === "large" ? 10_000 : 72,
  latencyMs = 0
}: {
  state?: SyntheticPeopleState;
  count?: number;
  latencyMs?: number;
} = {}): SyntheticPeopleGateway {
  let people = state === "empty" ? [] : buildSyntheticPeople(count);
  let pendingRequests =
    state === "empty" ? [] : clone(SYNTHETIC_PENDING_REQUESTS);
  const calls: SyntheticGatewayCall[] = [];
  const contexts = new Map<string, PersonContext>();

  const wait = async () => {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
  };

  const record = <TOperation extends keyof PeopleGateway>(
    operation: TOperation,
    input: unknown
  ) => {
    calls.push({ operation, input: clone(input) });
  };

  const findPerson = (personId: string) => {
    const person = people.find((candidate) => candidate.id === personId);
    if (!person) {
      throw new PeopleGatewayError("Person not found.", {
        code: "person_not_found",
        status: 404
      });
    }
    return person;
  };

  const contextFor = (personId: string) => {
    const existing = contexts.get(personId);
    if (existing) {
      return existing;
    }
    const next = buildSyntheticPersonContext(findPerson(personId), state);
    contexts.set(personId, next);
    return next;
  };

  const failIfRequired = () => {
    if (state === "error") {
      throw new PeopleGatewayError("Synthetic People service failure.", {
        code: "people_fixture_failure",
        status: 503,
        retryable: true
      });
    }
  };

  const gateway: SyntheticPeopleGateway = {
    capabilities: {
      wikiAssociation: true,
      pairingInvitation: true,
      pairingAcceptance: true
    },

    inspect() {
      return clone({ people, pendingRequests, calls });
    },

    async listPeople(input) {
      record("listPeople", input);
      await wait();
      failIfRequired();
      const filtered = sortPeople(
        people.filter((person) => matchesFilters(person, input)),
        input.sort
      );
      const offset = Number.parseInt(input.cursor ?? "0", 10) || 0;
      const page = filtered.slice(offset, offset + input.limit);
      const nextOffset = offset + page.length;
      const availability =
        state === "offline"
          ? "offline"
          : state === "stale" || state === "partial"
            ? "degraded"
            : "online";
      return clone({
        people: page,
        total: filtered.length,
        nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
        partial:
          state === "partial" || state === "offline" || state === "stale",
        connection: buildConnection(availability)
      });
    },

    async getPersonContext(personId) {
      record("getPersonContext", personId);
      await wait();
      failIfRequired();
      return clone(contextFor(personId));
    },

    async searchLinkableEntities(input) {
      record("searchLinkableEntities", input);
      await wait();
      failIfRequired();
      const query = input.query.trim().toLocaleLowerCase();
      const candidates = [
        {
          entityType: "project",
          entityId: "project_synthetic_garden",
          label: "Community garden proposal",
          description: "Shared planning project"
        },
        {
          entityType: "life_event",
          entityId: "life_event_synthetic_retreat",
          label: "Autumn planning retreat",
          description: "Upcoming life event"
        },
        ...people
          .filter((person) => person.id !== input.excludePersonId)
          .map((person) => ({
            entityType: "person",
            entityId: person.id,
            label: person.displayName,
            description: person.shortDescription
          }))
      ].filter((candidate) =>
        `${candidate.label} ${candidate.description ?? ""}`
          .toLocaleLowerCase()
          .includes(query)
      );
      return clone(candidates.slice(0, input.limit ?? 40));
    },

    async savePerson(input: SavePersonInput) {
      record("savePerson", input);
      await wait();
      failIfRequired();
      const id =
        input.id ?? `person_${String(people.length + 1).padStart(6, "0")}`;
      const existingIndex = people.findIndex((person) => person.id === id);
      const summary: PersonSummary = {
        id,
        displayName: input.displayName.trim(),
        preferredName: input.preferredName,
        aliases: input.aliases,
        relationshipCategory: input.relationshipCategory,
        relationshipLabel: input.relationshipLabel,
        importance: input.importance,
        shortDescription: input.shortDescription,
        connectionState:
          existingIndex >= 0
            ? people[existingIndex].connectionState
            : "local_only",
        freshnessState: "live",
        freshnessLabel: "Updated now",
        sourceLabel: "This Forge",
        lastContactAt:
          existingIndex >= 0 ? people[existingIndex].lastContactAt : null,
        updatedAt: PEOPLE_FIXTURE_NOW,
        pendingRequestCount: 0
      };
      if (existingIndex >= 0) {
        people = people.map((person, index) =>
          index === existingIndex ? summary : person
        );
      } else {
        people = [summary, ...people];
      }
      const context = buildSyntheticPersonContext(summary, state);
      context.person = {
        ...context.person,
        ...input,
        id,
        contactMethods: input.contactMethods.map((method, index) => ({
          ...method,
          id: `contact_${id}_${index + 1}`
        })),
        facts: input.facts.map((fact, index) => ({
          ...fact,
          id: `fact_${id}_${index + 1}`,
          reviewedAt: PEOPLE_FIXTURE_NOW
        })),
        updatedAt: PEOPLE_FIXTURE_NOW
      };
      if (input.linkUpdate.mode === "replace_complete") {
        const incomingLinks =
          existingIndex >= 0
            ? (contexts.get(id)?.linkedRecords ?? []).filter(
                (link) => link.direction === "incoming"
              )
            : [];
        context.linkedRecords = [
          ...input.linkUpdate.links.map((link, index) => ({
            id: `link_${id}_${index + 1}`,
            entityType: link.entityType,
            entityId: link.entityId,
            title: null,
            direction: "outgoing" as const,
            anchorKey: link.anchorKey,
            relationship: link.relationship,
            href: null,
            state: "active" as const
          })),
          ...incomingLinks
        ];
      } else if (existingIndex >= 0) {
        context.linkedRecords = clone(contextFor(id).linkedRecords);
      }
      contexts.set(id, context);
      return clone(context);
    },

    async listPendingRequests(input) {
      record("listPendingRequests", input);
      await wait();
      failIfRequired();
      const offset = Number.parseInt(input.cursor ?? "0", 10) || 0;
      const requests = pendingRequests.slice(offset, offset + input.limit);
      const nextOffset = offset + requests.length;
      return clone({
        requests,
        nextCursor:
          nextOffset < pendingRequests.length ? String(nextOffset) : null,
        partial: nextOffset < pendingRequests.length
      });
    },

    async reviewRequest(input) {
      record("reviewRequest", input);
      await wait();
      failIfRequired();
      pendingRequests = pendingRequests.filter(
        (request) => request.id !== input.requestId
      );
    },

    async scanWikiCandidates(personId) {
      record("scanWikiCandidates", personId ?? null);
      await wait();
      failIfRequired();
      return clone(SYNTHETIC_WIKI_CANDIDATES);
    },

    async enrichWikiCandidates(pageIds) {
      record("enrichWikiCandidates", pageIds);
      await wait();
      failIfRequired();
      const selected = SYNTHETIC_WIKI_CANDIDATES.filter((candidate) =>
        pageIds.includes(candidate.pageId)
      );
      return clone({
        llmAvailable: true,
        enriched: true,
        profile: {
          id: "llm_profile_synthetic_people",
          label: "Synthetic People extractor",
          model: "synthetic"
        },
        suggestions: selected.map((candidate) => ({
          pageId: candidate.pageId,
          displayName: candidate.title,
          preferredName: candidate.aliases[0] ?? "",
          relationshipCategory: "other" as const,
          relationshipLabel: "",
          shortDescription: candidate.excerpt ?? "",
          aliases: candidate.aliases
        }))
      });
    },

    async applyWikiAssociation(input) {
      record("applyWikiAssociation", input);
      await wait();
      failIfRequired();
      const context = clone(contextFor(input.personId));
      if (input.decision === "associate") {
        const candidate = SYNTHETIC_WIKI_CANDIDATES.find(
          (item) => item.pageId === input.pageId
        );
        if (candidate) {
          context.wikiProfile = {
            pageId: candidate.pageId,
            title: candidate.title,
            spaceLabel: candidate.spaceLabel,
            excerpt: candidate.excerpt,
            href: `/wiki/page/${encodeURIComponent(candidate.pageId)}`,
            associatedAt: PEOPLE_FIXTURE_NOW,
            completeness: "complete"
          };
        }
      }
      contexts.set(input.personId, context);
      return clone(context);
    },

    async importWikiPeople(inputs) {
      record("importWikiPeople", inputs);
      await wait();
      failIfRequired();
      if (inputs.length === 0 || inputs.length > 20) {
        throw new PeopleGatewayError(
          "Choose between 1 and 20 Wiki People pages to import at once.",
          { code: "wiki_people_import_size" }
        );
      }
      const imported = inputs.map((input, index) => {
        const candidate = SYNTHETIC_WIKI_CANDIDATES.find(
          (item) => item.pageId === input.pageId
        );
        if (!candidate) {
          throw new PeopleGatewayError(
            "Scan Wiki candidates again before importing People.",
            { code: "wiki_candidate_version_missing" }
          );
        }
        const id = `person_${String(people.length + index + 1).padStart(6, "0")}`;
        const summary: PersonSummary = {
          id,
          displayName: input.displayName.trim(),
          preferredName: input.preferredName || null,
          aliases: input.aliases,
          relationshipCategory: input.relationshipCategory,
          relationshipLabel: input.relationshipLabel || null,
          importance: "normal",
          shortDescription: input.shortDescription || null,
          connectionState: "local_only",
          freshnessState: "live",
          freshnessLabel: "Imported now",
          sourceLabel: "Wiki People",
          lastContactAt: null,
          updatedAt: PEOPLE_FIXTURE_NOW,
          pendingRequestCount: 0
        };
        const context = buildSyntheticPersonContext(summary, state);
        context.wikiProfile = {
          pageId: candidate.pageId,
          title: candidate.title,
          spaceLabel: candidate.spaceLabel,
          excerpt: candidate.excerpt,
          href: `/wiki/page/${encodeURIComponent(candidate.pageId)}`,
          associatedAt: PEOPLE_FIXTURE_NOW,
          completeness: "complete"
        };
        contexts.set(id, context);
        return { summary, context };
      });
      people = [...imported.map(({ summary }) => summary), ...people];
      return clone(imported.map(({ context }) => context));
    },

    async createPairingInvitation(input) {
      record("createPairingInvitation", input);
      await wait();
      failIfRequired();
      const invitation: PairingInvitation = {
        id: `invite_${input.personId}`,
        qrPayload: `forge-peer://invite/synthetic-${input.personId}-one-use-secret`,
        expiresAt: new Date(
          Date.now() + Math.max(1, input.expiresInMinutes) * 60_000
        ).toISOString(),
        verificationPhrase: "ember-lantern-river",
        fingerprint: "8D4A72B13F906CE2",
        oneUse: true,
        expectedVersion: PEOPLE_FIXTURE_NOW,
        status: "active"
      };
      return invitation;
    },

    async cancelPairingInvitation(input) {
      record("cancelPairingInvitation", input);
      await wait();
      failIfRequired();
    },

    async inspectPairingPayload(input) {
      record("inspectPairingPayload", {
        personId: input.personId,
        qrPayload: "[redacted in fixture call ledger]"
      });
      await wait();
      failIfRequired();
      if (!input.qrPayload.startsWith("forge-peer://")) {
        throw new PeopleGatewayError("This is not a Forge peer invitation.", {
          code: "pairing_payload_invalid",
          status: 400
        });
      }
      const review: PairingReview = {
        pairingId: `pairing_${input.personId}`,
        expectedVersion: "1",
        transcriptHash: "c".repeat(64),
        personId: input.personId,
        remoteLabel: `${findPerson(input.personId).displayName}'s Forge`,
        identityFingerprint: "8D4A 72B1 3F90 6CE2",
        verificationPhrase: "ember-lantern-river",
        expiresAt: isoOffset(0, 1),
        deviceLabel: "Home Forge"
      };
      return review;
    },

    async confirmPairing(input) {
      record("confirmPairing", input);
      await wait();
      failIfRequired();
      if (!input.identityConfirmed) {
        throw new PeopleGatewayError("Identity confirmation is required.", {
          code: "pairing_identity_unconfirmed",
          status: 400
        });
      }
      const context = clone(contextFor(input.personId));
      context.peer = buildSyntheticPersonContext(
        { ...findPerson(input.personId), connectionState: "paired" },
        "live"
      ).peer;
      contexts.set(input.personId, context);
      return clone(context);
    },

    async previewShareGrant(input: ShareGrantDraft) {
      record("previewShareGrant", input);
      await wait();
      failIfRequired();
      const person = findPerson(input.personId);
      const preview: SharePreview = {
        draftHash: `preview_${input.personId}_${input.preset}_${input.horizonDays}`,
        directionLabel: `You share with ${person.displayName}`,
        representativeOutput: [
          input.preset === "availability"
            ? "Monday 09:00-10:00: busy"
            : "One selected summary at the chosen precision"
        ],
        worstCaseOutput: [
          `${input.horizonDays} days of ${input.projections.join(", ") || "selected projection"}`,
          `${input.fields.length} explicitly selected field${input.fields.length === 1 ? "" : "s"}`
        ],
        excludedOutput: input.exclusions.length
          ? input.exclusions
          : [
              "Secrets",
              "Agent credentials",
              "Private notes",
              "Raw health samples"
            ],
        expiryLabel: input.expiresAt
          ? `Expires ${input.expiresAt}`
          : "No automatic expiry selected",
        freshnessLabel: "Live when reachable; signed cached output otherwise",
        retentionLabel: `Managed recipient cache for ${input.retentionDays} days`,
        recipientDeviceIds: input.recipientDeviceIds,
        warnings:
          input.preset === "broad"
            ? ["Broad share still excludes sensitive and unsupported data."]
            : []
      };
      return preview;
    },

    async proposeShareGrant(input) {
      record("proposeShareGrant", input);
      await wait();
      failIfRequired();
      if (state === "conflict") {
        throw new PeopleGatewayError(
          "A newer signed grant version arrived while this preview was open.",
          { code: "grant_version_conflict", status: 409 }
        );
      }
      const context = clone(contextFor(input.draft.personId));
      context.outgoingShares = [
        {
          projectionIds: [input.draft.projections[0] ?? "person.profile.v1"],
          label: input.draft.preset.replaceAll("_", " "),
          direction: "outgoing",
          grantId: `grant_fixture_${input.draft.personId}`,
          grantVersion: 1,
          versionKey: `grant_fixture_${input.draft.personId}:1:${"d".repeat(64)}`,
          state: "active",
          purpose: input.draft.purpose,
          expiresAt: input.draft.expiresAt,
          precisions: [input.draft.precision],
          fields: input.draft.fields,
          exclusions: input.draft.exclusions,
          recipientDeviceIds: input.draft.recipientDeviceIds,
          retentionLabel: `Managed cache for ${input.draft.retentionDays} days`,
          issuedAt: PEOPLE_FIXTURE_NOW,
          versionHash: "d".repeat(64)
        },
        ...context.outgoingShares
      ];
      contexts.set(input.draft.personId, context);
      return clone(context);
    },

    async revokeShareGrant(input) {
      record("revokeShareGrant", input);
      await wait();
      failIfRequired();
      const person = people.find((candidate) =>
        contextFor(candidate.id).outgoingShares.some(
          (grant) => grant.grantId === input.grantId
        )
      );
      if (!person) {
        throw new PeopleGatewayError("Share grant not found.", {
          code: "grant_not_found",
          status: 404
        });
      }
      const context = clone(contextFor(person.id));
      context.outgoingShares = context.outgoingShares.map((grant) =>
        grant.grantId === input.grantId ? { ...grant, state: "revoked" } : grant
      );
      context.revocationMessage =
        "Future access has stopped. Managed Forge caches followed the signed withdrawal policy. Information already viewed or copied outside Forge cannot be made unseen.";
      contexts.set(person.id, context);
      return clone(context);
    },

    async revokeRelationship(input) {
      record("revokeRelationship", input);
      await wait();
      failIfRequired();
      const person = people.find(
        (candidate) =>
          contextFor(candidate.id).peer?.id === input.relationshipId
      );
      if (!person) {
        throw new PeopleGatewayError("Peer relationship not found.", {
          code: "relationship_not_found",
          status: 404
        });
      }
      const context = clone(contextFor(person.id));
      if (context.peer) {
        context.peer.status = "revoked";
        context.peer.freshness = "revoked";
      }
      context.revocationMessage =
        "Future access has stopped. Managed Forge caches followed the signed withdrawal policy. Information already viewed or copied outside Forge cannot be made unseen.";
      contexts.set(person.id, context);
      return clone(context);
    },

    async removePeerDevice(input) {
      record("removePeerDevice", input);
      await wait();
      failIfRequired();
      const person = people.find(
        (candidate) =>
          contextFor(candidate.id).peer?.id === input.relationshipId
      );
      if (!person) {
        throw new PeopleGatewayError("Peer relationship not found.", {
          code: "relationship_not_found",
          status: 404
        });
      }
      const context = clone(contextFor(person.id));
      if (context.peer) {
        context.peer.devices = context.peer.devices.map((device) =>
          device.id === input.deviceId
            ? { ...device, trustState: "removed", freshness: "revoked" }
            : device
        );
      }
      contexts.set(person.id, context);
      return clone(context);
    },

    async interpretQuestion(input) {
      record("interpretQuestion", input);
      await wait();
      failIfRequired();
      const normalized = input.question.toLocaleLowerCase();
      const revoked =
        state === "revoked" ||
        contextFor(input.personId).peer?.status === "revoked";
      let result: QuestionInterpretation;
      if (normalized.includes("next monday") || normalized.includes("doing")) {
        result = {
          status: revoked ? "missing_grant" : "supported",
          typedQueryId: revoked ? null : "calendar.availability.v1:next-monday",
          projectionId: "calendar.availability.v1",
          interpretationLabel: "Availability for next Monday",
          timeRangeLabel: "Next Monday, 00:00-24:00 Europe/Zurich",
          requiredGrantLabel: "Availability",
          liveRefreshPossible: !revoked && state !== "offline",
          explanation: revoked
            ? "The prior grant is revoked. Asking does not request or restore permission."
            : "Forge mapped this locally to the registered availability query.",
          execution: revoked
            ? null
            : {
                interpretationId: "interpretation_calendar_fixture",
                interpretationHash: "e".repeat(64),
                query: {
                  projectionId: "calendar.availability.v1",
                  parameters: {},
                  interval: null,
                  entityIds: [],
                  fields: ["startsAt", "endsAt", "state"],
                  precision: "free_busy",
                  maximumResultCount: 100
                }
              }
        };
      } else if (normalized.includes("goal")) {
        result = {
          status: "supported",
          typedQueryId: "goals.horizon_summary.v1:quarter",
          projectionId: "goals.horizon_summary.v1",
          interpretationLabel: "Selected goal summaries for this quarter",
          timeRangeLabel: "Current quarter",
          requiredGrantLabel: "Plans",
          liveRefreshPossible: state !== "offline",
          explanation:
            "Forge mapped this locally to the registered goal-horizon query.",
          execution: {
            interpretationId: "interpretation_goals_fixture",
            interpretationHash: "f".repeat(64),
            query: {
              projectionId: "goals.horizon_summary.v1",
              parameters: {},
              interval: null,
              entityIds: [],
              fields: ["title", "shortDescription", "status", "horizon"],
              precision: "summary",
              maximumResultCount: 100
            }
          }
        };
      } else if (normalized.includes("cycl")) {
        result = {
          status: "missing_grant",
          typedQueryId: null,
          projectionId: "health.cycling.aggregate.v1",
          interpretationLabel: "Cycling aggregate for the requested period",
          timeRangeLabel: "Past 30 days",
          requiredGrantLabel: "Activity",
          liveRefreshPossible: false,
          explanation:
            "No Activity grant covers this aggregate. Forge will not send the question or request permission automatically.",
          execution: null
        };
      } else {
        result = {
          status: "unsupported",
          typedQueryId: null,
          projectionId: null,
          interpretationLabel: "No registered typed query matched",
          timeRangeLabel: null,
          requiredGrantLabel: null,
          liveRefreshPossible: false,
          explanation:
            "Forge only sends registered typed questions. This prompt was not sent to the other person's Forge or to a remote language model.",
          execution: null
        };
      }
      return result;
    },

    async executeQuestion(input) {
      record("executeQuestion", input);
      await wait();
      failIfRequired();
      const isGoal = input.typedQueryId.startsWith("goals.");
      const result: QuestionResult = {
        typedQueryId: input.typedQueryId,
        answer: isGoal
          ? "Complete the community garden proposal this quarter."
          : "Free before 10:00 and after 16:30.",
        projectionId: isGoal
          ? "goals.horizon_summary.v1"
          : "calendar.availability.v1",
        sourcePrincipalId: `principal_${input.personId}`,
        sourceDeviceId: `device_primary_${input.personId}`,
        asOf: isoOffset(0, -2),
        receivedAt: isoOffset(0, -1),
        freshness:
          state === "offline"
            ? "offline"
            : state === "stale"
              ? "stale"
              : "live",
        precision: isGoal ? "Quarter summary" : "30-minute free/busy blocks",
        completeness:
          state === "offline" || state === "stale" ? "partial" : "complete",
        redactions: isGoal
          ? ["Private milestones", "Task details"]
          : ["Event titles", "Participants", "Locations"],
        live: input.preferLive && state !== "offline"
      };
      return result;
    }
  };

  return gateway;
}
