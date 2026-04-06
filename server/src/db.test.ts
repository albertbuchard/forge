import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDefaultDataRoot } from "./db.js";

test("resolveDefaultDataRoot prefers the tracked monorepo Forge data root when available", () => {
  const expected = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "data",
    "forge"
  );

  assert.equal(resolveDefaultDataRoot("/tmp/forge-standalone"), expected);
});
