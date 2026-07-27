// @vitest-environment node

import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:https";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { test } from "vitest";

import {
  deleteForgeRemoteCredential,
  forgeRemoteAuthorization,
  readForgeRemoteCredential,
  writeForgeRemoteCredential,
  type StoredForgeRemoteCredential
} from "./remote-client-credential.js";

function waitForChild(
  child: ReturnType<typeof spawn>
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `child exited with code ${code} signal ${signal ?? "none"}: ${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test(
  "macOS remote credentials round-trip through an isolated Keychain without entering config files",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "forge-remote-keychain-")
    );
    const keychainPath = path.join(root, "test.keychain-db");
    const password = "synthetic-keychain-password";
    const created = spawnSync(
      "/usr/bin/security",
      ["create-keychain", "-p", password, keychainPath],
      { encoding: "utf8" }
    );
    assert.equal(created.status, 0, created.stderr);
    const now = new Date().toISOString();
    const keyPair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(keyPair.privateKey);
    const publicJwk = await exportJWK(keyPair.publicKey);
    const credential: StoredForgeRemoteCredential = {
      schemaVersion: 1,
      credentialId: "forge-client-1234567890abcdef",
      endpoint: "https://forge.test.invalid",
      audience: "urn:forge:test:api",
      clientId: "client_1234567890abcdef",
      keyThumbprint: await calculateJwkThumbprint(publicJwk),
      privateJwk,
      refreshToken: `fg_refresh_${"D".repeat(43)}`,
      scopes: ["read"],
      profile: "viewer",
      createdAt: now,
      updatedAt: now
    };
    try {
      writeForgeRemoteCredential(credential, keychainPath);
      assert.deepEqual(
        readForgeRemoteCredential(credential.credentialId, keychainPath),
        credential
      );
      const originalFetch = globalThis.fetch;
      let refreshCalls = 0;
      globalThis.fetch = async (_url, init) => {
        refreshCalls += 1;
        assert.equal(init?.method, "POST");
        assert.equal(
          typeof (init?.headers as Record<string, string>).dpop,
          "string"
        );
        return new Response(
          JSON.stringify({
            tokenType: "DPoP",
            accessToken: `eyJ${"E".repeat(80)}`,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            refreshToken: `fg_refresh_${"F".repeat(43)}`,
            clientId: credential.clientId,
            audience: credential.audience,
            scopes: credential.scopes,
            profile: credential.profile
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      };
      try {
        const [first, second] = await Promise.all([
          forgeRemoteAuthorization({
            credentialId: credential.credentialId,
            baseUrl: credential.endpoint,
            method: "GET",
            targetUri: `${credential.endpoint}/api/v1/context`,
            timeoutMs: 5_000,
            keychainPath
          }),
          forgeRemoteAuthorization({
            credentialId: credential.credentialId,
            baseUrl: credential.endpoint,
            method: "GET",
            targetUri: `${credential.endpoint}/api/v1/context`,
            timeoutMs: 5_000,
            keychainPath
          })
        ]);
        assert.equal(refreshCalls, 1);
        assert.match(first.authorization, /^DPoP eyJ/);
        assert.equal(first.dpop.split(".").length, 3);
        assert.equal(second.authorization, first.authorization);
        assert.equal(
          readForgeRemoteCredential(credential.credentialId, keychainPath)
            .refreshToken,
          `fg_refresh_${"F".repeat(43)}`
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
      deleteForgeRemoteCredential(credential.credentialId, keychainPath);
      assert.throws(
        () => readForgeRemoteCredential(credential.credentialId, keychainPath),
        /could not access/
      );
    } finally {
      spawnSync("/usr/bin/security", ["delete-keychain", keychainPath], {
        stdio: "ignore"
      });
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "separate macOS client processes serialize refresh rotation through Keychain",
  { skip: process.platform !== "darwin", timeout: 30_000 },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "forge-remote-process-lock-")
    );
    const keychainPath = path.join(root, "test.keychain-db");
    const password = "synthetic-process-keychain-password";
    const certPath = path.join(root, "localhost.crt");
    const keyPath = path.join(root, "localhost.key");
    const created = spawnSync(
      "/usr/bin/security",
      ["create-keychain", "-p", password, keychainPath],
      { encoding: "utf8" }
    );
    assert.equal(created.status, 0, created.stderr);
    const certificate = spawnSync(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        keyPath,
        "-out",
        certPath
      ],
      { encoding: "utf8" }
    );
    assert.equal(certificate.status, 0, certificate.stderr);

    const now = new Date().toISOString();
    const keyPair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(keyPair.privateKey);
    const publicJwk = await exportJWK(keyPair.publicKey);
    const initialRefreshToken = `fg_refresh_${"G".repeat(43)}`;
    const credential: StoredForgeRemoteCredential = {
      schemaVersion: 1,
      credentialId: "forge-client-process123456789",
      endpoint: "https://127.0.0.1",
      audience: "urn:forge:test:api",
      clientId: "client_process123456789",
      keyThumbprint: await calculateJwkThumbprint(publicJwk),
      privateJwk,
      refreshToken: initialRefreshToken,
      scopes: ["read"],
      profile: "viewer",
      createdAt: now,
      updatedAt: now
    };
    let server: ReturnType<typeof createServer> | undefined;
    try {
      server = createServer(
        {
          cert: await readFile(certPath),
          key: await readFile(keyPath)
        },
        (request, response) => {
          let raw = "";
          request.setEncoding("utf8");
          request.on("data", (chunk) => {
            raw += chunk;
          });
          request.on("end", async () => {
            const body = JSON.parse(raw) as { refreshToken?: string };
            receivedRefreshTokens.push(body.refreshToken ?? "");
            if (body.refreshToken !== currentRefreshToken) {
              reuseDetected = true;
              response.writeHead(401, { "content-type": "application/json" });
              response.end(JSON.stringify({ error: "refresh_reuse" }));
              return;
            }
            if (receivedRefreshTokens.length === 1) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            rotation += 1;
            currentRefreshToken = `fg_refresh_${String.fromCharCode(
              "G".charCodeAt(0) + rotation
            ).repeat(43)}`;
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                tokenType: "DPoP",
                accessToken: `eyJ${String(rotation).repeat(80)}`,
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
                refreshToken: currentRefreshToken
              })
            );
          });
        }
      );
      const receivedRefreshTokens: string[] = [];
      let currentRefreshToken = initialRefreshToken;
      let rotation = 0;
      let reuseDetected = false;
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      credential.endpoint = `https://127.0.0.1:${address.port}`;
      writeForgeRemoteCredential(credential, keychainPath);

      const moduleUrl = new URL(
        "./remote-client-credential.ts",
        import.meta.url
      ).href;
      const childProgram = `
        import { forgeRemoteAuthorization } from ${JSON.stringify(moduleUrl)};
        const result = await forgeRemoteAuthorization({
          credentialId: ${JSON.stringify(credential.credentialId)},
          baseUrl: ${JSON.stringify(credential.endpoint)},
          method: "GET",
          targetUri: ${JSON.stringify(`${credential.endpoint}/api/v1/context`)},
          timeoutMs: 5000,
          keychainPath: ${JSON.stringify(keychainPath)}
        });
        process.stdout.write(result.authorization);
      `;
      const childOptions: SpawnOptions = {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: certPath
        },
        stdio: ["ignore", "pipe", "pipe"]
      };
      const first = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", childProgram],
        childOptions
      );
      const second = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", childProgram],
        childOptions
      );
      const results = await Promise.all([
        waitForChild(first),
        waitForChild(second)
      ]);

      assert.equal(reuseDetected, false);
      assert.deepEqual(receivedRefreshTokens, [
        initialRefreshToken,
        `fg_refresh_${"H".repeat(43)}`
      ]);
      assert.equal(rotation, 2);
      assert.ok(results.every(({ stdout }) => stdout.startsWith("DPoP eyJ")));
      assert.equal(
        readForgeRemoteCredential(credential.credentialId, keychainPath)
          .refreshToken,
        `fg_refresh_${"I".repeat(43)}`
      );
      deleteForgeRemoteCredential(credential.credentialId, keychainPath);
    } finally {
      await new Promise<void>(
        (resolve) => server?.close(() => resolve()) ?? resolve()
      );
      spawnSync("/usr/bin/security", ["delete-keychain", keychainPath], {
        stdio: "ignore"
      });
      await rm(root, { recursive: true, force: true });
    }
  }
);
