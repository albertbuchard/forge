import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  lockWindowsPathForCurrentOwner,
  windowsPathChainHasNoReparsePoints,
  windowsPathIsCurrentOwnerOnly
} from "./windows-owner-auth.mjs";

const PAIRING_SESSION_ID_PATTERN = /^pair_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function clearAndVerifyMacosAcl(target) {
  const chmodResult = spawnSync("/bin/chmod", ["-N", target], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    timeout: 5_000
  });
  if (chmodResult.error || chmodResult.status !== 0) {
    throw new Error(
      "Forge could not remove inherited macOS access controls from its pairing payload."
    );
  }
  const inspectResult = spawnSync("/bin/ls", ["-lde", target], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    timeout: 5_000
  });
  if (
    inspectResult.error ||
    inspectResult.status !== 0 ||
    inspectResult.stdout
      .split(/\r?\n/)
      .slice(1)
      .some((line) => /^\s*\d+:\s/.test(line))
  ) {
    throw new Error(
      "Forge could not verify removal of macOS access controls from its pairing payload."
    );
  }
}

function pairingFileName(sessionId) {
  if (
    typeof sessionId !== "string" ||
    !PAIRING_SESSION_ID_PATTERN.test(sessionId)
  ) {
    throw new Error(
      "Forge refused a Companion pairing response with an unsafe session identifier."
    );
  }
  return `forge-companion-${sessionId}.json`;
}

async function assertPosixOwnerDirectory(target, currentUid, platform) {
  if (!Number.isInteger(currentUid)) {
    throw new Error(
      "Forge could not verify the local owner of its pairing directory."
    );
  }
  const before = await fsp.lstat(target);
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== currentUid
  ) {
    throw new Error(
      "Forge refused an unsafe Companion pairing payload directory."
    );
  }
  if (platform === "darwin") {
    clearAndVerifyMacosAcl(target);
  }
  await fsp.chmod(target, 0o700);
  const after = await fsp.lstat(target);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.uid !== currentUid ||
    (after.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Forge could not preserve an owner-only Companion pairing payload directory."
    );
  }
}

async function assertPosixOwnerFile(target, currentUid, platform) {
  if (!Number.isInteger(currentUid)) {
    throw new Error(
      "Forge could not verify the local owner of its pairing payload."
    );
  }
  if (platform === "darwin") {
    clearAndVerifyMacosAcl(target);
  }
  await fsp.chmod(target, 0o600);
  const metadata = await fsp.lstat(target);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.uid !== currentUid ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Forge could not preserve an owner-only Companion pairing payload."
    );
  }
}

function assertWindowsOwnerDirectory(forgeRoot, target) {
  lockWindowsPathForCurrentOwner(target, { expectedRoot: forgeRoot });
  if (
    !windowsPathChainHasNoReparsePoints(forgeRoot, target) ||
    !windowsPathIsCurrentOwnerOnly(target)
  ) {
    throw new Error(
      "Forge could not preserve an owner-only Companion pairing payload directory."
    );
  }
}

function assertWindowsOwnerFile(forgeRoot, target) {
  lockWindowsPathForCurrentOwner(target, { expectedRoot: forgeRoot });
  if (
    !windowsPathChainHasNoReparsePoints(forgeRoot, target) ||
    !windowsPathIsCurrentOwnerOnly(target)
  ) {
    throw new Error(
      "Forge could not preserve an owner-only Companion pairing payload."
    );
  }
}

async function prepareOwnerDirectory(forgeRoot, target, platform, currentUid) {
  try {
    await fsp.mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (platform === "win32") {
    assertWindowsOwnerDirectory(forgeRoot, target);
    return;
  }
  await assertPosixOwnerDirectory(target, currentUid, platform);
}

async function preparePairingDirectories(forgeRoot, platform, currentUid) {
  if (!path.isAbsolute(forgeRoot)) {
    throw new Error("Forge requires an absolute pairing payload root.");
  }
  await prepareOwnerDirectory(forgeRoot, forgeRoot, platform, currentUid);
  const pairingDir = path.join(forgeRoot, "pairing");
  await prepareOwnerDirectory(forgeRoot, pairingDir, platform, currentUid);
  return pairingDir;
}

async function protectPayloadFile(forgeRoot, target, platform, currentUid) {
  if (platform === "win32") {
    assertWindowsOwnerFile(forgeRoot, target);
    return;
  }
  await assertPosixOwnerFile(target, currentUid, platform);
}

async function cleanupCreatedPath(target, failures) {
  if (!target) return;
  try {
    await fsp.unlink(target);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      failures.push(
        error instanceof Error ? error.message : "unknown cleanup error"
      );
    }
  }
}

export async function writeCompanionPairingPayloadFile({
  forgeRoot,
  payload,
  platform = process.platform,
  currentUid = process.getuid?.()
}) {
  if (typeof forgeRoot !== "string" || !path.isAbsolute(forgeRoot)) {
    throw new Error("Forge requires an absolute pairing payload root.");
  }
  const resolvedForgeRoot = path.resolve(forgeRoot);
  const fileName = pairingFileName(payload?.sessionId);
  const pairingDir = await preparePairingDirectories(
    resolvedForgeRoot,
    platform,
    currentUid
  );
  const filePath = path.join(pairingDir, fileName);
  if (path.dirname(path.resolve(filePath)) !== path.resolve(pairingDir)) {
    throw new Error(
      "Forge refused a Companion pairing payload path outside its protected directory."
    );
  }

  let handle;
  let temporaryPath = path.join(
    pairingDir,
    `.forge-companion-${randomBytes(16).toString("hex")}.tmp`
  );
  let published = false;
  try {
    handle = await fsp.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    await protectPayloadFile(
      resolvedForgeRoot,
      temporaryPath,
      platform,
      currentUid
    );
    await fsp.link(temporaryPath, filePath);
    published = true;
    await fsp.unlink(temporaryPath);
    temporaryPath = null;
    await protectPayloadFile(resolvedForgeRoot, filePath, platform, currentUid);
    return filePath;
  } catch (error) {
    const cleanupFailures = [];
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        cleanupFailures.push(
          closeError instanceof Error
            ? closeError.message
            : "unknown close error"
        );
      }
    }
    if (published) {
      await cleanupCreatedPath(filePath, cleanupFailures);
    }
    await cleanupCreatedPath(temporaryPath, cleanupFailures);
    const reason = error instanceof Error ? error.message : String(error);
    const cleanup =
      cleanupFailures.length > 0
        ? ` Cleanup also failed: ${cleanupFailures.join("; ")}.`
        : "";
    throw new Error(
      `Forge could not save the owner-only Companion pairing payload: ${reason}.${cleanup}`,
      { cause: error }
    );
  }
}
