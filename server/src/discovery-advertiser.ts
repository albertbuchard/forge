import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { Bonjour } from "bonjour-service";

const execFileAsync = promisify(execFile);

export type ForgeDiscoveryAdvertiserOptions = {
  port: number;
  basePath: string;
  enabled?: boolean;
  tailscaleApiBaseUrl?: string | null;
  tailscaleUiBaseUrl?: string | null;
};

export type ForgeDiscoveryAdvertiserHandle = {
  stop: () => void;
};

type TailscaleStatus = {
  Self?: {
    DNSName?: string;
  };
};

export async function startForgeDiscoveryAdvertiser(
  options: ForgeDiscoveryAdvertiserOptions
): Promise<ForgeDiscoveryAdvertiserHandle | null> {
  if (options.enabled === false || process.env.FORGE_DISABLE_DISCOVERY_ADVERTISEMENT === "1") {
    return null;
  }

  const basePath = normalizeBasePath(options.basePath);
  const tailscaleTargets = await resolveTailscaleTargets({
    apiBaseUrl: options.tailscaleApiBaseUrl,
    uiBaseUrl: options.tailscaleUiBaseUrl,
    basePath
  });

  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name: buildServiceName(),
    type: "forge",
    protocol: "tcp",
    port: options.port,
    txt: {
      apiPath: "/api/v1",
      uiPath: basePath,
      tsApiBaseUrl: tailscaleTargets.apiBaseUrl ?? "",
      tsUiBaseUrl: tailscaleTargets.uiBaseUrl ?? "",
      tsDnsName: tailscaleTargets.dnsName ?? "",
      watchReady: "1"
    }
  });

  service.start();

  return {
    stop: () => {
      service.stop(() => {
        bonjour.destroy();
      });
    }
  };
}

function buildServiceName() {
  const hostname = os.hostname().trim();
  return hostname ? `Forge on ${hostname}` : "Forge";
}

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

async function resolveTailscaleTargets(input: {
  apiBaseUrl?: string | null;
  uiBaseUrl?: string | null;
  basePath: string;
}) {
  const explicitApi = normalizeHttpsUrl(input.apiBaseUrl);
  const explicitUi = normalizeHttpsUrl(input.uiBaseUrl);
  if (explicitApi || explicitUi) {
    return {
      apiBaseUrl: explicitApi,
      uiBaseUrl: explicitUi,
      dnsName: readDnsNameFromUrl(explicitApi ?? explicitUi)
    };
  }

  const dnsName = await readTailscaleDnsName();
  if (!dnsName) {
    return { apiBaseUrl: null, uiBaseUrl: null, dnsName: null };
  }

  return {
    apiBaseUrl: `https://${dnsName}/api/v1`,
    uiBaseUrl: `https://${dnsName}${input.basePath}`,
    dnsName
  };
}

function normalizeHttpsUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

function readDnsNameFromUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function readTailscaleDnsName() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 1_500,
      env: process.env
    });
    const parsed = JSON.parse(stdout) as TailscaleStatus;
    const dnsName = parsed.Self?.DNSName?.trim().replace(/\.$/, "");
    return dnsName || null;
  } catch {
    return null;
  }
}
