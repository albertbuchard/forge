import {
  spawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { PeerCoreHealth } from "./peer-core-gateway.js";
import { UnixSocketPeerCoreGateway } from "./peer-core-ipc-gateway.js";

const PEER_PROTOCOL_VERSION = "forge-peer/1";
const IDENTITY_STATE_FILE = "identity-state.bin";
const OWNER_BINDING_FILE = "supervisor-owner.json";
const MAX_UNIX_SOCKET_PATH_BYTES = 103;
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 100;
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 4_000;
const DEFAULT_KILL_TIMEOUT_MS = 2_000;
const DEFAULT_RESTART_INITIAL_DELAY_MS = 250;
const DEFAULT_RESTART_MAX_DELAY_MS = 10_000;
const DEFAULT_RESTART_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_DIAGNOSTIC_BYTES = 16 * 1024;
const DEFAULT_IDENTITY_VALID_DAYS = 365;
const DEFAULT_TOR_VIRTUAL_PORT = 443;
const DEFAULT_TOR_STARTUP_TIMEOUT_SECONDS = 60;
const DEFAULT_TOR_RESTART_LIMIT = 5;
const DEFAULT_TOR_MINIMUM_RESTART_BACKOFF_MS = 250;
const DEFAULT_TOR_MAXIMUM_RESTART_BACKOFF_MS = 10_000;
const DEFAULT_MAILBOX_POLL_INTERVAL_MS = 1_000;
const PROCESS_GROUP_POLL_MS = 10;

const ALLOWED_CHILD_ENVIRONMENT = [
  "LANG",
  "LC_ALL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "TZ"
] as const;

export type PeerDaemonSupervisorState =
  | "disabled"
  | "stopped"
  | "starting"
  | "ready"
  | "backing_off"
  | "stopping"
  | "failed"
  | "circuit_open";

export type PeerDaemonTorConfig =
  | { enabled: false }
  | {
      enabled: true;
      executablePath: string;
      dataDir: string;
      socksEndpoint: string;
      virtualPort?: number;
      startupTimeoutSeconds?: number;
      restartLimit?: number;
      minimumRestartBackoffMs?: number;
      maximumRestartBackoffMs?: number;
    };

export type PeerDaemonHttpMailboxConfig =
  | { enabled: false }
  | {
      enabled: true;
      origin: string;
      allowPrivateOrigin?: boolean;
      allowLoopbackOrigin?: boolean;
      caFile?: string;
      pollIntervalMs?: number;
    };

export type PeerDaemonSupervisorConfig =
  | { enabled: false }
  | {
      enabled: true;
      binaryPath: string;
      socketPath: string;
      stateDir: string;
      ownerUserId: string;
      commandAuthorityPublicKey: string;
      directEndpoints: readonly string[];
      irohEnabled: boolean;
      tor?: PeerDaemonTorConfig;
      httpMailbox?: PeerDaemonHttpMailboxConfig;
      allowLoopbackDirect?: boolean;
      expectedProtocolVersion?: string;
      startupTimeoutMs?: number;
      healthPollIntervalMs?: number;
      healthProbeTimeoutMs?: number;
      shutdownTimeoutMs?: number;
      killTimeoutMs?: number;
      restartInitialDelayMs?: number;
      restartMaxDelayMs?: number;
      restartWindowMs?: number;
      maxRestarts?: number;
      diagnosticBytes?: number;
      identityValidDays?: number;
    };

export type PeerDaemonExitSnapshot = {
  code: number | null;
  signal: NodeJS.Signals | null;
  at: string;
  intentional: boolean;
};

export type PeerDaemonSupervisorSnapshot = {
  enabled: boolean;
  state: PeerDaemonSupervisorState;
  pid: number | null;
  restartCount: number;
  restartsInWindow: number;
  circuitOpen: boolean;
  startedAt: string | null;
  readyAt: string | null;
  nextRestartAt: string | null;
  lastExit: PeerDaemonExitSnapshot | null;
  lastError: string | null;
  stderrTail: string | null;
};

export type PeerDaemonHealthProbe = (input: {
  socketPath: string;
  ownerUserId: string;
  timeoutMs: number;
}) => Promise<PeerCoreHealth>;

export type PeerDaemonSupervisorDependencies = {
  spawnProcess?: typeof spawn;
  healthProbe?: PeerDaemonHealthProbe;
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  monotonicNow?: () => number;
};

export type PeerDaemonSupervisorErrorCode =
  | "configuration"
  | "filesystem_security"
  | "owner_mismatch"
  | "identity_initialization"
  | "spawn"
  | "startup_timeout"
  | "protocol"
  | "shutdown"
  | "stopped"
  | "circuit_open";

export class PeerDaemonSupervisorError extends Error {
  constructor(
    readonly code: PeerDaemonSupervisorErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PeerDaemonSupervisorError";
  }
}

type EnabledConfiguration = Extract<
  PeerDaemonSupervisorConfig,
  { enabled: true }
> & {
  tor: PeerDaemonTorConfig;
  httpMailbox: PeerDaemonHttpMailboxConfig;
  expectedProtocolVersion: string;
  startupTimeoutMs: number;
  healthPollIntervalMs: number;
  healthProbeTimeoutMs: number;
  shutdownTimeoutMs: number;
  killTimeoutMs: number;
  restartInitialDelayMs: number;
  restartMaxDelayMs: number;
  restartWindowMs: number;
  maxRestarts: number;
  diagnosticBytes: number;
  identityValidDays: number;
};

type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError: Error | null;
};

type ManagedProcess = {
  child: ChildProcess;
  pid: number | null;
  exit: Promise<ProcessExit>;
  exited: boolean;
  exitResult: ProcessExit | null;
  exitRecorded: boolean;
  termination: Promise<void> | null;
};

type ReadyWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

function normalizeAbsolutePath(
  value: string,
  label: string,
  maximumBytes = 4_096
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.dirname(value) === value ||
    Buffer.byteLength(value) > maximumBytes
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      `${label} must be a normalized absolute path.`
    );
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return selected;
}

function normalizeOwnerUserId(value: string) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer owner user id is invalid."
    );
  }
  return value;
}

function normalizeCommandAuthorityPublicKey(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer command authority public key must be canonical base64url Ed25519 bytes."
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.byteLength !== 32 ||
    decoded.toString("base64url") !== value ||
    decoded.every((byte) => byte === 0)
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer command authority public key must be canonical nonzero Ed25519 bytes."
    );
  }
  return value;
}

function normalizeDirectEndpoint(value: string) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.includes("\0") ||
    value.length > 96
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "A forge-peer direct endpoint is invalid."
    );
  }

  let host: string;
  let portText: string;
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(value);
    if (!match || isIP(match[1]) !== 6) {
      throw new PeerDaemonSupervisorError(
        "configuration",
        "A forge-peer direct endpoint must use an IP address and port."
      );
    }
    host = match[1];
    portText = match[2];
  } else {
    const separator = value.lastIndexOf(":");
    if (separator <= 0 || isIP(value.slice(0, separator)) !== 4) {
      throw new PeerDaemonSupervisorError(
        "configuration",
        "A forge-peer direct endpoint must use an IP address and port."
      );
    }
    host = value.slice(0, separator);
    portText = value.slice(separator + 1);
  }

  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "A forge-peer direct endpoint port is invalid."
    );
  }
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function normalizeTorConfiguration(
  config: PeerDaemonTorConfig | undefined
): PeerDaemonTorConfig {
  if (!config?.enabled) return { enabled: false };
  const socksEndpoint = normalizeDirectEndpoint(config.socksEndpoint);
  const host = socksEndpoint.startsWith("[")
    ? socksEndpoint.slice(1, socksEndpoint.indexOf("]"))
    : socksEndpoint.slice(0, socksEndpoint.lastIndexOf(":"));
  const loopback =
    (isIP(host) === 4 && host.split(".")[0] === "127") ||
    (isIP(host) === 6 && host === "::1");
  if (!loopback) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer Tor SOCKS endpoint must be a loopback IP socket."
    );
  }
  const minimumRestartBackoffMs = boundedInteger(
    config.minimumRestartBackoffMs,
    DEFAULT_TOR_MINIMUM_RESTART_BACKOFF_MS,
    100,
    30_000,
    "tor.minimumRestartBackoffMs"
  );
  const maximumRestartBackoffMs = boundedInteger(
    config.maximumRestartBackoffMs,
    DEFAULT_TOR_MAXIMUM_RESTART_BACKOFF_MS,
    minimumRestartBackoffMs,
    30_000,
    "tor.maximumRestartBackoffMs"
  );
  return {
    enabled: true,
    executablePath: normalizeAbsolutePath(
      config.executablePath,
      "tor.executablePath"
    ),
    dataDir: normalizeAbsolutePath(config.dataDir, "tor.dataDir"),
    socksEndpoint,
    virtualPort: boundedInteger(
      config.virtualPort,
      DEFAULT_TOR_VIRTUAL_PORT,
      1,
      65_535,
      "tor.virtualPort"
    ),
    startupTimeoutSeconds: boundedInteger(
      config.startupTimeoutSeconds,
      DEFAULT_TOR_STARTUP_TIMEOUT_SECONDS,
      1,
      120,
      "tor.startupTimeoutSeconds"
    ),
    restartLimit: boundedInteger(
      config.restartLimit,
      DEFAULT_TOR_RESTART_LIMIT,
      0,
      16,
      "tor.restartLimit"
    ),
    minimumRestartBackoffMs,
    maximumRestartBackoffMs
  };
}

function normalizeMailboxConfiguration(
  config: PeerDaemonHttpMailboxConfig | undefined
): PeerDaemonHttpMailboxConfig {
  if (!config?.enabled) return { enabled: false };
  let parsed: URL;
  try {
    parsed = new URL(config.origin);
  } catch {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer HTTP mailbox origin is invalid."
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== config.origin
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer HTTP mailbox must use a canonical credential-free HTTPS origin."
    );
  }
  const allowPrivateOrigin = config.allowPrivateOrigin === true;
  const allowLoopbackOrigin = config.allowLoopbackOrigin === true;
  if (allowPrivateOrigin && allowLoopbackOrigin) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer mailbox private and loopback origin modes are mutually exclusive."
    );
  }
  const caFile =
    config.caFile === undefined
      ? undefined
      : normalizeAbsolutePath(config.caFile, "httpMailbox.caFile");
  if (allowLoopbackOrigin && caFile === undefined) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "A loopback forge-peer mailbox requires an explicit CA file."
    );
  }
  return {
    enabled: true,
    origin: parsed.origin,
    allowPrivateOrigin,
    allowLoopbackOrigin,
    ...(caFile === undefined ? {} : { caFile }),
    pollIntervalMs: boundedInteger(
      config.pollIntervalMs,
      DEFAULT_MAILBOX_POLL_INTERVAL_MS,
      250,
      60_000,
      "httpMailbox.pollIntervalMs"
    )
  };
}

function normalizeEnabledConfiguration(
  config: Extract<PeerDaemonSupervisorConfig, { enabled: true }>
): EnabledConfiguration {
  const binaryPath = normalizeAbsolutePath(config.binaryPath, "binaryPath");
  const socketPath = normalizeAbsolutePath(
    config.socketPath,
    "socketPath",
    MAX_UNIX_SOCKET_PATH_BYTES
  );
  const stateDir = normalizeAbsolutePath(config.stateDir, "stateDir");
  const socketRelativeToState = path.relative(stateDir, socketPath);
  const socketIsInsideState =
    socketRelativeToState === "" ||
    (socketRelativeToState !== ".." &&
      !socketRelativeToState.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(socketRelativeToState));
  if (
    binaryPath === socketPath ||
    binaryPath === stateDir ||
    socketPath === stateDir ||
    socketIsInsideState
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer binary, socket, and durable state paths must be separate."
    );
  }
  const endpoints = [
    ...new Set(config.directEndpoints.map(normalizeDirectEndpoint))
  ];
  const irohEnabled = config.irohEnabled === true;
  const tor = normalizeTorConfiguration(config.tor);
  const httpMailbox = normalizeMailboxConfiguration(config.httpMailbox);
  if (
    endpoints.length > 8 ||
    (endpoints.length === 0 &&
      !irohEnabled &&
      !tor.enabled &&
      !httpMailbox.enabled)
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "forge-peer requires at least one explicitly configured transport provider."
    );
  }
  if (
    (tor.enabled &&
      [binaryPath, socketPath, stateDir].includes(tor.executablePath)) ||
    (tor.enabled && [binaryPath, socketPath].includes(tor.dataDir)) ||
    (httpMailbox.enabled &&
      httpMailbox.caFile !== undefined &&
      [binaryPath, socketPath, stateDir].includes(httpMailbox.caFile))
  ) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The forge-peer provider paths must be separate from runtime control paths."
    );
  }
  const expectedProtocolVersion =
    config.expectedProtocolVersion ?? PEER_PROTOCOL_VERSION;
  if (!/^forge-peer\/\d+$/.test(expectedProtocolVersion)) {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "The expected forge-peer protocol version is invalid."
    );
  }

  const restartInitialDelayMs = boundedInteger(
    config.restartInitialDelayMs,
    DEFAULT_RESTART_INITIAL_DELAY_MS,
    5,
    60_000,
    "restartInitialDelayMs"
  );
  const restartMaxDelayMs = boundedInteger(
    config.restartMaxDelayMs,
    DEFAULT_RESTART_MAX_DELAY_MS,
    restartInitialDelayMs,
    300_000,
    "restartMaxDelayMs"
  );

  return {
    ...config,
    binaryPath,
    socketPath,
    stateDir,
    ownerUserId: normalizeOwnerUserId(config.ownerUserId),
    commandAuthorityPublicKey: normalizeCommandAuthorityPublicKey(
      config.commandAuthorityPublicKey
    ),
    directEndpoints: endpoints,
    irohEnabled,
    tor,
    httpMailbox,
    allowLoopbackDirect: config.allowLoopbackDirect === true,
    expectedProtocolVersion,
    startupTimeoutMs: boundedInteger(
      config.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
      25,
      300_000,
      "startupTimeoutMs"
    ),
    healthPollIntervalMs: boundedInteger(
      config.healthPollIntervalMs,
      DEFAULT_HEALTH_POLL_INTERVAL_MS,
      5,
      10_000,
      "healthPollIntervalMs"
    ),
    healthProbeTimeoutMs: boundedInteger(
      config.healthProbeTimeoutMs,
      DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
      10,
      30_000,
      "healthProbeTimeoutMs"
    ),
    shutdownTimeoutMs: boundedInteger(
      config.shutdownTimeoutMs,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      10,
      60_000,
      "shutdownTimeoutMs"
    ),
    killTimeoutMs: boundedInteger(
      config.killTimeoutMs,
      DEFAULT_KILL_TIMEOUT_MS,
      10,
      30_000,
      "killTimeoutMs"
    ),
    restartInitialDelayMs,
    restartMaxDelayMs,
    restartWindowMs: boundedInteger(
      config.restartWindowMs,
      DEFAULT_RESTART_WINDOW_MS,
      50,
      86_400_000,
      "restartWindowMs"
    ),
    maxRestarts: boundedInteger(
      config.maxRestarts,
      DEFAULT_MAX_RESTARTS,
      0,
      100,
      "maxRestarts"
    ),
    diagnosticBytes: boundedInteger(
      config.diagnosticBytes,
      DEFAULT_DIAGNOSTIC_BYTES,
      1_024,
      64 * 1_024,
      "diagnosticBytes"
    ),
    identityValidDays: boundedInteger(
      config.identityValidDays,
      DEFAULT_IDENTITY_VALID_DAYS,
      1,
      3_650,
      "identityValidDays"
    )
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    throw new PeerDaemonSupervisorError(
      "configuration",
      "forge-peer supervision requires a Unix owner identity."
    );
  }
  return process.getuid();
}

async function ensurePrivateDirectory(
  directoryPath: string,
  label: string,
  allowCreate = true
) {
  const root = path.parse(directoryPath).root;
  const relativeParts = directoryPath
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = root;

  for (const part of relativeParts) {
    current = path.join(current, part);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new PeerDaemonSupervisorError(
          "filesystem_security",
          `${label} contains a symlink or non-directory component.`
        );
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      if (!allowCreate) {
        throw new PeerDaemonSupervisorError(
          "filesystem_security",
          `${label} disappeared after forge-peer supervision started.`
        );
      }
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isNodeError(mkdirError) || mkdirError.code !== "EEXIST") {
          throw mkdirError;
        }
      }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new PeerDaemonSupervisorError(
          "filesystem_security",
          `${label} could not be created securely.`
        );
      }
    }
  }

  const [resolved, metadata] = await Promise.all([
    realpath(directoryPath),
    lstat(directoryPath)
  ]);
  if (
    resolved !== directoryPath ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid() ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      `${label} must be an owner-only, non-symlink directory.`
    );
  }
}

async function inspectSecureFile(
  filePath: string,
  label: string,
  options: {
    executable?: boolean;
    allowRootOwner?: boolean;
    allowMissing?: boolean;
    allowPublicRead?: boolean;
  }
) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (options.allowMissing && isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      `${label} is unavailable.`,
      { cause: error }
    );
  }

  let resolved: string;
  try {
    resolved = await realpath(filePath);
  } catch (error) {
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      `${label} could not be resolved securely.`,
      { cause: error }
    );
  }
  const allowedOwners = options.allowRootOwner
    ? new Set([0, currentUid()])
    : new Set([currentUid()]);
  if (
    resolved !== filePath ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    !allowedOwners.has(metadata.uid) ||
    (metadata.mode & 0o022) !== 0 ||
    (!options.executable &&
      !options.allowPublicRead &&
      (metadata.mode & 0o777) !== 0o600) ||
    (!options.executable &&
      options.allowPublicRead &&
      (metadata.mode & 0o111) !== 0)
  ) {
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      `${label} has unsafe ownership, type, or permissions.`
    );
  }
  if (options.executable) {
    try {
      await access(filePath, fsConstants.X_OK);
    } catch (error) {
      throw new PeerDaemonSupervisorError(
        "filesystem_security",
        `${label} is not executable by the current owner.`,
        { cause: error }
      );
    }
  }
  return metadata;
}

async function inspectSocketPath(socketPath: string) {
  let metadata;
  try {
    metadata = await lstat(socketPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      "The forge-peer socket path could not be inspected.",
      { cause: error }
    );
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isSocket() ||
    metadata.uid !== currentUid() ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new PeerDaemonSupervisorError(
      "filesystem_security",
      "The existing forge-peer socket is not an owner-only Unix socket."
    );
  }
  return true;
}

function sanitizedEnvironment(source: NodeJS.ProcessEnv) {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ALLOWED_CHILD_ENVIRONMENT) {
    const value = source[name];
    if (
      typeof value === "string" &&
      value.length <= 8_192 &&
      !value.includes("\0")
    ) {
      environment[name] = value;
    }
  }
  return environment;
}

function stripTerminalControls(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 27) {
      const next = value.charCodeAt(index + 1);
      if (next === 91) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index);
          if (current >= 64 && current <= 126) break;
          index += 1;
        }
      } else if (next === 93) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index);
          if (current === 7) break;
          if (current === 27 && value.charCodeAt(index + 1) === 92) {
            index += 1;
            break;
          }
          index += 1;
        }
      } else if (index + 1 < value.length) {
        index += 1;
      }
      continue;
    }
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127
    ) {
      continue;
    }
    result += value[index];
  }
  return result;
}

function sanitizeDiagnostic(value: string) {
  return stripTerminalControls(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_PATH|DB_URL)\b\s*[:=]\s*[^\s,;]+/gi,
      "credential=[REDACTED]"
    )
    .replace(
      /\b(api[_-]?key|authorization|cookie|database[_-]?url|db[_-]?(?:path|url)|password|secret|token)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    )
    .slice(-32 * 1_024);
}

function abortError() {
  return new PeerDaemonSupervisorError(
    "stopped",
    "forge-peer startup was intentionally stopped."
  );
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    function finish() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function timestamp(now: number) {
  return new Date(now).toISOString();
}

export class PeerDaemonSupervisor {
  private readonly config: EnabledConfiguration | null;
  private readonly spawnProcess: typeof spawn;
  private readonly healthProbe: PeerDaemonHealthProbe;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private state: PeerDaemonSupervisorState;
  private activeProcess: ManagedProcess | null = null;
  private runPromise: Promise<void> | null = null;
  private stopPromise: Promise<PeerDaemonSupervisorSnapshot> | null = null;
  private runAbort: AbortController | null = null;
  private readyWaiters = new Set<ReadyWaiter>();
  private stopRequested = false;
  private restartTimestamps: number[] = [];
  private restartCount = 0;
  private startedAt: string | null = null;
  private readyAt: string | null = null;
  private nextRestartAt: string | null = null;
  private lastExit: PeerDaemonExitSnapshot | null = null;
  private lastError: string | null = null;
  private stderrTail = "";

  constructor(
    config: PeerDaemonSupervisorConfig,
    dependencies: PeerDaemonSupervisorDependencies = {}
  ) {
    this.config = config.enabled ? normalizeEnabledConfiguration(config) : null;
    this.spawnProcess = dependencies.spawnProcess ?? spawn;
    this.environment = sanitizedEnvironment(
      dependencies.environment ?? process.env
    );
    this.wallNow = dependencies.now ?? Date.now;
    this.monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.state = config.enabled ? "stopped" : "disabled";
    this.healthProbe =
      dependencies.healthProbe ??
      (async ({ socketPath, ownerUserId, timeoutMs }) =>
        await new UnixSocketPeerCoreGateway({
          socketPath,
          ownerUserId,
          timeoutMs: Math.max(100, Math.min(timeoutMs, 30_000))
        }).health());
  }

  private get settings() {
    if (!this.config) {
      throw new PeerDaemonSupervisorError(
        "configuration",
        "The forge-peer supervisor is disabled."
      );
    }
    return this.config;
  }

  status(): PeerDaemonSupervisorSnapshot {
    const now = this.monotonicNow();
    this.pruneRestartWindow(now);
    return {
      enabled: this.config !== null,
      state: this.state,
      pid: this.activeProcess?.pid ?? null,
      restartCount: this.restartCount,
      restartsInWindow: this.restartTimestamps.length,
      circuitOpen: this.state === "circuit_open",
      startedAt: this.startedAt,
      readyAt: this.readyAt,
      nextRestartAt: this.nextRestartAt,
      lastExit: this.lastExit ? { ...this.lastExit } : null,
      lastError: this.lastError,
      stderrTail: this.stderrTail.length > 0 ? this.stderrTail : null
    };
  }

  async start(): Promise<PeerDaemonSupervisorSnapshot> {
    if (!this.config) return this.status();
    if (this.state === "ready") return this.status();
    if (this.stopPromise) {
      throw new PeerDaemonSupervisorError(
        "stopped",
        "forge-peer is currently stopping."
      );
    }
    if (this.state === "circuit_open") {
      throw new PeerDaemonSupervisorError(
        "circuit_open",
        "forge-peer restart protection is open; stop it before an explicit retry."
      );
    }

    const ready = this.waitUntilReady();
    if (!this.runPromise) {
      this.stopRequested = false;
      this.restartTimestamps = [];
      this.nextRestartAt = null;
      this.lastError = null;
      const controller = new AbortController();
      this.runAbort = controller;
      const run = this.run(controller.signal).finally(() => {
        if (this.runPromise === run) this.runPromise = null;
        if (this.runAbort === controller) this.runAbort = null;
      });
      this.runPromise = run;
    }
    await ready;
    return this.status();
  }

  stop(): Promise<PeerDaemonSupervisorSnapshot> {
    if (!this.config) return Promise.resolve(this.status());
    if (this.stopPromise) return this.stopPromise;
    const operation = this.stopOnce().finally(() => {
      if (this.stopPromise === operation) this.stopPromise = null;
    });
    this.stopPromise = operation;
    return operation;
  }

  private async stopOnce(): Promise<PeerDaemonSupervisorSnapshot> {
    this.stopRequested = true;
    this.nextRestartAt = null;
    this.runAbort?.abort();
    this.rejectReadyWaiters(abortError());

    const active = this.activeProcess;
    const run = this.runPromise;
    let terminationError: unknown = null;
    if (active) {
      this.state = "stopping";
      try {
        await this.terminateProcess(active);
      } catch (error) {
        terminationError = error;
      }
    }
    await run;
    if (terminationError) {
      this.state = "failed";
      this.lastError = "forge-peer could not be terminated completely.";
      throw terminationError;
    }
    this.restartTimestamps = [];
    this.state = "stopped";
    return this.status();
  }

  private async run(signal: AbortSignal) {
    try {
      await this.prepareFilesystem();
      await this.ensureIdentity(signal);

      while (!signal.aborted && !this.stopRequested) {
        let processHandle: ManagedProcess | null = null;
        let failure: unknown = null;
        try {
          await this.validateRuntimeSecurity();
          await this.recoverStaleSocket(signal);
          this.state = "starting";
          this.startedAt = timestamp(this.wallNow());
          this.readyAt = null;
          this.nextRestartAt = null;
          processHandle = this.spawnChild(this.serveArguments());
          this.activeProcess = processHandle;

          await this.waitForReadiness(processHandle, signal);
          this.state = "ready";
          this.readyAt = timestamp(this.wallNow());
          this.lastError = null;
          this.resolveReadyWaiters();

          const exit = await processHandle.exit;
          this.recordManagedExit(processHandle, exit, this.stopRequested);
          failure = new PeerDaemonSupervisorError(
            "spawn",
            "forge-peer exited unexpectedly."
          );
        } catch (error) {
          failure = error;
        } finally {
          if (processHandle) {
            try {
              await this.terminateProcess(processHandle);
            } catch (terminationError) {
              failure = terminationError;
            }
            if (processHandle.exitResult) {
              this.recordManagedExit(
                processHandle,
                processHandle.exitResult,
                this.stopRequested
              );
            }
          }
          if (this.activeProcess === processHandle) this.activeProcess = null;
        }

        if (signal.aborted || this.stopRequested) break;
        if (this.isFatalFailure(failure)) {
          this.state = "failed";
          this.lastError = this.failureSummary(failure);
          this.rejectReadyWaiters(failure);
          return;
        }

        this.lastError = this.failureSummary(failure);
        const backoff = this.reserveRestart();
        if (backoff === null) {
          this.state = "circuit_open";
          this.nextRestartAt = null;
          const circuitError = new PeerDaemonSupervisorError(
            "circuit_open",
            "forge-peer exceeded its bounded restart budget."
          );
          this.rejectReadyWaiters(circuitError);
          return;
        }
        this.state = "backing_off";
        this.nextRestartAt = timestamp(this.wallNow() + backoff);
        try {
          await abortableDelay(backoff, signal);
        } catch (error) {
          if (!signal.aborted && !this.stopRequested) throw error;
        }
      }
    } catch (error) {
      if (!signal.aborted && !this.stopRequested) {
        this.state = "failed";
        this.lastError = this.failureSummary(error);
        this.rejectReadyWaiters(error);
      }
    } finally {
      this.nextRestartAt = null;
      if (signal.aborted || this.stopRequested) {
        this.state = "stopped";
      } else if (this.state !== "failed" && this.state !== "circuit_open") {
        this.state = "failed";
      }
    }
  }

  private async prepareFilesystem() {
    try {
      await this.validateExecutable();
      await ensurePrivateDirectory(this.settings.stateDir, "stateDir");
      if (this.settings.tor.enabled) {
        await ensurePrivateDirectory(this.settings.tor.dataDir, "tor.dataDir");
      }
      await ensurePrivateDirectory(
        path.dirname(this.settings.socketPath),
        "socketDir"
      );
      await inspectSocketPath(this.settings.socketPath);
      await this.bindOwner();
    } catch (error) {
      if (error instanceof PeerDaemonSupervisorError) throw error;
      throw new PeerDaemonSupervisorError(
        "filesystem_security",
        "The forge-peer runtime paths could not be prepared safely.",
        { cause: error }
      );
    }
  }

  private async validateExecutable() {
    await inspectSecureFile(this.settings.binaryPath, "binaryPath", {
      executable: true,
      allowRootOwner: true
    });
    if (this.settings.tor.enabled) {
      await inspectSecureFile(
        this.settings.tor.executablePath,
        "tor.executablePath",
        { executable: true, allowRootOwner: true }
      );
    }
    if (
      this.settings.httpMailbox.enabled &&
      this.settings.httpMailbox.caFile !== undefined
    ) {
      await inspectSecureFile(
        this.settings.httpMailbox.caFile,
        "httpMailbox.caFile",
        { allowRootOwner: true, allowPublicRead: true }
      );
    }
  }

  private async bindOwner() {
    const bindingPath = path.join(this.settings.stateDir, OWNER_BINDING_FILE);
    const expected = JSON.stringify({
      schemaVersion: 1,
      ownerUserId: this.settings.ownerUserId
    });
    let handle;
    try {
      handle = await open(bindingPath, "wx", 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(`${expected}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }

    await this.verifyOwnerBinding(bindingPath);
  }

  private async verifyOwnerBinding(
    bindingPath = path.join(this.settings.stateDir, OWNER_BINDING_FILE)
  ) {
    await inspectSecureFile(bindingPath, "forge-peer owner binding", {});
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readFile(bindingPath, "utf8")).trim());
    } catch (error) {
      throw new PeerDaemonSupervisorError(
        "owner_mismatch",
        "The forge-peer owner binding is invalid.",
        { cause: error }
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      (parsed as Record<string, unknown>).schemaVersion !== 1 ||
      (parsed as Record<string, unknown>).ownerUserId !==
        this.settings.ownerUserId
    ) {
      throw new PeerDaemonSupervisorError(
        "owner_mismatch",
        "The forge-peer state directory belongs to a different Forge owner."
      );
    }
  }

  private async validateRuntimeSecurity() {
    await this.validateExecutable();
    await ensurePrivateDirectory(this.settings.stateDir, "stateDir", false);
    if (this.settings.tor.enabled) {
      await ensurePrivateDirectory(
        this.settings.tor.dataDir,
        "tor.dataDir",
        false
      );
    }
    await ensurePrivateDirectory(
      path.dirname(this.settings.socketPath),
      "socketDir",
      false
    );
    await this.verifyOwnerBinding();
    await inspectSecureFile(
      path.join(this.settings.stateDir, IDENTITY_STATE_FILE),
      "forge-peer identity state",
      {}
    );
    await inspectSocketPath(this.settings.socketPath);
  }

  private async ensureIdentity(signal: AbortSignal) {
    const identityPath = path.join(this.settings.stateDir, IDENTITY_STATE_FILE);
    const identity = await inspectSecureFile(
      identityPath,
      "forge-peer identity state",
      { allowMissing: true }
    );
    if (identity) return;
    if (signal.aborted || this.stopRequested) throw abortError();

    const processHandle = this.spawnChild([
      "identity",
      "init",
      "--state-dir",
      this.settings.stateDir,
      "--valid-days",
      String(this.settings.identityValidDays)
    ]);
    this.activeProcess = processHandle;
    try {
      const exit = await this.waitForProcessExit(
        processHandle,
        this.settings.startupTimeoutMs,
        signal
      );
      if (exit.spawnError || exit.code !== 0) {
        throw new PeerDaemonSupervisorError(
          "identity_initialization",
          "forge-peer identity initialization failed."
        );
      }
      await this.terminateProcess(processHandle);
    } catch (error) {
      await this.terminateProcess(processHandle);
      if (
        error instanceof PeerDaemonSupervisorError &&
        error.code === "stopped"
      ) {
        throw error;
      }
      throw new PeerDaemonSupervisorError(
        "identity_initialization",
        "forge-peer identity initialization did not complete safely.",
        { cause: error }
      );
    } finally {
      if (this.activeProcess === processHandle) this.activeProcess = null;
    }
    await inspectSecureFile(identityPath, "forge-peer identity state", {});
  }

  private async recoverStaleSocket(signal: AbortSignal) {
    if (!(await inspectSocketPath(this.settings.socketPath))) return;
    if (signal.aborted || this.stopRequested) throw abortError();

    const processHandle = this.spawnChild([
      "recover-socket",
      "--socket",
      this.settings.socketPath
    ]);
    this.activeProcess = processHandle;
    try {
      const exit = await this.waitForProcessExit(
        processHandle,
        this.settings.startupTimeoutMs,
        signal
      );
      if (exit.spawnError || exit.code !== 0) {
        throw new PeerDaemonSupervisorError(
          "filesystem_security",
          "forge-peer refused to recover the existing IPC socket."
        );
      }
      await this.terminateProcess(processHandle);
    } catch (error) {
      await this.terminateProcess(processHandle);
      if (
        error instanceof PeerDaemonSupervisorError &&
        error.code === "stopped"
      ) {
        throw error;
      }
      if (
        error instanceof PeerDaemonSupervisorError &&
        error.code === "filesystem_security"
      ) {
        throw error;
      }
      throw new PeerDaemonSupervisorError(
        "filesystem_security",
        "forge-peer could not recover the existing IPC socket safely.",
        { cause: error }
      );
    } finally {
      if (this.activeProcess === processHandle) this.activeProcess = null;
    }
    if (await inspectSocketPath(this.settings.socketPath)) {
      throw new PeerDaemonSupervisorError(
        "filesystem_security",
        "forge-peer reported socket recovery without removing the stale endpoint."
      );
    }
  }

  private serveArguments() {
    const args = [
      "serve",
      "--socket",
      this.settings.socketPath,
      "--state-dir",
      this.settings.stateDir,
      "--owner-user-id",
      this.settings.ownerUserId,
      "--command-authority-public-key",
      this.settings.commandAuthorityPublicKey
    ];
    for (const endpoint of this.settings.directEndpoints) {
      args.push("--direct-endpoint", endpoint);
    }
    if (this.settings.irohEnabled) {
      args.push("--enable-iroh");
    }
    if (this.settings.allowLoopbackDirect) {
      args.push("--allow-loopback-direct");
    }
    if (this.settings.tor.enabled) {
      args.push(
        "--tor-executable",
        this.settings.tor.executablePath,
        "--tor-data-dir",
        this.settings.tor.dataDir,
        "--tor-socks-endpoint",
        this.settings.tor.socksEndpoint,
        "--tor-virtual-port",
        String(this.settings.tor.virtualPort),
        "--tor-startup-timeout-seconds",
        String(this.settings.tor.startupTimeoutSeconds),
        "--tor-restart-limit",
        String(this.settings.tor.restartLimit),
        "--tor-minimum-restart-backoff-ms",
        String(this.settings.tor.minimumRestartBackoffMs),
        "--tor-maximum-restart-backoff-ms",
        String(this.settings.tor.maximumRestartBackoffMs)
      );
    }
    if (this.settings.httpMailbox.enabled) {
      args.push("--mailbox-origin", this.settings.httpMailbox.origin);
      if (this.settings.httpMailbox.allowPrivateOrigin) {
        args.push("--mailbox-allow-private-origin");
      }
      if (this.settings.httpMailbox.allowLoopbackOrigin) {
        args.push("--mailbox-allow-loopback-origin");
      }
      if (this.settings.httpMailbox.caFile !== undefined) {
        args.push("--mailbox-ca-file", this.settings.httpMailbox.caFile);
      }
      args.push(
        "--mailbox-poll-interval-ms",
        String(this.settings.httpMailbox.pollIntervalMs)
      );
    }
    return args;
  }

  private spawnChild(args: string[]) {
    const options: SpawnOptions = {
      cwd: this.settings.stateDir,
      detached: true,
      env: this.environment,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true
    };
    let child: ChildProcess;
    try {
      child = this.spawnProcess(this.settings.binaryPath, args, options);
    } catch (error) {
      throw new PeerDaemonSupervisorError(
        "spawn",
        "forge-peer could not be started.",
        { cause: error }
      );
    }

    const managed: ManagedProcess = {
      child,
      pid: typeof child.pid === "number" ? child.pid : null,
      exit: Promise.resolve({ code: null, signal: null, spawnError: null }),
      exited: false,
      exitResult: null,
      exitRecorded: false,
      termination: null
    };
    managed.exit = new Promise<ProcessExit>((resolve) => {
      let spawnError: Error | null = null;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        const result = { code, signal, spawnError };
        managed.exited = true;
        managed.exitResult = result;
        resolve(result);
      });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.appendDiagnostic(
        Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk
      );
    });
    return managed;
  }

  private async waitForReadiness(
    processHandle: ManagedProcess,
    signal: AbortSignal
  ) {
    const deadline = this.monotonicNow() + this.settings.startupTimeoutMs;
    while (!signal.aborted && !this.stopRequested) {
      const remaining = deadline - this.monotonicNow();
      if (remaining <= 0) {
        throw new PeerDaemonSupervisorError(
          "startup_timeout",
          "forge-peer did not become healthy before the startup deadline."
        );
      }

      const result = await Promise.race([
        this.probeHealth(
          Math.min(remaining, this.settings.healthProbeTimeoutMs)
        ).then((health) => ({ type: "health" as const, health })),
        processHandle.exit.then((exit) => ({ type: "exit" as const, exit }))
      ]);
      if (result.type === "exit") {
        this.recordManagedExit(
          processHandle,
          result.exit,
          this.stopRequested || signal.aborted
        );
        throw new PeerDaemonSupervisorError(
          "spawn",
          "forge-peer exited before it became healthy."
        );
      }
      if (result.health?.healthy && result.health.enabled) {
        if (processHandle.exited) {
          throw new PeerDaemonSupervisorError(
            "spawn",
            "forge-peer exited while readiness was being confirmed."
          );
        }
        if (
          result.health.protocolVersion !==
          this.settings.expectedProtocolVersion
        ) {
          throw new PeerDaemonSupervisorError(
            "protocol",
            "forge-peer reported an incompatible protocol version."
          );
        }
        return;
      }
      const delayRemaining = deadline - this.monotonicNow();
      if (delayRemaining <= 0) continue;
      await abortableDelay(
        Math.min(this.settings.healthPollIntervalMs, delayRemaining),
        signal
      );
    }
    throw abortError();
  }

  private async probeHealth(timeoutMs: number) {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        this.healthProbe({
          socketPath: this.settings.socketPath,
          ownerUserId: this.settings.ownerUserId,
          timeoutMs
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        })
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async waitForProcessExit(
    processHandle: ManagedProcess,
    timeoutMs: number,
    signal: AbortSignal
  ) {
    if (signal.aborted) throw abortError();
    return await new Promise<ProcessExit>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PeerDaemonSupervisorError(
            "startup_timeout",
            "forge-peer initialization timed out."
          )
        );
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void processHandle.exit.then((exit) => {
        cleanup();
        resolve(exit);
      });
    });
  }

  private terminateProcess(processHandle: ManagedProcess) {
    if (processHandle.termination) return processHandle.termination;
    processHandle.termination = this.terminateProcessOnce(processHandle);
    return processHandle.termination;
  }

  private async terminateProcessOnce(processHandle: ManagedProcess) {
    if (await this.processTreeGone(processHandle)) return;
    this.signalProcessGroup(processHandle, "SIGTERM");
    if (
      await this.waitForProcessTree(
        processHandle,
        this.settings.shutdownTimeoutMs
      )
    ) {
      return;
    }
    this.signalProcessGroup(processHandle, "SIGKILL");
    if (
      !(await this.waitForProcessTree(
        processHandle,
        this.settings.killTimeoutMs
      ))
    ) {
      throw new PeerDaemonSupervisorError(
        "shutdown",
        "forge-peer remained alive after SIGKILL."
      );
    }
  }

  private signalProcessGroup(
    processHandle: ManagedProcess,
    signal: NodeJS.Signals
  ) {
    try {
      if (
        processHandle.pid !== null &&
        processHandle.pid > 1 &&
        processHandle.pid !== process.pid
      ) {
        process.kill(-processHandle.pid, signal);
      } else {
        processHandle.child.kill(signal);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ESRCH") return;
      throw new PeerDaemonSupervisorError(
        "shutdown",
        `forge-peer could not receive ${signal}.`,
        { cause: error }
      );
    }
  }

  private async processTreeGone(processHandle: ManagedProcess) {
    if (processHandle.pid === null) return processHandle.exited;
    let groupAlive = false;
    try {
      process.kill(-processHandle.pid, 0);
      groupAlive = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ESRCH") groupAlive = true;
    }
    return processHandle.exited && !groupAlive;
  }

  private async waitForProcessTree(
    processHandle: ManagedProcess,
    timeoutMs: number
  ) {
    const deadline = this.monotonicNow() + timeoutMs;
    while (this.monotonicNow() < deadline) {
      if (await this.processTreeGone(processHandle)) return true;
      await new Promise((resolve) =>
        setTimeout(resolve, PROCESS_GROUP_POLL_MS)
      );
    }
    return await this.processTreeGone(processHandle);
  }

  private reserveRestart() {
    const now = this.monotonicNow();
    this.pruneRestartWindow(now);
    if (this.restartTimestamps.length >= this.settings.maxRestarts) return null;
    this.restartTimestamps.push(now);
    this.restartCount += 1;
    const exponent = this.restartTimestamps.length - 1;
    return Math.min(
      this.settings.restartInitialDelayMs * 2 ** exponent,
      this.settings.restartMaxDelayMs
    );
  }

  private pruneRestartWindow(now: number) {
    if (!this.config) return;
    const earliest = now - this.settings.restartWindowMs;
    this.restartTimestamps = this.restartTimestamps.filter(
      (entry) => entry >= earliest
    );
  }

  private recordExit(exit: ProcessExit, intentional: boolean) {
    this.lastExit = {
      code: exit.code,
      signal: exit.signal,
      at: timestamp(this.wallNow()),
      intentional
    };
  }

  private recordManagedExit(
    processHandle: ManagedProcess,
    exit: ProcessExit,
    intentional: boolean
  ) {
    if (processHandle.exitRecorded) return;
    processHandle.exitRecorded = true;
    this.recordExit(exit, intentional);
  }

  private isFatalFailure(error: unknown) {
    return (
      error instanceof PeerDaemonSupervisorError &&
      [
        "configuration",
        "filesystem_security",
        "owner_mismatch",
        "identity_initialization",
        "protocol",
        "shutdown"
      ].includes(error.code)
    );
  }

  private failureSummary(error: unknown) {
    if (error instanceof PeerDaemonSupervisorError) {
      switch (error.code) {
        case "startup_timeout":
          return "forge-peer did not become healthy before its startup deadline.";
        case "protocol":
          return "forge-peer reported an incompatible protocol version.";
        case "filesystem_security":
          return "forge-peer filesystem security validation failed.";
        case "owner_mismatch":
          return "forge-peer rejected a change of Forge owner.";
        case "identity_initialization":
          return "forge-peer identity initialization failed.";
        case "shutdown":
          return "forge-peer process cleanup failed.";
        default:
          return "forge-peer could not be started or exited unexpectedly.";
      }
    }
    return "forge-peer failed unexpectedly.";
  }

  private appendDiagnostic(value: string) {
    const sanitized = sanitizeDiagnostic(value);
    if (sanitized.length === 0) return;
    const combined = Buffer.from(`${this.stderrTail}${sanitized}`, "utf8");
    const bounded =
      combined.length <= this.settings.diagnosticBytes
        ? combined
        : combined.subarray(combined.length - this.settings.diagnosticBytes);
    this.stderrTail = bounded.toString("utf8");
  }

  private waitUntilReady() {
    if (this.state === "ready") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.readyWaiters.add({ resolve, reject });
    });
  }

  private resolveReadyWaiters() {
    for (const waiter of this.readyWaiters) waiter.resolve();
    this.readyWaiters.clear();
  }

  private rejectReadyWaiters(error: unknown) {
    for (const waiter of this.readyWaiters) waiter.reject(error);
    this.readyWaiters.clear();
  }
}
