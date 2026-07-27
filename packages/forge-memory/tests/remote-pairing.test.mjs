import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  pairRemoteForgeClient,
  storeMacosRemoteCredential
} from "../lib/remote-pairing.mjs";

test(
  "remote pairing uses one explicit approval and stores only the renewable credential through the injected secure store",
  { skip: process.platform !== "darwin" },
  async () => {
    const calls = [];
    let stored = null;
    let code = null;
    const result = await pairRemoteForgeClient({
      baseUrl: "https://forge.example.test",
      clientName: "Forge Codex",
      scopes: ["read", "write"],
      profile: "trusted_personal_assistant",
      wait: async (milliseconds) => {
        assert.ok(milliseconds >= 5_000);
      },
      onPairingCode: async (value) => {
        code = value.userCode;
      },
      storeCredential: (credential) => {
        stored = credential;
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        if (calls.length === 1) {
          return new Response(
            JSON.stringify({
              requestId: "pair_1234567890abcdef",
              deviceCode: `fg_device_${"A".repeat(43)}`,
              userCode: "BCDF-GHJK",
              expiresIn: 600,
              interval: 5
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        }
        return new Response(
          JSON.stringify({
            tokenType: "DPoP",
            accessToken: "eyJ.test.signature",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            refreshToken: `fg_refresh_${"B".repeat(43)}`,
            clientId: "client_1234567890abcdef",
            audience: "urn:forge:test:api",
            scopes: ["read", "write"],
            profile: "trusted_personal_assistant"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    });
    assert.equal(code, "BCDF-GHJK");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.clientType, "api");
    assert.equal(calls[1].body.grantType, "device_code");
    assert.equal(
      calls[1].body.clientProof.split(".").length,
      3,
      "the poll must be proof-bound"
    );
    assert.equal(result.clientId, "client_1234567890abcdef");
    assert.ok(stored);
    assert.equal(stored.endpoint, "https://forge.example.test");
    assert.equal(stored.refreshToken, `fg_refresh_${"B".repeat(43)}`);
    assert.equal(typeof stored.privateJwk.d, "string");
    assert.equal(
      JSON.stringify(result).includes(stored.refreshToken),
      false,
      "the caller receives only the non-secret credential identifier"
    );
  }
);

test(
  "macOS Keychain storage accepts credential bytes through security stdin",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-pair-keychain-"));
    const keychainPath = path.join(root, "test.keychain-db");
    const created = spawnSync(
      "/usr/bin/security",
      ["create-keychain", "-p", "synthetic-password", keychainPath],
      { encoding: "utf8" }
    );
    assert.equal(created.status, 0, created.stderr);
    const credential = {
      schemaVersion: 1,
      credentialId: "forge-client-1234567890abcdef",
      endpoint: "https://forge.example.test",
      audience: "urn:forge:test:api",
      clientId: "client_1234567890abcdef",
      keyThumbprint: "A".repeat(43),
      privateJwk: {
        kty: "EC",
        crv: "P-256",
        x: "A".repeat(43),
        y: "B".repeat(43),
        d: "C".repeat(43)
      },
      refreshToken: `fg_refresh_${"D".repeat(43)}`,
      scopes: ["read"],
      profile: "viewer",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      storeMacosRemoteCredential(credential, keychainPath);
      const read = spawnSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-a",
          credential.credentialId,
          "-s",
          "dev.albertbuchard.forge.remote-client",
          "-w",
          keychainPath
        ],
        { encoding: "utf8" }
      );
      assert.equal(read.status, 0, read.stderr);
      assert.deepEqual(JSON.parse(read.stdout), credential);
    } finally {
      spawnSync("/usr/bin/security", ["delete-keychain", keychainPath], {
        stdio: "ignore"
      });
      await rm(root, { recursive: true, force: true });
    }
  }
);
