import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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
      count > 0
        ? [{ index: 0, start: 0, key: "row-0" }]
        : [],
    measureElement: () => undefined
  })
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings/logs"]}>
        <Routes>
          <Route path="/settings/logs" element={<SettingsLogsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsLogsPage", () => {
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
});
