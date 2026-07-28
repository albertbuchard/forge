import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPackedOwnerApproval } from "./packed-owner-approval.mjs";

function assertSingleLine(value) {
  for (const control of ["\n", "\r", "\t", String.fromCharCode(27)]) {
    assert.equal(value.includes(control), false);
  }
}

test(
  "packed owner approval preserves bounded single-line timeout diagnostics",
  { skip: process.platform === "win32" },
  async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "forge-owner-helper-timeout-"))
    );
    const binaryPath = path.join(root, "timeout-owner-helper");
    try {
      await writeFile(
        binaryPath,
        `#!/bin/sh
printf 'helper\\ncontrol\\r\\t\\033[31m' >&2
printf '%4096s' diagnostic | tr ' ' x >&2
/bin/sleep 2
`
      );
      await chmod(binaryPath, 0o700);
      await assert.rejects(
        runPackedOwnerApproval(
          binaryPath,
          path.join(root, "unused.sock"),
          { requestId: "owner_helper_timeout" },
          500
        ),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /helper timed out: helper\?control/);
          assertSingleLine(error.message);
          assert.ok(error.message.length < 2_150);
          return true;
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test("packed owner approval preserves the child spawn error", async () => {
  await assert.rejects(
    runPackedOwnerApproval(
      path.join(os.tmpdir(), "forge-owner-helper-does-not-exist"),
      path.join(os.tmpdir(), "unused.sock"),
      { requestId: "owner_helper_spawn_error" },
      500
    ),
    /ENOENT/
  );
});
