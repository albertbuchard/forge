import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SleepPage } from "@/pages/sleep-page";
import type {
  SleepPhaseTimeline,
  SleepSessionDetailPayload,
  SleepSessionRecord,
  SleepViewData
} from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const {
  getSleepViewMock,
  getSleepSessionRawDetailMock,
  listPsycheValuesMock,
  listBehaviorPatternsMock,
  listBehaviorsMock,
  listBeliefsMock,
  listTriggerReportsMock,
  patchSleepSessionMock
} = vi.hoisted(() => ({
  getSleepViewMock: vi.fn(),
  getSleepSessionRawDetailMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  listBehaviorPatternsMock: vi.fn(),
  listBehaviorsMock: vi.fn(),
  listBeliefsMock: vi.fn(),
  listTriggerReportsMock: vi.fn(),
  patchSleepSessionMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({
    selectedUserIds: ["user_operator"],
    snapshot: {
      dashboard: {
        goals: [],
        projects: [],
        tasks: [],
        habits: []
      }
    }
  })
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
      <h1>{title}</h1>
      <p>{description}</p>
      {badge ? <span>{badge}</span> : null}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche nav</div>
}));

vi.mock("@/components/workbench-boxes/health/health-boxes", () => ({
  SleepSummaryBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SleepPatternsBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SleepBrowserBox: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: () => <div>Entity link picker</div>
}));

vi.mock("@/lib/api", () => ({
  getSleepView: (...args: unknown[]) => getSleepViewMock(...args),
  getSleepSessionRawDetail: (...args: unknown[]) =>
    getSleepSessionRawDetailMock(...args),
  listPsycheValues: (...args: unknown[]) => listPsycheValuesMock(...args),
  listBehaviorPatterns: (...args: unknown[]) =>
    listBehaviorPatternsMock(...args),
  listBehaviors: (...args: unknown[]) => listBehaviorsMock(...args),
  listBeliefs: (...args: unknown[]) => listBeliefsMock(...args),
  listTriggerReports: (...args: unknown[]) => listTriggerReportsMock(...args),
  patchSleepSession: (...args: unknown[]) => patchSleepSessionMock(...args)
}));

function createSleepSession(
  overrides: Partial<SleepSessionRecord> = {}
): SleepSessionRecord {
  return {
    id: "sleep_latest",
    externalUid: "night_latest",
    pairingSessionId: "pair_1",
    userId: "user_operator",
    source: "apple_health",
    sourceType: "ios_companion",
    sourceDevice: "Omar iPhone",
    sourceTimezone: "Europe/Zurich",
    localDateKey: "2026-04-14",
    startedAt: "2026-04-13T21:45:00.000Z",
    endedAt: "2026-04-14T05:50:00.000Z",
    timeInBedSeconds: 29_100,
    asleepSeconds: 27_000,
    awakeSeconds: 2_100,
    rawSegmentCount: 4,
    sleepScore: 84,
    regularityScore: 77,
    bedtimeConsistencyMinutes: 18,
    wakeConsistencyMinutes: 12,
    stageBreakdown: [
      { stage: "core", seconds: 13_200 },
      { stage: "deep", seconds: 5_400 },
      { stage: "rem", seconds: 8_400 }
    ],
    recoveryMetrics: {},
    sourceMetrics: {},
    links: [],
    annotations: {
      qualitySummary: "",
      notes: "",
      tags: []
    },
    provenance: {},
    derived: {
      efficiency: 0.93,
      restorativeShare: 0.51,
      recoveryState: "recharged"
    },
    createdAt: "2026-04-14T06:00:00.000Z",
    updatedAt: "2026-04-14T06:00:00.000Z",
    ...overrides
  };
}

function createTimeline(
  blocks: SleepPhaseTimeline["blocks"]
): SleepPhaseTimeline {
  return {
    startedAt: "2026-04-13T21:45:00.000Z",
    endedAt: "2026-04-14T05:50:00.000Z",
    totalSeconds: 29_100,
    hasRawSegments: true,
    hasSleepStageData: true,
    blocks
  };
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForCondition(
  condition: () => void,
  timeoutMs = 2500
) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      condition();
      return;
    } catch (error) {
      lastError = error;
      await flushUi();
    }
  }
  throw lastError;
}

function setControlValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SleepPage", () => {
  const latestSession = createSleepSession();
  const olderSession = createSleepSession({
    id: "sleep_older",
    externalUid: "night_older",
    localDateKey: "2026-04-13",
    startedAt: "2026-04-12T22:20:00.000Z",
    endedAt: "2026-04-13T04:55:00.000Z",
    timeInBedSeconds: 24_000,
    asleepSeconds: 21_900,
    awakeSeconds: 2_100,
    rawSegmentCount: 2,
    sleepScore: 64,
    regularityScore: 61,
    bedtimeConsistencyMinutes: 42,
    wakeConsistencyMinutes: 30,
    stageBreakdown: [
      { stage: "core", seconds: 12_300 },
      { stage: "rem", seconds: 6_000 }
    ],
    annotations: {
      qualitySummary: "Travel night",
      notes: "",
      tags: ["travel"]
    },
    derived: {
      efficiency: 0.91,
      restorativeShare: 0.27,
      recoveryState: "fragile"
    }
  });

  const sleepView: SleepViewData = {
    summary: {
      totalSleepSeconds: 48_900,
      averageSleepSeconds: 24_450,
      averageTimeInBedSeconds: 26_550,
      averageSleepScore: 74,
      averageRegularityScore: 69,
      averageEfficiency: 0.92,
      averageRestorativeShare: 0.39,
      reflectiveNightCount: 1,
      linkedNightCount: 0,
      averageBedtimeConsistencyMinutes: 30,
      averageWakeConsistencyMinutes: 21,
      latestBedtime: latestSession.startedAt,
      latestWakeTime: latestSession.endedAt
    },
    latestNight: {
      sleepId: latestSession.id,
      dateKey: latestSession.localDateKey,
      sourceTimezone: latestSession.sourceTimezone,
      startedAt: latestSession.startedAt,
      endedAt: latestSession.endedAt,
      asleepSeconds: latestSession.asleepSeconds,
      timeInBedSeconds: latestSession.timeInBedSeconds,
      awakeSeconds: latestSession.awakeSeconds,
      rawSegmentCount: latestSession.rawSegmentCount,
      score: latestSession.sleepScore,
      regularity: latestSession.regularityScore,
      efficiency: 0.93,
      restorativeShare: 0.51,
      weeklyAverageSleepSeconds: 24_450,
      deltaFromWeeklyAverageSeconds: 2_550,
      bedtimeDriftMinutes: 18,
      wakeDriftMinutes: 12,
      recoveryState: "recharged",
      qualitativeState: "Recharged",
      hasReflection: false,
      hasRawSegments: true,
      qualitySummary: null,
      stageBreakdown: [
        { stage: "core", seconds: 13_200, percentage: 0.489 },
        { stage: "deep", seconds: 5_400, percentage: 0.2 },
        { stage: "rem", seconds: 8_400, percentage: 0.311 }
      ]
    },
    calendarDays: [
      {
        dateKey: "2026-04-13",
        sleepId: olderSession.id,
        startedAt: olderSession.startedAt,
        endedAt: olderSession.endedAt,
        sourceTimezone: olderSession.sourceTimezone,
        sleepHours: 6.08,
        score: olderSession.sleepScore,
        regularity: olderSession.regularityScore,
        efficiency: 0.91,
        recoveryState: "fragile",
        hasReflection: true,
        hasRawSegments: true
      },
      {
        dateKey: "2026-04-14",
        sleepId: latestSession.id,
        startedAt: latestSession.startedAt,
        endedAt: latestSession.endedAt,
        sourceTimezone: latestSession.sourceTimezone,
        sleepHours: 7.5,
        score: latestSession.sleepScore,
        regularity: latestSession.regularityScore,
        efficiency: 0.93,
        recoveryState: "recharged",
        hasReflection: false,
        hasRawSegments: true
      }
    ],
    weeklyTrend: [],
    monthlyPattern: [],
    stageAverages: [
      { stage: "core", averageSeconds: 12_750 },
      { stage: "rem", averageSeconds: 7_200 }
    ],
    linkBreakdown: [],
    sessions: [latestSession, olderSession]
  };

  const rawDetails = new Map<string, SleepSessionDetailPayload>([
    [
      latestSession.id,
      {
        sleep: latestSession,
        phaseTimeline: createTimeline([
          {
            id: "in_bed_1",
            stage: "in_bed",
            label: "In bed",
            lane: "in_bed",
            startedAt: latestSession.startedAt,
            endedAt: latestSession.endedAt,
            durationSeconds: 29_100,
            offsetRatio: 0,
            widthRatio: 1
          },
          {
            id: "core_1",
            stage: "core",
            label: "Core",
            lane: "sleep",
            startedAt: "2026-04-13T22:10:00.000Z",
            endedAt: "2026-04-14T02:15:00.000Z",
            durationSeconds: 14_700,
            offsetRatio: 0.05,
            widthRatio: 0.5
          }
        ]),
        rawSegments: [],
        rawLogs: []
      }
    ],
    [
      olderSession.id,
      {
        sleep: olderSession,
        phaseTimeline: createTimeline([
          {
            id: "older_in_bed",
            stage: "in_bed",
            label: "In bed",
            lane: "in_bed",
            startedAt: olderSession.startedAt,
            endedAt: olderSession.endedAt,
            durationSeconds: 24_000,
            offsetRatio: 0,
            widthRatio: 1
          },
          {
            id: "older_awake",
            stage: "awake",
            label: "Awake",
            lane: "sleep",
            startedAt: "2026-04-13T03:45:00.000Z",
            endedAt: "2026-04-13T04:10:00.000Z",
            durationSeconds: 1_500,
            offsetRatio: 0.78,
            widthRatio: 0.09
          }
        ]),
        rawSegments: [
          {
            id: "seg_older_1",
            externalUid: "seg_older_1",
            importRunId: "run_2",
            pairingSessionId: "pair_1",
            sleepSessionId: olderSession.id,
            userId: "user_operator",
            source: "apple_health",
            sourceType: "healthkit_segment",
            sourceDevice: "Omar iPhone",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-13",
            startedAt: "2026-04-13T03:45:00.000Z",
            endedAt: "2026-04-13T04:10:00.000Z",
            stage: "awake",
            bucket: "awake",
            sourceValue: 2,
            metadata: {},
            provenance: {},
            createdAt: olderSession.createdAt,
            updatedAt: olderSession.updatedAt
          }
        ],
        rawLogs: []
      }
    ]
  ]);

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getSleepViewMock.mockResolvedValue({ sleep: sleepView });
    getSleepSessionRawDetailMock.mockImplementation(async (sleepId: string) => {
      return rawDetails.get(sleepId) ?? rawDetails.get(latestSession.id)!;
    });
    listPsycheValuesMock.mockResolvedValue({ values: [] });
    listBehaviorPatternsMock.mockResolvedValue({ patterns: [] });
    listBehaviorsMock.mockResolvedValue({ behaviors: [] });
    listBeliefsMock.mockResolvedValue({ beliefs: [] });
    listTriggerReportsMock.mockResolvedValue({ reports: [] });
    patchSleepSessionMock.mockResolvedValue({});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    cleanup();
    vi.clearAllMocks();
  });

  async function renderPage() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SleepPage />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    await flushUi();
  }

  function requireButton(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => {
      const aria = candidate.getAttribute("aria-label");
      return aria === label || candidate.textContent?.includes(label);
    }) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }

  function requireLabelControl(label: string) {
    const field = Array.from(container.querySelectorAll("label")).find((candidate) =>
      candidate.textContent?.includes(label)
    );
    expect(field).toBeTruthy();
    const control = field!.querySelector("input, textarea") as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    expect(control).toBeTruthy();
    return control!;
  }

  it("renders a night-first summary, switches calendar selection, and keeps raw data hidden until requested", async () => {
    await renderPage();

    await waitForCondition(() => {
      expect(container.textContent).toContain("Last night");
      expect(container.textContent).toContain("Sleep calendar");
      expect(container.textContent).toContain("Phase timeline");
    });
    expect(container.textContent).not.toContain("Raw segments");

    await act(async () => {
      requireButton("Select sleep for 2026-04-13").click();
    });
    await flushUi();

    await act(async () => {
      requireButton("Show raw data").click();
    });
    await flushUi();

    await waitForCondition(() => {
      expect(getSleepSessionRawDetailMock).toHaveBeenLastCalledWith("sleep_older");
      expect(container.textContent).toContain("Raw segments");
      expect(container.textContent).toMatch(/awake/i);
    });
  });

  it("saves reflection edits back to the selected canonical night", async () => {
    await renderPage();

    await waitForCondition(() => {
      expect(container.textContent).toContain("Last night");
    });

    await act(async () => {
      requireButton("Reflection").click();
    });
    await flushUi();

    const qualityInput = requireLabelControl("Quality summary");
    const notesInput = requireLabelControl("Night notes");
    const tagsInput = requireLabelControl("Tags");

    await act(async () => {
      setControlValue(qualityInput, "Recovered well after travel.");
      setControlValue(notesInput, "Shorter night, but no long wake period.");
      setControlValue(tagsInput, "travel, recovery");
    });
    await flushUi();

    await act(async () => {
      requireButton("Save reflection").click();
    });
    await flushUi();

    await waitForCondition(() => {
      expect(patchSleepSessionMock).toHaveBeenCalledWith("sleep_latest", {
        qualitySummary: "Recovered well after travel.",
        notes: "Shorter night, but no long wake period.",
        tags: ["travel", "recovery"],
        links: []
      });
    });
  });
});

function cleanup() {
  document.body.innerHTML = "";
}
