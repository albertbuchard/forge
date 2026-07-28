import os from "node:os";
import path from "node:path";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";

const releaseRootMarkerName = ".forge-people-sharing-release-root.json";
const releaseRootMarkerSchema = "forge-people-sharing-release-root/1";
const releaseRootMarkerPurpose =
  "isolated Forge People sharing release verification";

function isWithin(candidate: string, boundary: string) {
  const relative = path.relative(boundary, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function assertOwnerOnly(metadata: Stats, label: string) {
  if (
    process.platform !== "win32" &&
    ((typeof process.getuid === "function" &&
      metadata.uid !== process.getuid()) ||
      (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error(`${label} must be owned and accessible only by this user.`);
  }
}

function protectedForgeRoots(repoRoot: string) {
  const home = os.homedir();
  return [
    path.resolve(repoRoot, "../../data/forge"),
    path.join(home, ".forge"),
    path.join(home, ".openclaw", "forge"),
    path.join(home, ".local", "share", "forge"),
    path.join(home, "Library", "Application Support", "Forge")
  ].map((entry) => path.resolve(entry));
}

export type IsolatedE2eRuntimeConfiguration = {
  dataRoot: string;
  host: "127.0.0.1";
  port: number;
  authorityPath: string;
};

export function validateIsolatedE2eRuntime(
  environment: NodeJS.ProcessEnv,
  repoRoot: string
): IsolatedE2eRuntimeConfiguration {
  if (environment.FORGE_E2E_MODE !== "isolated") {
    throw new Error("Forge E2E authority requires explicit isolated mode.");
  }
  if (environment.HOST !== "127.0.0.1") {
    throw new Error("Forge E2E authority may bind only to 127.0.0.1.");
  }

  const configuredPort = Number.parseInt(environment.PORT ?? "", 10);
  const declaredPort = Number.parseInt(environment.FORGE_E2E_PORT ?? "", 10);
  if (
    !Number.isInteger(configuredPort) ||
    configuredPort < 1024 ||
    configuredPort > 65_535 ||
    configuredPort === 4317 ||
    configuredPort === 3027 ||
    declaredPort !== configuredPort
  ) {
    throw new Error(
      "Forge E2E authority requires one matching, non-live loopback port."
    );
  }

  const candidate = environment.FORGE_E2E_DATA_ROOT?.trim() ?? "";
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error("Forge E2E authority requires an absolute isolated root.");
  }
  const resolved = path.resolve(candidate);
  if (!existsSync(resolved)) {
    throw new Error("The isolated Forge E2E root does not exist.");
  }
  const rootMetadata = lstatSync(resolved);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("The isolated Forge E2E root must be a real directory.");
  }
  assertOwnerOnly(rootMetadata, "The isolated Forge E2E root");
  const canonicalRoot = realpathSync(resolved);
  if (canonicalRoot !== resolved) {
    throw new Error("The isolated Forge E2E root must be canonical.");
  }
  for (const protectedRoot of protectedForgeRoots(repoRoot)) {
    if (
      isWithin(canonicalRoot, protectedRoot) ||
      isWithin(protectedRoot, canonicalRoot)
    ) {
      throw new Error("Refusing a protected or live Forge data root.");
    }
  }

  const markerPath = path.join(canonicalRoot, releaseRootMarkerName);
  if (!existsSync(markerPath)) {
    throw new Error("The isolated Forge E2E root marker is missing.");
  }
  const markerMetadata = lstatSync(markerPath);
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
    throw new Error("The isolated Forge E2E marker must be a regular file.");
  }
  assertOwnerOnly(markerMetadata, "The isolated Forge E2E marker");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
    schema?: unknown;
    purpose?: unknown;
    root?: unknown;
    allowMutation?: unknown;
  };
  if (
    marker.schema !== releaseRootMarkerSchema ||
    marker.purpose !== releaseRootMarkerPurpose ||
    marker.root !== canonicalRoot ||
    marker.allowMutation !== true
  ) {
    throw new Error(
      "The isolated Forge E2E root marker does not match this root."
    );
  }

  const authorityPath = path.join(
    canonicalRoot,
    ".forge-e2e-browser-authority.json"
  );
  if (existsSync(authorityPath)) {
    throw new Error(
      "The isolated Forge E2E root contains stale browser authority; use a fresh marked root."
    );
  }
  return {
    dataRoot: canonicalRoot,
    host: "127.0.0.1",
    port: configuredPort,
    authorityPath
  };
}
