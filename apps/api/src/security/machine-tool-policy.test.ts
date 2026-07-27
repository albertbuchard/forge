import assert from "node:assert/strict";
import test from "node:test";

import {
  MachineToolPolicyError,
  requireEnabledTool
} from "./machine-tool-policy.js";

test("machine tool dispatch requires the exact enabled connector tool", () => {
  const activeTools = [
    { key: "machine_read_file", boxId: "machine" },
    { key: "forge_search", boxId: "forge" }
  ];
  assert.equal(
    requireEnabledTool(activeTools, "machine_read_file").boxId,
    "machine"
  );
  assert.throws(
    () => requireEnabledTool(activeTools, "machine_exec"),
    MachineToolPolicyError
  );
  assert.throws(
    () => requireEnabledTool(activeTools, "machine_read_file.extra"),
    MachineToolPolicyError
  );
});
