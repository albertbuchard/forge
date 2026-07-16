import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PsycheMetricsPage } from "@/pages/psyche-metrics-page";
import type { PsycheMetricsViewData } from "@/lib/psyche-types";

const { getPsycheMetricsViewMock, useForgeShellMock } = vi.hoisted(() => ({
  getPsycheMetricsViewMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/lib/api", () => ({
  getPsycheMetricsView: (...args: unknown[]) =>
    getPsycheMetricsViewMock(...args)
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge
  }: {
    title: ReactNode;
    description: ReactNode;
    badge?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {badge ? <div>{badge}</div> : null}
    </header>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <nav aria-label="Psyche sections" />
}));

vi.mock("@/components/psyche/psyche-metrics-workspace", () => ({
  PsycheMetricsWorkspace: ({ metrics }: { metrics: EmptyMetrics }) => (
    <div>Psyche metrics workspace: {metrics.summary.metricCount}</div>
  )
}));

type EmptyMetrics = PsycheMetricsViewData;

const emptyMetrics: EmptyMetrics = {
  summary: {
    hasData: false,
    trackedDays: 0,
    metricCount: 0,
    latestDateKey: null,
    latestMetricCount: 0,
    categoryBreakdown: [],
    familyAvailability: [
      {
        family: "mood",
        status: "no_data",
        metricCount: 0,
        reason: "No dated emotion reports."
      },
      {
        family: "urges",
        status: "unsupported",
        metricCount: 0,
        reason: "No dated urge field."
      },
      {
        family: "selfRegulation",
        status: "unsupported",
        metricCount: 0,
        reason: "No completed outcome field."
      },
      {
        family: "conversation",
        status: "no_data",
        metricCount: 0,
        reason: "No scanner rows."
      }
    ]
  },
  context: {
    generatedAt: "2026-05-14T00:00:00.000Z",
    conversationsScanned: 0,
    sourceCount: 0,
    messagesScanned: 0,
    messagesWithSwears: 0,
    totalSwears: 0,
    dailyAverage: {
      rawSwearCount: 0,
      swearingMessagePercent: 0,
      averageMaxCumulativeRage: 0,
      maxCumulativeRage: 0
    },
    weeklyAverage: {
      rawSwearCount: 0,
      swearingMessagePercent: 0,
      averageMaxCumulativeRage: 0,
      maxCumulativeRage: 0
    },
    sync: {
      fullSyncCompletedAt: null,
      lastDailySyncAt: null,
      lastSyncedDateKey: null
    },
    freshness: {
      status: "not_synced",
      lastSuccessfulAt: null,
      lastAttemptAt: null,
      warningCount: 0,
      warnings: []
    },
    ownerScope: {
      mode: "unscoped_all_data",
      effectiveUserIds: [],
      availableOwners: [],
      filterMode: "all_data",
      serverEnforced: false,
      unattributedRecordCount: 0,
      limitation: "The route has no authenticated owner scope."
    },
    sources: [],
    dataQualityWarnings: []
  },
  metrics: []
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PsycheMetricsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PsycheMetricsPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"]
    });
    getPsycheMetricsViewMock.mockResolvedValue({ metrics: emptyMetrics });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the page identity and navigation visible while metrics load", () => {
    getPsycheMetricsViewMock.mockReturnValue(new Promise(() => undefined));

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Psyche Metrics" })
    ).toBeInTheDocument();
    expect(screen.getByText("Loading metrics")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Psyche sections" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("hands an empty read model to the review workspace", async () => {
    renderPage();

    expect(
      await screen.findByText("Psyche metrics workspace: 0")
    ).toBeInTheDocument();
    expect(screen.getByText("No metrics yet")).toBeInTheDocument();
    expect(getPsycheMetricsViewMock).toHaveBeenCalledWith({
      userIds: ["user_operator"],
      timeZone: expect.any(String)
    });
  });

  it("surfaces partial scanner freshness in the page badge", async () => {
    getPsycheMetricsViewMock.mockResolvedValueOnce({
      metrics: {
        ...emptyMetrics,
        context: {
          ...emptyMetrics.context,
          freshness: {
            status: "partial",
            lastSuccessfulAt: "2026-05-14T17:00:00.000Z",
            lastAttemptAt: "2026-05-14T18:00:00.000Z",
            warningCount: 1,
            warnings: ["codex failed"]
          }
        }
      }
    });

    renderPage();

    expect(
      await screen.findByText("Scanner freshness partial")
    ).toBeInTheDocument();
  });

  it("retries a failed metric request without losing page context", async () => {
    getPsycheMetricsViewMock
      .mockRejectedValueOnce(new Error("Metrics request failed"))
      .mockResolvedValueOnce({ metrics: emptyMetrics });

    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Psyche Metrics" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Psyche metrics workspace: 0")
    ).toBeInTheDocument();
    expect(getPsycheMetricsViewMock).toHaveBeenCalledTimes(2);
  });
});
