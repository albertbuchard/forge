import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  peerActorContextSchema,
  peerFieldPathSchema,
  peerGrantSignerSchema,
  peerProjectionIdSchema,
  peerShareGrantVersionSchema,
  type PeerActorContext,
  type PeerGrantSigner,
  type PeerShareGrantVersion,
  type PeerShareRule
} from "../peer-sharing-types.js";
import { validateProjectionRule } from "./peer-projections.js";

const HUMAN_GRANT_SCOPE = "peer:grants:manage";
const DEFAULT_REAUTH_WINDOW_MS = 5 * 60 * 1_000;
const GRANT_SIGNATURE_DOMAIN = Buffer.from(
  "forge-peer/grant-signature/v1\0",
  "utf8"
);

const peerAccessRequestSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(240),
    relationshipId: z.string().trim().min(1).max(240),
    requestingDeviceId: z.string().trim().min(1).max(240),
    projectionId: peerProjectionIdSchema,
    requestedFields: z.array(peerFieldPathSchema).min(1).max(256),
    requestedPrecision: z.string().trim().min(1).max(80),
    entityIds: z.array(z.string().trim().min(1).max(240)).max(5_000).optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    requestedResultCount: z.number().int().min(1).max(10_000).optional(),
    requestedPayloadBytes: z.number().int().min(0).max(10_485_760).optional()
  })
  .strict();

export type PeerAccessRequest = z.input<typeof peerAccessRequestSchema>;

export type PeerGrantEvaluationContext = {
  now?: Date;
  verifiedGrantHash: string;
  verifiedSignerDeviceIds: readonly string[];
  approvedRelationshipDeviceIds: readonly string[];
};

export type PeerAccessDecision =
  | {
      allowed: true;
      grantId: string;
      grantSequence: number;
      ruleId: string;
      effectiveFields: string[];
      redactedFields: string[];
      maximumResultCount: number;
      maximumPayloadBytes: number;
      precision: string;
    }
  | {
      allowed: false;
      reason:
        | "grant_not_active"
        | "grant_not_effective"
        | "grant_expired"
        | "grant_revoked"
        | "grant_verification_failed"
        | "grant_policy_invalid"
        | "owner_mismatch"
        | "relationship_mismatch"
        | "projection_denied"
        | "projection_not_granted"
        | "device_not_approved"
        | "entity_not_granted"
        | "time_not_granted"
        | "precision_not_granted"
        | "result_limit_exceeded"
        | "payload_limit_exceeded"
        | "no_fields_granted";
    };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function canonicalPeerGrantJson(grant: PeerShareGrantVersion): string {
  return JSON.stringify(canonicalize(canonicalPeerGrantValue(grant)));
}

function canonicalPeerGrantValue(grant: PeerShareGrantVersion) {
  const parsed = peerShareGrantVersionSchema.parse(grant);
  return {
    ...parsed,
    rules: parsed.rules
      .map((rule) => ({
        ...rule,
        entitySelector:
          rule.entitySelector === null
            ? null
            : {
                ...rule.entitySelector,
                entityIds: [...rule.entitySelector.entityIds].sort()
              },
        fields: {
          include: [...rule.fields.include].sort(),
          exclude: [...rule.fields.exclude].sort()
        },
        approvedDeviceIds: [...rule.approvedDeviceIds].sort()
      }))
      .sort((left, right) =>
        `${left.projectionId}:${left.effect}:${left.id}`.localeCompare(
          `${right.projectionId}:${right.effect}:${right.id}`
        )
      ),
    signatures: [...parsed.signatures].sort((left, right) =>
      `${left.party}:${left.deviceId}`.localeCompare(
        `${right.party}:${right.deviceId}`
      )
    )
  };
}

export function canonicalPeerGrantConsentJson(
  grant: PeerShareGrantVersion
): string {
  const canonical = canonicalPeerGrantValue(grant);
  const { revokedAt: _revokedAt, signatures: _signatures, status: _status, ...consent } =
    canonical;
  return JSON.stringify(canonicalize(consent));
}

export function peerGrantSignaturePayload(
  grant: PeerShareGrantVersion,
  signer: PeerGrantSigner
): Uint8Array {
  const parsedSigner = peerGrantSignerSchema.parse(signer);
  return new Uint8Array(
    Buffer.concat([
      GRANT_SIGNATURE_DOMAIN,
      Buffer.from(canonicalPeerGrantConsentJson(grant), "utf8"),
      Buffer.from("\0", "utf8"),
      Buffer.from(JSON.stringify(canonicalize(parsedSigner)), "utf8")
    ])
  );
}

export function hashPeerGrantVersion(grant: PeerShareGrantVersion): string {
  return createHash("sha256").update(canonicalPeerGrantJson(grant)).digest("hex");
}

function secureHashEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function validateNextPeerGrantVersion(
  previous: PeerShareGrantVersion,
  candidate: PeerShareGrantVersion
): PeerShareGrantVersion {
  const parsedPrevious = peerShareGrantVersionSchema.parse(previous);
  const parsedCandidate = peerShareGrantVersionSchema.parse(candidate);

  if (
    parsedCandidate.ownerUserId !== parsedPrevious.ownerUserId ||
    parsedCandidate.relationshipId !== parsedPrevious.relationshipId ||
    parsedCandidate.direction !== parsedPrevious.direction
  ) {
    throw new Error("Grant versions cannot change owner, relationship, or direction.");
  }
  if (parsedCandidate.sequence !== parsedPrevious.sequence + 1) {
    throw new Error("Grant version sequence must increase by exactly one.");
  }
  const expectedHash = hashPeerGrantVersion(parsedPrevious);
  if (
    parsedCandidate.previousVersionHash === null ||
    !secureHashEquals(parsedCandidate.previousVersionHash, expectedHash)
  ) {
    throw new Error("Grant version does not extend the accepted hash chain.");
  }
  if (Date.parse(parsedCandidate.issuedAt) < Date.parse(parsedPrevious.issuedAt)) {
    throw new Error("Grant issue timestamps cannot move backward.");
  }
  if (parsedCandidate.status === "active" && parsedCandidate.signatures.length < 2) {
    throw new Error("An active grant requires signatures from both sides.");
  }
  if (
    ["rejected", "revoked", "superseded", "expired"].includes(
      parsedPrevious.status
    )
  ) {
    throw new Error("A terminal grant version cannot be extended or reactivated.");
  }
  return parsedCandidate;
}

export function assertHumanGrantActor(
  actor: PeerActorContext,
  options: {
    ownerUserId: string;
    now?: Date;
    maximumReauthAgeMs?: number;
  }
): PeerActorContext {
  const parsed = peerActorContextSchema.parse(actor);
  if (
    parsed.principalClass !== "operator_session" &&
    parsed.principalClass !== "companion_consent"
  ) {
    throw new Error("Only a human-controlled session may change sharing grants.");
  }
  if (parsed.ownerUserId !== options.ownerUserId) {
    throw new Error("The human session does not own this sharing relationship.");
  }
  if (!parsed.scopes.includes(HUMAN_GRANT_SCOPE)) {
    throw new Error("The human session lacks the grant-management scope.");
  }
  if (parsed.userPresenceAt === null) {
    throw new Error("Recent user presence is required to change sharing grants.");
  }
  if (parsed.principalClass === "companion_consent" && parsed.deviceId === null) {
    throw new Error("Companion consent must be bound to the approving device.");
  }
  const now = (options.now ?? new Date()).getTime();
  const requestedMaximumAge =
    options.maximumReauthAgeMs ?? DEFAULT_REAUTH_WINDOW_MS;
  if (!Number.isFinite(requestedMaximumAge) || requestedMaximumAge < 0) {
    throw new Error("The user-presence window is invalid.");
  }
  const maximumAge = Math.min(requestedMaximumAge, DEFAULT_REAUTH_WINDOW_MS);
  const presenceAge = now - Date.parse(parsed.userPresenceAt);
  const authenticationAge = now - Date.parse(parsed.authenticatedAt);
  if (
    presenceAge < 0 ||
    presenceAge > maximumAge ||
    authenticationAge < 0 ||
    authenticationAge > maximumAge ||
    Date.parse(parsed.userPresenceAt) < Date.parse(parsed.authenticatedAt)
  ) {
    throw new Error("Recent user presence has expired.");
  }
  return parsed;
}

function hasApprovedDevice(
  rule: PeerShareRule,
  deviceId: string,
  approvedRelationshipDeviceIds: ReadonlySet<string>
): boolean {
  if (!approvedRelationshipDeviceIds.has(deviceId)) {
    return false;
  }
  return (
    rule.devicePolicy === "approved_current_devices" ||
    rule.approvedDeviceIds.includes(deviceId)
  );
}

function entitySelectorAllows(rule: PeerShareRule, entityIds: string[]): boolean {
  if (rule.entitySelector === null || rule.entitySelector.mode === "all_shareable") {
    return true;
  }
  if (entityIds.length === 0) {
    return false;
  }
  const allowed = new Set(rule.entitySelector.entityIds);
  return entityIds.every((entityId) => allowed.has(entityId));
}

function timePolicyAllows(
  rule: PeerShareRule,
  startsAt: string | null,
  endsAt: string | null,
  now: Date
): boolean {
  const policy = rule.time;
  const requestedStart = startsAt === null ? null : Date.parse(startsAt);
  const requestedEnd = endsAt === null ? null : Date.parse(endsAt);
  if (
    (requestedStart !== null && !Number.isFinite(requestedStart)) ||
    (requestedEnd !== null && !Number.isFinite(requestedEnd))
  ) {
    return false;
  }
  if ((requestedStart === null) !== (requestedEnd === null)) {
    return false;
  }
  const policyHasBounds =
    policy.startsAt !== null ||
    policy.endsAt !== null ||
    policy.rollingPastDays !== null ||
    policy.rollingFutureDays !== null;
  if (policyHasBounds && (requestedStart === null || requestedEnd === null)) {
    return false;
  }
  if (
    policy.startsAt !== null &&
    requestedStart !== null &&
    requestedStart < Date.parse(policy.startsAt)
  ) {
    return false;
  }
  if (
    policy.endsAt !== null &&
    requestedEnd !== null &&
    requestedEnd > Date.parse(policy.endsAt)
  ) {
    return false;
  }
  const nowMs = now.getTime();
  if (
    policy.rollingPastDays !== null &&
    requestedStart !== null &&
    requestedStart < nowMs - policy.rollingPastDays * 86_400_000
  ) {
    return false;
  }
  if (
    policy.rollingFutureDays !== null &&
    requestedEnd !== null &&
    requestedEnd > nowMs + policy.rollingFutureDays * 86_400_000
  ) {
    return false;
  }
  return requestedStart === null || requestedEnd === null || requestedStart < requestedEnd;
}

function effectiveFields(rule: PeerShareRule, requestedFields: string[]) {
  const included = new Set(rule.fields.include);
  const excluded = new Set(rule.fields.exclude);
  const allowed = requestedFields.filter(
    (field) => included.has(field) && !excluded.has(field)
  );
  const redacted = requestedFields.filter((field) => !allowed.includes(field));
  return { allowed, redacted };
}

function ruleMatchesProjection(rule: PeerShareRule, request: PeerAccessRequest) {
  return rule.projectionId === request.projectionId;
}

export function evaluatePeerProjectionAccess(
  grant: PeerShareGrantVersion,
  request: PeerAccessRequest,
  context: PeerGrantEvaluationContext
): PeerAccessDecision {
  const parsedGrant = peerShareGrantVersionSchema.parse(grant);
  const parsedRequest = peerAccessRequestSchema.parse(request);
  const now = context.now ?? new Date();
  if (parsedGrant.ownerUserId !== parsedRequest.ownerUserId) {
    return { allowed: false, reason: "owner_mismatch" };
  }
  if (parsedGrant.relationshipId !== parsedRequest.relationshipId) {
    return { allowed: false, reason: "relationship_mismatch" };
  }
  if (parsedGrant.status !== "active") {
    return { allowed: false, reason: "grant_not_active" };
  }
  if (
    parsedGrant.effectiveAt !== null &&
    Date.parse(parsedGrant.effectiveAt) > now.getTime()
  ) {
    return { allowed: false, reason: "grant_not_effective" };
  }
  if (parsedGrant.expiresAt !== null && Date.parse(parsedGrant.expiresAt) <= now.getTime()) {
    return { allowed: false, reason: "grant_expired" };
  }
  if (parsedGrant.revokedAt !== null && Date.parse(parsedGrant.revokedAt) <= now.getTime()) {
    return { allowed: false, reason: "grant_revoked" };
  }
  if (
    !secureHashEquals(hashPeerGrantVersion(parsedGrant), context.verifiedGrantHash)
  ) {
    return { allowed: false, reason: "grant_verification_failed" };
  }
  const verifiedSignerDeviceIds = new Set(context.verifiedSignerDeviceIds);
  const verifiedParties = new Set(
    parsedGrant.signatures
      .filter((signature) => verifiedSignerDeviceIds.has(signature.deviceId))
      .map((signature) => signature.party)
  );
  if (!verifiedParties.has("grantor") || !verifiedParties.has("grantee")) {
    return { allowed: false, reason: "grant_verification_failed" };
  }
  try {
    for (const rule of parsedGrant.rules) {
      validateProjectionRule(rule);
    }
  } catch {
    return { allowed: false, reason: "grant_policy_invalid" };
  }

  const matchingRules = parsedGrant.rules.filter((rule) =>
    ruleMatchesProjection(rule, parsedRequest)
  );
  if (matchingRules.some((rule) => rule.effect === "deny")) {
    return { allowed: false, reason: "projection_denied" };
  }
  const allowRules = matchingRules.filter((rule) => rule.effect === "allow");
  if (allowRules.length === 0) {
    return { allowed: false, reason: "projection_not_granted" };
  }

  let sawApprovedDevice = false;
  let sawEntityMatch = false;
  let sawTimeMatch = false;
  let sawPrecisionMatch = false;
  const approvedRelationshipDeviceIds = new Set(
    context.approvedRelationshipDeviceIds
  );
  for (const rule of allowRules) {
    if (
      !hasApprovedDevice(
        rule,
        parsedRequest.requestingDeviceId,
        approvedRelationshipDeviceIds
      )
    ) {
      continue;
    }
    sawApprovedDevice = true;
    if (!entitySelectorAllows(rule, parsedRequest.entityIds ?? [])) {
      continue;
    }
    sawEntityMatch = true;
    if (
      !timePolicyAllows(
        rule,
        parsedRequest.startsAt ?? null,
        parsedRequest.endsAt ?? null,
        now
      )
    ) {
      continue;
    }
    sawTimeMatch = true;
    if (
      parsedRequest.requestedPrecision !== rule.precision
    ) {
      continue;
    }
    sawPrecisionMatch = true;
    if ((parsedRequest.requestedResultCount ?? 1) > rule.maximumResultCount) {
      return { allowed: false, reason: "result_limit_exceeded" };
    }
    if ((parsedRequest.requestedPayloadBytes ?? 0) > rule.maximumPayloadBytes) {
      return { allowed: false, reason: "payload_limit_exceeded" };
    }
    const fields = effectiveFields(
      rule,
      Array.from(new Set(parsedRequest.requestedFields))
    );
    if (fields.allowed.length === 0) {
      return { allowed: false, reason: "no_fields_granted" };
    }
    return {
      allowed: true,
      grantId: parsedGrant.id,
      grantSequence: parsedGrant.sequence,
      ruleId: rule.id,
      effectiveFields: fields.allowed,
      redactedFields: fields.redacted,
      maximumResultCount: rule.maximumResultCount,
      maximumPayloadBytes: rule.maximumPayloadBytes,
      precision: rule.precision
    };
  }

  if (!sawApprovedDevice) {
    return { allowed: false, reason: "device_not_approved" };
  }
  if (!sawEntityMatch) {
    return { allowed: false, reason: "entity_not_granted" };
  }
  if (!sawTimeMatch) {
    return { allowed: false, reason: "time_not_granted" };
  }
  if (!sawPrecisionMatch) {
    return { allowed: false, reason: "precision_not_granted" };
  }
  return { allowed: false, reason: "projection_not_granted" };
}

function isSubset<T>(candidate: T[], baseline: T[]): boolean {
  const baselineSet = new Set(baseline);
  return candidate.every((item) => baselineSet.has(item));
}

function nullableLowerBoundIsNarrower(
  candidate: string | null,
  baseline: string | null
): boolean {
  return (
    baseline === null ||
    (candidate !== null && Date.parse(candidate) >= Date.parse(baseline))
  );
}

function nullableUpperBoundIsNarrower(
  candidate: string | null,
  baseline: string | null
): boolean {
  return (
    baseline === null ||
    (candidate !== null && Date.parse(candidate) <= Date.parse(baseline))
  );
}

function rollingWindowIsNarrower(
  candidate: number | null,
  baseline: number | null
): boolean {
  return baseline === null || (candidate !== null && candidate <= baseline);
}

function entitySelectorIsNarrower(
  candidate: PeerShareRule["entitySelector"],
  baseline: PeerShareRule["entitySelector"]
): boolean {
  if (baseline === null) {
    return true;
  }
  if (baseline.mode === "all_shareable") {
    if (candidate === null) {
      return baseline.entityType === undefined;
    }
    if (
      baseline.entityType !== undefined &&
      candidate.entityType !== baseline.entityType
    ) {
      return false;
    }
    return true;
  }
  return (
    candidate?.mode === "selected" &&
    candidate.entityType === baseline.entityType &&
    isSubset(candidate.entityIds, baseline.entityIds)
  );
}

function devicePolicyIsNarrower(
  candidate: PeerShareRule,
  baseline: PeerShareRule
): boolean {
  if (baseline.devicePolicy === "explicit") {
    return (
      candidate.devicePolicy === "explicit" &&
      isSubset(candidate.approvedDeviceIds, baseline.approvedDeviceIds)
    );
  }
  return candidate.devicePolicy === "approved_current_devices" ||
    candidate.devicePolicy === "explicit";
}

function aggregationPolicyIsNarrower(
  candidate: PeerShareRule["aggregation"],
  baseline: PeerShareRule["aggregation"]
): boolean {
  if (baseline === null || candidate === null) {
    return baseline === candidate;
  }
  return (
    candidate.minimumRecords >= baseline.minimumRecords &&
    candidate.granularity === baseline.granularity &&
    candidate.privacyBudget <= baseline.privacyBudget &&
    candidate.maximumQueriesPerDay <= baseline.maximumQueriesPerDay
  );
}

function allowRuleIsNarrowerOrEqual(
  candidate: PeerShareRule,
  baseline: PeerShareRule
) {
  if (
    candidate.effect !== "allow" ||
    baseline.effect !== "allow" ||
    candidate.projectionId !== baseline.projectionId ||
    candidate.maximumResultCount > baseline.maximumResultCount ||
    candidate.maximumPayloadBytes > baseline.maximumPayloadBytes ||
    !devicePolicyIsNarrower(candidate, baseline) ||
    !isSubset(candidate.fields.include, baseline.fields.include)
  ) {
    return false;
  }
  if (!isSubset(baseline.fields.exclude, candidate.fields.exclude)) {
    return false;
  }
  if (
    !entitySelectorIsNarrower(candidate.entitySelector, baseline.entitySelector) ||
    !nullableLowerBoundIsNarrower(
      candidate.time.startsAt,
      baseline.time.startsAt
    ) ||
    !nullableUpperBoundIsNarrower(candidate.time.endsAt, baseline.time.endsAt) ||
    !rollingWindowIsNarrower(
      candidate.time.rollingPastDays,
      baseline.time.rollingPastDays
    ) ||
    !rollingWindowIsNarrower(
      candidate.time.rollingFutureDays,
      baseline.time.rollingFutureDays
    ) ||
    candidate.precision !== baseline.precision ||
    !aggregationPolicyIsNarrower(candidate.aggregation, baseline.aggregation)
  ) {
    return false;
  }
  return true;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function reviewedGrantPolicyValue(grant: PeerShareGrantVersion) {
  const canonical = canonicalPeerGrantValue(grant);
  const { signatures: _signatures, status: _status, ...reviewed } = canonical;
  return reviewed;
}

export function peerGrantMatchesReviewedPolicy(
  candidate: PeerShareGrantVersion,
  reviewed: PeerShareGrantVersion
): boolean {
  return sameCanonicalValue(
    reviewedGrantPolicyValue(candidate),
    reviewedGrantPolicyValue(reviewed)
  );
}

function cachePolicyIsNarrower(
  candidate: PeerShareGrantVersion["cachePolicy"],
  baseline: PeerShareGrantVersion["cachePolicy"]
): boolean {
  return (
    (candidate.mode === baseline.mode || candidate.mode === "none") &&
    candidate.maximumRetentionSeconds <= baseline.maximumRetentionSeconds &&
    (!baseline.purgeOnRevocation || candidate.purgeOnRevocation)
  );
}

export function assertCounterProposalNarrowsGrant(
  baseline: PeerShareGrantVersion,
  candidate: PeerShareGrantVersion
): void {
  const parsedBaseline = peerShareGrantVersionSchema.parse(baseline);
  const parsedCandidate = validateNextPeerGrantVersion(baseline, candidate);
  if (parsedCandidate.status !== "countered") {
    throw new Error("A counter-proposal grant version must use countered status.");
  }
  if (!cachePolicyIsNarrower(parsedCandidate.cachePolicy, parsedBaseline.cachePolicy)) {
    throw new Error("A counter-proposal cannot widen remote cache retention.");
  }
  const baselineEffectiveAt =
    parsedBaseline.effectiveAt ?? parsedBaseline.issuedAt;
  const candidateEffectiveAt =
    parsedCandidate.effectiveAt ?? parsedCandidate.issuedAt;
  if (Date.parse(candidateEffectiveAt) < Date.parse(baselineEffectiveAt)) {
    throw new Error("A counter-proposal cannot become effective earlier.");
  }
  if (
    !nullableUpperBoundIsNarrower(
      parsedCandidate.expiresAt,
      parsedBaseline.expiresAt
    )
  ) {
    throw new Error("A counter-proposal cannot extend grant expiry.");
  }

  const baselineAllows = new Map(
    parsedBaseline.rules
      .filter((rule) => rule.effect === "allow")
      .map((rule) => [`${rule.projectionId}:${rule.id}`, rule] as const)
  );
  const candidateDenies = new Map(
    parsedCandidate.rules
      .filter((rule) => rule.effect === "deny")
      .map((rule) => [`${rule.projectionId}:${rule.id}`, rule] as const)
  );
  for (const baselineDeny of parsedBaseline.rules.filter(
    (rule) => rule.effect === "deny"
  )) {
    const candidateDeny = candidateDenies.get(
      `${baselineDeny.projectionId}:${baselineDeny.id}`
    );
    if (!candidateDeny || !sameCanonicalValue(candidateDeny, baselineDeny)) {
      throw new Error("A counter-proposal cannot remove or narrow an existing deny rule.");
    }
  }
  for (const candidateRule of parsedCandidate.rules.filter(
    (rule) => rule.effect === "allow"
  )) {
    const baselineRule = baselineAllows.get(
      `${candidateRule.projectionId}:${candidateRule.id}`
    );
    if (!baselineRule || !allowRuleIsNarrowerOrEqual(candidateRule, baselineRule)) {
      throw new Error("A counter-proposal may narrow an existing rule but cannot widen it.");
    }
  }
}
