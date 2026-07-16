import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { SecretsManager } from "../managers/platform/secrets-manager.js";
import { persistLocalPeerIdentity } from "../repositories/peer-pairing.js";
import type {
  PeerCoreGateway,
  PeerLocalIdentity
} from "./peer-core-gateway.js";
import { UnavailablePeerCoreGateway } from "./peer-core-gateway.js";
import { UnixSocketPeerCoreGateway } from "./peer-core-ipc-gateway.js";
import {
  DerivedPeerCommandAuthorizer,
  type PeerCommandAuthorizer
} from "./peer-command-authorization.js";
import {
  PeerDaemonSupervisor,
  type PeerDaemonSupervisorConfig,
  type PeerDaemonSupervisorSnapshot
} from "./peer-daemon-supervisor.js";
import {
  PeerQuerySourceWorker,
  PeerRevocationEventConsumer
} from "./peer-query-source-worker.js";

const STARTUP_FAILURE_REASON =
  "The forge-peer daemon did not pass its startup checks.";
const CONFIGURATION_FAILURE_REASON =
  "The forge-peer daemon configuration is invalid.";

type Awaitable<T> = T | Promise<T>;

export type PeerRuntimeWorker = {
  start(): Awaitable<void>;
  stop(): Promise<void>;
};

export type PeerRuntimeSupervisor = {
  start(): Promise<PeerDaemonSupervisorSnapshot>;
  stop(): Promise<PeerDaemonSupervisorSnapshot>;
};

export type PeerRuntimeConfiguration = {
  enabled: boolean;
  required: boolean;
  supervisor:
    | { enabled: false }
    | Omit<
        Extract<PeerDaemonSupervisorConfig, { enabled: true }>,
        "commandAuthorityPublicKey"
      >;
};

export type PeerRuntimeLaunchDependencies = {
  environment?: NodeJS.ProcessEnv;
  secrets?: SecretsManager;
  resolveTemporaryDirectory?: () => Promise<string>;
  createCommandAuthorizer?: (input: {
    ownerUserId: string;
    stateDir: string;
    secrets: SecretsManager;
  }) => PeerCommandAuthorizer;
  createSupervisor?: (
    config: PeerDaemonSupervisorConfig
  ) => PeerRuntimeSupervisor;
  createGateway?: (input: {
    socketPath: string;
    ownerUserId: string;
    commandAuthorizer: PeerCommandAuthorizer;
  }) => PeerCoreGateway;
  createQuerySourceWorker?: (input: {
    ownerUserId: string;
    gateway: PeerCoreGateway;
  }) => PeerRuntimeWorker;
  createRevocationConsumer?: (input: {
    ownerUserId: string;
    gateway: PeerCoreGateway;
    commandAuthorizer: PeerCommandAuthorizer;
  }) => PeerRuntimeWorker;
  maximumOwners?: number;
  persistIdentity?: (input: {
    ownerUserId: string;
    identity: PeerLocalIdentity;
    now?: Date;
  }) => Awaitable<{ principalId: string; deviceId: string }>;
};

export type PeerRuntimeHandle = {
  configured: boolean;
  required: boolean;
  gateway: PeerCoreGateway;
  supervisor: PeerRuntimeSupervisor | null;
  failure: "configuration" | "startup" | null;
  stop(): Promise<void>;
};

export class PeerRuntimeStartupError extends Error {
  constructor(
    readonly code: "configuration" | "startup",
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PeerRuntimeStartupError";
  }
}

export class DelegatingPeerCoreGateway implements PeerCoreGateway {
  private active: PeerCoreGateway = new UnavailablePeerCoreGateway();
  private activated = false;

  activate(gateway: PeerCoreGateway) {
    if (this.activated) {
      throw new Error("The peer gateway has already been activated.");
    }
    this.active = gateway;
    this.activated = true;
  }

  health() {
    return this.active.health();
  }

  transportReadiness(
    input: Parameters<NonNullable<PeerCoreGateway["transportReadiness"]>>[0]
  ) {
    const operation = this.active.transportReadiness;
    if (!operation) throw new Error("Peer transport readiness is unavailable.");
    return operation.call(this.active, input);
  }

  localIdentity(input: Parameters<PeerCoreGateway["localIdentity"]>[0]) {
    return this.active.localIdentity(input);
  }

  commandReceipt(input: Parameters<PeerCoreGateway["commandReceipt"]>[0]) {
    return this.active.commandReceipt(input);
  }

  syncCommandAuthorizationState(
    input: Parameters<PeerCoreGateway["syncCommandAuthorizationState"]>[0]
  ) {
    return this.active.syncCommandAuthorizationState(input);
  }

  createInvitation(input: Parameters<PeerCoreGateway["createInvitation"]>[0]) {
    return this.active.createInvitation(input);
  }

  cancelInvitation(
    input: Parameters<NonNullable<PeerCoreGateway["cancelInvitation"]>>[0]
  ) {
    const operation = this.active.cancelInvitation;
    if (!operation) throw new Error("The peer gateway is unavailable.");
    return operation.call(this.active, input);
  }

  acceptInvitation(input: Parameters<PeerCoreGateway["acceptInvitation"]>[0]) {
    return this.active.acceptInvitation(input);
  }

  acceptPendingRequest(
    input: Parameters<NonNullable<PeerCoreGateway["acceptPendingRequest"]>>[0]
  ) {
    const operation = this.active.acceptPendingRequest;
    if (!operation) throw new Error("The peer gateway is unavailable.");
    return operation.call(this.active, input);
  }

  confirmPairing(input: Parameters<PeerCoreGateway["confirmPairing"]>[0]) {
    return this.active.confirmPairing(input);
  }

  signGrant(input: Parameters<PeerCoreGateway["signGrant"]>[0]) {
    return this.active.signGrant(input);
  }

  revokeGrant(
    input: Parameters<NonNullable<PeerCoreGateway["revokeGrant"]>>[0]
  ) {
    const operation = this.active.revokeGrant;
    if (!operation) throw new Error("The peer gateway is unavailable.");
    return operation.call(this.active, input);
  }

  acceptGrant(input: Parameters<PeerCoreGateway["acceptGrant"]>[0]) {
    return this.active.acceptGrant(input);
  }

  updateDevice(input: Parameters<PeerCoreGateway["updateDevice"]>[0]) {
    return this.active.updateDevice(input);
  }

  revokeRelationship(
    input: Parameters<PeerCoreGateway["revokeRelationship"]>[0]
  ) {
    return this.active.revokeRelationship(input);
  }

  requestResync(input: Parameters<PeerCoreGateway["requestResync"]>[0]) {
    return this.active.requestResync(input);
  }

  claimInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["claimInboundQuery"]>>[0]
  ) {
    const operation = this.active.claimInboundQuery;
    if (!operation) throw new Error("The peer query worker is unavailable.");
    return operation.call(this.active, input);
  }

  respondInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["respondInboundQuery"]>>[0]
  ) {
    const operation = this.active.respondInboundQuery;
    if (!operation) throw new Error("The peer query worker is unavailable.");
    return operation.call(this.active, input);
  }

  listRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["listRevocationEvents"]>>[0]
  ) {
    const operation = this.active.listRevocationEvents;
    if (!operation)
      throw new Error("The peer revocation consumer is unavailable.");
    return operation.call(this.active, input);
  }

  ackRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["ackRevocationEvents"]>>[0]
  ) {
    const operation = this.active.ackRevocationEvents;
    if (!operation)
      throw new Error("The peer revocation consumer is unavailable.");
    return operation.call(this.active, input);
  }

  executeQuery(input: Parameters<PeerCoreGateway["executeQuery"]>[0]) {
    return this.active.executeQuery(input);
  }
}

function strictFlag(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new PeerRuntimeStartupError(
    "configuration",
    `${name} must be exactly 0 or 1.`
  );
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
) {
  const value = environment[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      `${name} is required when forge-peer is enabled.`
    );
  }
  return value;
}

function optionalEnvironmentPath(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string
) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (value.trim() !== value || value.includes("\0")) {
    throw new PeerRuntimeStartupError(
      "configuration",
      `${name} must be a normalized absolute path.`
    );
  }
  return value;
}

function optionalBoundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number
) {
  const value = environment[name];
  if (value === undefined || value === "") return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new PeerRuntimeStartupError(
      "configuration",
      `${name} must be a canonical integer between ${minimum} and ${maximum}.`
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PeerRuntimeStartupError(
      "configuration",
      `${name} must be a canonical integer between ${minimum} and ${maximum}.`
    );
  }
  return parsed;
}

function optionalConfiguredPath(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (value === undefined || value === "") return undefined;
  return optionalEnvironmentPath(environment, name, value);
}

function directEndpoints(environment: NodeJS.ProcessEnv) {
  const value = environment.FORGE_PEER_DIRECT_ENDPOINTS;
  if (value === undefined || value === "") return [];
  if (value.trim() !== value || value.includes("\0")) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "FORGE_PEER_DIRECT_ENDPOINTS must be a comma-separated endpoint list without whitespace."
    );
  }
  const endpoints = value.split(",");
  if (
    endpoints.length === 0 ||
    endpoints.some(
      (endpoint) =>
        endpoint.length === 0 ||
        endpoint.trim() !== endpoint ||
        endpoint.includes("\n") ||
        endpoint.includes("\r")
    )
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "FORGE_PEER_DIRECT_ENDPOINTS must be a comma-separated endpoint list without whitespace."
    );
  }
  return endpoints;
}

const TOR_ENVIRONMENT_OPTIONS = [
  "FORGE_PEER_TOR_BIN",
  "FORGE_PEER_TOR_DATA_DIR",
  "FORGE_PEER_TOR_SOCKS_ENDPOINT",
  "FORGE_PEER_TOR_VIRTUAL_PORT",
  "FORGE_PEER_TOR_STARTUP_TIMEOUT_SECONDS",
  "FORGE_PEER_TOR_RESTART_LIMIT",
  "FORGE_PEER_TOR_MINIMUM_RESTART_BACKOFF_MS",
  "FORGE_PEER_TOR_MAXIMUM_RESTART_BACKOFF_MS"
] as const;

const MAILBOX_ENVIRONMENT_OPTIONS = [
  "FORGE_PEER_HTTP_MAILBOX_ORIGIN",
  "FORGE_PEER_HTTP_MAILBOX_ALLOW_PRIVATE_ORIGIN",
  "FORGE_PEER_HTTP_MAILBOX_ALLOW_LOOPBACK_ORIGIN",
  "FORGE_PEER_HTTP_MAILBOX_CA_FILE",
  "FORGE_PEER_HTTP_MAILBOX_POLL_INTERVAL_MS"
] as const;

function rejectDisabledProviderOptions(input: {
  environment: NodeJS.ProcessEnv;
  enabled: boolean;
  provider: string;
  options: readonly string[];
}) {
  if (
    !input.enabled &&
    input.options.some((name) => {
      const value = input.environment[name];
      return value !== undefined && value !== "";
    })
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      `${input.provider} options require its explicit enable flag.`
    );
  }
}

function validateTorSocket(value: string) {
  let host: string;
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(value);
    if (!match || isIP(match[1]) !== 6) {
      throw new PeerRuntimeStartupError(
        "configuration",
        "FORGE_PEER_TOR_SOCKS_ENDPOINT must be a loopback IP socket."
      );
    }
    host = match[1];
  } else {
    const separator = value.lastIndexOf(":");
    host = separator > 0 ? value.slice(0, separator) : "";
    if (isIP(host) !== 4 || !/^\d{1,5}$/.test(value.slice(separator + 1))) {
      throw new PeerRuntimeStartupError(
        "configuration",
        "FORGE_PEER_TOR_SOCKS_ENDPOINT must be a loopback IP socket."
      );
    }
  }
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  if (
    port < 1 ||
    port > 65_535 ||
    !(
      (isIP(host) === 4 && host.split(".")[0] === "127") ||
      (isIP(host) === 6 && host === "::1")
    )
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "FORGE_PEER_TOR_SOCKS_ENDPOINT must be a loopback IP socket."
    );
  }
}

function validateMailboxConfiguration(input: {
  origin: string;
  allowPrivateOrigin: boolean;
  allowLoopbackOrigin: boolean;
  caFile: string | undefined;
}) {
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new PeerRuntimeStartupError(
      "configuration",
      "FORGE_PEER_HTTP_MAILBOX_ORIGIN must be a canonical HTTPS origin."
    );
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.origin !== input.origin
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "FORGE_PEER_HTTP_MAILBOX_ORIGIN must be a canonical HTTPS origin."
    );
  }
  if (input.allowPrivateOrigin && input.allowLoopbackOrigin) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "HTTP mailbox private and loopback origin modes are mutually exclusive."
    );
  }
  if (input.allowLoopbackOrigin && input.caFile === undefined) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "A loopback HTTP mailbox requires FORGE_PEER_HTTP_MAILBOX_CA_FILE."
    );
  }
}

function ownerSocketKey(ownerUserId: string) {
  return createHash("sha256")
    .update(ownerUserId, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    throw new PeerRuntimeStartupError(
      "configuration",
      "forge-peer requires a Unix process owner."
    );
  }
  return process.getuid();
}

function validateOwnerUserId(ownerUserId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(ownerUserId)) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "The forge-peer owner user id is invalid."
    );
  }
  return ownerUserId;
}

export async function resolvePeerRuntimeConfiguration(input: {
  ownerUserId: string;
  dataDir: string;
  environment?: NodeJS.ProcessEnv;
  resolveTemporaryDirectory?: () => Promise<string>;
}): Promise<PeerRuntimeConfiguration> {
  const environment = input.environment ?? process.env;
  const enabled = strictFlag(environment, "FORGE_PEER_ENABLED", false);
  const required = strictFlag(environment, "FORGE_PEER_REQUIRED", false);
  const irohEnabled = strictFlag(environment, "FORGE_PEER_ENABLE_IROH", false);
  const torEnabled = strictFlag(environment, "FORGE_PEER_ENABLE_TOR", false);
  const httpMailboxEnabled = strictFlag(
    environment,
    "FORGE_PEER_ENABLE_HTTP_MAILBOX",
    false
  );
  rejectDisabledProviderOptions({
    environment,
    enabled: torEnabled,
    provider: "Tor",
    options: TOR_ENVIRONMENT_OPTIONS
  });
  rejectDisabledProviderOptions({
    environment,
    enabled: httpMailboxEnabled,
    provider: "HTTP mailbox",
    options: MAILBOX_ENVIRONMENT_OPTIONS
  });
  if (!enabled) {
    if (irohEnabled || torEnabled || httpMailboxEnabled) {
      throw new PeerRuntimeStartupError(
        "configuration",
        "Peer transport providers cannot be enabled while forge-peer is disabled."
      );
    }
    if (required) {
      throw new PeerRuntimeStartupError(
        "configuration",
        "FORGE_PEER_REQUIRED cannot be enabled while forge-peer is disabled."
      );
    }
    return { enabled: false, required: false, supervisor: { enabled: false } };
  }

  const ownerUserId = validateOwnerUserId(input.ownerUserId);
  const temporaryDirectory = await (
    input.resolveTemporaryDirectory ?? (() => realpath(os.tmpdir()))
  )();
  const socketDirectory = path.join(
    temporaryDirectory,
    `forge-peer-${currentUid()}-${ownerSocketKey(ownerUserId)}`
  );
  const ownerKey = ownerSocketKey(ownerUserId);
  const stateRoot = optionalEnvironmentPath(
    environment,
    "FORGE_PEER_STATE_DIR",
    path.join(path.resolve(input.dataDir), "peer")
  );
  const configuredSocketPath = optionalEnvironmentPath(
    environment,
    "FORGE_PEER_SOCKET_PATH",
    path.join(socketDirectory, "control.sock")
  );
  const stateDir = path.join(stateRoot, ownerKey);
  const socketPath =
    environment.FORGE_PEER_SOCKET_PATH === undefined ||
    environment.FORGE_PEER_SOCKET_PATH === ""
      ? configuredSocketPath
      : path.join(
          path.dirname(configuredSocketPath),
          ownerKey,
          path.basename(configuredSocketPath)
        );
  const configuredTorDataDir = optionalEnvironmentPath(
    environment,
    "FORGE_PEER_TOR_DATA_DIR",
    path.join(stateDir, "tor-runtime")
  );
  const torDataDir =
    environment.FORGE_PEER_TOR_DATA_DIR === undefined ||
    environment.FORGE_PEER_TOR_DATA_DIR === ""
      ? configuredTorDataDir
      : path.join(configuredTorDataDir, ownerKey);
  const tor = torEnabled
    ? {
        enabled: true as const,
        executablePath: requiredEnvironmentValue(
          environment,
          "FORGE_PEER_TOR_BIN"
        ),
        dataDir: torDataDir,
        socksEndpoint: requiredEnvironmentValue(
          environment,
          "FORGE_PEER_TOR_SOCKS_ENDPOINT"
        ),
        virtualPort: optionalBoundedInteger(
          environment,
          "FORGE_PEER_TOR_VIRTUAL_PORT",
          1,
          65_535
        ),
        startupTimeoutSeconds: optionalBoundedInteger(
          environment,
          "FORGE_PEER_TOR_STARTUP_TIMEOUT_SECONDS",
          1,
          120
        ),
        restartLimit: optionalBoundedInteger(
          environment,
          "FORGE_PEER_TOR_RESTART_LIMIT",
          0,
          16
        ),
        minimumRestartBackoffMs: optionalBoundedInteger(
          environment,
          "FORGE_PEER_TOR_MINIMUM_RESTART_BACKOFF_MS",
          100,
          30_000
        ),
        maximumRestartBackoffMs: optionalBoundedInteger(
          environment,
          "FORGE_PEER_TOR_MAXIMUM_RESTART_BACKOFF_MS",
          100,
          30_000
        )
      }
    : ({ enabled: false } as const);
  const httpMailbox = httpMailboxEnabled
    ? {
        enabled: true as const,
        origin: requiredEnvironmentValue(
          environment,
          "FORGE_PEER_HTTP_MAILBOX_ORIGIN"
        ),
        allowPrivateOrigin: strictFlag(
          environment,
          "FORGE_PEER_HTTP_MAILBOX_ALLOW_PRIVATE_ORIGIN",
          false
        ),
        allowLoopbackOrigin: strictFlag(
          environment,
          "FORGE_PEER_HTTP_MAILBOX_ALLOW_LOOPBACK_ORIGIN",
          false
        ),
        caFile: optionalConfiguredPath(
          environment,
          "FORGE_PEER_HTTP_MAILBOX_CA_FILE"
        ),
        pollIntervalMs: optionalBoundedInteger(
          environment,
          "FORGE_PEER_HTTP_MAILBOX_POLL_INTERVAL_MS",
          250,
          60_000
        )
      }
    : ({ enabled: false } as const);
  if (tor.enabled) {
    validateTorSocket(tor.socksEndpoint);
    if (
      tor.minimumRestartBackoffMs !== undefined &&
      tor.maximumRestartBackoffMs !== undefined &&
      tor.minimumRestartBackoffMs > tor.maximumRestartBackoffMs
    ) {
      throw new PeerRuntimeStartupError(
        "configuration",
        "The Tor restart backoff minimum cannot exceed its maximum."
      );
    }
  }
  if (httpMailbox.enabled) {
    validateMailboxConfiguration(httpMailbox);
  }

  return {
    enabled: true,
    required,
    supervisor: {
      enabled: true,
      binaryPath: requiredEnvironmentValue(environment, "FORGE_PEER_BIN"),
      socketPath,
      stateDir,
      ownerUserId,
      directEndpoints: directEndpoints(environment),
      irohEnabled,
      tor,
      httpMailbox,
      allowLoopbackDirect: strictFlag(
        environment,
        "FORGE_PEER_ALLOW_LOOPBACK_DIRECT",
        false
      )
    }
  };
}

function unavailableHandle(input: {
  configured: boolean;
  required: boolean;
  failure: "configuration" | "startup" | null;
  reason: string;
  supervisor?: PeerRuntimeSupervisor | null;
  supervisorAlreadyStopped?: boolean;
}): PeerRuntimeHandle {
  const supervisor = input.supervisor ?? null;
  let stopPromise: Promise<void> | null = input.supervisorAlreadyStopped
    ? Promise.resolve()
    : null;
  return {
    configured: input.configured,
    required: input.required,
    failure: input.failure,
    gateway: new UnavailablePeerCoreGateway(input.reason, input.configured),
    supervisor,
    stop() {
      if (!supervisor) return Promise.resolve();
      if (!stopPromise) {
        stopPromise = supervisor.stop().then(() => undefined);
      }
      return stopPromise;
    }
  };
}

async function startSingleOwnerPeerRuntime(input: {
  ownerUserId: string;
  dataDir: string;
  dependencies?: PeerRuntimeLaunchDependencies;
}): Promise<PeerRuntimeHandle> {
  const dependencies = input.dependencies ?? {};
  const environment = dependencies.environment ?? process.env;
  let required = false;
  let enabled = false;
  let configuration: PeerRuntimeConfiguration;
  try {
    enabled = strictFlag(environment, "FORGE_PEER_ENABLED", false);
    required = strictFlag(environment, "FORGE_PEER_REQUIRED", false);
    configuration = await resolvePeerRuntimeConfiguration({
      ownerUserId: input.ownerUserId,
      dataDir: input.dataDir,
      environment,
      resolveTemporaryDirectory: dependencies.resolveTemporaryDirectory
    });
  } catch (error) {
    if (required || !enabled) {
      if (error instanceof PeerRuntimeStartupError) throw error;
      throw new PeerRuntimeStartupError(
        "configuration",
        CONFIGURATION_FAILURE_REASON,
        { cause: error }
      );
    }
    return unavailableHandle({
      configured: true,
      required: false,
      failure: "configuration",
      reason: CONFIGURATION_FAILURE_REASON
    });
  }

  if (!configuration.enabled || !configuration.supervisor.enabled) {
    return unavailableHandle({
      configured: false,
      required: false,
      failure: null,
      reason: "The forge-peer daemon is not configured."
    });
  }

  let supervisor: PeerRuntimeSupervisor | null = null;
  const workers: PeerRuntimeWorker[] = [];
  try {
    const secrets = dependencies.secrets ?? new SecretsManager();
    if (!dependencies.secrets) secrets.configure(path.resolve(input.dataDir));
    const commandAuthorizer = (
      dependencies.createCommandAuthorizer ??
      ((authorizerInput) => new DerivedPeerCommandAuthorizer(authorizerInput))
    )({
      ownerUserId: input.ownerUserId,
      stateDir: configuration.supervisor.stateDir,
      secrets
    });
    const supervisorConfiguration: PeerDaemonSupervisorConfig = {
      ...configuration.supervisor,
      commandAuthorityPublicKey: commandAuthorizer.publicKeyBase64Url
    };
    supervisor = (
      dependencies.createSupervisor ??
      ((config) => new PeerDaemonSupervisor(config))
    )(supervisorConfiguration);
    const gateway = (
      dependencies.createGateway ??
      ((gatewayInput) => new UnixSocketPeerCoreGateway(gatewayInput))
    )({
      socketPath: configuration.supervisor.socketPath,
      ownerUserId: input.ownerUserId,
      commandAuthorizer
    });
    await supervisor.start();
    await commandAuthorizer.initialize();
    await gateway.syncCommandAuthorizationState({
      ownerUserId: input.ownerUserId
    });
    const identity = await gateway.localIdentity({
      ownerUserId: input.ownerUserId
    });
    if (gateway.transportReadiness) {
      const readiness = await gateway.transportReadiness({
        ownerUserId: input.ownerUserId
      });
      const expectedProviders = new Map([
        ["local_direct", configuration.supervisor.directEndpoints.length > 0],
        ["iroh", configuration.supervisor.irohEnabled],
        ["tor_onion", configuration.supervisor.tor?.enabled === true],
        ["http_mailbox", configuration.supervisor.httpMailbox?.enabled === true]
      ] as const);
      if (
        readiness.provenance.ownerUserId !== input.ownerUserId ||
        readiness.provenance.localPrincipalId !== identity.principal.id ||
        readiness.provenance.localDeviceId !== identity.device.id ||
        readiness.providers.length !== expectedProviders.size ||
        readiness.providers.some((provider) => {
          const expected = expectedProviders.get(provider.kind);
          return expected === undefined || expected
            ? !provider.configured || provider.state !== "ready"
            : provider.configured || provider.state !== "disabled";
        })
      ) {
        throw new PeerRuntimeStartupError(
          "startup",
          "The forge-peer transport readiness does not match its owner runtime configuration."
        );
      }
    }
    if (
      configuration.supervisor.irohEnabled &&
      (!identity.device.capabilities.includes("iroh") ||
        !identity.device.transportEndpoints.some(
          (endpoint) => endpoint.kind === "iroh"
        ))
    ) {
      throw new PeerRuntimeStartupError(
        "startup",
        "The forge-peer daemon did not expose its configured Iroh transport."
      );
    }
    const exposesTor =
      identity.device.capabilities.includes("tor") &&
      identity.device.transportEndpoints.some(
        (endpoint) => endpoint.kind === "tor_onion"
      );
    if (configuration.supervisor.tor?.enabled !== exposesTor) {
      throw new PeerRuntimeStartupError(
        "startup",
        "The forge-peer daemon Tor identity does not match its runtime configuration."
      );
    }
    if (
      !configuration.supervisor.httpMailbox?.enabled &&
      (identity.device.capabilities.includes("http_mailbox") ||
        identity.device.transportEndpoints.some(
          (endpoint) => endpoint.kind === "http_mailbox"
        ))
    ) {
      throw new PeerRuntimeStartupError(
        "startup",
        "The forge-peer daemon exposed a disabled HTTP mailbox provider."
      );
    }
    await (dependencies.persistIdentity ?? persistLocalPeerIdentity)({
      ownerUserId: input.ownerUserId,
      identity
    });

    const hasQueryWorkerGateway =
      gateway.claimInboundQuery !== undefined &&
      gateway.respondInboundQuery !== undefined;
    if (
      (gateway.claimInboundQuery === undefined) !==
      (gateway.respondInboundQuery === undefined)
    ) {
      throw new PeerRuntimeStartupError(
        "startup",
        "The peer query-worker gateway contract is incomplete."
      );
    }
    if (dependencies.createQuerySourceWorker || hasQueryWorkerGateway) {
      const worker = (
        dependencies.createQuerySourceWorker ??
        ((workerInput) => new PeerQuerySourceWorker(workerInput))
      )({ ownerUserId: input.ownerUserId, gateway });
      workers.push(worker);
      await worker.start();
    }
    const hasRevocationGateway =
      gateway.listRevocationEvents !== undefined &&
      gateway.ackRevocationEvents !== undefined;
    if (
      (gateway.listRevocationEvents === undefined) !==
      (gateway.ackRevocationEvents === undefined)
    ) {
      throw new PeerRuntimeStartupError(
        "startup",
        "The peer revocation-consumer gateway contract is incomplete."
      );
    }
    if (dependencies.createRevocationConsumer || hasRevocationGateway) {
      if (
        !dependencies.createRevocationConsumer &&
        !commandAuthorizer.invalidateAuthority
      ) {
        throw new PeerRuntimeStartupError(
          "startup",
          "The peer revocation consumer requires durable command-authority invalidation."
        );
      }
      const consumer = dependencies.createRevocationConsumer
        ? dependencies.createRevocationConsumer({
            ownerUserId: input.ownerUserId,
            gateway,
            commandAuthorizer
          })
        : new PeerRevocationEventConsumer({
            ownerUserId: input.ownerUserId,
            gateway,
            invalidateAuthorization: async (events) => {
              await commandAuthorizer.invalidateAuthority!({
                ownerUserId: input.ownerUserId,
                invalidatedAt: new Date().toISOString(),
                revokedDeviceIds: events.flatMap((event) =>
                  event.deviceId === null ? [] : [event.deviceId]
                )
              });
              await gateway.syncCommandAuthorizationState({
                ownerUserId: input.ownerUserId
              });
            }
          });
      workers.push(consumer);
      await consumer.start();
    }

    let stopPromise: Promise<void> | null = null;
    return {
      configured: true,
      required: configuration.required,
      failure: null,
      gateway,
      supervisor,
      stop() {
        if (!stopPromise) {
          stopPromise = (async () => {
            let workerError: unknown = null;
            for (const worker of [...workers].reverse()) {
              try {
                await worker.stop();
              } catch (error) {
                workerError ??= error;
              }
            }
            await supervisor!.stop();
            if (workerError) throw workerError;
          })();
        }
        return stopPromise;
      }
    };
  } catch (error) {
    for (const worker of [...workers].reverse()) {
      await worker.stop().catch(() => undefined);
    }
    if (supervisor) {
      await supervisor.stop().catch(() => undefined);
    }
    if (configuration.required) {
      throw new PeerRuntimeStartupError("startup", STARTUP_FAILURE_REASON, {
        cause: error
      });
    }
    return unavailableHandle({
      configured: true,
      required: false,
      failure: "startup",
      reason: STARTUP_FAILURE_REASON,
      supervisor,
      supervisorAlreadyStopped: true
    });
  }
}

export class PeerOwnerRuntimeManager implements PeerCoreGateway {
  private readonly runtimes = new Map<string, Promise<PeerRuntimeHandle>>();
  private stopped = false;

  constructor(
    private readonly input: {
      defaultOwnerUserId: string;
      dataDir: string;
      dependencies: PeerRuntimeLaunchDependencies;
      maximumOwners: number;
    }
  ) {}

  startOwner(ownerUserId: string): Promise<PeerRuntimeHandle> {
    const owner = validateOwnerUserId(ownerUserId);
    const existing = this.runtimes.get(owner);
    if (existing) return existing;
    if (this.stopped) {
      throw new Error("The peer owner runtime manager is stopped.");
    }
    if (this.runtimes.size >= this.input.maximumOwners) {
      throw new Error("The peer owner runtime limit has been reached.");
    }
    const starting = startSingleOwnerPeerRuntime({
      ownerUserId: owner,
      dataDir: this.input.dataDir,
      dependencies: this.input.dependencies
    }).then(async (runtime) => {
      if (this.stopped) await runtime.stop();
      return runtime;
    });
    this.runtimes.set(owner, starting);
    return starting;
  }

  private async gateway(ownerUserId: string) {
    return (await this.startOwner(ownerUserId)).gateway;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    const runtimes = await Promise.allSettled(this.runtimes.values());
    let firstError: unknown = null;
    for (const runtime of runtimes) {
      if (runtime.status === "rejected") {
        firstError ??= runtime.reason;
        continue;
      }
      try {
        await runtime.value.stop();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async health() {
    return (await this.gateway(this.input.defaultOwnerUserId)).health();
  }

  async transportReadiness(
    input: Parameters<NonNullable<PeerCoreGateway["transportReadiness"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.transportReadiness) {
      throw new Error("Peer transport readiness is unavailable.");
    }
    return gateway.transportReadiness(input);
  }

  async localIdentity(input: Parameters<PeerCoreGateway["localIdentity"]>[0]) {
    return (await this.gateway(input.ownerUserId)).localIdentity(input);
  }

  async commandReceipt(
    input: Parameters<PeerCoreGateway["commandReceipt"]>[0]
  ) {
    return (await this.gateway(input.ownerUserId)).commandReceipt(input);
  }

  async syncCommandAuthorizationState(
    input: Parameters<PeerCoreGateway["syncCommandAuthorizationState"]>[0]
  ) {
    return (
      await this.gateway(input.ownerUserId)
    ).syncCommandAuthorizationState(input);
  }

  async createInvitation(
    input: Parameters<PeerCoreGateway["createInvitation"]>[0]
  ) {
    return (await this.gateway(input.ownerUserId)).createInvitation(input);
  }

  async cancelInvitation(
    input: Parameters<NonNullable<PeerCoreGateway["cancelInvitation"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.cancelInvitation)
      throw new Error("The peer gateway is unavailable.");
    return gateway.cancelInvitation(input);
  }

  async acceptInvitation(
    input: Parameters<PeerCoreGateway["acceptInvitation"]>[0]
  ) {
    return (await this.gateway(input.ownerUserId)).acceptInvitation(input);
  }

  async acceptPendingRequest(
    input: Parameters<NonNullable<PeerCoreGateway["acceptPendingRequest"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.acceptPendingRequest)
      throw new Error("The peer gateway is unavailable.");
    return gateway.acceptPendingRequest(input);
  }

  async confirmPairing(
    input: Parameters<PeerCoreGateway["confirmPairing"]>[0]
  ) {
    return (await this.gateway(input.ownerUserId)).confirmPairing(input);
  }

  async signGrant(input: Parameters<PeerCoreGateway["signGrant"]>[0]) {
    return (await this.gateway(input.ownerUserId)).signGrant(input);
  }

  async revokeGrant(
    input: Parameters<NonNullable<PeerCoreGateway["revokeGrant"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.revokeGrant)
      throw new Error("The peer gateway is unavailable.");
    return gateway.revokeGrant(input);
  }

  async acceptGrant(input: Parameters<PeerCoreGateway["acceptGrant"]>[0]) {
    return (await this.gateway(input.ownerUserId)).acceptGrant(input);
  }

  async updateDevice(input: Parameters<PeerCoreGateway["updateDevice"]>[0]) {
    return (await this.gateway(input.ownerUserId)).updateDevice(input);
  }

  async revokeRelationship(
    input: Parameters<PeerCoreGateway["revokeRelationship"]>[0]
  ) {
    return (await this.gateway(input.ownerUserId)).revokeRelationship(input);
  }

  async requestResync(input: Parameters<PeerCoreGateway["requestResync"]>[0]) {
    return (await this.gateway(input.ownerUserId)).requestResync(input);
  }

  async claimInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["claimInboundQuery"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.claimInboundQuery)
      throw new Error("The peer query worker is unavailable.");
    return gateway.claimInboundQuery(input);
  }

  async respondInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["respondInboundQuery"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.respondInboundQuery)
      throw new Error("The peer query worker is unavailable.");
    return gateway.respondInboundQuery(input);
  }

  async listRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["listRevocationEvents"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.listRevocationEvents) {
      throw new Error("The peer revocation consumer is unavailable.");
    }
    return gateway.listRevocationEvents(input);
  }

  async ackRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["ackRevocationEvents"]>>[0]
  ) {
    const gateway = await this.gateway(input.ownerUserId);
    if (!gateway.ackRevocationEvents) {
      throw new Error("The peer revocation consumer is unavailable.");
    }
    return gateway.ackRevocationEvents(input);
  }

  async executeQuery(input: Parameters<PeerCoreGateway["executeQuery"]>[0]) {
    return (await this.gateway(input.ownerUserId)).executeQuery(input);
  }
}

export async function startPeerRuntime(input: {
  ownerUserId: string;
  dataDir: string;
  dependencies?: PeerRuntimeLaunchDependencies;
}): Promise<PeerRuntimeHandle> {
  const dependencies = input.dependencies ?? {};
  const maximumOwners = dependencies.maximumOwners ?? 32;
  if (
    !Number.isInteger(maximumOwners) ||
    maximumOwners < 1 ||
    maximumOwners > 128
  ) {
    throw new PeerRuntimeStartupError(
      "configuration",
      "The peer runtime owner limit must be within 1..=128."
    );
  }
  const manager = new PeerOwnerRuntimeManager({
    defaultOwnerUserId: validateOwnerUserId(input.ownerUserId),
    dataDir: input.dataDir,
    dependencies,
    maximumOwners
  });
  const defaultRuntime = await manager.startOwner(input.ownerUserId);
  let stopPromise: Promise<void> | null = null;
  return {
    configured: defaultRuntime.configured,
    required: defaultRuntime.required,
    gateway: manager,
    supervisor: defaultRuntime.supervisor,
    failure: defaultRuntime.failure,
    stop() {
      stopPromise ??= manager.stop();
      return stopPromise;
    }
  };
}
