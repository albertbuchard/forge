import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Address4, Address6 } from "ip-address";
import { z } from "zod";

const portSchema = z.number().int().min(1).max(65_535);
const irohEndpointIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const onionHostSchema = z
  .string()
  .toLowerCase()
  .regex(/^[a-z2-7]{56}\.onion$/);

const localDirectEndpointSchema = z
  .object({
    kind: z.literal("local_direct"),
    host: z.string().trim().min(1).max(253),
    port: portSchema,
    deviceId: z.string().trim().min(1).max(240)
  })
  .strict();

const irohEndpointSchema = z
  .object({
    kind: z.literal("iroh"),
    endpointId: irohEndpointIdSchema,
    relayUrls: z.array(z.string().url()).max(8).default([]),
    deviceId: z.string().trim().min(1).max(240)
  })
  .strict();

const torEndpointSchema = z
  .object({
    kind: z.literal("tor_onion"),
    onionHost: onionHostSchema,
    port: portSchema,
    deviceId: z.string().trim().min(1).max(240)
  })
  .strict();

const httpMailboxEndpointSchema = z
  .object({
    kind: z.literal("http_mailbox"),
    baseUrl: z.string().url().max(2_048),
    providerId: z.string().trim().min(1).max(240)
  })
  .strict();

export const peerEndpointDescriptorSchema = z.discriminatedUnion("kind", [
  localDirectEndpointSchema,
  irohEndpointSchema,
  torEndpointSchema,
  httpMailboxEndpointSchema
]);

export type PeerEndpointDescriptor = z.infer<typeof peerEndpointDescriptorSchema>;

export type EndpointTrustSource = "peer_advertised" | "operator_configured";

const UNSAFE_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4"
].map((cidr) => new Address4(cidr));

const UNSAFE_IPV6_CIDRS = [
  "::/128",
  "::1/128",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "100::/64",
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
  "5f00::/16",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8"
].map((cidr) => new Address6(cidr));

const ONION_V3_VERSION = 3;
const ONION_CHECKSUM_PREFIX = Buffer.from(".onion checksum", "ascii");

function isSafeHostLabel(host: string): boolean {
  if (host.includes(":") && isIP(host) !== 6) {
    return false;
  }
  if (isIP(host) > 0) {
    return true;
  }
  return (
    host.length <= 253 &&
    host.split(".").every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    )
  );
}

function normalizeCredentialFreeHttpsOrigin(raw: string, label: string): URL {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} requires HTTPS.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      `${label} cannot contain credentials, paths, queries, or fragments.`
    );
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error(`${label} requires the standard HTTPS port.`);
  }
  return parsed;
}

function normalizeMailboxUrl(raw: string): URL {
  return normalizeCredentialFreeHttpsOrigin(raw, "Mailbox provider origins");
}

function isPublicIpv4(address: Address4): boolean {
  return !UNSAFE_IPV4_CIDRS.some((network) => address.isInSubnet(network));
}

function decodeUnpaddedBase32(value: string): Uint8Array | null {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let accumulator = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      return null;
    }
    accumulator = (accumulator << 5) | digit;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >>> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  return bitCount === 0 || accumulator === 0 ? Uint8Array.from(bytes) : null;
}

export function isValidOnionV3Host(host: string): boolean {
  const normalized = host.toLocaleLowerCase("en-US");
  if (!onionHostSchema.safeParse(normalized).success) {
    return false;
  }
  const decoded = decodeUnpaddedBase32(normalized.slice(0, -6));
  if (decoded === null || decoded.byteLength !== 35) {
    return false;
  }
  const publicKey = decoded.subarray(0, 32);
  const checksum = decoded.subarray(32, 34);
  const version = decoded[34];
  if (version !== ONION_V3_VERSION) {
    return false;
  }
  const expectedChecksum = createHash("sha3-256")
    .update(ONION_CHECKSUM_PREFIX)
    .update(publicKey)
    .update(Uint8Array.of(ONION_V3_VERSION))
    .digest()
    .subarray(0, 2);
  return timingSafeEqual(checksum, expectedChecksum);
}

export function isPublicPeerProviderAddress(ip: string): boolean {
  if (Address4.isValid(ip)) {
    return isPublicIpv4(new Address4(ip));
  }
  if (!Address6.isValid(ip)) {
    return false;
  }
  const address = new Address6(ip);
  if (address.isMapped4()) {
    return isPublicIpv4(address.to4());
  }
  return !UNSAFE_IPV6_CIDRS.some((network) => address.isInSubnet(network));
}

export function validatePeerEndpointDescriptor(
  input: unknown,
  options: { trustSource: EndpointTrustSource }
): PeerEndpointDescriptor {
  const endpoint = peerEndpointDescriptorSchema.parse(input);
  if (endpoint.kind === "local_direct") {
    if (!isSafeHostLabel(endpoint.host)) {
      throw new Error("Local-direct host is not a structured IP address or hostname.");
    }
    return endpoint;
  }
  if (endpoint.kind === "iroh") {
    const relayUrls = endpoint.relayUrls.map((relayUrl) =>
      normalizeCredentialFreeHttpsOrigin(
        relayUrl,
        "Iroh relay descriptors"
      ).toString()
    );
    if (new Set(relayUrls).size !== relayUrls.length) {
      throw new Error("Iroh relay descriptors cannot contain duplicate origins.");
    }
    return { ...endpoint, relayUrls };
  }
  if (endpoint.kind === "http_mailbox") {
    if (options.trustSource !== "operator_configured") {
      throw new Error("A remote peer cannot choose the local mailbox provider origin.");
    }
    return { ...endpoint, baseUrl: normalizeMailboxUrl(endpoint.baseUrl).toString() };
  }
  if (!isValidOnionV3Host(endpoint.onionHost)) {
    throw new Error("Tor endpoints require a checksum-valid version 3 onion host.");
  }
  return endpoint;
}

export async function resolveAndPinMailboxOrigin(baseUrl: string): Promise<{
  origin: string;
  addresses: string[];
}> {
  const parsed = normalizeMailboxUrl(baseUrl);
  const records = await lookup(parsed.hostname, { all: true, verbatim: true });
  const addresses = Array.from(new Set(records.map((record) => record.address)));
  if (addresses.length === 0 || addresses.some((address) => !isPublicPeerProviderAddress(address))) {
    throw new Error("Mailbox provider DNS resolved to a non-public or invalid address.");
  }
  return { origin: parsed.origin, addresses };
}

export function assertPinnedMailboxResponseAddress(
  responseAddress: string,
  pinnedAddresses: string[]
): void {
  if (!isPublicPeerProviderAddress(responseAddress)) {
    throw new Error("Mailbox response used a non-public address.");
  }
  const canonicalResponse = canonicalIpAddress(responseAddress);
  const canonicalPinned = new Set(pinnedAddresses.map(canonicalIpAddress));
  if (!canonicalPinned.has(canonicalResponse)) {
    throw new Error("Mailbox response address changed after DNS pinning.");
  }
}

function canonicalIpAddress(address: string): string {
  if (Address4.isValid(address)) {
    return new Address4(address).correctForm();
  }
  if (Address6.isValid(address)) {
    return new Address6(address).correctForm();
  }
  throw new Error("Peer provider returned an invalid IP address.");
}
