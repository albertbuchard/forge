export function normalizeAssetBasePath(basePath: string) {
  if (!basePath || basePath === "/") {
    return "/";
  }

  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function normalizeRouterBasename(basePath: string) {
  const normalized = normalizeAssetBasePath(basePath);
  if (normalized === "/") {
    return "/";
  }

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function getBaseUrl() {
  return new URL(normalizeAssetBasePath(import.meta.env.BASE_URL || "/"), window.location.origin);
}

export function resolveForgePath(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return pathname;
  }

  const normalized = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalized, getBaseUrl()).pathname;
}
