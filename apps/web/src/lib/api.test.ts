import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizePreparedLocalBrowser,
  beginRemoteBrowserPairing,
  cancelRemoteBrowserPairing,
  cancelRemoteBrowserPairingOnPageExit,
  claimTaskRun,
  createCalendarConnection,
  createGoal,
  createProject,
  createTask,
  createWorkAdjustment,
  finalizeWeeklyReview,
  getCalendarOverview,
  getDeletedPlanningRecord,
  getLifeEvent,
  getNote,
  ensureOperatorSession,
  getPreparedLocalBrowserAuthorizationUrl,
  getPreferenceWorkspace,
  getPsycheMetricsView,
  getSleepSession,
  getSleepSessionRawDetail,
  getTodayPriorityDecision,
  getWeeklyReview,
  listRemotePairingRequests,
  listActivity,
  listNotes,
  listWikiPages,
  patchTask,
  pollRemoteBrowserPairing,
  refreshPreferenceWorkspace,
  requestForgeBrowserJson,
  retryLocalBrowserAuthorization,
  restoreEntities,
  submitPairwisePreferenceJudgment
} from "./api";

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(body))
  } as unknown as Response;
}

function mockJsonErrorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
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

describe("work adjustment API contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the stable retry key as a header and keeps it out of the adjustment body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        adjustment: {},
        target: {},
        reward: null,
        metrics: {}
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createWorkAdjustment({
      entityType: "task",
      entityId: "task_1",
      deltaMinutes: -15,
      note: "Corrected an overcount.",
      idempotencyKey: "work-adjustment-retry-1"
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/work-adjustments");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(
      "work-adjustment-retry-1"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      entityType: "task",
      entityId: "task_1",
      deltaMinutes: -15,
      note: "Corrected an overcount."
    });
  });

  it("reuses an implicit key after a failed request and rotates it after success", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network response lost"))
      .mockResolvedValue(mockJsonResponse({ adjustment: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      entityType: "project" as const,
      entityId: "project_retry_contract",
      deltaMinutes: 15,
      note: "Captured offline planning."
    };

    await expect(createWorkAdjustment(input)).rejects.toThrow(
      "network response lost"
    );
    await createWorkAdjustment(input);
    const firstKey = new Headers(
      (fetchMock.mock.calls[0]![1] as RequestInit).headers
    ).get("Idempotency-Key");
    const retryKey = new Headers(
      (fetchMock.mock.calls[1]![1] as RequestInit).headers
    ).get("Idempotency-Key");
    expect(retryKey).toBe(firstKey);

    await createWorkAdjustment(input);
    const nextIntentKey = new Headers(
      (fetchMock.mock.calls[2]![1] as RequestInit).headers
    ).get("Idempotency-Key");
    expect(nextIntentKey).not.toBe(firstKey);
  });
});

describe("remote browser pairing client", () => {
  afterEach(() => {
    retryLocalBrowserAuthorization();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("keeps the private key in memory, honors pending status, and stores only CSRF state", async () => {
    localStorage.clear();
    vi.stubGlobal("window", {
      location: { protocol: "https:" }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          requestId: "pair_1234567890123456",
          deviceCode: `fg_device_${"A".repeat(43)}`,
          userCode: "BCDF-GHJK",
          verificationUri: "/forge/pair",
          expiresIn: 600,
          interval: 5
        })
      )
      .mockResolvedValueOnce(
        mockJsonErrorResponse(428, {
          status: "authorization_pending",
          intervalSeconds: 5
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          session: {
            id: "ses_remote_browser",
            absoluteExpiresAt: "2026-08-01T00:00:00.000Z"
          },
          csrfToken: `fg_csrf_${"B".repeat(43)}`,
          clientId: "client_remote_browser"
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);

    const pairing = await beginRemoteBrowserPairing();
    expect(pairing.userCode).toBe("BCDF-GHJK");
    expect(localStorage.length).toBe(0);

    const pending = await pollRemoteBrowserPairing(pairing);
    expect(pending).toMatchObject({
      status: "authorization_pending",
      intervalSeconds: 5
    });
    expect(localStorage.length).toBe(0);

    const approved = await pollRemoteBrowserPairing(pairing);
    expect(approved).toEqual({ status: "approved" });
    expect(localStorage.getItem("forge.browser.csrf")).toBe(
      `fg_csrf_${"B".repeat(43)}`
    );
    expect(
      Object.keys(localStorage).some((entry) =>
        /device|private|refresh|access/i.test(entry)
      )
    ).toBe(false);

    const beginBody = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body)
    ) as Record<string, unknown>;
    expect(beginBody.clientType).toBe("browser");
    expect(beginBody.requestedProfile).toBe("trusted_personal_assistant");
    expect(beginBody).not.toHaveProperty("privateKey");

    const pollBody = JSON.parse(
      String((fetchMock.mock.calls[1]![1] as RequestInit).body)
    ) as { clientProof: string };
    const [header] = pollBody.clientProof.split(".");
    const encodedHeader = header!.replaceAll("-", "+").replaceAll("_", "/");
    const protectedHeader = JSON.parse(
      atob(encodedHeader.padEnd(Math.ceil(encodedHeader.length / 4) * 4, "="))
    ) as { jwk: Record<string, unknown> };
    expect(protectedHeader.jwk).not.toHaveProperty("d");

    await cancelRemoteBrowserPairing(pairing);
  });

  it("turns the operator-session 401 into the secure remote pairing journey", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://forge.example.test",
        protocol: "https:",
        hostname: "forge.example.test"
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonErrorResponse(401, {
        code: "operator_browser_session_required",
        error: "A paired Forge browser session is required."
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOperatorSession()).rejects.toMatchObject({
      code: "browser_pairing_required"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an embedded transport preserves the Forge error envelope but not the HTTP status", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "forge-iroh://paired-forge",
        protocol: "forge-iroh:",
        hostname: "paired-forge"
      }
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          code: "operator_browser_session_required",
          error: "A paired Forge browser session is required.",
          statusCode: 401
        })
      )
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureOperatorSession()).rejects.toMatchObject({
      code: "browser_pairing_required"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects embedded 403 and 429 envelopes on shared reads and mutations", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "forge-iroh://paired-forge",
        protocol: "forge-iroh:",
        hostname: "paired-forge"
      }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              code: "pairing_owner_session_required",
              error:
                "Only the verified local owner can review pairing requests.",
              statusCode: 403
            })
          )
        } as unknown as Response
      )
      .mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              code: "pairing_admission_limited",
              error:
                "Forge cannot admit another pairing request in the current bounded window.",
              statusCode: 429
            })
          )
        } as unknown as Response
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRemotePairingRequests()).rejects.toMatchObject({
      status: 403,
      code: "pairing_owner_session_required"
    });
    await expect(
      requestForgeBrowserJson(
        "/api/v1/auth/device/requests/pair_1234567890123456/deny",
        { method: "POST", body: JSON.stringify({}) }
      )
    ).rejects.toMatchObject({
      status: 429,
      code: "pairing_admission_limited"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the server retry window on pairing admission limits", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:" }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonErrorResponse(
        429,
        {
          code: "pairing_admission_limited",
          error:
            "Forge cannot admit another pairing request in the current bounded window.",
          retryAfterSeconds: 600
        },
        { "retry-after": "600" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(beginRemoteBrowserPairing()).rejects.toMatchObject({
      code: "pairing_admission_limited",
      retryAfterSeconds: 600
    });
  });

  it("cancels an unfinished pairing on page exit without persisting the key", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:" }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          requestId: "pair_exit_1234567890123456",
          deviceCode: `fg_device_${"E".repeat(43)}`,
          userCode: "JKLM-NPQR",
          verificationUri: "/forge/pair",
          expiresIn: 180,
          interval: 5
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);

    const pairing = await beginRemoteBrowserPairing();
    cancelRemoteBrowserPairingOnPageExit(pairing);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const exitRequest = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(exitRequest.keepalive).toBe(true);
    expect(exitRequest.credentials).toBe("same-origin");
    const body = JSON.parse(String(exitRequest.body)) as {
      deviceCode: string;
      clientProof: string;
    };
    expect(body.deviceCode).toBe(`fg_device_${"E".repeat(43)}`);
    expect(body.clientProof.split(".")).toHaveLength(3);
    expect(localStorage.length).toBe(0);
  });

  it("silently renews a persisted paired browser before its next API request", async () => {
    localStorage.setItem(
      "forge.browser.renewed-at",
      String(Date.now() - 24 * 60 * 60 * 1_000)
    );
    localStorage.setItem("forge.browser.csrf", "fg_csrf_previous");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          session: {
            id: "ses_rotated_browser",
            absoluteExpiresAt: "2026-08-08T00:00:00.000Z"
          },
          csrfToken: "fg_csrf_rotated"
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          decision: null
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getTodayPriorityDecision({});

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("/api/v1/auth/browser/refresh"),
      expect.stringContaining("/api/v1/today/priority")
    ]);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe(
      "same-origin"
    );
    expect(localStorage.getItem("forge.browser.csrf")).toBe("fg_csrf_rotated");
    expect(
      Number(localStorage.getItem("forge.browser.renewed-at"))
    ).toBeGreaterThan(Date.now() - 5_000);
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
    vi.restoreAllMocks();
    localStorage.clear();
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

  it("keeps the non-authenticating CSRF value across a fresh tab for mutations", async () => {
    sessionStorage.clear();
    localStorage.setItem("forge.browser.csrf", "fg_csrf_persistent_test");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockJsonResponse({ goal: { id: "goal_persistent_csrf" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await createGoal({
      title: "Persistent browser session",
      description: "",
      horizon: "year",
      status: "active",
      userId: null,
      targetPoints: 100,
      themeColor: "#c8a46b",
      tagIds: [],
      notes: []
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-forge-csrf")).toBe(
      "fg_csrf_persistent_test"
    );
  });

  it("uses an API-launched proof-bound local-owner transaction and retries protected reads", async () => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    const handlerUrls: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      handlerUrls.push(this.href);
    });
    let authorized = false;
    const beginBodies: Record<string, unknown>[] = [];
    const exchangeBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (rawPath: unknown, init?: RequestInit) => {
      const requestPath = String(rawPath);
      if (requestPath.includes("/api/v1/auth/local/browser/begin")) {
        const beginBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        beginBodies.push(beginBody);
        const handlerUrl = new URL("forge://local-auth");
        handlerUrl.searchParams.set("apiOrigin", "http://127.0.0.1:4317");
        handlerUrl.searchParams.set(
          "browserOrigin",
          String(beginBody.browserOrigin)
        );
        handlerUrl.searchParams.set("transactionId", "local_browser_test_1");
        handlerUrl.searchParams.set(
          "browserNonce",
          String(beginBody.browserNonce)
        );
        return mockJsonResponse({
          transactionId: "local_browser_test_1",
          expiresAt: "2026-05-03T13:37:35.000Z",
          handlerUrl: handlerUrl.toString(),
          handlerLaunched: true
        });
      }
      if (requestPath.includes("/api/v1/auth/local/browser/exchange")) {
        exchangeBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        authorized = true;
        return mockJsonResponse({
          session: {
            id: "ses_1",
            actorLabel: "Albert",
            expiresAt: "2026-05-03T13:37:35.000Z"
          },
          csrfToken: "fg_csrf_browser_test"
        });
      }
      return authorized
        ? mockJsonResponse({
            pages: [{ id: "note_1", title: "Albert", slug: "albert" }]
          })
        : mockJsonErrorResponse(401, {
            code: "auth_required",
            error: "A token or operator session is required."
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listWikiPages({ kind: "wiki", limit: 25 });
    const beginBody = beginBodies[0];
    const exchangeBody = exchangeBodies[0];

    expect(result.pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/v1/wiki/pages?kind=wiki&limit=25"
    );
    expect(beginBody).toMatchObject({
      browserOrigin: window.location.origin
    });
    expect(beginBody.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(beginBody.browserPublicKey).toMatchObject({
      kty: "EC",
      crv: "P-256",
      key_ops: ["verify"]
    });
    expect(exchangeBody).toMatchObject({
      transactionId: "local_browser_test_1",
      browserOrigin: window.location.origin,
      browserNonce: beginBody.browserNonce
    });
    expect(exchangeBody.browserProof).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(fetchMock.mock.calls[3]?.[0]).toContain(
      "/api/v1/wiki/pages?kind=wiki&limit=25"
    );
    expect(window.location.hash).toBe("");
    expect(handlerUrls).toHaveLength(0);
    expect(localStorage.getItem("forge.browser.csrf")).toBe(
      "fg_csrf_browser_test"
    );
  });

  it("deduplicates concurrent proof-bound browser exchanges", async () => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined
    );
    let authorized = false;
    const fetchMock = vi.fn(async (rawPath: unknown, init?: RequestInit) => {
      const requestPath = String(rawPath);
      if (requestPath.includes("/api/v1/auth/local/browser/begin")) {
        const body = JSON.parse(String(init?.body)) as {
          browserNonce: string;
          browserOrigin: string;
        };
        const handlerUrl = new URL("forge://local-auth");
        handlerUrl.searchParams.set("apiOrigin", "http://127.0.0.1:4317");
        handlerUrl.searchParams.set("browserOrigin", body.browserOrigin);
        handlerUrl.searchParams.set("transactionId", "local_browser_test_2");
        handlerUrl.searchParams.set("browserNonce", body.browserNonce);
        return mockJsonResponse({
          transactionId: "local_browser_test_2",
          handlerUrl: handlerUrl.toString()
        });
      }
      if (requestPath.includes("/api/v1/auth/local/browser/exchange")) {
        authorized = true;
        return mockJsonResponse({
          session: {
            id: "ses_1",
            actorLabel: "Albert",
            expiresAt: "2026-05-03T13:37:35.000Z"
          },
          csrfToken: "fg_csrf_browser_test"
        });
      }
      return authorized
        ? mockJsonResponse({ pages: [] })
        : mockJsonErrorResponse(401, {
            code: "auth_required",
            error: "A token or operator session is required."
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      listWikiPages({ kind: "wiki", limit: 25 }),
      listWikiPages({ kind: "wiki", limit: 25 })
    ]);

    const requestedPaths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      requestedPaths.filter((path) =>
        path.includes("/api/v1/auth/local/browser/exchange")
      )
    ).toHaveLength(1);
    expect(
      requestedPaths.filter((path) =>
        path.includes("/api/v1/auth/local/browser/begin")
      )
    ).toHaveLength(1);
    expect(requestedPaths).toHaveLength(6);
  });

  it("stages one direct user-gesture link after a blocked automatic launch", async () => {
    localStorage.clear();
    const handlerUrls: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      handlerUrls.push(this.href);
    });
    let beginCount = 0;
    let exchangeCount = 0;
    const approvalModes: string[] = [];
    const fetchMock = vi.fn(async (rawPath: unknown, init?: RequestInit) => {
      const requestPath = String(rawPath);
      if (requestPath.includes("/api/v1/auth/local/browser/begin")) {
        beginCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          browserNonce: string;
          browserOrigin: string;
          approvalMode: string;
        };
        approvalModes.push(body.approvalMode);
        const handlerUrl = new URL("forge://local-auth");
        handlerUrl.searchParams.set("apiOrigin", "http://127.0.0.1:4317");
        handlerUrl.searchParams.set("browserOrigin", body.browserOrigin);
        handlerUrl.searchParams.set(
          "transactionId",
          `local_browser_staged_${beginCount}`
        );
        handlerUrl.searchParams.set("browserNonce", body.browserNonce);
        return mockJsonResponse({
          transactionId: `local_browser_staged_${beginCount}`,
          handlerUrl: handlerUrl.toString()
        });
      }
      if (requestPath.includes("/api/v1/auth/local/browser/exchange")) {
        exchangeCount += 1;
        if (exchangeCount === 1) {
          return mockJsonErrorResponse(503, {
            code: "local_owner_verification_failed",
            error: "The browser did not launch the owner handler."
          });
        }
        return mockJsonResponse({
          session: { id: "ses_staged" },
          csrfToken: "fg_csrf_staged_test"
        });
      }
      return mockJsonErrorResponse(401, {
        code: "auth_required",
        error: "Authentication required."
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listWikiPages({ kind: "wiki", limit: 25 })
    ).rejects.toMatchObject({
      code: "local_owner_verification_failed"
    });

    expect(handlerUrls).toHaveLength(1);
    expect(beginCount).toBe(2);
    expect(exchangeCount).toBe(1);
    expect(approvalModes).toEqual(["automatic", "interactive"]);
    const stagedHandlerUrl = getPreparedLocalBrowserAuthorizationUrl();
    expect(stagedHandlerUrl).toMatch(/^forge:\/\/local-auth\?/);

    await authorizePreparedLocalBrowser();

    expect(exchangeCount).toBe(2);
    expect(handlerUrls).toHaveLength(2);
    expect(handlerUrls[1]).toBe(stagedHandlerUrl);
    expect(
      [...new URL(handlerUrls[1]!).searchParams.keys()].sort()
    ).toEqual([
      "apiOrigin",
      "browserNonce",
      "browserOrigin",
      "transactionId"
    ]);
    expect(handlerUrls[1]).not.toContain("fg_browser_");
    expect(getPreparedLocalBrowserAuthorizationUrl()).toBeNull();
    expect(localStorage.getItem("forge.browser.csrf")).toBe(
      "fg_csrf_staged_test"
    );
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

  it("does not loop local-owner authorization after a denial", async () => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    const fetchMock = vi.fn(async (rawPath: unknown) => {
      const requestPath = String(rawPath);
      if (requestPath.includes("/api/v1/auth/local/browser/begin")) {
        return mockJsonErrorResponse(503, {
          code: "local_browser_owner_handler_unavailable",
          error: "The local owner handler is unavailable."
        });
      }
      return mockJsonErrorResponse(401, {
        code: "auth_required",
        error: "Authentication required."
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listWikiPages({ kind: "wiki", limit: 25 })
    ).rejects.toMatchObject({
      code: "local_browser_owner_handler_unavailable"
    });
    await expect(
      listWikiPages({ kind: "wiki", limit: 25 })
    ).rejects.toMatchObject({
      code: "browser_pairing_required"
    });

    const requestedPaths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      requestedPaths.filter((entry) =>
        entry.includes("/api/v1/auth/local/browser/begin")
      )
    ).toHaveLength(1);
    expect(
      requestedPaths.filter((entry) =>
        entry.includes("/api/v1/auth/local/browser/exchange")
      )
    ).toHaveLength(0);

    retryLocalBrowserAuthorization();
    await expect(
      listWikiPages({ kind: "wiki", limit: 25 })
    ).rejects.toMatchObject({
      code: "local_browser_owner_handler_unavailable"
    });
    expect(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((entry) => entry.includes("/api/v1/auth/local/browser/begin"))
    ).toHaveLength(2);
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
