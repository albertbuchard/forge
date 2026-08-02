import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_CSRF_STORAGE_KEY,
  noteBrowserSessionRejected,
  noteBrowserSessionUsable
} from "./browser-request-security";
import {
  publishUiDiagnosticLog,
  resetUiDiagnosticPublicationStateForTest
} from "./diagnostics";

describe("UI diagnostics security", () => {
  afterEach(() => {
    localStorage.clear();
    noteBrowserSessionRejected();
    resetUiDiagnosticPublicationStateForTest();
    vi.restoreAllMocks();
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204
      })
    );
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

  it("allows only one denied burst and stays disabled after browser authorization changes", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_denied");
    noteBrowserSessionUsable();
    let resolveDenied!: (response: Response) => void;
    const denied = new Promise<Response>((resolve) => {
      resolveDenied = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(denied)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      level: "warning" as const,
      scope: "browser",
      eventKey: "denied",
      message: "Denied diagnostic."
    };

    const first = publishUiDiagnosticLog(input);
    const concurrent = publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();
    resolveDenied(new Response(null, { status: 403 }));
    await Promise.all([first, concurrent]);
    await publishUiDiagnosticLog(input);

    expect(fetchMock).toHaveBeenCalledOnce();

    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_renewed");
    noteBrowserSessionUsable();
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows one later denied request after success and disables the document", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_expiring");
    noteBrowserSessionUsable();
    let resolveDenied!: (response: Response) => void;
    const denied = new Promise<Response>((resolve) => {
      resolveDenied = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockReturnValueOnce(denied);
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      level: "warning" as const,
      scope: "browser",
      eventKey: "session_expired",
      message: "The diagnostics authorization expired."
    };

    await publishUiDiagnosticLog(input);
    const firstDenied = publishUiDiagnosticLog(input);
    const concurrentDenied = publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveDenied(new Response(null, { status: 401 }));
    await Promise.all([firstDenied, concurrentDenied]);
    await publishUiDiagnosticLog(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    noteBrowserSessionUsable();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops every concurrent event while a publication is pending", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_queue");
    noteBrowserSessionUsable();
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(firstResponse);
    vi.stubGlobal("fetch", fetchMock);

    const first = publishUiDiagnosticLog({
      level: "info",
      scope: "navigation",
      eventKey: "route_started",
      message: "Navigation started."
    });
    await publishUiDiagnosticLog({
      level: "error",
      scope: "runtime",
      eventKey: "render_failed",
      message: "The route failed to render."
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveFirst(new Response(null, { status: 204 }));
    await first;

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cools down after network or server failure without a timer retry", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_cooldown");
    noteBrowserSessionUsable();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      level: "warning" as const,
      scope: "browser",
      eventKey: "temporarily_unavailable",
      message: "Diagnostics are temporarily unavailable."
    };

    await publishUiDiagnosticLog(input);
    now.mockReturnValue(30_999);
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();

    now.mockReturnValue(31_000);
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the same bounded cooldown after a thrown network failure", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_network");
    noteBrowserSessionUsable();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(5_000);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      level: "error" as const,
      scope: "browser",
      eventKey: "network_unavailable",
      message: "Diagnostics could not reach Forge."
    };

    await publishUiDiagnosticLog(input);
    now.mockReturnValue(34_999);
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();

    now.mockReturnValue(35_000);
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays disabled in the same document and starts fresh in a new document", async () => {
    localStorage.setItem(BROWSER_CSRF_STORAGE_KEY, "fg_csrf_new_document");
    noteBrowserSessionUsable();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      level: "warning" as const,
      scope: "browser",
      eventKey: "document_state",
      message: "Document-scoped state."
    };

    await publishUiDiagnosticLog(input);
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();

    noteBrowserSessionUsable();
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledOnce();

    resetUiDiagnosticPublicationStateForTest();
    noteBrowserSessionUsable();
    await publishUiDiagnosticLog(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
