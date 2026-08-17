import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { callConfiguredForgeApi } from "../../../web/src/openclaw/api-client.js";
import { createLocalOwnerSession } from "../../../web/src/openclaw/local-owner-client.js";
import { applicationSecurityRuntimeForTest, buildServer } from "../app.js";
import { closeDatabase } from "../db.js";

const ownerBrokerBinary = path.resolve(
  "packages/forge-peer/target/debug/forge-owner-broker"
);
const ownerBrokerSha256 = existsSync(ownerBrokerBinary)
  ? createHash("sha256").update(readFileSync(ownerBrokerBinary)).digest("hex")
  : null;

async function approve(socketPath: string, request: Record<string, unknown>) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ownerBrokerBinary,
      ["approve", "--socket", socketPath],
      { stdio: ["pipe", "ignore", "ignore"], env: {} }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("The test owner helper did not approve."));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

test(
  "the local owner broker issues a proof-bound short session that remote proxy paths cannot replay",
  { skip: !existsSync(ownerBrokerBinary) },
  async () => {
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "forge-local-owner-integration-")
    );
    const previousBroker = process.env.FORGE_OWNER_BROKER_BIN;
    const previousBrokerSha256 = process.env.FORGE_OWNER_BROKER_SHA256;
    process.env.FORGE_OWNER_BROKER_BIN = ownerBrokerBinary;
    process.env.FORGE_OWNER_BROKER_SHA256 = ownerBrokerSha256!;
    const launchedBrowserHandlerUrls: string[] = [];
    const app = await buildServer({
      dataRoot,
      seedDemoData: true,
      taskRunWatchdog: false,
      peerRuntime: false,
      devrageMetricSync: false,
      ownerBrokerBinaryPath: ownerBrokerBinary,
      ownerBrokerBinarySha256: ownerBrokerSha256,
      localBrowserHandlerScheme: "forge",
      localBrowserHandlerLauncher: async (handlerUrl) => {
        launchedBrowserHandlerUrls.push(handlerUrl);
      },
      localBrowserApiOrigin: "http://127.0.0.1:4317"
    });
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      assert.ok(address && typeof address === "object");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const anonymousHealth = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(anonymousHealth.status, 401);

      const session = await createLocalOwnerSession(baseUrl, 10_000, dataRoot);
      assert.match(session.cookie, /^forge_session=/);
      assert.match(session.csrfToken, /^fg_csrf_/);

      const missingProof = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { cookie: session.cookie }
      });
      assert.equal(missingProof.status, 403);

      const admitted = await fetch(`${baseUrl}/api/v1/health`, {
        headers: {
          cookie: session.cookie,
          "x-forge-csrf": session.csrfToken,
          "x-forge-runtime-probe": "1"
        }
      });
      assert.equal(admitted.status, 200);
      const payload = (await admitted.json()) as {
        app?: unknown;
        backend?: unknown;
        runtime?: { storageRoot?: unknown };
      };
      assert.equal(payload.app, "forge");
      assert.equal(payload.backend, "forge-node-runtime");
      assert.equal(payload.runtime?.storageRoot, dataRoot);

      const sharedClientHealth = await callConfiguredForgeApi(
        {
          origin: "http://127.0.0.1",
          port: address.port,
          baseUrl,
          webAppUrl: `${baseUrl}/forge/`,
          portSource: "configured",
          dataRoot,
          apiToken: "",
          actorLabel: "codex-integration-test",
          injectBootstrapContext: true,
          timeoutMs: 10_000
        },
        {
          method: "GET",
          path: "/api/v1/health",
          extraHeaders: { "x-forge-runtime-probe": "1" }
        }
      );
      assert.equal(sharedClientHealth.status, 200);
      assert.equal((sharedClientHealth.body as { app?: unknown }).app, "forge");

      const browserOrigin = new URL(baseUrl).origin;
      const browserNonce = "C".repeat(43);
      const browserKeys = await webcrypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const browserPublicKey = await webcrypto.subtle.exportKey(
        "jwk",
        browserKeys.publicKey
      );
      const browserBeginResponse = await fetch(
        `${baseUrl}/api/v1/auth/local/browser/begin`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            browserOrigin,
            browserNonce,
            browserPublicKey,
            approvalMode: "interactive"
          })
        }
      );
      const browserBeginText = await browserBeginResponse.text();
      assert.equal(browserBeginResponse.status, 200, browserBeginText);
      const browserTransaction = JSON.parse(browserBeginText) as {
        transactionId: string;
        handlerUrl: string;
        expiresAt: string;
      };
      assert.match(browserTransaction.handlerUrl, /^forge:\/\/local-auth\?/);
      assert.ok(
        Date.parse(browserTransaction.expiresAt) - Date.now() > 100_000
      );
      assert.equal(
        browserTransaction.handlerUrl.includes("fg_browser_"),
        false
      );
      const proofPayload = new TextEncoder().encode(
        [
          "forge-local-browser-exchange/1",
          browserTransaction.transactionId,
          browserOrigin,
          browserNonce
        ].join("\n")
      );
      const browserProof = Buffer.from(
        await webcrypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          browserKeys.privateKey,
          proofPayload
        )
      ).toString("base64url");
      const invalidBrowserExchange = await fetch(
        `${baseUrl}/api/v1/auth/local/browser/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transactionId: browserTransaction.transactionId,
            browserOrigin,
            browserNonce,
            browserProof: "A".repeat(86)
          })
        }
      );
      assert.equal(invalidBrowserExchange.status, 401);
      const browserExchangePromise = fetch(
        `${baseUrl}/api/v1/auth/local/browser/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transactionId: browserTransaction.transactionId,
            browserOrigin,
            browserNonce,
            browserProof
          })
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 16_000));
      const browserChallengeResponse = await fetch(
        `${baseUrl}/api/v1/auth/local/browser/challenge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transactionId: browserTransaction.transactionId,
            browserOrigin,
            browserNonce
          })
        }
      );
      assert.equal(browserChallengeResponse.status, 200);
      const browserChallenge = (await browserChallengeResponse.json()) as {
        broker: {
          socketPath: string;
          request: Record<string, unknown>;
        };
      };
      await approve(
        browserChallenge.broker.socketPath,
        browserChallenge.broker.request
      );
      const browserExchange = await browserExchangePromise;
      assert.equal(browserExchange.status, 200);
      const browserCookie = browserExchange.headers
        .get("set-cookie")
        ?.split(";", 1)[0];
      assert.match(
        browserExchange.headers.get("set-cookie") ?? "",
        /Max-Age=\d+/
      );
      const browserSession = (await browserExchange.json()) as {
        csrfToken: string;
        session: { id: string };
      };
      assert.match(browserCookie ?? "", /^forge_session=/);
      assert.match(browserSession.csrfToken, /^fg_csrf_/);
      const operatorSession = await fetch(
        `${baseUrl}/api/v1/auth/operator-session`,
        {
          headers: { cookie: browserCookie! }
        }
      );
      assert.equal(operatorSession.status, 200);
      const operatorAuthority = (await operatorSession.json()) as {
        session: {
          id: string;
          actorLabel: string;
          principalKind: string;
          localOwner: boolean;
          profile: string;
        };
      };
      assert.equal(operatorAuthority.session.id, browserSession.session.id);
      assert.equal(operatorAuthority.session.actorLabel, "Local Operator");
      assert.equal(operatorAuthority.session.principalKind, "operator_session");
      assert.equal(operatorAuthority.session.localOwner, true);
      assert.equal(operatorAuthority.session.profile, "operator");
      const browserContext = await fetch(`${baseUrl}/api/v1/context`, {
        headers: { cookie: browserCookie! }
      });
      assert.equal(browserContext.status, 200, await browserContext.text());
      const replayedBrowserExchange = await fetch(
        `${baseUrl}/api/v1/auth/local/browser/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            transactionId: browserTransaction.transactionId,
            browserOrigin,
            browserNonce,
            browserProof
          })
        }
      );
      assert.equal(replayedBrowserExchange.status, 401);
      const revokedBrowserSession = await fetch(
        `${baseUrl}/api/v1/auth/operator-session`,
        {
          method: "DELETE",
          headers: {
            cookie: browserCookie!,
            "x-forge-csrf": browserSession.csrfToken
          }
        }
      );
      assert.equal(revokedBrowserSession.status, 200);
      assert.equal(
        ((await revokedBrowserSession.json()) as { revoked: boolean }).revoked,
        true
      );
      const revokedBrowserContext = await fetch(`${baseUrl}/api/v1/context`, {
        headers: { cookie: browserCookie! }
      });
      assert.equal(revokedBrowserContext.status, 401);

      {
        const runtime = applicationSecurityRuntimeForTest(app);
        assert.ok(runtime.localOwnerSessions);
        const originalBegin = runtime.localOwnerSessions.begin.bind(
          runtime.localOwnerSessions
        );
        const mutableCoordinator = runtime.localOwnerSessions as {
          begin: typeof runtime.localOwnerSessions.begin;
        };
        const capturedModes: Array<"automatic" | "interactive" | undefined> =
          [];
        try {
          mutableCoordinator.begin = async (input) => {
            capturedModes.push(input.approvalMode);
            const transactionId = `local_schema_${capturedModes.length
              .toString()
              .padStart(16, "0")}`;
            return {
              transactionId,
              installationId: "install-schema",
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
              broker: {
                socketPath: `/tmp/${transactionId}.sock`,
                request: {
                  protocol: "forge-owner-broker/1",
                  requestId: `owner_${transactionId}`,
                  transactionId,
                  installId: "install-schema",
                  browserOrigin,
                  browserNonce
                }
              },
              platform: null
            };
          };
          for (const approvalMode of [
            undefined,
            "automatic",
            "interactive"
          ] as const) {
            const modeResponse = await fetch(
              `${baseUrl}/api/v1/auth/local/browser/begin`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  browserOrigin,
                  browserNonce,
                  browserPublicKey,
                  ...(approvalMode ? { approvalMode } : {})
                })
              }
            );
            assert.equal(modeResponse.status, 200, await modeResponse.text());
          }
          const unknownMode = await fetch(
            `${baseUrl}/api/v1/auth/local/browser/begin`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                browserOrigin,
                browserNonce,
                browserPublicKey,
                approvalMode: "human"
              })
            }
          );
          assert.equal(unknownMode.status, 400);
          assert.deepEqual(capturedModes, [
            "automatic",
            "automatic",
            "interactive"
          ]);
          assert.equal(launchedBrowserHandlerUrls.length, 2);
          assert.ok(
            launchedBrowserHandlerUrls.every((value) =>
              value.startsWith("forge://local-auth?")
            )
          );
        } finally {
          mutableCoordinator.begin = originalBegin;
        }
      }

      const proxiedReplay = await fetch(`${baseUrl}/api/v1/health`, {
        headers: {
          cookie: session.cookie,
          "x-forge-csrf": session.csrfToken,
          "x-forwarded-for": "100.64.10.20",
          "x-forwarded-proto": "https",
          "tailscale-user-login": "remote@example.test"
        }
      });
      assert.equal(proxiedReplay.status, 401);

      const remoteBegin = await fetch(`${baseUrl}/api/v1/auth/local/begin`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "100.64.10.20",
          "x-forwarded-proto": "https"
        },
        body: JSON.stringify({
          browserOrigin: new URL(baseUrl).origin,
          browserNonce: "A".repeat(43)
        })
      });
      assert.equal(remoteBegin.status, 401);
      const remoteBeginBody = await remoteBegin.text();
      assert.equal(remoteBeginBody.includes("owner-broker"), false);
      const remoteBrowserBegin = await fetch(
        `${baseUrl}/api/v1/auth/local/browser/begin`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "100.64.10.20",
            "x-forwarded-proto": "https",
            "tailscale-user-login": "remote@example.test"
          },
          body: JSON.stringify({
            browserOrigin,
            browserNonce: "D".repeat(43),
            browserPublicKey
          })
        }
      );
      assert.equal(remoteBrowserBegin.status, 401);
      assert.equal(
        (await remoteBrowserBegin.text()).includes("handlerUrl"),
        false
      );

      const replayNonce = "B".repeat(43);
      const begin = await fetch(`${baseUrl}/api/v1/auth/local/begin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          browserOrigin: new URL(baseUrl).origin,
          browserNonce: replayNonce
        })
      });
      assert.equal(begin.status, 200);
      const challenge = (await begin.json()) as {
        transactionId: string;
        broker: {
          socketPath: string;
          request: Record<string, unknown>;
        };
      };
      await approve(challenge.broker.socketPath, challenge.broker.request);
      const exchangeBody = JSON.stringify({
        transactionId: challenge.transactionId,
        browserOrigin: new URL(baseUrl).origin,
        browserNonce: replayNonce
      });
      const exchanges = await Promise.all([
        fetch(`${baseUrl}/api/v1/auth/local/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: exchangeBody
        }),
        fetch(`${baseUrl}/api/v1/auth/local/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: exchangeBody
        })
      ]);
      assert.deepEqual(
        exchanges.map((response) => response.status).sort(),
        [200, 401]
      );

      const runtime = applicationSecurityRuntimeForTest(app);
      assert.ok(runtime.localOwnerSessions);
      const originalBegin = runtime.localOwnerSessions.begin.bind(
        runtime.localOwnerSessions
      );
      const mutableCoordinator = runtime.localOwnerSessions as {
        begin: typeof runtime.localOwnerSessions.begin;
      };
      const diagnosticSentinel = "forge_owner_broker_private_sentinel";
      try {
        mutableCoordinator.begin = async () => {
          throw new Error(`${diagnosticSentinel}\nnot-client-visible`);
        };
        const opaqueFailure = await fetch(
          `${baseUrl}/api/v1/auth/local/begin`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              browserOrigin: new URL(baseUrl).origin,
              browserNonce: "E".repeat(43)
            })
          }
        );
        const opaqueBody = await opaqueFailure.text();
        assert.equal(opaqueFailure.status, 500);
        assert.equal(opaqueBody.includes(diagnosticSentinel), false);
        assert.match(opaqueBody, /internal_error/);
      } finally {
        mutableCoordinator.begin = originalBegin;
      }
    } finally {
      await app.close();
      closeDatabase();
      if (previousBroker === undefined) {
        delete process.env.FORGE_OWNER_BROKER_BIN;
      } else {
        process.env.FORGE_OWNER_BROKER_BIN = previousBroker;
      }
      if (previousBrokerSha256 === undefined) {
        delete process.env.FORGE_OWNER_BROKER_SHA256;
      } else {
        process.env.FORGE_OWNER_BROKER_SHA256 = previousBrokerSha256;
      }
      await rm(dataRoot, { recursive: true, force: true });
    }
  }
);
