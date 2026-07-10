import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VitalsPage } from "@/pages/vitals-page";

const { useForgeShellMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn()
}));

const { getPsycheMetricsViewMock, getVitalsViewMock } = vi.hoisted(() => ({
  getPsycheMetricsViewMock: vi.fn(),
  getVitalsViewMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/lib/api", () => ({
  getPsycheMetricsView: (...args: unknown[]) =>
    getPsycheMetricsViewMock(...args),
  getVitalsView: (...args: unknown[]) => getVitalsViewMock(...args)
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
        <VitalsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("VitalsPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"]
    });
    getVitalsViewMock.mockResolvedValue({
      vitals: {
        summary: {
          trackedDays: 12,
          metricCount: 5,
          latestDateKey: "2026-04-15",
          latestMetricCount: 5,
          categoryBreakdown: [
            { category: "recovery", metricCount: 2, coverageDays: 12 },
            { category: "cardio", metricCount: 1, coverageDays: 7 },
            { category: "composition", metricCount: 2, coverageDays: 10 }
          ]
        },
        metrics: [
          {
            metric: "restingHeartRate",
            label: "Resting heart rate",
            category: "recovery",
            unit: "bpm",
            aggregation: "discrete",
            latestValue: 53,
            latestDateKey: "2026-04-15",
            baselineValue: 55,
            deltaValue: -2,
            coverageDays: 12,
            days: [
              {
                dateKey: "2026-04-14",
                average: 54,
                minimum: 52,
                maximum: 58,
                latest: 54,
                total: null,
                sampleCount: 6,
                latestSampleAt: "2026-04-14T06:30:00.000Z"
              },
              {
                dateKey: "2026-04-15",
                average: 53,
                minimum: 51,
                maximum: 55,
                latest: 53,
                total: null,
                sampleCount: 6,
                latestSampleAt: "2026-04-15T06:30:00.000Z"
              }
            ]
          },
          {
            metric: "heartRateVariabilitySDNN",
            label: "HRV (SDNN)",
            category: "recovery",
            unit: "ms",
            aggregation: "discrete",
            latestValue: 64,
            latestDateKey: "2026-04-15",
            baselineValue: 60,
            deltaValue: 4,
            coverageDays: 12,
            days: [
              {
                dateKey: "2026-04-14",
                average: 61,
                minimum: 58,
                maximum: 64,
                latest: 61,
                total: null,
                sampleCount: 4,
                latestSampleAt: "2026-04-14T06:30:00.000Z"
              },
              {
                dateKey: "2026-04-15",
                average: 64,
                minimum: 62,
                maximum: 66,
                latest: 64,
                total: null,
                sampleCount: 4,
                latestSampleAt: "2026-04-15T06:30:00.000Z"
              }
            ]
          },
          {
            metric: "vo2Max",
            label: "VO2 max",
            category: "cardio",
            unit: "ml/kg/min",
            aggregation: "discrete",
            latestValue: 47.2,
            latestDateKey: "2026-04-15",
            baselineValue: 46.8,
            deltaValue: 0.4,
            coverageDays: 7,
            days: [
              {
                dateKey: "2026-04-15",
                average: 47.2,
                minimum: 47.2,
                maximum: 47.2,
                latest: 47.2,
                total: null,
                sampleCount: 1,
                latestSampleAt: "2026-04-15T07:00:00.000Z"
              }
            ]
          }
        ]
      }
    });
    getPsycheMetricsViewMock.mockResolvedValue({
      metrics: {
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
          }
        },
        metrics: []
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the vitals dashboard with spotlight and metric detail cards", async () => {
    renderPage();

    expect(await screen.findByText("5 live metrics")).toBeInTheDocument();
    expect(screen.getByText("Recovery pulse")).toBeInTheDocument();
    expect(screen.getAllByText("53.0 bpm").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resting heart rate").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Body signals should feel operational, not medical-chart dead."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("12 tracked days across 5 metrics")
    ).toBeInTheDocument();
  });

  it("renders Psyche metrics inside vitals when stored history exists", async () => {
    getPsycheMetricsViewMock.mockResolvedValue({
      metrics: {
        summary: {
          hasData: true,
          trackedDays: 2,
          metricCount: 4,
          latestDateKey: "2026-05-14",
          latestMetricCount: 4,
          categoryBreakdown: [
            { category: "conversationTone", metricCount: 4, coverageDays: 2 }
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
            swearingMessagePercent: 20,
            averageMaxCumulativeRage: 5,
            maxCumulativeRage: 6
          },
          weeklyAverage: {
            rawSwearCount: 6,
            swearingMessagePercent: 20,
            averageMaxCumulativeRage: 5,
            maxCumulativeRage: 6
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
              {
                dateKey: "2026-05-13",
                average: 4,
                minimum: 4,
                maximum: 4,
                latest: 4,
                total: 4,
                sampleCount: 1,
                latestSampleAt: "2026-05-13T00:00:00.000Z"
              },
              {
                dateKey: "2026-05-14",
                average: 8,
                minimum: 8,
                maximum: 8,
                latest: 8,
                total: 8,
                sampleCount: 2,
                latestSampleAt: "2026-05-14T00:00:00.000Z"
              }
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
              {
                dateKey: "2026-05-13",
                average: 12.5,
                minimum: 12.5,
                maximum: 12.5,
                latest: 12.5,
                total: null,
                sampleCount: 8,
                latestSampleAt: "2026-05-13T00:00:00.000Z"
              },
              {
                dateKey: "2026-05-14",
                average: 25,
                minimum: 25,
                maximum: 25,
                latest: 25,
                total: null,
                sampleCount: 12,
                latestSampleAt: "2026-05-14T00:00:00.000Z"
              }
            ]
          },
          {
            metric: "devrageAverageMaxCumulativeRage",
            label: "Average max cumulative rage",
            category: "conversationTone",
            unit: "score",
            aggregation: "discrete",
            latestValue: 5,
            latestDateKey: "2026-05-14",
            baselineValue: 3,
            deltaValue: 2,
            coverageDays: 2,
            days: [
              {
                dateKey: "2026-05-13",
                average: 3,
                minimum: 3,
                maximum: 3,
                latest: 3,
                total: null,
                sampleCount: 1,
                latestSampleAt: "2026-05-13T00:00:00.000Z"
              },
              {
                dateKey: "2026-05-14",
                average: 5,
                minimum: 5,
                maximum: 5,
                latest: 5,
                total: null,
                sampleCount: 2,
                latestSampleAt: "2026-05-14T00:00:00.000Z"
              }
            ]
          },
          {
            metric: "devrageMaxCumulativeRage",
            label: "Max cumulative rage",
            category: "conversationTone",
            unit: "score",
            aggregation: "discrete",
            latestValue: 6,
            latestDateKey: "2026-05-14",
            baselineValue: 4,
            deltaValue: 2,
            coverageDays: 2,
            days: [
              {
                dateKey: "2026-05-13",
                average: 4,
                minimum: 4,
                maximum: 4,
                latest: 4,
                total: null,
                sampleCount: 1,
                latestSampleAt: "2026-05-13T00:00:00.000Z"
              },
              {
                dateKey: "2026-05-14",
                average: 6,
                minimum: 6,
                maximum: 6,
                latest: 6,
                total: null,
                sampleCount: 2,
                latestSampleAt: "2026-05-14T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    });

    renderPage();

    expect(await screen.findByText("Psyche metrics")).toBeInTheDocument();
    expect(
      screen.getByText("Conversation tone alongside body signals")
    ).toBeInTheDocument();
    expect(screen.getByText("Cumulative rage profile")).toBeInTheDocument();
    expect(screen.getByText("Max rage peak")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Explain devrage baseline" })
    );
    expect(screen.getAllByText("Baseline calculation").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByText("Devrage swears").length).toBeGreaterThan(0);
  });
});
