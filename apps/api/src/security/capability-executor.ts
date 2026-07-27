import { constants } from "node:fs";
import { lstat, open, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { ForgePrincipal } from "./contracts.js";

export class CapabilityDeniedError extends Error {
  readonly code = "capability_denied";

  constructor(message: string) {
    super(message);
    this.name = "CapabilityDeniedError";
  }
}

export type CapabilityExecutionAuthority = {
  principal: ForgePrincipal;
  directOwnerChannel: boolean;
  localOwnerLegacyExecutionEnabled: boolean;
};

export type RemoteWorkerAttestation = {
  boundary: "os_isolated_worker/v1";
  workerId: string;
  unprivilegedIdentity: string;
  networkPolicy: "deny_all" | "broker_only";
  writableRoots: readonly string[];
  readableRoots: readonly string[];
  inheritedEnvironment: boolean;
  hostSocketsMounted: boolean;
  hostHomeMounted: boolean;
};

export type RemoteCodeRequest = {
  command: string;
  cwd: string;
  maximumRuntimeMilliseconds: number;
  maximumOutputBytes: number;
  readableRoots: readonly string[];
  writableRoots: readonly string[];
  networkPolicy: "deny_all" | "broker_only";
};

export type CapabilityProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type RemoteCodeWorker = {
  attest(): Promise<RemoteWorkerAttestation> | RemoteWorkerAttestation;
  execute(request: RemoteCodeRequest): Promise<CapabilityProcessResult>;
  readFile?(request: {
    path: string;
    maximumBytes: number;
    readableRoots: readonly string[];
  }): Promise<string>;
  writeFile?(request: {
    path: string;
    content: string;
    maximumBytes: number;
    writableRoots: readonly string[];
  }): Promise<{ path: string; bytesWritten: number }>;
};

export type DeclarativeCommandPolicy = {
  id: string;
  executable: string;
  allowedArguments: (arguments_: readonly string[]) => boolean;
  allowedRoots: readonly string[];
  maximumRuntimeMilliseconds: number;
  maximumOutputBytes: number;
  environment?: Readonly<Record<string, string>>;
};

type FilePolicy = {
  readableRoots: readonly string[];
  writableRoots: readonly string[];
  maximumReadBytes: number;
  maximumWriteBytes: number;
};

export type CapabilityExecutorOptions = {
  commands?: readonly DeclarativeCommandPolicy[];
  files: FilePolicy;
  remoteWorker?: RemoteCodeWorker;
};

export type MachineCapabilitySession = {
  readTextFile(requestedPath: string): Promise<string>;
  writeTextFile(
    requestedPath: string,
    content: string
  ): Promise<{ path: string; bytesWritten: number }>;
  executeCommand(input: {
    command: string;
    cwd: string;
    maximumRuntimeMilliseconds: number;
    maximumOutputBytes: number;
  }): Promise<CapabilityProcessResult>;
};

export function createMachineCapabilitySession(input: {
  executor: CapabilityExecutor;
  authority: CapabilityExecutionAuthority;
  executionBoundary: "local_owner_legacy" | "remote_isolated";
  workspaceRoot: string;
  remoteRoots?: {
    readableRoots: readonly string[];
    writableRoots: readonly string[];
  };
}): MachineCapabilitySession {
  return {
    readTextFile: async (requestedPath) => {
      requireCapabilityScope(input.authority, "machine.read");
      const resolvedPath = path.resolve(input.workspaceRoot, requestedPath);
      return await (input.executionBoundary === "local_owner_legacy"
        ? input.executor.readFile(resolvedPath)
        : input.executor.readRemoteFile({
            path: resolvedPath,
            readableRoots: input.remoteRoots?.readableRoots ?? [],
            writableRoots: input.remoteRoots?.writableRoots ?? []
          }));
    },
    writeTextFile: async (requestedPath, content) => {
      requireCapabilityScope(input.authority, "machine.write");
      const resolvedPath = path.resolve(input.workspaceRoot, requestedPath);
      return await (input.executionBoundary === "local_owner_legacy"
        ? input.executor.writeFile(resolvedPath, content)
        : input.executor.writeRemoteFile({
            path: resolvedPath,
            content,
            readableRoots: input.remoteRoots?.readableRoots ?? [],
            writableRoots: input.remoteRoots?.writableRoots ?? []
          }));
    },
    executeCommand: async (request) => {
      requireCapabilityScope(input.authority, "machine.exec");
      return await (input.executionBoundary === "local_owner_legacy"
        ? input.executor.executeLocalOwnerLegacy(input.authority, {
            ...request,
            cwd: path.resolve(input.workspaceRoot, request.cwd)
          })
        : input.executor.executeRemoteCode({
            ...request,
            cwd: path.resolve(input.workspaceRoot, request.cwd),
            readableRoots: input.remoteRoots?.readableRoots ?? [],
            writableRoots: input.remoteRoots?.writableRoots ?? [],
            networkPolicy: "deny_all"
          }));
    }
  };
}

const MINIMUM_ENVIRONMENT = Object.freeze({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  HOME: "/var/empty"
});

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CapabilityDeniedError(`${label} is outside the allowed bound.`);
  }
  return value;
}

function pathWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function canonicalRoots(roots: readonly string[]) {
  const normalized = await Promise.all(
    roots.map(async (root) => {
      if (!path.isAbsolute(root)) {
        throw new CapabilityDeniedError(
          "Capability roots must be absolute paths."
        );
      }
      const metadata = await lstat(root);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new CapabilityDeniedError(
          "Capability roots must be real directories."
        );
      }
      return realpath(root);
    })
  );
  return Object.freeze([...new Set(normalized)].sort());
}

async function resolveExistingPath(
  requestedPath: string,
  roots: readonly string[]
) {
  if (!path.isAbsolute(requestedPath)) {
    throw new CapabilityDeniedError("Capability paths must be absolute.");
  }
  const metadata = await lstat(requestedPath);
  if (metadata.isSymbolicLink()) {
    throw new CapabilityDeniedError("Symbolic-link targets are not allowed.");
  }
  const canonical = await realpath(requestedPath);
  if (!roots.some((root) => pathWithin(root, canonical))) {
    throw new CapabilityDeniedError(
      "The requested path is outside the approved capability roots."
    );
  }
  return canonical;
}

async function resolveWritePath(
  requestedPath: string,
  roots: readonly string[]
) {
  if (!path.isAbsolute(requestedPath)) {
    throw new CapabilityDeniedError("Capability paths must be absolute.");
  }
  const parent = await resolveExistingPath(path.dirname(requestedPath), roots);
  const target = path.join(parent, path.basename(requestedPath));
  if (!roots.some((root) => pathWithin(root, target))) {
    throw new CapabilityDeniedError(
      "The requested path is outside the approved capability roots."
    );
  }
  try {
    const targetMetadata = await lstat(target);
    if (targetMetadata.isSymbolicLink() || !targetMetadata.isFile()) {
      throw new CapabilityDeniedError(
        "Capability writes require a regular file target."
      );
    }
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  return target;
}

async function assertTrustedDirectoryChain(
  directory: string,
  roots: readonly string[]
) {
  const root = roots.find((entry) => pathWithin(entry, directory));
  if (!root) {
    throw new CapabilityDeniedError(
      "The capability directory is outside the approved roots."
    );
  }
  const relative = path.relative(root, directory);
  const segments = relative ? relative.split(path.sep) : [];
  let current = root;
  let finalMetadata = await lstat(current);
  const currentUid = process.getuid?.();
  const assertDirectoryMetadata = (
    metadata: Awaited<ReturnType<typeof lstat>>
  ) => {
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (currentUid !== undefined && metadata.uid !== currentUid) ||
      (Number(metadata.mode) & 0o022) !== 0
    ) {
      throw new CapabilityDeniedError(
        "Capability directories must be owner-controlled and not group- or world-writable."
      );
    }
  };
  assertDirectoryMetadata(finalMetadata);
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new CapabilityDeniedError(
        "The capability directory chain is invalid."
      );
    }
    current = path.join(current, segment);
    finalMetadata = await lstat(current);
    assertDirectoryMetadata(finalMetadata);
  }
  return finalMetadata;
}

function requireLocalOwnerLegacy(authority: CapabilityExecutionAuthority) {
  const hasMachineExecutionScope =
    authority.principal.scopes.includes("*") ||
    authority.principal.scopes.includes("machine.*") ||
    authority.principal.scopes.includes("machine.exec");
  const isExplicitOwnerProfile =
    (authority.principal.kind === "operator_session" &&
      authority.principal.profile === "operator") ||
    (authority.principal.kind === "legacy_agent_token" &&
      authority.principal.profile === "executor" &&
      hasMachineExecutionScope);
  if (
    !isExplicitOwnerProfile ||
    !authority.directOwnerChannel ||
    !authority.localOwnerLegacyExecutionEnabled
  ) {
    throw new CapabilityDeniedError(
      "Unrestricted host execution is available only to the explicitly enabled same-machine owner profile."
    );
  }
}

function requireCapabilityScope(
  authority: CapabilityExecutionAuthority,
  requiredScope: "machine.read" | "machine.write" | "machine.exec"
) {
  if (
    !authority.principal.scopes.includes("*") &&
    !authority.principal.scopes.includes("machine.*") &&
    !authority.principal.scopes.includes(requiredScope)
  ) {
    throw new CapabilityDeniedError(
      `The authenticated principal does not hold ${requiredScope}.`
    );
  }
}

function collectBounded(
  budget: { remaining: number },
  onLimit: () => void
): {
  append(chunk: Buffer | string): void;
  value(): string;
  truncated(): boolean;
} {
  const chunks: Buffer[] = [];
  let wasTruncated = false;
  return {
    append(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, budget.remaining);
      if (bytes.byteLength > remaining) {
        if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
        budget.remaining = 0;
        wasTruncated = true;
        onLimit();
        return;
      }
      chunks.push(bytes);
      budget.remaining -= bytes.byteLength;
    },
    value: () => Buffer.concat(chunks).toString("utf8"),
    truncated: () => wasTruncated
  };
}

export async function runBoundedProcess(input: {
  executable: string;
  arguments: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  maximumRuntimeMilliseconds: number;
  maximumOutputBytes: number;
}) {
  return new Promise<CapabilityProcessResult>((resolve, reject) => {
    const child = spawn(input.executable, [...input.arguments], {
      cwd: input.cwd,
      env: { ...input.environment },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let limitReached = false;
    let timedOut = false;
    const terminate = () => {
      if (child.exitCode !== null) return;
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall through to the direct child kill.
        }
      }
      child.kill("SIGKILL");
    };
    const outputBudget = { remaining: input.maximumOutputBytes };
    const stdout = collectBounded(outputBudget, () => {
      limitReached = true;
      terminate();
    });
    const stderr = collectBounded(outputBudget, () => {
      limitReached = true;
      terminate();
    });
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.maximumRuntimeMilliseconds);
    timeout.unref?.();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (signal && timedOut && !limitReached) {
        reject(
          new CapabilityDeniedError(
            "The capability process exceeded its runtime limit."
          )
        );
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.value(),
        stderr: stderr.value(),
        truncated: stdout.truncated() || stderr.truncated()
      });
    });
  });
}

export class CapabilityExecutor {
  private readonly commands: ReadonlyMap<string, DeclarativeCommandPolicy>;
  private readonly remoteWorker: RemoteCodeWorker | null;
  private readonly filePolicy: FilePolicy;

  constructor(options: CapabilityExecutorOptions) {
    this.commands = new Map(
      (options.commands ?? []).map((command) => [command.id, command])
    );
    this.remoteWorker = options.remoteWorker ?? null;
    this.filePolicy = options.files;
  }

  async readFile(requestedPath: string) {
    const roots = await canonicalRoots(this.filePolicy.readableRoots);
    const target = await resolveExistingPath(requestedPath, roots);
    await assertTrustedDirectoryChain(path.dirname(target), roots);
    const metadata = await stat(target);
    const maximumBytes = boundedInteger(
      this.filePolicy.maximumReadBytes,
      1,
      64 * 1024 * 1024,
      "Maximum read bytes"
    );
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new CapabilityDeniedError(
        "The requested file is not a bounded regular file."
      );
    }
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    try {
      const afterOpen = await handle.stat();
      if (
        !afterOpen.isFile() ||
        afterOpen.size > maximumBytes ||
        afterOpen.dev !== metadata.dev ||
        afterOpen.ino !== metadata.ino
      ) {
        throw new CapabilityDeniedError(
          "The opened file is not a bounded regular file."
        );
      }
      return await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  }

  async writeFile(requestedPath: string, content: string) {
    const bytes = Buffer.from(content, "utf8");
    const maximumBytes = boundedInteger(
      this.filePolicy.maximumWriteBytes,
      1,
      64 * 1024 * 1024,
      "Maximum write bytes"
    );
    if (bytes.byteLength > maximumBytes) {
      throw new CapabilityDeniedError(
        "The requested write exceeds the capability limit."
      );
    }
    const roots = await canonicalRoots(this.filePolicy.writableRoots);
    const target = await resolveWritePath(requestedPath, roots);
    const parentBefore = await assertTrustedDirectoryChain(
      path.dirname(target),
      roots
    );
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.forge-${randomUUID()}.tmp`
    );
    try {
      const handle = await open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const parentAfter = await assertTrustedDirectoryChain(
        path.dirname(target),
        roots
      );
      if (
        parentAfter.dev !== parentBefore.dev ||
        parentAfter.ino !== parentBefore.ino
      ) {
        throw new CapabilityDeniedError(
          "The capability directory changed during the write."
        );
      }
      await rename(temporary, target);
      return { path: target, bytesWritten: bytes.byteLength };
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async executeDeclarative(input: {
    policyId: string;
    arguments: readonly string[];
    cwd: string;
  }) {
    const policy = this.commands.get(input.policyId);
    if (!policy || !policy.allowedArguments(input.arguments)) {
      throw new CapabilityDeniedError(
        "The declarative command is not allowed by the exact capability policy."
      );
    }
    const roots = await canonicalRoots(policy.allowedRoots);
    const cwd = await resolveExistingPath(input.cwd, roots);
    return runBoundedProcess({
      executable: policy.executable,
      arguments: input.arguments,
      cwd,
      environment: { ...MINIMUM_ENVIRONMENT, ...(policy.environment ?? {}) },
      maximumRuntimeMilliseconds: boundedInteger(
        policy.maximumRuntimeMilliseconds,
        1,
        60 * 60 * 1_000,
        "Maximum runtime"
      ),
      maximumOutputBytes: boundedInteger(
        policy.maximumOutputBytes,
        1,
        16 * 1024 * 1024,
        "Maximum output"
      )
    });
  }

  async executeRemoteCode(request: RemoteCodeRequest) {
    if (!this.remoteWorker) {
      throw new CapabilityDeniedError(
        "Remote code execution requires an installed and validated operating-system-isolated worker."
      );
    }
    const readableRoots = await canonicalRoots(request.readableRoots);
    const writableRoots = await canonicalRoots(request.writableRoots);
    const approvedRoots = [...new Set([...readableRoots, ...writableRoots])];
    if (approvedRoots.length === 0) {
      throw new CapabilityDeniedError(
        "Remote code execution requires at least one approved capability root."
      );
    }
    const cwd = await resolveExistingPath(request.cwd, approvedRoots);
    const attestation = await this.remoteWorker.attest();
    const sameRoots = (left: readonly string[], right: readonly string[]) =>
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    if (
      attestation.boundary !== "os_isolated_worker/v1" ||
      !attestation.workerId ||
      !attestation.unprivilegedIdentity ||
      attestation.inheritedEnvironment ||
      attestation.hostSocketsMounted ||
      attestation.hostHomeMounted ||
      attestation.networkPolicy !== request.networkPolicy ||
      !sameRoots(attestation.readableRoots, readableRoots) ||
      !sameRoots(attestation.writableRoots, writableRoots)
    ) {
      throw new CapabilityDeniedError(
        "The remote worker did not attest the required isolation boundary."
      );
    }
    const maximumOutputBytes = boundedInteger(
      request.maximumOutputBytes,
      1,
      16 * 1024 * 1024,
      "Maximum output"
    );
    const result = await this.remoteWorker.execute({
      ...request,
      cwd,
      readableRoots,
      writableRoots,
      maximumRuntimeMilliseconds: boundedInteger(
        request.maximumRuntimeMilliseconds,
        1,
        60 * 60 * 1_000,
        "Maximum runtime"
      ),
      maximumOutputBytes
    });
    if (
      Buffer.byteLength(result.stdout, "utf8") +
        Buffer.byteLength(result.stderr, "utf8") >
      maximumOutputBytes
    ) {
      throw new CapabilityDeniedError(
        "The isolated worker returned output outside its declared bound."
      );
    }
    return result;
  }

  private async requireRemoteWorker(input: {
    readableRoots: readonly string[];
    writableRoots: readonly string[];
    networkPolicy: "deny_all" | "broker_only";
  }) {
    if (!this.remoteWorker) {
      throw new CapabilityDeniedError(
        "Remote host capabilities require an installed and validated operating-system-isolated worker."
      );
    }
    const readableRoots = await canonicalRoots(input.readableRoots);
    const writableRoots = await canonicalRoots(input.writableRoots);
    const attestation = await this.remoteWorker.attest();
    const sameRoots = (left: readonly string[], right: readonly string[]) =>
      JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    if (
      attestation.boundary !== "os_isolated_worker/v1" ||
      !attestation.workerId ||
      !attestation.unprivilegedIdentity ||
      attestation.inheritedEnvironment ||
      attestation.hostSocketsMounted ||
      attestation.hostHomeMounted ||
      attestation.networkPolicy !== input.networkPolicy ||
      !sameRoots(attestation.readableRoots, readableRoots) ||
      !sameRoots(attestation.writableRoots, writableRoots)
    ) {
      throw new CapabilityDeniedError(
        "The remote worker did not attest the required isolation boundary."
      );
    }
    return { worker: this.remoteWorker, readableRoots, writableRoots };
  }

  async readRemoteFile(input: {
    path: string;
    readableRoots: readonly string[];
    writableRoots: readonly string[];
  }) {
    const { worker, readableRoots } = await this.requireRemoteWorker({
      readableRoots: input.readableRoots,
      writableRoots: input.writableRoots,
      networkPolicy: "deny_all"
    });
    if (!worker.readFile) {
      throw new CapabilityDeniedError(
        "The isolated worker does not support bounded file reads."
      );
    }
    const path_ = await resolveExistingPath(input.path, readableRoots);
    const maximumBytes = boundedInteger(
      this.filePolicy.maximumReadBytes,
      1,
      64 * 1024 * 1024,
      "Maximum read bytes"
    );
    const value = await worker.readFile({
      path: path_,
      maximumBytes,
      readableRoots
    });
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
      throw new CapabilityDeniedError(
        "The isolated worker returned a file outside its declared bound."
      );
    }
    return value;
  }

  async writeRemoteFile(input: {
    path: string;
    content: string;
    readableRoots: readonly string[];
    writableRoots: readonly string[];
  }) {
    const { worker, writableRoots } = await this.requireRemoteWorker({
      readableRoots: input.readableRoots,
      writableRoots: input.writableRoots,
      networkPolicy: "deny_all"
    });
    if (!worker.writeFile) {
      throw new CapabilityDeniedError(
        "The isolated worker does not support bounded file writes."
      );
    }
    const bytes = Buffer.byteLength(input.content, "utf8");
    const maximumBytes = boundedInteger(
      this.filePolicy.maximumWriteBytes,
      1,
      64 * 1024 * 1024,
      "Maximum write bytes"
    );
    if (bytes > maximumBytes) {
      throw new CapabilityDeniedError(
        "The requested write exceeds the capability limit."
      );
    }
    const path_ = await resolveWritePath(input.path, writableRoots);
    const result = await worker.writeFile({
      path: path_,
      content: input.content,
      maximumBytes,
      writableRoots
    });
    if (result.bytesWritten !== bytes || result.path !== path_) {
      throw new CapabilityDeniedError(
        "The isolated worker returned an invalid file-write receipt."
      );
    }
    return result;
  }

  async executeLocalOwnerLegacy(
    authority: CapabilityExecutionAuthority,
    input: {
      command: string;
      cwd: string;
      maximumRuntimeMilliseconds: number;
      maximumOutputBytes: number;
    }
  ) {
    requireLocalOwnerLegacy(authority);
    const roots = await canonicalRoots(this.filePolicy.readableRoots);
    const cwd = await resolveExistingPath(input.cwd, roots);
    return runBoundedProcess({
      executable: "/bin/zsh",
      arguments: ["-lc", input.command],
      cwd,
      environment: MINIMUM_ENVIRONMENT,
      maximumRuntimeMilliseconds: boundedInteger(
        input.maximumRuntimeMilliseconds,
        1,
        60 * 60 * 1_000,
        "Maximum runtime"
      ),
      maximumOutputBytes: boundedInteger(
        input.maximumOutputBytes,
        1,
        16 * 1024 * 1024,
        "Maximum output"
      )
    });
  }
}
