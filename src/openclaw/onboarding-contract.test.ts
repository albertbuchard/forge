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
    entityCatalog: Array<{ entityType: string; classification: string }>;
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
        verifyCommands?: string[];
      };
    };
  };
}

describe("forge onboarding contract", () => {
  it("publishes the full entity catalog needed by question flows", async () => {
    const onboarding = await loadOnboardingPayload();
    const entityTypes = new Set(
      onboarding.entityCatalog.map((entry) => entry.entityType)
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
        places: "/api/v1/movement/places",
        tripDetail: "/api/v1/movement/trips/:id",
        selection: "/api/v1/movement/selection"
      })
    );
    expect(routeModel.specializedDomainSurfaces.movement.writeRoutes).toEqual(
      expect.objectContaining({
        userBoxPreflight: "/api/v1/movement/user-boxes/preflight",
        userBoxCreate: "/api/v1/movement/user-boxes",
        automaticBoxInvalidate:
          "/api/v1/movement/automatic-boxes/:id/invalidate"
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

  it("publishes high-level interaction rules for review shortcuts and write-model selection", async () => {
    const onboarding = await loadOnboardingPayload();

    expect(onboarding.interactionGuidance).toEqual(
      expect.objectContaining({
        specializedSurfaceRule: expect.stringMatching(
          /Movement, Life Force, and Workbench[\s\S]*\/forge\/v1\/movement[\s\S]*\/forge\/v1\/life-force[\s\S]*\/forge\/v1\/workbench/i
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

  it("keeps the OpenClaw connection guide aligned with the repo-local install path", async () => {
    const onboarding = await loadOnboardingPayload();
    expect(
      onboarding.connectionGuides?.openclaw?.verifyCommands ?? []
    ).toEqual(
      expect.arrayContaining([
        "openclaw plugins install ./projects/forge/openclaw-plugin"
      ])
    );
  });
});
