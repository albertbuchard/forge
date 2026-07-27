import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPermissionCommand } from "./forge-permissions.js";

test("production permission command inspects safely and requires explicit mutation consent", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "forge-permission-cli-"));
  const dataRoot = path.join(parent, "data");
  try {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dataRoot, { mode: 0o755 })
    );
    await writeFile(path.join(dataRoot, "forge.sqlite"), "synthetic", {
      mode: 0o644
    });
    const report = await runPermissionCommand([
      "inspect",
      "--data-root",
      dataRoot
    ]);
    assert.equal("compliant" in report && report.compliant, false);
    assert.equal((await lstat(dataRoot)).mode & 0o777, 0o755);
    await assert.rejects(
      runPermissionCommand(["repair", "--data-root", dataRoot]),
      /requires --apply/
    );
    await runPermissionCommand([
      "repair",
      "--data-root",
      dataRoot,
      "--apply"
    ]);
    assert.equal((await lstat(dataRoot)).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(path.join(dataRoot, "forge.sqlite"))).mode & 0o777,
      0o600
    );
    await runPermissionCommand([
      "rollback",
      "--data-root",
      dataRoot,
      "--apply"
    ]);
    assert.equal((await lstat(dataRoot)).mode & 0o777, 0o755);
  } finally {
    await chmod(dataRoot, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});
