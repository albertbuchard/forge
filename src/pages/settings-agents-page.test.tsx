import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAgentsPage } from "@/pages/settings-agents-page";

const {
  ensureOperatorSessionMock,
  getSettingsMock,
  listApprovalRequestsMock,
  getAgentOnboardingMock,
  listAgentRuntimeSessionsMock,
  getAgentRuntimeSessionHistoryMock,
  getOperatorContextMock,
  createAgentTokenMock,
  rotateAgentTokenMock,
  revokeAgentTokenMock,
  approveApprovalRequestMock,
  rejectApprovalRequestMock,
  reconnectAgentRuntimeSessionMock,
  disconnectAgentRuntimeSessionMock,
  logOperatorWorkMock
} = vi.hoisted(() => ({
  ensureOperatorSessionMock: vi.fn(),
  getSettingsMock: vi.fn(),
  listApprovalRequestsMock: vi.fn(),
  getAgentOnboardingMock: vi.fn(),
  listAgentRuntimeSessionsMock: vi.fn(),
  getAgentRuntimeSessionHistoryMock: vi.fn(),
  getOperatorContextMock: vi.fn(),
  createAgentTokenMock: vi.fn(),
  rotateAgentTokenMock: vi.fn(),
  revokeAgentTokenMock: vi.fn(),
  approveApprovalRequestMock: vi.fn(),
  rejectApprovalRequestMock: vi.fn(),
  reconnectAgentRuntimeSessionMock: vi.fn(),
  disconnectAgentRuntimeSessionMock: vi.fn(),
  logOperatorWorkMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  ensureOperatorSession: ensureOperatorSessionMock,
  getSettings: getSettingsMock,
  listApprovalRequests: listApprovalRequestsMock,
  getAgentOnboarding: getAgentOnboardingMock,
  listAgentRuntimeSessions: listAgentRuntimeSessionsMock,
  getAgentRuntimeSessionHistory: getAgentRuntimeSessionHistoryMock,
  getOperatorContext: getOperatorContextMock,
  createAgentToken: createAgentTokenMock,
  rotateAgentToken: rotateAgentTokenMock,
  revokeAgentToken: revokeAgentTokenMock,
  approveApprovalRequest: approveApprovalRequestMock,
  rejectApprovalRequest: rejectApprovalRequestMock,
  reconnectAgentRuntimeSession: reconnectAgentRuntimeSessionMock,
  disconnectAgentRuntimeSession: disconnectAgentRuntimeSessionMock,
  logOperatorWork: logOperatorWorkMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/settings/settings-section-nav", () => ({
  SettingsSectionNav: () => <div>Settings nav</div>
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsAgentsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function createRuntimeSession(
  id: string,
  sessionKey: string,
  status: "connected" | "stale",
  lastHeartbeatAt: string
) {
  return {
    id,
    agentId: "agt_openclaw",
    agentLabel: "Forge OpenClaw",
    agentType: "openclaw",
    provider: "openclaw",
    sessionKey,
    sessionLabel: sessionKey,
    actorLabel: "Albert",
    connectionMode: "operator_session",
    status,
    alive: status === "connected",
    baseUrl: "http://127.0.0.1:4317",
    webUrl: "http://127.0.0.1:4317/forge/",
    dataRoot: "/tmp/forge",
    externalSessionId: sessionKey,
    staleAfterSeconds: 120,
    reconnectCount: 0,
    reconnectRequestedAt: null,
    lastError: null,
    lastSeenAt: lastHeartbeatAt,
    lastHeartbeatAt,
    startedAt: "2026-04-21T10:00:00.000Z",
    endedAt: null,
    createdAt: "2026-04-21T10:00:00.000Z",
    updatedAt: lastHeartbeatAt,
    metadata: {},
    recentEvents: [],
    eventCount: 2,
    actionCount: 1,
    reconnectPlan: {
      summary: "Restart OpenClaw.",
      commands: ["openclaw gateway restart"],
      notes: [],
      automationSupported: false
    }
  };
}

describe("SettingsAgentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureOperatorSessionMock.mockResolvedValue({
      session: { actorLabel: "Albert" }
    });
    getSettingsMock.mockResolvedValue({
      settings: {
        profile: {
          operatorName: "Albert"
        },
        agentTokens: [
          {
            id: "tok_1",
            label: "Scoped operator",
            tokenPrefix: "fg_live_abc••••",
            scopes: ["read", "write"],
            agentId: "agent_1",
            agentLabel: "OpenClaw",
            trustLevel: "trusted",
            autonomyMode: "scoped_write",
            approvalMode: "high_impact_only",
            description: "Focused token",
            bootstrapPolicy: {
              mode: "scoped",
              goalsLimit: 5,
              projectsLimit: 8,
              tasksLimit: 10,
              habitsLimit: 6,
              strategiesLimit: 4,
              peoplePageLimit: 0,
              includePeoplePages: false
            },
            scopePolicy: {
              userIds: ["user_forge_bot"],
              projectIds: ["project_alpha"],
              tagIds: ["tag_focus", "tag_client"]
            },
            lastUsedAt: null,
            revokedAt: null,
            createdAt: "2026-04-21T10:00:00.000Z",
            updatedAt: "2026-04-21T10:00:00.000Z",
            status: "active"
          }
        ],
        agents: []
      }
    });
    listApprovalRequestsMock.mockResolvedValue({ approvalRequests: [] });
    getAgentOnboardingMock.mockResolvedValue({
      onboarding: {
        recommendedScopes: ["read", "write"],
        defaultActorLabel: "OpenClaw"
      }
    });
    listAgentRuntimeSessionsMock.mockResolvedValue({ sessions: [] });
    getAgentRuntimeSessionHistoryMock.mockResolvedValue({
      session: { id: "session_1" },
      actions: [],
      events: []
    });
    getOperatorContextMock.mockResolvedValue({
      context: {
        xp: { profile: { level: 4, totalXp: 320 } },
        focusTasks: [],
        activeProjects: [],
        dueHabits: [],
        recommendedNextTask: null,
        currentBoard: {
          backlog: [],
          focus: [],
          inProgress: [],
          blocked: [],
          done: []
        }
      }
    });
  });

  it("shows bootstrap and default scope summaries for managed tokens", async () => {
    renderPage();

    expect(await screen.findByText("Scoped operator")).toBeInTheDocument();
    expect(screen.getByText(/Bootstrap: scoped/i)).toBeInTheDocument();
    expect(
      screen.getByText("Default read scope: 1 user · 1 project · 2 tags")
    ).toBeInTheDocument();
  });

  it("groups repeated runtime sessions under one canonical agent", async () => {
    listAgentRuntimeSessionsMock.mockResolvedValue({
      sessions: [
        createRuntimeSession(
          "ags_new",
          "agent:main:whatsapp:direct:+4474",
          "connected",
          "2026-04-24T08:45:31.395Z"
        ),
        createRuntimeSession(
          "ags_old",
          "agent:main:cron:111",
          "stale",
          "2026-04-23T08:45:31.395Z"
        )
      ]
    });

    renderPage();

    expect(await screen.findByText("Forge OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("2 runtime sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Session history under this agent")
    ).toBeInTheDocument();
  });
});
