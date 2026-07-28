export const BROWSER_CSRF_STORAGE_KEY = "forge.browser.csrf";
export const UI_SOURCE_HEADER = "x-forge-source";
export const UI_SOURCE_VALUE = "ui";

let browserSessionObservedUsable = false;

export function readBrowserCsrfToken() {
  try {
    return globalThis.localStorage?.getItem(BROWSER_CSRF_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function forgeBrowserRequestHeaders(input?: HeadersInit) {
  const headers = new Headers(input);
  headers.set(UI_SOURCE_HEADER, UI_SOURCE_VALUE);
  const csrfToken = readBrowserCsrfToken();
  if (csrfToken && !headers.has("x-forge-csrf")) {
    headers.set("x-forge-csrf", csrfToken);
  }
  return headers;
}

export function noteBrowserSessionUsable() {
  browserSessionObservedUsable = true;
}

export function noteBrowserSessionRejected() {
  browserSessionObservedUsable = false;
}

export function canPublishBrowserDiagnostics() {
  return browserSessionObservedUsable && readBrowserCsrfToken() !== null;
}

export function responseProvesBrowserSession(path: string) {
  if (!path.startsWith("/api/v1/auth/")) {
    return path.startsWith("/api/v1/");
  }
  return (
    path === "/api/v1/auth/operator-session" ||
    path === "/api/v1/auth/browser/refresh"
  );
}
