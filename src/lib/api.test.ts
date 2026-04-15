import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimTaskRun,
  createCalendarConnection,
  createGoal,
  createProject,
  createTask,
  getCalendarOverview,
  patchTask
} from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

describe("create entity payload normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends nested creation notes for goals and trims author whitespace", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ goal: { id: "goal_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createGoal({
      title: "Build a durable body",
      description: "",
      horizon: "year",
      status: "active",
      userId: null,
      targetPoints: 400,
      themeColor: "#c8a46b",
      tagIds: [],
      notes: [
        {
          contentMarkdown: "  Started this after the March review.  ",
          author: "  Albert  "
        }
      ]
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      title: "Build a durable body",
      notes: [
        {
          contentMarkdown: "Started this after the March review.",
          author: "Albert"
        }
      ]
    });
  });

  it("keeps project creation notes and drops empty task note drafts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ project: { id: "project_1" } }))
      .mockResolvedValueOnce(mockJsonResponse({ task: { id: "task_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createProject({
      goalId: "goal_1",
      title: "Ship Forge polish pass",
      description: "",
      status: "active",
      workflowStatus: "backlog",
      userId: null,
      assigneeUserIds: [],
      targetPoints: 240,
      themeColor: "#c0c1ff",
      productRequirementsDocument: "Forge polish PRD",
      notes: [{ contentMarkdown: "Capture release assumptions.", author: "" }]
    });

    await createTask({
      title: "Write the closeout checklist",
      description: "",
      level: "task",
      owner: "Albert",
      userId: null,
      assigneeUserIds: [],
      goalId: "goal_1",
      projectId: "project_1",
      parentWorkItemId: null,
      priority: "medium",
      status: "focus",
      effort: "deep",
      energy: "steady",
      dueDate: "",
      points: 60,
      aiInstructions: "Write the checklist in one focused AI session.",
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      tagIds: [],
      notes: [
        { contentMarkdown: "   ", author: "" },
        {
          contentMarkdown: "Turn the review into a durable checklist.",
          author: "Forge"
        }
      ]
    });

    const [, projectInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(projectInit.body))).toMatchObject({
      notes: [{ contentMarkdown: "Capture release assumptions.", author: null }]
    });

    const [, taskInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(taskInit.body))).toMatchObject({
      goalId: "goal_1",
      projectId: "project_1",
      dueDate: null,
      notes: [
        {
          contentMarkdown: "Turn the review into a durable checklist.",
          author: "Forge"
        }
      ]
    });
  });

  it("sends scheduling rules, planned duration, and calendar overrides without renaming fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ task: { id: "task_1" } }))
      .mockResolvedValueOnce(mockJsonResponse({ taskRun: { id: "run_1" } }))
      .mockResolvedValueOnce(mockJsonResponse({ connection: { id: "conn_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await patchTask("task_1", {
      plannedDurationSeconds: 5400,
      schedulingRules: {
        allowWorkBlockKinds: ["secondary_activity"],
        blockWorkBlockKinds: ["main_activity"],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: ["creative"],
        blockEventKeywords: ["clinic"],
        allowAvailability: [],
        blockAvailability: ["busy"]
      }
    });

    await claimTaskRun("task_1", {
      actor: "Albert",
      timerMode: "planned",
      plannedDurationSeconds: 1800,
      overrideReason: "Working after the clinic block.",
      leaseTtlSeconds: 1200,
      note: "Protected writing block."
    });

    await createCalendarConnection({
      provider: "caldav",
      label: "Primary CalDAV",
      serverUrl: "https://caldav.example.com",
      username: "operator@example.com",
      password: "app-password",
      selectedCalendarUrls: ["https://caldav.example.com/calendars/main/"],
      forgeCalendarUrl: "https://caldav.example.com/calendars/forge/"
    });

    const [, patchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(patchInit.body))).toMatchObject({
      plannedDurationSeconds: 5400,
      schedulingRules: {
        blockWorkBlockKinds: ["main_activity"],
        allowEventKeywords: ["creative"],
        blockEventKeywords: ["clinic"]
      }
    });

    const [, claimInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(claimInit.body))).toMatchObject({
      overrideReason: "Working after the clinic block.",
      plannedDurationSeconds: 1800
    });

    const [connectionUrl, connectionInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(connectionUrl).toContain("/api/v1/calendar/connections");
    expect(JSON.parse(String(connectionInit.body))).toMatchObject({
      provider: "caldav",
      serverUrl: "https://caldav.example.com",
      selectedCalendarUrls: ["https://caldav.example.com/calendars/main/"],
      forgeCalendarUrl: "https://caldav.example.com/calendars/forge/"
    });
  });

  it("dedupes identical calendar names by provider in the overview payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        calendar: {
          generatedAt: "2026-04-09T10:00:00.000Z",
          providers: [],
          connections: [
            {
              id: "conn_google",
              provider: "google",
              label: "Primary Google",
              accountLabel: "albert@gmail.com",
              status: "connected",
              config: {},
              forgeCalendarId: null,
              lastSyncedAt: null,
              lastSyncError: null,
              createdAt: "",
              updatedAt: ""
            },
            {
              id: "conn_apple",
              provider: "apple",
              label: "Primary Apple",
              accountLabel: "albert@icloud.com",
              status: "connected",
              config: {},
              forgeCalendarId: null,
              lastSyncedAt: null,
              lastSyncError: null,
              createdAt: "",
              updatedAt: ""
            }
          ],
          calendars: [
            {
              id: "cal_google",
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
              createdAt: "",
              updatedAt: ""
            },
            {
              id: "cal_apple",
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
              createdAt: "",
              updatedAt: ""
            }
          ],
          events: [],
          workBlockTemplates: [],
          workBlockInstances: [],
          timeboxes: []
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getCalendarOverview();

    expect(response.calendar.calendars).toMatchObject([
      { id: "cal_google", dedupedName: "Forge (Google)" },
      { id: "cal_apple", dedupedName: "Forge (Apple)" }
    ]);
  });
});
