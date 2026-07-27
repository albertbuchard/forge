import assert from "node:assert/strict";
import test from "node:test";

import { verifySecurityMirrorReceipts } from "./check-security-mirror-receipts.mjs";

test("security migrations and canonical runtime inputs have exact generated mirrors", async () => {
  const receipts = await verifySecurityMirrorReceipts();
  assert.equal(receipts.length, 87);
  assert.ok(
    receipts.every((receipt) => /^[0-9a-f]{64}$/u.test(receipt.sha256))
  );
});
