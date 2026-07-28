import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

const runLockSchema = "forge-web-build-run-lock/1";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function assertOwnerOnlyRunLock(lockPath) {
  const metadata = lstatSync(lockPath);
  const insecureUnixMetadata =
    process.platform !== "win32" &&
    ((typeof process.getuid === "function" &&
      metadata.uid !== process.getuid()) ||
      (metadata.mode & 0o077) !== 0);
  if (!metadata.isFile() || metadata.isSymbolicLink() || insecureUnixMetadata) {
    throw new Error("Forge web-build lock must be an owner-only regular file.");
  }
}

export async function acquireForgeWebBuildLock({
  repositoryRoot,
  lockRoot = os.tmpdir(),
  waitMilliseconds = 15 * 60 * 1_000,
  pollMilliseconds = 250,
  onWait
}) {
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const lockKey = createHash("sha256")
    .update(canonicalRepositoryRoot)
    .digest("hex")
    .slice(0, 24);
  const lockPath = path.join(lockRoot, `forge-web-build-${lockKey}.lock`);
  const nonce = randomUUID();
  const startedAt = Date.now();
  let announcedWait = false;

  while (Date.now() - startedAt <= waitMilliseconds) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          schema: runLockSchema,
          repositoryRoot: canonicalRepositoryRoot,
          pid: process.pid,
          nonce,
          createdAt: new Date().toISOString()
        })}\n`,
        { encoding: "utf8" }
      );
      closeSync(descriptor);
      descriptor = undefined;
      return {
        lockPath,
        release() {
          assertOwnerOnlyRunLock(lockPath);
          const current = JSON.parse(readFileSync(lockPath, "utf8"));
          if (
            current.schema !== runLockSchema ||
            current.repositoryRoot !== canonicalRepositoryRoot ||
            current.pid !== process.pid ||
            current.nonce !== nonce
          ) {
            throw new Error(
              "Refusing to release a Forge web-build lock owned by another run."
            );
          }
          unlinkSync(lockPath);
        }
      };
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (error?.code !== "EEXIST") throw error;

      let current;
      try {
        assertOwnerOnlyRunLock(lockPath);
        current = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      if (
        current.schema !== runLockSchema ||
        current.repositoryRoot !== canonicalRepositoryRoot ||
        !Number.isSafeInteger(current.pid) ||
        current.pid < 1 ||
        typeof current.nonce !== "string"
      ) {
        throw new Error("The existing Forge web-build lock is malformed.");
      }
      if (!processIsRunning(current.pid)) {
        try {
          unlinkSync(lockPath);
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      if (!announcedWait) {
        onWait?.(
          `Another Forge build or browser suite (PID ${current.pid}) is active; waiting for it to finish safely.\n`
        );
        announcedWait = true;
      }
      await delay(pollMilliseconds);
    }
  }
  throw new Error(
    "Timed out waiting for the active Forge build or browser suite to release its repository lock."
  );
}
