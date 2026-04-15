import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VitalsPage } from "@/pages/vitals-page";

const { useForgeShellMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn()
}));

const { getVitalsViewMock } = vi.hoisted(() => ({
  getVitalsViewMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/lib/api", () => ({
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
              { dateKey: "2026-04-14", average: 54, minimum: 52, maximum: 58, latest: 54, total: null, sampleCount: 6, latestSampleAt: "2026-04-14T06:30:00.000Z" },
              { dateKey: "2026-04-15", average: 53, minimum: 51, maximum: 55, latest: 53, total: null, sampleCount: 6, latestSampleAt: "2026-04-15T06:30:00.000Z" }
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
              { dateKey: "2026-04-14", average: 61, minimum: 58, maximum: 64, latest: 61, total: null, sampleCount: 4, latestSampleAt: "2026-04-14T06:30:00.000Z" },
              { dateKey: "2026-04-15", average: 64, minimum: 62, maximum: 66, latest: 64, total: null, sampleCount: 4, latestSampleAt: "2026-04-15T06:30:00.000Z" }
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
              { dateKey: "2026-04-15", average: 47.2, minimum: 47.2, maximum: 47.2, latest: 47.2, total: null, sampleCount: 1, latestSampleAt: "2026-04-15T07:00:00.000Z" }
            ]
          }
        ]
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
    expect(screen.getByText("Body signals should feel operational, not medical-chart dead.")).toBeInTheDocument();
    expect(screen.getByText("12 tracked days across 5 metrics")).toBeInTheDocument();
  });
});
