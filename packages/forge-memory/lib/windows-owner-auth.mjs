import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const WINDOWS_OWNER_CREDENTIAL_SCHEMA_VERSION = 2;
export const WINDOWS_OWNER_PROOF_PROTOCOL = "forge-platform-owner-proof/1";

const WINDOWS_OWNER_PROTECTION = "dpapi-current-user";
const WINDOWS_OWNER_ENTROPY = "forge/windows-owner-auth/v2";
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_CREDENTIAL_BYTES = 16 * 1024;
const WINDOWS_OWNER_ACL_MUTATION_TIMEOUT_MS = 30_000;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const POWERSHELL_ARGUMENTS_ENV = "FORGE_WINDOWS_OWNER_POWERSHELL_ARGUMENTS_B64";

function assertWindows(platform = process.platform) {
  if (platform !== "win32") {
    throw new Error("Forge Windows owner authentication requires Windows.");
  }
}

function resolveWindowsPowerShell(systemRoot = process.env.SystemRoot) {
  const value = systemRoot?.trim();
  if (!value || !path.win32.isAbsolute(value)) {
    throw new Error(
      "Forge could not resolve the trusted Windows PowerShell executable."
    );
  }
  return path.win32.join(
    value,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

function runPowerShell({
  script,
  args = [],
  input = "",
  timeoutMs = 10_000,
  systemRoot,
  spawnSyncImpl = spawnSync
}) {
  const encodedArguments = Buffer.from(
    JSON.stringify({ values: args }),
    "utf8"
  ).toString("base64");
  const encodedCommand = Buffer.from(
    [
      "$forgeArgumentsJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:FORGE_WINDOWS_OWNER_POWERSHELL_ARGUMENTS_B64))",
      "$forgeArgumentEnvelope=ConvertFrom-Json -InputObject $forgeArgumentsJson",
      "$forgeArgs=[Object[]]$forgeArgumentEnvelope.values",
      script
    ].join("\n"),
    "utf16le"
  ).toString("base64");
  const result = spawnSyncImpl(
    resolveWindowsPowerShell(systemRoot),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedCommand
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        [POWERSHELL_ARGUMENTS_ENV]: encodedArguments
      },
      input,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Forge Windows owner authentication failed closed (PowerShell exit ${result.status ?? "unknown"}).`
    );
  }
  return result.stdout.trim();
}

export function windowsPathIsCurrentOwnerOnly(
  target,
  { systemRoot, spawnSyncImpl = spawnSync } = {}
) {
  try {
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
      "[Console]::Out.Write($sid)"
    ].join("\n");
    const sid = runPowerShell({
      script,
      args: [target],
      timeoutMs: 5_000,
      systemRoot,
      spawnSyncImpl
    });
    return /^S-\d(?:-\d+)+$/.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

export function windowsPathChainHasNoReparsePoints(
  expectedRoot,
  target,
  { systemRoot, spawnSyncImpl = spawnSync } = {}
) {
  try {
    const root = path.win32.resolve(expectedRoot);
    const resolvedTarget = path.win32.resolve(target);
    const relative = path.win32.relative(root, resolvedTarget);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.win32.sep}`) ||
      path.win32.isAbsolute(relative)
    ) {
      return false;
    }
    const candidates = [root];
    let candidate = root;
    for (const segment of relative.split(path.win32.sep).filter(Boolean)) {
      candidate = path.win32.join(candidate, segment);
      candidates.push(candidate);
    }
    if (candidate !== resolvedTarget) {
      return false;
    }
    const script = [
      "$ErrorActionPreference='Stop'",
      "if ($forgeArgs.Count -ne 1 -or [String]::IsNullOrWhiteSpace([String]$forgeArgs[0])) {",
      "  exit 22",
      "}",
      "$inputTarget=[String]$forgeArgs[0]",
      "$item=Get-Item -LiteralPath $inputTarget -Force",
      "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 21 }"
    ].join("\n");
    for (const inspectedCandidate of candidates) {
      runPowerShell({
        script,
        args: [inspectedCandidate],
        timeoutMs: 5_000,
        systemRoot,
        spawnSyncImpl
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function lockWindowsPathForCurrentOwner(
  target,
  { systemRoot, spawnSyncImpl = spawnSync } = {}
) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$target=[IO.Path]::GetFullPath($forgeArgs[0])",
    "$item=Get-Item -LiteralPath $target -Force",
    "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point refused' }",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "if ($item.PSIsContainer) {",
    "  $acl=New-Object Security.AccessControl.DirectorySecurity",
    "  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
    "} else {",
    "  $acl=New-Object Security.AccessControl.FileSecurity",
    "  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')",
    "}",
    "$acl.SetOwner($sid)",
    "$acl.SetAccessRuleProtection($true,$false)",
    "$acl.AddAccessRule($rule)",
    "if ($item.PSIsContainer) {",
    "  [IO.Directory]::SetAccessControl($target,$acl)",
    "} else {",
    "  [IO.File]::SetAccessControl($target,$acl)",
    "}"
  ].join("\n");
  runPowerShell({
    script,
    args: [target],
    timeoutMs: WINDOWS_OWNER_ACL_MUTATION_TIMEOUT_MS,
    systemRoot,
    spawnSyncImpl
  });
}

function protectForCurrentWindowsUser(
  key,
  { systemRoot, spawnSyncImpl = spawnSync } = {}
) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')",
    "$plain=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    `$entropy=[Text.Encoding]::UTF8.GetBytes('${WINDOWS_OWNER_ENTROPY}')`,
    "$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Array]::Clear($plain,0,$plain.Length)",
    "[Console]::Out.Write([Convert]::ToBase64String($protected))"
  ].join("\n");
  return runPowerShell({
    script,
    input: key.toString("base64"),
    systemRoot,
    spawnSyncImpl
  });
}

function unprotectForCurrentWindowsUser(
  protectedKey,
  { systemRoot, spawnSyncImpl = spawnSync } = {}
) {
  const script = [
    "$ErrorActionPreference='Stop'",
    "[void][Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')",
    "$protected=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    `$entropy=[Text.Encoding]::UTF8.GetBytes('${WINDOWS_OWNER_ENTROPY}')`,
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($plain))",
    "[Array]::Clear($plain,0,$plain.Length)"
  ].join("\n");
  const encoded = runPowerShell({
    script,
    input: protectedKey,
    systemRoot,
    spawnSyncImpl
  });
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    key.fill(0);
    throw new Error("Forge rejected malformed Windows owner key material.");
  }
  return key;
}

function credentialBody({ protectedKey, createdAt, ownerSid }) {
  return `${JSON.stringify({
    schemaVersion: WINDOWS_OWNER_CREDENTIAL_SCHEMA_VERSION,
    protection: WINDOWS_OWNER_PROTECTION,
    protectedKey,
    protectedKeySha256: createHash("sha256")
      .update(protectedKey, "utf8")
      .digest("hex"),
    ownerSid,
    createdAt
  })}\n`;
}

function parseCredential(body) {
  if (
    typeof body !== "string" ||
    Buffer.byteLength(body, "utf8") > MAXIMUM_CREDENTIAL_BYTES
  ) {
    return null;
  }
  try {
    const value = JSON.parse(body);
    if (
      value?.schemaVersion !== WINDOWS_OWNER_CREDENTIAL_SCHEMA_VERSION ||
      value.protection !== WINDOWS_OWNER_PROTECTION ||
      typeof value.protectedKey !== "string" ||
      value.protectedKey.length < 40 ||
      value.protectedKey.length > 8_192 ||
      !BASE64_PATTERN.test(value.protectedKey) ||
      typeof value.protectedKeySha256 !== "string" ||
      !SHA256_PATTERN.test(value.protectedKeySha256) ||
      createHash("sha256").update(value.protectedKey, "utf8").digest("hex") !==
        value.protectedKeySha256 ||
      typeof value.ownerSid !== "string" ||
      !/^S-\d(?:-\d+)+$/.test(value.ownerSid) ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function credentialMetadata(credentialPath, parsed, ownerSid, created) {
  return {
    credentialPath,
    schemaVersion: parsed.schemaVersion,
    protection: parsed.protection,
    protectedKeySha256: parsed.protectedKeySha256,
    ownerSid,
    createdAt: parsed.createdAt,
    created
  };
}

export function inspectWindowsOwnerCredential(
  credentialPath,
  {
    expectedRoot = path.dirname(path.dirname(credentialPath)),
    platform = process.platform,
    systemRoot,
    spawnSyncImpl = spawnSync
  } = {}
) {
  try {
    assertWindows(platform);
    if (
      !path.win32.isAbsolute(credentialPath) ||
      !path.win32.isAbsolute(expectedRoot) ||
      !windowsPathChainHasNoReparsePoints(expectedRoot, credentialPath, {
        systemRoot,
        spawnSyncImpl
      })
    ) {
      return null;
    }
    const metadata = fs.lstatSync(credentialPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size <= 0 ||
      metadata.size > MAXIMUM_CREDENTIAL_BYTES
    ) {
      return null;
    }
    const ownerSid = windowsPathIsCurrentOwnerOnly(credentialPath, {
      systemRoot,
      spawnSyncImpl
    });
    if (!ownerSid) return null;
    const parsed = parseCredential(fs.readFileSync(credentialPath, "utf8"));
    if (!parsed || parsed.ownerSid !== ownerSid) return null;
    const key = unprotectForCurrentWindowsUser(parsed.protectedKey, {
      systemRoot,
      spawnSyncImpl
    });
    key.fill(0);
    return credentialMetadata(credentialPath, parsed, ownerSid, false);
  } catch {
    return null;
  }
}

export async function ensureWindowsOwnerCredential({
  credentialPath,
  expectedRoot = path.dirname(path.dirname(credentialPath)),
  platform = process.platform,
  systemRoot,
  spawnSyncImpl = spawnSync,
  randomSource = randomBytes,
  now = () => new Date()
}) {
  assertWindows(platform);
  if (
    !path.win32.isAbsolute(credentialPath) ||
    !path.win32.isAbsolute(expectedRoot)
  ) {
    throw new Error(
      "Forge requires absolute Windows owner credential and root paths."
    );
  }
  const relativeCredential = path.win32.relative(expectedRoot, credentialPath);
  if (
    relativeCredential === ".." ||
    relativeCredential.startsWith(`..${path.win32.sep}`) ||
    path.win32.isAbsolute(relativeCredential)
  ) {
    throw new Error(
      "Forge refused a Windows owner credential path outside its expected root."
    );
  }
  const nativeDirectory = path.dirname(credentialPath);
  const existing = inspectWindowsOwnerCredential(credentialPath, {
    expectedRoot,
    platform,
    systemRoot,
    spawnSyncImpl
  });
  if (existing) return existing;

  await fsp.mkdir(nativeDirectory, { recursive: true });
  if (
    !windowsPathChainHasNoReparsePoints(expectedRoot, nativeDirectory, {
      systemRoot,
      spawnSyncImpl
    })
  ) {
    throw new Error(
      "Forge refused a reparse point in the Windows owner credential path."
    );
  }
  lockWindowsPathForCurrentOwner(nativeDirectory, {
    systemRoot,
    spawnSyncImpl
  });
  const ownerSid = windowsPathIsCurrentOwnerOnly(nativeDirectory, {
    systemRoot,
    spawnSyncImpl
  });
  if (!ownerSid) {
    throw new Error(
      "Forge refused an unsafe Windows owner credential directory."
    );
  }
  if (
    !windowsPathChainHasNoReparsePoints(expectedRoot, nativeDirectory, {
      systemRoot,
      spawnSyncImpl
    })
  ) {
    throw new Error("Forge refused a changed Windows owner credential path.");
  }
  if (fs.existsSync(credentialPath)) {
    throw new Error(
      "Forge found invalid Windows owner authentication material and refused to overwrite it."
    );
  }

  const key = randomSource(32);
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    throw new Error("Forge could not generate a 256-bit Windows owner key.");
  }
  let body = null;
  let createdCredential = false;
  let verified = null;
  try {
    const protectedKey = protectForCurrentWindowsUser(key, {
      systemRoot,
      spawnSyncImpl
    });
    body = credentialBody({
      protectedKey,
      createdAt: now().toISOString(),
      ownerSid
    });
    await fsp.writeFile(credentialPath, body, {
      encoding: "utf8",
      flag: "wx"
    });
    createdCredential = true;
    lockWindowsPathForCurrentOwner(credentialPath, {
      systemRoot,
      spawnSyncImpl
    });
    verified = inspectWindowsOwnerCredential(credentialPath, {
      expectedRoot,
      platform,
      systemRoot,
      spawnSyncImpl
    });
    if (!verified) {
      throw new Error(
        "Forge could not verify the protected Windows owner credential after installation."
      );
    }
  } catch (error) {
    if (createdCredential && body !== null) {
      try {
        const metadata = await fsp.lstat(credentialPath);
        const currentBody =
          metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          metadata.nlink === 1
            ? await fsp.readFile(credentialPath, "utf8")
            : null;
        if (currentBody === body) {
          await fsp.unlink(credentialPath);
        }
      } catch {
        // Leave an unexpected replacement in place and fail closed.
      }
    }
    throw error;
  } finally {
    key.fill(0);
  }
  return { ...verified, created: true };
}

function exactLoopbackOrigin(value) {
  const origin = new URL(value);
  if (
    origin.protocol !== "http:" ||
    !LOCAL_HOSTNAMES.has(origin.hostname.toLowerCase()) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.origin !== value
  ) {
    throw new Error(
      "Forge Windows owner authentication requires an exact loopback origin."
    );
  }
  return origin.origin;
}

function validatedProofChallenge(input) {
  if (
    input?.protocol !== WINDOWS_OWNER_PROOF_PROTOCOL ||
    typeof input.serverNonce !== "string" ||
    !BASE64URL_256_PATTERN.test(input.serverNonce)
  ) {
    throw new Error("Forge Windows owner proof challenge is malformed.");
  }
  const request = input.request;
  for (const [name, minimum, maximum] of [
    ["requestId", 16, 128],
    ["transactionId", 16, 160],
    ["installId", 1, 128]
  ]) {
    const value = request?.[name];
    if (
      typeof value !== "string" ||
      value.length < minimum ||
      value.length > maximum ||
      !IDENTIFIER_PATTERN.test(value)
    ) {
      throw new Error(`Forge Windows owner ${name} is malformed.`);
    }
  }
  if (
    request.protocol !== "forge-owner-broker/1" ||
    typeof request.browserNonce !== "string" ||
    !BASE64URL_256_PATTERN.test(request.browserNonce)
  ) {
    throw new Error("Forge Windows owner request binding is malformed.");
  }
  return {
    protocol: WINDOWS_OWNER_PROOF_PROTOCOL,
    serverNonce: input.serverNonce,
    request: {
      protocol: request.protocol,
      requestId: request.requestId,
      transactionId: request.transactionId,
      installId: request.installId,
      browserOrigin: exactLoopbackOrigin(request.browserOrigin),
      browserNonce: request.browserNonce
    }
  };
}

export function windowsOwnerProofPayload(input) {
  return JSON.stringify(validatedProofChallenge(input));
}

export function createWindowsOwnerProof(key, input) {
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    throw new Error("Forge Windows owner proof requires a 256-bit key.");
  }
  return createHmac("sha256", key)
    .update(windowsOwnerProofPayload(input))
    .digest("hex");
}

export function verifyWindowsOwnerProof(key, input, proof) {
  if (typeof proof !== "string" || !SHA256_PATTERN.test(proof)) {
    return false;
  }
  const expected = Buffer.from(createWindowsOwnerProof(key, input), "hex");
  const received = Buffer.from(proof, "hex");
  return (
    received.byteLength === expected.byteLength &&
    timingSafeEqual(received, expected)
  );
}

export function createWindowsOwnerProofFromCredential({
  credentialPath,
  expectedRoot = path.dirname(path.dirname(credentialPath)),
  challenge,
  platform = process.platform,
  systemRoot,
  spawnSyncImpl = spawnSync
}) {
  assertWindows(platform);
  const inspection = inspectWindowsOwnerCredential(credentialPath, {
    expectedRoot,
    platform,
    systemRoot,
    spawnSyncImpl
  });
  if (!inspection) {
    throw new Error(
      "Forge refused missing or unsafe Windows owner authentication material."
    );
  }
  const parsed = parseCredential(fs.readFileSync(credentialPath, "utf8"));
  if (!parsed) {
    throw new Error(
      "Forge rejected malformed Windows owner authentication material."
    );
  }
  const key = unprotectForCurrentWindowsUser(parsed.protectedKey, {
    systemRoot,
    spawnSyncImpl
  });
  try {
    return createWindowsOwnerProof(key, challenge);
  } finally {
    key.fill(0);
  }
}
