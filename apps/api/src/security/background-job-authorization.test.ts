import assert from "node:assert/strict";
import test from "node:test";

import {
  BackgroundJobAuthorizationError,
  BackgroundJobManager,
  type BackgroundJobAuthorization
} from "../managers/platform/background-job-manager.js";
import {
  createBackgroundJobAdmissionPolicy,
  systemBackgroundPrincipal
} from "./background-job-authorization.js";
import { forgeAccessGatewayPolicyVersion } from "./access-gateway.js";

const runtimeBoundary = {
  ownerId: "owner-background-test",
  installationId: "install-background-test",
  audience: "urn:forge:install-background-test:api"
} as const;

function systemAuthorization(
  overrides: Partial<BackgroundJobAuthorization> = {}
): BackgroundJobAuthorization {
  const authorization = {
    principal: systemBackgroundPrincipal({
      ...runtimeBoundary,
      ownerSecurityEpoch: 4
    }),
    action: "wiki.ingest.execute",
    resource: "wiki_ingest_job:job-1",
    policyVersion: forgeAccessGatewayPolicyVersion,
    budget: {
      maximumRuntimeMilliseconds: 60_000,
      maximumEffectInvocations: 1,
      capabilities: ["wiki.ingest.execute"]
    },
    ...overrides
  };
  return {
    ...authorization,
    budget: overrides.budget ?? {
      ...authorization.budget,
      capabilities: [authorization.action]
    }
  };
}

test("background dispatch fails closed without a configured admission policy", () => {
  const manager = new BackgroundJobManager();
  assert.throws(
    () =>
      manager.enqueue({
        id: "job-no-policy",
        label: "No policy",
        authorization: systemAuthorization(),
        handler: async () => {
          throw new Error("The denied handler must not run.");
        }
      }),
    BackgroundJobAuthorizationError
  );
  assert.equal(manager.has("job-no-policy"), false);
});

test("background dispatch requires the current owner boundary and an explicit system capability", async () => {
  let ownerEpoch = 4;
  const policy = createBackgroundJobAdmissionPolicy({
    ...runtimeBoundary,
    readOwnerSecurityEpoch: () => ownerEpoch,
    readClient: () => null,
    readLegacyToken: () => null,
    readBrowserSession: () => null
  });
  const manager = new BackgroundJobManager(1, policy);

  try {
    for (const action of [
      "ai_processor.cron.execute",
      "data_backup.automatic.execute",
      "devrage.sync.execute"
    ]) {
      assert.equal(
        manager.authorize(
          systemAuthorization({
            action,
            resource: `scheduled:${action}`
          })
        ).action,
        action
      );
    }
    for (const authorization of [
      systemAuthorization({
        policyVersion: "forged-policy/1"
      }),
      systemAuthorization({
        action: "wiki.ingest.unreviewed"
      }),
      systemAuthorization({
        principal: {
          ...systemAuthorization().principal,
          ownerId: "other-owner"
        }
      })
    ]) {
      assert.throws(
        () =>
          manager.enqueue({
            id: `denied-${authorization.action}-${authorization.policyVersion}`,
            label: "Denied background dispatch",
            authorization,
            handler: async () => {
              throw new Error("The denied handler must not run.");
            }
          }),
        BackgroundJobAuthorizationError
      );
    }

    const ran = new Promise<void>((resolve) => {
      manager.enqueue({
        id: "job-authorized",
        label: "Authorized background dispatch",
        authorization: systemAuthorization(),
        handler: async () => {
          resolve();
        }
      });
    });
    await ran;

    ownerEpoch += 1;
    assert.throws(
      () =>
        manager.enqueue({
          id: "job-stale-owner",
          label: "Stale owner background dispatch",
          authorization: systemAuthorization(),
          handler: async () => {
            throw new Error("The stale handler must not run.");
          }
        }),
      BackgroundJobAuthorizationError
    );
  } finally {
    await manager.stop();
  }
});

test("background execution stops waiting when its declared runtime budget expires", async () => {
  const policy = createBackgroundJobAdmissionPolicy({
    ...runtimeBoundary,
    readOwnerSecurityEpoch: () => 4,
    readClient: () => null,
    readLegacyToken: () => null,
    readBrowserSession: () => null
  });
  const manager = new BackgroundJobManager(1, policy);
  try {
    manager.enqueue({
      id: "job-runtime-budget",
      label: "Runtime budget",
      authorization: systemAuthorization({
        budget: {
          maximumRuntimeMilliseconds: 20,
          maximumEffectInvocations: 1,
          capabilities: ["wiki.ingest.execute"]
        }
      }),
      handler: async () =>
        new Promise<void>(() => {
          // The manager's bounded wait must end even if a handler does not.
        })
    });
    const deadline = Date.now() + 1_000;
    while (manager.has("job-runtime-budget") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(manager.has("job-runtime-budget"), false);
  } finally {
    await manager.stop();
  }
});

test("operator background authority remains bound to a live process-bound browser session", () => {
  const principal = Object.freeze({
    kind: "operator_session" as const,
    subjectId: "browser-session-background",
    ownerId: runtimeBoundary.ownerId,
    clientId: null,
    installationId: null,
    audience: runtimeBoundary.audience,
    scopes: Object.freeze(["*"]),
    profile: "operator" as const,
    ownerSecurityEpoch: 4,
    clientSecurityEpoch: null,
    authenticatedAt: "2026-07-26T18:00:00.000Z",
    runtimeBinding: "runtime-binding-background"
  });
  let revokedAt: string | null = null;
  let storedRuntimeBinding: string = principal.runtimeBinding;
  const policy = createBackgroundJobAdmissionPolicy({
    ...runtimeBoundary,
    readOwnerSecurityEpoch: () => 4,
    readClient: () => null,
    readLegacyToken: () => null,
    readBrowserSession: () => ({
      id: principal.subjectId,
      principal: {
        ...principal,
        runtimeBinding: storedRuntimeBinding
      },
      ownerSecurityEpoch: 4,
      idleExpiresAt: "2026-07-26T19:00:00.000Z",
      absoluteExpiresAt: "2026-07-27T18:00:00.000Z",
      revokedAt
    }),
    now: () => new Date("2026-07-26T18:30:00.000Z")
  });
  const authorization: BackgroundJobAuthorization = {
    principal,
    action: "wiki.ingest.execute",
    resource: "wiki_ingest_job:operator-session",
    policyVersion: forgeAccessGatewayPolicyVersion,
    budget: {
      maximumRuntimeMilliseconds: 60_000,
      maximumEffectInvocations: 1,
      capabilities: ["wiki.ingest.execute"]
    }
  };

  assert.equal(policy(authorization), true);
  revokedAt = "2026-07-26T18:31:00.000Z";
  assert.equal(policy(authorization), false);
  revokedAt = null;
  storedRuntimeBinding = "other-runtime";
  assert.equal(policy(authorization), false);
});

test("paired and legacy background effects are reauthorized against current client and token policy", () => {
  let pairedRevokedAt: string | null = null;
  let pairedScopes = ["profile:trusted_personal_assistant"];
  let legacyRevokedAt: string | null = null;
  let legacyScopes = ["read", "write"];
  const policy = createBackgroundJobAdmissionPolicy({
    ...runtimeBoundary,
    readOwnerSecurityEpoch: () => 4,
    readClient: () => ({
      id: "client-background",
      ownerId: runtimeBoundary.ownerId,
      subjectId: "paired-background",
      installationId: runtimeBoundary.installationId,
      audience: runtimeBoundary.audience,
      profile: "trusted_personal_assistant",
      scopes: pairedScopes,
      ownerSecurityEpoch: 4,
      clientSecurityEpoch: 3,
      revokedAt: pairedRevokedAt
    }),
    readLegacyToken: () => ({
      id: "token-background",
      agentId: "legacy-background",
      scopes: legacyScopes,
      revokedAt: legacyRevokedAt
    }),
    readBrowserSession: () => null
  });
  const pairedPrincipal = {
    kind: "paired_client" as const,
    subjectId: "paired-background",
    ownerId: runtimeBoundary.ownerId,
    clientId: "client-background",
    installationId: runtimeBoundary.installationId,
    audience: runtimeBoundary.audience,
    scopes: ["profile:trusted_personal_assistant"],
    profile: "trusted_personal_assistant" as const,
    ownerSecurityEpoch: 4,
    clientSecurityEpoch: 3,
    authenticatedAt: "2026-07-26T18:00:00.000Z"
  };
  const legacyPrincipal = {
    ...pairedPrincipal,
    kind: "legacy_agent_token" as const,
    subjectId: "legacy-background",
    clientId: "token-background",
    clientSecurityEpoch: 1,
    scopes: ["read", "write"]
  };
  const authorization = (
    principal: typeof pairedPrincipal | typeof legacyPrincipal
  ): BackgroundJobAuthorization => ({
    principal,
    action: "wiki.ingest.execute",
    resource: "wiki_ingest_job:policy-change",
    policyVersion: forgeAccessGatewayPolicyVersion,
    budget: {
      maximumRuntimeMilliseconds: 60_000,
      maximumEffectInvocations: 1,
      capabilities: ["wiki.ingest.execute"]
    }
  });

  assert.equal(policy(authorization(pairedPrincipal)), true);
  assert.equal(policy(authorization(legacyPrincipal)), true);
  pairedRevokedAt = "2026-07-26T18:05:00.000Z";
  legacyRevokedAt = "2026-07-26T18:05:00.000Z";
  assert.equal(policy(authorization(pairedPrincipal)), false);
  assert.equal(policy(authorization(legacyPrincipal)), false);
  pairedRevokedAt = null;
  legacyRevokedAt = null;
  pairedScopes = ["read"];
  legacyScopes = ["read"];
  assert.equal(policy(authorization(pairedPrincipal)), false);
  assert.equal(policy(authorization(legacyPrincipal)), false);
});
