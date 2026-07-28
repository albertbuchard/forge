import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_CSRF_STORAGE_KEY,
  noteBrowserSessionRejected,
  noteBrowserSessionUsable
} from "./browser-request-security";
import { publishUiDiagnosticLog } from "./diagnostics";

describe("UI diagnostics security", () => {
  afterEach(() => {
    localStorage.clear();
    noteBrowserSessionRejected();
    vi.unstubAllGlobals();
  });

  it("does not emit a protected mutation before browser authorization", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await publishUiDiagnosticLog({
      level: "warning",
      scope: "browser",
      eventKey: "not_authorized",
      message: "The browser is not authorized yet."
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends diagnostics with the paired browser CSRF proof", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_diagnostics");
    noteBrowserSessionUsable();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 204
    }));
    vi.stubGlobal("fetch", fetchMock);

    await publishUiDiagnosticLog({
      level: "warning",
      scope: "browser",
      eventKey: "sample",
      message: "Sample diagnostic."
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-forge-source")).toBe("ui");
    expect(headers.get("x-forge-csrf")).toBe("fg_csrf_diagnostics");
  });

  it("does not emit after the paired browser session is rejected", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_stale");
    noteBrowserSessionUsable();
    noteBrowserSessionRejected();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await publishUiDiagnosticLog({
      level: "warning",
      scope: "browser",
      eventKey: "stale_session",
      message: "The prior browser session is no longer valid."
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
