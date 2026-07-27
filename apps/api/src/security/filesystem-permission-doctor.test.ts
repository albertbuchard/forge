import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PermissionMaintenance,
  PermissionMaintenanceError,
  inspectPermissionTree
} from "./filesystem-permission-doctor.js";

async function fixture() {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "forge-permissions-"))
  );
  const root = path.join(parent, "data");
  const backups = path.join(root, "backups");
  const database = path.join(root, "forge.db");
  await mkdir(backups, { recursive: true, mode: 0o755 });
  await writeFile(database, "synthetic", { mode: 0o644 });
  return { parent, root, backups, database };
}

test("doctor reports effective ancestors and synthetic legacy modes without mutation", async () => {
  const value = await fixture();
  try {
    const before = (await lstat(value.database)).mode & 0o777;
    const report = await inspectPermissionTree({
      root: value.root,
      sensitivePaths: [".", "forge.db", "backups"],
      aclReader: async () => false
    });
    assert.equal(report.compliant, false);
    assert.ok(report.findings.some((entry) => entry.kind === "ancestor"));
    assert.ok(
      report.findings.some(
        (entry) =>
          entry.path === value.database &&
          entry.reasons.includes("excess_permissions")
      )
    );
    assert.equal((await lstat(value.database)).mode & 0o777, before);
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

test("maintenance repairs, resumes, repeats idempotently, and rolls back", async () => {
  const value = await fixture();
  const journalPath = path.join(value.parent, "maintenance", "journal.json");
  const receiptPath = path.join(value.parent, "maintenance", "receipt.json");
  let interrupted = false;
  try {
    const first = new PermissionMaintenance({
      root: value.root,
      sensitivePaths: [".", "forge.db", "backups"],
      journalPath,
      receiptPath,
      aclReader: async () => false,
      afterApply(index) {
        if (!interrupted && index === 0) {
          interrupted = true;
          throw new Error("synthetic interruption");
        }
      }
    });
    await assert.rejects(first.repair(), /synthetic interruption/);
    const resumed = new PermissionMaintenance({
      root: value.root,
      sensitivePaths: [".", "forge.db", "backups"],
      journalPath,
      receiptPath,
      aclReader: async () => false
    });
    await resumed.repair();
    await resumed.repair();
    assert.equal((await lstat(value.root)).mode & 0o777, 0o700);
    assert.equal((await lstat(value.database)).mode & 0o777, 0o600);
    assert.equal((await lstat(value.backups)).mode & 0o777, 0o700);
    const receipt = await readFile(receiptPath, "utf8");
    assert.doesNotMatch(receipt, new RegExp(value.root));
    assert.equal((await lstat(receiptPath)).mode & 0o777, 0o600);

    await resumed.rollback();
    assert.equal((await lstat(value.root)).mode & 0o777, 0o755);
    assert.equal((await lstat(value.database)).mode & 0o777, 0o644);
    assert.equal((await lstat(value.backups)).mode & 0o777, 0o755);
  } finally {
    await rm(value.parent, { recursive: true, force: true });
  }
});

test("maintenance refuses symbolic links, unexpected owners, and extended ACLs", async () => {
  const value = await fixture();
  try {
    await symlink(value.database, path.join(value.root, "link.db"));
    const base = {
      root: value.root,
      journalPath: path.join(value.parent, "journal.json"),
      receiptPath: path.join(value.parent, "receipt.json")
    };
    await assert.rejects(
      new PermissionMaintenance({
        ...base,
        sensitivePaths: ["link.db"],
        aclReader: async () => false
      }).repair(),
      PermissionMaintenanceError
    );
    await assert.rejects(
      new PermissionMaintenance({
        ...base,
        sensitivePaths: ["forge.db"],
        expectedUid: (process.getuid?.() ?? 0) + 1,
        aclReader: async () => false
      }).repair(),
      PermissionMaintenanceError
    );
    await assert.rejects(
      new PermissionMaintenance({
        ...base,
        sensitivePaths: ["forge.db"],
        aclReader: async (targetPath) => targetPath === value.database
      }).repair(),
      PermissionMaintenanceError
    );
  } finally {
    await chmod(value.root, 0o700).catch(() => undefined);
    await rm(value.parent, { recursive: true, force: true });
  }
});
