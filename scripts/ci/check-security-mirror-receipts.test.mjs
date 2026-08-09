import assert from "node:assert/strict";
import test from "node:test";

import { verifySecurityMirrorReceipts } from "./check-security-mirror-receipts.mjs";

test("security migrations and canonical runtime inputs have exact generated mirrors", async () => {
  const receipts = await verifySecurityMirrorReceipts();
  assert.ok(receipts.length > 0);
  assert.ok(
    receipts.every((receipt) => /^[0-9a-f]{64}$/u.test(receipt.sha256))
  );
  assert.equal(
    receipts.filter((receipt) =>
      receipt.canonical.endsWith("/121_course_definition_integrity.sql")
    ).length,
    6
  );
});
