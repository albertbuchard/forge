import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  windowsPathChainHasNoReparsePoints,
  windowsPathIsCurrentOwnerOnly
} from "../lib/windows-owner-auth.mjs";
import { writeCompanionPairingPayloadFile } from "../lib/pairing-payload-file.mjs";

function pairingPayload(sessionId = "pair_test") {
  return {
    sessionId,
    pairingToken: "pairing-secret",
    expiresAt: "2026-07-28T12:00:00.000Z"
  };
}

async function temporaryRoot(t) {
  const parent = await fsp.mkdtemp(
    path.join(os.tmpdir(), "forge-pairing-payload-")
  );
  t.after(async () => {
    await fsp.rm(parent, { recursive: true, force: true });
  });
  return path.join(parent, ".forge");
}

function macosAclEntries(target) {
  const result = spawnSync("/bin/ls", ["-lde", target], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => /^\s*\d+:\s/.test(line));
}

test("writes a complete pairing payload only inside an owner-only directory", async (t) => {
  const forgeRoot = await temporaryRoot(t);
  const filePath = await writeCompanionPairingPayloadFile({
    forgeRoot,
    payload: pairingPayload()
  });
  assert.equal(path.dirname(filePath), path.join(forgeRoot, "pairing"));
  assert.deepEqual(
    JSON.parse(await fsp.readFile(filePath, "utf8")),
    pairingPayload()
  );
  assert.deepEqual((await fsp.readdir(path.dirname(filePath))).sort(), [
    path.basename(filePath)
  ]);

  if (process.platform === "win32") {
    assert.ok(windowsPathIsCurrentOwnerOnly(forgeRoot));
    assert.ok(windowsPathIsCurrentOwnerOnly(path.dirname(filePath)));
    assert.ok(windowsPathIsCurrentOwnerOnly(filePath));
    assert.equal(windowsPathChainHasNoReparsePoints(forgeRoot, filePath), true);
  } else {
    assert.equal((fs.statSync(forgeRoot).mode & 0o777).toString(8), "700");
    assert.equal(
      (fs.statSync(path.dirname(filePath)).mode & 0o777).toString(8),
      "700"
    );
    assert.equal((fs.statSync(filePath).mode & 0o777).toString(8), "600");
    assert.equal(fs.statSync(filePath).nlink, 1);
  }
});

test("rejects unsafe session identifiers before creating a payload file", async (t) => {
  const forgeRoot = await temporaryRoot(t);
  await assert.rejects(
    writeCompanionPairingPayloadFile({
      forgeRoot,
      payload: pairingPayload("a/../../../escaped")
    }),
    /unsafe session identifier/
  );
  assert.equal(fs.existsSync(forgeRoot), false);
});

test("does not overwrite an existing pairing payload", async (t) => {
  const forgeRoot = await temporaryRoot(t);
  const first = pairingPayload();
  const filePath = await writeCompanionPairingPayloadFile({
    forgeRoot,
    payload: first
  });
  await assert.rejects(
    writeCompanionPairingPayloadFile({
      forgeRoot,
      payload: { ...first, pairingToken: "replacement-secret" }
    }),
    /could not save the owner-only/
  );
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, "utf8")), first);
  assert.deepEqual((await fsp.readdir(path.dirname(filePath))).sort(), [
    path.basename(filePath)
  ]);
});

test(
  "removes inherited macOS ACLs before saving the pairing secret",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const forgeRoot = await temporaryRoot(t);
    await fsp.mkdir(forgeRoot, { mode: 0o700 });
    const aclResult = spawnSync(
      "/bin/chmod",
      [
        "+a",
        "everyone allow list,search,readattr,readextattr,readsecurity,file_inherit,directory_inherit",
        forgeRoot
      ],
      { encoding: "utf8" }
    );
    assert.equal(aclResult.status, 0, aclResult.stderr);
    assert.notEqual(macosAclEntries(forgeRoot).length, 0);

    const filePath = await writeCompanionPairingPayloadFile({
      forgeRoot,
      payload: pairingPayload("pair_inherited_acl")
    });
    assert.deepEqual(macosAclEntries(forgeRoot), []);
    assert.deepEqual(macosAclEntries(path.dirname(filePath)), []);
    assert.deepEqual(macosAclEntries(filePath), []);
    assert.equal((fs.statSync(filePath).mode & 0o777).toString(8), "600");
  }
);

test(
  "rejects a linked pairing directory without writing the secret",
  { skip: process.platform === "win32" },
  async (t) => {
    const forgeRoot = await temporaryRoot(t);
    const outside = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-pairing-outside-")
    );
    t.after(async () => {
      await fsp.rm(outside, { recursive: true, force: true });
    });
    await fsp.mkdir(forgeRoot, { mode: 0o700 });
    await fsp.symlink(outside, path.join(forgeRoot, "pairing"));
    await assert.rejects(
      writeCompanionPairingPayloadFile({
        forgeRoot,
        payload: pairingPayload()
      }),
      /unsafe Companion pairing payload directory/
    );
    assert.deepEqual(await fsp.readdir(outside), []);
  }
);

test(
  "rejects a Windows pairing-directory reparse point",
  { skip: process.platform !== "win32" },
  async (t) => {
    const forgeRoot = await temporaryRoot(t);
    const outside = await fsp.mkdtemp(
      path.join(os.tmpdir(), "forge-pairing-outside-")
    );
    t.after(async () => {
      await fsp.rm(outside, { recursive: true, force: true });
    });
    await fsp.mkdir(forgeRoot, { mode: 0o700 });
    await fsp.symlink(outside, path.join(forgeRoot, "pairing"), "junction");
    await assert.rejects(
      writeCompanionPairingPayloadFile({
        forgeRoot,
        payload: pairingPayload()
      }),
      /failed closed|owner-only access controls|payload directory/
    );
    assert.deepEqual(await fsp.readdir(outside), []);
  }
);
