export type PersonImportance = "low" | "normal" | "high" | "essential";

export type PersonConnectionState =
  | "local_only"
  | "invited"
  | "pending"
  | "paired"
  | "paused"
  | "conflict"
  | "revoked"
  | "unknown";

export type PeopleFreshnessState =
  | "live"
  | "cached"
  | "stale"
  | "offline"
  | "revoked"
  | "unavailable";

export type PeopleAvailability = "online" | "degraded" | "offline" | "unknown";

export type PersonRelationshipCategory =
  | "family"
  | "friend"
  | "partner"
  | "colleague"
  | "community"
  | "professional"
  | "other";

export type PersonSummary = {
  id: string;
  displayName: string;
  preferredName: string | null;
  aliases: string[];
  relationshipCategory: PersonRelationshipCategory;
  relationshipLabel: string | null;
  importance: PersonImportance;
  shortDescription: string | null;
  connectionState: PersonConnectionState;
  freshnessState: PeopleFreshnessState;
  freshnessLabel: string;
  sourceLabel: string;
  lastContactAt: string | null;
  updatedAt: string;
  pendingRequestCount: number | null;
};

export type PeopleCollectionFilters = {
  query: string;
  relationship: PersonRelationshipCategory | "any";
  importance: PersonImportance | "any";
  connection: PersonConnectionState | "any";
  freshness: PeopleFreshnessState | "any";
  recentContact: "any" | "7d" | "30d" | "none";
  sort: "name" | "recent";
};

export type PeopleCollectionRequest = PeopleCollectionFilters & {
  cursor?: string;
  limit: number;
};

export type PeopleConnectionSummary = {
  availability: PeopleAvailability;
  label: string;
  checkedAt: string;
  cachedAt: string | null;
};

export type PeopleCollectionPage = {
  people: PersonSummary[];
  total: number | null;
  nextCursor: string | null;
  partial: boolean;
  connection: PeopleConnectionSummary;
};

export type PersonContactMethod = {
  id: string;
  kind:
    | "email"
    | "phone"
    | "messaging"
    | "social"
    | "address"
    | "website"
    | "custom";
  label: string;
  value: string;
  isPrimary: boolean;
};

export type PersonFact = {
  id: string;
  label: string;
  value: string;
  sensitivity: "ordinary" | "personal" | "sensitive";
  sourceLabel: string;
  reviewedAt: string | null;
};

export type PersonLocalProfile = {
  id: string;
  displayName: string;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  preferredName: string | null;
  pronouns: string | null;
  aliases: string[];
  relationshipCategory: PersonRelationshipCategory;
  relationshipLabel: string | null;
  closeness: number | null;
  importance: PersonImportance;
  importanceScore: number | null;
  shortDescription: string | null;
  description: string | null;
  privateNotes: string | null;
  howWeMet: string | null;
  metAt: string | null;
  birthday: {
    year: number | null;
    month: number | null;
    day: number | null;
    precision: "unknown" | "year" | "month_day" | "year_month" | "full";
  };
  timezone: string | null;
  homePlaceLabel: string | null;
  contactMethods: PersonContactMethod[];
  facts: PersonFact[];
  updatedAt: string;
};

export type RemoteValue<TValue> = {
  id: string;
  label: string;
  value: TValue | null;
  sourcePrincipalId: string | null;
  sourceLabel: string | null;
  sourceDeviceLabel: string | null;
  asOf: string;
  receivedAt: string;
  validUntil: string | null;
  freshness: PeopleFreshnessState;
  precision: string;
  completeness: "complete" | "partial" | "unknown";
  redactions: string[] | null;
};

export type SharedProjection = {
  projectionIds: string[];
  label: string;
  direction: "incoming" | "outgoing";
  grantId: string;
  grantVersion: number;
  versionKey: string;
  state:
    | "draft"
    | "proposed"
    | "active"
    | "countered"
    | "rejected"
    | "revoked"
    | "superseded"
    | "expired"
    | "conflicted";
  purpose: string | null;
  expiresAt: string | null;
  precisions: string[];
  fields: string[];
  exclusions: string[];
  recipientDeviceIds: string[];
  retentionLabel: string;
  issuedAt: string;
  versionHash: string | null;
};

export type PersonUpcomingItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  source: "local" | "remote";
  sourceLabel: string;
  freshness: PeopleFreshnessState;
  precision: string;
};

export type PersonLinkedRecord = {
  id: string;
  entityType: string;
  entityId: string;
  title: string | null;
  direction: "outgoing" | "incoming";
  anchorKey: string | null;
  relationship: string;
  href: string | null;
  state: "active" | "deleted" | "unavailable";
};

export type PersonEntityLinkInput = {
  entityType: string;
  entityId: string;
  anchorKey: string | null;
  relationship: string;
};

export type PeopleEntityLinkCandidate = {
  entityType: string;
  entityId: string;
  label: string;
  description: string | null;
};

export type PersonWikiProfile = {
  pageId: string;
  title: string | null;
  spaceLabel: string | null;
  excerpt: string | null;
  href: string | null;
  associatedAt: string;
  completeness: "complete" | "metadata_only";
} | null;

export type PersonContextCoverage = {
  linkedRecords: "complete" | "bounded";
  wikiProfile: "complete" | "metadata_only" | "none";
  upcomingTogether: "complete" | "unavailable";
  audit: "complete" | "unavailable";
  sharedValues: "complete" | "metadata_only" | "none";
  peerDevices: "complete" | "unavailable";
  grants: "complete" | "unavailable";
};

export type PeerDevice = {
  id: string;
  label: string;
  deviceType: string;
  trustState: "approved" | "pending" | "removed" | "revoked" | "compromised";
  lastSeenAt: string | null;
  transportLabel: string | null;
  freshness: PeopleFreshnessState;
};

export type PersonPeerRelationship = {
  id: string;
  version: string;
  displayLabel: string;
  status: PersonConnectionState;
  verifiedAt: string | null;
  lastReachableAt: string | null;
  transportPrivacyMode: "fastest" | "hide_network_address" | "custom";
  availability: PeopleAvailability;
  freshness: PeopleFreshnessState;
  verificationLabel: string | null;
  devices: PeerDevice[];
} | null;

export type PersonAuditEvent = {
  id: string;
  eventType: string;
  summary: string;
  actorLabel: string;
  occurredAt: string;
  source: "local" | "remote";
};

export type PersonContext = {
  person: PersonLocalProfile;
  peer: PersonPeerRelationship;
  incomingValues: RemoteValue<string>[];
  outgoingShares: SharedProjection[];
  incomingShares: SharedProjection[];
  upcomingTogether: PersonUpcomingItem[];
  linkedRecords: PersonLinkedRecord[];
  wikiProfile: PersonWikiProfile;
  audit: PersonAuditEvent[];
  coverage: PersonContextCoverage;
  connection: PeopleConnectionSummary;
  partial: boolean;
  conflictMessage: string | null;
  revocationMessage: string | null;
};

export type PeopleRequestKind = "pairing" | "device" | "grant";

export type PeoplePendingRequest = {
  id: string;
  version: string | null;
  kind: PeopleRequestKind;
  personId: string | null;
  personLabel: string;
  title: string;
  summary: string;
  receivedAt: string;
  expiresAt: string | null;
  direction: "incoming" | "outgoing" | "unknown";
  identityFingerprint: string | null;
  verificationPhrase: string | null;
  requestedProjections: string[];
  requestedFields: string[];
  requestedDeviceLabel: string | null;
  consequence: string;
};

export type PeoplePendingRequestsPage = {
  requests: PeoplePendingRequest[];
  nextCursor: string | null;
  partial: boolean;
};

export type PersonLinkUpdate =
  | { mode: "unchanged" }
  | { mode: "replace_complete"; links: PersonEntityLinkInput[] };

export type SavePersonInput = Omit<
  PersonLocalProfile,
  "id" | "contactMethods" | "facts" | "updatedAt"
> & {
  id?: string;
  expectedUpdatedAt?: string;
  contactMethods: Array<Omit<PersonContactMethod, "id">>;
  facts: Array<Omit<PersonFact, "id" | "reviewedAt">>;
  linkUpdate: PersonLinkUpdate;
};

export type WikiCandidate = {
  pageId: string;
  title: string;
  spaceLabel: string;
  pathLabel: string;
  excerpt: string | null;
  aliases: string[];
  matchReason: string;
  alreadyAssociatedPersonId: string | null;
  expectedWikiVersion: string;
};

export type WikiAssociationInput = {
  personId: string;
  pageId: string;
  decision: "associate" | "create_person" | "skip";
  personDraft?: WikiPersonImportDraft;
};

export type WikiPersonImportDraft = {
  pageId: string;
  displayName: string;
  preferredName: string;
  relationshipCategory: PersonRelationshipCategory;
  relationshipLabel: string;
  shortDescription: string;
  aliases: string[];
};

export type WikiPeopleEnrichment = {
  llmAvailable: boolean;
  enriched: boolean;
  profile: { id: string; label: string; model: string } | null;
  suggestions: WikiPersonImportDraft[];
};

export type PairingInvitation = {
  id: string;
  qrPayload: string | null;
  expiresAt: string;
  verificationPhrase: string | null;
  fingerprint: string;
  oneUse: true;
  expectedVersion: string;
  status: "active" | "expired" | "canceled";
};

export type PairingReview = {
  pairingId: string;
  expectedVersion: string | null;
  transcriptHash: string | null;
  personId: string | null;
  remoteLabel: string;
  identityFingerprint: string;
  verificationPhrase: string | null;
  expiresAt: string;
  deviceLabel: string;
};

export type PeerTypedQuestion = {
  projectionId: string;
  parameters: Record<string, unknown>;
  interval: {
    startsAt: string;
    endsAt: string;
    timeZone: string;
  } | null;
  entityIds: string[];
  fields: string[];
  precision: string;
  maximumResultCount: number;
};

export type SharePreset =
  | "availability"
  | "plans"
  | "activity"
  | "selected_records"
  | "broad";

export type ShareGrantDraft = {
  personId: string;
  relationshipId: string;
  direction: "outgoing";
  preset: SharePreset;
  purpose: string;
  projections: string[];
  fields: string[];
  selectedRecordIds: string[];
  exclusions: string[];
  precision: string;
  horizonDays: number;
  expiresAt: string | null;
  retentionDays: number;
  recipientDeviceIds: string[];
};

export type SharePreview = {
  draftHash: string;
  directionLabel: string;
  representativeOutput: string[];
  worstCaseOutput: string[];
  excludedOutput: string[];
  expiryLabel: string;
  freshnessLabel: string;
  retentionLabel: string;
  recipientDeviceIds: string[];
  warnings: string[];
};

export type QuestionInterpretation = {
  status: "supported" | "missing_grant" | "unsupported";
  typedQueryId: string | null;
  projectionId: string | null;
  interpretationLabel: string;
  timeRangeLabel: string | null;
  requiredGrantLabel: string | null;
  liveRefreshPossible: boolean;
  explanation: string;
  execution: {
    interpretationId: string;
    interpretationHash: string;
    query: PeerTypedQuestion;
  } | null;
};

export type QuestionResult = {
  typedQueryId: string;
  answer: string;
  projectionId: string;
  sourcePrincipalId: string | null;
  sourceDeviceId: string | null;
  asOf: string;
  receivedAt: string;
  freshness: PeopleFreshnessState;
  precision: string;
  completeness: "complete" | "partial" | "unknown";
  redactions: string[];
  live: boolean;
};

export type RequestReviewDecision = {
  requestId: string;
  decision: "accept" | "reject";
  recentAuthenticationConfirmed: boolean;
};

export type PeopleGatewayCapabilities = {
  wikiAssociation: boolean;
  pairingInvitation: boolean;
  pairingAcceptance: boolean;
};

export interface PeopleGateway {
  readonly capabilities: PeopleGatewayCapabilities;
  listPeople(request: PeopleCollectionRequest): Promise<PeopleCollectionPage>;
  getPersonContext(personId: string): Promise<PersonContext>;
  searchLinkableEntities(input: {
    query: string;
    excludePersonId?: string;
    limit?: number;
  }): Promise<PeopleEntityLinkCandidate[]>;
  savePerson(input: SavePersonInput): Promise<PersonContext>;
  listPendingRequests(input: {
    cursor?: string;
    limit: number;
  }): Promise<PeoplePendingRequestsPage>;
  reviewRequest(input: RequestReviewDecision): Promise<void>;
  scanWikiCandidates(personId?: string): Promise<WikiCandidate[]>;
  enrichWikiCandidates(pageIds: string[]): Promise<WikiPeopleEnrichment>;
  applyWikiAssociation(input: WikiAssociationInput): Promise<PersonContext>;
  importWikiPeople(inputs: WikiPersonImportDraft[]): Promise<PersonContext[]>;
  createPairingInvitation(input: {
    personId: string;
    label?: string;
    expiresInMinutes: number;
  }): Promise<PairingInvitation>;
  cancelPairingInvitation(input: {
    invitationId: string;
    expectedVersion: string;
  }): Promise<void>;
  inspectPairingPayload(input: {
    personId: string;
    qrPayload: string;
  }): Promise<PairingReview>;
  confirmPairing(input: {
    pairingId: string;
    personId: string;
    identityConfirmed: boolean;
  }): Promise<PersonContext>;
  previewShareGrant(input: ShareGrantDraft): Promise<SharePreview>;
  proposeShareGrant(input: {
    draft: ShareGrantDraft;
    previewHash: string;
  }): Promise<PersonContext>;
  revokeShareGrant(input: {
    grantId: string;
    acknowledgement: boolean;
  }): Promise<PersonContext>;
  revokeRelationship(input: {
    relationshipId: string;
    acknowledgement: boolean;
  }): Promise<PersonContext>;
  removePeerDevice(input: {
    relationshipId: string;
    deviceId: string;
    acknowledgement: boolean;
  }): Promise<PersonContext>;
  interpretQuestion(input: {
    personId: string;
    question: string;
  }): Promise<QuestionInterpretation>;
  executeQuestion(input: {
    personId: string;
    question: string;
    typedQueryId: string;
    preferLive: boolean;
  }): Promise<QuestionResult>;
}
