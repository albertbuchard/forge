import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiDocument } from "./openapi.js";

test("exact owner pairing routes publish a secret-free OpenAPI contract", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<
      string,
      Record<
        string,
        {
          description?: string;
          requestBody?: unknown;
          responses?: Record<string, unknown>;
          security?: unknown;
        }
      >
    >;
  };
  const list = document.paths["/api/v1/auth/device/requests"]?.get;
  const approve =
    document.paths["/api/v1/auth/device/requests/{requestId}/approve"]?.post;
  const deny =
    document.paths["/api/v1/auth/device/requests/{requestId}/deny"]?.post;

  assert.ok(list);
  assert.ok(approve);
  assert.ok(deny);
  assert.deepEqual(list.security, [{ operatorSession: [] }]);
  assert.deepEqual(approve.security, [{ operatorSession: [] }]);
  assert.deepEqual(deny.security, [{ operatorSession: [] }]);

  const listContract = JSON.stringify(list);
  assert.doesNotMatch(
    listContract,
    /deviceCode|refreshToken|clientProof|accessToken/
  );
  assert.match(listContract, /without device codes, user codes/);

  const approveContract = JSON.stringify(approve);
  assert.match(approveContract, /userCode/);
  assert.match(approveContract, /writeOnly/);
  assert.match(approveContract, /real registered client/);

  const denyContract = JSON.stringify(deny);
  assert.doesNotMatch(denyContract, /userCode/);
  assert.match(denyContract, /cannot create authority/);
});
