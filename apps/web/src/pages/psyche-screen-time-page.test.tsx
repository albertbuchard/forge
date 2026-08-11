import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PsycheScreenTimePage } from "@/pages/psyche-screen-time-page";

const {
  getScreenTimeSettingsMock,
  getScreenTimeDayMock,
  getScreenTimeMonthMock,
  getScreenTimeAllTimeMock
} = vi.hoisted(() => ({
  getScreenTimeSettingsMock: vi.fn(),
  getScreenTimeDayMock: vi.fn(),
  getScreenTimeMonthMock: vi.fn(),
  getScreenTimeAllTimeMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getScreenTimeSettings: getScreenTimeSettingsMock,
  getScreenTimeDay: getScreenTimeDayMock,
  getScreenTimeMonth: getScreenTimeMonthMock,
  getScreenTimeAllTime: getScreenTimeAllTimeMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    actions
  }: {
    title: string;
    description: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {actions}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche section nav</div>
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => <div>Area</div>,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PsycheScreenTimePage />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PsycheScreenTimePage", () => {
  it("renders truthful capture health and hourly model context", async () => {
    getScreenTimeSettingsMock.mockResolvedValue({
      settings: {
        userId: "user_operator",
        trackingEnabled: true,
        syncEnabled: true,
        authorizationStatus: "approved",
        captureState: "ready",
        lastCapturedDayKey: "2026-04-05",
        lastCaptureStartedAt: "2026-04-05T07:00:00.000Z",
        lastCaptureEndedAt: "2026-04-05T09:00:00.000Z",
        captureFreshness: "fresh",
        captureAgeHours: 2.5,
        capturedDayCount: 4,
        capturedHourCount: 18,
        captureWindowDays: 7,
        metadata: {
          snapshot_source: "device_activity_report_extension"
        },
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z"
      }
    });
    getScreenTimeDayMock.mockResolvedValue({
      screenTime: {
        date: "2026-04-05",
        settings: {},
        summary: {
          totalActivitySeconds: 5400,
          pickupCount: 14,
          notificationCount: 8,
          firstPickupAt: "2026-04-05T07:12:00.000Z",
          longestActivitySeconds: 2100,
          activeHourCount: 2,
          averageHourlyActivitySeconds: 2700
        },
        hourlySegments: [],
        topApps: [
          {
            id: "safari",
            bundleIdentifier: "com.apple.mobilesafari",
            displayName: "Safari",
            categoryLabel: "Productivity",
            totalActivitySeconds: 1800,
            pickupCount: 4,
            notificationCount: 0
          }
        ],
        topCategories: []
      }
    });
    getScreenTimeMonthMock.mockResolvedValue({
      screenTime: {
        month: "2026-04",
        days: [],
        totals: {
          totalActivitySeconds: 5400,
          pickupCount: 14,
          notificationCount: 8,
          activeDays: 1
        },
        topApps: [],
        topCategories: []
      }
    });
    getScreenTimeAllTimeMock.mockResolvedValue({
      screenTime: {
        summary: {
          dayCount: 4,
          totalActivitySeconds: 7200,
          totalPickups: 22,
          totalNotifications: 10,
          averageDailyActivitySeconds: 1800,
          averageDailyPickups: 5.5
        },
        weekdayPattern: [],
        topApps: [],
        topCategories: []
      }
    });

    renderPage();

    expect(await screen.findByText("Screen Time")).toBeInTheDocument();
    expect(screen.getByText("Psyche section nav")).toBeInTheDocument();
    expect(screen.getByText("fresh")).toBeInTheDocument();
    expect(screen.getByText(/Updated 2.5h ago/i)).toBeInTheDocument();
    expect(screen.getByText(/Hourly model/i)).toBeInTheDocument();
    expect(
      screen.getByText(/device activity report extension/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Safari").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Category detail was not included in this snapshot.")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getScreenTimeDayMock).toHaveBeenCalledWith({
        date: "2026-04-05"
      })
    );
    expect(getScreenTimeMonthMock).toHaveBeenCalledWith({ month: "2026-04" });
  });

  it("switches between month and all-time summaries", async () => {
    getScreenTimeSettingsMock.mockResolvedValue({
      settings: {
        userId: "user_operator",
        trackingEnabled: true,
        syncEnabled: true,
        authorizationStatus: "approved",
        captureState: "ready",
        lastCapturedDayKey: "2026-04-05",
        lastCaptureStartedAt: null,
        lastCaptureEndedAt: null,
        captureFreshness: "stale",
        captureAgeHours: 52,
        capturedDayCount: 2,
        capturedHourCount: 8,
        captureWindowDays: 2,
        metadata: {},
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z"
      }
    });
    getScreenTimeDayMock.mockResolvedValue({
      screenTime: {
        date: "2026-04-05",
        settings: {},
        summary: {
          totalActivitySeconds: 0,
          pickupCount: 0,
          notificationCount: 0,
          firstPickupAt: null,
          longestActivitySeconds: 0,
          activeHourCount: 0,
          averageHourlyActivitySeconds: 0
        },
        hourlySegments: [],
        topApps: [],
        topCategories: []
      }
    });
    getScreenTimeMonthMock.mockResolvedValue({
      screenTime: {
        month: "2026-04",
        days: [],
        totals: {
          totalActivitySeconds: 14400,
          pickupCount: 28,
          notificationCount: 11,
          activeDays: 2
        },
        topApps: [],
        topCategories: []
      }
    });
    getScreenTimeAllTimeMock.mockResolvedValue({
      screenTime: {
        summary: {
          dayCount: 9,
          totalActivitySeconds: 36000,
          totalPickups: 120,
          totalNotifications: 45,
          averageDailyActivitySeconds: 4000,
          averageDailyPickups: 13.3
        },
        weekdayPattern: [],
        topApps: [],
        topCategories: [
          {
            id: "social",
            categoryLabel: "Social",
            totalActivitySeconds: 12000
          }
        ]
      }
    });

    renderPage();

    expect(
      await screen.findByText("Screen Time capture is stale")
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "month" }));
    expect(await screen.findByText("Month summary")).toBeInTheDocument();
    expect(screen.getByText("Active days")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(await screen.findByText("Lifetime summary")).toBeInTheDocument();
    expect(screen.getByText(/Days captured/i)).toBeInTheDocument();
    expect(screen.getByText(/Social/i)).toBeInTheDocument();
  });

  it("does not present a denied empty snapshot as zero device use", async () => {
    getScreenTimeSettingsMock.mockResolvedValue({
      settings: {
        userId: "user_operator",
        trackingEnabled: false,
        syncEnabled: true,
        authorizationStatus: "denied",
        captureState: "needs_authorization",
        lastCapturedDayKey: null,
        lastCaptureStartedAt: null,
        lastCaptureEndedAt: null,
        captureFreshness: "empty",
        captureAgeHours: null,
        capturedDayCount: 0,
        capturedHourCount: 0,
        captureWindowDays: 0,
        metadata: {},
        createdAt: "2026-04-05T09:00:00.000Z",
        updatedAt: "2026-04-05T09:00:00.000Z"
      }
    });
    getScreenTimeDayMock.mockImplementation(
      async ({ date }: { date: string }) => ({
        screenTime: {
          date,
          settings: {},
          summary: {
            totalActivitySeconds: 0,
            pickupCount: 0,
            notificationCount: 0,
            firstPickupAt: null,
            longestActivitySeconds: 0,
            activeHourCount: 0,
            averageHourlyActivitySeconds: 0
          },
          hourlySegments: [],
          topApps: [],
          topCategories: []
        }
      })
    );
    getScreenTimeMonthMock.mockImplementation(
      async ({ month }: { month: string }) => ({
        screenTime: {
          month,
          days: [],
          totals: {
            totalActivitySeconds: 0,
            pickupCount: 0,
            notificationCount: 0,
            activeDays: 0
          },
          topApps: [],
          topCategories: []
        }
      })
    );
    getScreenTimeAllTimeMock.mockResolvedValue({
      screenTime: {
        summary: {
          dayCount: 0,
          totalActivitySeconds: 0,
          totalPickups: 0,
          totalNotifications: 0,
          averageDailyActivitySeconds: 0,
          averageDailyPickups: 0
        },
        weekdayPattern: [],
        topApps: [],
        topCategories: []
      }
    });

    renderPage();

    expect(
      await screen.findByText("Screen Time access is denied")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Zero activity is not assumed/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Captured day on screen")
    ).not.toBeInTheDocument();
  });
});
