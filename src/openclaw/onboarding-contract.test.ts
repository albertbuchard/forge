import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../server/src/app";

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
      askSequence: string[];
    }>;
    psycheCoachingPlaybooks: Array<{
      focus: string;
      askSequence: string[];
      notes: string[];
    }>;
    entityRouteModel: {
      batchCrudEntities: string[];
      specializedCrudEntities: Record<string, Record<string, string>>;
      actionEntities: Record<string, Record<string, unknown>>;
      specializedDomainSurfaces: Record<
        string,
        {
          readRoutes: Record<string, string>;
          writeRoutes: Record<string, string>;
          notes: string[];
        }
      >;
      readModelOnlySurfaces: Record<string, string>;
    };
    interactionGuidance: Record<string, string>;
    connectionGuides?: {
      openclaw?: {
        installSteps?: string[];
        verifyCommands?: string[];
        configNotes?: string[];
      };
    };
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
      "workout_session",
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
      expect(entityTypes.has(entityType), `${entityType} should be published`).toBe(
        true
      );
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
      "workout_session",
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
      "trigger_report"
    ] as const) {
      expect(psycheFocuses.has(focus), `${focus} psyche playbook should exist`).toBe(
        true
      );
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
        update: "/api/v1/calendar/connections/:id"
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
    expect(routeModel.actionEntities.selfObservation).toEqual(
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
        places: "/api/v1/movement/places",
        tripDetail: "/api/v1/movement/trips/:id",
        selection: "/api/v1/movement/selection"
      })
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

    expect(routeModel.specializedDomainSurfaces.lifeForce.readRoutes).toEqual(
      expect.objectContaining({
        overview: "/api/v1/life-force"
      })
    );
    expect(routeModel.specializedDomainSurfaces.lifeForce.writeRoutes).toEqual(
      expect.objectContaining({
        profile: "/api/v1/life-force/profile",
        weekdayTemplate: "/api/v1/life-force/templates/:weekday",
        fatigueSignal: "/api/v1/life-force/fatigue-signals"
      })
    );

    expect(routeModel.specializedDomainSurfaces.workbench.readRoutes).toEqual(
      expect.objectContaining({
        listFlows: "/api/v1/workbench/flows",
        flowBySlug: "/api/v1/workbench/flows/by-slug/:slug",
        publishedOutput: "/api/v1/workbench/flows/:id/output",
        latestNodeOutput: "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
      })
    );
    expect(routeModel.specializedDomainSurfaces.workbench.writeRoutes).toEqual(
      expect.objectContaining({
        createFlow: "/api/v1/workbench/flows",
        runFlow: "/api/v1/workbench/flows/:id/run",
        runByPayload: "/api/v1/workbench/run"
      })
    );

    expect(routeModel.readModelOnlySurfaces).toEqual(
      expect.objectContaining({
        sleepOverview: "/api/v1/health/sleep",
        sportsOverview: "/api/v1/health/fitness",
        selfObservation: "/api/v1/psyche/self-observation/calendar"
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
            "/api/v1/entities/create | /api/v1/entities/update | /api/v1/entities/delete | /api/v1/entities/search"
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
          "Use /api/v1/calendar/connections plus provider-specific setup flows.",
        preferredReadPath: "/api/v1/calendar/connections",
        preferredMutationTool:
          "forge_connect_calendar_provider | forge_sync_calendar_connection"
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
        classification: "read_model_only_surface",
        preferredMutationPath:
          "Read the calendar surface; mutate it by creating or updating note-backed observations with frontmatter.observedAt.",
        preferredReadPath: "/api/v1/psyche/self-observation/calendar"
      })
    );
    expect(entityByType.get("movement")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Movement route family for day, month, all-time, timeline, places, trip detail, selection aggregates, overlays, and repair actions.",
        preferredReadPath: "/api/v1/movement/timeline",
        preferredMutationTool:
          "Follow forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces for the dedicated route family."
      })
    );
    expect(entityByType.get("life_force")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Life Force route family for overview, profile edits, weekday templates, and fatigue signals.",
        preferredReadPath: "/api/v1/life-force",
        preferredMutationTool:
          "Follow forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces for the dedicated route family."
      })
    );
    expect(entityByType.get("workbench")).toEqual(
      expect.objectContaining({
        classification: "specialized_domain_surface",
        preferredMutationPath:
          "Use the dedicated Workbench route family for flow CRUD, execution, run history, published outputs, node results, and latest-node-output reads.",
        preferredReadPath: "/api/v1/workbench/flows",
        preferredMutationTool:
          "Follow forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces for the dedicated route family."
      })
    );
  });

  it("publishes high-level interaction rules for review shortcuts and write-model selection", async () => {
    const onboarding = await loadOnboardingPayload();

    expect(onboarding.interactionGuidance).toEqual(
      expect.objectContaining({
        specializedSurfaceRule: expect.stringMatching(
          /Movement, Life Force, and Workbench[\s\S]*read the relevant specialized view back[\s\S]*\/forge\/v1\/movement[\s\S]*\/forge\/v1\/life-force[\s\S]*\/forge\/v1\/workbench/i
        ),
        reviewShortcutRule: expect.stringMatching(
          /reviewing or correcting an existing record/i
        ),
        readModelWriteRule: expect.stringMatching(
          /Self-observation is note-backed[\s\S]*Sleep and workout sessions stay on batch CRUD by default/i
        )
      })
    );
  });

  it("keeps specialized and Psyche playbooks explicit about active listening and route narrowing", async () => {
    const onboarding = await loadOnboardingPayload();
    const playbookByFocus = new Map(
      onboarding.entityConversationPlaybooks.map((entry) => [entry.focus, entry])
    );
    const psycheByFocus = new Map(
      onboarding.psycheCoachingPlaybooks.map((entry) => [entry.focus, entry])
    );

    expect(playbookByFocus.get("task_run")).toEqual(
      expect.objectContaining({
        openingQuestion: "Which task should I start?"
      })
    );
    expect(
      playbookByFocus.get("task_run")?.askSequence.join(" ")
    ).toMatch(/dedicated task-run tool/i);

    expect(
      playbookByFocus.get("movement")?.askSequence.join(" ")
    ).toMatch(
      /day, month, all-time, timeline, places, trip-detail,[\s\S]*selection route/i
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
      /Mondays crash after lunch|weekday-template question/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /stable public input contract or published output/i
    );
    expect(playbookByFocus.get("workbench")?.askSequence.join(" ")).toMatch(
      /run summary, one node result, the latest node output, or the published output/i
    );

    expect(psycheByFocus.get("belief_entry")?.askSequence.join(" ")).toMatch(
      /own words|belief sentence/i
    );
    expect(psycheByFocus.get("behavior_pattern")?.notes.join(" ")).toMatch(
      /Before you ask how to change the loop, ask what it is protecting/i
    );
    expect(psycheByFocus.get("mode_guide_session")?.notes.join(" ")).toMatch(
      /exploration worksheet|interpretations tentative/i
    );
  });

  it("keeps the OpenClaw connection guide aligned with the repo-local install path", async () => {
    const onboarding = await loadOnboardingPayload();
    expect(
      onboarding.connectionGuides?.openclaw?.verifyCommands ?? []
    ).toEqual(
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
