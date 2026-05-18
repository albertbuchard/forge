import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../server/src/app";
import { buildOpenApiDocument } from "../../server/src/openapi";

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
    entityCatalog: Array<{
      entityType: string;
      classification: string;
      preferredMutationPath: string | null;
      preferredReadPath: string | null;
      preferredMutationTool?: string | null;
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
      askSequence: string[];
      notes: string[];
      routePosture: string;
      apiAccessHint: string;
    }>;
    entityRouteModel: {
      batchCrudEntities: string[];
      batchRoutes: Record<string, string>;
      specializedCrudEntities: Record<string, Record<string, string>>;
      actionEntities: Record<string, Record<string, unknown>>;
      specializedDomainSurfaces: Record<
        string,
        {
          classification?: string;
          aliases?: string[];
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
    mutationGuidance: Record<
      string,
      string | Record<string, string> | boolean
    >;
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
        "questionnaire_instrument"
      ])
    );

    expect(routeModel.specializedCrudEntities.wiki_page).toEqual(
      expect.objectContaining({
        create: "/api/v1/wiki/pages",
        update: "/api/v1/wiki/pages/:id",
        read: "/api/v1/wiki/pages/:id"
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
        delete: "/api/v1/calendar/connections/:id"
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
        tripPointDelete:
          "DELETE /api/v1/movement/trips/:id/points/:pointId"
      })
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
        aliases: expect.arrayContaining(["lifeForce", "life-force", "Life Force"]),
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
        })
      })
    );

    expect(routeModel.specializedDomainSurfaces.workbench.readRoutes).toEqual(
      expect.objectContaining({
        boxCatalog: "/api/v1/workbench/catalog/boxes",
        listFlows: "/api/v1/workbench/flows",
        flowBySlug: "/api/v1/workbench/flows/by-slug/:slug",
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
        updateFlow: "PATCH /api/v1/workbench/flows/:id",
        deleteFlow: "DELETE /api/v1/workbench/flows/:id",
        runFlow: "POST /api/v1/workbench/flows/:id/run",
        chatFlow: "POST /api/v1/workbench/flows/:id/chat",
        nodeResult:
          "GET /api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
        latestNodeOutput:
          "GET /api/v1/workbench/flows/:id/nodes/:nodeId/output"
      })
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
        selfObservation: "/api/v1/psyche/self-observation/calendar",
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
        specializedSurfaceRule: expect.stringMatching(
          /Movement, Life Force, and Workbench[\s\S]*forge_call_movement_route[\s\S]*forge_call_life_force_route[\s\S]*forge_call_workbench_route[\s\S]*read the relevant view back[\s\S]*\/forge\/v1\/movement[\s\S]*\/forge\/v1\/life-force[\s\S]*\/forge\/v1\/workbench/i
        ),
        reviewShortcutRule: expect.stringMatching(
          /reviewing or correcting an existing record/i
        ),
        readModelWriteRule: expect.stringMatching(
          /Self-observation is note-backed[\s\S]*Sleep and workout sessions stay on batch CRUD by default/i
        )
      })
    );
    expect(onboarding.recommendedPluginTools?.specializedDomainWorkflow).toEqual(
      [
        "forge_call_movement_route",
        "forge_call_life_force_route",
        "forge_call_workbench_route"
      ]
    );
    expect(onboarding.mutationGuidance.specializedRouteToolRule).toMatch(
      /forge_call_movement_route[\s\S]*forge_call_life_force_route[\s\S]*forge_call_workbench_route[\s\S]*routeKey[\s\S]*pathParams[\s\S]*query[\s\S]*body[\s\S]*batch entity tools/i
    );
    expect(onboarding.mutationGuidance.specializedRouteToolRule).toMatch(
      /Life Force overview route key maps to GET \/api\/v1\/life-force[\s\S]*do not invent \/api\/v1\/life-force\/overview/i
    );
    expect(onboarding.mutationGuidance.specializedRouteToolExample).toMatch(
      /weekdayTemplate[\s\S]*monday/i
    );
    expect(onboarding.mutationGuidance.specializedRouteToolExamples).toEqual(
      expect.objectContaining({
        movementAllTime: expect.stringMatching(/routeKey[\s\S]*allTime/),
        movementTimeline: expect.stringMatching(/routeKey[\s\S]*timeline/),
        movementSelection: expect.stringMatching(/routeKey[\s\S]*selection/),
        movementTripDetail: expect.stringMatching(/routeKey[\s\S]*tripDetail/),
        movementSettings: expect.stringMatching(/routeKey[\s\S]*settings/),
        movementSettingsUpdate: expect.stringMatching(
          /routeKey[\s\S]*settingsUpdate[\s\S]*publishMode/
        ),
        movementMissingStayPreflight: expect.stringMatching(
          /routeKey[\s\S]*userBoxPreflight[\s\S]*startedAt[\s\S]*placeLabel/
        ),
        lifeForceOverview: expect.stringMatching(
          /routeKey[\s\S]*overview/
        ),
        lifeForceProfile: expect.stringMatching(
          /routeKey[\s\S]*profile[\s\S]*baselineDailyAp/
        ),
        lifeForceWeekdayTemplate: expect.stringMatching(
          /routeKey[\s\S]*weekdayTemplate[\s\S]*pathParams[\s\S]*weekday/
        ),
        lifeForceFatigueSignal: expect.stringMatching(
          /routeKey[\s\S]*fatigueSignal[\s\S]*intensity/
        ),
        workbenchFlowCatalog: expect.stringMatching(
          /routeKey[\s\S]*listFlows/
        ),
        workbenchBoxCatalog: expect.stringMatching(
          /routeKey[\s\S]*boxCatalog/
        ),
        workbenchCreateFlow: expect.stringMatching(
          /routeKey[\s\S]*createFlow[\s\S]*stable published summary/
        ),
        workbenchUpdateFlow: expect.stringMatching(
          /routeKey[\s\S]*updateFlow[\s\S]*pathParams/
        ),
        workbenchDeleteFlow: expect.stringMatching(
          /routeKey[\s\S]*deleteFlow[\s\S]*pathParams/
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
        workbenchChatFlow: expect.stringMatching(
          /routeKey[\s\S]*chatFlow[\s\S]*message/
        )
      })
    );
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
    const modeProfilePlaybook = psycheByFocus.get("mode_profile");
    expect(modeProfilePlaybook).toBeDefined();
    const modeProfileSequence = modeProfilePlaybook?.askSequence.join(" ") ?? "";
    expect(modeProfileSequence).toMatch(
      /protective job before choosing a family label/i
    );
    expect(
      modeProfileSequence.indexOf("Clarify its fear, burden, and protective job"),
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
    expect(playbookByFocus.get("self_observation")?.askSequence.join(" ")).toMatch(
      /situation[\s\S]*cue[\s\S]*emotion[\s\S]*thought[\s\S]*behavior[\s\S]*consequence/i
    );
    expect(playbookByFocus.get("self_observation")?.askSequence.join(" ")).toMatch(
      /Do not promote self-observation over functional analysis/i
    );

    expect(playbookByFocus.get("preference_item")?.askSequence.join(" ")).toMatch(
      /batch CRUD[\s\S]*preference judgment or signal route/i
    );
    expect(
      playbookByFocus.get("preference_judgment")?.askSequence.join(" ")
    ).toMatch(/dedicated preference judgment action route[\s\S]*instead of batch CRUD/i);
    expect(
      playbookByFocus.get("preference_signal")?.askSequence.join(" ")
    ).toMatch(/dedicated preference signal action route[\s\S]*instead of batch CRUD/i);
    expect(
      playbookByFocus.get("questionnaire_instrument")?.askSequence.join(" ")
    ).toMatch(/batch CRUD[\s\S]*clone, draft, and publish actions/i);
    expect(
      playbookByFocus.get("questionnaire_run")?.askSequence.join(" ")
    ).toMatch(/dedicated questionnaire run start, read, update, and complete routes/i);

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
    expect(psycheByFocus.get("trigger_report")?.askSequence.join(" ")).toMatch(
      /felt stake[\s\S]*situation, emotion, meaning, behavior, and consequence/i
    );
    expect(psycheByFocus.get("trigger_report")?.notes.join(" ")).toMatch(
      /worksheet dump[\s\S]*felt stake/i
    );
    expect(psycheByFocus.get("event_type")?.askSequence.join(" ")).toMatch(
      /repeated emotional or relational stake/i
    );
    expect(
      psycheByFocus.get("emotion_definition")?.askSequence.join(" ")
    ).toMatch(/felt signature/i);

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
    ).toMatch(/felt signature[\s\S]*signal, protect, warn about, long for, or demand/i);
  });

  it("keeps specialized onboarding routes present in generated OpenAPI", async () => {
    const onboarding = await loadOnboardingPayload();
    const openapi = buildOpenApiDocument();
    const openApiPaths = new Set(Object.keys(openapi.paths ?? {}));
    const openapiSchemas = (
      openapi.components as {
        schemas?: Record<string, { properties?: Record<string, any> }>;
      }
    )?.schemas;
    const routeModelSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.entityRouteModel;
    const psychePlaybookSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties?.psycheCoachingPlaybooks
        ?.items;
    const entityPlaybookSchema =
      openapiSchemas?.AgentOnboardingPayload?.properties
        ?.entityConversationPlaybooks?.items;
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

    for (const schema of [psychePlaybookSchema, entityPlaybookSchema]) {
      expect(schema).toEqual(
        expect.objectContaining({
          additionalProperties: false,
          required: expect.arrayContaining(["routePosture", "apiAccessHint"]),
          properties: expect.objectContaining({
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
  });

  it("keeps the OpenClaw connection guide aligned with the repo-local install path", async () => {
    const onboarding = await loadOnboardingPayload();
    expect(onboarding.connectionGuides?.openclaw?.verifyCommands ?? []).toEqual(
      expect.arrayContaining([
        "openclaw plugins install ./projects/forge/openclaw-plugin",
        "openclaw plugins info forge-openclaw-plugin",
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
