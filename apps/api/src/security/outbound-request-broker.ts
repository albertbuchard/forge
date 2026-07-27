import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

import type { ForgePrincipal } from "./contracts.js";
import {
  OutboundPolicyError,
  credentialBindingAllows,
  headersForRedirect,
  type CredentialDestinationBinding,
  type OutboundDestination,
  type OutboundPolicy,
  type PrivateDestinationGrant
} from "./outbound-policy.js";

type OutboundResolver = Pick<OutboundPolicy, "resolve" | "resolveRedirect">;

const RESERVED_CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization"
]);

export type OutboundCredential = {
  binding: CredentialDestinationBinding;
  providerKind: string;
  audience: string;
  headerName: "authorization";
  headerValue: string;
};

export type OutboundBrokerResponse = {
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[]>>;
  body: Buffer;
  finalUrl: string;
  redirectCount: number;
};

function normalizedAddress(address: string | undefined) {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function responseHeaders(headers: http.IncomingHttpHeaders) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, value]]
      )
    )
  );
}

export class OutboundRequestBroker {
  constructor(private readonly policy: OutboundResolver) {}

  async request(input: {
    destination: string | URL;
    principal: ForgePrincipal;
    installationId: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: Uint8Array;
    privateDestinationGrant?: PrivateDestinationGrant | null;
    credential?: OutboundCredential | null;
    maximumResponseBytes: number;
    timeoutMilliseconds: number;
    maximumRedirects?: number;
  }): Promise<OutboundBrokerResponse> {
    if (
      !Number.isSafeInteger(input.maximumResponseBytes) ||
      input.maximumResponseBytes < 1 ||
      input.maximumResponseBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(input.timeoutMilliseconds) ||
      input.timeoutMilliseconds < 1 ||
      input.timeoutMilliseconds > 10 * 60 * 1_000
    ) {
      throw new OutboundPolicyError(
        "Outbound response or timeout bounds are invalid."
      );
    }
    const maximumRedirects = input.maximumRedirects ?? 5;
    if (
      !Number.isSafeInteger(maximumRedirects) ||
      maximumRedirects < 0 ||
      maximumRedirects > 10
    ) {
      throw new OutboundPolicyError("Outbound redirect bounds are invalid.");
    }
    for (const headerName of Object.keys(input.headers ?? {})) {
      if (RESERVED_CREDENTIAL_HEADERS.has(headerName.toLowerCase())) {
        throw new OutboundPolicyError(
          `Outbound callers cannot set the reserved ${headerName.toLowerCase()} header.`
        );
      }
    }
    let destination = await this.policy.resolve({
      destination: input.destination,
      principal: input.principal,
      installationId: input.installationId,
      privateDestinationGrant: input.privateDestinationGrant
    });
    let method = (input.method ?? "GET").toUpperCase();
    let body = input.body ? Buffer.from(input.body) : null;
    let headers = { ...(input.headers ?? {}) };

    for (let redirectCount = 0; ; redirectCount += 1) {
      const requestHeaders = { ...headers };
      if (
        input.credential &&
        credentialBindingAllows({
          binding: input.credential.binding,
          providerKind: input.credential.providerKind,
          principal: input.principal,
          installationId: input.installationId,
          audience: input.credential.audience,
          destination
        })
      ) {
        requestHeaders[input.credential.headerName] =
          input.credential.headerValue;
      }
      const response = await this.requestPinned({
        destination,
        method,
        headers: requestHeaders,
        body,
        maximumResponseBytes: input.maximumResponseBytes,
        timeoutMilliseconds: input.timeoutMilliseconds
      });
      const location =
        typeof response.headers.location === "string"
          ? response.headers.location
          : null;
      if (
        !location ||
        ![301, 302, 303, 307, 308].includes(response.statusCode)
      ) {
        return {
          ...response,
          finalUrl: destination.url.toString(),
          redirectCount
        };
      }
      if (redirectCount >= maximumRedirects) {
        throw new OutboundPolicyError(
          "The outbound request exceeded its redirect limit."
        );
      }
      const redirected = await this.policy.resolveRedirect({
        from: destination,
        location,
        principal: input.principal,
        installationId: input.installationId,
        privateDestinationGrant: input.privateDestinationGrant
      });
      headers = headersForRedirect(headers, redirected.originChanged);
      destination = redirected.destination;
      if (
        response.statusCode === 303 ||
        ((response.statusCode === 301 || response.statusCode === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = null;
        delete headers["content-length"];
        delete headers["Content-Length"];
      }
    }
  }

  private requestPinned(input: {
    destination: OutboundDestination;
    method: string;
    headers: Readonly<Record<string, string>>;
    body: Buffer | null;
    maximumResponseBytes: number;
    timeoutMilliseconds: number;
  }) {
    return new Promise<
      Omit<OutboundBrokerResponse, "finalUrl" | "redirectCount">
    >((resolve, reject) => {
      const url = input.destination.url;
      const transport = url.protocol === "https:" ? https : http;
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        const selected = input.destination.selectedAddress;
        if (options.all) {
          callback(null, [
            { address: selected.address, family: selected.family }
          ]);
          return;
        }
        callback(null, selected.address, selected.family);
      };
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: input.method,
          headers: {
            ...input.headers,
            host: url.host
          },
          ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
          lookup: pinnedLookup,
          agent: false
        },
        (response) => {
          const peer = normalizedAddress(response.socket.remoteAddress);
          const expected = normalizedAddress(
            input.destination.selectedAddress.address
          );
          if (
            peer !== expected &&
            !(
              isIP(peer) === 6 &&
              isIP(expected) === 6 &&
              peer.toLowerCase() === expected.toLowerCase()
            )
          ) {
            response.destroy(
              new OutboundPolicyError(
                "The outbound socket did not use the policy-pinned address."
              )
            );
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.byteLength;
            if (received > input.maximumResponseBytes) {
              response.destroy(
                new OutboundPolicyError(
                  "The outbound response exceeded its byte limit."
                )
              );
              return;
            }
            chunks.push(chunk);
          });
          response.once("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: responseHeaders(response.headers),
              body: Buffer.concat(chunks)
            });
          });
          response.once("error", reject);
        }
      );
      request.setTimeout(input.timeoutMilliseconds, () => {
        request.destroy(
          new OutboundPolicyError("The outbound request timed out.")
        );
      });
      request.once("error", reject);
      if (input.body) request.write(input.body);
      request.end();
    });
  }
}
