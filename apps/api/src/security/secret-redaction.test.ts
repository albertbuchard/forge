import assert from "node:assert/strict";
import test from "node:test";

import { redactSecretValues } from "./secret-redaction.js";

test("secret redaction removes nested values and embedded diagnostic assignments", () => {
  const sentinel = "forge-synthetic-secret-123456";
  const result = redactSecretValues({
    profile: {
      apiKey: sentinel,
      nested: [{ refresh_token: sentinel }],
      secretId: "safe-reference",
      hasSecret: true
    },
    error: `provider failed authorization=Bearer ${sentinel}`,
    metadata: {
      passwordHint: "safe hint",
      tokenCount: 42
    }
  });
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(serialized, new RegExp(sentinel));
  assert.equal(result.value.profile.secretId, "safe-reference");
  assert.equal(result.value.profile.hasSecret, true);
  assert.equal(result.value.metadata.passwordHint, "safe hint");
  assert.equal(result.value.metadata.tokenCount, 42);
  assert.deepEqual(result.redactedPaths, [
    "profile.apiKey",
    "profile.nested[0].refresh_token"
  ]);
});

test("secret redaction is bounded and handles circular values", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = redactSecretValues(
    { circular, values: [1, 2, 3], deeply: { nested: { value: "ok" } } },
    { maximumDepth: 1, maximumArrayItems: 2 }
  );
  assert.equal(
    (result.value.circular as Record<string, unknown>).self,
    "[circular]"
  );
  assert.equal(result.truncated, true);
});

test("secret redaction removes quoted JSON, form, header, and bearer values", () => {
  const sentinel = "forge-synthetic-secret-quoted-123456";
  const result = redactSecretValues({
    json: JSON.stringify({
      client_secret: sentinel,
      nested: { accessToken: sentinel }
    }),
    form: `refresh_token=${sentinel}&safe=value`,
    header: `Authorization: Bearer ${sentinel}`,
    cookie: `cookie: ${sentinel}`
  });
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(serialized, new RegExp(sentinel));
  assert.match(result.value.json, /\[redacted\]/);
  assert.match(result.value.form, /refresh_token=\[redacted\]/);
  assert.match(result.value.header, /\[redacted\]/);
});

test("secret redaction consumes complete quoted values containing whitespace", () => {
  const result = redactSecretValues({
    diagnostic: "provider password='my secret phrase' failed",
    embedded: 'prefix {"clientSecret":"my secret phrase"} suffix'
  });
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(serialized, /my secret phrase/);
  assert.match(result.value.diagnostic, /password='\[redacted\]'/);
  assert.match(result.value.embedded, /"clientSecret":"\[redacted\]"/);
});
