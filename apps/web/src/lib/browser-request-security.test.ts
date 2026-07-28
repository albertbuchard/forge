import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_CSRF_STORAGE_KEY,
  canPublishBrowserDiagnostics,
  forgeBrowserRequestHeaders,
  noteBrowserSessionRejected,
  noteBrowserSessionUsable,
  readBrowserCsrfToken,
  responseProvesBrowserSession
} from "./browser-request-security";

describe("browser request security", () => {
  afterEach(() => {
    localStorage.clear();
    noteBrowserSessionRejected();
  });

  it("adds the UI source and current browser CSRF proof", () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_current");

    const headers = forgeBrowserRequestHeaders({
      "content-type": "application/json"
    });

    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-forge-source")).toBe("ui");
    expect(headers.get("x-forge-csrf")).toBe("fg_csrf_current");
    expect(readBrowserCsrfToken()).toBe("fg_csrf_current");
  });

  it("does not replace an explicitly bound CSRF proof", () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_current");

    const headers = forgeBrowserRequestHeaders({
      "x-forge-csrf": "fg_csrf_explicit"
    });

    expect(headers.get("x-forge-csrf")).toBe("fg_csrf_explicit");
  });

  it("publishes diagnostics only after a secured request is observed", () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_current");
    expect(canPublishBrowserDiagnostics()).toBe(false);

    noteBrowserSessionUsable();
    expect(canPublishBrowserDiagnostics()).toBe(true);

    noteBrowserSessionRejected();
    expect(canPublishBrowserDiagnostics()).toBe(false);
  });

  it("does not treat public pairing responses as session proof", () => {
    expect(responseProvesBrowserSession("/api/v1/auth/device")).toBe(false);
    expect(responseProvesBrowserSession("/api/v1/auth/token")).toBe(false);
    expect(
      responseProvesBrowserSession("/api/v1/auth/local/browser/begin")
    ).toBe(false);
    expect(
      responseProvesBrowserSession("/api/v1/auth/operator-session")
    ).toBe(true);
    expect(
      responseProvesBrowserSession("/api/v1/auth/browser/refresh")
    ).toBe(true);
    expect(responseProvesBrowserSession("/api/v1/settings")).toBe(true);
    expect(responseProvesBrowserSession("/api/health")).toBe(false);
  });
});
