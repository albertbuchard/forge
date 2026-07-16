import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_KEY_BYTES = 16 * 1024;

export async function readNativeSourceSigningKey({
  keyPath,
  repositoryRoot,
  maximumBytes = DEFAULT_MAX_KEY_BYTES
}) {
  if (
    typeof keyPath !== "string" ||
    !path.isAbsolute(keyPath) ||
    path.normalize(keyPath) !== keyPath
  ) {
    throw new Error("FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH must be absolute.");
  }
  if (
    typeof repositoryRoot !== "string" ||
    !path.isAbsolute(repositoryRoot) ||
    path.normalize(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error("The Forge repository root must be absolute.");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("The native source signing key size bound is invalid.");
  }

  const metadata = await lstat(keyPath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > maximumBytes
  ) {
    throw new Error(
      "FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH must name a bounded regular file."
    );
  }
  if (
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(
      "The native source signing key must be owned by this user."
    );
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(
      "The native source signing key must not be accessible to group or other users."
    );
  }

  const [resolvedKeyPath, resolvedRepoRoot] = await Promise.all([
    realpath(keyPath),
    realpath(repositoryRoot)
  ]);
  if (
    resolvedKeyPath === resolvedRepoRoot ||
    resolvedKeyPath.startsWith(`${resolvedRepoRoot}${path.sep}`)
  ) {
    throw new Error(
      "The native source signing key must be stored outside the Forge repository."
    );
  }
  return await readFile(resolvedKeyPath);
}
