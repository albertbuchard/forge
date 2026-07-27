import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const HANDLER_SCHEMA_VERSION = 4;
const HANDLER_DIRECTORY = "macos-browser-owner";
const HANDLER_APP_NAME = "Forge Local Owner.app";
const RECEIPT_FILE = "handler-receipt.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RECEIPT_BYTES = 16 * 1024;
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export class MacosBrowserHandlerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "MacosBrowserHandlerError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new MacosBrowserHandlerError(code, message, { cause });
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("unsupported_platform", "Forge requires a Unix owner identity.");
  }
  return process.getuid();
}

function escapeAppleScriptString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildMacosBrowserHandlerAppleScript(
  ownerBrokerBinaryPath,
  statusPath = null
) {
  if (!path.isAbsolute(ownerBrokerBinaryPath)) {
    fail("configuration", "The Forge owner-broker path must be absolute.");
  }
  const escapedBrokerPath = escapeAppleScriptString(ownerBrokerBinaryPath);
  const lines = [
    ...(statusPath
      ? [
          `property forgeStatusPath : "${escapeAppleScriptString(statusPath)}"`,
          "on recordForgeStatus(statusValue)",
          '  do shell script "umask 077; /usr/bin/printf \'%s\\\\n\' " & quoted form of statusValue & " > " & quoted form of forgeStatusPath',
          "end recordForgeStatus",
          "",
          "on run",
          '  recordForgeStatus("launched")',
          "end run",
          ""
        ]
      : []),
    "on open location handlerUrl",
    ...(statusPath ? ['  recordForgeStatus("received")'] : []),
    `  set brokerPath to "${escapedBrokerPath}"`,
    "  try",
    '    do shell script quoted form of brokerPath & " approve-url --url " & quoted form of handlerUrl',
    ...(statusPath ? ['    recordForgeStatus("approved")'] : []),
    "  on error",
    ...(statusPath ? ['    recordForgeStatus("failed")'] : []),
    "  end try",
    "end open location",
    ""
  ];
  return lines.join("\n");
}

function defaultRunCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error
  };
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function ensurePrivateDirectory(directoryPath) {
  const absolute = path.resolve(directoryPath);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const metadata = await lstat(absolute);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid()
  ) {
    fail(
      "filesystem",
      "The Forge browser-handler directory is not owner-controlled."
    );
  }
  await chmod(absolute, 0o700);
  const resolved = await realpath(absolute);
  return resolved;
}

async function hardenGeneratedBundle(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink() || metadata.uid !== currentUid()) {
      fail(
        "filesystem",
        "Forge refused a generated browser handler containing an unsafe entry."
      );
    }
    if (metadata.isDirectory()) {
      await chmod(entryPath, 0o700);
      await hardenGeneratedBundle(entryPath);
    } else if (metadata.isFile()) {
      await chmod(
        entryPath,
        entryPath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)
          ? 0o700
          : 0o600
      );
    } else {
      fail(
        "filesystem",
        "Forge refused an unsupported browser-handler bundle entry."
      );
    }
  }
}

function exactReceiptKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const expected = [
    "schemaVersion",
    "handlerScheme",
    "bundleIdentifier",
    "appPath",
    "ownerBrokerBinaryPath",
    "ownerBrokerBinarySha256",
    "appletSha256",
    "infoPlistSha256",
    "installedAt"
  ].sort();
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

async function readValidReceipt(receiptPath, expected) {
  try {
    const metadata = await lstat(receiptPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.uid !== currentUid() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size <= 0 ||
      metadata.size > MAX_RECEIPT_BYTES
    ) {
      return null;
    }
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      !exactReceiptKeys(receipt) ||
      receipt.schemaVersion !== HANDLER_SCHEMA_VERSION ||
      receipt.handlerScheme !== "forge" ||
      receipt.bundleIdentifier !== "dev.forge.local-owner" ||
      receipt.appPath !== expected.appPath ||
      receipt.ownerBrokerBinaryPath !== expected.ownerBrokerBinaryPath ||
      receipt.ownerBrokerBinarySha256 !== expected.ownerBrokerBinarySha256 ||
      !SHA256_PATTERN.test(receipt.appletSha256) ||
      !SHA256_PATTERN.test(receipt.infoPlistSha256) ||
      !Number.isFinite(Date.parse(receipt.installedAt))
    ) {
      return null;
    }
    const appMetadata = await lstat(expected.appPath);
    if (
      appMetadata.isSymbolicLink() ||
      !appMetadata.isDirectory() ||
      appMetadata.uid !== currentUid() ||
      (appMetadata.mode & 0o077) !== 0
    ) {
      return null;
    }
    const appletPath = path.join(
      expected.appPath,
      "Contents",
      "MacOS",
      "applet"
    );
    const infoPlistPath = path.join(expected.appPath, "Contents", "Info.plist");
    if (
      (await hashFile(appletPath)) !== receipt.appletSha256 ||
      (await hashFile(infoPlistPath)) !== receipt.infoPlistSha256
    ) {
      return null;
    }
    return receipt;
  } catch {
    return null;
  }
}

async function runRequired(runCommand, command, args, description) {
  const result = await runCommand(command, args);
  if (!result?.ok) {
    fail(
      "handler_install",
      `Forge could not ${description}.`,
      result?.error ??
        new Error(
          typeof result?.stderr === "string"
            ? result.stderr.slice(0, 2_000)
            : "Command failed."
        )
    );
  }
  return result;
}

export async function ensureMacosBrowserHandler({
  nativeRoot,
  ownerBrokerBinaryPath,
  ownerBrokerBinarySha256,
  runCommand = defaultRunCommand,
  now = new Date()
}) {
  if (process.platform !== "darwin") {
    return {
      ok: true,
      enabled: false,
      handlerScheme: null,
      appPath: null
    };
  }
  if (
    !path.isAbsolute(ownerBrokerBinaryPath) ||
    !SHA256_PATTERN.test(ownerBrokerBinarySha256)
  ) {
    fail(
      "configuration",
      "Forge requires a verified owner broker before installing the browser handler."
    );
  }
  const brokerMetadata = await lstat(ownerBrokerBinaryPath).catch((error) => {
    fail(
      "filesystem",
      "The verified Forge owner broker is unavailable.",
      error
    );
  });
  if (
    brokerMetadata.isSymbolicLink() ||
    !brokerMetadata.isFile() ||
    brokerMetadata.uid !== currentUid() ||
    (await hashFile(ownerBrokerBinaryPath)) !== ownerBrokerBinarySha256
  ) {
    fail("filesystem", "Forge refused an altered or unsafe owner broker.");
  }
  const privateNativeRoot = await ensurePrivateDirectory(nativeRoot);
  const handlerRoot = await ensurePrivateDirectory(
    path.join(privateNativeRoot, HANDLER_DIRECTORY)
  );
  const statusRoot = await ensurePrivateDirectory(
    path.join(path.dirname(privateNativeRoot), "run")
  );
  const statusPath = path.join(statusRoot, "local-browser-handler.status");
  try {
    const statusMetadata = await lstat(statusPath);
    if (
      statusMetadata.isSymbolicLink() ||
      !statusMetadata.isFile() ||
      statusMetadata.uid !== currentUid()
    ) {
      fail(
        "filesystem",
        "Forge refused an unsafe browser-handler status file."
      );
    }
    await chmod(statusPath, 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const appPath = path.join(handlerRoot, HANDLER_APP_NAME);
  const receiptPath = path.join(handlerRoot, RECEIPT_FILE);
  const expected = {
    appPath,
    ownerBrokerBinaryPath,
    ownerBrokerBinarySha256
  };
  const current = await readValidReceipt(receiptPath, expected);
  if (current) {
    return {
      ok: true,
      enabled: true,
      handlerScheme: "forge",
      appPath,
      receiptPath,
      reused: true
    };
  }

  const buildRoot = await mkdtemp(path.join(handlerRoot, ".build-"));
  await chmod(buildRoot, 0o700);
  const sourcePath = path.join(buildRoot, "handler.applescript");
  const builtAppPath = path.join(buildRoot, HANDLER_APP_NAME);
  await writeFile(
    sourcePath,
    buildMacosBrowserHandlerAppleScript(ownerBrokerBinaryPath, statusPath),
    { encoding: "utf8", mode: 0o600 }
  );
  await runRequired(
    runCommand,
    "/usr/bin/osacompile",
    ["-o", builtAppPath, sourcePath],
    "compile its local browser handler"
  );
  const infoPlistPath = path.join(builtAppPath, "Contents", "Info.plist");
  const plistJsonPath = path.join(buildRoot, "Info.json");
  const plistJson = await runRequired(
    runCommand,
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", infoPlistPath],
    "inspect its local browser handler metadata"
  );
  let plist;
  try {
    plist = JSON.parse(plistJson.stdout);
  } catch (error) {
    fail(
      "handler_install",
      "Forge could not decode its local browser handler metadata.",
      error
    );
  }
  plist.CFBundleIdentifier = "dev.forge.local-owner";
  plist.CFBundleName = "Forge Local Owner";
  plist.CFBundleURLTypes = [
    {
      CFBundleTypeRole: "Viewer",
      CFBundleURLName: "Forge Local Owner Authentication",
      CFBundleURLSchemes: ["forge"]
    }
  ];
  await writeFile(plistJsonPath, `${JSON.stringify(plist)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await runRequired(
    runCommand,
    "/usr/bin/plutil",
    ["-convert", "xml1", "-o", infoPlistPath, plistJsonPath],
    "write its local browser handler metadata"
  );
  await hardenGeneratedBundle(builtAppPath);
  await runRequired(
    runCommand,
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", builtAppPath],
    "sign its local browser handler"
  );
  await hardenGeneratedBundle(builtAppPath);

  try {
    await lstat(appPath);
    await rename(
      appPath,
      path.join(
        handlerRoot,
        `Forge Local Owner.quarantine-${now.getTime()}-${randomUUID()}.app`
      )
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        "filesystem",
        "Forge could not quarantine an invalid browser handler.",
        error
      );
    }
  }
  await rename(builtAppPath, appPath);
  await chmod(appPath, 0o700);
  const appletPath = path.join(appPath, "Contents", "MacOS", "applet");
  const receipt = {
    schemaVersion: HANDLER_SCHEMA_VERSION,
    handlerScheme: "forge",
    bundleIdentifier: "dev.forge.local-owner",
    appPath,
    ownerBrokerBinaryPath,
    ownerBrokerBinarySha256,
    appletSha256: await hashFile(appletPath),
    infoPlistSha256: await hashFile(
      path.join(appPath, "Contents", "Info.plist")
    ),
    installedAt: now.toISOString()
  };
  const temporaryReceiptPath = `${receiptPath}.tmp-${randomUUID()}`;
  await writeFile(temporaryReceiptPath, `${JSON.stringify(receipt)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  try {
    await lstat(receiptPath);
    await rename(
      receiptPath,
      path.join(
        handlerRoot,
        `handler-receipt.quarantine-${now.getTime()}-${randomUUID()}.json`
      )
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        "filesystem",
        "Forge could not quarantine an invalid browser-handler receipt.",
        error
      );
    }
  }
  await rename(temporaryReceiptPath, receiptPath);
  await chmod(receiptPath, 0o600);
  await runRequired(
    runCommand,
    LSREGISTER,
    ["-f", appPath],
    "register its verified local browser handler"
  );
  await rm(buildRoot, { recursive: true, force: true });
  return {
    ok: true,
    enabled: true,
    handlerScheme: "forge",
    appPath,
    receiptPath,
    reused: false
  };
}
