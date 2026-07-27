import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { importJWK, SignJWT, type JWK } from "jose";

const KEYCHAIN_SERVICE = "dev.albertbuchard.forge.remote-client";
const CREDENTIAL_ID = /^forge-client-[A-Za-z0-9_-]{16,160}$/;
const TOKEN = /^(?:fg_refresh_|eyJ)[A-Za-z0-9._-]{32,8192}$/;
const LOCK_POLL_MS = 40;
const LOCK_MAX_WAIT_MS = 10_000;

export type StoredForgeRemoteCredential = {
  schemaVersion: 1;
  credentialId: string;
  endpoint: string;
  audience: string;
  clientId: string;
  keyThumbprint: string;
  privateJwk: JWK;
  refreshToken: string;
  scopes: string[];
  profile: string;
  createdAt: string;
  updatedAt: string;
};

type AccessState = {
  token: string;
  expiresAt: number;
};

const accessStates = new Map<string, AccessState>();
const refreshPromises = new Map<
  string,
  Promise<{
    credential: StoredForgeRemoteCredential;
    state: AccessState;
  }>
>();

type RefreshLockRecord = {
  schemaVersion: 1;
  pid: number;
  nonce: string;
  createdAt: string;
};

type RefreshLock = {
  handle: FileHandle;
  lockPath: string;
  nonce: string;
  device: bigint;
  inode: bigint;
};

function requireMacos() {
  if (process.platform !== "darwin") {
    throw new Error(
      "Forge remote renewable credentials currently require the macOS Keychain helper on this platform."
    );
  }
}

function requireCredentialId(value: string) {
  if (!CREDENTIAL_ID.test(value)) {
    throw new Error("Forge remote credential identifier is invalid.");
  }
  return value;
}

function keychainArgument(keychainPath?: string) {
  if (keychainPath === undefined) {
    return [];
  }
  if (!/^\/[A-Za-z0-9._/-]{1,1024}$/.test(keychainPath)) {
    throw new Error("Forge test Keychain path is invalid.");
  }
  return [keychainPath];
}

function lockDirectory() {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return path.join(os.tmpdir(), `forge-remote-credential-locks-${uid}`);
}

function refreshLockPath(credentialId: string, keychainPath?: string) {
  const identity = `${credentialId}\0${keychainPath ?? "default"}`;
  return path.join(
    lockDirectory(),
    `${createHash("sha256").update(identity).digest("hex")}.lock`
  );
}

async function ensurePrivateLockDirectory() {
  const directory = lockDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await stat(directory, { bigint: true });
  const uid =
    typeof process.getuid === "function" ? BigInt(process.getuid()) : 0n;
  if (
    !metadata.isDirectory() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o077n) !== 0n
  ) {
    throw new Error(
      "Forge remote credential lock directory is not private to the current user."
    );
  }
  return directory;
}

function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    return null;
  }
}

async function recoverDeadRefreshLock(lockPath: string) {
  let raw: string;
  let before: Awaited<ReturnType<typeof stat>>;
  try {
    before = await stat(lockPath, { bigint: true });
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    return false;
  }
  const uid =
    typeof process.getuid === "function" ? BigInt(process.getuid()) : 0n;
  if (!before.isFile() || before.uid !== uid || (before.mode & 0o077n) !== 0n) {
    throw new Error(
      "Forge remote credential refresh lock is not private to the current user."
    );
  }
  let record: RefreshLockRecord;
  try {
    record = JSON.parse(raw) as RefreshLockRecord;
  } catch {
    // An incomplete or unknown lock cannot safely be attributed to a dead
    // process, so it is never removed automatically.
    return false;
  }
  if (
    record.schemaVersion !== 1 ||
    typeof record.nonce !== "string" ||
    !/^[A-Za-z0-9-]{16,128}$/.test(record.nonce) ||
    isProcessAlive(record.pid) !== false
  ) {
    return false;
  }
  try {
    const after = await stat(lockPath, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino) {
      return true;
    }
    const current = JSON.parse(
      await readFile(lockPath, "utf8")
    ) as RefreshLockRecord;
    if (current.nonce !== record.nonce || current.pid !== record.pid) {
      return true;
    }
    await unlink(lockPath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function acquireRefreshLock(input: {
  credentialId: string;
  keychainPath?: string;
  timeoutMs: number;
}): Promise<RefreshLock> {
  await ensurePrivateLockDirectory();
  const lockPath = refreshLockPath(input.credentialId, input.keychainPath);
  const deadline =
    Date.now() + Math.max(1, Math.min(input.timeoutMs, LOCK_MAX_WAIT_MS));
  while (true) {
    const nonce = randomUUID();
    let handle: FileHandle | undefined;
    let createdIdentity:
      | {
          device: bigint;
          inode: bigint;
        }
      | undefined;
    try {
      handle = await open(lockPath, "wx", 0o600);
      const metadata = await handle.stat({ bigint: true });
      createdIdentity = {
        device: metadata.dev,
        inode: metadata.ino
      };
      if ((metadata.mode & 0o077n) !== 0n) {
        throw new Error(
          "Forge could not create a private remote credential refresh lock."
        );
      }
      const record: RefreshLockRecord = {
        schemaVersion: 1,
        pid: process.pid,
        nonce,
        createdAt: new Date().toISOString()
      };
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
      return {
        handle,
        lockPath,
        nonce,
        device: createdIdentity.device,
        inode: createdIdentity.inode
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        if (createdIdentity) {
          try {
            const current = await stat(lockPath, { bigint: true });
            if (
              current.dev === createdIdentity.device &&
              current.ino === createdIdentity.inode
            ) {
              await unlink(lockPath);
            }
          } catch {
            // Preserve the original acquisition failure. A later process can
            // safely recover a complete dead-owner record or time out on an
            // incomplete record without deleting a potentially active lock.
          }
        }
        throw error;
      }
      if (await recoverDeadRefreshLock(lockPath)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Forge timed out waiting for another process to finish remote credential renewal."
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

async function releaseRefreshLock(lock: RefreshLock) {
  await lock.handle.close();
  try {
    const metadata = await stat(lock.lockPath, { bigint: true });
    if (metadata.dev !== lock.device || metadata.ino !== lock.inode) {
      return;
    }
    const record = JSON.parse(
      await readFile(lock.lockPath, "utf8")
    ) as RefreshLockRecord;
    if (record.nonce === lock.nonce && record.pid === process.pid) {
      await unlink(lock.lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function runSecurity(args: string[], input?: string) {
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
    timeout: 10_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("Forge could not access its macOS Keychain credential.");
  }
  return result.stdout;
}

function parseStoredCredential(
  raw: string,
  expectedId: string
): StoredForgeRemoteCredential {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Forge found a malformed remote Keychain credential.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as StoredForgeRemoteCredential).schemaVersion !== 1 ||
    (value as StoredForgeRemoteCredential).credentialId !== expectedId
  ) {
    throw new Error("Forge found an incompatible remote Keychain credential.");
  }
  const credential = value as StoredForgeRemoteCredential;
  const endpoint = new URL(credential.endpoint);
  if (
    endpoint.origin !== credential.endpoint ||
    endpoint.protocol !== "https:" ||
    !/^client_[A-Za-z0-9-]{16,180}$/.test(credential.clientId) ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(credential.keyThumbprint) ||
    !TOKEN.test(credential.refreshToken) ||
    credential.privateJwk.kty !== "EC" ||
    credential.privateJwk.crv !== "P-256" ||
    typeof credential.privateJwk.d !== "string" ||
    !Array.isArray(credential.scopes)
  ) {
    throw new Error("Forge remote Keychain credential failed validation.");
  }
  return credential;
}

export function readForgeRemoteCredential(
  credentialId: string,
  keychainPath?: string
): StoredForgeRemoteCredential {
  requireMacos();
  const id = requireCredentialId(credentialId);
  return parseStoredCredential(
    runSecurity([
      "find-generic-password",
      "-a",
      id,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      ...keychainArgument(keychainPath)
    ]),
    id
  );
}

export function writeForgeRemoteCredential(
  credential: StoredForgeRemoteCredential,
  keychainPath?: string
) {
  requireMacos();
  const id = requireCredentialId(credential.credentialId);
  parseStoredCredential(JSON.stringify(credential), id);
  const encoded = Buffer.from(JSON.stringify(credential), "utf8").toString(
    "hex"
  );
  const keychain = keychainArgument(keychainPath);
  runSecurity(
    ["-i"],
    [
      "add-generic-password",
      "-a",
      id,
      "-s",
      KEYCHAIN_SERVICE,
      "-U",
      "-X",
      encoded,
      ...keychain
    ].join(" ") + "\n"
  );
}

export function deleteForgeRemoteCredential(
  credentialId: string,
  keychainPath?: string
) {
  requireMacos();
  const id = requireCredentialId(credentialId);
  accessStates.delete(id);
  runSecurity([
    "delete-generic-password",
    "-a",
    id,
    "-s",
    KEYCHAIN_SERVICE,
    ...keychainArgument(keychainPath)
  ]);
}

async function dpopProof(input: {
  credential: StoredForgeRemoteCredential;
  method: string;
  targetUri: string;
  boundToken: string;
}) {
  const key = await importJWK(input.credential.privateJwk, "ES256");
  const publicJwk = {
    kty: input.credential.privateJwk.kty,
    crv: input.credential.privateJwk.crv,
    x: input.credential.privateJwk.x,
    y: input.credential.privateJwk.y
  };
  return new SignJWT({
    htm: input.method.toUpperCase(),
    htu: input.targetUri,
    ath: createHash("sha256")
      .update(input.boundToken, "utf8")
      .digest("base64url")
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: publicJwk
    })
    .setIssuedAt()
    .setJti(`dpop-${randomUUID()}`)
    .sign(key);
}

async function refreshAccessCredential(input: {
  credentialId: string;
  baseUrl: string;
  timeoutMs: number;
  keychainPath?: string;
}) {
  const lock = await acquireRefreshLock(input);
  try {
    // The credential must be reread only after acquiring the cross-process
    // lock because a previous process may just have rotated its refresh token.
    const credential = readForgeRemoteCredential(
      input.credentialId,
      input.keychainPath
    );
    const endpoint = new URL(input.baseUrl).origin;
    if (endpoint !== credential.endpoint) {
      throw new Error(
        "Forge refused to send a remote credential to a different endpoint."
      );
    }
    const target = new URL("/api/v1/auth/token", `${endpoint}/`).toString();
    const proof = await dpopProof({
      credential,
      method: "POST",
      targetUri: target,
      boundToken: credential.refreshToken
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          dpop: proof
        },
        body: JSON.stringify({
          grantType: "refresh_token",
          refreshToken: credential.refreshToken,
          clientId: credential.clientId,
          clientKeyThumbprint: credential.keyThumbprint
        }),
        signal: controller.signal
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (
        !response.ok ||
        body.tokenType !== "DPoP" ||
        typeof body.accessToken !== "string" ||
        !TOKEN.test(body.accessToken) ||
        typeof body.refreshToken !== "string" ||
        !TOKEN.test(body.refreshToken) ||
        typeof body.expiresAt !== "string"
      ) {
        throw new Error(
          "Forge remote credential renewal was denied; pair this client again."
        );
      }
      const expiresAt = Date.parse(body.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error(
          "Forge returned an invalid access-credential lifetime."
        );
      }
      writeForgeRemoteCredential(
        {
          ...credential,
          refreshToken: body.refreshToken,
          updatedAt: new Date().toISOString()
        },
        input.keychainPath
      );
      const state = {
        token: body.accessToken,
        expiresAt
      };
      accessStates.set(input.credentialId, state);
      return { credential, state };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await releaseRefreshLock(lock);
  }
}

export async function forgeRemoteAuthorization(input: {
  credentialId: string;
  baseUrl: string;
  method: string;
  targetUri: string;
  timeoutMs: number;
  keychainPath?: string;
}) {
  let credential = readForgeRemoteCredential(
    input.credentialId,
    input.keychainPath
  );
  if (new URL(input.baseUrl).origin !== credential.endpoint) {
    throw new Error(
      "Forge refused to send a remote credential to a different endpoint."
    );
  }
  let state = accessStates.get(input.credentialId);
  if (!state || state.expiresAt - Date.now() < 30_000) {
    let pending = refreshPromises.get(input.credentialId);
    if (!pending) {
      pending = refreshAccessCredential(input);
      refreshPromises.set(input.credentialId, pending);
    }
    try {
      ({ credential, state } = await pending);
    } finally {
      if (refreshPromises.get(input.credentialId) === pending) {
        refreshPromises.delete(input.credentialId);
      }
    }
  }
  return {
    authorization: `DPoP ${state.token}`,
    dpop: await dpopProof({
      credential,
      method: input.method,
      targetUri: input.targetUri,
      boundToken: state.token
    })
  };
}
