import { createHash, createHmac, randomUUID } from "node:crypto";
import type { InjectOptions } from "light-my-request";

import type { buildServer } from "../app.js";
import {
  canonicalMobileRequest,
  MOBILE_REQUEST_PROTOCOL
} from "./mobile-companion-request.js";

type TestServer = Awaited<ReturnType<typeof buildServer>>;

export function installTestMobilePairingAuthority(
  app: TestServer,
  pairing: { sessionId: string; pairingToken: string }
) {
  const inject = app.inject.bind(app);
  app.inject = ((request: string | InjectOptions) => {
    if (typeof request === "string") return inject(request);
    const requestUrl =
      typeof request.url === "string"
        ? request.url
        : request.url?.pathname ?? "";
    if (
      !requestUrl.startsWith("/api/v1/mobile/") ||
      requestUrl === "/api/v1/mobile/pairing/verify"
    ) {
      return inject(request);
    }
    const headers = Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        String(value)
      ])
    );
    if (headers["x-forge-mobile-request-protocol"]) {
      return inject({ ...request, headers });
    }
    const serializedPayload =
      request.payload === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(request.payload)
          ? request.payload
          : Buffer.from(
              typeof request.payload === "string"
                ? request.payload
                : JSON.stringify(request.payload),
              "utf8"
            );
    const bodySha256 = createHash("sha256")
      .update(serializedPayload)
      .digest("hex");
    const issuedAt = new Date().toISOString();
    const nonce = randomUUID().replaceAll("-", "");
    headers["x-forge-mobile-request-protocol"] = MOBILE_REQUEST_PROTOCOL;
    headers["x-forge-mobile-session-id"] = pairing.sessionId;
    headers["x-forge-mobile-request-issued-at"] = issuedAt;
    headers["x-forge-mobile-request-nonce"] = nonce;
    headers["x-forge-mobile-body-sha256"] = bodySha256;
    headers["x-forge-mobile-request-signature"] = createHmac(
      "sha256",
      pairing.pairingToken
    )
      .update(
        canonicalMobileRequest({
          method: String(request.method ?? "GET"),
          path: requestUrl,
          sessionId: pairing.sessionId,
          issuedAt,
          nonce,
          bodySha256
        }),
        "utf8"
      )
      .digest("hex");
    return inject({ ...request, headers });
  }) as typeof app.inject;
}
