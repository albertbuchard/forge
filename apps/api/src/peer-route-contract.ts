import type { PeerPrincipalClass } from "./peer-sharing-types.js";

export type PeerRouteMethod = "GET" | "POST" | "DELETE";

export type PeerRouteContract = {
  method: PeerRouteMethod;
  path: string;
  operationId: string;
  tag: "People" | "Peer sharing";
  summary: string;
  principalClasses: readonly PeerPrincipalClass[];
  requiredScopes: readonly string[];
  humanOnly: boolean;
  mcpExposed: boolean;
};

const operatorAndAgent = ["operator_session", "agent_token"] as const;
const humanSessions = ["operator_session", "companion_consent"] as const;
const presenceInitiators = ["operator_session", "companion_session"] as const;
const operatorAndCompanion = ["operator_session", "companion_session"] as const;

export const PEER_ROUTE_CONTRACTS: readonly PeerRouteContract[] = [
  {
    method: "GET",
    path: "/api/v1/people",
    operationId: "listPeopleReadModel",
    tag: "People",
    summary: "List a bounded owner-scoped People read model.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "GET",
    path: "/api/v1/people/:personId/context",
    operationId: "getPersonContext",
    tag: "People",
    summary: "Read source-labelled local and shared context for one Person.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/people/wiki-candidates/scan",
    operationId: "scanPeopleWikiCandidates",
    tag: "People",
    summary: "Find bounded Wiki People candidates without mutating them.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic", "wiki:read"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/people/wiki-candidates/enrich",
    operationId: "enrichPeopleWikiCandidates",
    tag: "People",
    summary:
      "Prepare reviewed Person suggestions from selected Wiki People pages.",
    principalClasses: ["operator_session"],
    requiredScopes: ["people:read:basic", "wiki:read"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/people/wiki-associations/preview",
    operationId: "previewPeopleWikiAssociations",
    tag: "People",
    summary: "Preview explicit Wiki association decisions.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:write", "wiki:read"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/people/wiki-associations/apply",
    operationId: "applyPeopleWikiAssociations",
    tag: "People",
    summary: "Apply reviewed Wiki association decisions idempotently.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:write", "wiki:read"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/companion-enrollments/options",
    operationId: "createPeerCompanionEnrollmentOptions",
    tag: "Peer sharing",
    summary: "Create an operator-bound Secure Enclave companion enrollment challenge.",
    principalClasses: ["operator_session"],
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/companion-enrollments/verify",
    operationId: "verifyPeerCompanionEnrollment",
    tag: "Peer sharing",
    summary: "Verify a P-256 enrollment proof and bind one companion device.",
    principalClasses: ["operator_session"],
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/human-presence",
    operationId: "getPeerHumanPresenceStatus",
    tag: "Peer sharing",
    summary: "Read approval methods and ceremony readiness without credential material.",
    principalClasses: ["operator_session", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/human-presence/options",
    operationId: "createPeerHumanPresenceOptions",
    tag: "Peer sharing",
    summary: "Create a one-use approval ceremony bound to an exact action digest.",
    principalClasses: presenceInitiators,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/human-presence/verify",
    operationId: "verifyPeerHumanPresence",
    tag: "Peer sharing",
    summary: "Verify user presence and mint one action-bound capability.",
    principalClasses: presenceInitiators,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "DELETE",
    path: "/api/v1/peers/human-presence/credentials/:credentialId",
    operationId: "revokePeerHumanPresenceCredential",
    tag: "Peer sharing",
    summary: "Revoke one approval credential using another current approval method.",
    principalClasses: ["operator_session"],
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/invitations",
    operationId: "createPeerInvitation",
    tag: "Peer sharing",
    summary: "Create a one-use peer invitation after recent human authentication.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/invitations/:invitationId",
    operationId: "getPeerInvitationStatus",
    tag: "Peer sharing",
    summary: "Read invitation status without returning bootstrap secrets.",
    principalClasses: operatorAndCompanion,
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: false
  },
  {
    method: "DELETE",
    path: "/api/v1/peers/invitations/:invitationId",
    operationId: "cancelPeerInvitation",
    tag: "Peer sharing",
    summary: "Cancel an unconsumed invitation.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/pairings/accept",
    operationId: "acceptScannedPeerPairing",
    tag: "Peer sharing",
    summary: "Submit a scanned peer payload into pending review.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/pairings/:pairingId/confirm",
    operationId: "confirmPeerPairing",
    tag: "Peer sharing",
    summary: "Confirm a verified pairing transcript and relationship.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/requests",
    operationId: "listPeerRequests",
    tag: "Peer sharing",
    summary: "List bounded pending pairing, device, and grant requests.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/requests/:requestId/accept",
    operationId: "acceptPeerRequest",
    tag: "Peer sharing",
    summary: "Accept the exact reviewed pending request.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/requests/:requestId/reject",
    operationId: "rejectPeerRequest",
    tag: "Peer sharing",
    summary: "Reject a pending request without activating state.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships",
    operationId: "listPeerRelationships",
    tag: "Peer sharing",
    summary: "List bounded peer relationships and freshness state.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId",
    operationId: "getPeerRelationship",
    tag: "Peer sharing",
    summary: "Read relationship, transport, device, and grant status.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/revoke",
    operationId: "revokePeerRelationship",
    tag: "Peer sharing",
    summary: "Revoke a peer relationship and issue withdrawal updates.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/devices",
    operationId: "listPeerDevices",
    tag: "Peer sharing",
    summary: "List trusted, pending, removed, and revoked peer devices.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/approve",
    operationId: "approvePeerDevice",
    tag: "Peer sharing",
    summary: "Approve a peer device without widening existing grants.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove",
    operationId: "removePeerDevice",
    tag: "Peer sharing",
    summary: "Remove a peer device and advance MLS state.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/grants/preview",
    operationId: "previewPeerGrant",
    tag: "Peer sharing",
    summary: "Render exact and worst-case grant output without mutation.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/grants/propose",
    operationId: "proposePeerGrant",
    tag: "Peer sharing",
    summary: "Sign and send a reviewed grant version.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/grants",
    operationId: "listPeerGrants",
    tag: "Peer sharing",
    summary: "Read active, pending, and historical grant versions.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/grants/:grantId/accept",
    operationId: "acceptPeerGrant",
    tag: "Peer sharing",
    summary: "Accept the exact signed grant version.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/grants/:grantId/counter",
    operationId: "counterPeerGrant",
    tag: "Peer sharing",
    summary: "Create a narrower signed counter-proposal.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "POST",
    path: "/api/v1/peers/grants/:grantId/revoke",
    operationId: "revokePeerGrant",
    tag: "Peer sharing",
    summary: "Revoke a grant and issue cache-withdrawal state.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:grants:manage"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/sync",
    operationId: "getPeerSyncStatus",
    tag: "Peer sharing",
    summary: "Read bounded delivery and projection sync status.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/peers/relationships/:relationshipId/resync",
    operationId: "requestPeerResync",
    tag: "Peer sharing",
    summary: "Request a bounded authenticated projection resync.",
    principalClasses: humanSessions,
    requiredScopes: ["peer:query"],
    humanOnly: true,
    mcpExposed: false
  },
  {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/diagnostics",
    operationId: "getPeerDiagnostics",
    tag: "Peer sharing",
    summary: "Read redacted transport and protocol diagnostics.",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/people/:personId/questions/interpret",
    operationId: "interpretPersonQuestion",
    tag: "People",
    summary: "Interpret a local question as a registered projection without sending it.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic", "peer:query"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "POST",
    path: "/api/v1/people/:personId/questions/execute",
    operationId: "executePersonQuestion",
    tag: "People",
    summary: "Execute a confirmed registered query live or from cache.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic", "peer:query"],
    humanOnly: false,
    mcpExposed: true
  },
  {
    method: "GET",
    path: "/api/v1/people/:personId/questions",
    operationId: "listPersonQuestionHistory",
    tag: "People",
    summary: "Read bounded redacted query history.",
    principalClasses: operatorAndAgent,
    requiredScopes: ["people:read:basic", "peer:query"],
    humanOnly: false,
    mcpExposed: true
  }
] as const;

export function peerRouteKey(route: Pick<PeerRouteContract, "method" | "path">) {
  return `${route.method} ${route.path}`;
}

export function getPeerRouteContract(
  method: PeerRouteMethod,
  path: string
): PeerRouteContract | null {
  return (
    PEER_ROUTE_CONTRACTS.find(
      (contract) => contract.method === method && contract.path === path
    ) ?? null
  );
}
