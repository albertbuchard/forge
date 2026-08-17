import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyRequest } from "fastify";

import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthenticationManager } from "../managers/platform/authentication-manager.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { AccessCredentialService } from "./access-credential.js";
import type {
  GatewayAuthentication,
  GatewayCredentialVerifier
} from "./access-gateway.js";
import { BrowserSessionService } from "./browser-session-service.js";
import type {
  ForgePrincipal,
  RouteProtocolVerifier,
  RouteSecurityContract
} from "./contracts.js";
import {
  DevAssetProxyAssertionService,
  forgeDevProxyAssertionHeader,
  forgeDevProxyTargetHeader
} from "./dev-asset-proxy-assertion.js";
import { canUseDevWebUpgrade } from "./dev-web-upgrade-authorization.js";
import { DpopVerifier } from "./dpop.js";
import { LocalOwnerAssertionService } from "./local-owner-assertion.js";
import { LocalOwnerSessionCoordinator } from "./local-owner-session-coordinator.js";
import { legacyTokenProfile } from "./legacy-token-migration.js";
import type { LegacyTokenTransport } from "./legacy-token-migration.js";
import { MasterPasswordService } from "./master-password-service.js";
import { OwnerChannelAuthority } from "./owner-channel.js";
import { PairingClientProofVerifier } from "./pairing-client-proof.js";
import { PairingNetworkPartitionAuthority } from "./pairing-network-partition.js";
import { PairingOwnerAuthorizationService } from "./pairing-owner-authorization.js";
import {
  createServerPairingReview,
  type ServerPairingReview
} from "./pairing-review.js";
import { PairingService } from "./pairing-service.js";
import type { PairingRequest } from "./pairing-service.js";
import {
  createPrivilegedPairingStepUp,
  type PrivilegedPairingStepUp
} from "./privileged-pairing-step-up.js";
import { RefreshFamilyService } from "./refresh-family-service.js";
import {
  KeyedSecretDigester,
  systemOpaqueSecretSource,
  systemSecurityClock
} from "./security-runtime.js";
import { FileSigningKeyProvider } from "./signing-key-provider.js";
import { SqliteSecurityStore } from "./sqlite-security-store.js";
import { TrustedBrowserService } from "./trusted-browser-service.js";

const BROWSER_SESSION_COOKIE = "forge_session";
const BROWSER_CSRF_HEADER = "x-forge-csrf";
const MAXIMUM_COOKIE_HEADER_BYTES = 8 * 1024;

export type VerifiedProtocolPrincipal = {
  kind: "companion_session" | "peer_device";
  subjectId: string;
  ownerId: string;
  scopes: readonly string[];
  authenticatedAt: string;
  verifyBody?: (request: FastifyRequest) => Promise<void> | void;
};

export type ApplicationProtocolVerifiers = Partial<
  Record<
    Exclude<RouteProtocolVerifier, "none">,
    (
      request: FastifyRequest,
      contract: RouteSecurityContract
    ) =>
      | Promise<VerifiedProtocolPrincipal | null>
      | VerifiedProtocolPrincipal
      | null
  >
>;

export type ApplicationSecurityRuntime = {
  installationId: string;
  issuer: string;
  audience: string;
  canonicalExternalOrigin: string | null;
  devWebOrigin: string | null;
  store: SqliteSecurityStore;
  signingKeys: FileSigningKeyProvider;
  accessCredentials: AccessCredentialService;
  browserSessions: BrowserSessionService;
  pairing: PairingService<FastifyRequest>;
  pairingOwnerAuthorizations: PairingOwnerAuthorizationService<FastifyRequest>;
  pairingNetworkPartitions: PairingNetworkPartitionAuthority<FastifyRequest>;
  masterPasswords: MasterPasswordService<FastifyRequest>;
  privilegedPairingStepUp: PrivilegedPairingStepUp;
  trustedBrowsers: TrustedBrowserService;
  refreshFamilies: RefreshFamilyService;
  localOwnerSessions: LocalOwnerSessionCoordinator | null;
  ownerBrokerBinaryPath: string | null;
  ownerBrokerBinarySha256: string | null;
  platformOwnerKeyPath: string | null;
  platformOwnerKeySha256: string | null;
  devAssetProxyAssertions: DevAssetProxyAssertionService;
  dpop: DpopVerifier;
  gatewayCredentials: GatewayCredentialVerifier;
  pairingReview(request: PairingRequest): ServerPairingReview;
  exactTargetUri(request: FastifyRequest): string;
  authenticateUpgrade(request: IncomingMessage): ForgePrincipal | null;
  legacyTokenTransport(
    request: Pick<FastifyRequest, "headers" | "raw">
  ): LegacyTokenTransport;
};

function localOwnerSocketDirectory(dataDirectory: string) {
  const temporaryRoot = realpathSync(
    process.platform === "win32" ? tmpdir() : "/tmp"
  );
  const owner = process.getuid?.() ?? "user";
  const dataRootDigest = createHash("sha256")
    .update(path.resolve(dataDirectory))
    .digest("hex")
    .slice(0, 12);
  return path.join(temporaryRoot, `fg-${owner}-${dataRootDigest}`);
}

function singleHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    throw new HttpError(
      400,
      "security_header_ambiguous",
      `Forge requires a single ${name} header.`
    );
  }
  return typeof value === "string" ? value : undefined;
}

function authorizationCredential(request: FastifyRequest) {
  const authorization = singleHeader(request, "authorization");
  if (authorization === undefined) {
    return null;
  }
  const [scheme, token, extra] = authorization.trim().split(/\s+/, 3);
  const normalizedScheme = scheme?.toLowerCase();
  if (!["bearer", "dpop"].includes(normalizedScheme ?? "") || !token || extra) {
    throw new HttpError(
      401,
      "gateway_authorization_invalid",
      "Forge requires one canonical Bearer or DPoP credential."
    );
  }
  return {
    token,
    scheme: normalizedScheme as "bearer" | "dpop"
  };
}

function cookieValue(request: FastifyRequest, name: string) {
  const header = singleHeader(request, "cookie");
  if (header === undefined) {
    return null;
  }
  if (Buffer.byteLength(header, "utf8") > MAXIMUM_COOKIE_HEADER_BYTES) {
    throw new HttpError(
      400,
      "gateway_cookie_header_too_large",
      "The Forge Cookie header exceeds the reviewed limit."
    );
  }
  const matches = header
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`));
  if (matches.length > 1) {
    throw new HttpError(
      400,
      "gateway_cookie_ambiguous",
      `Forge received more than one ${name} cookie.`
    );
  }
  if (matches.length === 0) {
    return null;
  }
  const encoded = matches[0]!.slice(name.length + 1);
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new HttpError(
      400,
      "gateway_cookie_invalid",
      `The ${name} cookie is malformed.`
    );
  }
}

function cookieValueFromHeader(
  rawHeader: string | string[] | undefined,
  name: string
) {
  if (Array.isArray(rawHeader)) {
    throw new HttpError(
      400,
      "gateway_cookie_ambiguous",
      "Forge received more than one Cookie header."
    );
  }
  if (rawHeader === undefined) {
    return null;
  }
  if (Buffer.byteLength(rawHeader, "utf8") > MAXIMUM_COOKIE_HEADER_BYTES) {
    throw new HttpError(
      400,
      "gateway_cookie_header_too_large",
      "The Forge Cookie header exceeds the reviewed limit."
    );
  }
  const matches = rawHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`));
  if (matches.length > 1) {
    throw new HttpError(
      400,
      "gateway_cookie_ambiguous",
      `Forge received more than one ${name} cookie.`
    );
  }
  if (matches.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(matches[0]!.slice(name.length + 1));
  } catch {
    throw new HttpError(
      400,
      "gateway_cookie_invalid",
      `The ${name} cookie is malformed.`
    );
  }
}

function unsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function loopbackAddress(value: string | undefined) {
  const normalized = value?.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

const LOCAL_TRANSPORT_PROXY_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip"
]);

function hasProxyIdentityHeaders(
  headers: Record<string, string | string[] | undefined>
) {
  return Object.keys(headers).some(
    (name) =>
      LOCAL_TRANSPORT_PROXY_HEADERS.has(name.toLowerCase()) ||
      name.toLowerCase().startsWith("tailscale-")
  );
}

export function isDirectLocalTransport(
  request: Pick<FastifyRequest, "headers" | "raw">
) {
  return (
    loopbackAddress(request.raw.socket.remoteAddress) &&
    !hasProxyIdentityHeaders(request.headers)
  );
}

export function classifyLegacyTokenTransport(
  request: Pick<FastifyRequest, "headers" | "raw">,
  _canonicalExternalOrigin: string | null
): LegacyTokenTransport {
  if (isDirectLocalTransport(request)) {
    return "direct_loopback";
  }
  return "other_network";
}

function isDirectLocalUpgradeTransport(request: IncomingMessage) {
  return (
    loopbackAddress(request.socket.remoteAddress) &&
    !hasProxyIdentityHeaders(request.headers)
  );
}

export function resolveCanonicalExternalOrigin(
  value: string | null | undefined
) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== candidate
    ) {
      throw new Error("non-canonical external origin");
    }
    return parsed.origin;
  } catch {
    throw new Error(
      "FORGE_CANONICAL_EXTERNAL_ORIGIN must be one canonical credential-free HTTPS origin with no path, query, or fragment."
    );
  }
}

export function resolveApplicationDevWebOrigin(
  value: string | null | undefined
) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid development web origin");
    }
    return parsed.origin;
  } catch {
    throw new Error(
      "FORGE_DEV_WEB_ORIGIN must be an HTTP or HTTPS URL without credentials, query, or fragment."
    );
  }
}

export function exactApplicationSecurityTargetUri(
  request: FastifyRequest,
  canonicalExternalOrigin: string | null = null
) {
  const host = singleHeader(request, "host");
  if (!host || host.includes(",") || /\s/.test(host)) {
    throw new HttpError(
      400,
      "gateway_host_invalid",
      "Forge requires one canonical Host value for sender binding."
    );
  }
  const encrypted = Boolean(
    (
      request.raw.socket as typeof request.raw.socket & {
        encrypted?: boolean;
      }
    ).encrypted
  );
  try {
    const externalOrigin =
      canonicalExternalOrigin === null
        ? null
        : new URL(canonicalExternalOrigin);
    const requestOrigin =
      externalOrigin && host.toLowerCase() === externalOrigin.host.toLowerCase()
        ? externalOrigin.origin
        : `${encrypted ? "https" : "http"}://${host}`;
    return new URL(request.raw.url ?? request.url, requestOrigin).toString();
  } catch {
    throw new HttpError(
      400,
      "gateway_target_uri_invalid",
      "Forge could not construct the sender-binding target URI."
    );
  }
}

function accessPrincipal(
  claims: Awaited<ReturnType<AccessCredentialService["verify"]>>,
  audience: string
): ForgePrincipal {
  return {
    kind: claims.principal_kind,
    subjectId: claims.sub!,
    ownerId: claims.owner_id,
    clientId: claims.client_id,
    installationId: claims.installation_id,
    audience,
    scopes: claims.scopes,
    selectedUserIds: claims.selected_user_ids,
    clientType: claims.client_type,
    profile: claims.profile,
    ownerSecurityEpoch: claims.owner_epoch,
    clientSecurityEpoch: claims.client_epoch,
    authenticatedAt: new Date(claims.iat! * 1000).toISOString()
  };
}

function legacyPrincipal(
  context: AuthContext,
  ownerId: string,
  installationId: string,
  audience: string
): GatewayAuthentication | null {
  if (context.session) {
    return {
      principal: {
        kind: "operator_session",
        subjectId: context.session.id,
        ownerId,
        clientId: null,
        installationId: null,
        audience,
        scopes: ["*"],
        profile: "operator",
        ownerSecurityEpoch: 1,
        clientSecurityEpoch: null,
        authenticatedAt: new Date().toISOString()
      },
      mode: "browser_session",
      csrfSatisfied: false
    };
  }
  if (!context.token) {
    return null;
  }
  return {
    principal: {
      kind: "legacy_agent_token",
      subjectId: context.token.agentId ?? context.token.id,
      ownerId,
      clientId: context.token.id,
      installationId,
      audience,
      scopes: context.token.scopes,
      profile: legacyTokenProfile(context.token),
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: 1,
      authenticatedAt: new Date().toISOString()
    },
    mode: "legacy_agent_token",
    csrfSatisfied: false
  };
}

export async function initializeApplicationSecurityRuntime(input: {
  database: DatabaseSync;
  dataDirectory: string;
  ownerId: string;
  secrets: SecretsManager;
  legacyAuthentication: AuthenticationManager;
  ownerBrokerBinaryPath?: string | null;
  ownerBrokerBinarySha256?: string | null;
  platformOwnerKeyPath?: string | null;
  platformOwnerKeySha256?: string | null;
  canonicalExternalOrigin?: string | null;
  devWebOrigin?: string | null;
  protocolVerifiers?: ApplicationProtocolVerifiers;
  authorizeLegacyToken?: (
    token: NonNullable<AuthContext["token"]>,
    transport: LegacyTokenTransport
  ) => boolean;
}): Promise<ApplicationSecurityRuntime> {
  const digester = new KeyedSecretDigester(
    input.secrets.deriveKey("application-security-digests/v1")
  );
  const store = new SqliteSecurityStore(
    input.database,
    systemSecurityClock,
    systemOpaqueSecretSource,
    digester
  );
  const installationId = store.ensureInstallation();
  const ownerSecurityEpoch = store.ensureOwner(input.ownerId);
  if (ownerSecurityEpoch === null) {
    throw new Error("Forge could not initialize the security owner.");
  }
  const issuer = `urn:forge:${installationId}`;
  const audience = `${issuer}:api`;
  const canonicalExternalOrigin = resolveCanonicalExternalOrigin(
    input.canonicalExternalOrigin ?? process.env.FORGE_CANONICAL_EXTERNAL_ORIGIN
  );
  const devWebOrigin = resolveApplicationDevWebOrigin(
    input.devWebOrigin ?? process.env.FORGE_DEV_WEB_ORIGIN
  );
  const pairingReview = (request: PairingRequest) =>
    createServerPairingReview({
      request,
      installationId,
      canonicalExternalOrigin
    });
  const signingKeys = new FileSigningKeyProvider(
    issuer,
    path.join(input.dataDirectory, "security", "application-signing-keys.json")
  );
  await signingKeys.initialize();
  const accessCredentials = new AccessCredentialService(
    signingKeys,
    systemSecurityClock,
    store
  );
  const browserSessions = new BrowserSessionService(
    systemSecurityClock,
    systemOpaqueSecretSource,
    digester,
    store,
    store,
    undefined,
    undefined,
    store
  );
  const pairingNetworkPartitions =
    new PairingNetworkPartitionAuthority<FastifyRequest>((request) => {
      const remoteAddress = request.raw.socket.remoteAddress?.trim();
      return remoteAddress ? `socket:${remoteAddress}` : "socket:unavailable";
    });
  const masterPasswords = new MasterPasswordService(
    systemSecurityClock,
    systemOpaqueSecretSource,
    digester,
    store,
    pairingNetworkPartitions
  );
  const privilegedPairingStepUp = createPrivilegedPairingStepUp({
    secrets: input.secrets,
    ownerId: input.ownerId,
    store,
    browserSessions
  });
  const trustedBrowsers = new TrustedBrowserService(
    input.database,
    systemSecurityClock,
    input.secrets,
    store,
    installationId,
    input.dataDirectory
  );
  const pairingOwnerAuthorizations = new PairingOwnerAuthorizationService(
    systemSecurityClock,
    digester,
    store,
    browserSessions,
    privilegedPairingStepUp.authorizations,
    pairingNetworkPartitions,
    undefined,
    undefined,
    pairingReview,
    masterPasswords
  );
  const pairing = new PairingService(
    systemSecurityClock,
    systemOpaqueSecretSource,
    digester,
    store,
    new PairingClientProofVerifier(systemSecurityClock, store),
    pairingOwnerAuthorizations,
    pairingNetworkPartitions,
    "/forge/pair",
    audience
  );
  const refreshFamilies = new RefreshFamilyService(store);
  const ownerBroker = resolveOwnerBrokerBinary(
    input.ownerBrokerBinaryPath,
    input.ownerBrokerBinarySha256
  );
  const ownerBrokerBinaryPath = ownerBroker?.binaryPath ?? null;
  const ownerBrokerBinarySha256 = ownerBroker?.binarySha256 ?? null;
  const platformOwner = resolvePlatformOwnerKey(
    input.platformOwnerKeyPath,
    input.platformOwnerKeySha256
  );
  const platformOwnerKeyPath = platformOwner?.keyPath ?? null;
  const platformOwnerKeySha256 = platformOwner?.keySha256 ?? null;
  const ownerChannel = new OwnerChannelAuthority(
    systemSecurityClock,
    input.ownerId
  );
  const localOwnerAssertions = new LocalOwnerAssertionService(
    signingKeys,
    systemSecurityClock,
    digester,
    store,
    ownerChannel,
    `${audience}:local-owner`
  );
  const localOwnerSessions =
    ownerBrokerBinaryPath || platformOwner
      ? new LocalOwnerSessionCoordinator(
          installationId,
          audience,
          input.ownerId,
          ownerBrokerBinaryPath,
          ownerBrokerBinarySha256,
          localOwnerSocketDirectory(input.dataDirectory),
          systemSecurityClock,
          localOwnerAssertions,
          ownerChannel,
          browserSessions,
          platformOwner?.key ?? null
        )
      : null;
  const dpop = new DpopVerifier(systemSecurityClock, store);
  const devAssetProxyAssertions = new DevAssetProxyAssertionService();

  const gatewayCredentials: GatewayCredentialVerifier = {
    async authenticate(request, contract) {
      const devProxyAssertion = singleHeader(
        request,
        forgeDevProxyAssertionHeader
      );
      if (devProxyAssertion) {
        const target = singleHeader(request, forgeDevProxyTargetHeader);
        const principal =
          request.method === "GET" &&
          contract.routePath === "/api/v1/security/dev-session-check" &&
          target
            ? devAssetProxyAssertions.consume(devProxyAssertion, target)
            : null;
        if (
          !principal ||
          (principal.kind !== "system" && !canUseDevWebUpgrade(principal))
        ) {
          throw new HttpError(
            401,
            "gateway_dev_proxy_assertion_invalid",
            "The development asset assertion is invalid, expired, or already used."
          );
        }
        return {
          principal,
          mode: "dev_proxy_assertion",
          csrfSatisfied: true
        };
      }

      const sessionToken = cookieValue(request, BROWSER_SESSION_COOKIE);
      if (sessionToken) {
        try {
          const authenticated = browserSessions.authenticate({
            sessionToken,
            csrfToken: singleHeader(request, BROWSER_CSRF_HEADER),
            unsafeMethod: unsafeMethod(request.method)
          });
          if (!authenticated) {
            return null;
          }
          if (
            authenticated.principal.kind === "local_service" &&
            !isDirectLocalTransport(request)
          ) {
            throw new HttpError(
              401,
              "gateway_local_session_transport_invalid",
              "Forge local-native sessions are accepted only over a direct loopback transport."
            );
          }
          return {
            principal: {
              ...authenticated.principal,
              subjectId: authenticated.sessionId
            },
            mode: "browser_session",
            csrfSatisfied: true,
            browserSession: {
              id: authenticated.sessionId,
              absoluteExpiresAt: authenticated.absoluteExpiresAt,
              verified: authenticated
            }
          };
        } catch (error) {
          if (error instanceof HttpError) {
            throw error;
          }
          throw new HttpError(
            403,
            "gateway_csrf_required",
            "The Forge browser session requires a valid anti-CSRF proof."
          );
        }
      }

      const authorization = authorizationCredential(request);
      if (authorization) {
        try {
          const claims = await accessCredentials.verify({
            token: authorization.token,
            audience,
            requireSenderConstraint: false
          });
          if (claims.credential_mode === "sender_constrained") {
            if (authorization.scheme !== "dpop") {
              throw new HttpError(
                401,
                "gateway_dpop_scheme_required",
                "The Forge sender-constrained credential requires the DPoP authorization scheme."
              );
            }
            const proof = singleHeader(request, "dpop");
            if (!proof || !claims.cnf?.jkt) {
              throw new HttpError(
                401,
                "gateway_dpop_required",
                "The Forge access credential requires a DPoP proof."
              );
            }
            await dpop.verify({
              proof,
              accessToken: authorization.token,
              expectedMethod: request.method,
              expectedTargetUri: exactApplicationSecurityTargetUri(
                request,
                canonicalExternalOrigin
              ),
              expectedKeyThumbprint: claims.cnf.jkt
            });
          } else if (authorization.scheme !== "bearer") {
            throw new HttpError(
              401,
              "gateway_bearer_scheme_required",
              "The Forge compatibility credential requires the Bearer authorization scheme."
            );
          }
          return {
            principal: accessPrincipal(claims, audience),
            mode:
              claims.credential_mode === "sender_constrained"
                ? "access_credential"
                : "legacy_agent_token",
            csrfSatisfied: false
          };
        } catch (error) {
          if (error instanceof HttpError) {
            throw error;
          }
          const legacy = legacyPrincipal(
            (() => {
              const context = input.legacyAuthentication.authenticate(
                request.headers as Record<string, unknown>,
                classifyLegacyTokenTransport(request, canonicalExternalOrigin)
              );
              return context.token &&
                !input.authorizeLegacyToken?.(
                  context.token,
                  classifyLegacyTokenTransport(request, canonicalExternalOrigin)
                )
                ? { ...context, token: null }
                : context;
            })(),
            input.ownerId,
            installationId,
            audience
          );
          if (legacy) {
            return legacy;
          }
          throw new HttpError(
            401,
            "gateway_credential_invalid",
            "The Forge access credential is invalid, revoked, or expired."
          );
        }
      }

      const legacy = legacyPrincipal(
        (() => {
          const context = input.legacyAuthentication.authenticate(
            request.headers as Record<string, unknown>,
            classifyLegacyTokenTransport(request, canonicalExternalOrigin)
          );
          return context.token &&
            !input.authorizeLegacyToken?.(
              context.token,
              classifyLegacyTokenTransport(request, canonicalExternalOrigin)
            )
            ? { ...context, token: null }
            : context;
        })(),
        input.ownerId,
        installationId,
        audience
      );
      if (legacy?.mode === "browser_session" && unsafeMethod(contract.method)) {
        return { ...legacy, csrfSatisfied: false };
      }
      return legacy;
    },

    async verifyProtocolEarly(request, contract) {
      if (contract.protocolVerifier === "none") {
        return null;
      }
      const verifier = input.protocolVerifiers?.[contract.protocolVerifier];
      if (!verifier) {
        return null;
      }
      const verified = await verifier(request, contract);
      if (!verified) {
        return null;
      }
      return {
        principal: {
          kind: verified.kind,
          subjectId: verified.subjectId,
          ownerId: verified.ownerId,
          clientId: verified.subjectId,
          installationId,
          audience,
          scopes: verified.scopes,
          profile: "custom",
          ownerSecurityEpoch:
            store.readOwnerSecurityEpoch(verified.ownerId) ?? 1,
          clientSecurityEpoch: 1,
          authenticatedAt: verified.authenticatedAt
        },
        mode: "verified_protocol",
        csrfSatisfied: false,
        verifyBody: verified.verifyBody
      };
    }
  };

  return {
    installationId,
    issuer,
    audience,
    canonicalExternalOrigin,
    devWebOrigin,
    store,
    signingKeys,
    accessCredentials,
    browserSessions,
    pairing,
    pairingOwnerAuthorizations,
    pairingNetworkPartitions,
    masterPasswords,
    privilegedPairingStepUp,
    trustedBrowsers,
    refreshFamilies,
    localOwnerSessions,
    ownerBrokerBinaryPath,
    ownerBrokerBinarySha256,
    platformOwnerKeyPath,
    platformOwnerKeySha256,
    devAssetProxyAssertions,
    dpop,
    pairingReview,
    exactTargetUri: (request) =>
      exactApplicationSecurityTargetUri(request, canonicalExternalOrigin),
    legacyTokenTransport: (request) =>
      classifyLegacyTokenTransport(request, canonicalExternalOrigin),
    gatewayCredentials,
    authenticateUpgrade(request) {
      const sessionToken = cookieValueFromHeader(
        request.headers.cookie,
        BROWSER_SESSION_COOKIE
      );
      if (sessionToken) {
        const authenticated = browserSessions.authenticate({
          sessionToken,
          csrfToken:
            typeof request.headers[BROWSER_CSRF_HEADER] === "string"
              ? request.headers[BROWSER_CSRF_HEADER]
              : undefined,
          unsafeMethod: false
        });
        if (
          !authenticated ||
          (authenticated.principal.kind === "local_service" &&
            !isDirectLocalUpgradeTransport(request))
        ) {
          return null;
        }
        return authenticated.principal;
      }
      const legacy = legacyPrincipal(
        (() => {
          const transport = classifyLegacyTokenTransport(
            {
              headers: request.headers,
              raw: { socket: request.socket }
            } as Pick<FastifyRequest, "headers" | "raw">,
            canonicalExternalOrigin
          );
          const context = input.legacyAuthentication.authenticate(
            request.headers as Record<string, unknown>,
            transport
          );
          return context.token &&
            !input.authorizeLegacyToken?.(context.token, transport)
            ? { ...context, token: null }
            : context;
        })(),
        input.ownerId,
        installationId,
        audience
      );
      return legacy?.principal ?? null;
    }
  };
}

function resolveOwnerBrokerBinary(
  configuredPath: string | null | undefined,
  configuredSha256: string | null | undefined
) {
  const environmentPath = process.env.FORGE_OWNER_BROKER_BIN?.trim();
  const environmentSha256 =
    process.env.FORGE_OWNER_BROKER_SHA256?.trim().toLowerCase();
  const executableName =
    process.platform === "win32"
      ? "forge-owner-broker.exe"
      : "forge-owner-broker";
  const configuredCandidates = [
    {
      binaryPath: configuredPath?.trim(),
      binarySha256: configuredSha256?.trim().toLowerCase() || null
    },
    {
      binaryPath: environmentPath,
      binarySha256: environmentSha256 || null
    }
  ].filter(
    (candidate): candidate is { binaryPath: string; binarySha256: string } =>
      Boolean(candidate.binaryPath) &&
      typeof candidate.binarySha256 === "string" &&
      /^[0-9a-f]{64}$/.test(candidate.binarySha256)
  );
  const developmentCandidates =
    existsSync(path.join(process.cwd(), ".git")) &&
    existsSync(path.join(process.cwd(), "packages", "forge-peer", "Cargo.toml"))
      ? [
          {
            binaryPath: path.join(
              process.cwd(),
              "packages",
              "forge-peer",
              "target",
              "release",
              executableName
            ),
            binarySha256: null
          },
          {
            binaryPath: path.join(
              process.cwd(),
              "packages",
              "forge-peer",
              "target",
              "debug",
              executableName
            ),
            binarySha256: null
          }
        ]
      : [];
  const candidates = [...configuredCandidates, ...developmentCandidates];
  return (
    candidates.find(
      (candidate) =>
        path.isAbsolute(candidate.binaryPath) &&
        existsSync(candidate.binaryPath) &&
        (candidate.binarySha256 === null ||
          /^[0-9a-f]{64}$/.test(candidate.binarySha256))
    ) ?? null
  );
}

function resolvePlatformOwnerKey(
  configuredPath: string | null | undefined,
  configuredSha256: string | null | undefined
) {
  const candidates = [
    {
      keyPath: configuredPath?.trim(),
      keySha256: configuredSha256?.trim().toLowerCase()
    },
    {
      keyPath: process.env.FORGE_PLATFORM_OWNER_KEY_PATH?.trim(),
      keySha256:
        process.env.FORGE_PLATFORM_OWNER_KEY_SHA256?.trim().toLowerCase()
    }
  ].filter(
    (candidate): candidate is { keyPath: string; keySha256: string } =>
      Boolean(candidate.keyPath) &&
      typeof candidate.keySha256 === "string" &&
      /^[0-9a-f]{64}$/.test(candidate.keySha256)
  );
  for (const candidate of candidates) {
    try {
      if (!path.isAbsolute(candidate.keyPath)) continue;
      const metadata = lstatSync(candidate.keyPath);
      const currentUid = process.getuid?.();
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        metadata.size < 43 ||
        metadata.size > 128 ||
        (currentUid !== undefined &&
          (metadata.uid !== currentUid || (metadata.mode & 0o077) !== 0)) ||
        (process.platform === "win32" &&
          !windowsPathIsCurrentOwnerOnly(candidate.keyPath))
      ) {
        continue;
      }
      const body = readFileSync(candidate.keyPath);
      if (
        createHash("sha256").update(body).digest("hex") !== candidate.keySha256
      ) {
        continue;
      }
      const encoded = body.toString("utf8").trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) continue;
      const key = Buffer.from(encoded, "base64url");
      if (key.byteLength !== 32) continue;
      return {
        keyPath: candidate.keyPath,
        keySha256: candidate.keySha256,
        key
      };
    } catch {
      continue;
    }
  }
  return null;
}

function windowsPathIsCurrentOwnerOnly(target: string) {
  const systemRoot = process.env.SystemRoot?.trim();
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) return false;
  const powershell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    "$target=[IO.Path]::GetFullPath($args[0])",
    "$item=Get-Item -LiteralPath $target -Force",
    "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 10 }",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$acl=Get-Acl -LiteralPath $target",
    "$owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value",
    "if ($owner -ne $sid -or -not $acl.AreAccessRulesProtected) { exit 11 }",
    "$bad=$acl.Access | Where-Object {",
    "  $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or",
    "  $_.IsInherited -or",
    "  $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid",
    "}",
    "if ($null -ne $bad) { exit 12 }",
    "exit 0"
  ].join("; ");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, target],
    { stdio: "ignore", windowsHide: true, timeout: 5_000 }
  );
  return result.status === 0;
}

export const applicationSecurityBrowserSessionCookie = BROWSER_SESSION_COOKIE;
export const applicationSecurityCsrfHeader = BROWSER_CSRF_HEADER;
export function readApplicationSecurityBrowserSessionToken(
  rawHeader: string | string[] | undefined
) {
  return cookieValueFromHeader(rawHeader, BROWSER_SESSION_COOKIE);
}
