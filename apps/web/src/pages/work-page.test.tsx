import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workApiMocks = vi.hoisted(() => ({
  getWorkContext: vi.fn(),
  getWorkRelationships: vi.fn(),
  getWorkSettings: vi.fn(),
  getJobApplication: vi.fn(),
  getJobOpportunity: vi.fn(),
  getOpportunityCampaign: vi.fn(),
  getWorkSupportingRecord: vi.fn(),
  listJobApplications: vi.fn(),
  listJobOpportunities: vi.fn(),
  listOpportunityCampaigns: vi.fn(),
  listWorkEngagements: vi.fn(),
  listWorkMetricDefinitions: vi.fn(),
  listWorkOrganizations: vi.fn(),
  listWorkSupportingRecords: vi.fn(),
  updateOpportunitySearchSetting: vi.fn(),
  recordWorkCheckIn: vi.fn(),
  replaceWorkRelationships: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  searchLocalRecords: vi.fn()
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

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...apiMocks
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
  workApiMocks.getWorkSettings.mockResolvedValue({
    settings: [
      {
        ownerUserId: "user_operator",
        lookingForOpportunities: true,
        revision: 4
      }
    ]
  });
  workApiMocks.getWorkRelationships.mockResolvedValue({
    links: [],
    related: []
  });
  workApiMocks.getJobApplication.mockResolvedValue({
    application: applications[0]
  });
  workApiMocks.listWorkEngagements.mockResolvedValue(list(currentEngagements));
  workApiMocks.listWorkOrganizations.mockResolvedValue(list(organizations));
  workApiMocks.listOpportunityCampaigns.mockResolvedValue(list(campaigns));
  workApiMocks.listJobOpportunities.mockResolvedValue(list(opportunities));
  workApiMocks.getJobOpportunity.mockResolvedValue({
    opportunity: opportunities[0]
  });
  workApiMocks.getOpportunityCampaign.mockResolvedValue({
    campaign: campaigns[0]
  });
  workApiMocks.getWorkSupportingRecord.mockResolvedValue({
    record: { id: "supporting_record", revision: 1 }
  });
  workApiMocks.listJobApplications.mockResolvedValue(list(applications));
  workApiMocks.listWorkMetricDefinitions.mockResolvedValue({ definitions });
  workApiMocks.listWorkSupportingRecords.mockResolvedValue(list([]));
  workApiMocks.updateOpportunitySearchSetting.mockResolvedValue({
    settings: { lookingForOpportunities: false, revision: 5 }
  });
  workApiMocks.recordWorkCheckIn.mockResolvedValue({ replayed: false });
  workApiMocks.replaceWorkRelationships.mockResolvedValue({
    links: [],
    related: []
  });
  apiMocks.searchLocalRecords.mockResolvedValue({ results: [] });
}

function createWorkQueryClient(gcTime = 0) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime },
      mutations: { retry: false }
    }
  });
}

function renderWork(
  route = "/work?tab=overview",
  queryClient = createWorkQueryClient()
) {
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  shellState.selectedUserIds = ["user_operator"];
  configureApi();
});

afterEach(() => {
  cleanup();
});

describe("permanent Work experience", () => {
  it("renders every permanent section with concurrent jobs and an adjacent active search", async () => {
    renderWork();

    const workHeading = await screen.findByRole("heading", {
      name: "Work",
      level: 1
    });
    expect(workHeading).toBeInTheDocument();
    const workSurface = workHeading.closest("[data-work-surface='ready']");
    expect(workSurface).not.toBeNull();
    expect(workSurface?.className).toContain("[&_button]:min-h-11");
    expect(workSurface?.className).toContain("[&_select]:min-h-11");
    const workMain = workSurface?.querySelector("main");
    expect(workMain).toHaveClass(
      "grid-cols-[minmax(0,1fr)]",
      "[&>*]:min-w-0"
    );
    expect(workMain?.firstElementChild).toHaveClass(
      "min-w-0",
      "grid-cols-1",
      "[&>*]:min-w-0"
    );
    const sections = screen.getByRole("navigation", { name: "Work sections" });
    const mobileSectionTrigger = screen.getByRole("button", {
      name: "Work sections: Overview"
    });
    expect(mobileSectionTrigger).toHaveClass("md:hidden", "min-h-14");
    expect(sections).toHaveClass("hidden", "md:block");
    expect(sections.className).not.toContain("overflow-x");
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
    const currentRolesGroup = screen.getByText("Current roles").parentElement;
    expect(currentRolesGroup).toHaveTextContent("2");
    expect(
      [...(currentRolesGroup?.children ?? [])].map((child) => child.tagName)
    ).toEqual(["DT", "DD", "DD"]);
    expect(screen.getByText("Active searches").parentElement).toHaveTextContent(
      "1"
    );
    expect(
      screen.getByRole("switch", { name: /Looking for work/i })
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
    workApiMocks.getWorkSettings.mockResolvedValue({
      settings: [
        {
          ownerUserId: "user_operator",
          lookingForOpportunities: false,
          revision: 5
        }
      ]
    });
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
      name: /Looking for work/i
    });
    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(switchControl).toHaveTextContent("search history remains available");

    fireEvent.click(screen.getByRole("link", { name: "Job searches" }));
    expect(
      await screen.findByRole("heading", {
        name: "Run more than one job search clearly"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Search is not currently foregrounded")
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Part-time hospitality shifts").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Searches Goals and criteria"
      })
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: "Job search views: Searches" })
    ).toHaveClass("lg:hidden", "min-h-14");
  });

  it("shows only organizations connected to recorded work on the Current work view", async () => {
    workApiMocks.listWorkOrganizations.mockResolvedValue(
      list([
        ...organizations,
        {
          id: "organization_unlinked",
          name: "Unlinked target organization",
          domain: "Not connected to recorded work",
          status: "target",
          revision: 1
        }
      ])
    );

    renderWork("/work?tab=current");

    expect(
      await screen.findByRole("heading", {
        name: "Organizations connected to your work"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Research Laboratory")).toBeInTheDocument();
    expect(screen.getByText("Product Client")).toBeInTheDocument();
    expect(
      screen.queryByText("Unlinked target organization")
    ).not.toBeInTheDocument();
  });

  it("opens every Work destination from a phone-native menu without a clipped tab rail", async () => {
    renderWork();

    const trigger = await screen.findByRole("button", {
      name: "Work sections: Overview"
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Choose work sections"
    });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Open one focused view. Your other Work information stays available here."
      )
    ).toBeInTheDocument();
    const menu = within(dialog).getByRole("navigation", {
      name: "Work sections"
    });
    expect(
      within(menu).getAllByRole("button", { current: false })
    ).toHaveLength(6);
    expect(
      within(menu).getByRole("button", { current: "page" })
    ).toHaveTextContent("Overview");
    expect(within(menu).getAllByRole("button")).toHaveLength(7);

    fireEvent.click(
      within(menu).getByRole("button", {
        name: /Job searches Separate searches, roles, and targets/
      })
    );

    expect(
      await screen.findByRole("heading", {
        name: "Run more than one job search clearly"
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Work sections: Job searches" })
    ).toHaveClass("md:hidden");
  });

  it("opens a focused role-review view from its URL without loading target or document collections", async () => {
    renderWork("/work?tab=searches&view=roles");

    expect(await screen.findByText("Filter roles")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Job search views: Roles to review"
      })
    ).toHaveClass("lg:hidden");
    expect(workApiMocks.listJobOpportunities).toHaveBeenCalledWith(
      ["user_operator"],
      expect.objectContaining({ limit: 50, sort: "deadline_asc" })
    );
    expect(workApiMocks.listWorkOrganizations).not.toHaveBeenCalled();
    expect(workApiMocks.listWorkSupportingRecords).not.toHaveBeenCalled();
    expect(workApiMocks.getOpportunityCampaign).toHaveBeenCalledWith(
      ["user_operator"],
      "campaign_research"
    );
    expect(screen.queryByText("Role targets")).not.toBeInTheDocument();
  });

  it("loads bounded relationship context for Goals and plans instead of showing a false empty state", async () => {
    workApiMocks.getWorkContext.mockResolvedValue(
      context({
        engagements: [
          {
            ...currentEngagements[0],
            related: [
              {
                entityType: "goal",
                entityId: "goal_research_impact",
                relationship: "supports",
                title: "Deliver dependable clinical research",
                detail: "Keep each claim tied to reproducible evidence."
              }
            ]
          }
        ],
        campaigns: []
      })
    );

    renderWork("/work?tab=plans");

    expect(
      await screen.findByRole("link", {
        name: /Deliver dependable clinical research/
      })
    ).toHaveAttribute("href", "/goals/goal_research_impact");
    expect(workApiMocks.getWorkContext).toHaveBeenCalledWith(
      ["user_operator"],
      expect.objectContaining({ trendWindowDays: 90 })
    );
    expect(
      screen.queryByText("No connected Work context yet")
    ).not.toBeInTheDocument();
  });

  it("loads the selected job search detail for role fit, targets, and search activity", async () => {
    const selectedCampaign = {
      ...campaigns[0],
      roleTargets: [
        {
          id: "role_target_clinical_ai",
          titleFamily: "Clinical AI research leadership",
          seniority: "senior",
          priority: 95
        }
      ],
      organizationTargets: [
        {
          id: "organization_target_lab",
          organizationId: "organization_lab",
          targetTier: "primary",
          status: "researching"
        }
      ],
      searchSources: [
        {
          id: "source_research_teams",
          name: "Research team career pages",
          sourceType: "career_page",
          enabled: true
        }
      ],
      savedQueries: [
        {
          id: "query_clinical_ai",
          title: "Clinical AI leadership",
          queryText: "clinical AI research lead"
        }
      ]
    };
    const { latestEvaluations: _ignored, ...shallowCampaign } = campaigns[0]!;
    workApiMocks.listOpportunityCampaigns.mockResolvedValue(
      list([shallowCampaign, campaigns[1]!])
    );
    workApiMocks.getOpportunityCampaign.mockResolvedValue({
      campaign: selectedCampaign
    });

    const roles = renderWork("/work?tab=searches&view=roles");
    expect(await screen.findByText("88 / 100 fit")).toBeInTheDocument();
    roles.unmount();

    const targets = renderWork("/work?tab=searches&view=targets");
    expect(
      await screen.findByText("Clinical AI research leadership")
    ).toBeInTheDocument();
    expect(screen.getByText("Research Laboratory")).toBeInTheDocument();
    targets.unmount();

    renderWork("/work?tab=searches&view=activity");
    expect(
      await screen.findByText("Research team career pages")
    ).toBeInTheDocument();
    expect(screen.getByText("Clinical AI leadership")).toBeInTheDocument();
  });

  it("opens only the requested document library and leaves the other libraries unloaded", async () => {
    renderWork("/work?tab=documents&view=answers");

    expect(
      await screen.findByRole("heading", { name: "Reusable answers" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Document views: Saved answers" })
    ).toHaveClass("lg:hidden");
    expect(workApiMocks.listWorkSupportingRecords).toHaveBeenCalledTimes(1);
    expect(workApiMocks.listWorkSupportingRecords).toHaveBeenCalledWith(
      ["user_operator"],
      "reusableResponse",
      { limit: 50 }
    );
    expect(screen.queryByText("Positioning profiles")).not.toBeInTheDocument();
    expect(screen.queryByText("Document sets")).not.toBeInTheDocument();
  });

  it("uses a human file name when an application Artifact has no optional label", async () => {
    workApiMocks.listWorkSupportingRecords.mockImplementation(
      async (_userIds, kind) =>
        kind === "documentSet"
          ? list([
              {
                id: "document_set_research",
                title: "Research application files",
                version: 1,
                sealed: false,
                confidentiality: "private",
                approvalState: "reviewed",
                artifactVersions: [
                  {
                    artifactId: "artifact_internal_123",
                    label: "",
                    contentSha256: "a".repeat(64)
                  }
                ]
              }
            ])
          : list([])
    );

    renderWork("/work?tab=documents&view=documents");

    const fileLink = await screen.findByRole("link", {
      name: /Application file/
    });
    expect(fileLink).toHaveAttribute(
      "href",
      "/artifacts/artifact_internal_123"
    );
    expect(fileLink).not.toHaveTextContent("artifact_internal_123");
  });

  it("uses the non-destructive opportunity switch with optimistic revision", async () => {
    renderWork();
    const switchControl = await screen.findByRole("switch", {
      name: /Looking for work/i
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
    expect(screen.getByRole("combobox", { name: "Work" })).toHaveValue(
      "engagement_research"
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      await screen.findByRole("heading", {
        name: "Answer only what is useful today"
      })
    ).toBeInTheDocument();
    const anchoredChoice = screen.getByRole("button", {
      name: "Overall satisfaction: Very high"
    });
    expect(anchoredChoice.className).toContain("min-h-11");
    fireEvent.click(anchoredChoice);
    expect(anchoredChoice).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps application board and list views explicit about truthful submission state", async () => {
    renderWork("/work?tab=applications");

    expect(
      await screen.findByRole("heading", {
        name: "Applications"
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Application pipeline")).toBeInTheDocument();
    expect(screen.getByLabelText("Pipeline stage")).toHaveValue("ready");
    expect(
      screen
        .getByLabelText("Application pipeline")
        .querySelectorAll(":scope > div > section")
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Ready" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Preparing" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("button", { name: "Board view" }).className
    ).toContain("min-h-11");
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

  it("loads named connections only when the Connections section is opened", async () => {
    const summary = renderWork(
      "/work/applications/application_research?section=summary"
    );
    expect(
      await screen.findByRole("heading", {
        name: "Application · Senior machine-learning research engineer",
        level: 1
      })
    ).toBeInTheDocument();
    expect(workApiMocks.getWorkRelationships).not.toHaveBeenCalled();
    summary.unmount();

    workApiMocks.getWorkRelationships.mockResolvedValue({
      links: [
        {
          sourceEntityType: "job_application",
          sourceEntityId: "application_research",
          targetEntityType: "goal",
          targetEntityId: "goal_publication",
          relationship: "supports",
          anchorKey: "career-direction"
        }
      ],
      related: [
        {
          entityType: "goal",
          entityId: "goal_publication",
          relationship: "supports",
          anchorKey: "career-direction",
          direction: "outbound",
          title: "Publish the research thesis",
          detail: "Complete the publication-ready thesis submission."
        }
      ]
    });

    renderWork("/work/applications/application_research?section=connections");

    expect(
      await screen.findByRole("heading", { name: "Connections" })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Publish the research thesis" })
    ).toHaveAttribute("href", "/goals/goal_publication");
    expect(
      screen.getByText("Complete the publication-ready thesis submission.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("goal:goal_publication").closest("details")
    ).toHaveTextContent("Technical details");
    expect(workApiMocks.getWorkRelationships).toHaveBeenCalledWith(
      ["user_operator"],
      "job_application",
      "application_research"
    );
  });

  it("keeps application Summary and Connections free of hidden document-library requests", async () => {
    const summary = renderWork(
      "/work/applications/application_research?section=summary"
    );
    expect(
      await screen.findByRole("heading", {
        name: "Application · Senior machine-learning research engineer",
        level: 1
      })
    ).toBeInTheDocument();
    expect(workApiMocks.listWorkSupportingRecords).not.toHaveBeenCalled();
    summary.unmount();

    renderWork("/work/applications/application_research?section=connections");
    expect(
      await screen.findByRole("heading", { name: "Connections" })
    ).toBeInTheDocument();
    expect(workApiMocks.listWorkSupportingRecords).not.toHaveBeenCalled();
  });

  it("offers smart Forge search instead of an empty connection list", async () => {
    apiMocks.searchLocalRecords.mockResolvedValue({
      results: [
        {
          entityType: "goal",
          entityId: "goal_publication",
          entityKind: null,
          title: "Publish the research thesis",
          detail: "Goal",
          category: "Goals",
          sourceHref: "/goals/goal_publication",
          graphHref: null,
          score: 1,
          evidence: []
        }
      ]
    });
    renderWork("/work/applications/application_research?section=connections");

    expect(
      await screen.findByText("Nothing is connected yet")
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
    const search = screen.getByRole("combobox", {
      name: "Search Forge by name…"
    });
    fireEvent.change(search, { target: { value: "publish" } });
    const result = await screen.findByRole("option", {
      name: /Publish the research thesis/
    });
    expect(result).toBeInTheDocument();
    expect(result).toHaveTextContent("Goal");
    expect(apiMocks.searchLocalRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "publish",
        userIds: ["user_operator"],
        limit: 20
      })
    );
  });

  it("keeps the exact detail opportunity selectable when the bounded list omits it", async () => {
    const outsideOpportunity = {
      ...opportunities[0]!,
      id: "opportunity_outside_bounded_page",
      title: "Opportunity outside the bounded page",
      canonicalUrl: "https://example.test/jobs/outside-bounded-page",
      sourceIdentifier: "outside-bounded-page"
    };
    workApiMocks.getJobOpportunity.mockResolvedValue({
      opportunity: outsideOpportunity
    });

    renderWork(`/work/opportunities/${outsideOpportunity.id}`);

    expect(
      await screen.findByRole("heading", {
        name: outsideOpportunity.title,
        level: 1
      })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start application" }));
    const opportunitySelect = await screen.findByRole("combobox", {
      name: "Role"
    });
    expect(opportunitySelect).toHaveValue(outsideOpportunity.id);
    expect(
      screen.getByRole("option", {
        name: /Opportunity outside the bounded page/
      })
    ).toHaveValue(outsideOpportunity.id);
  });

  it("keeps an unlabeled interview participant human-readable and moves the identifier into Technical details", async () => {
    workApiMocks.getWorkSupportingRecord.mockResolvedValue({
      record: {
        id: "interview_research",
        applicationId: "application_research",
        stage: "technical_interview",
        status: "scheduled",
        participantLinks: [
          {
            personId: "person_internal_123",
            label: "",
            role: "Research interviewer"
          }
        ],
        focusAreas: [],
        questionBank: [],
        revision: 1
      }
    });

    renderWork("/work/interviews/interview_research?section=details");

    expect(
      await screen.findByRole("link", { name: /Interview participant/ })
    ).toHaveAttribute("href", "/people/person_internal_123");
    expect(
      screen.getByText("person_internal_123").closest("details")
    ).toHaveTextContent("Technical details");
  });

  it("loads an application's exact opportunity and campaign when bounded overview lists omit them", async () => {
    workApiMocks.getWorkContext.mockResolvedValue(context({ campaigns: [] }));
    workApiMocks.listJobOpportunities.mockResolvedValue(list([]));
    workApiMocks.listOpportunityCampaigns.mockResolvedValue(list([]));

    renderWork(`/work/applications/${applications[0]!.id}`);

    expect(
      await screen.findByRole("heading", {
        name: "Application · Senior machine-learning research engineer",
        level: 1
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Example Research/)).toBeInTheDocument();
    expect(workApiMocks.getJobOpportunity).toHaveBeenCalledWith(
      ["user_operator"],
      "opportunity_research"
    );
    expect(workApiMocks.getOpportunityCampaign).toHaveBeenCalledWith(
      ["user_operator"],
      "campaign_research"
    );
  });

  it("renders a truthful bounded-context notice and an actionable error state", async () => {
    workApiMocks.getWorkContext.mockResolvedValue(
      context({ contextTruncated: true })
    );
    const rendered = renderWork();
    expect(
      await screen.findByText(/showing a shorter summary/i)
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

  it("ignores a cached error from a hidden collection after the user moves to another view", async () => {
    const queryClient = createWorkQueryClient(Number.POSITIVE_INFINITY);
    await expect(
      queryClient.fetchQuery({
        queryKey: ["work", "applications", "user_operator", {}],
        queryFn: async () => {
          throw new Error("Old application-list failure");
        }
      })
    ).rejects.toThrow("Old application-list failure");

    renderWork("/work?tab=documents&view=answers", queryClient);

    expect(
      await screen.findByRole("heading", { name: "Reusable answers" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Old application-list failure")
    ).not.toBeInTheDocument();
    expect(workApiMocks.listJobApplications).not.toHaveBeenCalled();
  });
});
