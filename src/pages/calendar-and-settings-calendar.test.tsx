import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CalendarPage } from "@/pages/calendar-page";
import { SettingsCalendarPage } from "@/pages/settings-calendar-page";
import { describeGoogleRouteRequirement } from "@/components/calendar/calendar-connection-flow-dialog";
import { ForgeApiError } from "@/lib/api-error";
import { useForgeClipboardStore } from "@/store/use-forge-clipboard";
import type { ForgeSnapshot } from "@/lib/types";

const {
  useForgeShellMock,
  getLifeForceMock,
  getCalendarOverviewMock,
  createWorkBlockTemplateMock,
  patchWorkBlockTemplateMock,
  deleteWorkBlockTemplateMock,
  createTaskTimeboxMock,
  patchTaskTimeboxMock,
  deleteTaskTimeboxMock,
  createCalendarEventMock,
  patchCalendarEventMock,
  deleteCalendarEventMock,
  patchTaskMock,
  ensureOperatorSessionMock,
  getSettingsMock,
  listCalendarConnectionsMock,
  listCalendarResourcesMock,
  discoverCalendarConnectionMock,
  patchSettingsMock,
  getMacOSLocalCalendarStatusMock,
  requestMacOSLocalCalendarAccessMock,
  discoverMacOSLocalCalendarSourcesMock,
  startGoogleCalendarOauthMock,
  getGoogleCalendarOauthSessionMock,
  startMicrosoftCalendarOauthMock,
  testMicrosoftCalendarOauthConfigurationMock,
  getMicrosoftCalendarOauthSessionMock,
  discoverExistingCalendarConnectionMock,
  createCalendarConnectionMock,
  patchCalendarConnectionMock,
  syncCalendarConnectionMock,
  deleteCalendarConnectionMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  getCalendarOverviewMock: vi.fn(),
  createWorkBlockTemplateMock: vi.fn(),
  patchWorkBlockTemplateMock: vi.fn(),
  deleteWorkBlockTemplateMock: vi.fn(),
  createTaskTimeboxMock: vi.fn(),
  patchTaskTimeboxMock: vi.fn(),
  deleteTaskTimeboxMock: vi.fn(),
  createCalendarEventMock: vi.fn(),
  patchCalendarEventMock: vi.fn(),
  deleteCalendarEventMock: vi.fn(),
  patchTaskMock: vi.fn(),
  ensureOperatorSessionMock: vi.fn(),
  getSettingsMock: vi.fn(),
  listCalendarConnectionsMock: vi.fn(),
  listCalendarResourcesMock: vi.fn(),
  discoverCalendarConnectionMock: vi.fn(),
  patchSettingsMock: vi.fn(),
  getMacOSLocalCalendarStatusMock: vi.fn(),
  requestMacOSLocalCalendarAccessMock: vi.fn(),
  discoverMacOSLocalCalendarSourcesMock: vi.fn(),
  startGoogleCalendarOauthMock: vi.fn(),
  getGoogleCalendarOauthSessionMock: vi.fn(),
  startMicrosoftCalendarOauthMock: vi.fn(),
  testMicrosoftCalendarOauthConfigurationMock: vi.fn(),
  getMicrosoftCalendarOauthSessionMock: vi.fn(),
  discoverExistingCalendarConnectionMock: vi.fn(),
  createCalendarConnectionMock: vi.fn(),
  patchCalendarConnectionMock: vi.fn(),
  syncCalendarConnectionMock: vi.fn(),
  deleteCalendarConnectionMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
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
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/lib/api", () => ({
  getLifeForce: getLifeForceMock,
  getCalendarOverview: getCalendarOverviewMock,
  createWorkBlockTemplate: createWorkBlockTemplateMock,
  patchWorkBlockTemplate: patchWorkBlockTemplateMock,
  deleteWorkBlockTemplate: deleteWorkBlockTemplateMock,
  createTaskTimebox: createTaskTimeboxMock,
  patchTaskTimebox: patchTaskTimeboxMock,
  deleteTaskTimebox: deleteTaskTimeboxMock,
  createCalendarEvent: createCalendarEventMock,
  patchCalendarEvent: patchCalendarEventMock,
  deleteCalendarEvent: deleteCalendarEventMock,
  patchTask: patchTaskMock,
  ensureOperatorSession: ensureOperatorSessionMock,
  getSettings: getSettingsMock,
  listCalendarConnections: listCalendarConnectionsMock,
  listCalendarResources: listCalendarResourcesMock,
  discoverCalendarConnection: discoverCalendarConnectionMock,
  patchSettings: patchSettingsMock,
  getMacOSLocalCalendarStatus: getMacOSLocalCalendarStatusMock,
  requestMacOSLocalCalendarAccess: requestMacOSLocalCalendarAccessMock,
  discoverMacOSLocalCalendarSources: discoverMacOSLocalCalendarSourcesMock,
  startGoogleCalendarOauth: startGoogleCalendarOauthMock,
  getGoogleCalendarOauthSession: getGoogleCalendarOauthSessionMock,
  startMicrosoftCalendarOauth: startMicrosoftCalendarOauthMock,
  testMicrosoftCalendarOauthConfiguration: testMicrosoftCalendarOauthConfigurationMock,
  getMicrosoftCalendarOauthSession: getMicrosoftCalendarOauthSessionMock,
  discoverExistingCalendarConnection: discoverExistingCalendarConnectionMock,
  createCalendarConnection: createCalendarConnectionMock,
  patchCalendarConnection: patchCalendarConnectionMock,
  syncCalendarConnection: syncCalendarConnectionMock,
  deleteCalendarConnection: deleteCalendarConnectionMock,
  recommendTaskTimeboxes: vi.fn().mockResolvedValue({ timeboxes: [] })
}));

function createSnapshot(): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-04-03T08:00:00.000Z",
      backend: "node",
      mode: "transitional-node"
    },
    metrics: {
      totalXp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      weeklyXp: 0,
      streakDays: 0,
      comboMultiplier: 1,
      momentumScore: 0,
      topGoalId: null,
      topGoalTitle: null
    },
    dashboard: {
      stats: {
        totalPoints: 0,
        completedThisWeek: 0,
        activeGoals: 0,
        alignmentScore: 0,
        focusTasks: 0,
        overdueTasks: 0,
        dueThisWeek: 0
      },
      goals: [],
      projects: [],
      tasks: [],
      habits: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      notesSummaryByEntity: {},
      gamification: {
        totalXp: 0,
        level: 1,
        currentLevelXp: 0,
        nextLevelXp: 100,
        weeklyXp: 0,
        streakDays: 0,
        comboMultiplier: 1,
        momentumScore: 0,
        topGoalId: null,
        topGoalTitle: null
      },
      achievements: [],
      milestoneRewards: [],
      recentActivity: []
    },
    overview: {
      generatedAt: "2026-04-03T08:00:00.000Z",
      strategicHeader: {
        streakDays: 0,
        level: 1,
        totalXp: 0,
        currentLevelXp: 0,
        nextLevelXp: 100,
        momentumScore: 0,
        focusTasks: 0,
        overdueTasks: 0
      },
      projects: [],
      activeGoals: [],
      topTasks: [],
      dueHabits: [],
      recentEvidence: [],
      achievements: [],
      domainBalance: [],
      neglectedGoals: []
    },
    today: {
      generatedAt: "2026-04-03T08:00:00.000Z",
      directive: {
        task: null,
        goalTitle: null,
        rewardXp: 0,
        sessionLabel: "No directive"
      },
      timeline: [],
      dueHabits: [],
      dailyQuests: [],
      milestoneRewards: [],
      recentHabitRewards: [],
      momentum: {
        streakDays: 0,
        momentumScore: 0,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-04-03T08:00:00.000Z",
      overdueTasks: [],
      blockedTasks: [],
      neglectedGoals: [],
      summary: ""
    },
    users: [],
    strategies: [],
    userScope: {
      selectedUserIds: [],
      selectedUsers: []
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [
      {
        id: "task_1",
        title: "Write the creative brief",
        description: "",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 40,
        plannedDurationSeconds: 1800,
        schedulingRules: null,
        sortOrder: 1,
        completedAt: null,
        createdAt: "2026-04-03T08:00:00.000Z",
        updatedAt: "2026-04-03T08:00:00.000Z",
        tagIds: [],
        time: {
          totalTrackedSeconds: 0,
          totalCreditedSeconds: 0,
          liveTrackedSeconds: 0,
          liveCreditedSeconds: 0,
          manualAdjustedSeconds: 0,
          activeRunCount: 0,
          hasCurrentRun: false,
          currentRunId: null
        }
      }
    ],
    habits: [],
    activity: [],
    activeTaskRuns: []
  };
}

function createLifeForceResponse() {
  return {
    lifeForce: {
      userId: "user_operator",
      dateKey: "2026-04-11",
      baselineDailyAp: 200,
      dailyBudgetAp: 220,
      spentTodayAp: 86,
      remainingAp: 134,
      forecastAp: 172,
      plannedRemainingAp: 86,
      targetBandMinAp: 187,
      targetBandMaxAp: 220,
      instantCapacityApPerHour: 12,
      instantFreeApPerHour: 3.5,
      overloadApPerHour: 0,
      currentDrainApPerHour: 6.2,
      fatigueBufferApPerHour: 2.3,
      sleepRecoveryMultiplier: 1.04,
      readinessMultiplier: 1,
      fatigueDebtCarry: 0,
      stats: [
        {
          key: "life_force",
          label: "Life Force",
          level: 3,
          xp: 12,
          xpToNextLevel: 120,
          costModifier: 1.09
        },
        {
          key: "activation",
          label: "Activation",
          level: 2,
          xp: 9,
          xpToNextLevel: 90,
          costModifier: 0.98
        },
        {
          key: "focus",
          label: "Focus",
          level: 2,
          xp: 9,
          xpToNextLevel: 90,
          costModifier: 0.98
        },
        {
          key: "vigor",
          label: "Vigor",
          level: 2,
          xp: 9,
          xpToNextLevel: 90,
          costModifier: 0.98
        },
        {
          key: "composure",
          label: "Composure",
          level: 2,
          xp: 9,
          xpToNextLevel: 90,
          costModifier: 0.98
        },
        {
          key: "flow",
          label: "Flow",
          level: 2,
          xp: 9,
          xpToNextLevel: 90,
          costModifier: 0.98
        }
      ],
      currentCurve: [
        { minuteOfDay: 0, rateApPerHour: 0, locked: true },
        { minuteOfDay: 480, rateApPerHour: 8, locked: true },
        { minuteOfDay: 720, rateApPerHour: 12, locked: false },
        { minuteOfDay: 1080, rateApPerHour: 8, locked: false },
        { minuteOfDay: 1440, rateApPerHour: 0, locked: false }
      ],
      activeDrains: [],
      plannedDrains: [],
      warnings: [],
      recommendations: ["This is a good moment for deep work."],
      topTaskIdsNeedingSplit: [],
      updatedAt: "2026-04-11T12:00:00.000Z"
    },
    templates: [
      {
        weekday: 6,
        baselineDailyAp: 200,
        points: [
          { minuteOfDay: 0, rateApPerHour: 0, locked: false },
          { minuteOfDay: 480, rateApPerHour: 8, locked: false },
          { minuteOfDay: 720, rateApPerHour: 12, locked: false },
          { minuteOfDay: 1080, rateApPerHour: 8, locked: false },
          { minuteOfDay: 1440, rateApPerHour: 0, locked: false }
        ]
      }
    ]
  };
}

function renderWithRouter(element: React.ReactNode, initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/calendar" element={element} />
          <Route path="/settings/calendar" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.history.replaceState({}, "", "http://localhost:3000/");
  window.localStorage.clear();
  useForgeShellMock.mockReturnValue({
    snapshot: createSnapshot(),
    refresh: vi.fn().mockResolvedValue(undefined)
  });
  getCalendarOverviewMock.mockResolvedValue({
    calendar: {
      generatedAt: "2026-04-03T08:00:00.000Z",
      providers: [],
      connections: [],
      calendars: [],
      events: [],
      workBlockTemplates: [],
      workBlockInstances: [],
      timeboxes: []
    }
  });
  getLifeForceMock.mockResolvedValue(createLifeForceResponse());
  createWorkBlockTemplateMock.mockResolvedValue({
    template: { id: "wbtpl_new" }
  });
  patchWorkBlockTemplateMock.mockResolvedValue({
    template: { id: "wbtpl_new" }
  });
  deleteWorkBlockTemplateMock.mockResolvedValue({
    template: { id: "wbtpl_new" }
  });
  ensureOperatorSessionMock.mockResolvedValue({
    session: {
      id: "operator_session_1",
      actorLabel: "Albert",
      expiresAt: "2026-04-03T10:00:00.000Z"
    }
  });
  getSettingsMock.mockResolvedValue({
    settings: {
      profile: {
        operatorName: "Albert",
        operatorEmail: "albert@example.com",
        operatorTitle: "Operator"
      },
      notifications: {
        goalDriftAlerts: true,
        dailyQuestReminders: true,
        achievementCelebrations: true
      },
      execution: {
        maxActiveTasks: 2,
        timeAccountingMode: "split"
      },
      themePreference: "obsidian",
      localePreference: "en",
      security: {
        integrityScore: 98,
        lastAuditAt: "2026-04-03T08:00:00.000Z",
        storageMode: "local-first",
        activeSessions: 1,
        tokenCount: 0,
        psycheAuthRequired: false
      },
      calendarProviders: {
        google: {
          clientId: "google-client-id",
          appBaseUrl: "http://127.0.0.1:4317",
          redirectUri:
            "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
          allowedOrigins: ["http://127.0.0.1:3027", "http://127.0.0.1:4317"],
          usesPkce: true,
          requiresServerClientSecret: false,
          oauthClientType: "desktop_app",
          authMode: "localhost_pkce",
          isConfigured: true,
          isReadyForPairing: true,
          isLocalOnly: true,
          runtimeOrigin: "http://127.0.0.1:4317",
          setupMessage:
            "Google Calendar sign-in is configured for local Forge. Open Forge on localhost or 127.0.0.1 on the same machine that is running Forge, because Google will redirect back to the local callback on that machine."
        },
        microsoft: {
          clientId: "",
          tenantId: "common",
          redirectUri:
            "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
          usesClientSecret: false,
          readOnly: true,
          authMode: "public_client_pkce",
          isConfigured: false,
          isReadyForSignIn: false,
          setupMessage:
            "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
        }
      },
      agents: [],
      agentTokens: []
    }
  });
  patchSettingsMock.mockResolvedValue({
    settings: {}
  });
  getMacOSLocalCalendarStatusMock.mockResolvedValue({
    status: "unavailable"
  });
  requestMacOSLocalCalendarAccessMock.mockResolvedValue({
    granted: false,
    status: "unavailable"
  });
  discoverMacOSLocalCalendarSourcesMock.mockResolvedValue({
    discovery: {
      status: "unavailable",
      requestedAt: "2026-04-03T08:00:00.000Z",
      sources: []
    }
  });
  startGoogleCalendarOauthMock.mockResolvedValue({
    session: {
      sessionId: "google_session_1",
      status: "pending",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=google_session_1",
      accountLabel: null,
      error: null,
      discovery: null
    }
  });
  getGoogleCalendarOauthSessionMock.mockResolvedValue({
    session: {
      sessionId: "google_session_1",
      status: "authorized",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=google_session_1",
      accountLabel: "albert@example.com",
      error: null,
      discovery: {
        provider: "google",
        accountLabel: "albert@example.com",
        serverUrl: "https://apidata.googleusercontent.com/caldav/v2/",
        principalUrl: "https://apidata.googleusercontent.com/caldav/v2/albert@example.com/",
        homeUrl: "https://apidata.googleusercontent.com/caldav/v2/albert@example.com/events/",
        calendars: [
          {
            url: "https://apidata.googleusercontent.com/caldav/v2/albert@example.com/events/",
            displayName: "Primary",
            description: "Primary Google calendar",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            isPrimary: true,
            canWrite: true,
            selectedByDefault: true,
            isForgeCandidate: false
          },
          {
            url: "https://apidata.googleusercontent.com/caldav/v2/albert@example.com/forge/",
            displayName: "Forge",
            description: "Forge write calendar",
            color: "#22c55e",
            timezone: "Europe/Zurich",
            isPrimary: false,
            canWrite: true,
            selectedByDefault: false,
            isForgeCandidate: true
          }
        ]
      }
    }
  });
  listCalendarConnectionsMock.mockResolvedValue({
    providers: [
      {
        provider: "google",
        label: "Google Calendar",
        supportsDedicatedForgeCalendar: true,
        connectionHelp: "Use Google OAuth credentials."
      },
      {
        provider: "apple",
        label: "Apple Calendar",
        supportsDedicatedForgeCalendar: true,
        connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
      },
      {
        provider: "microsoft",
        label: "Exchange Online",
        supportsDedicatedForgeCalendar: false,
        connectionHelp: "Sign in with Microsoft in a guided popup flow. Forge mirrors the selected calendars in read-only mode for now."
      },
      {
        provider: "macos_local",
        label: "Calendars On This Mac",
        supportsDedicatedForgeCalendar: true,
        connectionHelp: "Use EventKit to access the calendars already configured in Calendar.app on this Mac."
      },
      {
        provider: "caldav",
        label: "Custom CalDAV",
        supportsDedicatedForgeCalendar: true,
        connectionHelp: "Use a CalDAV base URL and account credentials."
      }
    ],
    connections: []
  });
  listCalendarResourcesMock.mockResolvedValue({
    calendars: []
  });
  createCalendarConnectionMock.mockResolvedValue({
    connection: { id: "conn_1" }
  });
  patchCalendarConnectionMock.mockResolvedValue({
    connection: { id: "conn_1" }
  });
  deleteCalendarConnectionMock.mockResolvedValue({
    connection: { id: "conn_1" }
  });
  discoverExistingCalendarConnectionMock.mockResolvedValue({
    discovery: {
      provider: "apple",
      accountLabel: "Albert",
      serverUrl: "https://caldav.icloud.com",
      principalUrl: "https://caldav.icloud.com/principal/",
      homeUrl: "https://caldav.icloud.com/home/",
      calendars: [
        {
          url: "https://caldav.icloud.com/calendars/forge/",
          displayName: "Forge",
          description: "",
          color: "#7dd3fc",
          timezone: "Europe/Zurich",
          isPrimary: false,
          canWrite: true,
          selectedByDefault: true,
          isForgeCandidate: true
        },
        {
          url: "https://caldav.icloud.com/calendars/family/",
          displayName: "Family",
          description: "",
          color: "#f97316",
          timezone: "Europe/Zurich",
          isPrimary: true,
          canWrite: true,
          selectedByDefault: true,
          isForgeCandidate: false
        }
      ]
    }
  });
  createCalendarEventMock.mockResolvedValue({
    event: { id: "calevent_1" }
  });
  deleteTaskTimeboxMock.mockResolvedValue({
    timebox: { id: "timebox_planning" }
  });
  patchCalendarEventMock.mockResolvedValue({
    event: { id: "calevent_1" }
  });
  deleteCalendarEventMock.mockResolvedValue({
    event: { id: "calevent_1" }
  });
  startMicrosoftCalendarOauthMock.mockResolvedValue({
    session: {
      sessionId: "ms_session_1",
      status: "pending",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      accountLabel: null,
      error: null,
      discovery: null
    }
  });
  testMicrosoftCalendarOauthConfigurationMock.mockResolvedValue({
    result: {
      ok: true,
      message:
        "Forge can open a local Microsoft sign-in with this client ID and redirect URI. Final verification happens when you complete the Microsoft popup and consent.",
      normalizedConfig: {
        clientId: "00000000-0000-0000-0000-000000000000",
        tenantId: "common",
        redirectUri:
          "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
        usesClientSecret: false,
        readOnly: true
      }
    }
  });
  getMicrosoftCalendarOauthSessionMock.mockResolvedValue({
    session: {
      sessionId: "ms_session_1",
      status: "authorized",
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      accountLabel: "Albert Buchard",
      error: null,
      discovery: {
        provider: "microsoft",
        accountLabel: "Albert Buchard",
        serverUrl: "https://graph.microsoft.com/v1.0",
        principalUrl: "https://graph.microsoft.com/v1.0/me",
        homeUrl: null,
        calendars: [
          {
            url: "https://graph.microsoft.com/v1.0/me/calendars/AAMkAGI2TAAA=",
            displayName: "Work",
            description: "Owned by Albert",
            color: "#7dd3fc",
            timezone: "UTC",
            isPrimary: true,
            canWrite: false,
            selectedByDefault: true,
            isForgeCandidate: false
          }
        ]
      }
    }
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useForgeClipboardStore.getState().clear();
  vi.clearAllMocks();
});

describe("calendar routing surfaces", () => {
  it("keeps the calendar page display-first and opens guided work-block flows", async () => {
    renderWithRouter(<CalendarPage />, "/calendar");

    expect(await screen.findByText("Week view")).toBeInTheDocument();
    expect(screen.getByText("Manage provider settings")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Google client id")).not.toBeInTheDocument();
    expect(screen.queryByText("Half-day work blocks")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Open work-block guide"));

    expect(
      await screen.findByText("Create a work block")
    ).toBeInTheDocument();
  });

  it("surfaces Life Force summary and AP badges across work blocks, events, and timeboxes", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [
          {
            id: "calendar_work",
            connectionId: "conn_1",
            remoteId: "remote_calendar_work",
            title: "Work",
            description: "",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            isPrimary: true,
            canWrite: true,
            selectedForSync: true,
            forgeManaged: false,
            lastSyncedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        events: [
          {
            id: "event_meeting",
            connectionId: "conn_1",
            calendarId: "calendar_work",
            remoteId: "remote_event_1",
            ownership: "external",
            originType: "google",
            status: "confirmed",
            title: "Hiring meeting",
            description: "",
            location: "",
            place: {
              label: "",
              address: "",
              timezone: "Europe/Zurich",
              latitude: null,
              longitude: null,
              source: "",
              externalPlaceId: ""
            },
            startAt: "2026-04-13T10:00:00.000Z",
            endAt: "2026-04-13T11:00:00.000Z",
            timezone: "Europe/Zurich",
            isAllDay: false,
            availability: "busy",
            eventType: "meeting",
            categories: [],
            sourceMappings: [],
            links: [],
            remoteUpdatedAt: null,
            deletedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockTemplates: [
          {
            id: "wbtpl_focus",
            title: "Focus block",
            kind: "main_activity",
            color: "#8b5cf6",
            timezone: "Europe/Zurich",
            weekDays: [1],
            startMinute: 8 * 60,
            endMinute: 10 * 60,
            startsOn: null,
            endsOn: null,
            blockingState: "allowed",
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockInstances: [
          {
            id: "wbinst_focus_2026-04-13",
            templateId: "wbtpl_focus",
            dateKey: "2026-04-13",
            startAt: "2026-04-13T08:00:00.000Z",
            endAt: "2026-04-13T10:00:00.000Z",
            title: "Focus block",
            kind: "main_activity",
            color: "#8b5cf6",
            blockingState: "allowed",
            calendarEventId: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        timeboxes: [
          {
            id: "timebox_planning",
            taskId: "task_1",
            projectId: "project_1",
            title: "Planning window",
            startsAt: "2026-04-13T12:00:00.000Z",
            endsAt: "2026-04-13T14:00:00.000Z",
            status: "planned",
            source: "manual",
            linkedTaskRunId: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ]
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    expect(await screen.findByText("Life Force today")).toBeInTheDocument();
    expect(
      screen.getAllByText((_content, element) => {
        const text = element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return text.includes("86 / 220 AP") || text.includes("86/220 AP");
      }).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/planned remaining 86 ap/i)).toBeInTheDocument();
    expect(screen.getAllByText("13 AP/h").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14 AP/h").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.2 AP/h").length).toBeGreaterThan(0);
    expect(screen.getByText("Hiring meeting")).toBeInTheDocument();
    expect(screen.getAllByText("Focus block").length).toBeGreaterThan(0);
    expect(screen.getByText("Planning window")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open task" })).toBeInTheDocument();
  });

  it("opens existing timeboxes for editing from the calendar surface", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: [
          {
            id: "timebox_planning",
            taskId: "task_1",
            projectId: "project_1",
            connectionId: null,
            calendarId: null,
            remoteEventId: null,
            linkedTaskRunId: null,
            title: "Planning window",
            startsAt: "2026-04-13T12:00:00.000Z",
            endsAt: "2026-04-13T14:00:00.000Z",
            status: "planned",
            source: "manual",
            overrideReason: null,
            actionProfile: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ]
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    fireEvent.click(await screen.findByText("Planning window"));
    expect(await screen.findByText("Edit timebox")).toBeInTheDocument();
  });

  it("opens a linked timebox directly from the calendar query string", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: [
          {
            id: "timebox_planning",
            taskId: "task_1",
            projectId: "project_1",
            connectionId: null,
            calendarId: null,
            remoteEventId: null,
            linkedTaskRunId: null,
            title: "Planning window",
            startsAt: "2026-04-13T12:00:00.000Z",
            endsAt: "2026-04-13T14:00:00.000Z",
            status: "planned",
            source: "manual",
            overrideReason: null,
            actionProfile: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ]
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar?timeboxId=timebox_planning");

    expect(await screen.findByText("Edit timebox")).toBeInTheDocument();
    expect(screen.getAllByText("Planning window").length).toBeGreaterThan(0);
  });

  it("lets the user delete a planned timebox from the calendar edit flow", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: [
          {
            id: "timebox_planning",
            taskId: "task_1",
            projectId: "project_1",
            connectionId: null,
            calendarId: null,
            remoteEventId: null,
            linkedTaskRunId: null,
            title: "Planning window",
            startsAt: "2026-04-13T12:00:00.000Z",
            endsAt: "2026-04-13T14:00:00.000Z",
            status: "planned",
            source: "manual",
            overrideReason: null,
            actionProfile: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ]
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    fireEvent.click(await screen.findByText("Planning window"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete timebox" }));

    await waitFor(() =>
      expect(deleteTaskTimeboxMock.mock.calls[0]?.[0]).toBe("timebox_planning")
    );
  });

  it("lets the user edit and delete recurring work blocks from the calendar surface", async () => {
    const calendarFixture = {
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [
          {
            id: "wbtpl_holiday",
            title: "Vacation",
            kind: "holiday",
            color: "#14b8a6",
            timezone: "Europe/Zurich",
            weekDays: [0, 1, 2, 3, 4, 5, 6],
            startMinute: 0,
            endMinute: 1440,
            startsOn: "2026-04-13",
            endsOn: "2026-04-17",
            blockingState: "blocked",
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockInstances: [
          {
            id: "wbinst_wbtpl_holiday_2026-04-13",
            templateId: "wbtpl_holiday",
            dateKey: "2026-04-13",
            startAt: "2026-04-13T00:00:00.000Z",
            endAt: "2026-04-14T00:00:00.000Z",
            title: "Vacation",
            kind: "holiday",
            color: "#14b8a6",
            blockingState: "blocked",
            calendarEventId: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        timeboxes: []
      }
    };
    getCalendarOverviewMock.mockResolvedValue(calendarFixture);
    patchWorkBlockTemplateMock.mockResolvedValueOnce({
      template: { id: "wbtpl_holiday" }
    });
    deleteWorkBlockTemplateMock.mockResolvedValueOnce({
      template: { id: "wbtpl_holiday" }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    expect((await screen.findAllByText("Vacation")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open actions for Vacation" }));
    fireEvent.click((await screen.findAllByText("Edit")).at(-1) as HTMLElement);

    expect(await screen.findByText("Edit work block")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Block title"), {
      target: { value: "Summer holiday" }
    });
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-04-20" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(patchWorkBlockTemplateMock).toHaveBeenCalledWith("wbtpl_holiday", {
        title: "Summer holiday",
        kind: "holiday",
        color: "#14b8a6",
        timezone: "Europe/Zurich",
        weekDays: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 0,
        endMinute: 1440,
        startsOn: "2026-04-13",
        endsOn: "2026-04-20",
        blockingState: "blocked",
        activityPresetKey: null,
        customSustainRateApPerHour: null
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Open actions for Vacation" }));
    fireEvent.click((await screen.findAllByText("Delete")).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(deleteWorkBlockTemplateMock).toHaveBeenCalled();
      expect(deleteWorkBlockTemplateMock.mock.calls[0]?.[0]).toBe("wbtpl_holiday");
    });
  });

  it("shows the actual calendar title on week-view event badges", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [
          {
            id: "calendar_apple",
            connectionId: "conn_1",
            remoteId: "https://caldav.icloud.com/calendars/family/",
            title: "Family",
            description: "",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            isPrimary: true,
            canWrite: true,
            selectedForSync: true,
            forgeManaged: false,
            lastSyncedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        events: [
          {
            id: "event_apple",
            connectionId: "conn_1",
            calendarId: "calendar_apple",
            remoteId: "remote_1",
            ownership: "external",
            originType: "apple",
            status: "confirmed",
            title: "Choeur a coeur",
            description: "",
            location: "",
            startAt: "2026-04-13T18:30:00.000Z",
            endAt: "2026-04-13T20:00:00.000Z",
            timezone: "Europe/Zurich",
            isAllDay: false,
            availability: "busy",
            eventType: "personal",
            categories: [],
            sourceMappings: [],
            links: [],
            remoteUpdatedAt: null,
            deletedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: []
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    expect(await screen.findByText("Week view")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Colors on" })).not.toBeInTheDocument();
  });

  it("closes the event dialog immediately and updates the week view optimistically", async () => {
    const saveDeferred = createDeferred<{
      event: {
        id: string;
        connectionId: string | null;
        calendarId: string | null;
        remoteId: string | null;
        ownership: "external" | "forge";
        originType: "native";
        status: "confirmed";
        title: string;
        description: string;
        location: string;
        startAt: string;
        endAt: string;
        timezone: string;
        isAllDay: false;
        availability: "busy";
        eventType: "general";
        categories: string[];
        sourceMappings: [];
        links: [];
        remoteUpdatedAt: null;
        deletedAt: null;
        createdAt: string;
        updatedAt: string;
      };
    }>();
    patchCalendarEventMock.mockReturnValueOnce(saveDeferred.promise);
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [
          {
            id: "calendar_forge",
            connectionId: "conn_1",
            remoteId: "https://caldav.icloud.com/calendars/forge/",
            title: "Forge",
            description: "",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            isPrimary: false,
            canWrite: true,
            selectedForSync: true,
            forgeManaged: true,
            lastSyncedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        events: [
          {
            id: "event_edit",
            connectionId: "conn_1",
            calendarId: "calendar_forge",
            remoteId: "remote_1",
            ownership: "forge",
            originType: "native",
            status: "confirmed",
            title: "Old title",
            description: "",
            location: "",
            startAt: "2026-04-13T09:00:00.000Z",
            endAt: "2026-04-13T10:00:00.000Z",
            timezone: "Europe/Zurich",
            isAllDay: false,
            availability: "busy",
            eventType: "general",
            categories: [],
            sourceMappings: [],
            links: [],
            remoteUpdatedAt: null,
            deletedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: []
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");

    expect(await screen.findByText("Old title")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Old title"));
    expect(await screen.findByText("Refine the Forge event")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "New title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() => {
      expect(screen.queryByText("Refine the Forge event")).not.toBeInTheDocument();
    });
    expect(screen.getByText("New title")).toBeInTheDocument();
    expect(screen.getByText("Syncing changes")).toBeInTheDocument();

    saveDeferred.resolve({
      event: {
        id: "event_edit",
        connectionId: "conn_1",
        calendarId: "calendar_forge",
        remoteId: "remote_1",
        ownership: "forge",
        originType: "native",
        status: "confirmed",
        title: "New title",
        description: "",
        location: "",
        startAt: "2026-04-13T09:00:00.000Z",
        endAt: "2026-04-13T10:00:00.000Z",
        timezone: "Europe/Zurich",
        isAllDay: false,
        availability: "busy",
        eventType: "general",
        categories: [],
        sourceMappings: [],
        links: [],
        remoteUpdatedAt: null,
        deletedAt: null,
        createdAt: "2026-04-03T08:00:00.000Z",
        updatedAt: "2026-04-03T08:05:00.000Z"
      }
    });

    await waitFor(() => {
      expect(patchCalendarEventMock).toHaveBeenCalledWith("event_edit", expect.objectContaining({
        title: "New title"
      }));
    });
  });

  it("opens the settings calendar guided modal from the deep link intent", async () => {
    renderWithRouter(
      <SettingsCalendarPage />,
      "/settings/calendar?intent=connect&provider=apple"
    );

    expect(screen.queryByText("Before you connect anything")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Connect a calendar provider")
    ).toBeInTheDocument();
    expect(await screen.findByText("Before you connect anything")).toBeInTheDocument();
    expect(screen.getAllByText("Apple Calendar").length).toBeGreaterThan(0);
  });

  it("keeps the Google host warning inside the guided modal", async () => {
    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    expect(await screen.findByText("Provider connections")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect a provider here, then choose which calendars Forge should mirror/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Google sign-in is only available from one of these local browser origins/i)
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Google guided flow" }));
    expect(await screen.findByText("Connect a calendar provider")).toBeInTheDocument();
    expect(screen.getByText(/Detected browser origin:/i)).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(
      screen.getByText(/Google sign-in has to start from a local browser on the host running Forge/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeDisabled();
  });

  it("shows provider connection badges without blocking additional connections", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "google",
          label: "Google Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Google OAuth credentials."
        },
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        }
      ],
      connections: [
        {
          id: "conn_google_1",
          provider: "google",
          label: "Primary Google",
          accountLabel: "albert.buchard@gmail.com",
          status: "connected",
          config: {
            selectedCalendarCount: 1,
            forgeCalendarUrl: "https://apidata.googleusercontent.com/caldav/v2/albert.buchard%40gmail.com/forge/"
          },
          forgeCalendarId: "calendar_google_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        },
        {
          id: "conn_google_2",
          provider: "google",
          label: "Work Google",
          accountLabel: "work@example.com",
          status: "connected",
          config: {
            selectedCalendarCount: 2,
            forgeCalendarUrl: "https://apidata.googleusercontent.com/caldav/v2/work%40example.com/forge/"
          },
          forgeCalendarId: "calendar_google_work",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    const googleAction = await screen.findByRole("button", { name: "Open Google guided flow" });
    const googleCard = googleAction.closest(".rounded-\\[26px\\]");
    expect(googleCard).toBeTruthy();
    expect(within(googleCard as HTMLElement).getByText("Connected")).toBeInTheDocument();
    expect(within(googleCard as HTMLElement).getByText("2 connections")).toBeInTheDocument();
    expect(
      within(googleCard as HTMLElement).getByText(
        /Forge already has 2 connections for this provider/i
      )
    ).toBeInTheDocument();
    expect(googleAction).toBeInTheDocument();
  });

  it("shows both the wrong-machine warning and missing Google client ID in the guided modal", async () => {
    getSettingsMock.mockResolvedValueOnce({
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        localePreference: "en",
        security: {
          integrityScore: 98,
          lastAuditAt: "2026-04-03T08:00:00.000Z",
          storageMode: "local-first",
          activeSessions: 1,
          tokenCount: 0,
          psycheAuthRequired: false
        },
        calendarProviders: {
          google: {
            clientId: "",
            clientSecret: "",
            storedClientId: "",
            storedClientSecret: "",
            appBaseUrl: "http://127.0.0.1:4317",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
            allowedOrigins: ["http://127.0.0.1:3027", "http://127.0.0.1:4317"],
            usesPkce: true,
            requiresServerClientSecret: false,
            oauthClientType: "desktop_app",
            authMode: "localhost_pkce",
            isConfigured: false,
            isReadyForPairing: false,
            isLocalOnly: true,
            runtimeOrigin: "http://127.0.0.1:4317",
            setupMessage: "Google OAuth credentials are not set for this Forge install."
          },
          microsoft: {
            clientId: "",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
            usesClientSecret: false,
            readOnly: true,
            authMode: "public_client_pkce",
            isConfigured: false,
            isReadyForSignIn: false,
            setupMessage:
              "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
          }
        },
        agents: [],
        agentTokens: []
      }
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Google guided flow" })
    );

    expect(
      await screen.findByText(/Google sign-in has to start from a local browser on the host running Forge/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Google OAuth credentials are not set for this Forge install/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Detected browser origin:/i)).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeDisabled();
  });

  it("reveals the Google OAuth editor only after clicking the edit control", async () => {
    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Google guided flow" })
    );

    expect(
      screen.queryByLabelText("Client ID")
    ).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Google OAuth client" })
    );

    expect(await screen.findByLabelText("Client ID")).toBeInTheDocument();
    expect(await screen.findByLabelText("Client secret")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save Google OAuth override" })
    ).toBeInTheDocument();
  });

  it("starts Google sign-in immediately after saving the server-backed Google client ID", async () => {
    const popupStub = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn()
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popupStub);
    const browserOrigin = window.location.origin;

    const initialSettings = {
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        localePreference: "en",
        security: {
          integrityScore: 98,
          lastAuditAt: "2026-04-03T08:00:00.000Z",
          storageMode: "local-first",
          activeSessions: 1,
          tokenCount: 0,
          psycheAuthRequired: false
        },
        calendarProviders: {
          google: {
            clientId: "",
            appBaseUrl: "http://127.0.0.1:4317",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
            allowedOrigins: [browserOrigin, "http://127.0.0.1:3027", "http://127.0.0.1:4317"],
            usesPkce: true,
            requiresServerClientSecret: false,
            oauthClientType: "desktop_app",
            authMode: "localhost_pkce",
            isConfigured: false,
            isReadyForPairing: false,
            isLocalOnly: true,
            runtimeOrigin: "http://127.0.0.1:4317",
            setupMessage: "Google client ID is not set for this Forge install."
          },
          microsoft: {
            clientId: "",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
            usesClientSecret: false,
            readOnly: true,
            authMode: "public_client_pkce",
            isConfigured: false,
            isReadyForSignIn: false,
            setupMessage:
              "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
          }
        },
        agents: [],
        agentTokens: []
      }
    };

    const readySettings = {
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        localePreference: "en",
        security: {
          integrityScore: 98,
          lastAuditAt: "2026-04-03T08:00:00.000Z",
          storageMode: "local-first",
          activeSessions: 1,
          tokenCount: 0,
          psycheAuthRequired: false
        },
        calendarProviders: {
          google: {
            clientId: "new-google-client-id.apps.googleusercontent.com",
            clientSecret: "new-google-client-secret",
            storedClientId: "new-google-client-id.apps.googleusercontent.com",
            storedClientSecret: "new-google-client-secret",
            appBaseUrl: "http://127.0.0.1:4317",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
            allowedOrigins: [browserOrigin, "http://127.0.0.1:3027", "http://127.0.0.1:4317"],
            usesPkce: true,
            requiresServerClientSecret: false,
            oauthClientType: "desktop_app",
            authMode: "localhost_pkce",
            isConfigured: true,
            isReadyForPairing: true,
            isLocalOnly: true,
            runtimeOrigin: "http://127.0.0.1:4317",
            setupMessage:
              "Google Calendar sign-in is configured for local Forge. Open Forge on localhost or 127.0.0.1 on the same machine that is running Forge, because Google will redirect back to the local callback on that machine."
          },
          microsoft: {
            clientId: "",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
            usesClientSecret: false,
            readOnly: true,
            authMode: "public_client_pkce",
            isConfigured: false,
            isReadyForSignIn: false,
            setupMessage:
              "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
          }
        },
        agents: [],
        agentTokens: []
      }
    };

    patchSettingsMock.mockResolvedValue(readySettings);
    getSettingsMock.mockResolvedValueOnce(initialSettings);
    getSettingsMock.mockImplementation(
      () => new Promise<never>(() => {})
    );
    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Google guided flow" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Google OAuth client" })
    );
    fireEvent.change(await screen.findByLabelText("Client ID"), {
      target: { value: "new-google-client-id.apps.googleusercontent.com" }
    });
    fireEvent.change(await screen.findByLabelText("Client secret"), {
      target: { value: "new-google-client-secret" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save Google OAuth override" })
    );

    await waitFor(() => {
      expect(patchSettingsMock).toHaveBeenCalledWith({
        calendarProviders: {
          google: {
            clientId: "new-google-client-id.apps.googleusercontent.com",
            clientSecret: "new-google-client-secret"
          }
        }
      });
    });

    const signInButton = await screen.findByRole("button", {
      name: "Sign in with Google"
    });
    await waitFor(() => {
      expect(signInButton).toBeEnabled();
    });

    expect(screen.getByText("Stored on server")).toBeInTheDocument();
    expect(
      screen.getByText("new-google-client-id.apps.googleusercontent.com")
    ).toBeInTheDocument();
    expect(screen.getByText("new-google-client-secret")).toBeInTheDocument();

    fireEvent.click(signInButton);

    await waitFor(() => {
      expect(startGoogleCalendarOauthMock).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "Primary Google",
          browserOrigin
        })
      );
    });
  });

  it("polls the Google OAuth session until authorization completes", async () => {
    const browserOrigin = window.location.origin;
    const popupStub = {
      focus: vi.fn(),
      close: vi.fn()
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popupStub);
    getGoogleCalendarOauthSessionMock.mockClear();
    getSettingsMock.mockResolvedValue({
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        localePreference: "en",
        security: {
          integrityScore: 98,
          lastAuditAt: "2026-04-03T08:00:00.000Z",
          storageMode: "local-first",
          activeSessions: 1,
          tokenCount: 0,
          psycheAuthRequired: false
        },
        calendarProviders: {
          google: {
            clientId: "google-client-id",
            appBaseUrl: "http://127.0.0.1:4317",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
            allowedOrigins: [browserOrigin, "http://127.0.0.1:3027", "http://127.0.0.1:4317"],
            usesPkce: true,
            requiresServerClientSecret: false,
            oauthClientType: "desktop_app",
            authMode: "localhost_pkce",
            isConfigured: true,
            isReadyForPairing: true,
            isLocalOnly: true,
            runtimeOrigin: "http://127.0.0.1:4317",
            setupMessage:
              "Google Calendar sign-in is configured for local Forge. Open Forge on localhost or 127.0.0.1 on the same machine that is running Forge, because Google will redirect back to the local callback on that machine."
          },
          microsoft: {
            clientId: "",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
            usesClientSecret: false,
            readOnly: true,
            authMode: "public_client_pkce",
            isConfigured: false,
            isReadyForSignIn: false,
            setupMessage:
              "Save the Microsoft client ID and the Forge callback redirect URI here before you try to sign in."
          }
        },
        agents: [],
        agentTokens: []
      }
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Google guided flow" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => {
      expect(startGoogleCalendarOauthMock).toHaveBeenCalled();
    });

    await waitFor(
      () => {
        expect(getGoogleCalendarOauthSessionMock).toHaveBeenCalledWith(
          "google_session_1"
        );
      },
      { timeout: 2500 }
    );

    expect(await screen.findByText("albert@example.com")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Sign in again" })
    ).toBeInTheDocument();
  });

  it("explains why Google pairing fails from a Tailscale phone route", () => {
    const message = describeGoogleRouteRequirement({
      currentOrigin: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net",
      appBaseUrl: "http://127.0.0.1:4317",
      redirectUri: "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
      allowedOrigins: ["http://127.0.0.1:3027", "http://127.0.0.1:4317"],
      isLocalOnly: true
    });

    expect(message).toMatch(/Google sign-in has to start from a local browser on the host running Forge/i);
    expect(message).toMatch(/Forge is currently open through Tailscale/i);
    expect(message).toMatch(/that callback goes to that device instead of the Forge host/i);
  });

  it("supports the Exchange Online guided flow as read only", async () => {
    const popupStub = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn()
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popupStub);
    const readySettings = {
      settings: {
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Operator"
        },
        notifications: {
          goalDriftAlerts: true,
          dailyQuestReminders: true,
          achievementCelebrations: true
        },
        execution: {
          maxActiveTasks: 2,
          timeAccountingMode: "split"
        },
        themePreference: "obsidian",
        localePreference: "en",
        security: {
          integrityScore: 98,
          lastAuditAt: "2026-04-03T08:00:00.000Z",
          storageMode: "local-first",
          activeSessions: 1,
          tokenCount: 0,
          psycheAuthRequired: false
        },
        calendarProviders: {
          google: {
            clientId: "google-client-id",
            appBaseUrl: "http://127.0.0.1:4317",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback",
            allowedOrigins: ["http://127.0.0.1:3027", "http://127.0.0.1:4317"],
            usesPkce: true,
            requiresServerClientSecret: false,
            oauthClientType: "desktop_app",
            authMode: "localhost_pkce",
            isConfigured: true,
            isReadyForPairing: true,
            isLocalOnly: true,
            runtimeOrigin: "http://127.0.0.1:4317",
            setupMessage:
              "Google Calendar sign-in is configured for local Forge. Open Forge on localhost or 127.0.0.1 on the same machine that is running Forge, because Google will redirect back to the local callback on that machine."
          },
          microsoft: {
            clientId: "00000000-0000-0000-0000-000000000000",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback",
            usesClientSecret: false,
            readOnly: true,
            authMode: "public_client_pkce",
            isConfigured: true,
            isReadyForSignIn: true,
            setupMessage:
              "Microsoft local sign-in is configured. Test it if you want, then continue to the guided sign-in flow."
          }
        },
        agents: [],
        agentTokens: []
      }
    };
    patchSettingsMock.mockImplementation(async () => {
      getSettingsMock.mockResolvedValue(readySettings);
      return readySettings;
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    expect((await screen.findAllByText("Exchange Online")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Microsoft guided flow" }));
    expect(await screen.findByText("Connect a calendar provider")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"), {
      target: { value: "00000000-0000-0000-0000-000000000000" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Microsoft settings" }));

    await waitFor(() => {
      expect(patchSettingsMock).toHaveBeenCalledWith({
        calendarProviders: {
          microsoft: {
            clientId: "00000000-0000-0000-0000-000000000000",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
          }
        }
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Test Microsoft configuration" }));
    expect(
      await screen.findByText(
        "Forge can open a local Microsoft sign-in with this client ID and redirect URI. Final verification happens when you complete the Microsoft popup and consent."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

    await waitFor(() => {
      expect(startMicrosoftCalendarOauthMock).toHaveBeenCalledWith({
        label: "Primary Exchange Online"
      });
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "http://127.0.0.1:4317",
        data: {
          type: "forge:microsoft-calendar-auth",
          sessionId: "ms_session_1",
          status: "authorized"
        }
      })
    );

    await waitFor(() => {
      expect(getMicrosoftCalendarOauthSessionMock).toHaveBeenCalledWith("ms_session_1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getAllByText("Read only").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Use for Forge writes")).not.toBeInTheDocument();
    expect(screen.queryByText("Create a new Forge calendar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Forge writes:")).toBeInTheDocument();
    expect(screen.getByText("read only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

    await waitFor(() => {
      expect(createCalendarConnectionMock).toHaveBeenCalled();
      expect(createCalendarConnectionMock.mock.calls[0]?.[0]).toEqual({
        provider: "microsoft",
        label: "Primary Exchange Online",
        authSessionId: "ms_session_1",
        selectedCalendarUrls: ["https://graph.microsoft.com/v1.0/me/calendars/AAMkAGI2TAAA="]
      });
    });
  });

  it("guides the macOS local replacement flow and retries with replaceConnectionIds", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "google",
          label: "Google Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Google OAuth credentials."
        },
        {
          provider: "macos_local",
          label: "Calendars On This Mac",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use EventKit to access the calendars already configured on this Mac."
        }
      ],
      connections: [
        {
          id: "conn_google_1",
          provider: "google",
          label: "Primary Google",
          accountLabel: "Work",
          status: "connected",
          config: {
            accountIdentityKey: "exchange:work"
          },
          forgeCalendarId: "calendar_google_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });
    getMacOSLocalCalendarStatusMock.mockResolvedValue({
      status: "full_access"
    });
    discoverMacOSLocalCalendarSourcesMock.mockResolvedValue({
      discovery: {
        status: "full_access",
        requestedAt: "2026-04-03T08:00:00.000Z",
        sources: [
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            accountLabel: "Work",
            accountIdentityKey: "exchange:work",
            calendars: [
              {
                url: "forge-macos-local://calendar/source_work/cal_work/",
                displayName: "Work",
                description: "Main work calendar",
                color: "#7dd3fc",
                timezone: "Europe/Zurich",
                isPrimary: true,
                canWrite: true,
                selectedByDefault: true,
                isForgeCandidate: false,
                sourceId: "source_work",
                sourceTitle: "Work",
                sourceType: "exchange",
                calendarType: "exchange",
                hostCalendarId: "cal_work",
                canonicalKey: "exchange:work:work"
              },
              {
                url: "forge-macos-local://calendar/source_work/cal_forge/",
                displayName: "Forge",
                description: "Forge write calendar",
                color: "#22c55e",
                timezone: "Europe/Zurich",
                isPrimary: false,
                canWrite: true,
                selectedByDefault: false,
                isForgeCandidate: true,
                sourceId: "source_work",
                sourceTitle: "Work",
                sourceType: "exchange",
                calendarType: "exchange",
                hostCalendarId: "cal_forge",
                canonicalKey: "exchange:work:forge"
              }
            ]
          }
        ]
      }
    });
    createCalendarConnectionMock
      .mockRejectedValueOnce(
        new ForgeApiError({
          status: 409,
          code: "calendar_connection_overlap",
          message:
            "Forge already syncs Work through another calendar connection. Replace the older connection instead of keeping two copies of the same calendar account.",
          requestPath: "/api/v1/calendar/connections",
          response: {
            overlappingConnectionIds: ["conn_google_1"]
          }
        })
      )
      .mockResolvedValueOnce({
        connection: { id: "conn_macos_1" }
      });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Mac calendar flow" })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("macOS Calendar access")).toBeInTheDocument();
    expect(await screen.findByText("Host calendar sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Discovered through the host calendar store")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Selected host source:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

    await waitFor(() => {
      expect(createCalendarConnectionMock).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/replace the older overlapping connection/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Primary Google/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Replace and connect" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replace and connect" }));

    await waitFor(() => {
      expect(createCalendarConnectionMock).toHaveBeenCalledTimes(2);
    });
    expect(createCalendarConnectionMock.mock.calls[1]?.[0]).toEqual({
      provider: "macos_local",
      label: "Calendars On This Mac",
      sourceId: "source_work",
      selectedCalendarUrls: [
        "forge-macos-local://calendar/source_work/cal_work/"
      ],
      forgeCalendarUrl: "forge-macos-local://calendar/source_work/cal_forge/",
      createForgeCalendar: false,
      replaceConnectionIds: ["conn_google_1"]
    });
  });

  it("reuses the existing shared Forge write target when connecting another writable provider", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        },
        {
          provider: "macos_local",
          label: "Calendars On This Mac",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use EventKit to access the calendars already configured on this Mac."
        }
      ],
      connections: [
        {
          id: "conn_apple_primary",
          provider: "apple",
          label: "Primary Apple",
          accountLabel: "albert.buchard@gmail.com",
          status: "connected",
          config: {
            forgeCalendarUrl: "https://caldav.icloud.com/calendars/forge/",
            selectedCalendarCount: 2
          },
          forgeCalendarId: "calendar_apple_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });
    getMacOSLocalCalendarStatusMock.mockResolvedValue({
      status: "full_access"
    });
    discoverMacOSLocalCalendarSourcesMock.mockResolvedValue({
      discovery: {
        status: "full_access",
        requestedAt: "2026-04-03T08:00:00.000Z",
        sources: [
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            accountLabel: "Work",
            accountIdentityKey: "exchange:work",
            calendars: [
              {
                url: "forge-macos-local://calendar/source_work/cal_work/",
                displayName: "Work",
                description: "Main work calendar",
                color: "#7dd3fc",
                timezone: "Europe/Zurich",
                isPrimary: true,
                canWrite: true,
                selectedByDefault: true,
                isForgeCandidate: false,
                sourceId: "source_work",
                sourceTitle: "Work",
                sourceType: "exchange",
                calendarType: "exchange",
                hostCalendarId: "cal_work",
                canonicalKey: "exchange:work:work"
              },
              {
                url: "forge-macos-local://calendar/source_work/cal_forge/",
                displayName: "Forge",
                description: "Forge write calendar",
                color: "#22c55e",
                timezone: "Europe/Zurich",
                isPrimary: false,
                canWrite: true,
                selectedByDefault: false,
                isForgeCandidate: true,
                sourceId: "source_work",
                sourceTitle: "Work",
                sourceType: "exchange",
                calendarType: "exchange",
                hostCalendarId: "cal_forge",
                canonicalKey: "exchange:work:forge"
              }
            ]
          }
        ]
      }
    });
    createCalendarConnectionMock.mockResolvedValue({
      connection: { id: "conn_macos_1" }
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Mac calendar flow" })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/Forge already writes work blocks and owned timeboxes through/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Use for Forge writes")).not.toBeInTheDocument();
    expect(screen.queryByText("Create a new Forge calendar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Forge writes:")).toBeInTheDocument();
    expect(
      screen.getByText("shared target via Primary Apple · albert.buchard@gmail.com")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Connect provider" }));

    await waitFor(() => {
      expect(createCalendarConnectionMock).toHaveBeenCalledTimes(1);
    });
    expect(createCalendarConnectionMock.mock.calls[0]?.[0]).toEqual({
      provider: "macos_local",
      label: "Calendars On This Mac",
      sourceId: "source_work",
      selectedCalendarUrls: [
        "forge-macos-local://calendar/source_work/cal_work/"
      ],
      forgeCalendarUrl: null,
      createForgeCalendar: false,
      replaceConnectionIds: []
    });
  });

  it("lets connected providers unselect mirrored calendars", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        }
      ],
      connections: [
        {
          id: "conn_1",
          provider: "apple",
          label: "Primary Apple",
          accountLabel: "Albert",
          status: "connected",
          config: {
            serverUrl: "https://caldav.icloud.com",
            selectedCalendarCount: 1,
            forgeCalendarUrl: "https://caldav.icloud.com/calendars/forge/"
          },
          forgeCalendarId: "calendar_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });
    listCalendarResourcesMock.mockResolvedValueOnce({
      calendars: [
        {
          id: "calendar_forge",
          connectionId: "conn_1",
          remoteId: "https://caldav.icloud.com/calendars/forge/",
          title: "Forge",
          description: "",
          color: "#7dd3fc",
          timezone: "Europe/Zurich",
          isPrimary: false,
          canWrite: true,
          selectedForSync: false,
          forgeManaged: true,
          lastSyncedAt: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        },
        {
          id: "calendar_family",
          connectionId: "conn_1",
          remoteId: "https://caldav.icloud.com/calendars/family/",
          title: "Family",
          description: "",
          color: "#f97316",
          timezone: "Europe/Zurich",
          isPrimary: true,
          canWrite: true,
          selectedForSync: true,
          forgeManaged: false,
          lastSyncedAt: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click((await screen.findAllByText("Manage mirrored calendars"))[0]!);
    expect(screen.getAllByText("Manage mirrored calendars").length).toBeGreaterThan(1);

    const dialog = await screen.findByTestId("question-flow-dialog");
    const familyLabel = await within(dialog).findByText("Family");
    const familyCard = familyLabel.closest(".rounded-\\[24px\\]") ?? familyLabel.parentElement?.parentElement;
    expect(familyCard).toBeTruthy();
    fireEvent.click(
      within(familyCard as HTMLElement).getByRole("button", {
        name: /Mirrored into Forge|Do not mirror/i
      })
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save mirror selection" }));

    await waitFor(() => {
      expect(patchCalendarConnectionMock).toHaveBeenCalledWith("conn_1", {
        selectedCalendarUrls: []
      });
    });
  });

  it("shows deduped calendar labels when identical names come from different providers", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "google",
          label: "Google Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Google OAuth credentials."
        },
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        }
      ],
      connections: [
        {
          id: "conn_google",
          provider: "google",
          label: "Primary Google",
          accountLabel: "albert@gmail.com",
          status: "connected",
          config: {},
          forgeCalendarId: "calendar_google",
          lastSyncedAt: null,
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        },
        {
          id: "conn_apple",
          provider: "apple",
          label: "Primary Apple",
          accountLabel: "albert@icloud.com",
          status: "connected",
          config: {},
          forgeCalendarId: "calendar_apple",
          lastSyncedAt: null,
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });
    listCalendarResourcesMock.mockResolvedValueOnce({
      calendars: [
        {
          id: "calendar_google",
          connectionId: "conn_google",
          remoteId:
            "https://apidata.googleusercontent.com/caldav/v2/albert@gmail.com/forge/",
          title: "Forge",
          description: "",
          color: "#22c55e",
          timezone: "Europe/Zurich",
          isPrimary: false,
          canWrite: true,
          selectedForSync: true,
          forgeManaged: true,
          lastSyncedAt: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        },
        {
          id: "calendar_apple",
          connectionId: "conn_apple",
          remoteId: "https://caldav.icloud.com/calendars/forge/",
          title: "Forge",
          description: "",
          color: "#7dd3fc",
          timezone: "Europe/Zurich",
          isPrimary: false,
          canWrite: true,
          selectedForSync: true,
          forgeManaged: true,
          lastSyncedAt: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    expect((await screen.findAllByText("Forge (Google)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Forge (Apple)").length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText("Choose display color for Forge (Google)")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Choose display color for Forge (Apple)")
    ).toBeInTheDocument();
  });

  it("shows calendar color controls in settings for connected calendars", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        }
      ],
      connections: [
        {
          id: "conn_1",
          provider: "apple",
          label: "Primary Apple",
          accountLabel: "Albert",
          status: "connected",
          config: {
            serverUrl: "https://caldav.icloud.com",
            selectedCalendarCount: 1,
            forgeCalendarUrl: "https://caldav.icloud.com/calendars/forge/"
          },
          forgeCalendarId: "calendar_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });
    listCalendarResourcesMock.mockResolvedValueOnce({
      calendars: [
        {
          id: "calendar_family",
          connectionId: "conn_1",
          remoteId: "https://caldav.icloud.com/calendars/family/",
          title: "Family",
          description: "",
          color: "#f97316",
          timezone: "Europe/Zurich",
          isPrimary: true,
          canWrite: true,
          selectedForSync: true,
          forgeManaged: false,
          lastSyncedAt: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    expect(await screen.findByText("Calendar colors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colors on" })).toBeInTheDocument();
    expect(screen.getByLabelText("Choose display color for Family")).toBeInTheDocument();
  });

  it("restores the colors toggle state from persisted settings", async () => {
    window.localStorage.setItem(
      "forge.calendar-display-preferences",
      JSON.stringify({
        useCalendarColors: false,
        calendarColors: {}
      })
    );

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    expect(await screen.findByText("Calendar colors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colors off" })).toBeInTheDocument();
  });

  it("persists color-toggle changes from calendar settings", async () => {
    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    const toggle = await screen.findByRole("button", { name: "Colors on" });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Colors off" })).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("forge.calendar-display-preferences") ?? "{}")
    ).toMatchObject({ useCalendarColors: false });
  });

  it("removes a connected provider from settings", async () => {
    listCalendarConnectionsMock.mockResolvedValueOnce({
      providers: [
        {
          provider: "apple",
          label: "Apple Calendar",
          supportsDedicatedForgeCalendar: true,
          connectionHelp: "Use Apple autodiscovery from caldav.icloud.com."
        }
      ],
      connections: [
        {
          id: "conn_1",
          provider: "apple",
          label: "Primary Apple",
          accountLabel: "Albert",
          status: "connected",
          config: {
            serverUrl: "https://caldav.icloud.com",
            selectedCalendarCount: 1,
            forgeCalendarUrl: "https://caldav.icloud.com/calendars/forge/"
          },
          forgeCalendarId: "calendar_forge",
          lastSyncedAt: "2026-04-03T08:00:00.000Z",
          lastSyncError: null,
          createdAt: "2026-04-03T08:00:00.000Z",
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    });

    renderWithRouter(<SettingsCalendarPage />, "/settings/calendar");

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove connection" }));

    await waitFor(() => {
      expect(deleteCalendarConnectionMock).toHaveBeenCalledWith("conn_1");
    });
  });

  it("shows the clipboard badge when a calendar event is copied", async () => {
    getCalendarOverviewMock.mockResolvedValueOnce({
      calendar: {
        generatedAt: "2026-04-03T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [
          {
            id: "event_1",
            connectionId: null,
            calendarId: null,
            remoteId: null,
            ownership: "forge",
            originType: "native",
            status: "confirmed",
            title: "Research block",
            description: "",
            location: "",
            startAt: "2026-03-30T09:00:00.000Z",
            endAt: "2026-03-30T10:00:00.000Z",
            timezone: "Europe/Zurich",
            isAllDay: false,
            availability: "busy",
            eventType: "meeting",
            categories: [],
            sourceMappings: [],
            links: [],
            remoteUpdatedAt: null,
            deletedAt: null,
            createdAt: "2026-04-03T08:00:00.000Z",
            updatedAt: "2026-04-03T08:00:00.000Z"
          }
        ],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: []
      }
    });

    renderWithRouter(<CalendarPage />, "/calendar");
    await screen.findByText("Week view");

    useForgeClipboardStore.getState().setEntry({
      id: "clipboard_event_1",
      mode: "copy",
      source: "calendar",
      label: "Research block",
      createdAt: "2026-04-03T08:00:00.000Z",
      items: [
        {
          type: "calendar_event",
          eventId: "event_1",
          title: "Research block",
          description: "",
          location: "",
          startAt: "2026-03-30T09:00:00.000Z",
          endAt: "2026-03-30T10:00:00.000Z",
          timezone: "Europe/Zurich",
          availability: "busy",
          preferredCalendarId: null,
          categories: [],
          links: []
        }
      ]
    });

    expect(await screen.findByText("Copied · Research block")).toBeInTheDocument();
  });
});
