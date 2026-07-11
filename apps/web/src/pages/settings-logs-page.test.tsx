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

const { listDiagnosticLogsMock } = vi.hoisted(() => ({
  listDiagnosticLogsMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
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
  SettingsSectionNav: () => <div>Settings nav</div>
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
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(cleanup);

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
});
