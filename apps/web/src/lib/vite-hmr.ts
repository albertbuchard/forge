function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function parseOptionalPort(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function buildForgeHmrPath(basePath: string) {
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === "/") {
    return "__vite_hmr";
  }
  return "__vite_hmr";
}

export function buildForgeHmrConfig(
  basePath: string,
  env: NodeJS.ProcessEnv
) {
  const hmr = {
    path: buildForgeHmrPath(basePath)
  } as {
    path: string;
    host?: string;
    protocol?: "ws" | "wss";
    port?: number;
    clientPort?: number;
  };

  const host = env.FORGE_HMR_HOST?.trim();
  if (host) {
    hmr.host = host;
  }

  const protocol = env.FORGE_HMR_PROTOCOL?.trim();
  if (protocol === "ws" || protocol === "wss") {
    hmr.protocol = protocol;
  }

  const port = parseOptionalPort(env.FORGE_HMR_PORT);
  if (port) {
    hmr.port = port;
  }

  const clientPort = parseOptionalPort(env.FORGE_HMR_CLIENT_PORT);
  if (clientPort) {
    hmr.clientPort = clientPort;
  }

  return hmr;
}
