export const FORGE_SECURITY_CONTRACT_VERSION = 1 as const;

export type ForgePrincipalKind =
  | "operator_session"
  | "paired_client"
  | "legacy_agent_token"
  | "companion_session"
  | "peer_device"
  | "local_service"
  | "system";

export type ForgePrincipal = {
  kind: ForgePrincipalKind;
  subjectId: string;
  ownerId: string;
  clientId: string | null;
  installationId: string | null;
  audience: string;
  scopes: readonly string[];
  /**
   * Paired credentials retain the reviewed client class so narrow grants
   * cannot be reinterpreted through a different renewal or session path.
   */
  clientType?: "api" | "browser";
  profile:
    | "viewer"
    | "trusted_personal_assistant"
    | "executor"
    | "operator"
    | "custom";
  ownerSecurityEpoch: number;
  clientSecurityEpoch: number | null;
  authenticatedAt: string;
  /**
   * Browser sessions created through a local-owner handoff are bound to the
   * API process that issued them. Persisting the marker makes a captured
   * loopback cookie unusable after a service replacement or restart.
   */
  runtimeBinding?: string;
};

export type RouteSecurityClass =
  | "public_static_or_health"
  | "bounded_auth_protocol"
  | "verified_protocol"
  | "protected";

export type RouteProtocolVerifier =
  | "none"
  | "forge_pairing"
  | "local_owner_assertion"
  | "companion_pairing"
  | "peer_signature"
  | "webauthn";

export type RouteSecurityContract = {
  version: typeof FORGE_SECURITY_CONTRACT_VERSION;
  method: string;
  routePath: string;
  securityClass: RouteSecurityClass;
  action: string;
  resource: string;
  protocolVerifier: RouteProtocolVerifier;
  allowsAnonymousAdmission: boolean;
  allowedApplicationPrincipalKinds: readonly ForgePrincipalKind[];
  acceptedLegacyScopes: readonly string[];
  maximumBodyBytes: number;
};

export type PersistentTransportContract = {
  id: string;
  kind:
    | "http"
    | "sse"
    | "websocket"
    | "mcp"
    | "background"
    | "peer"
    | "companion";
  sourceLocations: readonly string[];
  requiredBoundary:
    | "access_gateway"
    | "verified_protocol_then_access_gateway"
    | "principal_persisted_and_reauthorized";
};

export type CapabilityRisk =
  | "declarative"
  | "host_file"
  | "host_code_execution"
  | "network_egress"
  | "secret_release"
  | "data_administration";

export type CapabilityContract = {
  id: string;
  risk: CapabilityRisk;
  sourceLocations: readonly string[];
  remoteBoundary:
    | "policy_broker"
    | "os_isolated_worker"
    | "operator_step_up"
    | "never_remote";
};
