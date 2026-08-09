import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsLogsPage } from "@/pages/settings-logs-page";

const { ensureOperatorSessionMock, listDiagnosticLogsMock } = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  listDiagnosticLogsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  ensureOperatorSession: ensureOperatorSessionMock,
  listDiagnosticLogs: listDiagnosticLogsMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge
  }: {
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>,
  SettingsStateFrame: ({
    children
  }: {
    children: import("react").ReactNode;
  }) => (
    <>
      <div>Settings nav</div>
      {children}
    </>
  )
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 240,
    getVirtualItems: () =>
      count > 0 ? [{ index: 0, start: 0, key: "row-0" }] : [],
    measureElement: () => undefined
  })
}));

function renderWithProviders(initialEntry = "/settings/logs") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/settings/logs" element={<SettingsLogsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsLogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: { actorLabel: "Operator", profile: "operator" }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:diagnostic-download")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(cleanup);

  it("shows the local-owner boundary without requesting logs for a paired browser", async () => {
    ensureOperatorSessionMock.mockResolvedValueOnce({
      session: {
        actorLabel: "Paired Browser",
        profile: "trusted_personal_assistant"
      }
    });

    renderWithProviders();

    expect(
      await screen.findByText("Diagnostic logs stay on the Forge host")
    ).toBeInTheDocument();
    expect(listDiagnosticLogsMock).not.toHaveBeenCalled();
  });

  it("survives the pending-to-loaded transition without hook-order crashes", async () => {
    let resolveLogs:
      | ((value: {
          logs: Array<{
            id: string;
            level: string;
            source: string;
            scope: string;
            eventKey: string;
            message: string;
            route: string | null;
            functionName: string | null;
            requestId: string | null;
            entityType: string | null;
            entityId: string | null;
            jobId: string | null;
            details: Record<string, unknown>;
            createdAt: string;
          }>;
          nextCursor: null;
        }) => void)
      | undefined;
    listDiagnosticLogsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogs = resolve;
        })
    );

    renderWithProviders();

    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listDiagnosticLogsMock).toHaveBeenCalledTimes(1)
    );

    resolveLogs?.({
      logs: [
        {
          id: "diag_1",
          level: "error",
          source: "server",
          scope: "diagnostics",
          eventKey: "request_failed",
          message: "GET /api/v1/diagnostics/logs -> 502",
          route: "/api/v1/diagnostics/logs",
          functionName: null,
          requestId: null,
          entityType: null,
          entityId: null,
          jobId: null,
          details: {
            note: "Proxy failure"
          },
          createdAt: "2026-04-06T04:45:00.000Z"
        }
      ],
      nextCursor: null
    });

    expect(await screen.findByText("Filters")).toBeInTheDocument();
    expect(
      await screen.findByText("GET /api/v1/diagnostics/logs -> 502")
    ).toBeInTheDocument();
  });

  it("sends supported exact filters and search to the bounded log request", async () => {
    listDiagnosticLogsMock.mockResolvedValue({ logs: [], nextCursor: null });

    renderWithProviders(
      "/settings/logs?search=proxy+failure&level=error&source=server&route=%2Fapi%2Fv1%2Fdiagnostics%2Flogs&jobId=job_7&entity=task%3Atask_9"
    );

    await screen.findByText(
      "No diagnostic entries match the current filters yet."
    );
    await waitFor(() => {
      expect(listDiagnosticLogsMock).toHaveBeenCalledWith({
        limit: 60,
        search: "proxy failure",
        level: "error",
        source: "server",
        scope: undefined,
        route: "/api/v1/diagnostics/logs",
        jobId: "job_7",
        entityType: "task",
        entityId: "task_9",
        beforeCreatedAt: undefined,
        beforeId: undefined
      });
    });
  });

  it("keeps OR-style multi-select filters client-side", async () => {
    listDiagnosticLogsMock.mockResolvedValue({ logs: [], nextCursor: null });

    renderWithProviders("/settings/logs?level=error&level=warning");

    await screen.findByText(
      "No diagnostic entries match the current filters yet."
    );
    expect(listDiagnosticLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: undefined, limit: 60 })
    );
  });

  it("debounces multi-character search without unmounting or blurring the input", async () => {
    listDiagnosticLogsMock
      .mockResolvedValueOnce({
        logs: [
          {
            id: "diag_proxy",
            level: "error",
            source: "server",
            scope: "diagnostics",
            eventKey: "proxy_failure",
            message: "Proxy failure",
            route: null,
            functionName: null,
            requestId: null,
            entityType: null,
            entityId: null,
            jobId: null,
            details: {},
            createdAt: "2026-04-06T04:45:00.000Z"
          }
        ],
        nextCursor: null
      })
      .mockImplementation(() => new Promise(() => undefined));

    renderWithProviders();

    const searchInput = await screen.findByRole("textbox", {
      name: "Search message or details"
    });
    searchInput.focus();

    for (const value of ["p", "pr", "pro", "prox", "proxy"]) {
      fireEvent.change(searchInput, { target: { value } });
      expect(searchInput).toHaveFocus();
    }

    await waitFor(() =>
      expect(listDiagnosticLogsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "proxy", limit: 60 })
      )
    );
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
    expect(searchInput).toHaveValue("proxy");
  });

  it("downloads only the matching loaded redacted logs and explains retention", async () => {
    const createdBlobs: Blob[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((blob) => {
      createdBlobs.push(blob as Blob);
      return "blob:diagnostic-download";
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    listDiagnosticLogsMock.mockResolvedValue({
      logs: [
        {
          id: "diag_safe",
          level: "error",
          source: "server",
          scope: "provider",
          eventKey: "request_failed",
          message: "Provider failed with authorization=[redacted]",
          route: "/api/v1/models/test",
          functionName: null,
          requestId: "request_safe",
          entityType: null,
          entityId: null,
          jobId: null,
          details: { apiKey: "[redacted]" },
          createdAt: "2026-08-09T12:00:00.000Z"
        },
        {
          id: "diag_excluded",
          level: "info",
          source: "server",
          scope: "provider",
          eventKey: "request_finished",
          message: "Excluded forge-export-secret-7291",
          route: "/api/v1/models/test",
          functionName: null,
          requestId: "request_excluded",
          entityType: null,
          entityId: null,
          jobId: null,
          details: { sentinel: "forge-export-secret-7291" },
          createdAt: "2026-08-09T11:59:00.000Z"
        }
      ],
      retention: { days: 14, maximumEntries: 5_000 },
      nextCursor: {
        beforeCreatedAt: "2026-08-09T12:00:00.000Z",
        beforeId: "diag_safe"
      }
    });

    renderWithProviders("/settings/logs?level=error&level=warning");

    expect(
      await screen.findByText(/keeps logs for up to 14 days or 5,000 entries/i)
    ).toBeInTheDocument();
    const download = screen.getByRole("button", {
      name: "Download loaded matches"
    });
    expect(download).toHaveClass("min-h-11");
    fireEvent.click(download);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:diagnostic-download"
    );
    expect(createdBlobs).toHaveLength(1);
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(createdBlobs[0]!);
    });
    const exported = JSON.parse(exportedText) as {
      schemaVersion: number;
      scope: string;
      complete: boolean;
      retention: { days: number; maximumEntries: number };
      logs: Array<{ id: string; message: string }>;
    };
    expect(exported).toMatchObject({
      schemaVersion: 1,
      scope: "currently_loaded_matching_logs",
      complete: false,
      retention: { days: 14, maximumEntries: 5_000 }
    });
    expect(exported.logs).toEqual([
      expect.objectContaining({
        id: "diag_safe",
        message: "Provider failed with authorization=[redacted]"
      })
    ]);
    expect(JSON.stringify(exported)).not.toContain("forge-export-secret-7291");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Download 1 started with 1 matching loaded log."
    );
    fireEvent.click(download);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Download 2 started with 1 matching loaded log."
    );
    expect(
      screen.getByText(/only the matching entries currently loaded/i)
    ).toHaveTextContent("Secret-like values are redacted");
  });

  it("blocks downloads while broader filter results are replacing placeholder rows", async () => {
    let resolveBroadResults:
      | ((value: { logs: []; retention: null; nextCursor: null }) => void)
      | undefined;
    listDiagnosticLogsMock
      .mockResolvedValueOnce({
        logs: [
          {
            id: "diag_narrow",
            level: "error",
            source: "server",
            scope: "provider",
            eventKey: "request_failed",
            message: "Needle failure",
            route: null,
            functionName: null,
            requestId: null,
            entityType: null,
            entityId: null,
            jobId: null,
            details: {},
            createdAt: "2026-08-09T12:00:00.000Z"
          }
        ],
        retention: { days: 14, maximumEntries: 5_000 },
        nextCursor: null
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBroadResults = resolve;
          })
      );

    renderWithProviders("/settings/logs?search=needle");

    const download = await screen.findByRole("button", {
      name: "Download loaded matches"
    });
    expect(download).toBeEnabled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search message or details" }),
      { target: { value: "" } }
    );
    await waitFor(() =>
      expect(listDiagnosticLogsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: undefined, limit: 60 })
      )
    );
    expect(download).toBeDisabled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    resolveBroadResults?.({ logs: [], retention: null, nextCursor: null });
  });
});
