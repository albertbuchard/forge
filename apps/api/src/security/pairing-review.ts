import { createHash } from "node:crypto";

import type { PairingRequest } from "./pairing-service.js";

export type PairingReviewBoundaries = {
  resources: {
    profile: string;
    scopes: readonly string[];
    enforcement: "profile_scopes_and_route_policy";
  };
  egress: {
    requestedScopes: readonly string[];
    enforcement: "capability_policy_and_destination_validation";
    default: "denied_unless_capability_explicitly_allows";
  };
};

export type ServerPairingReview = {
  requestId: string;
  clientName: string;
  clientType: "api" | "browser";
  audience: string;
  requestedScopes: readonly string[];
  requestedProfile: string;
  expiresAt: string;
  installationFingerprint: string;
  endpoint: {
    origin: string | null;
    fingerprint: string;
  };
  boundaries: PairingReviewBoundaries;
};

function reviewFingerprint(label: string, ...values: readonly string[]) {
  return createHash("sha256")
    .update(`forge/pairing-review/${label}/v1\0`, "utf8")
    .update(values.join("\0"), "utf8")
    .digest("hex")
    .match(/.{1,8}/g)!
    .slice(0, 4)
    .join("-")
    .toUpperCase();
}

function requestedEgressScopes(scopes: readonly string[]) {
  return scopes.filter(
    (scope) =>
      scope === "*" ||
      scope.startsWith("network.") ||
      scope.startsWith("egress.") ||
      scope.startsWith("machine.")
  );
}

export function createServerPairingReview(input: {
  request: PairingRequest;
  installationId: string;
  canonicalExternalOrigin: string | null;
}): ServerPairingReview {
  const scopes = [...input.request.requestedScopes].sort();
  const endpointIdentity =
    input.canonicalExternalOrigin ?? "local-runtime-only";
  return {
    requestId: input.request.id,
    clientName: input.request.clientName,
    clientType: input.request.clientType,
    audience: input.request.audience,
    requestedScopes: scopes,
    requestedProfile: input.request.requestedProfile,
    expiresAt: input.request.expiresAt,
    installationFingerprint: reviewFingerprint(
      "installation",
      input.installationId
    ),
    endpoint: {
      origin: input.canonicalExternalOrigin,
      fingerprint: reviewFingerprint(
        "endpoint",
        input.installationId,
        endpointIdentity
      )
    },
    boundaries: {
      resources: {
        profile: input.request.requestedProfile,
        scopes,
        enforcement: "profile_scopes_and_route_policy"
      },
      egress: {
        requestedScopes: requestedEgressScopes(scopes),
        enforcement: "capability_policy_and_destination_validation",
        default: "denied_unless_capability_explicitly_allows"
      }
    }
  };
}
