import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PsycheMetricsWorkspace } from "@/components/psyche/psyche-metrics-workspace";
import type {
  PsycheMetricDayRecord,
  PsycheMetricsViewData
} from "@/lib/psyche-types";

const metricDays: PsycheMetricDayRecord[] = [
  {
    dateKey: "2026-05-06",
    average: 4,
    minimum: 4,
    maximum: 4,
    latest: 4,
    total: 4,
    sampleCount: 2,
    latestSampleAt: "2026-05-06T18:00:00.000Z",
    sourceRecords: []
  },
  {
    dateKey: "2026-05-08",
    average: 0,
    minimum: 0,
    maximum: 0,
    latest: 0,
    total: 0,
    sampleCount: 2,
    latestSampleAt: "2026-05-08T18:00:00.000Z",
    sourceRecords: []
  },
  {
    dateKey: "2026-05-14",
    average: 8,
    minimum: 8,
    maximum: 8,
    latest: 8,
    total: 8,
    sampleCount: 3,
    latestSampleAt: "2026-05-14T18:00:00.000Z",
    sourceRecords: []
  }
];

function makeMetric(
  metric: string,
  label: string,
  unit: string,
  aggregation: "discrete" | "cumulative",
  values = metricDays
): PsycheMetricsViewData["metrics"][number] {
  return {
    metric,
    label,
    family: "conversation",
    category: "conversationTone",
    unit,
    aggregation,
    cadence: "daily",
    sampleUnit:
      metric === "swearingMessagePercent" ? "messages" : "conversations",
    definition: {
      description: `${label} description`,
      calculation: `${label} calculation`,
      interpretation: `${label} interpretation limit`,
      missingness:
        "No stored day means no authoritative scanner reading. A stored zero is measured."
    },
    confidence: {
      status: "not_estimated",
      rationale:
        "Deterministic aggregate; no calibration or uncertainty model is available."
    },
    source: {
      kind: "conversation_scanner",
      label: "Local conversation scanner",
      href: null,
      ownerAttribution: "unattributed"
    },
    latestValue: 8,
    latestDateKey: "2026-05-14",
    baselineValue: 4,
    deltaValue: 4,
    coverageDays: 3,
    days: values
  };
}

const moodMetric: PsycheMetricsViewData["metrics"][number] = {
  metric: "reportedEmotionIntensity",
  label: "Reported emotion intensity",
  family: "mood",
  category: "mood",
  unit: "/100",
  aggregation: "discrete",
  cadence: "event_based",
  sampleUnit: "emotion ratings",
  definition: {
    description:
      "Average intensity of emotions explicitly entered on dated trigger reports.",
    calculation:
      "Arithmetic mean of report-entered 0-100 emotion intensities for each local day.",
    interpretation:
      "Describes intensity without inferring valence, cause, or diagnosis.",
    missingness:
      "A day without a dated emotion report is no observation, not zero emotion."
  },
  confidence: {
    status: "not_estimated",
    rationale:
      "Deterministic aggregate; no calibration or uncertainty model is available."
  },
  source: {
    kind: "trigger_reports",
    label: "Dated trigger-report emotions",
    href: "/psyche/reports",
    ownerAttribution: "attributed"
  },
  latestValue: 60,
  latestDateKey: "2026-05-14",
  baselineValue: 30,
  deltaValue: 30,
  coverageDays: 2,
  days: [
    {
      dateKey: "2026-05-06",
      average: 30,
      minimum: 20,
      maximum: 40,
      latest: 30,
      total: null,
      sampleCount: 2,
      latestSampleAt: "2026-05-06T18:00:00.000Z",
      sourceRecords: [
        {
          sourceType: "trigger_report",
          sourceId: "report_alex_old",
          label: "Alex evening report",
          href: "/psyche/reports/report_alex_old",
          observedAt: "2026-05-06T17:00:00.000Z",
          recordedAt: "2026-05-06T18:00:00.000Z",
          ownerUserId: "user_alex",
          ownerDisplayName: "Alex",
          value: 30,
          sampleCount: 2
        }
      ]
    },
    {
      dateKey: "2026-05-14",
      average: 60,
      minimum: 40,
      maximum: 80,
      latest: 60,
      total: null,
      sampleCount: 2,
      latestSampleAt: "2026-05-14T18:00:00.000Z",
      sourceRecords: [
        {
          sourceType: "trigger_report",
          sourceId: "report_alex",
          label: "Alex report",
          href: "/psyche/reports/report_alex",
          observedAt: "2026-05-14T17:00:00.000Z",
          recordedAt: "2026-05-14T17:30:00.000Z",
          ownerUserId: "user_alex",
          ownerDisplayName: "Alex",
          value: 40,
          sampleCount: 1
        },
        {
          sourceType: "trigger_report",
          sourceId: "report_sam",
          label: "Sam report",
          href: "/psyche/reports/report_sam",
          observedAt: "2026-05-14T18:00:00.000Z",
          recordedAt: "2026-05-14T18:00:00.000Z",
          ownerUserId: "user_sam",
          ownerDisplayName: "Sam",
          value: 80,
          sampleCount: 1
        }
      ]
    }
  ]
};

const populatedMetrics: PsycheMetricsViewData = {
  summary: {
    hasData: true,
    trackedDays: 3,
    metricCount: 5,
    latestDateKey: "2026-05-14",
    latestMetricCount: 5,
    categoryBreakdown: [
      { category: "conversationTone", metricCount: 4, coverageDays: 3 },
      { category: "mood", metricCount: 1, coverageDays: 2 }
    ],
    familyAvailability: [
      {
        family: "mood",
        status: "available",
        metricCount: 1,
        reason: "Derived from two dated trigger reports."
      },
      {
        family: "urges",
        status: "unsupported",
        metricCount: 0,
        reason: "No dated canonical urge-intensity field exists."
      },
      {
        family: "selfRegulation",
        status: "unsupported",
        metricCount: 0,
        reason: "Planned next moves are not completed outcomes."
      },
      {
        family: "conversation",
        status: "available",
        metricCount: 4,
        reason: "Stored scanner rows are available but unattributed."
      }
    ]
  },
  context: {
    generatedAt: "2026-05-14T18:05:00.000Z",
    conversationsScanned: 7,
    sourceCount: 2,
    messagesScanned: 70,
    messagesWithSwears: 12,
    totalSwears: 24,
    dailyAverage: {
      rawSwearCount: 4,
      swearingMessagePercent: 12,
      averageMaxCumulativeRage: 3,
      maxCumulativeRage: 5
    },
    weeklyAverage: {
      rawSwearCount: 6,
      swearingMessagePercent: 14,
      averageMaxCumulativeRage: 4,
      maxCumulativeRage: 6
    },
    sync: {
      fullSyncCompletedAt: "2026-05-01T09:00:00.000Z",
      lastDailySyncAt: "2026-05-14T18:00:00.000Z",
      lastSyncedDateKey: "2026-05-14"
    },
    freshness: {
      status: "current",
      lastSuccessfulAt: "2026-05-14T18:00:00.000Z",
      lastAttemptAt: "2026-05-14T18:00:00.000Z",
      warningCount: 0,
      warnings: []
    },
    ownerScope: {
      mode: "unscoped_all_data",
      effectiveUserIds: [],
      availableOwners: [
        { userId: "user_alex", displayName: "Alex" },
        { userId: "user_sam", displayName: "Sam" }
      ],
      filterMode: "all_data",
      serverEnforced: false,
      unattributedRecordCount: 7,
      limitation:
        "Owner filtering uses trigger-report attribution; scanner rows are unattributed."
    },
    sources: [
      {
        sourceId: "trigger_reports",
        label: "Trigger reports",
        kind: "trigger_reports",
        recordCount: 3,
        linkedRecordCount: 3,
        href: "/psyche/reports",
        ownerAttribution: "attributed"
      },
      {
        sourceId: "conversation:codex",
        label: "codex",
        kind: "conversation_scanner",
        recordCount: 7,
        linkedRecordCount: 0,
        href: null,
        ownerAttribution: "unattributed"
      }
    ],
    dataQualityWarnings: []
  },
  metrics: [
    makeMetric("devrageSwearCount", "Devrage swears", "swears", "cumulative"),
    makeMetric("swearingMessagePercent", "Swearing messages", "%", "discrete"),
    makeMetric(
      "devrageAverageMaxCumulativeRage",
      "Average max cumulative rage",
      "score",
      "discrete"
    ),
    makeMetric(
      "devrageMaxCumulativeRage",
      "Max cumulative rage",
      "score",
      "discrete"
    ),
    moodMetric
  ]
};

const emptyMetrics: PsycheMetricsViewData = {
  ...populatedMetrics,
  summary: {
    hasData: false,
    trackedDays: 0,
    metricCount: 0,
    latestDateKey: null,
    latestMetricCount: 0,
    categoryBreakdown: [],
    familyAvailability: populatedMetrics.summary.familyAvailability.map(
      (family) =>
        family.status === "available"
          ? { ...family, status: "no_data" as const, metricCount: 0 }
          : family
    )
  },
  context: {
    ...populatedMetrics.context,
    conversationsScanned: 0,
    sourceCount: 0,
    messagesScanned: 0,
    messagesWithSwears: 0,
    totalSwears: 0,
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
      ...populatedMetrics.context.ownerScope,
      availableOwners: [],
      unattributedRecordCount: 0
    },
    sources: [],
    dataQualityWarnings: []
  },
  metrics: []
};

const scopedMoodMetric: PsycheMetricsViewData["metrics"][number] = {
  ...moodMetric,
  latestValue: 40,
  baselineValue: 30,
  deltaValue: 10,
  days: moodMetric.days.map((day) =>
    day.dateKey === "2026-05-14"
      ? {
          ...day,
          average: 40,
          minimum: 40,
          maximum: 40,
          latest: 40,
          sampleCount: 1,
          sourceRecords: day.sourceRecords.filter(
            (record) => record.ownerUserId === "user_alex"
          )
        }
      : day
  )
};

const scopedMetrics: PsycheMetricsViewData = {
  summary: {
    hasData: true,
    trackedDays: 2,
    metricCount: 1,
    latestDateKey: "2026-05-14",
    latestMetricCount: 1,
    categoryBreakdown: [{ category: "mood", metricCount: 1, coverageDays: 2 }],
    familyAvailability: populatedMetrics.summary.familyAvailability.map(
      (family) =>
        family.family === "conversation"
          ? {
              ...family,
              status: "unsupported" as const,
              metricCount: 0,
              reason:
                "Conversation scanner rows have no canonical owner attribution and are excluded from owner-scoped responses."
            }
          : family
    )
  },
  context: {
    ...populatedMetrics.context,
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
      status: "not_applicable",
      lastSuccessfulAt: null,
      lastAttemptAt: null,
      warningCount: 0,
      warnings: []
    },
    ownerScope: {
      mode: "scoped",
      effectiveUserIds: ["user_alex"],
      availableOwners: [{ userId: "user_alex", displayName: "Alex" }],
      filterMode: "server_attribution",
      serverEnforced: true,
      unattributedRecordCount: 0,
      limitation:
        "Only trigger reports attributed to the effective user IDs are included. Unattributed trigger reports and all conversation scanner rows are excluded because conversation ownership is unavailable."
    },
    sources: [
      {
        sourceId: "trigger_reports",
        label: "Trigger reports",
        kind: "trigger_reports",
        recordCount: 2,
        linkedRecordCount: 2,
        href: "/psyche/reports",
        ownerAttribution: "attributed"
      }
    ],
    dataQualityWarnings: []
  },
  metrics: [scopedMoodMetric]
};

function renderWorkspace(metrics = populatedMetrics) {
  return render(
    <MemoryRouter>
      <PsycheMetricsWorkspace metrics={metrics} />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
});

describe("PsycheMetricsWorkspace", () => {
  it("states family availability, provenance, and confidence without inference", () => {
    renderWorkspace();

    expect(
      screen.getByRole("heading", {
        name: "What this metric view can substantiate"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("4 metrics available")).toBeInTheDocument();
    expect(screen.getByText("1 metric available")).toBeInTheDocument();
    expect(screen.getAllByText("Not measured here")).toHaveLength(2);
    expect(screen.getAllByText("Uncertainty not estimated")).not.toHaveLength(
      0
    );
    expect(screen.getByText("Unscoped all-data response")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Trigger reports" })
    ).toHaveAttribute("href", "/psyche/reports");
    expect(
      screen.getByText(/not clinical assessments and do not establish cause/i)
    ).toBeInTheDocument();
  });

  it("filters the calendar window and preserves a measured zero in the reading table", () => {
    renderWorkspace();

    expect(screen.getByText("3 of 30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByText("2 of 7")).toBeInTheDocument();
    expect(screen.getAllByText("2 observed, 5 missing")).toHaveLength(4);

    fireEvent.click(screen.getByText("Reading table (2)"));
    expect(screen.getByText("0 swears")).toBeInTheDocument();
    expect(screen.getByText("2 conversations")).toBeInTheDocument();
  });

  it("shows the dated mood signal with event-based missingness and source links", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Mood" }));

    expect(
      screen.getByRole("heading", {
        name: "Reported emotion intensity"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/without inferring valence, cause, or diagnosis/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/28 without a report/i)).not.toHaveLength(0);
    expect(
      screen.getByText(/no observation, not zero emotion/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reading table (2)"));
    expect(
      screen.getByRole("link", { name: "Alex evening report" })
    ).toHaveAttribute("href", "/psyche/reports/report_alex_old");
    expect(screen.queryByText(/mood score/i)).not.toBeInTheDocument();
  });

  it("keeps unsupported urge and self-regulation families explicit", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Urges" }));
    expect(
      screen.getByRole("heading", {
        name: "Urges cannot be derived from canonical records"
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/no dated canonical urge-intensity field exists/i)
    ).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Self-regulation" }));
    expect(
      screen.getAllByText(/planned next moves are not completed outcomes/i)
    ).not.toHaveLength(0);
  });

  it("filters attributed report samples by owner and excludes unattributed conversation rows", () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Owner scope"), {
      target: { value: "user_sam" }
    });

    expect(screen.getByText("1 of 30")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reported emotion intensity/i })
    ).toHaveTextContent("80.0 /100");
    expect(
      screen.queryByRole("button", { name: /devrage swears/i })
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Sam")).not.toHaveLength(0);
  });

  it("renders a server-enforced owner scope without foreign or conversation evidence", () => {
    renderWorkspace(scopedMetrics);

    expect(screen.getByLabelText("Owner scope")).toHaveDisplayValue(
      "All permitted owners"
    );
    expect(screen.getByText("Server-enforced")).toBeInTheDocument();
    expect(screen.getByText("Not applicable")).toBeInTheDocument();
    expect(
      screen.getByText("All permitted attributed owners")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /conversation records are unavailable in this owner scope/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/all conversation scanner rows are excluded/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("codex")).not.toBeInTheDocument();
    expect(screen.queryByText("Sam")).not.toBeInTheDocument();
    expect(screen.queryByText("Sam report")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(
      screen.getByRole("heading", {
        name: "Conversation signals are unavailable in owner scope"
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/no canonical owner attribution/i)
    ).not.toHaveLength(0);
  });

  it("selects one metric detail at a time and keeps delta direction neutral", () => {
    renderWorkspace();

    fireEvent.click(
      screen.getByRole("button", { name: /^max cumulative rage/i })
    );

    const detail = document.getElementById("psyche-metric-detail");
    expect(detail).not.toBeNull();
    expect(
      within(detail as HTMLElement).getByRole("heading", {
        name: "Max cumulative rage"
      })
    ).toBeInTheDocument();
    expect(
      within(detail as HTMLElement).getByText(
        "No good or bad direction assigned"
      )
    ).toBeInTheDocument();
    expect(
      within(detail as HTMLElement).getByText(
        "Max cumulative rage interpretation limit"
      )
    ).toBeInTheDocument();
  });

  it("shows partial scanner freshness and retains the last successful timestamp", () => {
    renderWorkspace({
      ...populatedMetrics,
      context: {
        ...populatedMetrics.context,
        freshness: {
          status: "partial",
          lastSuccessfulAt: "2026-05-14T17:00:00.000Z",
          lastAttemptAt: "2026-05-14T18:00:00.000Z",
          warningCount: 1,
          warnings: ["codex: source scan did not complete"]
        }
      }
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Conversation freshness: Partial"
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "codex: source scan did not complete"
    );
    expect(
      screen.getByText("Last successful sync").parentElement
    ).toHaveTextContent("May 14, 2026");
  });

  it("renders a truthful empty state without triggering a scan", () => {
    renderWorkspace(emptyMetrics);

    expect(
      screen.getByRole("heading", {
        name: "No Psyche metric rows are available"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not scan conversations while rendering/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not measured here")).toHaveLength(4);
    expect(screen.queryByTestId("psyche-metric-chart")).not.toBeInTheDocument();
  });
});
