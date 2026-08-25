import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workApiMocks = vi.hoisted(() => ({
  getWorkContext: vi.fn(),
  listJobApplications: vi.fn(),
  listJobOpportunities: vi.fn(),
  listOpportunityCampaigns: vi.fn(),
  listWorkEngagements: vi.fn(),
  listWorkMetricDefinitions: vi.fn(),
  listWorkOrganizations: vi.fn(),
  listWorkSupportingRecords: vi.fn(),
  updateOpportunitySearchSetting: vi.fn(),
  recordWorkCheckIn: vi.fn()
}));

const shellState = vi.hoisted(() => ({
  selectedUserIds: ["user_operator"],
  snapshot: {
    users: [
      {
        id: "user_operator",
        kind: "human",
        displayName: "Test user"
      }
    ]
  }
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => shellState
}));

vi.mock("@/lib/work-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/work-api")>()),
  ...workApiMocks
}));

import { WorkPage } from "@/pages/work-page-root";

const currentEngagements = [
  {
    id: "engagement_research",
    title: "Research appointment",
    roleFunction: "Machine-learning research",
    organizationId: "organization_lab",
    status: "current" as const,
    priority: "high",
    engagementType: "appointment",
    startDate: "2025-01-01",
    workModel: "hybrid",
    workload: {
      contractedWeeklyHours: 32,
      actualWeeklyHours: 35,
      fullTimeEquivalent: 0.8
    },
    noticePeriod: { value: 3, unit: "months", unknown: false },
    nextAction: "Review the next research objective",
    revision: 3,
    createdAt: "2025-01-01T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z"
  },
  {
    id: "engagement_freelance",
    title: "Freelance product builder",
    roleFunction: "Product engineering",
    organizationId: "organization_client",
    status: "current" as const,
    priority: "normal",
    engagementType: "freelance",
    startDate: "2026-02-01",
    workModel: "remote",
    workload: {
      contractedWeeklyHours: 8,
      actualWeeklyHours: 6,
      fullTimeEquivalent: 0.2
    },
    noticePeriod: { value: 2, unit: "weeks", unknown: false },
    nextAction: "Confirm the next delivery milestone",
    revision: 2,
    createdAt: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-08-22T09:00:00.000Z"
  },
  {
    id: "engagement_planned",
    title: "Planned advisory role",
    roleFunction: "Advisory",
    status: "planned" as const,
    engagementType: "advisory",
    startDate: "2026-11-01",
    revision: 1,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z"
  }
];

const organizations = [
  {
    id: "organization_lab",
    name: "Research Laboratory",
    domain: "Medical artificial intelligence",
    status: "active",
    revision: 1
  },
  {
    id: "organization_client",
    name: "Product Client",
    domain: "Software",
    status: "active",
    revision: 1
  }
];

const campaigns = [
  {
    id: "campaign_research",
    title: "Machine-learning research roles",
    status: "active" as const,
    searchIntent: "full_time_employment",
    currentStage: "reviewing",
    health: "healthy",
    nextAction: "Review two newly discovered roles",
    blockers: [],
    revision: 2,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-08-24T09:00:00.000Z",
    currentCriteria: {
      id: "criteria_research_2",
      version: 2,
      criterionCount: 12
    },
    latestEvaluations: [
      {
        id: "evaluation_1",
        opportunityId: "opportunity_research",
        campaignId: "campaign_research",
        overallScore: 88,
        hardGateResult: "pass",
        confidence: 0.9
      }
    ]
  },
  {
    id: "campaign_shifts",
    title: "Part-time hospitality shifts",
    status: "paused" as const,
    searchIntent: "shift_work",
    currentStage: "paused",
    health: "attention",
    nextAction: "Decide whether to resume",
    blockers: [],
    revision: 1,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z",
    currentCriteria: {
      id: "criteria_shifts_1",
      version: 1,
      criterionCount: 7
    }
  }
];

const opportunities = [
  {
    id: "opportunity_research",
    title: "Senior machine-learning research engineer",
    employerName: "Example Research",
    canonicalUrl: "https://example.test/jobs/research-engineer",
    sourceName: "Example careers",
    sourceIdentifier: "research-engineer-1",
    workModel: "remote",
    disposition: "reviewing",
    availabilityStatus: "live",
    unknowns: ["Exact team size"],
    nextAction: "Confirm publication freedom",
    applicationDeadline: "2026-09-15",
    revision: 2,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-24T09:00:00.000Z"
  }
];

const applications = [
  {
    id: "application_research",
    opportunityId: "opportunity_research",
    primaryCampaignId: "campaign_research",
    criteriaVersionId: "criteria_research_2",
    status: "ready_for_review",
    priority: "high",
    nextAction: "Review the targeted curriculum vitae",
    nextFollowUpAt: "2026-09-01T09:00:00.000Z",
    revision: 3,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-24T09:00:00.000Z"
  }
];

const definitions = [
  {
    id: "metric_overall_satisfaction",
    canonicalKey: "overall_satisfaction",
    displayName: "Overall satisfaction",
    description: "Your overall experience of this work right now.",
    valueKind: "ordinal",
    scale: {
      minimum: 1,
      maximum: 5,
      precision: "ordinal",
      anchors: [
        { value: 1, label: "Very low" },
        { value: 3, label: "Mixed" },
        { value: 5, label: "Very high" }
      ]
    },
    version: 1,
    enabled: true,
    isBuiltin: true
  },
  {
    id: "metric_creativity",
    canonicalKey: "creativity",
    displayName: "Creativity",
    description: "Room to make, invent, and shape the work.",
    valueKind: "ordinal",
    scale: {
      minimum: 1,
      maximum: 5,
      precision: "ordinal",
      anchors: [
        { value: 1, label: "Very little" },
        { value: 3, label: "Some" },
        { value: 5, label: "A great deal" }
      ]
    },
    version: 1,
    enabled: true,
    isBuiltin: true
  }
];

const trends = [
  {
    engagementId: "engagement_research",
    metricKey: "overall_satisfaction",
    metricDefinitionId: "metric_overall_satisfaction",
    metricDefinitionVersion: 1,
    displayName: "Overall satisfaction",
    valueKind: "ordinal",
    scale: definitions[0]!.scale,
    target: {},
    warning: {},
    points: [
      {
        observedAt: "2026-07-15T09:00:00.000Z",
        numericValue: 3,
        categoricalValue: null,
        missingState: "observed",
        sourceKind: "user_entered",
        confirmationState: "confirmed"
      },
      {
        observedAt: "2026-08-15T09:00:00.000Z",
        numericValue: 4,
        categoricalValue: null,
        missingState: "observed",
        sourceKind: "user_entered",
        confirmationState: "confirmed"
      }
    ],
    meaningfulChange: {
      direction: "increased" as const,
      magnitude: 1,
      threshold: 1,
      explanation: "Increased by one anchored step."
    }
  },
  {
    engagementId: "engagement_freelance",
    metricKey: "overall_satisfaction",
    metricDefinitionId: "metric_overall_satisfaction",
    metricDefinitionVersion: 1,
    displayName: "Overall satisfaction",
    valueKind: "ordinal",
    scale: definitions[0]!.scale,
    target: {},
    warning: {},
    points: [
      {
        observedAt: "2026-08-16T09:00:00.000Z",
        numericValue: 5,
        categoricalValue: null,
        missingState: "observed",
        sourceKind: "user_entered",
        confirmationState: "confirmed"
      }
    ]
  }
];

function list<T>(items: T[]) {
  return { items, total: items.length, limit: 50, offset: 0, hasMore: false };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-25T09:00:00.000Z",
    settings: [
      {
        ownerUserId: "user_operator",
        lookingForOpportunities: true,
        revision: 4
      }
    ],
    engagements: currentEngagements.map((engagement) => ({
      ...engagement,
      trends: trends.filter((trend) => trend.engagementId === engagement.id),
      latestCheckIns: [],
      latestObservations: []
    })),
    campaigns,
    metricComparisons: [],
    summary: {
      currentEngagements: 2,
      plannedEngagements: 1,
      pastEngagements: 0,
      activeCampaigns: 1,
      pausedCampaigns: 1,
      blockedCampaigns: 0,
      applicationsNeedingAttention: 1,
      trendWindowDays: 90
    },
    nestedCollectionLimit: 25,
    contextTruncated: false,
    ...overrides
  };
}

function configureApi(overrides: { context?: Record<string, unknown> } = {}) {
  workApiMocks.getWorkContext.mockResolvedValue(overrides.context ?? context());
  workApiMocks.listWorkEngagements.mockResolvedValue(list(currentEngagements));
  workApiMocks.listWorkOrganizations.mockResolvedValue(list(organizations));
  workApiMocks.listOpportunityCampaigns.mockResolvedValue(list(campaigns));
  workApiMocks.listJobOpportunities.mockResolvedValue(list(opportunities));
  workApiMocks.listJobApplications.mockResolvedValue(list(applications));
  workApiMocks.listWorkMetricDefinitions.mockResolvedValue({ definitions });
  workApiMocks.listWorkSupportingRecords.mockResolvedValue(list([]));
  workApiMocks.updateOpportunitySearchSetting.mockResolvedValue({
    settings: { lookingForOpportunities: false, revision: 5 }
  });
  workApiMocks.recordWorkCheckIn.mockResolvedValue({ replayed: false });
}

function renderWork(route = "/work?tab=overview") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <WorkPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  shellState.selectedUserIds = ["user_operator"];
  configureApi();
});

afterEach(() => {
  cleanup();
});

describe("permanent Work experience", () => {
  it("renders every permanent section with concurrent jobs and an adjacent active search", async () => {
    renderWork();

    expect(
      await screen.findByRole("heading", { name: "Work", level: 1 })
    ).toBeInTheDocument();
    const sections = screen.getByRole("navigation", { name: "Work sections" });
    for (const label of [
      "Overview",
      "Current work",
      "Check-ins",
      "Goals and plans",
      "Job searches",
      "Applications",
      "Documents"
    ]) {
      expect(sections).toHaveTextContent(label);
    }
    expect(
      screen.getByRole("heading", { name: "What work are you doing now?" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("Research appointment").length).toBeGreaterThan(
      0
    );
    expect(
      screen.getAllByText("Freelance product builder").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Current roles").parentElement).toHaveTextContent(
      "2"
    );
    expect(screen.getByText("Active searches").parentElement).toHaveTextContent(
      "1"
    );
    expect(
      screen.getByRole("switch", { name: /Looking for opportunities/i })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getAllByText("Machine-learning research roles").length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Review two newly discovered roles").length
    ).toBeGreaterThan(0);
  });

  it("keeps Work useful with no current job and preserves paused search history when opportunity mode is off", async () => {
    workApiMocks.listWorkEngagements.mockResolvedValue(list([]));
    workApiMocks.getWorkContext.mockResolvedValue(
      context({
        settings: [
          {
            ownerUserId: "user_operator",
            lookingForOpportunities: false,
            revision: 5
          }
        ],
        engagements: [],
        summary: {
          currentEngagements: 0,
          plannedEngagements: 0,
          pastEngagements: 0,
          activeCampaigns: 1,
          pausedCampaigns: 1,
          blockedCampaigns: 0,
          applicationsNeedingAttention: 1,
          trendWindowDays: 90
        }
      })
    );
    renderWork();

    expect(
      await screen.findByText("No current job or engagement recorded")
    ).toBeInTheDocument();
    const switchControl = screen.getByRole("switch", {
      name: /Looking for opportunities/i
    });
    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(switchControl).toHaveTextContent("Search history remains available");

    fireEvent.click(screen.getByRole("link", { name: "Job searches" }));
    expect(
      await screen.findByRole("heading", {
        name: "Concurrent Opportunity Campaigns"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Search is not currently foregrounded")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Part-time hospitality shifts").length
    ).toBeGreaterThan(0);
  });

  it("uses the non-destructive opportunity switch with optimistic revision", async () => {
    renderWork();
    const switchControl = await screen.findByRole("switch", {
      name: /Looking for opportunities/i
    });
    fireEvent.click(switchControl);
    await waitFor(() => {
      expect(workApiMocks.updateOpportunitySearchSetting).toHaveBeenCalledWith(
        ["user_operator"],
        { lookingForOpportunities: false, expectedRevision: 4 }
      );
    });
  });

  it("shows confirmed trends per concurrent role and opens the keyboard-operable fast check-in flow", async () => {
    renderWork("/work?tab=check-ins");

    expect(
      await screen.findByRole("heading", {
        name: "How is each role going over time?"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Compare concurrent roles")).toBeInTheDocument();
    expect(screen.getByText("Up 1.0 since last check-in")).toBeInTheDocument();
    expect(screen.getByLabelText("Check-in trend time window")).toHaveValue(
      "90"
    );

    fireEvent.click(screen.getByRole("button", { name: "New check-in" }));
    expect(
      await screen.findByRole("dialog", { name: "Work check-in" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Which work arrangement are you checking in on?"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Work engagement" })
    ).toHaveValue("engagement_research");
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Answer only what is useful today"
      })
    ).toBeInTheDocument();
    const anchoredChoice = screen.getByRole("button", {
      name: "Overall satisfaction: Very high"
    });
    expect(anchoredChoice.className).toContain("min-h-10");
    fireEvent.click(anchoredChoice);
    expect(anchoredChoice).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps application board and list views explicit about truthful submission state", async () => {
    renderWork("/work?tab=applications");

    expect(
      await screen.findByRole("heading", {
        name: "Truthful application pipeline"
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Application pipeline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("link", {
        name: /Senior machine-learning research engineer/i
      })
    ).toHaveAttribute("href", "/work/applications/application_research");
    expect(
      screen.getByText(/Review the targeted curriculum vitae/)
    ).toBeInTheDocument();
  });

  it("renders a truthful bounded-context notice and an actionable error state", async () => {
    workApiMocks.getWorkContext.mockResolvedValue(
      context({ contextTruncated: true })
    );
    const rendered = renderWork();
    expect(
      await screen.findByText(/compound Work context was safely bounded/i)
    ).toBeInTheDocument();
    rendered.unmount();

    workApiMocks.getWorkContext.mockRejectedValue(
      new Error("Work context is temporarily unavailable")
    );
    renderWork();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily unavailable|could not/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
