import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { z } from "zod";
import {
  getPeerRouteContract,
  type PeerRouteMethod
} from "../peer-route-contract.js";

export const PEER_PRESENCE_CAPABILITY_TTL_SECONDS = 5 * 60;
export const PEER_PRESENCE_COOKIE_NAME = "forge_peer_presence";

const PRESENCE_REQUIRED_OPERATION_IDS = new Set([
  "createPeerHumanPresenceOptions",
  "revokePeerHumanPresenceCredential",
  "createPeerInvitation",
  "cancelPeerInvitation",
  "acceptScannedPeerPairing",
  "confirmPeerPairing",
  "acceptPeerRequest",
  "rejectPeerRequest",
  "revokePeerRelationship",
  "approvePeerDevice",
  "removePeerDevice",
  "previewPeerGrant",
  "proposePeerGrant",
  "acceptPeerGrant",
  "counterPeerGrant",
  "revokePeerGrant",
  "requestPeerResync"
]);

const VERSION_REQUIRED_OPERATION_IDS = new Set(
  [...PRESENCE_REQUIRED_OPERATION_IDS].filter(
    (operationId) =>
      operationId !== "createPeerInvitation" &&
      operationId !== "acceptScannedPeerPairing"
  )
);

const capabilityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9_-]+$/);
const capabilitySecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const principalSchema = z
  .object({
    principalClass: z.enum(["operator_session", "companion_consent"]),
    principalId: z.string().trim().min(1).max(240),
    ownerUserId: z.string().trim().min(1).max(240),
    origin: z.string().trim().min(1).max(2_048).nullable()
  })
  .strict()
  .superRefine((principal, context) => {
    if (principal.principalClass === "companion_consent") {
      if (principal.origin !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Companion consent must not claim a browser origin.",
          path: ["origin"]
        });
      }
      return;
    }
    if (principal.origin === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An operator approval must be bound to its exact origin.",
        path: ["origin"]
      });
      return;
    }
    try {
      const parsed = new URL(principal.origin);
      if (parsed.origin !== principal.origin) {
        throw new Error("non-canonical origin");
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An operator approval origin must be a canonical URL origin.",
        path: ["origin"]
      });
    }
  });

export const peerPresenceActionSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(240),
    method: z.enum(["POST", "DELETE"]),
    routePath: z.string().trim().min(1).max(512),
    pathParams: z.record(z.string().trim().min(1).max(512)),
    expectedVersion: z.string().trim().min(1).max(240).nullable(),
    body: z.unknown()
  })
  .strict();

export type PeerPresenceAction = z.input<typeof peerPresenceActionSchema>;

export type PeerPresencePrincipal = {
  principalClass: "operator_session" | "companion_consent";
  principalId: string;
  ownerUserId: string;
  origin: string | null;
};

function parsePeerPresencePrincipal(
  principal: PeerPresencePrincipal
): PeerPresencePrincipal {
  return principalSchema.parse(principal);
}

export type PeerPresenceCapabilityRecord = PeerPresencePrincipal & {
  id: string;
  tokenHash: string;
  actionDigest: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type PeerPresenceCapabilityStore = {
  consumeExact(input: {
    id: string;
    tokenHash: string;
    actionDigest: string;
    principal: PeerPresencePrincipal;
    now: string;
  }): boolean;
};

function canonicalizeJson(value: unknown, path = "$"): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Peer approval action contains a non-finite number at ${path}.`
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      canonicalizeJson(entry, `${path}[${index}]`)
    );
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Peer approval action contains a non-JSON object at ${path}.`
      );
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => {
          if (["__proto__", "constructor", "prototype"].includes(key)) {
            throw new Error(
              `Peer approval action contains a protected key at ${path}.`
            );
          }
          if (nested === undefined) {
            throw new Error(
              `Peer approval action contains undefined at ${path}.${key}.`
            );
          }
          return [key, canonicalizeJson(nested, `${path}.${key}`)];
        })
    );
  }
  throw new Error(`Peer approval action contains a non-JSON value at ${path}.`);
}

function requiredPathParams(routePath: string): string[] {
  return Array.from(
    routePath.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g),
    (match) => match[1]!
  ).sort();
}

function parsePresenceAction(input: PeerPresenceAction) {
  const parsed = peerPresenceActionSchema.parse(input);
  const route = getPeerRouteContract(
    parsed.method as PeerRouteMethod,
    parsed.routePath
  );
  if (!route || !PRESENCE_REQUIRED_OPERATION_IDS.has(route.operationId)) {
    throw new Error("This route does not accept a peer approval capability.");
  }
  if (
    VERSION_REQUIRED_OPERATION_IDS.has(route.operationId) &&
    parsed.expectedVersion === null
  ) {
    throw new Error(
      "This peer approval action requires an expected record version."
    );
  }
  const expectedParams = requiredPathParams(route.path);
  const suppliedParams = Object.keys(parsed.pathParams).sort();
  if (
    expectedParams.length !== suppliedParams.length ||
    expectedParams.some((name, index) => name !== suppliedParams[index])
  ) {
    throw new Error(
      "Peer approval path parameters do not match the route contract."
    );
  }
  return {
    ...parsed,
    pathParams: Object.fromEntries(
      Object.entries(parsed.pathParams).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    body: canonicalizeJson(parsed.body)
  };
}

export function canonicalPeerPresenceActionJson(
  input: PeerPresenceAction
): string {
  return JSON.stringify(canonicalizeJson(parsePresenceAction(input)));
}

export function digestPeerPresenceAction(input: PeerPresenceAction): string {
  return createHash("sha256")
    .update("forge-peer/human-presence-action/v1\0", "utf8")
    .update(canonicalPeerPresenceActionJson(input), "utf8")
    .digest("hex");
}

function hashCapabilitySecret(secret: string, key: Uint8Array): string {
  if (key.byteLength < 32) {
    throw new Error("Peer approval capability hashing requires a 32-byte key.");
  }
  return createHmac("sha256", key)
    .update(capabilitySecretSchema.parse(secret), "utf8")
    .digest("hex");
}

export function issuePeerPresenceCapability(input: {
  id: string;
  action: PeerPresenceAction;
  principal: PeerPresencePrincipal;
  hashingKey: Uint8Array;
  now?: Date;
}): { secret: string; record: PeerPresenceCapabilityRecord } {
  const principal = parsePeerPresencePrincipal(input.principal);
  if (principal.ownerUserId !== input.action.ownerUserId) {
    throw new Error(
      "Peer approval principal does not own the reviewed action."
    );
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Peer approval capability issue time is invalid.");
  }
  const issuedAt = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
  const secret = randomBytes(32).toString("base64url");
  return {
    secret,
    record: {
      ...principal,
      id: capabilityIdSchema.parse(input.id),
      tokenHash: hashCapabilitySecret(secret, input.hashingKey),
      actionDigest: digestPeerPresenceAction(input.action),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + PEER_PRESENCE_CAPABILITY_TTL_SECONDS * 1_000
      ).toISOString(),
      consumedAt: null
    }
  };
}

export function consumePeerPresenceCapability(input: {
  capabilityId: string;
  secret: string;
  action: PeerPresenceAction;
  principal: PeerPresencePrincipal;
  hashingKey: Uint8Array;
  store: PeerPresenceCapabilityStore;
  now?: Date;
}): void {
  const principal = parsePeerPresencePrincipal(input.principal);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Peer approval capability consume time is invalid.");
  }
  const consumed = input.store.consumeExact({
    id: capabilityIdSchema.parse(input.capabilityId),
    tokenHash: hashCapabilitySecret(input.secret, input.hashingKey),
    actionDigest: digestPeerPresenceAction(input.action),
    principal,
    now: now.toISOString()
  });
  if (!consumed) {
    throw new Error(
      "Peer approval capability is invalid, expired, or already used."
    );
  }
}

export function capabilitySecretMatches(
  secret: string,
  expectedHash: string,
  hashingKey: Uint8Array
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  try {
    const actual = hashCapabilitySecret(secret, hashingKey);
    return timingSafeEqual(
      Buffer.from(actual, "hex"),
      Buffer.from(expectedHash, "hex")
    );
  } catch {
    return false;
  }
}

export function peerPresenceCapabilityCookie(input: {
  capabilityId: string;
  secret: string;
  secure: boolean;
  clear?: boolean;
}): string {
  const value = input.clear
    ? ""
    : encodeURIComponent(
        `${capabilityIdSchema.parse(input.capabilityId)}.${capabilitySecretSchema.parse(
          input.secret
        )}`
      );
  const attributes = [
    `${PEER_PRESENCE_COOKIE_NAME}=${value}`,
    "Path=/api/v1/peers",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${input.clear ? 0 : PEER_PRESENCE_CAPABILITY_TTL_SECONDS}`
  ];
  if (input.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function readPeerPresenceCapabilityCookie(
  cookieHeader: string | null | undefined
): { capabilityId: string; secret: string } | null {
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${PEER_PRESENCE_COOKIE_NAME}=`;
  const encoded = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
  if (!encoded) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(".");
  if (separator <= 0 || decoded.indexOf(".", separator + 1) !== -1) {
    return null;
  }
  const capabilityId = decoded.slice(0, separator);
  const secret = decoded.slice(separator + 1);
  if (
    !capabilityIdSchema.safeParse(capabilityId).success ||
    !capabilitySecretSchema.safeParse(secret).success
  ) {
    return null;
  }
  return { capabilityId, secret };
}
