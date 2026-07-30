import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsRewardsPage } from "@/pages/settings-rewards-page";

const {
  ensureOperatorSessionMock,
  getPsycheOverviewMock,
  getXpMetricsMock,
  listRewardRulesMock,
  patchRewardRuleMock,
  createManualRewardGrantMock,
  shellSnapshot
} = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  getPsycheOverviewMock: vi.fn(),
  getXpMetricsMock: vi.fn(),
  listRewardRulesMock: vi.fn(),
  patchRewardRuleMock: vi.fn(),
  createManualRewardGrantMock: vi.fn(),
  shellSnapshot: {
    goals: [],
    dashboard: { projects: [] },
    tasks: [
      { id: "task_first", title: "First task" },
      { id: "task_second", title: "Second task" }
    ],
    habits: [],
    tags: []
  }
}));

vi.mock("@/lib/api", () => ({
  ensureOperatorSession: ensureOperatorSessionMock,
  getPsycheOverview: getPsycheOverviewMock,
  getXpMetrics: getXpMetricsMock,
  listRewardRules: listRewardRulesMock,
  patchRewardRule: patchRewardRuleMock,
  createManualRewardGrant: createManualRewardGrantMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({
    selectedUserIds: ["user_albert"],
    snapshot: shellSnapshot
  })
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <h1>{title}</h1>
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>,
  SettingsStateFrame: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}));

vi.mock("@/components/xp/xp-command-deck", () => ({
  XpCommandDeck: ({ scopeLabel }: { scopeLabel: string }) => (
    <div>{scopeLabel} progression</div>
  )
}));

const xpMetrics = {
  metrics: {
    scope: { label: "Albert" },
    profile: {
      totalXp: 120,
      level: 2,
      currentLevelXp: 20,
      nextLevelXp: 135,
      xpToNextLevel: 115,
      weeklyXp: 12,
      streakDays: 1
    },
    achievements: [],
    milestoneRewards: [],
    momentumPulse: {},
    recentLedger: [],
    dailyAmbientXp: 0,
    dailyAmbientCap: 50
  }
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

function renderPage(queryClient = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsRewardsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SettingsRewardsPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: { actorLabel: "Albert" }
    });
    getPsycheOverviewMock.mockResolvedValue({
      overview: {
        values: [],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        flashcards: [],
        reports: []
      }
    });
    getXpMetricsMock.mockResolvedValue(xpMetrics);
    listRewardRulesMock.mockResolvedValue({ rules: [] });
  });

  it("loads progression and rewardable Psyche targets for the selected user", async () => {
    renderPage();

    expect(await screen.findByText("Albert progression")).toBeInTheDocument();
    expect(getXpMetricsMock).toHaveBeenCalledWith(
      ["user_albert"],
      expect.any(String)
    );
    expect(getPsycheOverviewMock).toHaveBeenCalledWith(["user_albert"]);
  });

  it("keeps unwrapped Psyche collections in a distinct cache entry", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["forge-psyche-overview", "user_albert"], {
      overview: {
        values: [],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        flashcards: [],
        reports: []
      }
    });

    renderPage(queryClient);

    expect(await screen.findByText("Albert progression")).toBeInTheDocument();
    expect(
      queryClient.getQueryState([
        "forge-psyche-overview",
        "entity-collections",
        "user_albert"
      ])
    ).toBeDefined();
  });

  it("shows a retryable progression error instead of a zero-value state", async () => {
    getXpMetricsMock.mockRejectedValueOnce(new Error("Ledger unavailable"));
    renderPage();

    expect(
      await screen.findByText("Progression could not be loaded")
    ).toBeInTheDocument();
    expect(screen.getByText("Ledger unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry progression" })
    ).toBeEnabled();
    await waitFor(() =>
      expect(getXpMetricsMock).toHaveBeenCalledWith(
        ["user_albert"],
        expect.any(String)
      )
    );
  });

  it("distinguishes an unavailable Psyche target source from an empty list", async () => {
    getPsycheOverviewMock.mockRejectedValueOnce(
      new Error("Psyche unavailable")
    );
    renderPage();

    expect(
      await screen.findByText(/Psyche reward targets could not be loaded/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry Psyche targets" })
    ).toBeEnabled();
  });

  it("keeps the first valid target selected across consecutive grants", async () => {
    createManualRewardGrantMock.mockResolvedValue({
      reward: {
        id: "reward_1",
        deltaXp: 15,
        reasonTitle: "Operator bonus"
      },
      metrics: xpMetrics.metrics
    });
    renderPage();

    const entitySelect = await screen.findByLabelText("Entity id");
    await waitFor(() => expect(entitySelect).toHaveValue("task_first"));
    const submit = screen.getByRole("button", { name: "Issue bonus XP" });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(createManualRewardGrantMock).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => expect(entitySelect).toHaveValue("task_first"));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(createManualRewardGrantMock).toHaveBeenCalledTimes(2)
    );
    const [firstGrant, secondGrant] =
      createManualRewardGrantMock.mock.calls.map(
        ([input]) =>
          input as {
            entityId: string;
            metadata: { idempotencyKey: string };
          }
      );
    expect(firstGrant?.entityId).toBe("task_first");
    expect(secondGrant?.entityId).toBe("task_first");
    expect(firstGrant?.metadata.idempotencyKey).toBeTruthy();
    expect(secondGrant?.metadata.idempotencyKey).toBeTruthy();
    expect(secondGrant?.metadata.idempotencyKey).not.toBe(
      firstGrant?.metadata.idempotencyKey
    );
  });

  it("disables manual grants when the watched target is not valid", async () => {
    renderPage();

    const entitySelect = await screen.findByLabelText("Entity id");
    await waitFor(() => expect(entitySelect).toHaveValue("task_first"));
    fireEvent.change(entitySelect, { target: { value: "forged_task" } });

    expect(
      screen.getByRole("button", { name: "Issue bonus XP" })
    ).toBeDisabled();
    expect(createManualRewardGrantMock).not.toHaveBeenCalled();
  });
});
