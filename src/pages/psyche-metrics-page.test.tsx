import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PsycheMetricsPage } from "@/pages/psyche-metrics-page";

const { getPsycheMetricsViewMock } = vi.hoisted(() => ({
  getPsycheMetricsViewMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getPsycheMetricsView: (...args: unknown[]) => getPsycheMetricsViewMock(...args)
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
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche section nav</div>
}));

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

const emptyMetrics = {
  summary: {
    hasData: false,
    trackedDays: 0,
    metricCount: 0,
    latestDateKey: null,
    latestMetricCount: 0,
    categoryBreakdown: []
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
      swearingMessagePercent: 0
    },
    weeklyAverage: {
      rawSwearCount: 0,
      swearingMessagePercent: 0
    },
    sync: {
      fullSyncCompletedAt: null,
      lastDailySyncAt: null,
      lastSyncedDateKey: null
    }
  },
  metrics: []
};

describe("PsycheMetricsPage", () => {
  beforeEach(() => {
    getPsycheMetricsViewMock.mockResolvedValue({ metrics: emptyMetrics });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a quiet empty state when no stored metric rows exist", async () => {
    renderPage();

    expect(await screen.findByText("Psyche Metrics")).toBeInTheDocument();
    expect(screen.getAllByText("No daily metrics yet").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/after the first local backfill finds conversations/i)
    ).toBeInTheDocument();
  });

  it("renders devrage metric plots and summary statistics", async () => {
    getPsycheMetricsViewMock.mockResolvedValue({
      metrics: {
        summary: {
          hasData: true,
          trackedDays: 2,
          metricCount: 2,
          latestDateKey: "2026-05-14",
          latestMetricCount: 2,
          categoryBreakdown: [
            { category: "conversationTone", metricCount: 2, coverageDays: 2 }
          ]
        },
        context: {
          generatedAt: "2026-05-14T00:00:00.000Z",
          conversationsScanned: 3,
          sourceCount: 1,
          messagesScanned: 30,
          messagesWithSwears: 6,
          totalSwears: 12,
          dailyAverage: {
            rawSwearCount: 6,
            swearingMessagePercent: 20
          },
          weeklyAverage: {
            rawSwearCount: 6,
            swearingMessagePercent: 20
          },
          sync: {
            fullSyncCompletedAt: "2026-05-14T00:00:00.000Z",
            lastDailySyncAt: null,
            lastSyncedDateKey: null
          }
        },
        metrics: [
          {
            metric: "devrageSwearCount",
            label: "Devrage swears",
            category: "conversationTone",
            unit: "swears",
            aggregation: "cumulative",
            latestValue: 8,
            latestDateKey: "2026-05-14",
            baselineValue: 4,
            deltaValue: 4,
            coverageDays: 2,
            days: [
              { dateKey: "2026-05-13", average: 4, minimum: 4, maximum: 4, latest: 4, total: 4, sampleCount: 1, latestSampleAt: "2026-05-13T00:00:00.000Z" },
              { dateKey: "2026-05-14", average: 8, minimum: 8, maximum: 8, latest: 8, total: 8, sampleCount: 2, latestSampleAt: "2026-05-14T00:00:00.000Z" }
            ]
          },
          {
            metric: "swearingMessagePercent",
            label: "Swearing messages",
            category: "conversationTone",
            unit: "%",
            aggregation: "discrete",
            latestValue: 25,
            latestDateKey: "2026-05-14",
            baselineValue: 12.5,
            deltaValue: 12.5,
            coverageDays: 2,
            days: [
              { dateKey: "2026-05-13", average: 12.5, minimum: 12.5, maximum: 12.5, latest: 12.5, total: null, sampleCount: 8, latestSampleAt: "2026-05-13T00:00:00.000Z" },
              { dateKey: "2026-05-14", average: 25, minimum: 25, maximum: 25, latest: 25, total: null, sampleCount: 12, latestSampleAt: "2026-05-14T00:00:00.000Z" }
            ]
          }
        ]
      }
    });

    renderPage();

    expect(await screen.findByText("2 daily metrics")).toBeInTheDocument();
    expect(screen.getByText("Devrage count")).toBeInTheDocument();
    expect(screen.getByText("Summary statistics")).toBeInTheDocument();
    expect(screen.getByText(/12 total swears across stored history/i)).toBeInTheDocument();
    expect(screen.getAllByText("Devrage swears").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Period min").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Period avg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Period max").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 swears").length).toBeGreaterThan(0);
    expect(screen.getByText("6 swears")).toBeInTheDocument();
    expect(screen.getAllByText("8 swears").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /full screen/i }).length).toBeGreaterThan(0);
  });
});
