import assert from "node:assert/strict";
import test from "node:test";

import type { PairingRequest } from "./pairing-service.js";
import { createServerPairingReview } from "./pairing-review.js";

function pairingRequest(
  overrides: Partial<PairingRequest> = {}
): PairingRequest {
  return {
    id: "pair_review_metadata_test",
    ownerId: "owner-1",
    ownerSecurityEpoch: 1,
    installationId: "installation-1",
    clientName: "Codex",
    clientType: "api",
    clientKeyThumbprint: "a".repeat(43),
    audience: "urn:forge:installation-1:api",
    requestedScopes: ["machine.exec", "read"],
    requestedProfile: "executor",
    deviceDigest: "device-code-digest",
    userCodeDigest: "user-code-digest",
    status: "pending",
    pollIntervalSeconds: 5,
    nextPollAt: "2026-07-26T12:00:00.000Z",
    expiresAt: "2026-07-26T12:10:00.000Z",
    createdAt: "2026-07-26T12:00:00.000Z",
    updatedAt: "2026-07-26T12:00:00.000Z",
    approval: null,
    ...overrides
  };
}

test("pairing review fingerprints server identity and states resource and egress boundaries", () => {
  const review = createServerPairingReview({
    request: pairingRequest(),
    installationId: "installation-1",
    canonicalExternalOrigin: "https://forge.example.ts.net"
  });

  assert.match(review.installationFingerprint, /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
  assert.match(review.endpoint.fingerprint, /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
  assert.equal(review.endpoint.origin, "https://forge.example.ts.net");
  assert.deepEqual(review.boundaries.resources.scopes, [
    "machine.exec",
    "read"
  ]);
  assert.deepEqual(review.boundaries.egress.requestedScopes, [
    "machine.exec"
  ]);
  assert.equal(
    review.boundaries.egress.default,
    "denied_unless_capability_explicitly_allows"
  );

  const otherEndpoint = createServerPairingReview({
    request: pairingRequest(),
    installationId: "installation-1",
    canonicalExternalOrigin: "https://other.example.ts.net"
  });
  assert.notEqual(
    otherEndpoint.endpoint.fingerprint,
    review.endpoint.fingerprint
  );
  assert.equal(
    otherEndpoint.installationFingerprint,
    review.installationFingerprint
  );
});
