import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../../../apps/api/src/app";
import { buildOpenApiDocument } from "../../../../apps/api/src/openapi";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

async function loadOnboardingPayload() {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "forge-onboarding-"));
  tempRoots.push(dataRoot);
  const app = await buildServer({ dataRoot, taskRunWatchdog: false });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agents/onboarding"
  });

  expect(response.statusCode).toBe(200);
  await app.close();
  return response.json().onboarding as {
    defaultBootstrapPolicy: {
      mode: string;
      projectsLimit: number;
      tasksLimit: number;
    };
    effectiveBootstrapPolicy: {
      mode: string;
      projectsLimit: number;
      tasksLimit: number;
    };
    defaultScopePolicy: {
      userIds: string[];
      projectIds: string[];
      tagIds: string[];
    };
    effectiveScopePolicy: {
      userIds: string[];
      projectIds: string[];
      tagIds: string[];
    };
    psycheSubmoduleModel: Record<string, string>;
    entityCatalog: Array<{
      entityType: string;
      classification: string;
      purpose?: string;
      relationshipRules?: string[];
      fieldGuide?: Array<{ name: string; description?: string }>;
      preferredMutationPath: string | null;
      preferredReadPath: string | null;
      preferredMutationTool?: string | null;
    }>;
    toolInputCatalog: Array<{
      toolName: string;
      inputShape: string;
      requiredFields: string[];
      notes: string[];
    }>;
    entityConversationPlaybooks: Array<{
      focus: string;
      openingQuestion: string;
      coachingGoal: string;
      askSequence: string[];
      routePosture: string;
      apiAccessHint: string;
    }>;
    conversationRules: string[];
    psycheCoachingPlaybooks: Array<{
      focus: string;
      openingQuestion: string;
      askSequence: string[];
      exampleQuestions?: string[];
      notes: string[];
      routePosture: string;
      apiAccessHint: string;
    }>;
    entityRouteModel: {
      batchCrudEntities: string[];
      batchRoutes: Record<string, string>;
      specializedCrudEntities: Record<
        string,
        {
          [key: string]: unknown;
          routeKeys?: string[];
          methodRoutes?: Record<string, { method: string; path: string }>;
        }
      >;
      actionEntities: Record<string, Record<string, unknown>>;
      specializedDomainSurfaces: Record<
        string,
        {
          classification?: string;
          aliases?: string[];
          routeKeys: string[];
          methodRoutes: Record<string, string>;
          readRoutes: Record<string, string>;
          writeRoutes: Record<string, string>;
          routeSelectionQuestions?: string[];
          notes: string[];
        }
      >;
      readModelOnlySurfaces: Record<string, string>;
    };
    interactionGuidance: Record<string, string>;
    mutationGuidance: Record<string, string | Record<string, string> | boolean>;
    verificationPaths: Record<string, string>;
    recommendedPluginTools?: Record<string, string[]>;
    connectionGuides?: {
      openclaw?: {
        installSteps?: string[];
        verifyCommands?: string[];
        configNotes?: string[];
      };
    };
  };
}

function normalizeRouteTemplate(route: string) {
  return route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function collectRouteStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value.startsWith("/api/v1/") ? [value] : [];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap((child) => collectRouteStrings(child));
}

function parseMethodRoute(value: string | { method: string; path: string }): {
  method: string;
  path: string;
} {
  if (typeof value === "string") {
    const match = /^([A-Z]+)\s+(\S+)$/.exec(value.trim());
    expect(match, `${value} should be METHOD /path`).toBeTruthy();
    return {
      method: match![1].toLowerCase(),
      path: normalizeRouteTemplate(match![2])
    };
  }
  return {
    method: value.method.toLowerCase(),
    path: normalizeRouteTemplate(value.path)
  };
}

describe("forge onboarding contract", () => {
  it("publishes bootstrap and default scope policies for adapter session setup", async () => {
    const onboarding = await loadOnboardingPayload();
    expect(onboarding.defaultBootstrapPolicy).toEqual(
      expect.objectContaining({
        mode: "active_only",
        projectsLimit: 8,
        tasksLimit: 10
      })
    );
    expect(onboarding.effectiveBootstrapPolicy).toEqual(
      expect.objectContaining({
        mode: "active_only"
      })
    );
    expect(onboarding.defaultScopePolicy).toEqual({
      userIds: [],
      projectIds: [],
      tagIds: []
    });
    expect(onboarding.effectiveScopePolicy).toEqual({
      userIds: [],
      projectIds: [],
      tagIds: []
    });
  });

  it("publishes the full entity catalog needed by question flows", async () => {
    const onboarding = await loadOnboardingPayload();
    const entityTypes = new Set(
      onboarding.entityCatalog.map((entry) => entry.entityType)
    );
    const playbookFocuses = new Set(
      onboarding.entityConversationPlaybooks.map((entry) => entry.focus)
    );
    const psycheFocuses = new Set(
      onboarding.psycheCoachingPlaybooks.map((entry) => entry.focus)
    );

    const expected = [
      "goal",
      "project",
      "strategy",
      "task",
      "habit",
      "tag",
      "note",
      "insight",
      "task_run",
      "work_adjustment",
      "calendar_event",
      "work_block_template",
      "task_timebox",
      "life_event",
      "calendar_connection",
      "preference_catalog",
      "preference_catalog_item",
      "preference_context",
      "preference_item",
      "preference_judgment",
      "preference_signal",
      "questionnaire_instrument",
      "questionnaire_run",
      "self_observation",
      "sleep_session",
      "sleep_overview",
      "workout_session",
      "sports_overview",
      "training_load",
      "weight_loss",
      "wiki_page",
      "movement",
      "life_force",
      "workbench",
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "mode_guide_session",
      "flashcard",
      "event_type",
      "emotion_definition",
      "trigger_report"
    ] as const;

    for (const entityType of expected) {
      expect(
        entityTypes.has(entityType),
        `${entityType} should be published`
      ).toBe(true);
    }
    const taskCatalog = onboarding.entityCatalog.find(
      (entry) => entry.entityType === "task"
    );
    const projectCatalog = onboarding.entityCatalog.find(
      (entry) => entry.entityType === "project"
    );
    expect(projectCatalog?.relationshipRules?.join(" ")).toMatch(
      /owner[\s\S]*assigneeUserIds/i
    );
    expect(projectCatalog?.relationshipRules?.join(" ")).toMatch(
      /PRD-backed[\s\S]*productRequirementsDocument[\s\S]*workflowStatus/i
    );
    const projectFields = new Set(
      projectCatalog?.fieldGuide?.map((field) => field.name) ?? []
    );
    for (const field of [
      "assigneeUserIds",
      "workflowStatus",
      "productRequirementsDocument",
      "schedulingRules"
    ]) {
      expect(
        projectFields.has(field),
        `project field ${field} should be published`
      ).toBe(true);
    }
    expect(taskCatalog?.purpose).toMatch(/issue, task, and subtask/i);
    expect(taskCatalog?.relationshipRules?.join(" ")).toMatch(
      /issues live directly under projects[\s\S]*tasks live under issues[\s\S]*subtasks live under tasks/i
    );
    expect(taskCatalog?.relationshipRules?.join(" ")).toMatch(
      /Legacy or inbox tasks/i
    );
    expect(taskCatalog?.relationshipRules?.join(" ")).toMatch(
      /owner[\s\S]*assigneeUserIds/i
    );
    const taskFields = new Set(
      taskCatalog?.fieldGuide?.map((field) => field.name) ?? []
    );
    for (const field of [
      "level",
      "parentWorkItemId",
      "assigneeUserIds",
      "aiInstructions",
      "executionMode",
      "acceptanceCriteria",
      "blockerLinks",
      "completionReport"
    ]) {
      expect(
        taskFields.has(field),
        `task field ${field} should be published`
      ).toBe(true);
    }
    expect(onboarding.psycheSubmoduleModel.flashcard).toMatch(
      /therapeutic reminder card/i
    );

    for (const focus of [
      "goal",
      "project",
      "strategy",
      "task",
      "habit",
      "tag",
      "note",
      "insight",
      "task_run",
      "work_adjustment",
      "calendar_event",
      "work_block_template",
      "task_timebox",
      "life_event",
      "calendar_connection",
      "preference_catalog",
      "preference_catalog_item",
      "preference_context",
      "preference_item",
      "preference_judgment",
      "preference_signal",
      "questionnaire_instrument",
      "questionnaire_run",
      "self_observation",
      "sleep_session",
      "sleep_overview",
      "workout_session",
      "sports_overview",
      "training_load",
      "weight_loss",
      "wiki_page",
      "movement",
      "life_force",
      "workbench",
      "event_type",
      "emotion_definition"
    ] as const) {
      expect(playbookFocuses.has(focus), `${focus} playbook should exist`).toBe(
        true
      );
    }

    for (const focus of [
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "mode_guide_session",
      "flashcard",
      "trigger_report",
      "event_type",
      "emotion_definition"
    ] as const) {
      expect(
        psycheFocuses.has(focus),
        `${focus} psyche playbook should exist`
      ).toBe(true);
    }
  });

  it("keeps batch CRUD, action entities, specialized CRUD, and specialized domain routes explicit", async () => {
    const onboarding = await loadOnboardingPayload();
    const routeModel = onboarding.entityRouteModel;

    expect(routeModel.batchCrudEntities).toEqual(
      expect.arrayContaining([
        "goal",
        "project",
        "strategy",
        "task",
        "habit",
        "note",
        "sleep_session",
        "workout_session",
        "life_event",
        "questionnaire_instrument"
      ])
    );

    expect(routeModel.specializedCrudEntities.wiki_page).toEqual(
      expect.objectContaining({
        create: "/api/v1/wiki/pages",
        update: "/api/v1/wiki/pages/:id",
        read: "/api/v1/wiki/pages/:id",
        routeKeys: expect.arrayContaining([
          "list",
          "search",
          "create",
          "read",
          "update"
        ]),
        methodRoutes: expect.objectContaining({
          list: { method: "GET", path: "/api/v1/wiki/pages" },
          search: { method: "POST", path: "/api/v1/wiki/search" },
          create: { method: "POST", path: "/api/v1/wiki/pages" },
          read: { method: "GET", path: "/api/v1/wiki/pages/:id" },
          update: { method: "PATCH", path: "/api/v1/wiki/pages/:id" }
        })
      })
    );
    expect(routeModel.specializedCrudEntities.calendar_connection).toEqual(
      expect.objectContaining({
        create: "/api/v1/calendar/connections",
        discover: "/api/v1/calendar/discovery",
        discoverMacOSLocal: "/api/v1/calendar/macos-local/discovery",
        rediscover: "/api/v1/calendar/connections/:id/discovery",
        update: "/api/v1/calendar/connections/:id",
        sync: "/api/v1/calendar/connections/:id/sync",
        delete: "/api/v1/calendar/connections/:id",
        routeKeys: expect.arrayContaining([
          "list",
          "discover",
          "discoverMacOSLocal",
          "rediscover",
          "create",
          "update",
          "sync",
          "delete"
        ]),
        methodRoutes: expect.objectContaining({
          list: { method: "GET", path: "/api/v1/calendar/connections" },
          discover: { method: "POST", path: "/api/v1/calendar/discovery" },
          discoverMacOSLocal: {
            method: "GET",
            path: "/api/v1/calendar/macos-local/discovery"
          },
          rediscover: {
            method: "GET",
            path: "/api/v1/calendar/connections/:id/discovery"
          },
          create: { method: "POST", path: "/api/v1/calendar/connections" },
          update: { method: "PATCH", path: "/api/v1/calendar/connections/:id" },
          sync: {
            method: "POST",
            path: "/api/v1/calendar/connections/:id/sync"
          },
          delete: { method: "DELETE", path: "/api/v1/calendar/connections/:id" }
        })
      })
    );

    expect(routeModel.actionEntities.task_run).toEqual(
      expect.objectContaining({
        readModel: "/api/v1/operator/context"
      })
    );
    expect(routeModel.actionEntities.questionnaire_run).toEqual(
      expect.objectContaining({
        read: "/api/v1/psyche/questionnaire-runs/:id"
      })
    );
    expect(routeModel.actionEntities.preferences).toEqual(
      expect.objectContaining({
        workspace: "/api/v1/preferences/workspace"
      })
    );
    expect(routeModel.actionEntities.preference_judgment).toEqual(
      expect.objectContaining({
        action: "/api/v1/preferences/judgments",
        tool: "forge_submit_preferences_judgment"
      })
    );
    expect(routeModel.actionEntities.preference_signal).toEqual(
      expect.objectContaining({
        action: "/api/v1/preferences/signals",
        tool: "forge_submit_preferences_signal"
      })
    );
    expect(routeModel.actionEntities.selfObservation).toEqual(
      expect.objectContaining({
        read: "/api/v1/psyche/self-observation/calendar"
      })
    );
    expect(routeModel.actionEntities.self_observation).toEqual(
      expect.objectContaining({
        read: "/api/v1/psyche/self-observation/calendar"
      })
    );

    expect(routeModel.specializedDomainSurfaces.movement.readRoutes).toEqual(
      expect.objectContaining({
        day: "/api/v1/movement/day",
        month: "/api/v1/movement/month",
        allTime: "/api/v1/movement/all-time",
        timeline: "/api/v1/movement/timeline",
        boxDetail: "/api/v1/movement/boxes/:id",
        settings: "/api/v1/movement/settings",
        places: "/api/v1/movement/places",
        tripDetail: "/api/v1/movement/trips/:id",
        selection: "/api/v1/movement/selection"
      })
    );
    expect(routeModel.specializedDomainSurfaces.movement.classification).toBe(
      "specialized_domain_surface"
    );
    expect(routeModel.specializedDomainSurfaces.movement.writeRoutes).toEqual(
      expect.objectContaining({
        settingsUpdate: "/api/v1/movement/settings",
        userBoxPreflight: "/api/v1/movement/user-boxes/preflight",
        userBoxCreate: "/api/v1/movement/user-boxes",
        userBoxDelete: "/api/v1/movement/user-boxes/:id",
        automaticBoxInvalidate:
          "/api/v1/movement/automatic-boxes/:id/invalidate",
        stayDelete: "/api/v1/movement/stays/:id",
        tripDelete: "/api/v1/movement/trips/:id",
        tripPointDelete: "/api/v1/movement/trips/:id/points/:pointId"
      })
    );
    expect(routeModel.specializedDomainSurfaces.movement.methodRoutes).toEqual(
      expect.objectContaining({
        allTime: "GET /api/v1/movement/all-time",
        settings: "GET /api/v1/movement/settings",
        settingsUpdate: "PATCH /api/v1/movement/settings",
        selection: "POST /api/v1/movement/selection",
        userBoxPreflight: "POST /api/v1/movement/user-boxes/preflight",
        userBoxDelete: "DELETE /api/v1/movement/user-boxes/:id",
        tripPointDelete: "DELETE /api/v1/movement/trips/:id/points/:pointId"
      })
    );
    expect(routeModel.specializedDomainSurfaces.movement.routeKeys).toEqual(
      Object.keys(routeModel.specializedDomainSurfaces.movement.methodRoutes)
    );
    expect(routeModel.specializedDomainSurfaces.movement.routeKeys).toEqual(
      expect.arrayContaining([
        "day",
        "month",
        "allTime",
        "timeline",
        "places",
        "tripDetail",
        "selection",
        "settings",
        "settingsUpdate",
        "userBoxPreflight",
        "userBoxCreate",
        "automaticBoxInvalidate",
        "tripPointDelete"
      ])
    );
    expect(
      routeModel.specializedDomainSurfaces.movement.routeSelectionQuestions
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /day, month, all-time, timeline, place, trip detail, selected-span, or settings/i
        ),
        expect.stringMatching(/missing-gap overlay|saved-overlay repair/i),
        expect.stringMatching(
          /operating behavior[\s\S]*passive tracking[\s\S]*publish mode[\s\S]*retention/i
        )
      ])
    );

    expect(routeModel.specializedDomainSurfaces.lifeEvents.readRoutes).toEqual(
      expect.objectContaining({
        timeline: "/api/v1/life-events/timeline",
        read: "/api/v1/life-events/:id",
        travelStatus: "/api/v1/life-events/:id/travel-status"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeEvents.aliases).toEqual(
      expect.arrayContaining(["life_event", "life-events", "Life Events"])
    );
    expect(routeModel.specializedDomainSurfaces.lifeEvents.classification).toBe(
      "specialized_domain_surface"
    );
    expect(routeModel.specializedDomainSurfaces.lifeEvents.writeRoutes).toEqual(
      expect.objectContaining({
        calendarSync: "/api/v1/life-events/:id/calendar-sync",
        fromCalendarEvent: "/api/v1/life-events/from-calendar-event",
        importTicket: "/api/v1/life-events/import-ticket"
      })
    );
    expect(
      routeModel.specializedDomainSurfaces.lifeEvents.methodRoutes
    ).toEqual(
      expect.objectContaining({
        timeline: "GET /api/v1/life-events/timeline",
        read: "GET /api/v1/life-events/:id",
        calendarSync: "POST /api/v1/life-events/:id/calendar-sync",
        fromCalendarEvent: "POST /api/v1/life-events/from-calendar-event",
        importTicket: "POST /api/v1/life-events/import-ticket",
        travelStatus: "GET /api/v1/life-events/:id/travel-status"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeEvents.routeKeys).toEqual(
      Object.keys(routeModel.specializedDomainSurfaces.lifeEvents.methodRoutes)
    );
    expect(routeModel.specializedDomainSurfaces.lifeEvents.routeKeys).toEqual([
      "timeline",
      "read",
      "calendarSync",
      "fromCalendarEvent",
      "importTicket",
      "travelStatus"
    ]);
    expect(
      routeModel.specializedDomainSurfaces.lifeEvents.routeSelectionQuestions
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /browse the life timeline, read one event, save or update the stored event, connect it to calendar, import a ticket, or check travel status/i
        ),
        expect.stringMatching(/normal life_event record[\s\S]*batch CRUD/i),
        expect.stringMatching(/trusted artifact id[\s\S]*LLM extraction/i)
      ])
    );
    expect(
      routeModel.specializedDomainSurfaces.lifeEvents.notes.join(" ")
    ).toMatch(/generic entity_links/i);

    expect(routeModel.specializedDomainSurfaces.lifeForce.readRoutes).toEqual(
      expect.objectContaining({
        overview: "/api/v1/life-force"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.aliases).toEqual(
      expect.arrayContaining(["life_force", "life-force", "Life Force"])
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.classification).toBe(
      "specialized_domain_surface"
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.writeRoutes).toEqual(
      expect.objectContaining({
        profile: "/api/v1/life-force/profile",
        weekdayTemplate: "/api/v1/life-force/templates/:weekday",
        fatigueSignal: "/api/v1/life-force/fatigue-signals"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.methodRoutes).toEqual(
      expect.objectContaining({
        overview: "GET /api/v1/life-force",
        profile: "PATCH /api/v1/life-force/profile",
        weekdayTemplate: "PUT /api/v1/life-force/templates/:weekday",
        fatigueSignal: "POST /api/v1/life-force/fatigue-signals"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.routeKeys).toEqual(
      Object.keys(routeModel.specializedDomainSurfaces.lifeForce.methodRoutes)
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.routeKeys).toEqual([
      "overview",
      "profile",
      "weekdayTemplate",
      "fatigueSignal"
    ]);
    expect(
      routeModel.specializedDomainSurfaces.lifeForce.routeSelectionQuestions
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /overview, change durable profile assumptions, change a weekday curve, or log a right-now fatigue signal/i
        )
      ])
    );
    expect(routeModel.specializedDomainSurfaces.life_force).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        aliases: expect.arrayContaining([
          "lifeForce",
          "life-force",
          "Life Force"
        ]),
        readRoutes: expect.objectContaining({
          overview: "/api/v1/life-force"
        }),
        writeRoutes: expect.objectContaining({
          profile: "/api/v1/life-force/profile",
          weekdayTemplate: "/api/v1/life-force/templates/:weekday",
          fatigueSignal: "/api/v1/life-force/fatigue-signals"
        }),
        methodRoutes: expect.objectContaining({
          overview: "GET /api/v1/life-force",
          weekdayTemplate: "PUT /api/v1/life-force/templates/:weekday"
        }),
        routeKeys: ["overview", "profile", "weekdayTemplate", "fatigueSignal"]
      })
    );

    expect(routeModel.specializedDomainSurfaces.workbench.readRoutes).toEqual(
      expect.objectContaining({
        boxCatalog: "/api/v1/workbench/catalog/boxes",
        listFlows: "/api/v1/workbench/flows",
        flowDetail: "/api/v1/workbench/flows/:id",
        flowBySlug: "/api/v1/workbench/flows/by-slug/:slug",
        runHistory: "/api/v1/workbench/flows/:id/runs",
        runs: "/api/v1/workbench/flows/:id/runs",
        publishedOutput: "/api/v1/workbench/flows/:id/output",
        latestNodeOutput: "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
      })
    );
    expect(routeModel.specializedDomainSurfaces.workbench.classification).toBe(
      "specialized_domain_surface"
    );
    expect(routeModel.specializedDomainSurfaces.workbench.writeRoutes).toEqual(
      expect.objectContaining({
        createFlow: "/api/v1/workbench/flows",
        updateFlow: "/api/v1/workbench/flows/:id",
        deleteFlow: "/api/v1/workbench/flows/:id",
        runFlow: "/api/v1/workbench/flows/:id/run",
        runByPayload: "/api/v1/workbench/run",
        chatFlow: "/api/v1/workbench/flows/:id/chat"
      })
    );
    expect(routeModel.specializedDomainSurfaces.workbench.methodRoutes).toEqual(
      expect.objectContaining({
        listFlows: "GET /api/v1/workbench/flows",
        flowDetail: "GET /api/v1/workbench/flows/:id",
        updateFlow: "PATCH /api/v1/workbench/flows/:id",
        deleteFlow: "DELETE /api/v1/workbench/flows/:id",
        runFlow: "POST /api/v1/workbench/flows/:id/run",
        chatFlow: "POST /api/v1/workbench/flows/:id/chat",
        nodeResult: "GET /api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
        latestNodeOutput: "GET /api/v1/workbench/flows/:id/nodes/:nodeId/output"
      })
    );
    expect(routeModel.specializedDomainSurfaces.workbench.routeKeys).toEqual(
      Object.keys(routeModel.specializedDomainSurfaces.workbench.methodRoutes)
    );
    expect(routeModel.specializedDomainSurfaces.workbench.routeKeys).toEqual(
      expect.arrayContaining([
        "listFlows",
        "flowDetail",
        "flowById",
        "flowBySlug",
        "boxCatalog",
        "createFlow",
        "updateFlow",
        "deleteFlow",
        "runFlow",
        "runByPayload",
        "chatFlow",
        "runHistory",
        "runs",
        "runDetail",
        "runNodes",
        "nodeResult",
        "publishedOutput",
        "latestNodeOutput"
      ])
    );
    expect(
      routeModel.specializedDomainSurfaces.workbench.routeSelectionQuestions
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /flow discovery, flow creation, flow editing, flow deletion, execution, run history, published output, run detail, node result, latest node output/i
        ),
        expect.stringMatching(
          /flow CRUD[\s\S]*stable input contract[\s\S]*expected output[\s\S]*lifecycle effect/i
        ),
        expect.stringMatching(
          /flow chat follow-up[\s\S]*saved flow[\s\S]*message[\s\S]*accomplish/i
        )
      ])
    );

    expect(routeModel.readModelOnlySurfaces).toEqual(
      expect.objectContaining({
        sleepOverview: "/api/v1/health/sleep",
        sleep_overview: "/api/v1/health/sleep",
        sportsOverview: "/api/v1/health/fitness",
        sports_overview: "/api/v1/health/fitness",
        trainingLoad: "/api/v1/health/training-load",
        training_load: "/api/v1/health/training-load",
        weightLoss: "/api/v1/health/weight-loss",
        weight_loss: "/api/v1/health/weight-loss",
        selfObservation: "/api/v1/psyche/self-observation/calendar",
        self_observation: "/api/v1/psyche/self-observation/calendar",
        calendarOverview: "/api/v1/calendar/overview",
        calendar_overview: "/api/v1/calendar/overview",
        operatorOverview: "/api/v1/operator/overview",
        operator_overview: "/api/v1/operator/overview",
        operatorContext: "/api/v1/operator/context",
        operator_context: "/api/v1/operator/context"
      })
    );
  });

  it("publishes the exact route posture for every required entity and specialized surface", async () => {
    const onboarding = await loadOnboardingPayload();
    const entityByType = new Map(
      onboarding.entityCatalog.map((entry) => [entry.entityType, entry])
    );

    const batchCrudEntities = [
      "goal",
      "project",
      "strategy",
      "task",
      "habit",
      "tag",
      "note",
      "insight",
      "calendar_event",
      "work_block_template",
      "task_timebox",
      "preference_catalog",
      "preference_catalog_item",
      "preference_context",
      "preference_item",
      "questionnaire_instrument",
      "sleep_session",
      "workout_session",
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "mode_guide_session",
      "flashcard",
      "event_type",
      "emotion_definition",
      "trigger_report"
    ] as const;

    for (const entityType of batchCrudEntities) {
      expect(entityByType.get(entityType)).toEqual(
        expect.objectContaining({
          classification: "batch_crud_entity",
          preferredMutationPath:
            "/api/v1/entities/create | /api/v1/entities/update | /api/v1/entities/delete | /api/v1/entities/restore | /api/v1/entities/search"
        })
      );
    }

    expect(entityByType.get("life_event")).toEqual(
      expect.objectContaining({
        classification: "batch_crud_entity",
        preferredMutationPath: expect.stringMatching(
          /shared batch CRUD[\s\S]*dedicated Life Event routes/i
        ),
        preferredReadPath:
          "/api/v1/life-events/timeline | /api/v1/life-events/:id | /api/v1/entities/search",
        preferredMutationTool: expect.stringMatching(
          /forge_create_entities[\s\S]*forge_call_life_event_route/i
        )
      })
    );

    expect(entityByType.get("wiki_page")).toEqual(
      expect.objectContaining({
        classification: "specialized_crud_entity",
        preferredMutationPath:
          "Use /api/v1/wiki/pages with POST or PATCH for page CRUD.",
        preferredReadPath: "/api/v1/wiki/pages/:id",
        preferredMutationTool: "forge_upsert_wiki_page"
      })
    );
    expect(entityByType.get("calendar_connection")).toEqual(
      expect.objectContaining({
        classification: "specialized_crud_entity",
        preferredMutationPath:
          "Use /api/v1/calendar/discovery or /api/v1/calendar/macos-local/discovery before setup when needed; use /api/v1/calendar/connections with POST, PATCH, DELETE, rediscovery, and sync for connection lifecycle work.",
        preferredReadPath: "/api/v1/calendar/connections",
        preferredMutationTool:
          "forge_connect_calendar_provider | forge_sync_calendar_connection | mirrored calendar connection routes"
      })
    );

    expect(entityByType.get("task_run")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredReadPath: "/api/v1/operator/context",
        preferredMutationTool:
          "forge_start_task_run | forge_heartbeat_task_run | forge_focus_task_run | forge_complete_task_run | forge_release_task_run"
      })
    );
    expect(entityByType.get("work_adjustment")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredMutationPath:
          "Use /api/v1/work-adjustments to apply an explicit operator adjustment.",
        preferredMutationTool: "forge_adjust_work_minutes"
      })
    );
    expect(entityByType.get("preference_judgment")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredMutationPath:
          "Use /api/v1/preferences/judgments to record one pairwise comparison.",
        preferredMutationTool: "forge_submit_preferences_judgment"
      })
    );
    expect(entityByType.get("preference_signal")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredMutationPath:
          "Use /api/v1/preferences/signals to record one direct signal such as favorite or veto.",
        preferredMutationTool: "forge_submit_preferences_signal"
      })
    );
    expect(entityByType.get("questionnaire_run")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredReadPath: "/api/v1/psyche/questionnaire-runs/:id",
        preferredMutationTool:
          "forge_start_questionnaire_run | forge_update_questionnaire_run | forge_complete_questionnaire_run"
      })
    );

    expect(entityByType.get("self_observation")).toEqual(
      expect.objectContaining({
        classification: "action_workflow_entity",
        preferredMutationPath:
          "Read the calendar surface; mutate it by creating or updating note-backed observations with frontmatter.observedAt.",
        preferredReadPath: "/api/v1/psyche/self-observation/calendar",
        preferredMutationTool:
          "forge_get_self_observation_calendar | forge_create_entities | forge_update_entities"
      })
    );
    expect(entityByType.get("sleep_session")).toEqual(
      expect.objectContaining({
        preferredMutationTool: expect.stringMatching(
          /forge_update_sleep_session for reflective enrichment after review/
        )
      })
    );
    expect(entityByType.get("workout_session")).toEqual(
      expect.objectContaining({
        preferredMutationTool: expect.stringMatching(
          /forge_update_workout_session for reflective enrichment after review/
        )
      })
    );
    expect(entityByType.get("weight_loss")).toEqual(
      expect.objectContaining({
        classification: "read_model_only_surface",
        preferredMutationPath: expect.stringMatching(
          /Read-only surface[\s\S]*dedicated nutrition tools/
        ),
        preferredReadPath: "/api/v1/health/weight-loss",
        preferredMutationTool: expect.stringMatching(
          /forge_get_weight_loss_overview[\s\S]*forge_log_food[\s\S]*forge_start_nutrition_experiment/
        )
      })
    );
    expect(entityByType.get("movement")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Movement route family for day, month, all-time, timeline, places, trip detail, selection aggregates, overlays, and repair actions.",
        preferredReadPath: "/api/v1/movement/timeline",
        preferredMutationTool: "forge_call_movement_route"
      })
    );
    expect(entityByType.get("life_force")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Life Force route family for overview, profile edits, weekday templates, and fatigue signals.",
        preferredReadPath: "/api/v1/life-force",
        preferredMutationTool: "forge_call_life_force_route"
      })
    );
    expect(entityByType.get("workbench")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Workbench route family for flow CRUD, execution, saved-flow chat follow-ups, run history, published outputs, node results, and latest-node-output reads.",
        preferredReadPath: "/api/v1/workbench/flows",
        preferredMutationTool: "forge_call_workbench_route"
      })
    );
  });

  it("publishes high-level interaction rules for review shortcuts and write-model selection", async () => {
    const onboarding = await loadOnboardingPayload();

    expect(onboarding.interactionGuidance).toEqual(
      expect.objectContaining({
        depthCalibrationRule: expect.stringMatching(
          /quick capture[\s\S]*guided formulation[\s\S]*review-first[\s\S]*action-first[\s\S]*simple storage request/i
        ),
        operationLaneRule: expect.stringMatching(
          /Normal stored entities[\s\S]*added, updated, reviewed or navigated, linked, or placed[\s\S]*Action workflows[\s\S]*start, continue, complete, adjust, judge, signal, publish, sync, or observe[\s\S]*Movement, Life Events, Life Force, and Workbench[\s\S]*review, correct, repair, run, inspect, publish, preserve, calendar-sync, ticket-import, or status[\s\S]*Psyche entities[\s\S]*formulation lane/i
        ),
        specializedSurfaceRule: expect.stringMatching(
          /Movement, Life Events, Life Force, and Workbench[\s\S]*forge_call_movement_route[\s\S]*forge_call_life_event_route[\s\S]*forge_call_life_force_route[\s\S]*forge_call_workbench_route[\s\S]*route-key tool is unavailable, stale, or missing[\s\S]*methodRoutes[\s\S]*do not fall back to generic batch CRUD[\s\S]*read the relevant view back[\s\S]*\/forge\/v1\/movement[\s\S]*\/forge\/v1\/life-events[\s\S]*\/forge\/v1\/life-force[\s\S]*\/forge\/v1\/workbench/i
        ),
        reviewShortcutRule: expect.stringMatching(
          /reviewing or correcting an existing record[\s\S]*correct read posture[\s\S]*shared batch search or read hints[\s\S]*wiki\/calendar dedicated reads[\s\S]*read-model routes[\s\S]*Movement, Life Events, Life Force, or Workbench dedicated reads[\s\S]*answer the practical question/i
        ),
        readModelWriteRule: expect.stringMatching(
          /Self-observation is note-backed[\s\S]*Sleep and workout sessions stay on batch CRUD by default/i
        ),
        psycheHypothesisRule: expect.stringMatching(
          /concrete Psyche example[\s\S]*user's own example[\s\S]*protection, prediction, relief, or cost[\s\S]*hypothesis timing checkpoint[\s\S]*second or third deepening question[\s\S]*record shape, wording, links, or next action[\s\S]*Do not hypothesize yet[\s\S]*direct mechanical save[\s\S]*flooded or unsafe[\s\S]*Do not present schema, mode, belief, or pattern language as a verdict/i
        ),
        mixedIntentSequencingRule: expect.stringMatching(
          /several Forge jobs[\s\S]*read first[\s\S]*Movement timeline or box detail[\s\S]*Life Events timeline or event detail[\s\S]*Workbench run or node detail[\s\S]*Life Force overview[\s\S]*primary Psyche record first[\s\S]*flashcard, note, link, task, or habit/i
        ),
        duplicateDisambiguationRule: expect.stringMatching(
          /normal stored entity[\s\S]*search the shared batch entity route[\s\S]*update that record, link to it, or save a separate new record[\s\S]*Psyche records[\s\S]*formulation choice[\s\S]*wiki_page and calendar_connection[\s\S]*dedicated search\/list\/read routes[\s\S]*Movement, Life Events, Life Force, and Workbench[\s\S]*dedicated read lanes/i
        ),
        destructiveActionRule: expect.stringMatching(
          /deleting, archiving, invalidating, overwriting, disconnecting,[\s\S]*confirm the exact target[\s\S]*soft-delete[\s\S]*Psyche records[\s\S]*updated, linked as history, archived, or kept distinct[\s\S]*Movement[\s\S]*automatic-box invalidation[\s\S]*calendar connections, Workbench flows, wiki pages, and questionnaire instruments/i
        )
      })
    );
    expect(
      onboarding.recommendedPluginTools?.specializedDomainWorkflow
    ).toEqual([
      "forge_call_movement_route",
      "forge_call_life_event_route",
      "forge_call_life_force_route",
      "forge_call_workbench_route"
    ]);
    expect(onboarding.mutationGuidance.specializedRouteToolRule).toMatch(
      /forge_call_movement_route[\s\S]*forge_call_life_event_route[\s\S]*forge_call_life_force_route[\s\S]*forge_call_workbench_route[\s\S]*toolInputCatalog[\s\S]*routeKey[\s\S]*pathParams[\s\S]*query[\s\S]*body[\s\S]*batch entity tools/i
    );
    expect(onboarding.mutationGuidance.specializedRouteToolRule).toMatch(
      /Life Force overview route key maps to GET \/api\/v1\/life-force[\s\S]*do not invent \/api\/v1\/life-force\/overview/i
    );
    expect(onboarding.mutationGuidance.specializedRouteToolExample).toMatch(
      /weekdayTemplate[\s\S]*monday/i
    );
    const specializedExamples = onboarding.mutationGuidance
      .specializedRouteToolExamples as Record<string, string>;

    expect(specializedExamples).toEqual(
      expect.objectContaining({
        movementAllTime: expect.stringMatching(/routeKey[\s\S]*allTime/),
        movementTimeline: expect.stringMatching(/routeKey[\s\S]*timeline/),
        movementSelection: expect.stringMatching(
          /routeKey[\s\S]*selection[\s\S]*body[\s\S]*placeIds/
        ),
        movementTripDetail: expect.stringMatching(/routeKey[\s\S]*tripDetail/),
        movementSettings: expect.stringMatching(/routeKey[\s\S]*settings/),
        movementSettingsUpdate: expect.stringMatching(
          /routeKey[\s\S]*settingsUpdate[\s\S]*publishMode/
        ),
        movementMissingStayPreflight: expect.stringMatching(
          /routeKey[\s\S]*userBoxPreflight[\s\S]*startedAt[\s\S]*placeLabel/
        ),
        lifeEventsTimeline: expect.stringMatching(
          /routeKey[\s\S]*timeline[\s\S]*type/
        ),
        lifeEventRead: expect.stringMatching(
          /routeKey[\s\S]*read[\s\S]*pathParams[\s\S]*id/
        ),
        lifeEventCalendarSync: expect.stringMatching(
          /routeKey[\s\S]*calendarSync[\s\S]*pathParams[\s\S]*projection/
        ),
        lifeEventFromCalendar: expect.stringMatching(
          /routeKey[\s\S]*fromCalendarEvent[\s\S]*calendarEventId/
        ),
        lifeEventImportTicket: expect.stringMatching(
          /routeKey[\s\S]*importTicket[\s\S]*artifactId/
        ),
        lifeEventTravelStatus: expect.stringMatching(
          /routeKey[\s\S]*travelStatus[\s\S]*pathParams[\s\S]*id/
        ),
        lifeForceOverview: expect.stringMatching(/routeKey[\s\S]*overview/),
        lifeForceProfile: expect.stringMatching(
          /routeKey[\s\S]*profile[\s\S]*baselineDailyAp/
        ),
        lifeForceWeekdayTemplate: expect.stringMatching(
          /routeKey[\s\S]*weekdayTemplate[\s\S]*pathParams[\s\S]*weekday/
        ),
        lifeForceFatigueSignal: expect.stringMatching(
          /routeKey[\s\S]*fatigueSignal[\s\S]*intensity/
        ),
        workbenchFlowCatalog: expect.stringMatching(/routeKey[\s\S]*listFlows/),
        workbenchFlowDetail: expect.stringMatching(
          /routeKey[\s\S]*flowDetail[\s\S]*pathParams[\s\S]*id/
        ),
        workbenchBoxCatalog: expect.stringMatching(/routeKey[\s\S]*boxCatalog/),
        workbenchCreateFlow: expect.stringMatching(
          /routeKey[\s\S]*createFlow[\s\S]*stable published summary/
        ),
        workbenchUpdateFlow: expect.stringMatching(
          /routeKey[\s\S]*updateFlow[\s\S]*pathParams/
        ),
        workbenchDeleteFlow: expect.stringMatching(
          /routeKey[\s\S]*deleteFlow[\s\S]*pathParams/
        ),
        workbenchRunHistory: expect.stringMatching(
          /routeKey[\s\S]*runHistory[\s\S]*pathParams[\s\S]*id/
        ),
        workbenchRunDetail: expect.stringMatching(
          /routeKey[\s\S]*runDetail[\s\S]*pathParams[\s\S]*runId/
        ),
        workbenchPublishedOutput: expect.stringMatching(
          /routeKey[\s\S]*publishedOutput/
        ),
        workbenchLatestNodeOutput: expect.stringMatching(
          /routeKey[\s\S]*latestNodeOutput[\s\S]*nodeId/
        ),
        workbenchRunFlow: expect.stringMatching(
          /routeKey[\s\S]*runFlow[\s\S]*pathParams/
        ),
        workbenchRunByPayload: expect.stringMatching(
          /routeKey[\s\S]*runByPayload[\s\S]*body[\s\S]*input/
        ),
        workbenchChatFlow: expect.stringMatching(
          /routeKey[\s\S]*chatFlow[\s\S]*message/
        )
      })
    );
    expect(specializedExamples).toEqual(
      expect.objectContaining({
        movementAutomaticBoxInvalidate: expect.stringMatching(
          /routeKey[\s\S]*automaticBoxInvalidate[\s\S]*pathParams[\s\S]*box_auto_123[\s\S]*body[\s\S]*reason/
        ),
        movementStayUpdate: expect.stringMatching(
          /routeKey[\s\S]*stayUpdate[\s\S]*pathParams[\s\S]*stay_123[\s\S]*body/
        ),
        movementStayDelete: expect.stringMatching(
          /routeKey[\s\S]*stayDelete[\s\S]*pathParams[\s\S]*stay_123/
        ),
        movementTripUpdate: expect.stringMatching(
          /routeKey[\s\S]*tripUpdate[\s\S]*pathParams[\s\S]*trip_123[\s\S]*body/
        ),
        movementTripDelete: expect.stringMatching(
          /routeKey[\s\S]*tripDelete[\s\S]*pathParams[\s\S]*trip_123/
        ),
        movementTripPointUpdate: expect.stringMatching(
          /routeKey[\s\S]*tripPointUpdate[\s\S]*pathParams[\s\S]*pointId[\s\S]*body/
        ),
        movementTripPointDelete: expect.stringMatching(
          /routeKey[\s\S]*tripPointDelete[\s\S]*pathParams[\s\S]*pointId/
        )
      })
    );
    expect(specializedExamples.movementSelection).not.toMatch(/"query"/);
  });

  it("keeps specialized route examples aligned with their HTTP method shape", async () => {
    const onboarding = await loadOnboardingPayload();
    const specializedExamples = onboarding.mutationGuidance
      .specializedRouteToolExamples as Record<string, string>;
    const surfaces = onboarding.entityRouteModel.specializedDomainSurfaces;

    for (const [exampleName, exampleJson] of Object.entries(
      specializedExamples
    )) {
      const example = JSON.parse(exampleJson) as {
        routeKey: string;
        query?: unknown;
        body?: unknown;
      };
      const methodRoute = Object.values(surfaces)
        .map((surface) => surface.methodRoutes[example.routeKey])
        .find(Boolean);

      expect(
        methodRoute,
        `${exampleName} should map to a live route key`
      ).toBeTruthy();
      if (!methodRoute) {
        continue;
      }

      const method = methodRoute.split(" ")[0];
      if (["POST", "PATCH", "PUT"].includes(method)) {
        expect(
          example.body,
          `${exampleName} should pass POST/PATCH/PUT data in body`
        ).toBeDefined();
        expect(
          example.query,
          `${exampleName} should not put POST/PATCH/PUT data in query`
        ).toBeUndefined();
      }
      if (method === "GET") {
        expect(
          example.body,
          `${exampleName} GET should not send body`
        ).toBeUndefined();
      }
    }
  });

  it("keeps specialized tool input catalog route keys synced with live onboarding surfaces", async () => {
    const onboarding = await loadOnboardingPayload();
    const toolByName = new Map(
      onboarding.toolInputCatalog.map((tool) => [tool.toolName, tool])
    );
    const surfaceToolPairs = [
      ["lifeEvents", "forge_call_life_event_route"],
      ["movement", "forge_call_movement_route"],
      ["lifeForce", "forge_call_life_force_route"],
      ["workbench", "forge_call_workbench_route"]
    ] as const;

    for (const [surfaceKey, toolName] of surfaceToolPairs) {
      const surface =
        onboarding.entityRouteModel.specializedDomainSurfaces[surfaceKey];
      const tool = toolByName.get(toolName);

      expect(surface, `${surfaceKey} surface`).toBeTruthy();
      expect(tool, `${toolName} input catalog`).toBeTruthy();
      expect(tool?.requiredFields).toContain("routeKey");
      expect(tool?.inputShape).toMatch(/routeKey/);
      expect(tool?.inputShape).toMatch(/pathParams/);
      expect(tool?.inputShape).toMatch(/query/);
      expect(tool?.inputShape).toMatch(/body/);
      expect(tool?.notes.join(" ")).toMatch(/live onboarding/i);
      expect(tool?.notes.join(" ")).toMatch(/methodRoutes/);
      expect(tool?.notes.join(" ")).toMatch(/pathParams/);

      for (const routeKey of surface.routeKeys) {
        expect(
          tool?.inputShape,
          `${toolName} should advertise ${routeKey}`
        ).toContain(`"${routeKey}"`);
        expect(
          surface.methodRoutes[routeKey],
          `${surfaceKey}.${routeKey} method route`
        ).toBeTruthy();
      }
    }
  });

  it("keeps specialized and Psyche playbooks explicit about active listening and route narrowing", async () => {
    const onboarding = await loadOnboardingPayload();
    const playbookByFocus = new Map(
      onboarding.entityConversationPlaybooks.map((entry) => [
        entry.focus,
        entry
      ])
    );
    const psycheByFocus = new Map(
      onboarding.psycheCoachingPlaybooks.map((entry) => [entry.focus, entry])
    );

    for (const entry of [
      ...onboarding.entityConversationPlaybooks,
      ...onboarding.psycheCoachingPlaybooks
    ]) {
      expect(entry.routePosture, `${entry.focus} route posture`).toBeTruthy();
      expect(entry.apiAccessHint, `${entry.focus} API hint`).toMatch(
        /Route posture:/
      );
    }
    for (const entry of onboarding.entityConversationPlaybooks) {
      if (entry.routePosture === "read_model_only_surface") {
        expect(
          entry.apiAccessHint,
          `${entry.focus} read-model playbook should publish its exact read path`
        ).toMatch(/Read: \/api\/v1\//);
      }
    }

    for (const entry of onboarding.psycheCoachingPlaybooks) {
      expect(
        entry.openingQuestion,
        `${entry.focus} should publish a first-class opening question`
      ).toMatch(/\?$/);
      expect(entry.openingQuestion).toBe(entry.exampleQuestions?.[0]);
    }

    expect(playbookByFocus.get("goal")).toEqual(
      expect.objectContaining({
        routePosture: "batch_crud_entity",
        apiAccessHint: expect.stringMatching(
          /\/api\/v1\/entities\/create[\s\S]*\/api\/v1\/goals/
        )
      })
    );
    expect(playbookByFocus.get("wiki_page")).toEqual(
      expect.objectContaining({
        routePosture: "specialized_crud_entity",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/wiki\/pages/)
      })
    );
    expect(playbookByFocus.get("task_run")).toEqual(
      expect.objectContaining({
        routePosture: "action_workflow_entity",
        apiAccessHint: expect.stringMatching(/forge_start_task_run/)
      })
    );
    expect(playbookByFocus.get("task")).toEqual(
      expect.objectContaining({
        routePosture: "batch_crud_entity",
        coachingGoal: expect.stringMatching(/one-session work item/i),
        askSequence: expect.arrayContaining([
          expect.stringMatching(/issue, one-session task, or subtask/i),
          expect.stringMatching(/project for an issue, issue for a task/i),
          expect.stringMatching(/aiInstructions/i)
        ])
      })
    );
    expect(playbookByFocus.get("self_observation")).toEqual(
      expect.objectContaining({
        routePosture: "action_workflow_entity",
        apiAccessHint: expect.stringMatching(
          /\/api\/v1\/psyche\/self-observation\/calendar[\s\S]*forge_get_self_observation_calendar/
        )
      })
    );
    expect(playbookByFocus.get("movement")).toEqual(
      expect.objectContaining({
        routePosture: "specialized_domain_surface",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/movement\/timeline/)
      })
    );
    expect(playbookByFocus.get("life_event")).toEqual(
      expect.objectContaining({
        routePosture: "batch_crud_entity",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/life-events\/timeline/)
      })
    );
    expect(playbookByFocus.get("life_force")).toEqual(
      expect.objectContaining({
        routePosture: "specialized_domain_surface",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/life-force/)
      })
    );
    expect(playbookByFocus.get("workbench")).toEqual(
      expect.objectContaining({
        routePosture: "specialized_domain_surface",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/workbench\/flows/)
      })
    );
    expect(psycheByFocus.get("behavior_pattern")).toEqual(
      expect.objectContaining({
        routePosture: "batch_crud_entity",
        apiAccessHint: expect.stringMatching(/\/api\/v1\/entities\/create/)
      })
    );
    expect(psycheByFocus.get("flashcard")).toEqual(
      expect.objectContaining({
        routePosture: "batch_crud_entity",
        apiAccessHint: expect.stringMatching(
          /\/api\/v1\/entities\/(?:create|search)[\s\S]*flashcard/i
        )
      })
    );
    expect(psycheByFocus.get("flashcard")?.askSequence.join(" ")).toMatch(
      /message[\s\S]*tags[\s\S]*trigger/i
    );
    const modeProfilePlaybook = psycheByFocus.get("mode_profile");
    expect(modeProfilePlaybook).toBeDefined();
    const modeProfileSequence =
      modeProfilePlaybook?.askSequence.join(" ") ?? "";
    expect(modeProfileSequence).toMatch(
      /protective job before choosing a family label/i
    );
    expect(
      modeProfileSequence.indexOf(
        "Clarify its fear, burden, and protective job"
      ),
      "mode profile should formulate fear and burden before the family label"
    ).toBeLessThan(
      modeProfileSequence.indexOf("Choose the mode family only after")
    );

    expect(playbookByFocus.get("task_run")).toEqual(
      expect.objectContaining({
        openingQuestion: "Which task should I start?"
      })
    );
    expect(playbookByFocus.get("task_run")?.askSequence.join(" ")).toMatch(
      /dedicated task-run tool/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /task_run, work_adjustment, questionnaire_run, preference_judgment, preference_signal, and self_observation[\s\S]*do not downgrade[\s\S]*generic batch CRUD/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /normal stored Preferences and questionnaire records[\s\S]*batch CRUD by default/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /reflection-sensitive non-Psyche records[\s\S]*questionnaire_run[\s\S]*self_observation[\s\S]*wiki_page[\s\S]*sleep_session[\s\S]*workout_session/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /understand, decide, notice, remember, or change later[\s\S]*batch CRUD[\s\S]*questionnaire run actions[\s\S]*self-observation calendar reads[\s\S]*wiki routes/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /review-first requests[\s\S]*correct read posture[\s\S]*shared batch search or read hints[\s\S]*wiki\/calendar dedicated reads[\s\S]*read-model routes[\s\S]*Movement, Life Events, Life Force, or Workbench dedicated reads/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /Self-observation is not the default container[\s\S]*behavior_pattern for a recurring loop and functional analysis/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /Do not bury schema work in self-observation[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /Do not minimize functional analysis[\s\S]*interpretive hypothesis/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /collaborative and testable[\s\S]*not as verdicts/i
    );
    expect(onboarding.interactionGuidance.followUpQuestionRule).toMatch(
      /After a substantive answer[\s\S]*exactly one next lane[\s\S]*stop asking/i
    );
    expect(onboarding.interactionGuidance.mixedIntentSequencingRule).toMatch(
      /do not ask a broad lane question[\s\S]*span, wording, event, artifact, flow, run, node, weekday, or link/i
    );
    expect(onboarding.interactionGuidance.duplicateDisambiguationRule).toMatch(
      /compare the sentence, cue\/payoff\/cost, protective job, episode, urge sentence, or message/i
    );
    expect(onboarding.interactionGuidance.destructiveActionRule).toMatch(
      /downstream sync, published output, backlinks, run history, or completed runs/i
    );
    expect(onboarding.interactionGuidance.antiDriftRule).toMatch(
      /Avoid vague reflective filler[\s\S]*surface, CRUD, payload[\s\S]*route key, batch route[\s\S]*product nouns/i
    );
    expect(onboarding.interactionGuidance.antiDriftRule).toMatch(
      /belief[\s\S]*pattern[\s\S]*timeline[\s\S]*weekday template[\s\S]*published output[\s\S]*cannot yet name the product noun[\s\S]*grounding question/i
    );
    expect(onboarding.conversationRules.join(" ")).toMatch(
      /book, article, paper, source, concept, person, conversation, project reference/i
    );

    expect(playbookByFocus.get("wiki_page")?.openingQuestion).toMatch(
      /remember or reuse later/i
    );
    expect(playbookByFocus.get("wiki_page")?.askSequence.join(" ")).toMatch(
      /book, article, source, concept, person, conversation, project reference, or personal manual/i
    );
    expect(playbookByFocus.get("self_observation")?.openingQuestion).toMatch(
      /what happened in the situation/i
    );
    expect(
      playbookByFocus.get("self_observation")?.askSequence.join(" ")
    ).toMatch(
      /situation[\s\S]*cue[\s\S]*emotion[\s\S]*thought[\s\S]*behavior[\s\S]*consequence/i
    );
    expect(
      playbookByFocus.get("self_observation")?.askSequence.join(" ")
    ).toMatch(/Do not promote self-observation over functional analysis/i);

    expect(
      playbookByFocus.get("preference_item")?.askSequence.join(" ")
    ).toMatch(/batch CRUD[\s\S]*preference judgment or signal route/i);
    expect(
      playbookByFocus.get("preference_judgment")?.askSequence.join(" ")
    ).toMatch(
      /dedicated preference judgment action route[\s\S]*instead of batch CRUD/i
    );
    expect(
      playbookByFocus.get("preference_signal")?.askSequence.join(" ")
    ).toMatch(
      /dedicated preference signal action route[\s\S]*instead of batch CRUD/i
    );
    expect(
      playbookByFocus.get("questionnaire_instrument")?.askSequence.join(" ")
    ).toMatch(/batch CRUD[\s\S]*clone, draft, and publish actions/i);
    expect(
      playbookByFocus.get("questionnaire_instrument")?.openingQuestion
    ).toMatch(/honest moment or decision/i);
    expect(
      playbookByFocus.get("questionnaire_instrument")?.askSequence.join(" ")
    ).toMatch(
      /respondent should understand[\s\S]*item shape, response scale, scoring, or provenance/i
    );
    expect(
      playbookByFocus.get("questionnaire_run")?.askSequence.join(" ")
    ).toMatch(
      /dedicated questionnaire run start, read, update, and complete routes/i
    );
    expect(playbookByFocus.get("questionnaire_run")?.openingQuestion).toMatch(
      /start, continue, review, or finish this run/i
    );
    expect(
      playbookByFocus.get("questionnaire_run")?.askSequence.join(" ")
    ).toMatch(/reviewing answers[\s\S]*help them understand/i);

    expect(playbookByFocus.get("movement")?.askSequence.join(" ")).toMatch(
      /day, month, all-time, timeline, places, trip-detail,[\s\S]*selection route/i
    );
    expect(playbookByFocus.get("movement")?.askSequence.join(" ")).toMatch(
      /allTime[\s\S]*whole-history aggregates[\s\S]*selection[\s\S]*bounded selected-span aggregate[\s\S]*tripDetail/i
    );
    expect(playbookByFocus.get("movement")?.askSequence[0]).toMatch(
      /make clearer, repair, or preserve/i
    );
    expect(playbookByFocus.get("movement")?.askSequence.join(" ")).toMatch(
      /exact correction or review target/i
    );
    expect(playbookByFocus.get("movement")?.askSequence.join(" ")).toMatch(
      /read the timeline or saved-box detail before you mutate it/i
    );

    expect(playbookByFocus.get("life_force")?.askSequence.join(" ")).toMatch(
      /read the overview back/i
    );
    expect(playbookByFocus.get("life_force")?.askSequence.join(" ")).toMatch(
      /routeKey overview[\s\S]*GET \/api\/v1\/life-force[\s\S]*not \/api\/v1\/life-force\/overview/i
    );
    expect(playbookByFocus.get("life_force")?.openingQuestion).toMatch(
      /energy picture right now/i
    );
    expect(playbookByFocus.get("life_force")?.askSequence[0]).toMatch(
      /before you reduce it to one life-force lane/i
    );
    expect(playbookByFocus.get("life_force")?.askSequence.join(" ")).toMatch(
      /Mondays crash after lunch|weekday-template question/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence[0]).toMatch(
      /before you narrow to flow discovery/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /listFlows[\s\S]*saved flow catalog[\s\S]*boxCatalog[\s\S]*input-box contracts/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /stable public input contract or published output/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /run summary, one node result, the latest node output, or the published output/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /follow-up message in a saved flow chat[\s\S]*not treating it as a new run or note|saved flow[\s\S]*message should accomplish[\s\S]*new run or note/i
    );

    expect(psycheByFocus.get("psyche_value")?.askSequence.join(" ")).toMatch(
      /ordinary recent moment[\s\S]*Reflect the direction/i
    );
    expect(psycheByFocus.get("belief_entry")?.askSequence.join(" ")).toMatch(
      /recent moment[\s\S]*own words[\s\S]*after the sentence lands/i
    );
    expect(psycheByFocus.get("belief_entry")?.askSequence.join(" ")).toMatch(
      /Explore evidence, origin, and a flexible alternative only if/i
    );
    expect(psycheByFocus.get("behavior_pattern")?.notes.join(" ")).toMatch(
      /Before you ask how to change the loop, ask what it is protecting/i
    );
    expect(psycheByFocus.get("behavior_pattern")?.notes.join(" ")).toMatch(
      /tentative functional-analysis hypothesis/i
    );
    for (const focus of [
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "mode_guide_session",
      "flashcard",
      "trigger_report",
      "event_type",
      "emotion_definition"
    ] as const) {
      const guidance = [
        ...(psycheByFocus.get(focus)?.askSequence ?? []),
        ...(psycheByFocus.get(focus)?.notes ?? [])
      ].join(" ");
      expect(guidance, `${focus} should publish hypothesis guidance`).toMatch(
        /hypothes/i
      );
    }
    expect(psycheByFocus.get("psyche_value")?.notes.join(" ")).toMatch(
      /pain, longing, or value conflict/i
    );
    expect(psycheByFocus.get("behavior")?.notes.join(" ")).toMatch(
      /immediate problem the behavior solves/i
    );
    expect(psycheByFocus.get("belief_entry")?.notes.join(" ")).toMatch(
      /rule or prediction[\s\S]*invite correction/i
    );
    expect(psycheByFocus.get("belief_entry")?.notes.join(" ")).toMatch(
      /Do not rush to confidence, evidence, or flexible alternatives/i
    );
    expect(psycheByFocus.get("mode_profile")?.notes.join(" ")).toMatch(
      /protective job, fear, or burden/i
    );
    expect(psycheByFocus.get("mode_profile")?.notes.join(" ")).toMatch(
      /Do not start by asking for the mode family/i
    );
    expect(psycheByFocus.get("mode_guide_session")?.notes.join(" ")).toMatch(
      /exploration worksheet|interpretations tentative/i
    );
    expect(psycheByFocus.get("mode_guide_session")?.notes.join(" ")).toMatch(
      /trying to stop, force, prevent, or secure/i
    );
    expect(psycheByFocus.get("flashcard")?.notes.join(" ")).toMatch(
      /card needs to meet in the hard moment/i
    );
    expect(psycheByFocus.get("trigger_report")?.askSequence.join(" ")).toMatch(
      /felt stake[\s\S]*situation, emotion, meaning, behavior, and consequence/i
    );
    expect(psycheByFocus.get("trigger_report")?.notes.join(" ")).toMatch(
      /worksheet dump[\s\S]*felt stake/i
    );
    expect(psycheByFocus.get("event_type")?.askSequence.join(" ")).toMatch(
      /repeated emotional or relational stake/i
    );
    expect(psycheByFocus.get("event_type")?.notes.join(" ")).toMatch(
      /future reports need this event type to preserve/i
    );
    expect(
      psycheByFocus.get("emotion_definition")?.askSequence.join(" ")
    ).toMatch(/felt signature/i);
    expect(psycheByFocus.get("emotion_definition")?.notes.join(" ")).toMatch(
      /warns about, protects, demands, or longs for/i
    );

    expect(playbookByFocus.get("event_type")?.coachingGoal).toMatch(
      /Psyche-quality questioning[\s\S]*cold taxonomy/i
    );
    expect(playbookByFocus.get("event_type")?.askSequence.join(" ")).toMatch(
      /Treat event_type as Psyche taxonomy[\s\S]*Psyche coaching playbook[\s\S]*batch CRUD/i
    );
    expect(playbookByFocus.get("event_type")?.askSequence.join(" ")).toMatch(
      /emotionally meaningful moment[\s\S]*emotional or relational stake/i
    );
    expect(playbookByFocus.get("emotion_definition")?.coachingGoal).toMatch(
      /Psyche-quality questioning[\s\S]*lived signature/i
    );
    expect(
      playbookByFocus.get("emotion_definition")?.askSequence.join(" ")
    ).toMatch(
      /Treat emotion_definition as Psyche taxonomy[\s\S]*Psyche coaching playbook[\s\S]*batch CRUD/i
    );
    expect(
      playbookByFocus.get("emotion_definition")?.askSequence.join(" ")
    ).toMatch(
      /felt signature[\s\S]*signal, protect, warn about, long for, or demand/i
    );
  });

  it("keeps specialized onboarding routes present in generated OpenAPI", async () => {
    const onboarding = await loadOnboardingPayload();
    const openapi = buildOpenApiDocument();
    const openApiPaths = new Set(Object.keys(openapi.paths ?? {}));
    const openApiMethodsByPath = new Map(
      Object.entries(openapi.paths ?? {}).map(([route, methods]) => [
        route,
        new Set(
          Object.keys(methods ?? {}).map((method) => method.toUpperCase())
        )
      ])
    );
    const openapiSchemas = (
      openapi.components as {
        schemas?: Record<string, { properties?: Record<string, any> }>;
      }
    )?.schemas;
    const routeModelSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.entityRouteModel;
    const psycheSubmoduleSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.psycheSubmoduleModel;
    const psychePlaybookSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties
        ?.psycheCoachingPlaybooks?.items;
    const entityPlaybookSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties
        ?.entityConversationPlaybooks?.items;
    const interactionGuidanceSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.interactionGuidance;
    const mutationGuidanceSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.mutationGuidance;
    const specializedSurfaceSchema =
      routeModelSchema?.properties?.specializedDomainSurfaces
        ?.additionalProperties;
    expect(openapiSchemas?.CalendarConnection?.properties?.provider).toEqual(
      expect.objectContaining({
        enum: expect.arrayContaining(["microsoft", "macos_local"])
      })
    );
    expect(openApiPaths.has("/api/v1/calendar/discovery")).toBe(true);
    expect(openApiPaths.has("/api/v1/calendar/macos-local/discovery")).toBe(
      true
    );
    expect(openApiPaths.has("/api/v1/calendar/connections/{id}")).toBe(true);
    expect(
      openApiPaths.has("/api/v1/calendar/connections/{id}/discovery")
    ).toBe(true);

    for (const [surfaceName, surface] of Object.entries(
      onboarding.entityRouteModel.specializedDomainSurfaces
    )) {
      for (const [routeKey, methodRoute] of Object.entries(
        surface.methodRoutes
      )) {
        const match = /^([A-Z]+)\s+(\/api\/v1\/.+)$/.exec(methodRoute);
        expect(
          match,
          `${surfaceName}.${routeKey} should publish "METHOD /api/v1/..." route text`
        ).toBeTruthy();
        const method = match![1];
        const route = normalizeRouteTemplate(match![2]);
        expect(
          openApiMethodsByPath.get(route)?.has(method),
          `${surfaceName}.${routeKey} should exist in OpenAPI as ${method} ${route}`
        ).toBe(true);
      }
    }

    expect(psycheSubmoduleSchema).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        required: expect.arrayContaining(["flashcard"]),
        properties: expect.objectContaining({
          flashcard: { type: "string" }
        })
      })
    );

    for (const schema of [psychePlaybookSchema, entityPlaybookSchema]) {
      expect(schema).toEqual(
        expect.objectContaining({
          additionalProperties: false,
          required: expect.arrayContaining([
            "openingQuestion",
            "routePosture",
            "apiAccessHint"
          ]),
          properties: expect.objectContaining({
            openingQuestion: { type: "string" },
            routePosture: { type: "string" },
            apiAccessHint: { type: "string" }
          })
        })
      );
    }

    expect(specializedSurfaceSchema).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        required: expect.arrayContaining([
          "classification",
          "aliases",
          "summary",
          "routeKeys",
          "methodRoutes",
          "readRoutes",
          "writeRoutes",
          "routeSelectionQuestions",
          "notes"
        ]),
        properties: expect.objectContaining({
          classification: expect.objectContaining({
            enum: ["specialized_domain_surface"]
          }),
          aliases: expect.objectContaining({
            type: "array"
          }),
          routeKeys: expect.objectContaining({
            type: "array"
          }),
          methodRoutes: expect.objectContaining({
            additionalProperties: { type: "string" }
          }),
          readRoutes: expect.objectContaining({
            additionalProperties: { type: "string" }
          }),
          writeRoutes: expect.objectContaining({
            additionalProperties: { type: "string" }
          })
        })
      })
    );
    expect(interactionGuidanceSchema).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        required: expect.arrayContaining([
          "depthCalibrationRule",
          "operationLaneRule",
          "specializedSurfaceRule",
          "reviewShortcutRule",
          "readModelWriteRule",
          "psycheHypothesisRule",
          "mixedIntentSequencingRule",
          "duplicateDisambiguationRule",
          "destructiveActionRule",
          "followUpQuestionRule",
          "antiDriftRule"
        ]),
        properties: expect.objectContaining({
          depthCalibrationRule: { type: "string" },
          operationLaneRule: { type: "string" },
          specializedSurfaceRule: { type: "string" },
          reviewShortcutRule: { type: "string" },
          readModelWriteRule: { type: "string" },
          psycheHypothesisRule: { type: "string" },
          mixedIntentSequencingRule: { type: "string" },
          duplicateDisambiguationRule: { type: "string" },
          destructiveActionRule: { type: "string" },
          followUpQuestionRule: { type: "string" },
          antiDriftRule: { type: "string" }
        })
      })
    );
    expect(mutationGuidanceSchema).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        required: expect.arrayContaining([
          "specializedRouteToolRule",
          "specializedRouteToolExample",
          "specializedRouteToolExamples"
        ]),
        properties: expect.objectContaining({
          specializedRouteToolRule: { type: "string" },
          specializedRouteToolExample: { type: "string" },
          specializedRouteToolExamples: expect.objectContaining({
            type: "object",
            additionalProperties: { type: "string" }
          })
        })
      })
    );

    for (const [routeName, route] of Object.entries(
      onboarding.entityRouteModel.batchRoutes
    )) {
      expect(
        openApiPaths.has(normalizeRouteTemplate(route)),
        `batch ${routeName} route ${route} should exist in OpenAPI`
      ).toBe(true);
    }

    for (const [surfaceName, surface] of Object.entries(
      onboarding.entityRouteModel.specializedDomainSurfaces
    )) {
      const routeEntries = [
        ...Object.entries(surface.readRoutes ?? {}),
        ...Object.entries(surface.writeRoutes ?? {})
      ];

      for (const [routeName, route] of routeEntries) {
        expect(
          openApiPaths.has(normalizeRouteTemplate(route)),
          `${surfaceName}.${routeName} should exist in OpenAPI`
        ).toBe(true);
      }
      for (const [routeName, methodRoute] of Object.entries(
        surface.methodRoutes ?? {}
      )) {
        const { method, path } = parseMethodRoute(methodRoute);
        expect(
          openApiMethodsByPath.get(path)?.has(method.toUpperCase()),
          `${surfaceName}.${routeName} should publish ${method.toUpperCase()} ${path} in OpenAPI`
        ).toBeTruthy();
      }
    }

    for (const [entityName, routeMap] of Object.entries(
      onboarding.entityRouteModel.specializedCrudEntities
    )) {
      for (const route of collectRouteStrings(routeMap)) {
        expect(
          openApiPaths.has(normalizeRouteTemplate(route)),
          `${entityName} specialized CRUD route ${route} should exist in OpenAPI`
        ).toBe(true);
      }
      const methodRoutes = routeMap.methodRoutes ?? {};
      for (const [routeName, methodRoute] of Object.entries(methodRoutes)) {
        const { method, path } = parseMethodRoute(methodRoute);
        expect(
          openApiMethodsByPath.get(path)?.has(method.toUpperCase()),
          `${entityName}.${routeName} should publish ${method.toUpperCase()} ${path} in OpenAPI`
        ).toBeTruthy();
      }
    }

    for (const [entityName, actionModel] of Object.entries(
      onboarding.entityRouteModel.actionEntities
    )) {
      for (const route of collectRouteStrings(actionModel)) {
        expect(
          openApiPaths.has(normalizeRouteTemplate(route)),
          `${entityName} action route ${route} should exist in OpenAPI`
        ).toBe(true);
      }
    }

    for (const [surfaceName, route] of Object.entries(
      onboarding.entityRouteModel.readModelOnlySurfaces
    )) {
      expect(
        openApiPaths.has(normalizeRouteTemplate(route)),
        `${surfaceName} read-model route ${route} should exist in OpenAPI`
      ).toBe(true);
    }

    for (const catalogEntry of onboarding.entityCatalog) {
      const preferredReadPaths = (catalogEntry.preferredReadPath ?? "")
        .split("|")
        .map((route) => route.trim())
        .filter((route) => route.startsWith("/api/v1/"));
      if (preferredReadPaths.length === 0) {
        continue;
      }
      for (const route of preferredReadPaths) {
        expect(
          openApiPaths.has(normalizeRouteTemplate(route)),
          `${catalogEntry.entityType} preferred read path ${route} should exist in OpenAPI`
        ).toBe(true);
      }
    }

    for (const [routeName, route] of Object.entries(
      onboarding.verificationPaths
    )) {
      expect(
        openApiPaths.has(normalizeRouteTemplate(route)),
        `verification path ${routeName} (${route}) should exist in OpenAPI`
      ).toBe(true);
    }
  });

  it("keeps the OpenClaw connection guide aligned with the repo-local install path", async () => {
    const onboarding = await loadOnboardingPayload();
    expect(onboarding.connectionGuides?.openclaw?.verifyCommands ?? []).toEqual(
      expect.arrayContaining([
        "openclaw plugins install --link --dangerously-force-unsafe-install ./projects/forge/plugins/openclaw",
        "openclaw plugins inspect forge-openclaw-plugin --runtime",
        "openclaw forge onboarding",
        "openclaw forge health"
      ])
    );
    expect(onboarding.connectionGuides?.openclaw?.configNotes ?? []).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/plugins\.load\.paths/i),
        expect.stringMatching(/operator-session/i),
        expect.stringMatching(/\/api\/v1\/settings\/tokens/i)
      ])
    );
    expect(
      (onboarding.connectionGuides?.openclaw?.installSteps ?? []).join(" ")
    ).not.toMatch(/Settings -> Agents/i);
  });
});
