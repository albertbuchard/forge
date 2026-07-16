import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPinnedMailboxResponseAddress,
  isPublicPeerProviderAddress,
  validatePeerEndpointDescriptor
} from "./peer-endpoints.js";

function encodeUnpaddedBase32(value: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let accumulator = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += alphabet[(accumulator >>> bitCount) & 31];
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) {
    encoded += alphabet[(accumulator << (5 - bitCount)) & 31];
  }
  return encoded;
}

function validOnionV3Host(): string {
  const publicKey = Buffer.alloc(32, 7);
  const version = Buffer.from([3]);
  const checksum = createHash("sha3-256")
    .update(Buffer.from(".onion checksum", "ascii"))
    .update(publicKey)
    .update(version)
    .digest()
    .subarray(0, 2);
  return `${encodeUnpaddedBase32(
    Buffer.concat([publicKey, checksum, version])
  )}.onion`;
}

test("peer-advertised mailbox URLs are rejected", () => {
  assert.throws(
    () =>
      validatePeerEndpointDescriptor(
        {
          kind: "http_mailbox",
          baseUrl: "https://mailbox.example/",
          providerId: "example"
        },
        { trustSource: "peer_advertised" }
      ),
    /cannot choose/
  );
});

test("operator mailbox origins reject credentials, paths, and non-HTTPS schemes", () => {
  for (const baseUrl of [
    "http://mailbox.example/",
    "https://user:password@mailbox.example/",
    "https://mailbox.example/private",
    "https://mailbox.example/?channel=secret"
  ]) {
    assert.throws(() =>
      validatePeerEndpointDescriptor(
        { kind: "http_mailbox", baseUrl, providerId: "example" },
        { trustSource: "operator_configured" }
      )
    );
  }
});

test("public provider address classification rejects private and metadata ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "2001:db8::1"
  ]) {
    assert.equal(isPublicPeerProviderAddress(address), false, address);
  }
  assert.equal(isPublicPeerProviderAddress("1.1.1.1"), true);
  assert.equal(isPublicPeerProviderAddress("2606:4700:4700::1111"), true);
});

test("mailbox response address must remain pinned", () => {
  assert.doesNotThrow(() =>
    assertPinnedMailboxResponseAddress("1.1.1.1", ["1.1.1.1", "1.0.0.1"])
  );
  assert.throws(
    () => assertPinnedMailboxResponseAddress("8.8.8.8", ["1.1.1.1"]),
    /changed/
  );
  assert.doesNotThrow(() =>
    assertPinnedMailboxResponseAddress("2606:4700:4700::1111", [
      "2606:4700:4700:0:0:0:0:1111"
    ])
  );
});

test("onion descriptors require a checksum-valid version 3 hostname", () => {
  assert.throws(() =>
    validatePeerEndpointDescriptor(
      {
        kind: "tor_onion",
        onionHost: "short.onion",
        port: 443,
        deviceId: "remote_phone"
      },
      { trustSource: "peer_advertised" }
    )
  );
  assert.throws(() =>
    validatePeerEndpointDescriptor(
      {
        kind: "tor_onion",
        onionHost: `${"a".repeat(56)}.onion`,
        port: 443,
        deviceId: "remote_phone"
      },
      { trustSource: "peer_advertised" }
    )
  );
  assert.equal(
    validatePeerEndpointDescriptor(
      {
        kind: "tor_onion",
        onionHost: validOnionV3Host(),
        port: 443,
        deviceId: "remote_phone"
      },
      { trustSource: "peer_advertised" }
    ).kind,
    "tor_onion"
  );
});

test("Iroh relay descriptors accept only unique credential-free HTTPS origins", () => {
  const base = {
    kind: "iroh" as const,
    endpointId: "a".repeat(64),
    deviceId: "remote_phone"
  };
  for (const relayUrls of [
    ["http://relay.example/"],
    ["https://user:password@relay.example/"],
    ["https://relay.example/path"],
    ["https://relay.example:444/"],
    ["https://relay.example/", "https://relay.example"]
  ]) {
    assert.throws(() =>
      validatePeerEndpointDescriptor(
        { ...base, relayUrls },
        { trustSource: "peer_advertised" }
      )
    );
  }
  assert.deepEqual(
    validatePeerEndpointDescriptor(
      { ...base, relayUrls: ["https://relay.example/"] },
      { trustSource: "peer_advertised" }
    ),
    { ...base, relayUrls: ["https://relay.example/"] }
  );
});
