import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import {
  OutboundRequestBroker,
  type OutboundCredential
} from "./outbound-request-broker.js";
import type { OutboundDestination, OutboundPolicy } from "./outbound-policy.js";

const principal: ForgePrincipal = {
  kind: "paired_client",
  subjectId: "broker-client",
  ownerId: "owner",
  clientId: "client",
  installationId: "installation",
  audience: "urn:forge:broker",
  scopes: ["network.fetch"],
  profile: "trusted_personal_assistant",
  ownerSecurityEpoch: 1,
  clientSecurityEpoch: 1,
  authenticatedAt: "2026-07-26T20:00:00.000Z"
};

function listen(
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve({ server, port: address.port });
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function destination(url: URL): OutboundDestination {
  return {
    url,
    addresses: [{ address: "127.0.0.1", family: 4 }],
    selectedAddress: { address: "127.0.0.1", family: 4 },
    canonicalOrigin: `${url.protocol}//${url.hostname}:${url.port}`
  };
}

test("broker pins the socket to the validated address instead of resolving again", async () => {
  const fixture = await listen((request, response) => {
    response.end(request.headers.host);
  });
  try {
    const resolver = {
      resolve: async (input: { destination: string | URL }) =>
        destination(new URL(input.destination)),
      resolveRedirect: async () => {
        throw new Error("unexpected redirect");
      }
    } as Pick<OutboundPolicy, "resolve" | "resolveRedirect">;
    const broker = new OutboundRequestBroker(resolver);
    const response = await broker.request({
      destination: `http://must-not-resolve.invalid:${fixture.port}/pinned`,
      principal,
      installationId: "installation",
      maximumResponseBytes: 128,
      timeoutMilliseconds: 2_000
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.body.toString("utf8"),
      `must-not-resolve.invalid:${fixture.port}`
    );
  } finally {
    await close(fixture.server);
  }
});

test("broker revalidates redirects and never forwards credentials across origins", async () => {
  let redirectedAuthorization: string | undefined;
  const target = await listen((request, response) => {
    redirectedAuthorization = request.headers.authorization;
    response.end("redirected");
  });
  const source = await listen((_request, response) => {
    response.statusCode = 302;
    response.setHeader(
      "location",
      `http://second.invalid:${target.port}/target`
    );
    response.end();
  });
  try {
    const resolver = {
      resolve: async (input: { destination: string | URL }) =>
        destination(new URL(input.destination)),
      resolveRedirect: async (input: {
        from: OutboundDestination;
        location: string;
      }) => {
        const next = destination(new URL(input.location, input.from.url));
        return { destination: next, originChanged: true };
      }
    } as Pick<OutboundPolicy, "resolve" | "resolveRedirect">;
    const credential: OutboundCredential = {
      binding: {
        credentialId: "credential",
        providerKind: "synthetic",
        ownerId: "owner",
        installationId: "installation",
        scheme: "https:",
        host: "first.invalid",
        port: source.port,
        pathPrefix: "/",
        audience: principal.audience,
        version: 1,
        detachedAt: null
      },
      providerKind: "synthetic",
      audience: principal.audience,
      headerName: "authorization",
      headerValue: "Bearer sentinel"
    };
    const broker = new OutboundRequestBroker(resolver);
    const response = await broker.request({
      destination: `http://first.invalid:${source.port}/start`,
      principal,
      installationId: "installation",
      credential,
      maximumResponseBytes: 128,
      timeoutMilliseconds: 2_000
    });
    assert.equal(response.body.toString("utf8"), "redirected");
    assert.equal(redirectedAuthorization, undefined);
  } finally {
    await close(source.server);
    await close(target.server);
  }
});

test("broker rejects caller-supplied credential headers before making a request", async () => {
  let requestCount = 0;
  const fixture = await listen((_request, response) => {
    requestCount += 1;
    response.end("unexpected");
  });
  try {
    const resolver = {
      resolve: async (input: { destination: string | URL }) =>
        destination(new URL(input.destination)),
      resolveRedirect: async () => {
        throw new Error("unexpected redirect");
      }
    } as Pick<OutboundPolicy, "resolve" | "resolveRedirect">;
    const broker = new OutboundRequestBroker(resolver);
    for (const headerName of [
      "Authorization",
      "cookie",
      "Proxy-Authorization"
    ]) {
      await assert.rejects(
        broker.request({
          destination: `http://fixture.invalid:${fixture.port}/`,
          principal,
          installationId: "installation",
          headers: { [headerName]: "sentinel" },
          maximumResponseBytes: 128,
          timeoutMilliseconds: 2_000
        }),
        /reserved/
      );
    }
    assert.equal(requestCount, 0);
  } finally {
    await close(fixture.server);
  }
});
