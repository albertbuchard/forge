import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WINDOWS_OWNER_CREDENTIAL_SCHEMA_VERSION,
  WINDOWS_OWNER_PROOF_PROTOCOL,
  createWindowsOwnerProof,
  createWindowsOwnerProofFromCredential,
  ensureWindowsOwnerCredential,
  inspectWindowsOwnerCredential,
  lockWindowsPathForCurrentOwner,
  verifyWindowsOwnerProof,
  windowsOwnerProofPayload
} from "../lib/windows-owner-auth.mjs";

const POWERSHELL_ARGUMENTS_ENV = "FORGE_WINDOWS_OWNER_POWERSHELL_ARGUMENTS_B64";

function inspectPowerShellInvocation(args, options) {
  const encodedCommandIndex = args.indexOf("-EncodedCommand");
  assert.notEqual(encodedCommandIndex, -1);
  const encodedCommand = args[encodedCommandIndex + 1];
  const encodedArguments = options.env?.[POWERSHELL_ARGUMENTS_ENV];
  assert.equal(typeof encodedCommand, "string");
  assert.equal(typeof encodedArguments, "string");
  const argumentEnvelope = JSON.parse(
    Buffer.from(encodedArguments, "base64").toString("utf8")
  );
  assert.ok(Array.isArray(argumentEnvelope.values));
  return {
    script: Buffer.from(encodedCommand, "base64").toString("utf16le"),
    arguments: argumentEnvelope.values
  };
}

function powerShellOperation(args, options) {
  const { script } = inspectPowerShellInvocation(args, options);
  if (script.includes("::SetAccessControl($target,$acl)")) return "mutation";
  if (script.includes("$inputTarget=[String]$forgeArgs[0]")) return "path";
  if (script.includes("$acl.AreAccessRulesProtected")) return "acl";
  return "other";
}

function powerShellTimeout(sentinel = "private-timeout-sentinel") {
  const error = new Error(sentinel);
  error.code = "ETIMEDOUT";
  return {
    error,
    status: null,
    signal: "SIGTERM",
    stdout: "",
    stderr: sentinel
  };
}

function powerShellSuccess(stdout = "") {
  return { status: 0, stdout, stderr: "" };
}

const TEST_WINDOWS_OWNER_SID = "S-1-5-21-1000";

function challenge(overrides = {}) {
  return {
    protocol: WINDOWS_OWNER_PROOF_PROTOCOL,
    serverNonce: "A".repeat(43),
    request: {
      protocol: "forge-owner-broker/1",
      requestId: "owner_request_1234567890",
      transactionId: "transaction_1234567890",
      installId: "install_1",
      browserOrigin: "http://127.0.0.1:4317",
      browserNonce: "B".repeat(43),
      ...(overrides.request ?? {})
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([name]) => name !== "request")
    )
  };
}

test("Windows owner proof binds the complete local transaction", () => {
  const key = Buffer.alloc(32, 7);
  const original = challenge();
  const proof = createWindowsOwnerProof(key, original);
  assert.match(proof, /^[0-9a-f]{64}$/);
  assert.equal(verifyWindowsOwnerProof(key, original, proof), true);

  const mutations = [
    challenge({ serverNonce: "C".repeat(43) }),
    challenge({ request: { requestId: "owner_request_0987654321" } }),
    challenge({ request: { transactionId: "transaction_0987654321" } }),
    challenge({ request: { installId: "install_2" } }),
    challenge({ request: { browserOrigin: "http://localhost:4317" } }),
    challenge({ request: { browserNonce: "D".repeat(43) } })
  ];
  for (const changed of mutations) {
    assert.equal(verifyWindowsOwnerProof(key, changed, proof), false);
  }
  assert.equal(
    verifyWindowsOwnerProof(Buffer.alloc(32, 8), original, proof),
    false
  );
});

test("Windows owner proof rejects remote, credentialed, and malformed origins", () => {
  const key = Buffer.alloc(32, 7);
  for (const browserOrigin of [
    "https://127.0.0.1:4317",
    "http://100.64.0.1:4317",
    "http://user@127.0.0.1:4317",
    "http://127.0.0.1:4317/forge"
  ]) {
    assert.throws(
      () =>
        createWindowsOwnerProof(key, challenge({ request: { browserOrigin } })),
      /exact loopback origin/
    );
  }
  assert.doesNotThrow(() =>
    createWindowsOwnerProof(
      key,
      challenge({ request: { browserOrigin: "http://[::1]:4317" } })
    )
  );
});

test("Windows owner proof canonicalization ignores untrusted extra fields", () => {
  const canonical = challenge();
  const withExtras = {
    ...canonical,
    attacker: "ignored",
    request: {
      ...canonical.request,
      attacker: "ignored"
    }
  };
  assert.equal(
    windowsOwnerProofPayload(withExtras),
    windowsOwnerProofPayload(canonical)
  );
});

test("Windows owner ACL mutation allows the bounded hardened PowerShell window", () => {
  let timeout;
  lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
    systemRoot: "C:\\Windows",
    spawnSyncImpl: (_command, _args, options) => {
      timeout = options.timeout;
      return { status: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(timeout, 30_000);
});

test("Windows accepts a timed-out ACL mutation only after owner-only verification", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
    systemRoot: "C:\\Windows",
    spawnSyncImpl: (_command, args, options) => {
      const operation = powerShellOperation(args, options);
      calls[operation] += 1;
      if (operation === "mutation") return powerShellTimeout();
      if (operation === "path") return powerShellSuccess();
      if (operation === "acl") {
        return powerShellSuccess(TEST_WINDOWS_OWNER_SID);
      }
      throw new Error(`Unexpected PowerShell operation: ${operation}`);
    }
  });
  assert.deepEqual(calls, { mutation: 1, path: 1, acl: 1 });
});

test("Windows retries a timed-out ACL mutation once and verifies the final path and ACL", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
    systemRoot: "C:\\Windows",
    spawnSyncImpl: (_command, args, options) => {
      const operation = powerShellOperation(args, options);
      calls[operation] += 1;
      if (operation === "mutation") {
        return calls.mutation === 1
          ? powerShellTimeout()
          : powerShellSuccess();
      }
      if (operation === "path") return powerShellSuccess();
      if (operation === "acl") {
        return calls.acl === 1
          ? { status: 13, stdout: "", stderr: "" }
          : powerShellSuccess(TEST_WINDOWS_OWNER_SID);
      }
      throw new Error(`Unexpected PowerShell operation: ${operation}`);
    }
  });
  assert.deepEqual(calls, { mutation: 2, path: 2, acl: 2 });
});

test("Windows does not retry an ordinary ACL mutation failure", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  assert.throws(
    () =>
      lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
        systemRoot: "C:\\Windows",
        spawnSyncImpl: (_command, args, options) => {
          const operation = powerShellOperation(args, options);
          calls[operation] += 1;
          return { status: 91, stdout: "", stderr: "" };
        }
      }),
    /failed closed/
  );
  assert.deepEqual(calls, { mutation: 1, path: 0, acl: 0 });
});

test("Windows does not retry after a timed-out mutation when the path check rejects", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  assert.throws(
    () =>
      lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
        systemRoot: "C:\\Windows",
        spawnSyncImpl: (_command, args, options) => {
          const operation = powerShellOperation(args, options);
          calls[operation] += 1;
          if (operation === "mutation") return powerShellTimeout();
          if (operation === "path") {
            return { status: 21, stdout: "", stderr: "" };
          }
          throw new Error(`Unexpected PowerShell operation: ${operation}`);
        }
      }),
    /failed closed after an ACL timeout/
  );
  assert.deepEqual(calls, { mutation: 1, path: 1, acl: 0 });
});

test("Windows fails closed when both bounded ACL mutation attempts time out", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  assert.throws(
    () =>
      lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
        systemRoot: "C:\\Windows",
        spawnSyncImpl: (_command, args, options) => {
          const operation = powerShellOperation(args, options);
          calls[operation] += 1;
          if (operation === "mutation") return powerShellTimeout();
          if (operation === "path") return powerShellSuccess();
          if (operation === "acl") {
            return { status: 13, stdout: "", stderr: "" };
          }
          throw new Error(`Unexpected PowerShell operation: ${operation}`);
        }
      }),
    /failed closed/
  );
  assert.deepEqual(calls, { mutation: 2, path: 1, acl: 1 });
});

test("Windows rejects a retry when the final path verification fails", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  assert.throws(
    () =>
      lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
        systemRoot: "C:\\Windows",
        spawnSyncImpl: (_command, args, options) => {
          const operation = powerShellOperation(args, options);
          calls[operation] += 1;
          if (operation === "mutation") {
            return calls.mutation === 1
              ? powerShellTimeout()
              : powerShellSuccess();
          }
          if (operation === "path") {
            return calls.path === 1
              ? powerShellSuccess()
              : { status: 21, stdout: "", stderr: "" };
          }
          if (operation === "acl") {
            return { status: 13, stdout: "", stderr: "" };
          }
          throw new Error(`Unexpected PowerShell operation: ${operation}`);
        }
      }),
    /could not verify the owner-only ACL after retry/
  );
  assert.deepEqual(calls, { mutation: 2, path: 2, acl: 1 });
});

test("Windows rejects a retry when the final ACL verification fails", () => {
  const calls = { mutation: 0, path: 0, acl: 0 };
  assert.throws(
    () =>
      lockWindowsPathForCurrentOwner("C:\\forge\\owner.json", {
        systemRoot: "C:\\Windows",
        spawnSyncImpl: (_command, args, options) => {
          const operation = powerShellOperation(args, options);
          calls[operation] += 1;
          if (operation === "mutation") {
            return calls.mutation === 1
              ? powerShellTimeout()
              : powerShellSuccess();
          }
          if (operation === "path") return powerShellSuccess();
          if (operation === "acl") {
            return { status: 13, stdout: "", stderr: "" };
          }
          throw new Error(`Unexpected PowerShell operation: ${operation}`);
        }
      }),
    /could not verify the owner-only ACL after retry/
  );
  assert.deepEqual(calls, { mutation: 2, path: 2, acl: 2 });
});

test("Windows ACL timeout errors do not expose child diagnostics or target secrets", () => {
  const sentinels = [
    "private-timeout-stderr",
    "private-command-text",
    "private-credential-material",
    "private-owner-path"
  ];
  const target = `C:\\forge\\${sentinels[3]}\\owner.json`;
  let caught;
  try {
    lockWindowsPathForCurrentOwner(target, {
      systemRoot: "C:\\Windows",
      spawnSyncImpl: (_command, args, options) => {
        const operation = powerShellOperation(args, options);
        if (operation === "mutation") {
          const result = powerShellTimeout(sentinels.join("|"));
          result.command = sentinels[1];
          result.credential = sentinels[2];
          return result;
        }
        if (operation === "path") {
          return { status: 21, stdout: "", stderr: sentinels[0] };
        }
        throw new Error(`Unexpected PowerShell operation: ${operation}`);
      }
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  const serializableOwnProperties = Object.fromEntries(
    Object.keys(caught).map((name) => [name, caught[name]])
  );
  const exposed = [
    caught.name,
    caught.message,
    caught.stack,
    JSON.stringify(serializableOwnProperties)
  ].join("\n");
  for (const sentinel of sentinels) {
    assert.equal(exposed.includes(sentinel), false);
  }
});

test(
  "Windows stores owner authentication material with CurrentUser DPAPI and owner-only ACLs",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-auth-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const credentialPath = path.join(root, "native", "windows-owner.json");
    const fixedKey = Buffer.from(
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      "hex"
    );
    const created = await ensureWindowsOwnerCredential({
      credentialPath,
      randomSource: () => Buffer.from(fixedKey),
      now: () => new Date("2026-07-26T12:00:00.000Z")
    });
    assert.equal(created.created, true);
    assert.equal(
      created.schemaVersion,
      WINDOWS_OWNER_CREDENTIAL_SCHEMA_VERSION
    );
    assert.equal(created.protection, "dpapi-current-user");

    const storedBody = await fsp.readFile(credentialPath, "utf8");
    assert.equal(storedBody.includes(fixedKey.toString("base64")), false);
    assert.equal(storedBody.includes(fixedKey.toString("hex")), false);
    assert.doesNotMatch(storedBody, /0011223344556677/);

    const inspection = inspectWindowsOwnerCredential(credentialPath);
    assert.ok(inspection);
    assert.equal(inspection.ownerSid, created.ownerSid);
    assert.equal(inspection.created, false);

    const proof = createWindowsOwnerProofFromCredential({
      credentialPath,
      challenge: challenge()
    });
    assert.match(proof, /^[0-9a-f]{64}$/);
    assert.equal(proof, createWindowsOwnerProof(fixedKey, challenge()));

    const reused = await ensureWindowsOwnerCredential({ credentialPath });
    assert.equal(reused.created, false);
    assert.equal(reused.protectedKeySha256, created.protectedKeySha256);
  }
);

test(
  "Windows refuses tampered owner authentication material without overwriting it",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-tamper-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const credentialPath = path.join(root, "native", "windows-owner.json");
    await ensureWindowsOwnerCredential({ credentialPath });
    const original = await fsp.readFile(credentialPath, "utf8");
    const parsed = JSON.parse(original);
    parsed.protectedKey = `${parsed.protectedKey.slice(0, -4)}AAAA`;
    parsed.protectedKeySha256 = createHash("sha256")
      .update(parsed.protectedKey, "utf8")
      .digest("hex");
    await fsp.writeFile(credentialPath, `${JSON.stringify(parsed)}\n`, "utf8");

    assert.equal(inspectWindowsOwnerCredential(credentialPath), null);
    await assert.rejects(
      ensureWindowsOwnerCredential({ credentialPath }),
      /refused to overwrite/
    );
    assert.equal(
      await fsp.readFile(credentialPath, "utf8"),
      `${JSON.stringify(parsed)}\n`
    );
  }
);

test(
  "Windows rejects a reparse-point credential path",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-reparse-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const nativeDirectory = path.join(root, "native");
    const realCredential = path.join(root, "real-windows-owner.json");
    const credentialPath = path.join(nativeDirectory, "windows-owner.json");
    await fsp.mkdir(nativeDirectory);
    await fsp.writeFile(realCredential, "{}\n", "utf8");
    try {
      await fsp.symlink(realCredential, credentialPath, "file");
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip(
          "The Windows runner does not permit an unprivileged file symlink."
        );
        return;
      }
      throw error;
    }
    assert.equal(inspectWindowsOwnerCredential(credentialPath), null);
    await assert.rejects(
      ensureWindowsOwnerCredential({ credentialPath }),
      /refused to overwrite/
    );
    assert.equal(fs.readFileSync(realCredential, "utf8"), "{}\n");
  }
);

test(
  "Windows rejects a junction in the credential root chain",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-junction-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const realRoot = path.join(root, "real-forge-root");
    const linkedRoot = path.join(root, "linked-forge-root");
    await fsp.mkdir(realRoot);
    await fsp.symlink(realRoot, linkedRoot, "junction");
    const credentialPath = path.join(
      linkedRoot,
      "native",
      "windows-owner.json"
    );
    await assert.rejects(
      ensureWindowsOwnerCredential({
        credentialPath,
        expectedRoot: linkedRoot
      }),
      /reparse point/
    );
    assert.equal(
      fs.existsSync(path.join(realRoot, "native", "windows-owner.json")),
      false
    );
  }
);

test(
  "Windows rejects credential roots that differ only by case",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-case-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const rootName = path.basename(root);
    const letterIndex = rootName.search(/[A-Za-z]/);
    assert.notEqual(letterIndex, -1);
    const letter = rootName[letterIndex];
    const changedLetter =
      letter === letter.toUpperCase()
        ? letter.toLowerCase()
        : letter.toUpperCase();
    const differentlyCasedRoot = path.join(
      path.dirname(root),
      `${rootName.slice(0, letterIndex)}${changedLetter}${rootName.slice(letterIndex + 1)}`
    );
    assert.notEqual(differentlyCasedRoot, root);
    const credentialPath = path.join(root, "native", "windows-owner.json");

    await assert.rejects(
      ensureWindowsOwnerCredential({
        credentialPath,
        expectedRoot: differentlyCasedRoot
      }),
      /reparse point/
    );
    assert.equal(fs.existsSync(credentialPath), false);
  }
);

test(
  "Windows cleans up only its newly created invalid credential and retries safely",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-windows-owner-retry-")
    );
    t.after(async () => {
      await fsp.rm(root, { recursive: true, force: true });
    });
    const credentialPath = path.join(root, "native", "windows-owner.json");
    let deniedCredentialAcl = false;
    const failCredentialAclOnce = (command, args, options) => {
      const invocation = inspectPowerShellInvocation(args, options);
      if (
        !deniedCredentialAcl &&
        invocation.script.includes(
          "[IO.File]::SetAccessControl($target,$acl)"
        ) &&
        invocation.arguments.at(-1) === credentialPath
      ) {
        deniedCredentialAcl = true;
        return { status: 91, stdout: "", stderr: "" };
      }
      return spawnSync(command, args, options);
    };
    await assert.rejects(
      ensureWindowsOwnerCredential({
        credentialPath,
        spawnSyncImpl: failCredentialAclOnce
      }),
      /failed closed/
    );
    assert.equal(deniedCredentialAcl, true);
    assert.equal(fs.existsSync(credentialPath), false);

    const retried = await ensureWindowsOwnerCredential({ credentialPath });
    assert.equal(retried.created, true);
    assert.ok(inspectWindowsOwnerCredential(credentialPath));
  }
);

test("production Windows owner key generation has 256 bits", () => {
  assert.equal(randomBytes(32).byteLength, 32);
});
