import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const KEYCHAIN_SERVICE = "dev.albertbuchard.forge.remote-client";
const CREDENTIAL_ID = /^forge-client-[A-Za-z0-9_-]{16,160}$/;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function requireMacosKeychain() {
  if (process.platform !== "darwin") {
    throw new Error(
      "Secure renewable remote pairing currently requires macOS Keychain. Windows support is delivered by the separate Windows owner-authentication stream."
    );
  }
}

function runSecurity(args, input) {
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
    timeout: 10_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Forge could not store its renewable credential in macOS Keychain."
    );
  }
}

export function readMacosRemoteCredential(credentialId) {
  requireMacosKeychain();
  if (!CREDENTIAL_ID.test(credentialId)) {
    return null;
  }
  const result = spawnSync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-a",
      credentialId,
      "-s",
      KEYCHAIN_SERVICE,
      "-w"
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    }
  );
  if (result.error || result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed?.schemaVersion === 1 &&
      parsed.credentialId === credentialId &&
      new URL(parsed.endpoint).origin === parsed.endpoint
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function storeMacosRemoteCredential(credential, keychainPath) {
  requireMacosKeychain();
  if (
    credential?.schemaVersion !== 1 ||
    !CREDENTIAL_ID.test(credential.credentialId) ||
    new URL(credential.endpoint).origin !== credential.endpoint ||
    new URL(credential.endpoint).protocol !== "https:" ||
    typeof credential.privateJwk?.d !== "string" ||
    !/^fg_refresh_[A-Za-z0-9_-]{43,128}$/.test(credential.refreshToken)
  ) {
    throw new Error("Forge refused to store an invalid remote credential.");
  }
  if (
    keychainPath !== undefined &&
    !/^\/[A-Za-z0-9._/-]{1,1024}$/.test(keychainPath)
  ) {
    throw new Error("Forge test Keychain path is invalid.");
  }
  const encoded = Buffer.from(JSON.stringify(credential), "utf8").toString(
    "hex"
  );
  runSecurity(
    ["-i"],
    [
      "add-generic-password",
      "-a",
      credential.credentialId,
      "-s",
      KEYCHAIN_SERVICE,
      "-U",
      "-X",
      encoded,
      ...(keychainPath ? [keychainPath] : [])
    ].join(" ") + "\n"
  );
  return credential.credentialId;
}

async function keyThumbprint(publicJwk) {
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y
  });
  return encodeBase64Url(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical)
    )
  );
}

async function pairingProof(input) {
  const encodedHeader = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        alg: "ES256",
        typ: "forge-pairing+jwt",
        jwk: input.publicJwk
      })
    )
  );
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        request_id: input.requestId,
        operation: "poll",
        iat: Math.floor(Date.now() / 1_000),
        jti: `forge-pair-${randomUUID()}`
      })
    )
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    input.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Forge returned invalid JSON while ${context}.`);
  }
  return body;
}

export async function pairRemoteForgeClient(input) {
  requireMacosKeychain();
  const endpoint = new URL(input.baseUrl).origin;
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Remote Forge pairing requires an exact HTTPS endpoint without embedded credentials."
    );
  }
  const keys = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey(
    "jwk",
    keys.publicKey
  );
  const privateJwk = await globalThis.crypto.subtle.exportKey(
    "jwk",
    keys.privateKey
  );
  const thumbprint = await keyThumbprint(publicJwk);
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait =
    input.wait ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const storeCredential =
    input.storeCredential ?? storeMacosRemoteCredential;
  const startedResponse = await fetchImpl(
    new URL("/api/v1/auth/device", `${endpoint}/`),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientName: input.clientName,
        clientType: "api",
        clientKeyThumbprint: thumbprint,
        requestedScopes: input.scopes,
        requestedProfile: input.profile
      }),
      signal: input.signal
    }
  );
  const started = await readJsonResponse(
    startedResponse,
    "starting remote pairing"
  );
  if (
    !startedResponse.ok ||
    typeof started.requestId !== "string" ||
    typeof started.deviceCode !== "string" ||
    typeof started.userCode !== "string" ||
    typeof started.expiresIn !== "number" ||
    typeof started.interval !== "number"
  ) {
    throw new Error("Forge rejected the remote pairing request.");
  }
  await input.onPairingCode?.({
    userCode: started.userCode,
    endpoint,
    expiresIn: started.expiresIn
  });

  const deadline = Date.now() + started.expiresIn * 1_000;
  let intervalMs = Math.max(5_000, started.interval * 1_000);
  while (Date.now() < deadline) {
    await wait(intervalMs);
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new Error("Pairing cancelled.");
    }
    const response = await fetchImpl(
      new URL("/api/v1/auth/token", `${endpoint}/`),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          grantType: "device_code",
          deviceCode: started.deviceCode,
          clientProof: await pairingProof({
            requestId: started.requestId,
            publicJwk,
            privateKey: keys.privateKey
          })
        }),
        signal: input.signal
      }
    );
    const body = await readJsonResponse(response, "polling remote pairing");
    if (response.ok) {
      if (
        body.tokenType !== "DPoP" ||
        typeof body.refreshToken !== "string" ||
        typeof body.clientId !== "string"
      ) {
        throw new Error(
          "Forge returned an invalid sender-constrained client registration."
        );
      }
      const now = new Date().toISOString();
      const credentialId = `forge-client-${randomUUID()}`;
      storeCredential({
        schemaVersion: 1,
        credentialId,
        endpoint,
        audience:
          typeof body.audience === "string"
            ? body.audience
            : input.audience,
        clientId: body.clientId,
        keyThumbprint: thumbprint,
        privateJwk,
        refreshToken: body.refreshToken,
        scopes: Array.isArray(body.scopes) ? body.scopes : input.scopes,
        profile:
          typeof body.profile === "string" ? body.profile : input.profile,
        createdAt: now,
        updatedAt: now
      });
      return {
        credentialId,
        clientId: body.clientId,
        scopes: Array.isArray(body.scopes) ? body.scopes : input.scopes,
        profile:
          typeof body.profile === "string" ? body.profile : input.profile
      };
    }
    if (body.status === "slow_down") {
      intervalMs = Math.max(
        intervalMs + 5_000,
        Number(body.intervalSeconds || 0) * 1_000
      );
      continue;
    }
    if (body.status === "authorization_pending") {
      intervalMs = Math.max(
        intervalMs,
        Number(body.intervalSeconds || 0) * 1_000
      );
      continue;
    }
    if (body.status === "access_denied") {
      throw new Error("The Forge owner denied this pairing request.");
    }
    if (body.status === "expired_token") {
      break;
    }
    throw new Error("Forge rejected the remote pairing exchange.");
  }
  throw new Error(
    "Forge remote pairing expired. Rerun the installer to start a new explicit request."
  );
}

export function forgeRemoteCredentialFingerprint(credentialId) {
  return createHash("sha256")
    .update(credentialId, "utf8")
    .digest("hex")
    .slice(0, 12);
}
