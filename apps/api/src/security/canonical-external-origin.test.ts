import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { FastifyRequest } from "fastify";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair
} from "jose";

import {
  classifyLegacyTokenTransport,
  exactApplicationSecurityTargetUri,
  resolveCanonicalExternalOrigin
} from "./application-security-runtime.js";
import { DpopVerifier } from "./dpop.js";

function request(input: {
  host: string;
  url: string;
  encrypted?: boolean;
  extraHeaders?: Record<string, string>;
  remoteAddress?: string;
}) {
  return {
    headers: {
      host: input.host,
      ...input.extraHeaders
    },
    raw: {
      url: input.url,
      socket: {
        encrypted: input.encrypted ?? false,
        remoteAddress: input.remoteAddress
      }
    },
    url: input.url
  } as unknown as FastifyRequest;
}

test("trusted external HTTPS origin preserves DPoP target parity through an HTTPS-to-HTTP proxy", async () => {
  const externalOrigin = resolveCanonicalExternalOrigin(
    "https://forge-device.example.ts.net"
  );
  const reconstructedTarget = exactApplicationSecurityTargetUri(
    request({
      host: "forge-device.example.ts.net",
      url: "/api/v1/context?view=summary",
      extraHeaders: {
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "http"
      }
    }),
    externalOrigin
  );
  assert.equal(
    reconstructedTarget,
    "https://forge-device.example.ts.net/api/v1/context?view=summary"
  );

  const credential = "synthetic-access-token";
  const key = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(key.publicKey);
  const thumbprint = await calculateJwkThumbprint(publicJwk);
  const now = new Date("2026-07-26T12:00:00.000Z");
  const proof = await new SignJWT({
    htm: "GET",
    htu: "https://forge-device.example.ts.net/api/v1/context",
    ath: createHash("sha256").update(credential, "ascii").digest("base64url")
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: publicJwk
    })
    .setJti("serve-parity-proof")
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .sign(key.privateKey);
  const verifier = new DpopVerifier({ now: () => now }, { claim: () => true });
  await verifier.verify({
    proof,
    accessToken: credential,
    expectedMethod: "GET",
    expectedTargetUri: reconstructedTarget,
    expectedKeyThumbprint: thumbprint
  });
});

test("legacy migration transport is direct-loopback only and proxy-reached requests remain remote", () => {
  const externalOrigin = "https://forge-device.example.ts.net";
  assert.equal(
    classifyLegacyTokenTransport(
      request({
        host: "127.0.0.1:4317",
        url: "/api/v1/context",
        remoteAddress: "127.0.0.1"
      }),
      externalOrigin
    ),
    "direct_loopback"
  );
  assert.equal(
    classifyLegacyTokenTransport(
      request({
        host: "forge-device.example.ts.net",
        url: "/api/v1/context",
        remoteAddress: "127.0.0.1",
        extraHeaders: {
          "x-forwarded-for": "100.64.10.20",
          "x-forwarded-proto": "https"
        }
      }),
      externalOrigin
    ),
    "other_network"
  );
  for (const candidate of [
    request({
      host: "forge-device.example.ts.net",
      url: "/api/v1/context",
      remoteAddress: "100.64.10.20",
      extraHeaders: { "x-forwarded-proto": "https" }
    }),
    request({
      host: "attacker.example",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      extraHeaders: {
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-proto": "https"
      }
    }),
    request({
      host: "forge-device.example.ts.net",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      extraHeaders: {
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-proto": "http"
      }
    })
  ]) {
    assert.equal(
      classifyLegacyTokenTransport(candidate, externalOrigin),
      "other_network"
    );
  }
});

test("forwarding headers cannot select or spoof the trusted external target", async () => {
  const externalOrigin = resolveCanonicalExternalOrigin(
    "https://forge-device.example.ts.net"
  );
  assert.equal(
    exactApplicationSecurityTargetUri(
      request({
        host: "127.0.0.1:4317",
        url: "/api/v1/context",
        extraHeaders: {
          forwarded:
            "for=100.64.10.20;host=forge-device.example.ts.net;proto=https",
          "x-forwarded-host": "forge-device.example.ts.net",
          "x-forwarded-proto": "https"
        }
      }),
      externalOrigin
    ),
    "http://127.0.0.1:4317/api/v1/context"
  );

  const credential = "synthetic-access-token";
  const key = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(key.publicKey);
  const now = new Date("2026-07-26T12:00:00.000Z");
  const forgedProof = await new SignJWT({
    htm: "GET",
    htu: "https://forge-device.example.ts.net/api/v1/context",
    ath: createHash("sha256").update(credential, "ascii").digest("base64url")
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: publicJwk
    })
    .setJti("forwarded-header-spoof")
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .sign(key.privateKey);
  await assert.rejects(
    new DpopVerifier({ now: () => now }, { claim: () => true }).verify({
      proof: forgedProof,
      accessToken: credential,
      expectedMethod: "GET",
      expectedTargetUri: "http://127.0.0.1:4317/api/v1/context",
      expectedKeyThumbprint: await calculateJwkThumbprint(publicJwk)
    }),
    /claims do not match/
  );
});

test("external origin configuration rejects non-HTTPS and non-origin values", () => {
  for (const value of [
    "http://forge.example.ts.net",
    "https://user:secret@forge.example.ts.net",
    "https://forge.example.ts.net/forge/",
    "https://forge.example.ts.net?target=api",
    "https://forge.example.ts.net/#fragment"
  ]) {
    assert.throws(
      () => resolveCanonicalExternalOrigin(value),
      /FORGE_CANONICAL_EXTERNAL_ORIGIN/
    );
  }
});
