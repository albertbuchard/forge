import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const OWNER_BROKER_PROTOCOL = "forge-owner-broker/1";
const WINDOWS_POWERSHELL_ARGUMENTS_ENV =
  "FORGE_WINDOWS_OWNER_CLIENT_POWERSHELL_ARGUMENTS_B64";

type BrokerRequest = {
  protocol: typeof OWNER_BROKER_PROTOCOL;
  requestId: string;
  transactionId: string;
  installId: string;
  browserOrigin: string;
  browserNonce: string;
};

type BeginResponse = {
  transactionId: string;
  installationId: string;
  expiresAt: string;
  broker: {
    socketPath: string;
    request: BrokerRequest;
  } | null;
  platform: {
    protocol: "forge-platform-owner-proof/1";
    serverNonce: string;
    request: BrokerRequest;
  } | null;
};

export type LocalOwnerSession = {
  cookie: string;
  csrfToken: string;
  actorLabel: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exactLoopbackOrigin(baseUrl: string) {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTNAMES.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Forge local-owner authentication requires a direct loopback HTTP URL."
    );
  }
  return url.origin;
}

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ownerOnlyRegularFile(filePath: string) {
  const metadata = lstatSync(filePath);
  const currentUid = process.getuid?.();
  return (
    !metadata.isSymbolicLink() &&
    metadata.isFile() &&
    metadata.nlink === 1 &&
    (currentUid === undefined ||
      (metadata.uid === currentUid && (metadata.mode & 0o077) === 0)) &&
    (process.platform !== "win32" || windowsPathIsCurrentOwnerOnly(filePath))
  );
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
    "$target=[IO.Path]::GetFullPath($forgeArgs[0])",
    "$item=Get-Item -LiteralPath $target -Force",
    "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 10 }",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "if ($item.PSIsContainer) {",
    "  $acl=[IO.Directory]::GetAccessControl($target)",
    "} else {",
    "  $acl=[IO.File]::GetAccessControl($target)",
    "}",
    "$owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value",
    "if ($owner -ne $sid -or -not $acl.AreAccessRulesProtected) { exit 11 }",
    "$rules=@($acl.Access)",
    "if ($rules.Count -lt 1) { exit 12 }",
    "$bad=$rules | Where-Object {",
    "  $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or",
    "  $_.IsInherited -or",
    "  $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid",
    "}",
    "if ($null -ne $bad) { exit 13 }",
    "$full=[Security.AccessControl.FileSystemRights]::FullControl",
    "$ownerFull=$rules | Where-Object { ($_.FileSystemRights -band $full) -eq $full }",
    "if ($null -eq $ownerFull) { exit 14 }",
    "exit 0"
  ].join("\n");
  const encodedArguments = Buffer.from(
    JSON.stringify({ values: [target] }),
    "utf8"
  ).toString("base64");
  const encodedCommand = Buffer.from(
    [
      `$forgeArgumentsJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${WINDOWS_POWERSHELL_ARGUMENTS_ENV}))`,
      "$forgeArgumentEnvelope=ConvertFrom-Json -InputObject $forgeArgumentsJson",
      "$forgeArgs=[Object[]]$forgeArgumentEnvelope.values",
      script
    ].join("\n"),
    "utf16le"
  ).toString("base64");
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedCommand
    ],
    {
      env: {
        ...process.env,
        [WINDOWS_POWERSHELL_ARGUMENTS_ENV]: encodedArguments
      },
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000
    }
  );
  return result.status === 0;
}

export function resolvePlatformOwnerKey(
  descriptorPath = path.join(
    homedir(),
    ".forge",
    "native",
    "windows-owner.json"
  )
) {
  try {
    let keyPath = process.env.FORGE_PLATFORM_OWNER_KEY_PATH?.trim();
    let keySha256 =
      process.env.FORGE_PLATFORM_OWNER_KEY_SHA256?.trim().toLowerCase();
    if (!keyPath || !keySha256) {
      if (!ownerOnlyRegularFile(descriptorPath)) return null;
      const descriptor = JSON.parse(
        readFileSync(descriptorPath, "utf8")
      ) as {
        schemaVersion?: unknown;
        keyPath?: unknown;
        keySha256?: unknown;
      };
      if (
        descriptor.schemaVersion !== 1 ||
        typeof descriptor.keyPath !== "string" ||
        !path.isAbsolute(descriptor.keyPath) ||
        typeof descriptor.keySha256 !== "string"
      ) {
        return null;
      }
      keyPath = descriptor.keyPath;
      keySha256 = descriptor.keySha256.toLowerCase();
    }
    if (
      !path.isAbsolute(keyPath) ||
      !/^[0-9a-f]{64}$/.test(keySha256) ||
      !ownerOnlyRegularFile(keyPath)
    ) {
      return null;
    }
    const body = readFileSync(keyPath);
    if (
      body.byteLength < 43 ||
      body.byteLength > 128 ||
      createHash("sha256").update(body).digest("hex") !== keySha256
    ) {
      return null;
    }
    const encoded = body.toString("utf8").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
    const key = Buffer.from(encoded, "base64url");
    return key.byteLength === 32 ? key : null;
  } catch {
    return null;
  }
}

export function resolveDescriptorOwnerBroker(
  descriptorPath = path.join(
    homedir(),
    ".forge",
    "native",
    "owner-broker.json"
  )
) {
  try {
    const metadata = lstatSync(descriptorPath);
    const currentUid = process.getuid?.();
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      (currentUid !== undefined && metadata.uid !== currentUid)
    ) {
      return null;
    }
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
      schemaVersion?: unknown;
      binaryPath?: unknown;
      binarySha256?: unknown;
      receiptPath?: unknown;
    };
    if (
      descriptor.schemaVersion !== 1 ||
      typeof descriptor.binaryPath !== "string" ||
      !path.isAbsolute(descriptor.binaryPath) ||
      typeof descriptor.binarySha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(descriptor.binarySha256) ||
      typeof descriptor.receiptPath !== "string" ||
      !path.isAbsolute(descriptor.receiptPath)
    ) {
      return null;
    }
    const receiptMetadata = lstatSync(descriptor.receiptPath);
    if (
      receiptMetadata.isSymbolicLink() ||
      !receiptMetadata.isFile() ||
      receiptMetadata.nlink !== 1 ||
      (receiptMetadata.mode & 0o077) !== 0 ||
      (currentUid !== undefined && receiptMetadata.uid !== currentUid)
    ) {
      return null;
    }
    const receipt = JSON.parse(
      readFileSync(descriptor.receiptPath, "utf8")
    ) as { ownerBrokerBinarySha256?: unknown };
    if (
      receipt.ownerBrokerBinarySha256 !== descriptor.binarySha256 ||
      sha256File(descriptor.binaryPath) !== descriptor.binarySha256
    ) {
      return null;
    }
    return descriptor.binaryPath;
  } catch {
    return null;
  }
}

function ownerBrokerBinaryCandidates() {
  const executableName =
    process.platform === "win32"
      ? "forge-owner-broker.exe"
      : "forge-owner-broker";
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    process.cwd(),
    path.resolve(moduleDirectory, "../../../.."),
    path.resolve(moduleDirectory, "../../../../.."),
    path.resolve(moduleDirectory, "../../../../../..")
  ];
  const configured = process.env.FORGE_OWNER_BROKER_BIN?.trim();
  if (configured) {
    const expectedHash =
      process.env.FORGE_OWNER_BROKER_SHA256?.trim().toLowerCase();
    if (
      expectedHash &&
      /^[0-9a-f]{64}$/.test(expectedHash) &&
      existsSync(configured) &&
      sha256File(configured) === expectedHash
    ) {
      return [configured];
    }
    return [];
  }
  const descriptorBinary = resolveDescriptorOwnerBroker();
  if (descriptorBinary) return [descriptorBinary];
  const explicitDevelopmentCheckout = roots.find(
    (root) =>
      existsSync(path.join(root, ".git")) &&
      existsSync(path.join(root, "packages", "forge-peer", "Cargo.toml"))
  );
  if (!explicitDevelopmentCheckout) {
    return [];
  }
  return [
      path.join(
        explicitDevelopmentCheckout,
        "packages",
        "forge-peer",
        "target",
        "release",
        executableName
      ),
      path.join(
        explicitDevelopmentCheckout,
        "packages",
        "forge-peer",
        "target",
        "debug",
        executableName
      )
  ];
}

export function resolveLocalOwnerBrokerBinary() {
  for (const candidate of ownerBrokerBinaryCandidates()) {
    if (!path.isAbsolute(candidate) || !existsSync(candidate)) continue;
    const metadata = lstatSync(candidate);
    const currentUid = process.getuid?.();
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o111) === 0 ||
      (metadata.mode & 0o022) !== 0 ||
      (currentUid !== undefined &&
        metadata.uid !== currentUid &&
        metadata.uid !== 0)
    ) {
      continue;
    }
    return candidate;
  }
  return null;
}

export function resolveLocalOwnerBrokerDescriptor() {
  const binaryPath = resolveLocalOwnerBrokerBinary();
  return binaryPath
    ? { binaryPath, binarySha256: sha256File(binaryPath) }
    : null;
}

function validateBrokerSocket(socketPath: string, dataRoot: string) {
  if (!dataRoot.trim()) {
    throw new Error(
      "Forge local-owner authentication requires the configured data root."
    );
  }
  const temporaryRoot = realpathSync(
    process.platform === "win32" ? tmpdir() : "/tmp"
  );
  const owner = process.getuid?.() ?? "user";
  const allowedParents = [
    path.resolve(dataRoot),
    path.resolve(dataRoot, "data")
  ].map((candidate) =>
    path.join(
      temporaryRoot,
      `fg-${owner}-${createHash("sha256")
        .update(candidate)
        .digest("hex")
        .slice(0, 12)}`
    )
  );
  const parent = path.dirname(socketPath);
  const resolvedParent = realpathSync(parent);
  if (
    resolvedParent !== parent ||
    !allowedParents.includes(resolvedParent) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(path.basename(socketPath))
  ) {
    throw new Error(
      "Forge returned a local-owner socket outside the configured private owner channel."
    );
  }
  const currentUid = process.getuid?.();
  const parentMetadata = lstatSync(parent);
  const socketMetadata = lstatSync(socketPath);
  if (
    parentMetadata.isSymbolicLink() ||
    !parentMetadata.isDirectory() ||
    (parentMetadata.mode & 0o077) !== 0 ||
    socketMetadata.isSymbolicLink() ||
    !socketMetadata.isSocket() ||
    (socketMetadata.mode & 0o777) !== 0o600 ||
    (currentUid !== undefined &&
      (parentMetadata.uid !== currentUid ||
        socketMetadata.uid !== currentUid))
  ) {
    throw new Error(
      "Forge refused an unsafe local-owner socket endpoint."
    );
  }
}

function parseBeginResponse(
  payload: unknown,
  expected: {
    browserOrigin: string;
    browserNonce: string;
  }
): BeginResponse {
  if (
    !isRecord(payload) ||
    typeof payload.transactionId !== "string" ||
    typeof payload.installationId !== "string" ||
    typeof payload.expiresAt !== "string" ||
    !("broker" in payload) ||
    !("platform" in payload) ||
    (payload.broker !== null && !isRecord(payload.broker)) ||
    (payload.platform !== null && !isRecord(payload.platform)) ||
    (payload.broker === null) === (payload.platform === null)
  ) {
    throw new Error("Forge returned a malformed local-owner challenge.");
  }
  const broker = payload.broker;
  const platform = payload.platform;
  if (
    broker !== null &&
    (typeof broker.socketPath !== "string" ||
      !path.isAbsolute(broker.socketPath) ||
      !isRecord(broker.request))
  ) {
    throw new Error("Forge returned a malformed local-owner broker challenge.");
  }
  if (
    platform !== null &&
    (platform.protocol !== "forge-platform-owner-proof/1" ||
      typeof platform.serverNonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(platform.serverNonce) ||
      !isRecord(platform.request))
  ) {
    throw new Error(
      "Forge returned a malformed platform-owner challenge."
    );
  }
  const request = (broker?.request ??
    platform?.request) as Record<string, unknown> | undefined;
  if (
    !request ||
    request.protocol !== OWNER_BROKER_PROTOCOL ||
    typeof request.requestId !== "string" ||
    request.transactionId !== payload.transactionId ||
    request.installId !== payload.installationId ||
    request.browserOrigin !== expected.browserOrigin ||
    request.browserNonce !== expected.browserNonce
  ) {
    throw new Error("Forge returned an incorrectly bound local-owner challenge.");
  }
  return payload as BeginResponse;
}

async function runOwnerApproval(
  binaryPath: string,
  socketPath: string,
  request: BrokerRequest,
  timeoutMs: number
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, ["approve", "--socket", socketPath], {
      stdio: ["pipe", "ignore", "pipe"],
      env: {}
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Forge local-owner approval timed out."));
    }, timeoutMs);
    timeout.unref();
    child.stderr.resume();
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `Forge local-owner helper failed (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}).`
        )
      );
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function cookiePair(response: Response) {
  const header =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()[0]
      : response.headers.get("set-cookie");
  return header?.split(";")[0]?.trim() || null;
}

function readSessionPayload(payload: unknown) {
  if (
    !isRecord(payload) ||
    typeof payload.csrfToken !== "string" ||
    payload.csrfToken.length < 32
  ) {
    throw new Error("Forge returned an invalid local-owner session.");
  }
  const actorLabel =
    isRecord(payload.session) &&
    typeof payload.session.actorLabel === "string" &&
    payload.session.actorLabel.trim()
      ? payload.session.actorLabel.trim()
      : null;
  return { csrfToken: payload.csrfToken, actorLabel };
}

export async function createLocalOwnerSession(
  baseUrl: string,
  timeoutMs: number,
  dataRoot: string
): Promise<LocalOwnerSession> {
  const browserOrigin = exactLoopbackOrigin(baseUrl);
  const browserNonce = randomBytes(32).toString("base64url");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    const beginResponse = await fetch(
      new URL("/api/v1/auth/local/begin", browserOrigin),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ browserOrigin, browserNonce }),
        signal: controller.signal
      }
    );
    if (!beginResponse.ok) {
      const failure = (await beginResponse.json().catch(() => null)) as
        | { code?: unknown; error?: { code?: unknown } }
        | null;
      const code =
        typeof failure?.error?.code === "string"
          ? failure.error.code
          : typeof failure?.code === "string"
            ? failure.code
            : null;
      throw new Error(
        `Forge refused local-owner authentication with HTTP ${beginResponse.status}${code ? ` (${code})` : ""}.`
      );
    }
    const begin = parseBeginResponse(await beginResponse.json(), {
      browserOrigin,
      browserNonce
    });
    let ownerProof: string | undefined;
    if (begin.broker) {
      const brokerBinary = resolveLocalOwnerBrokerBinary();
      if (!brokerBinary) {
        throw new Error(
          "Forge could not find its verified local-owner helper. Run `npx forge-memory install` to prepare it."
        );
      }
      validateBrokerSocket(begin.broker.socketPath, dataRoot);
      await runOwnerApproval(
        brokerBinary,
        begin.broker.socketPath,
        begin.broker.request,
        timeoutMs
      );
    } else if (begin.platform) {
      const platformOwnerKey = resolvePlatformOwnerKey();
      if (!platformOwnerKey) {
        throw new Error(
          "Forge could not verify its protected Windows owner key. Run `npx forge-memory doctor --repair`."
        );
      }
      ownerProof = createHmac("sha256", platformOwnerKey)
        .update(
          JSON.stringify({
            protocol: begin.platform.protocol,
            serverNonce: begin.platform.serverNonce,
            request: begin.platform.request
          })
        )
        .digest("hex");
    }
    const exchangeResponse = await fetch(
      new URL("/api/v1/auth/local/exchange", browserOrigin),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          transactionId: begin.transactionId,
          browserOrigin,
          browserNonce,
          ...(ownerProof ? { ownerProof } : {})
        }),
        signal: controller.signal
      }
    );
    if (!exchangeResponse.ok) {
      const failure = (await exchangeResponse.json().catch(() => null)) as
        | { code?: unknown; error?: { code?: unknown } }
        | null;
      const code =
        typeof failure?.error?.code === "string"
          ? failure.error.code
          : typeof failure?.code === "string"
            ? failure.code
            : null;
      throw new Error(
        `Forge refused the verified local-owner exchange with HTTP ${exchangeResponse.status}${code ? ` (${code})` : ""}.`
      );
    }
    const cookie = cookiePair(exchangeResponse);
    if (!cookie) {
      throw new Error("Forge did not return a local-owner session cookie.");
    }
    const session = readSessionPayload(await exchangeResponse.json());
    return { cookie, ...session };
  } finally {
    clearTimeout(timeout);
  }
}
