import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  BackgroundJobManager,
  type BackgroundJobAuthorization
} from "../managers/platform/background-job-manager.js";
import {
  createBackgroundJobAdmissionPolicy,
  systemBackgroundPrincipal
} from "./background-job-authorization.js";
import { SqliteBackgroundJobAuthorizationStore } from "./background-job-authorization-store.js";
import { forgeAccessGatewayPolicyVersion } from "./access-gateway.js";

const boundary = {
  ownerId: "owner-background-persistence",
  installationId: "install-background-persistence",
  audience: "urn:forge:install-background-persistence:api"
} as const;

function authorization(): BackgroundJobAuthorization {
  return {
    principal: {
      ...systemBackgroundPrincipal({
        ...boundary,
        ownerSecurityEpoch: 7
      }),
      authenticatedAt: "2026-07-26T17:30:00.000Z"
    },
    action: "wiki.ingest.execute",
    resource: "wiki_ingest_job:job-persisted",
    policyVersion: forgeAccessGatewayPolicyVersion,
    originRequestId: null,
    originConnectionId: null,
    budget: {
      maximumRuntimeMilliseconds: 60_000,
      maximumEffectInvocations: 1,
      capabilities: ["wiki.ingest.execute"]
    }
  };
}

function createStore() {
  const database = new DatabaseSync(":memory:");
  const store = new SqliteBackgroundJobAuthorizationStore(database, {
    now: () => new Date("2026-07-26T18:00:00.000Z")
  });
  store.initializeSchema();
  return { database, store };
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the background job state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("background authorization storage preserves only the verified principal boundary", () => {
  const { database, store } = createStore();
  try {
    const expected = authorization();
    const persisted = store.persist("job-persisted", expected);
    assert.deepEqual(persisted, expected);

    const queued = database
      .prepare(
        `SELECT state, denial_reason, principal_json
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get("job-persisted") as {
      state: string;
      denial_reason: string | null;
      principal_json: string;
    };
    assert.equal(queued.state, "queued");
    assert.equal(queued.denial_reason, null);
    assert.doesNotMatch(
      queued.principal_json,
      /(authorization|cookie|credential|password|proof|secret|token)/i
    );

    store.transition("job-persisted", "running");
    store.transition("job-persisted", "completed");
    const completed = database
      .prepare(
        `SELECT state, completed_at
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get("job-persisted") as {
      state: string;
      completed_at: string | null;
    };
    assert.equal(completed.state, "completed");
    assert.equal(completed.completed_at, "2026-07-26T18:00:00.000Z");
  } finally {
    database.close();
  }
});

test("background authorization attempts are append-only and terminal provenance cannot be reset", () => {
  const { database, store } = createStore();
  try {
    store.persist("job-append-only", authorization());
    store.transition("job-append-only", "completed");
    assert.throws(
      () => store.persist("job-append-only", authorization()),
      /UNIQUE constraint failed/
    );
    const row = database
      .prepare(
        `SELECT state, completed_at
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get("job-append-only") as {
      state: string;
      completed_at: string | null;
    };
    assert.equal(row.state, "completed");
    assert.equal(row.completed_at, "2026-07-26T18:00:00.000Z");
  } finally {
    database.close();
  }
});

test("queued work is denied at effect time after its owner epoch changes", async () => {
  const { database, store } = createStore();
  let ownerEpoch = 7;
  const policy = createBackgroundJobAdmissionPolicy({
    ...boundary,
    readOwnerSecurityEpoch: () => ownerEpoch,
    readClient: () => null,
    readLegacyToken: () => null,
    readBrowserSession: () => null
  });
  const manager = new BackgroundJobManager(1, policy, store);
  let releaseFirst: (() => void) | null = null;
  let secondRan = false;

  try {
    const firstStarted = new Promise<void>((resolve) => {
      manager.enqueue({
        id: "job-blocking",
        label: "Blocking job",
        authorization: {
          ...authorization(),
          resource: "wiki_ingest_job:job-blocking"
        },
        handler: async () => {
          resolve();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
      });
    });
    await firstStarted;

    manager.enqueue({
      id: "job-revoked-before-effect",
      label: "Revoked before effect",
      authorization: {
        ...authorization(),
        resource: "wiki_ingest_job:job-revoked-before-effect"
      },
      handler: async () => {
        secondRan = true;
      }
    });

    ownerEpoch += 1;
    assert.ok(releaseFirst);
    (releaseFirst as () => void)();
    await waitUntil(() => !manager.has("job-revoked-before-effect"));

    assert.equal(secondRan, false);
    const denied = database
      .prepare(
        `SELECT state, denial_reason
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get("job-revoked-before-effect") as {
      state: string;
      denial_reason: string | null;
    };
    assert.equal(denied.state, "denied");
    assert.equal(denied.denial_reason, "effect_time_authorization_denied");
  } finally {
    await manager.stop();
    database.close();
  }
});
