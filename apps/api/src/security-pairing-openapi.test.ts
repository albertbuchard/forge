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

test("trusted-device OpenAPI is non-enumerating and never promises operator restoration", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: { securitySchemes: Record<string, unknown> };
  };
  const options =
    document.paths["/api/v1/auth/trusted-browser/authentication/options"]?.post;
  const verify =
    document.paths["/api/v1/auth/trusted-browser/authentication/verify"]?.post;
  const registration =
    document.paths["/api/v1/auth/trusted-browser/registration/options"]?.post;
  const registrationVerify =
    document.paths["/api/v1/auth/trusted-browser/registration/verify"]?.post;
  const status =
    document.paths["/api/v1/auth/trusted-browser/status"]?.post;
  const credentials =
    document.paths["/api/v1/auth/trusted-browser/credentials"]?.get;
  const revoke =
    document.paths[
      "/api/v1/auth/trusted-browser/credentials/{id}/revoke"
    ]?.post;

  assert.ok(options);
  assert.ok(verify);
  assert.ok(registration);
  assert.ok(registrationVerify);
  assert.ok(status);
  assert.ok(credentials);
  assert.ok(revoke);
  assert.deepEqual(options.security, []);
  assert.deepEqual(verify.security, []);
  assert.deepEqual(registration.security, [{ browserSession: [] }]);
  assert.deepEqual(registrationVerify.security, [{ browserSession: [] }]);
  assert.deepEqual(status.security, [{ browserSession: [] }]);
  assert.deepEqual(credentials.security, [{ operatorSession: [] }]);
  assert.deepEqual(revoke.security, [{ operatorSession: [] }]);
  assert.ok(document.components.securitySchemes.browserSession);

  const publicContract = JSON.stringify({ options, verify });
  assert.match(publicContract, /discoverable/);
  assert.match(publicContract, /can never create an operator session/);
  assert.doesNotMatch(
    JSON.stringify(options),
    /credentialId|clientName|selectedUserIds/
  );
  assert.doesNotMatch(
    JSON.stringify(credentials),
    /"(?:publicKeyBase64|counter|challengeKeyedHash|refreshToken)"\s*:/
  );
});
