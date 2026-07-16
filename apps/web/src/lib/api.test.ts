import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimTaskRun,
  createCalendarConnection,
  createGoal,
  createProject,
  createTask,
  finalizeWeeklyReview,
  getCalendarOverview,
  getDeletedPlanningRecord,
  getLifeEvent,
  getNote,
  getPreferenceWorkspace,
  getPsycheMetricsView,
  getSleepSession,
  getSleepSessionRawDetail,
  getTodayPriorityDecision,
  getWeeklyReview,
  listActivity,
  listNotes,
  listWikiPages,
  patchTask,
  refreshPreferenceWorkspace,
  restoreEntities,
  submitPairwisePreferenceJudgment
} from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

function mockJsonErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

describe("notes API contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes repeated filters, observed ranges, user scope, and opaque cursors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        notes: [],
        total: 0,
        limit: 40,
        nextCursor: null,
        hasMore: false
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listNotes({
      linkedEntityType: "goal",
      linkedEntityId: "goal_1",
      anchorKey: "spark",
      includeAnchorless: true,
      linkedTo: [
        { entityType: "goal", entityId: "goal_1" },
        { entityType: "project", entityId: "project_1" }
      ],
      tags: ["decision", "evidence"],
      textTerms: ["design review", "conflict"],
      userIds: ["user_1"],
      updatedFrom: "2026-06-01",
      updatedTo: "2026-06-30",
      observedFrom: "2026-05-01",
      observedTo: "2026-05-31",
      limit: 40,
      cursor: "opaque-cursor"
    });

    const [rawUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl, "http://forge.local");
    expect(url.pathname).toBe("/api/v1/notes");
    expect(url.searchParams.get("linkedEntityType")).toBe("goal");
    expect(url.searchParams.get("linkedEntityId")).toBe("goal_1");
    expect(url.searchParams.get("anchorKey")).toBe("spark");
    expect(url.searchParams.get("includeAnchorless")).toBe("true");
    expect(url.searchParams.getAll("linkedTo")).toEqual([
      "goal:goal_1",
      "project:project_1"
    ]);
    expect(url.searchParams.getAll("tags")).toEqual(["decision", "evidence"]);
    expect(url.searchParams.getAll("textTerms")).toEqual([
      "design review",
      "conflict"
    ]);
    expect(url.searchParams.getAll("userIds")).toEqual(["user_1"]);
    expect(url.searchParams.get("observedFrom")).toBe("2026-05-01");
    expect(url.searchParams.get("observedTo")).toBe("2026-05-31");
    expect(url.searchParams.get("cursor")).toBe("opaque-cursor");
  });
});

describe("Preferences API contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends bounded workspace reads and explicit write-authorized refreshes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ workspace: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      userId: "user_operator",
      domain: "projects" as const,
      contextId: "context_1",
      itemLimit: 25,
      itemOffset: 50,
      historyLimit: 10
    };
    await getPreferenceWorkspace(input);
    await refreshPreferenceWorkspace(input);

    const [readUrl, readInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit
    ];
    const parsedReadUrl = new URL(readUrl, "http://forge.local");
    expect(parsedReadUrl.pathname).toBe("/api/v1/preferences/workspace");
    expect(Object.fromEntries(parsedReadUrl.searchParams)).toEqual({
      userId: "user_operator",
      domain: "projects",
      contextId: "context_1",
      itemLimit: "25",
      itemOffset: "50",
      historyLimit: "10"
    });
    expect(readInit?.method).toBeUndefined();

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit
    ];
    expect(refreshUrl).toBe("/api/v1/preferences/workspace/refresh");
    expect(refreshInit.method).toBe("POST");
    expect(JSON.parse(String(refreshInit.body))).toEqual(input);
  });

  it("sends a stable judgment idempotency key outside the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ judgment: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await submitPairwisePreferenceJudgment({
      userId: "user_operator",
      domain: "projects",
      contextId: "context_1",
      leftItemId: "item_left",
      rightItemId: "item_right",
      outcome: "left",
      strength: 1,
      reasonTags: [],
      idempotencyKey: "judgment-retry-v1"
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
      "judgment-retry-v1"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      userId: "user_operator",
      domain: "projects",
      contextId: "context_1",
      leftItemId: "item_left",
      rightItemId: "item_right",
      outcome: "left",
      strength: 1,
      reasonTags: []
    });
  });
});

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
      .mockResolvedValueOnce(
        mockJsonResponse({ connection: { id: "conn_1" } })
      );
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

    const [connectionUrl, connectionInit] = fetchMock.mock.calls[2] as [
      string,
      RequestInit
    ];
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

  it("requests the canonical Today decision with explicit scope and timezone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockJsonResponse({ decision: { contractVersion: 1 } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getTodayPriorityDecision({
      userIds: ["user_albert", "user_collaborator"],
      timeZone: "Europe/Zurich",
      candidateLimit: 24
    });

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl, "http://forge.local");
    expect(url.pathname).toBe("/api/v1/today/priority");
    expect(url.searchParams.getAll("userIds")).toEqual([
      "user_albert",
      "user_collaborator"
    ]);
    expect(url.searchParams.get("timeZone")).toBe("Europe/Zurich");
    expect(url.searchParams.get("candidateLimit")).toBe("24");
  });

  it("requests Psyche metrics with explicit owner scope and timezone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ metrics: { summary: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    await getPsycheMetricsView({
      userIds: ["user_operator"],
      timeZone: "Europe/Zurich"
    });

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl, "http://forge.local");
    expect(url.pathname).toBe("/api/v1/psyche/metrics");
    expect(url.searchParams.getAll("userIds")).toEqual(["user_operator"]);
    expect(url.searchParams.get("timeZone")).toBe("Europe/Zurich");
  });

  it("bootstraps an operator session and retries protected reads after auth expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonErrorResponse(401, {
          code: "auth_required",
          error: "A token or operator session is required."
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          session: {
            id: "ses_1",
            actorLabel: "Albert",
            expiresAt: "2026-05-03T13:37:35.000Z"
          }
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          pages: [{ id: "note_1", title: "Albert", slug: "albert" }]
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listWikiPages({ kind: "wiki", limit: 25 });

    expect(result.pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/v1/wiki/pages?kind=wiki&limit=25"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/api/v1/auth/operator-session"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      "/api/v1/wiki/pages?kind=wiki&limit=25"
    );
  });

  it("deduplicates concurrent operator-session bootstrap requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonErrorResponse(401, {
          code: "auth_required",
          error: "A token or operator session is required."
        })
      )
      .mockResolvedValueOnce(
        mockJsonErrorResponse(401, {
          code: "auth_required",
          error: "A token or operator session is required."
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          session: {
            id: "ses_1",
            actorLabel: "Albert",
            expiresAt: "2026-05-03T13:37:35.000Z"
          }
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ pages: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ pages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      listWikiPages({ kind: "wiki", limit: 25 }),
      listWikiPages({ kind: "wiki", limit: 25 })
    ]);

    const requestedPaths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      requestedPaths.filter((path) =>
        path.includes("/api/v1/auth/operator-session")
      )
    ).toHaveLength(1);
    expect(requestedPaths).toHaveLength(5);
  });

  it("encodes exact-record IDs used by bounded-view focus links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const reservedId = "record/with spaces?and=reserved";
    await getNote(reservedId);
    await getSleepSession(reservedId);
    await getSleepSessionRawDetail(reservedId);
    await getLifeEvent(reservedId);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/v1/notes/record%2Fwith%20spaces%3Fand%3Dreserved",
      "/api/v1/health/sleep/record%2Fwith%20spaces%3Fand%3Dreserved",
      "/api/v1/health/sleep/record%2Fwith%20spaces%3Fand%3Dreserved/raw",
      "/api/v1/life-events/record%2Fwith%20spaces%3Fand%3Dreserved"
    ]);
  });
});

describe("activity archive requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends bounded source, entity, date, correction, and user filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ activity: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listActivity({
      limit: 100,
      entityType: "task",
      entityId: "task_alpha",
      source: "agent",
      from: "2026-07-01",
      to: "2026-07-08",
      includeCorrected: true,
      userIds: ["user_operator"]
    });

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const query = new URLSearchParams(requestUrl.split("?")[1]);

    expect(Object.fromEntries(query)).toMatchObject({
      limit: "100",
      entityType: "task",
      entityId: "task_alpha",
      source: "agent",
      from: "2026-07-01",
      to: "2026-07-08",
      includeCorrected: "true",
      userIds: "user_operator"
    });
  });
});

describe("weekly review and planning recovery requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the browser calendar timezone through review and finalize calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ review: {} }))
      .mockResolvedValueOnce(mockJsonResponse({ review: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await getWeeklyReview("Europe/Zurich");
    await finalizeWeeklyReview("Europe/Zurich");

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/v1/reviews/weekly?timeZone=Europe%2FZurich",
      "/api/v1/reviews/weekly/finalize?timeZone=Europe%2FZurich"
    ]);
  });

  it("rejects an HTTP 200 restore response whose operation failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          results: [
            {
              ok: false,
              entityType: "goal",
              id: "goal_deleted",
              error: {
                code: "not_found",
                message: "goal goal_deleted was not found in the bin."
              }
            }
          ]
        })
      )
    );

    await expect(
      restoreEntities({
        operations: [{ entityType: "goal", id: "goal_deleted" }]
      })
    ).rejects.toThrow("goal goal_deleted was not found in the bin.");
  });

  it("loads exact deleted planning metadata for a reloaded detail route", async () => {
    const deletedRecord = {
      entityType: "task" as const,
      entityId: "task_deleted",
      title: "Recover the plan",
      subtitle: "",
      deletedAt: "2026-07-11T08:00:00.000Z",
      deletedByActor: "Albert",
      deletedSource: "ui" as const,
      deleteReason: "",
      snapshot: { id: "task_deleted", level: "task", projectId: "project_1" }
    };
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        results: [
          {
            ok: true,
            matches: [
              {
                deleted: true,
                entityType: "task",
                id: "task_deleted",
                entity: deletedRecord.snapshot,
                deletedRecord
              }
            ]
          }
        ]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getDeletedPlanningRecord("task", "task_deleted")
    ).resolves.toEqual(deletedRecord);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      searches: [
        {
          entityTypes: ["task"],
          ids: ["task_deleted"],
          includeDeleted: true,
          limit: 1
        }
      ]
    });
  });
});
