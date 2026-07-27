import assert from "node:assert/strict";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import {
  OutboundPolicy,
  OutboundPolicyError,
  credentialBindingAllows,
  detachCredentialForDestinationChange,
  headersForRedirect,
  type CredentialDestinationBinding
} from "./outbound-policy.js";

const principal: ForgePrincipal = {
  kind: "paired_client",
  subjectId: "outbound-subject",
  ownerId: "outbound-owner",
  clientId: "outbound-client",
  installationId: "outbound-installation",
  audience: "urn:forge:outbound",
  scopes: ["network.fetch"],
  profile: "trusted_personal_assistant",
  ownerSecurityEpoch: 1,
  clientSecurityEpoch: 1,
  authenticatedAt: "2026-07-26T20:00:00.000Z"
};

test("outbound policy rejects mixed DNS, private ranges, metadata, and redirect rebinding", async () => {
  let answer = [
    { address: "203.0.113.9", family: 4 as const },
    { address: "127.0.0.1", family: 4 as const }
  ];
  const policy = new OutboundPolicy({
    lookup: async () => answer,
    now: () => new Date("2026-07-26T20:00:00.000Z")
  });
  await assert.rejects(
    policy.resolve({
      destination: "https://example.com/resource",
      principal,
      installationId: "outbound-installation"
    }),
    OutboundPolicyError
  );
  answer = [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(
    policy.resolve({
      destination: "http://metadata.example/latest/meta-data",
      principal,
      installationId: "outbound-installation"
    }),
    OutboundPolicyError
  );
  answer = [{ address: "8.8.8.8", family: 4 }];
  const initial = await policy.resolve({
    destination: "https://example.com/resource",
    principal,
    installationId: "outbound-installation"
  });
  answer = [{ address: "127.0.0.1", family: 4 }];
  await assert.rejects(
    policy.resolveRedirect({
      from: initial,
      location: "https://redirect.example/internal",
      principal,
      installationId: "outbound-installation"
    }),
    OutboundPolicyError
  );
});

test("private destination grants are exact, owner/client bound, path bounded, and expiring", async () => {
  const policy = new OutboundPolicy({
    lookup: async () => [{ address: "192.168.1.20", family: 4 }],
    now: () => new Date("2026-07-26T20:00:00.000Z")
  });
  const grant = {
    grantId: "private-grant",
    ownerId: principal.ownerId,
    installationId: "outbound-installation",
    clientId: principal.clientId,
    canonicalOrigin: "https://private.example:443",
    pathPrefix: "/models/",
    approvedAt: "2026-07-26T19:59:00.000Z",
    expiresAt: "2026-07-26T20:30:00.000Z",
    revokedAt: null
  };
  await policy.resolve({
    destination: "https://private.example/models/list",
    principal,
    installationId: "outbound-installation",
    privateDestinationGrant: grant
  });
  await assert.rejects(
    policy.resolve({
      destination: "https://private.example/admin",
      principal,
      installationId: "outbound-installation",
      privateDestinationGrant: grant
    }),
    OutboundPolicyError
  );
  await assert.rejects(
    policy.resolve({
      destination: "https://private.example/models/list",
      principal: { ...principal, clientId: "other-client" },
      installationId: "outbound-installation",
      privateDestinationGrant: grant
    }),
    OutboundPolicyError
  );
});

test("credential release requires exact provider destination binding and retargeting detaches", async () => {
  const policy = new OutboundPolicy({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }]
  });
  const destination = await policy.resolve({
    destination: "https://api.example.com/v1/models",
    principal,
    installationId: "outbound-installation"
  });
  const binding: CredentialDestinationBinding = {
    credentialId: "credential-1",
    providerKind: "compatible_api",
    ownerId: principal.ownerId,
    installationId: "outbound-installation",
    scheme: "https:",
    host: "api.example.com",
    port: 443,
    pathPrefix: "/v1/",
    audience: principal.audience,
    version: 1,
    detachedAt: null
  };
  assert.equal(
    credentialBindingAllows({
      binding,
      providerKind: "compatible_api",
      principal,
      installationId: "outbound-installation",
      audience: principal.audience,
      destination
    }),
    true
  );
  assert.equal(
    credentialBindingAllows({
      binding,
      providerKind: "different_provider",
      principal,
      installationId: "outbound-installation",
      audience: principal.audience,
      destination
    }),
    false
  );
  const detached = detachCredentialForDestinationChange({
    binding,
    nextDestination: "https://other.example.com/v1/models",
    detachedAt: "2026-07-26T20:00:00.000Z"
  });
  assert.equal(detached.detachedAt, "2026-07-26T20:00:00.000Z");
  assert.equal(detached.version, 2);
});

test("cross-origin redirects strip authorization, cookies, and proxy credentials", () => {
  assert.deepEqual(
    headersForRedirect(
      {
        Authorization: "Bearer sentinel",
        Cookie: "session=sentinel",
        "Proxy-Authorization": "Basic sentinel",
        Accept: "application/json"
      },
      true
    ),
    { Accept: "application/json" }
  );
});
