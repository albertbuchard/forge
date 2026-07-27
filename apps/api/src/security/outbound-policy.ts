import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import type { ForgePrincipal } from "./contracts.js";
import { isPublicWikiIngestAddress } from "../services/wiki-url-fetch.js";

export class OutboundPolicyError extends Error {
  readonly code = "outbound_policy_denied";

  constructor(message: string) {
    super(message);
    this.name = "OutboundPolicyError";
  }
}

export type OutboundResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type OutboundDestination = {
  url: URL;
  addresses: readonly OutboundResolvedAddress[];
  selectedAddress: OutboundResolvedAddress;
  canonicalOrigin: string;
};

export type OutboundPolicyDependencies = {
  lookup?: (hostname: string) => Promise<OutboundResolvedAddress[]>;
  now?: () => Date;
};

export type PrivateDestinationGrant = {
  grantId: string;
  ownerId: string;
  installationId: string;
  clientId: string | null;
  canonicalOrigin: string;
  pathPrefix: string;
  expiresAt: string;
  approvedAt: string;
  revokedAt: string | null;
};

export type CredentialDestinationBinding = {
  credentialId: string;
  providerKind: string;
  ownerId: string;
  installationId: string;
  scheme: "https:";
  host: string;
  port: number;
  pathPrefix: string;
  audience: string;
  version: number;
  detachedAt: string | null;
};

function defaultPort(protocol: string) {
  return protocol === "https:" ? 443 : protocol === "http:" ? 80 : null;
}

function canonicalHost(hostname: string) {
  const ascii = domainToASCII(hostname.trim().toLowerCase());
  if (!ascii) {
    throw new OutboundPolicyError(
      "The outbound destination hostname is invalid."
    );
  }
  return ascii;
}

function canonicalPathPrefix(value: string) {
  if (!value.startsWith("/") || value.includes("\0")) {
    throw new OutboundPolicyError(
      "Credential path policy must be an absolute URL path."
    );
  }
  const normalized = new URL(value, "https://forge.invalid").pathname;
  return normalized.endsWith("/") || normalized === "/"
    ? normalized
    : `${normalized}/`;
}

function pathMatchesPrefix(pathname: string, pathPrefix: string) {
  const normalizedPrefix = canonicalPathPrefix(pathPrefix);
  const normalizedPath = new URL(pathname, "https://forge.invalid").pathname;
  return (
    normalizedPrefix === "/" ||
    normalizedPath === normalizedPrefix.slice(0, -1) ||
    normalizedPath.startsWith(normalizedPrefix)
  );
}

function canonicalizeUrl(input: string | URL) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OutboundPolicyError("The outbound destination URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new OutboundPolicyError(
      "Outbound requests support HTTP and HTTPS destinations only."
    );
  }
  if (url.username || url.password || url.hash) {
    throw new OutboundPolicyError(
      "Outbound destinations cannot contain credentials or fragments."
    );
  }
  url.hostname = canonicalHost(url.hostname);
  return url;
}

async function defaultLookup(hostname: string) {
  if (isIP(hostname) === 4) {
    return [{ address: hostname, family: 4 as const }];
  }
  if (isIP(hostname) === 6) {
    return [{ address: hostname, family: 6 as const }];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? (6 as const) : (4 as const)
  }));
}

function exactOrigin(url: URL) {
  const port = Number(url.port || defaultPort(url.protocol));
  return `${url.protocol}//${canonicalHost(url.hostname)}:${port}`;
}

function privateGrantAllows(input: {
  grant: PrivateDestinationGrant | null;
  principal: ForgePrincipal;
  installationId: string;
  destination: URL;
  now: Date;
}) {
  const grant = input.grant;
  return Boolean(
    grant &&
    !grant.revokedAt &&
    grant.ownerId === input.principal.ownerId &&
    grant.installationId === input.installationId &&
    grant.clientId === input.principal.clientId &&
    grant.canonicalOrigin === exactOrigin(input.destination) &&
    pathMatchesPrefix(input.destination.pathname, grant.pathPrefix) &&
    Date.parse(grant.approvedAt) <= input.now.getTime() &&
    Date.parse(grant.expiresAt) > input.now.getTime()
  );
}

export class OutboundPolicy {
  private readonly lookup: NonNullable<OutboundPolicyDependencies["lookup"]>;
  private readonly now: () => Date;

  constructor(dependencies: OutboundPolicyDependencies = {}) {
    this.lookup = dependencies.lookup ?? defaultLookup;
    this.now = dependencies.now ?? (() => new Date());
  }

  async resolve(input: {
    destination: string | URL;
    principal: ForgePrincipal;
    installationId: string;
    privateDestinationGrant?: PrivateDestinationGrant | null;
  }): Promise<OutboundDestination> {
    const url = canonicalizeUrl(input.destination);
    const addresses = await this.lookup(url.hostname);
    if (addresses.length === 0) {
      throw new OutboundPolicyError(
        "The outbound destination did not resolve."
      );
    }
    const privateAddress = addresses.find(
      (entry) => !isPublicWikiIngestAddress(entry.address)
    );
    if (
      privateAddress &&
      !privateGrantAllows({
        grant: input.privateDestinationGrant ?? null,
        principal: input.principal,
        installationId: input.installationId,
        destination: url,
        now: this.now()
      })
    ) {
      throw new OutboundPolicyError(
        "Private, loopback, link-local, reserved, and metadata destinations require an exact current owner-approved grant."
      );
    }
    return {
      url,
      addresses: Object.freeze(addresses.map((entry) => ({ ...entry }))),
      selectedAddress: { ...addresses[0]! },
      canonicalOrigin: exactOrigin(url)
    };
  }

  async resolveRedirect(input: {
    from: OutboundDestination;
    location: string;
    principal: ForgePrincipal;
    installationId: string;
    privateDestinationGrant?: PrivateDestinationGrant | null;
  }) {
    const destination = new URL(input.location, input.from.url);
    const resolved = await this.resolve({
      destination,
      principal: input.principal,
      installationId: input.installationId,
      privateDestinationGrant: input.privateDestinationGrant
    });
    return {
      destination: resolved,
      originChanged: resolved.canonicalOrigin !== input.from.canonicalOrigin
    };
  }
}

export function credentialBindingAllows(input: {
  binding: CredentialDestinationBinding;
  providerKind: string;
  principal: ForgePrincipal;
  installationId: string;
  audience: string;
  destination: OutboundDestination;
}) {
  const { binding } = input;
  const destinationPort = Number(
    input.destination.url.port || defaultPort(input.destination.url.protocol)
  );
  return (
    !binding.detachedAt &&
    binding.providerKind === input.providerKind &&
    binding.ownerId === input.principal.ownerId &&
    binding.installationId === input.installationId &&
    binding.audience === input.audience &&
    binding.scheme === input.destination.url.protocol &&
    binding.host === canonicalHost(input.destination.url.hostname) &&
    binding.port === destinationPort &&
    pathMatchesPrefix(input.destination.url.pathname, binding.pathPrefix)
  );
}

export function detachCredentialForDestinationChange(input: {
  binding: CredentialDestinationBinding;
  nextDestination: string | URL;
  detachedAt: string;
}) {
  const next = canonicalizeUrl(input.nextDestination);
  const nextPort = Number(next.port || defaultPort(next.protocol));
  const unchanged =
    input.binding.scheme === next.protocol &&
    input.binding.host === canonicalHost(next.hostname) &&
    input.binding.port === nextPort &&
    pathMatchesPrefix(next.pathname, input.binding.pathPrefix);
  return unchanged
    ? input.binding
    : Object.freeze({
        ...input.binding,
        detachedAt: input.detachedAt,
        version: input.binding.version + 1
      });
}

const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization"
]);

export function headersForRedirect(
  headers: Readonly<Record<string, string>>,
  originChanged: boolean
) {
  if (!originChanged) {
    return { ...headers };
  }
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !CROSS_ORIGIN_SENSITIVE_HEADERS.has(name.toLowerCase())
    )
  );
}
