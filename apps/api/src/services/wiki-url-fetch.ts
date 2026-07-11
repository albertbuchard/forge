import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { HttpError } from "../errors.js";

export const WIKI_URL_FETCH_MAX_REDIRECTS = 5;
export const WIKI_URL_FETCH_MAX_BYTES = 10 * 1024 * 1024;
export const WIKI_URL_FETCH_TIMEOUT_MS = 10_000;

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type WikiUrlFetchResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
};

export type WikiUrlFetchDependencies = {
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (input: {
    url: URL;
    address: ResolvedAddress;
    signal: AbortSignal;
  }) => Promise<WikiUrlFetchResponse>;
};

function policyError(message: string, statusCode = 400) {
  return new HttpError(statusCode, "wiki_ingest_url_rejected", message);
}

function parseIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return (
    ((octets[0]! << 24) >>> 0) +
    (octets[1]! << 16) +
    (octets[2]! << 8) +
    octets[3]!
  );
}

function ipv4InCidr(value: number, base: string, prefix: number) {
  const parsedBase = parseIpv4(base);
  if (parsedBase === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (parsedBase & mask) >>> 0;
}

function parseIpv6(address: string): bigint | null {
  const normalized = address.toLowerCase().split("%")[0]!;
  const embeddedIpv4Match = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let expanded = normalized;
  if (embeddedIpv4Match) {
    const ipv4 = parseIpv4(embeddedIpv4Match[2]!);
    if (ipv4 === null) {
      return null;
    }
    expanded = `${embeddedIpv4Match[1]}${(ipv4 >>> 16).toString(16)}:${(
      ipv4 & 0xffff
    ).toString(16)}`;
  }
  const halves = expanded.split("::");
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fillCount = 8 - left.length - right.length;
  if (fillCount < 0 || (halves.length === 1 && fillCount !== 0)) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: fillCount }, () => "0"),
    ...right
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.reduce(
    (value, group) => (value << 16n) + BigInt(`0x${group}`),
    0n
  );
}

function ipv6InCidr(value: bigint, base: string, prefix: number) {
  const parsedBase = parseIpv6(base);
  if (parsedBase === null) {
    return false;
  }
  const shift = BigInt(128 - prefix);
  return value >> shift === parsedBase >> shift;
}

export function isPublicWikiIngestAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const value = parseIpv4(address);
    if (value === null) {
      return false;
    }
    const blockedRanges: Array<[string, number]> = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4]
    ];
    return !blockedRanges.some(([base, prefix]) =>
      ipv4InCidr(value, base, prefix)
    );
  }
  if (family === 6) {
    const value = parseIpv6(address);
    if (value === null) {
      return false;
    }
    const mappedPrefix = value >> 32n;
    if (mappedPrefix === 0xffffn) {
      const embedded = Number(value & 0xffffffffn);
      return isPublicWikiIngestAddress(
        [24, 16, 8, 0]
          .map((shift) => String((embedded >>> shift) & 0xff))
          .join(".")
      );
    }
    const blockedRanges: Array<[string, number]> = [
      ["::", 96],
      ["64:ff9b::", 96],
      ["64:ff9b:1::", 48],
      ["100::", 64],
      ["2001:2::", 48],
      ["2001:10::", 28],
      ["2001:20::", 28],
      ["2001:db8::", 32],
      ["2002::", 16],
      ["fc00::", 7],
      ["fe80::", 10],
      ["ff00::", 8]
    ];
    return !blockedRanges.some(([base, prefix]) =>
      ipv6InCidr(value, base, prefix)
    );
  }
  return false;
}

export function parseWikiIngestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw policyError("Enter a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw policyError("Wiki URL ingest accepts only HTTP or HTTPS URLs.");
  }
  if (url.username || url.password) {
    throw policyError("Wiki URL ingest does not accept embedded credentials.");
  }
  if (!url.hostname) {
    throw policyError("The wiki ingest URL must include a hostname.");
  }
  url.hash = "";
  return url;
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  if (isIP(hostname) === 4) {
    return [{ address: hostname, family: 4 }];
  }
  if (isIP(hostname) === 6) {
    return [{ address: hostname, family: 6 }];
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4
  }));
}

export async function resolveWikiIngestUrlTarget(
  value: string,
  dependencies: WikiUrlFetchDependencies = {},
  timeoutMs = WIKI_URL_FETCH_TIMEOUT_MS
) {
  const url = parseWikiIngestUrl(value);
  let addresses: ResolvedAddress[];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      (dependencies.lookup ?? defaultLookup)(url.hostname),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(policyError("Wiki URL ingest DNS lookup timed out.", 504)),
          timeoutMs
        );
      })
    ]);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw policyError("The wiki ingest URL hostname could not be resolved.");
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
  if (addresses.length === 0) {
    throw policyError("The wiki ingest URL hostname did not resolve.");
  }
  const blocked = addresses.find(
    (entry) => !isPublicWikiIngestAddress(entry.address)
  );
  if (blocked) {
    throw policyError(
      "Wiki URL ingest cannot access private, loopback, link-local, or reserved network addresses."
    );
  }
  return { url, address: addresses[0]! };
}

function defaultRequest({
  url,
  address,
  signal
}: {
  url: URL;
  address: ResolvedAddress;
  signal: AbortSignal;
}) {
  return new Promise<WikiUrlFetchResponse>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      {
        protocol: url.protocol,
        hostname: address.address,
        family: address.family,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.protocol === "https:" ? url.hostname : undefined,
        headers: {
          accept:
            "text/*, application/json, application/pdf, application/xml, application/xhtml+xml, image/png, image/jpeg, image/gif, image/webp, audio/mpeg, audio/wav, audio/mp4, audio/ogg",
          host: url.host,
          "user-agent": "Forge-Wiki-Ingest/1.0"
        },
        signal
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          close: () => response.destroy()
        });
      }
    );
    request.once("error", reject);
    request.end();
  });
}

function normalizedHeader(
  headers: IncomingHttpHeaders,
  name: "content-length" | "content-type" | "location"
) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function isAllowedWikiIngestContentType(value: string) {
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/pdf",
      "application/xml",
      "application/xhtml+xml",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/ogg"
    ].includes(mimeType)
  );
}

export async function fetchWikiIngestUrl(
  value: string,
  options: {
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
    dependencies?: WikiUrlFetchDependencies;
  } = {}
) {
  const maxRedirects = options.maxRedirects ?? WIKI_URL_FETCH_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? WIKI_URL_FETCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? WIKI_URL_FETCH_TIMEOUT_MS;
  const dependencies = options.dependencies ?? {};
  const visited = new Set<string>();
  let currentUrl = parseWikiIngestUrl(value);

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (visited.has(currentUrl.href)) {
      throw policyError("Wiki URL ingest stopped a redirect loop.");
    }
    visited.add(currentUrl.href);
    const target = await resolveWikiIngestUrlTarget(
      currentUrl.href,
      dependencies,
      timeoutMs
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: WikiUrlFetchResponse | null = null;
    try {
      response = await (dependencies.request ?? defaultRequest)({
        ...target,
        signal: controller.signal
      });
      const location = normalizedHeader(response.headers, "location");
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.close();
        if (!location) {
          throw policyError(
            "Wiki URL ingest received a redirect without a destination."
          );
        }
        if (redirectCount >= maxRedirects) {
          throw policyError(
            `Wiki URL ingest follows at most ${maxRedirects} redirects.`
          );
        }
        currentUrl = parseWikiIngestUrl(new URL(location, currentUrl).href);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw policyError(
          `Wiki URL ingest received HTTP ${response.statusCode}.`
        );
      }
      const contentType =
        normalizedHeader(response.headers, "content-type") ?? "";
      if (!isAllowedWikiIngestContentType(contentType)) {
        throw policyError(
          "Wiki URL ingest accepts text, JSON, XML, PDF, supported image, or supported audio content types.",
          415
        );
      }
      const declaredLength = Number(
        normalizedHeader(response.headers, "content-length") ?? "0"
      );
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw policyError(
          `Wiki URL ingest is limited to ${maxBytes} bytes per response.`,
          413
        );
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of response.body) {
        if (controller.signal.aborted) {
          throw policyError("Wiki URL ingest timed out.", 504);
        }
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.byteLength;
        if (totalBytes > maxBytes) {
          throw policyError(
            `Wiki URL ingest is limited to ${maxBytes} bytes per response.`,
            413
          );
        }
        chunks.push(buffer);
      }
      return {
        url: currentUrl,
        mimeType: contentType.split(";", 1)[0]!.trim().toLowerCase(),
        payload: Buffer.concat(chunks, totalBytes)
      };
    } catch (error) {
      response?.close();
      if (controller.signal.aborted && !(error instanceof HttpError)) {
        throw policyError("Wiki URL ingest timed out.", 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        response?.close();
      }
    }
  }
}
