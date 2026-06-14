import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../server/src/app";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

async function loadOnboardingPayload() {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "forge-question-flow-"));
  tempRoots.push(dataRoot);
  const app = await buildServer({ dataRoot, taskRunWatchdog: false });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agents/onboarding"
  });
  expect(response.statusCode).toBe(200);
  await app.close();
  return response.json().onboarding as {
    entityCatalog: Array<{ entityType: string }>;
    entityRouteModel: {
      specializedDomainSurfaces: Record<
        string,
        {
          routeKeys: string[];
          methodRoutes?: Record<string, string>;
          routeSelectionQuestions?: string[];
          notes?: string[];
        }
      >;
    };
  };
}

async function loadAgentContractPayloads() {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "forge-question-flow-"));
  tempRoots.push(dataRoot);
  const app = await buildServer({ dataRoot, taskRunWatchdog: false });
  const [onboardingResponse, openApiResponse] = await Promise.all([
    app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding"
    }),
    app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    })
  ]);
  expect(onboardingResponse.statusCode).toBe(200);
  expect(openApiResponse.statusCode).toBe(200);
  await app.close();
  return {
    onboarding: onboardingResponse.json().onboarding as {
      entityRouteModel: {
        specializedDomainSurfaces: Record<
          string,
          {
            routeKeys: string[];
            methodRoutes?: Record<string, string>;
          }
        >;
      };
    },
    openApi: openApiResponse.json() as {
      paths: Record<string, Record<string, unknown>>;
    }
  };
}

function normalizeOpenApiRoutePath(pathWithColonParams: string) {
  return pathWithColonParams.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseMethodRoute(route: string) {
  const match = /^([A-Z]+)\s+(\S+)$/.exec(route.trim());
  expect(match, `${route} should be METHOD /path`).toBeTruthy();
  return {
    method: match![1].toLowerCase(),
    path: normalizeOpenApiRoutePath(match![2])
  };
}

const entityPlaybook = readRepoFile(
  "skills/forge-openclaw/entity_conversation_playbooks.md"
);
const psychePlaybook = readRepoFile(
  "skills/forge-openclaw/psyche_entity_playbooks.md"
);

function getSectionSlice(document: string, section: string) {
  const headingRegex = new RegExp(`^## ${section}$`, "m");
  const headingMatch = headingRegex.exec(document);
  const heading = `## ${section}`;
  const start = headingMatch?.index ?? -1;
  expect(start, `${section} heading should exist`).toBeGreaterThanOrEqual(0);
  const nextHeadingRegex = /\n## /g;
  nextHeadingRegex.lastIndex = start + heading.length;
  const match = nextHeadingRegex.exec(document);
  const end = match ? match.index : document.length;
  return document.slice(start, end);
}

function getPreferredOpeningQuestion(sectionSlice: string) {
  const marker = "Preferred opening question:";
  const markerIndex = sectionSlice.indexOf(marker);
  expect(markerIndex, "preferred opening marker should exist").toBeGreaterThanOrEqual(
    0
  );
  const afterMarker = sectionSlice.slice(markerIndex + marker.length);
  const match = /-\s+"([^"]+)"/.exec(afterMarker);
  expect(match?.[1], "preferred opening question should be quoted").toBeTruthy();
  return match![1];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("question flow simulation cycles", () => {
  const nonPsycheSections = [
    "Goal",
    "Project",
    "Strategy",
    "Task",
    "Habit",
    "Tag",
    "Note",
    "Wiki Page",
    "Insight",
    "Calendar Event",
    "Work Block Template",
    "Task Timebox",
    "Task Run",
    "Work Adjustment",
    "Operator Overview",
    "Operator Context",
    "Self Observation",
    "Sleep Session",
    "Workout Session",
    "Sleep Overview",
    "Sports Overview",
    "Training Load",
    "Weight Loss",
    "Calendar Overview",
    "Calendar Connection",
    "Preference Judgment",
    "Preference Signal",
    "Movement",
    "Life Force",
    "Workbench",
    "Preference Catalog",
    "Preference Catalog Item",
    "Preference Context",
    "Preference Item",
    "Questionnaire Instrument",
    "Questionnaire Run"
  ] as const;

  const psycheSections = [
    "Value",
    "Behavior Pattern",
    "Behavior",
    "Belief",
    "Mode Profile",
    "Mode Guide Session",
    "Flashcard",
    "Trigger Report",
    "Event Type",
    "Emotion Definition"
  ] as const;

  const allFlowSections = [...nonPsycheSections, ...psycheSections] as const;

  const simulatedUserScenarios: Record<
    (typeof nonPsycheSections)[number] | (typeof psycheSections)[number],
    string
  > = {
    Goal: "Save a goal about rebuilding my clinical writing confidence.",
    Project: "Turn this vague thesis-support idea into a real project.",
    Strategy:
      "Create a strategy for getting from rough literature notes to a defensible chapter.",
    Task: "Add the next concrete AI-session task under that project.",
    Habit: "Track a negative habit where I avoid starting difficult writing.",
    Tag: "Create a tag for things that belong to professional identity repair.",
    Note: "Preserve this reflection without turning it into a full Psyche record yet.",
    "Wiki Page":
      "Create a durable reference page for a recurring research method.",
    Insight:
      "Save the pattern I noticed from the last three blocked work sessions.",
    "Calendar Event": "Schedule a focused review call in local time.",
    "Work Block Template":
      "Make a repeating protected writing block that blocks other work.",
    "Task Timebox": "Reserve tomorrow morning for one existing Forge task.",
    "Task Run": "Start live work on the current thesis task.",
    "Work Adjustment":
      "Add 35 minutes of real work that happened outside a live run.",
    "Operator Overview":
      "Review Forge overall to decide what needs attention first.",
    "Operator Context":
      "Inspect current work, risk, and next moves before changing anything.",
    "Self Observation": "Log what I noticed in the moment before I disengaged.",
    "Sleep Session": "Attach reflective context to last night's poor sleep.",
    "Workout Session": "Connect a hard workout to mood and recovery context.",
    "Sleep Overview":
      "Review recent nights to understand whether my recovery is actually improving.",
    "Sports Overview":
      "Review recent workouts to understand whether training load is helping or draining me.",
    "Training Load":
      "Review cardiovascular zones and acute load to decide whether to push or recover this week.",
    "Weight Loss":
      "Review the food, body, training-fuel, and gut-comfort picture before logging a meal or starting a small experiment.",
    "Calendar Overview":
      "Review this week before deciding whether to create a timebox or event.",
    "Calendar Connection":
      "Connect a calendar so Forge can read commitments and write planning blocks.",
    "Preference Judgment":
      "Record which of two writing environments I prefer for deep work.",
    "Preference Signal": "Mark this cafe as a veto for serious writing.",
    Movement: "Correct a missing movement span and then review the timeline.",
    "Life Force": "Change the model because Mondays crash after lunch.",
    Workbench:
      "Inspect a failed flow run and read the latest output for one node.",
    "Preference Catalog": "Create a comparison pool for places to work from.",
    "Preference Catalog Item":
      "Add one cafe candidate without making later comparisons ambiguous.",
    "Preference Context":
      "Define a context where preferences differ when I am tired.",
    "Preference Item":
      "Save one preference candidate and decide if it is a signal or comparison item.",
    "Questionnaire Instrument":
      "Draft a reusable questionnaire for post-session reflection.",
    "Questionnaire Run":
      "Continue an in-progress reflection run and finish the next answer.",
    Value: "Clarify why professional courage feels important right now.",
    "Behavior Pattern": "Map the loop where I freeze after critical feedback.",
    Behavior:
      "Understand the recurring move where I over-edit instead of submitting.",
    Belief:
      "Save the belief sentence that says my work will be exposed as unserious.",
    "Mode Profile":
      "Describe the part that takes over when judgment feels near.",
    "Mode Guide Session":
      "Guide a present-moment mode inquiry after a sharp shame reaction.",
    Flashcard:
      "Create or retrieve a small card for the urge sentence I feel right now.",
    "Trigger Report":
      "Capture the emotionally meaningful episode from today's meeting.",
    "Event Type":
      "Name the recurring kind of moment where feedback feels like danger.",
    "Emotion Definition":
      "Define the lived signature of dread versus ordinary anxiety."
  };

  const fullFlowCoverageByCycle: Record<
    "cycle1" | "cycle2" | "cycle3",
    readonly (typeof allFlowSections)[number][]
  > = {
    cycle1: allFlowSections,
    cycle2: allFlowSections,
    cycle3: allFlowSections
  };

  const expectedApiPosture: Record<
    (typeof nonPsycheSections)[number] | (typeof psycheSections)[number],
    | "batch"
    | "specializedCrud"
    | "action"
    | "specializedDomain"
    | "readModel"
    | "healthWorkflow"
  > = {
    Goal: "batch",
    Project: "batch",
    Strategy: "batch",
    Task: "batch",
    Habit: "batch",
    Tag: "batch",
    Note: "batch",
    "Wiki Page": "specializedCrud",
    Insight: "batch",
    "Calendar Event": "batch",
    "Work Block Template": "batch",
    "Task Timebox": "batch",
    "Task Run": "action",
    "Work Adjustment": "action",
    "Operator Overview": "readModel",
    "Operator Context": "readModel",
    "Self Observation": "action",
    "Sleep Session": "batch",
    "Workout Session": "batch",
    "Sleep Overview": "readModel",
    "Sports Overview": "readModel",
    "Training Load": "readModel",
    "Weight Loss": "healthWorkflow",
    "Calendar Overview": "readModel",
    "Calendar Connection": "specializedCrud",
    "Preference Judgment": "action",
    "Preference Signal": "action",
    Movement: "specializedDomain",
    "Life Force": "specializedDomain",
    Workbench: "specializedDomain",
    "Preference Catalog": "batch",
    "Preference Catalog Item": "batch",
    "Preference Context": "batch",
    "Preference Item": "batch",
    "Questionnaire Instrument": "batch",
    "Questionnaire Run": "action",
    Value: "batch",
    "Behavior Pattern": "batch",
    Behavior: "batch",
    Belief: "batch",
    "Mode Profile": "batch",
    "Mode Guide Session": "batch",
    Flashcard: "batch",
    "Trigger Report": "batch",
    "Event Type": "batch",
    "Emotion Definition": "batch"
  };

  const liveCatalogFlowSectionByEntityType = {
    goal: "Goal",
    project: "Project",
    strategy: "Strategy",
    task: "Task",
    habit: "Habit",
    tag: "Tag",
    note: "Note",
    insight: "Insight",
    calendar_event: "Calendar Event",
    work_block_template: "Work Block Template",
    task_timebox: "Task Timebox",
    task_run: "Task Run",
    work_adjustment: "Work Adjustment",
    self_observation: "Self Observation",
    sleep_session: "Sleep Session",
    workout_session: "Workout Session",
    sleep_overview: "Sleep Overview",
    sports_overview: "Sports Overview",
    training_load: "Training Load",
    weight_loss: "Weight Loss",
    calendar_connection: "Calendar Connection",
    wiki_page: "Wiki Page",
    preference_catalog: "Preference Catalog",
    preference_catalog_item: "Preference Catalog Item",
    preference_context: "Preference Context",
    preference_item: "Preference Item",
    preference_judgment: "Preference Judgment",
    preference_signal: "Preference Signal",
    questionnaire_instrument: "Questionnaire Instrument",
    questionnaire_run: "Questionnaire Run",
    movement: "Movement",
    life_force: "Life Force",
    workbench: "Workbench",
    psyche_value: "Value",
    behavior_pattern: "Behavior Pattern",
    behavior: "Behavior",
    belief_entry: "Belief",
    mode_profile: "Mode Profile",
    mode_guide_session: "Mode Guide Session",
    flashcard: "Flashcard",
    trigger_report: "Trigger Report",
    event_type: "Event Type",
    emotion_definition: "Emotion Definition"
  } as const;

  const requiredRouteMatrixEntityTypes = [
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
    "trigger_report",
    "event_type",
    "emotion_definition",
    "wiki_page",
    "calendar_connection",
    "operator_overview",
    "operator_context",
    "calendar_overview",
    "task_run",
    "work_adjustment",
    "preference_judgment",
    "preference_signal",
    "questionnaire_run",
    "self_observation",
    "sleep_overview",
    "sports_overview",
    "training_load",
    "weight_loss",
    "movement",
    "life_force",
    "workbench"
  ] as const;

  const specializedSurfaceRouteScenarios = {
    Movement: {
      day: "Review one day of movement before interpreting time in place.",
      month: "Review a month before answering a travel behavior question.",
      allTime: "Check all-time dominant places without creating a record.",
      timeline: "Inspect the life timeline before correcting an uncertain span.",
      places: "Review known places before linking or renaming one.",
      boxDetail: "Inspect a saved movement box before repairing it.",
      tripDetail: "Open one trip detail before editing or interpreting it.",
      selection: "Aggregate a selected time span and place set.",
      settings: "Read passive capture and publishing settings.",
      settingsUpdate: "Change passive tracking, publish mode, or retention.",
      placeCreate: "Create a known place after the label and use are clear.",
      placeUpdate: "Rename or repair one saved place.",
      userBoxPreflight: "Preflight a missing stay or trip overlay.",
      userBoxCreate: "Create a manual overlay for a missing span.",
      userBoxUpdate: "Revise one saved manual overlay.",
      userBoxDelete: "Delete one saved manual overlay.",
      automaticBoxInvalidate: "Invalidate one automatic box that is wrong.",
      stayUpdate: "Patch an already-recorded stay.",
      stayDelete: "Delete an already-recorded stay.",
      tripUpdate: "Patch an already-recorded trip.",
      tripDelete: "Delete an already-recorded trip.",
      tripPointUpdate: "Patch one trip point.",
      tripPointDelete: "Delete one trip point."
    },
    "Life Force": {
      overview: "Read the current energy picture before deciding what to change.",
      profile: "Patch durable capacity assumptions.",
      weekdayTemplate: "Change a repeated weekday curve.",
      fatigueSignal: "Log a right-now tired or recovered signal."
    },
    Workbench: {
      listFlows: "List saved flows before choosing one.",
      flowDetail: "Read one saved flow detail by id.",
      flowById: "Read one saved flow by id.",
      flowBySlug: "Read one saved flow by slug.",
      publishedOutput: "Read the public result.",
      runHistory: "Inspect run history.",
      runs: "Inspect run history.",
      runDetail: "Debug one run summary.",
      runNodes: "Inspect node results for one run.",
      nodeResult: "Read one node result from one run.",
      latestNodeOutput: "Read the latest successful output for one node.",
      boxCatalog: "Inspect available input-box contracts.",
      createFlow: "Create a saved flow with a stable input contract.",
      updateFlow: "Edit a saved flow while preserving its public contract.",
      deleteFlow: "Delete a saved flow after checking preservation needs.",
      runFlow: "Execute a known saved flow.",
      runByPayload: "Execute from a one-off input contract.",
      chatFlow: "Send a follow-up message into a saved flow chat."
    }
  } as const;

  const specializedRouteCoverageByCycle = {
    cycle1: specializedSurfaceRouteScenarios,
    cycle2: specializedSurfaceRouteScenarios,
    cycle3: specializedSurfaceRouteScenarios
  } as const;

  it("cycle 1: every entity flow starts with visible direction instead of field collection", () => {
    expect(entityPlaybook).toMatch(/direction of the intake visible/i);
    expect(entityPlaybook).toMatch(/Opening move recipes/i);
    expect(entityPlaybook).toMatch(/Strategic record:/i);
    expect(entityPlaybook).toMatch(/Reusable record:/i);
    expect(entityPlaybook).toMatch(/Operational record:/i);
    expect(entityPlaybook).toMatch(/Dedicated surface lane translation/i);
    expect(entityPlaybook).toMatch(/Mixed-intent sequencing/i);
    expect(entityPlaybook).toMatch(/Search-before-write and existing-record disambiguation/i);
    expect(entityPlaybook).toMatch(/Destructive and replacement actions/i);
    expect(entityPlaybook).toMatch(
      /route\s+choice is an internal classification step, not a user-facing menu/i
    );
    expect(entityPlaybook).toMatch(
      /trying to understand,\s*preserve,\s*decide,\s*schedule,\s*or change something/i
    );
    expect(entityPlaybook).toMatch(
      /Do not ask for separate user-story references/i
    );
    expect(getSectionSlice(entityPlaybook, "Task")).toMatch(
      /issue, one-session task, or subtask/i
    );
    expect(getSectionSlice(entityPlaybook, "Task")).toMatch(
      /project for an issue, issue for a task, or\s+parent task for a subtask/i
    );
    expect(getSectionSlice(entityPlaybook, "Task")).toMatch(/aiInstructions/);
    expect(getSectionSlice(entityPlaybook, "Project")).toMatch(/human\/bot assignees/i);
    expect(getSectionSlice(entityPlaybook, "Task")).toMatch(/human\/bot assignees/i);
    expect(getSectionSlice(entityPlaybook, "Project")).toMatch(/project PRD or brief/i);
    expect(getSectionSlice(entityPlaybook, "Project")).toMatch(
      /workflow lane[\s\S]*scheduling\s+rules|scheduling\s+rules[\s\S]*workflow lane/i
    );
    expect(entityPlaybook).toMatch(/do not widen[\s\S]*meta lane question/i);
    expect(entityPlaybook).toMatch(
      /another agent could follow[\s\S]*without guessing/i
    );
    expect(entityPlaybook).toMatch(
      /If a read changes the truth of a later write,[\s\S]*read first/i
    );
    expect(entityPlaybook).toMatch(
      /If two routes are needed,[\s\S]*keep them in order internally/i
    );
    expect(entityPlaybook).toMatch(
      /If a likely existing record appears,[\s\S]*update that record, link to it, or become a separate new record/i
    );
    expect(entityPlaybook).toMatch(
      /Confirm the exact target and the preservation need before destructive work/i
    );
    expect(entityPlaybook).toMatch(/## Minimum save-readiness checkpoint/i);
    expect(entityPlaybook).toMatch(
      /normal batch entities[\s\S]*accepted working name[\s\S]*meaningful body[\s\S]*owner scope/i
    );
    expect(entityPlaybook).toMatch(
      /Do not ask for tags, links, dates, priority,\s+assignees, or status just because those fields exist/i
    );
    expect(entityPlaybook).toMatch(
      /operational records[\s\S]*target action[\s\S]*time, object, or\s+state/i
    );
    expect(entityPlaybook).toMatch(
      /read-model and review surfaces[\s\S]*practical question[\s\S]*scope that would change the answer/i
    );
    expect(entityPlaybook).toMatch(
      /specialized Movement, Life Force, and Workbench writes[\s\S]*selected lane[\s\S]*target span\/object\/weekday\/flow\/run\/node/i
    );

    for (const section of nonPsycheSections) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to (save|act|update|start|review)/i);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Aim:/);
      expect(sectionSlice).toMatch(/Preferred opening question:/);
      expect(sectionSlice).toMatch(/Ready to save/i);
    }
  });

  it("uses explicit simulated scenarios for every required entity and surface in each cycle", () => {
    expect(Object.keys(simulatedUserScenarios).sort()).toEqual(
      [...allFlowSections].sort()
    );
    expect(Object.keys(expectedApiPosture).sort()).toEqual(
      Object.keys(simulatedUserScenarios).sort()
    );
    for (const [cycleName, coveredFlows] of Object.entries(
      fullFlowCoverageByCycle
    )) {
      expect(
        [...coveredFlows].sort(),
        `${cycleName} should explicitly retest every flow`
      ).toEqual([...allFlowSections].sort());
    }

    for (const section of nonPsycheSections) {
      expect(simulatedUserScenarios[section], `${section} scenario`).toMatch(
        /\w/
      );
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(
        sectionSlice,
        `${section} should have actionable guidance`
      ).toMatch(/Aim:|Arc:/);
    }

    for (const section of psycheSections) {
      expect(simulatedUserScenarios[section], `${section} scenario`).toMatch(
        /\w/
      );
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(
        sectionSlice,
        `${section} should have therapeutic guidance`
      ).toMatch(/Aim:|Arc:/);
    }
  });

  it("cycle 3 retest: simulated scenarios stay synchronized with live onboarding", async () => {
    const onboarding = await loadOnboardingPayload();
    const liveCatalogEntityTypes = onboarding.entityCatalog
      .map((entry) => entry.entityType)
      .sort();
    const coveredCatalogEntityTypes = Object.keys(
      liveCatalogFlowSectionByEntityType
    ).sort();

    expect(coveredCatalogEntityTypes).toEqual(liveCatalogEntityTypes);

    const routeMatrix = getSectionSlice(
      entityPlaybook,
      "Full Route Posture Matrix"
    );

    for (const [entityType, section] of Object.entries(
      liveCatalogFlowSectionByEntityType
    )) {
      expect(
        simulatedUserScenarios[
          section as keyof typeof simulatedUserScenarios
        ],
        `${entityType} should have a simulated user scenario`
      ).toBeTruthy();
      expect(
        routeMatrix,
        `${entityType} should be present in the route posture matrix`
      ).toMatch(new RegExp(`\\\`${escapeRegExp(entityType)}\\\``));
    }

    const surfaceToScenarioName = {
      movement: "Movement",
      lifeForce: "Life Force",
      life_force: "Life Force",
      workbench: "Workbench"
    } as const;

    for (const [surfaceKey, scenarioName] of Object.entries(
      surfaceToScenarioName
    )) {
      const liveRouteKeys =
        onboarding.entityRouteModel.specializedDomainSurfaces[surfaceKey]
          ?.routeKeys ?? [];
      const simulatedRouteKeys = Object.keys(
        specializedSurfaceRouteScenarios[
          scenarioName as keyof typeof specializedSurfaceRouteScenarios
        ]
      );

      expect(
        [...simulatedRouteKeys].sort(),
        `${surfaceKey} route-key scenarios should match onboarding`
      ).toEqual([...liveRouteKeys].sort());
    }
  });

  it("cycle 3 retest: live specialized-surface guidance stays specific enough to prevent route guessing", async () => {
    const onboarding = await loadOnboardingPayload();
    const movement =
      onboarding.entityRouteModel.specializedDomainSurfaces.movement;
    const lifeForce =
      onboarding.entityRouteModel.specializedDomainSurfaces.lifeForce;
    const lifeForceAlias =
      onboarding.entityRouteModel.specializedDomainSurfaces.life_force;
    const workbench =
      onboarding.entityRouteModel.specializedDomainSurfaces.workbench;

    expect(movement.routeSelectionQuestions?.join(" ")).toMatch(
      /known-place creation or cleanup[\s\S]*label[\s\S]*boundary[\s\S]*future-use/i
    );
    expect(movement.notes?.join(" ")).toMatch(
      /POST \/api\/v1\/movement\/places[\s\S]*PATCH \/api\/v1\/movement\/places\/:id[\s\S]*generic entity writes/i
    );
    expect(movement.notes?.join(" ")).toMatch(
      /After a Movement read[\s\S]*one next action[\s\S]*manual overlay[\s\S]*place boundary correction[\s\S]*settings change[\s\S]*linked note/i
    );
    for (const surface of [lifeForce, lifeForceAlias]) {
      expect(surface.routeSelectionQuestions?.join(" ")).toMatch(
        /planning decision[\s\S]*workload[\s\S]*recovery[\s\S]*timeboxes/i
      );
      expect(surface.notes?.join(" ")).toMatch(
        /only needs an explanation or planning read[\s\S]*overview first/i
      );
      expect(surface.notes?.join(" ")).toMatch(
        /After a Life Force overview[\s\S]*one planning implication[\s\S]*lighter workload[\s\S]*added recovery[\s\S]*protected timebox/i
      );
    }
    expect(workbench.routeSelectionQuestions?.join(" ")).toMatch(
      /saved flow[\s\S]*one-off input run[\s\S]*reusable/i
    );
    expect(workbench.notes?.join(" ")).toMatch(
      /one-off execution[\s\S]*do not create a saved flow unless the user wants reuse[\s\S]*POST \/api\/v1\/workbench\/run/i
    );
    expect(workbench.notes?.join(" ")).toMatch(
      /After a Workbench read[\s\S]*one next action[\s\S]*rerun with clearer input[\s\S]*inspect a specific node[\s\S]*publish or preserve the output/i
    );
  });

  it("cycle 1 retest: specialized onboarding method routes are present in OpenAPI", async () => {
    const { onboarding, openApi } = await loadAgentContractPayloads();

    for (const surfaceKey of [
      "movement",
      "lifeForce",
      "life_force",
      "workbench"
    ] as const) {
      const surface =
        onboarding.entityRouteModel.specializedDomainSurfaces[surfaceKey];
      expect(surface, `${surfaceKey} should exist`).toBeTruthy();
      expect(surface.methodRoutes, `${surfaceKey} method routes`).toBeTruthy();

      for (const routeKey of surface.routeKeys) {
        const methodRoute = surface.methodRoutes?.[routeKey];
        expect(
          methodRoute,
          `${surfaceKey}.${routeKey} should publish a method route`
        ).toBeTruthy();
        const { method, path } = parseMethodRoute(methodRoute!);
        expect(
          openApi.paths[path],
          `${surfaceKey}.${routeKey} should exist in OpenAPI at ${path}`
        ).toBeTruthy();
        expect(
          openApi.paths[path]?.[method],
          `${surfaceKey}.${routeKey} should publish ${method.toUpperCase()} ${path}`
        ).toBeTruthy();
      }
    }
  });

  it("uses explicit specialized route-lane scenarios in every cycle", () => {
    const expectedSurfaceNames = Object.keys(specializedSurfaceRouteScenarios).sort();

    for (const [cycleName, cycleSurfaces] of Object.entries(
      specializedRouteCoverageByCycle
    )) {
      expect(
        Object.keys(cycleSurfaces).sort(),
        `${cycleName} should include every specialized surface`
      ).toEqual(expectedSurfaceNames);

      for (const surfaceName of expectedSurfaceNames) {
        const expectedRouteKeys = Object.keys(
          specializedSurfaceRouteScenarios[
            surfaceName as keyof typeof specializedSurfaceRouteScenarios
          ]
        ).sort();
        const actualRouteKeys = Object.keys(
          cycleSurfaces[surfaceName as keyof typeof specializedSurfaceRouteScenarios]
        ).sort();
        expect(
          actualRouteKeys,
          `${cycleName} should cover every ${surfaceName} route lane`
        ).toEqual(expectedRouteKeys);
      }
    }

    for (const [surfaceName, routeScenarios] of Object.entries(
      specializedSurfaceRouteScenarios
    )) {
      const sectionSlice = getSectionSlice(entityPlaybook, surfaceName);
      for (const [routeKey, scenario] of Object.entries(routeScenarios)) {
        expect(scenario, `${surfaceName}.${routeKey} scenario should be plain`).not.toMatch(
          /\b(API|CRUD|endpoint|payload|mutation path)\b/i
        );
        expect(
          sectionSlice,
          `${surfaceName}.${routeKey} should be grounded in the playbook`
        ).toMatch(/Lane-to-route map:|Direct action rules:/);
      }
    }
  });

  it("cycle 1: simulated first turns stay short, specific, and user-facing for every flow", () => {
    const userFacingJargon =
      /\b(API|CRUD|endpoint|route family|payload|mutation path|read path|schema field)\b/i;
    const coldFormOpeners =
      /^(What should this be called|What fields|Which endpoint|What payload)/i;

    for (const section of nonPsycheSections) {
      const opening = getPreferredOpeningQuestion(
        getSectionSlice(entityPlaybook, section)
      );
      expect(opening, `${section} opening should be one question`).toMatch(/\?$/);
      expect(opening, `${section} opening should stay concise`).toSatisfy(
        (value: string) => value.length <= 150
      );
      expect(opening, `${section} opening should avoid API jargon`).not.toMatch(
        userFacingJargon
      );
      expect(opening, `${section} opening should not start like a form`).not.toMatch(
        coldFormOpeners
      );
    }

    for (const section of psycheSections) {
      const opening = getPreferredOpeningQuestion(
        getSectionSlice(psychePlaybook, section)
      );
      expect(opening, `${section} opening should be one grounded question`).toMatch(
        /\?$/
      );
      expect(opening, `${section} opening should stay concise`).toSatisfy(
        (value: string) => value.length <= 165
      );
      expect(opening, `${section} opening should stay close to lived experience`).toMatch(
        /^(When|What|Where|If|Can)\b/i
      );
      expect(opening, `${section} opening should not ask for diagnosis or fields`).not.toMatch(
        /diagnos|schema|field|API|CRUD|route|payload/i
      );
    }
  });

  it("cycle 1: every simulated flow has a clear API posture before questioning deepens", () => {
    expect(entityPlaybook).toMatch(/## Route posture checkpoint/i);
    expect(entityPlaybook).toMatch(/Every normal entity section below inherits that batch-route default/i);
    expect(entityPlaybook).toMatch(/specialized CRUD areas/i);
    expect(entityPlaybook).toMatch(/action workflows/i);
    expect(entityPlaybook).toMatch(/specialized domain areas/i);
    expect(psychePlaybook).toMatch(/## Psyche API Posture/i);

    for (const [section, posture] of Object.entries(expectedApiPosture)) {
      if ((psycheSections as readonly string[]).includes(section)) {
        const sectionSlice = getSectionSlice(psychePlaybook, section);
        expect(sectionSlice).toMatch(/Ready to save/i);
        expect(psychePlaybook).toMatch(/shared batch entity routes[\s\S]*psyche_value[\s\S]*emotion_definition/i);
        expect(posture, `${section} posture`).toBe("batch");
        continue;
      }

      const sectionSlice = getSectionSlice(entityPlaybook, section);
      if (posture === "specializedDomain") {
        expect(sectionSlice).toMatch(/Lane-to-route map:/);
        expect(sectionSlice).toMatch(/dedicated/i);
        continue;
      }
      if (posture === "action") {
        expect(sectionSlice).toMatch(/action workflow|dedicated|note-backed|task-run tool/i);
        continue;
      }
      if (posture === "specializedCrud") {
        expect(sectionSlice).toMatch(/specialized CRUD|wiki page|calendar connection/i);
        continue;
      }
      if (posture === "readModel") {
        expect(sectionSlice).toMatch(/read-model-only|overview route|overview read/i);
        continue;
      }
      if (posture === "healthWorkflow") {
        expect(sectionSlice).toMatch(/health read model|dedicated nutrition/i);
        expect(sectionSlice).toMatch(/forge_get_weight_loss_overview/);
        continue;
      }
      expect(posture, `${section} posture`).toBe("batch");
      expect(entityPlaybook).toMatch(/shared batch entity routes by default/i);
    }
  });

  it("cycle 1 retest: the route posture matrix explicitly covers every flow without route guessing", () => {
    const matrix = getSectionSlice(entityPlaybook, "Full Route Posture Matrix");

    expect(matrix).toMatch(/shared batch entity routes/i);
    expect(matrix).toMatch(/specialized CRUD/i);
    expect(matrix).toMatch(/action workflow/i);
    expect(matrix).toMatch(/note-backed workflow/i);
    expect(matrix).toMatch(/read-model-only health surface/i);
    expect(matrix).toMatch(/health read model plus dedicated nutrition write workflow/i);
    expect(matrix).toMatch(/specialized domain surface/i);
    expect(matrix).toMatch(/dedicated movement routes/i);
    expect(matrix).toMatch(/dedicated Life Force routes/i);
    expect(matrix).toMatch(/dedicated Workbench routes/i);
    expect(entityPlaybook).toMatch(
      /user already gave the concrete object, time window, weekday, flow, run, or\s+node/i
    );

    for (const entityType of requiredRouteMatrixEntityTypes) {
      expect(
        matrix,
        `${entityType} should be explicit in the route posture matrix`
      ).toMatch(new RegExp(`\\\`${escapeRegExp(entityType)}\\\``));
    }
  });

  it("cycle 1 retest: Psyche flows contrast nearby containers before saving", () => {
    const contrast = getSectionSlice(psychePlaybook, "Entity Contrast Check");

    expect(contrast).toMatch(/Do not ask the\s+user to choose from a taxonomy menu/i);
    expect(contrast).toMatch(
      /trigger_report[\s\S]*one charged episode[\s\S]*situation, feeling, meaning, action, and\s+consequence/i
    );
    expect(contrast).toMatch(
      /behavior_pattern[\s\S]*cue -> body\/emotion -> meaning ->\s+behavior\/urge -> payoff -> cost/i
    );
    expect(contrast).toMatch(/behavior[\s\S]*one recurring move/i);
    expect(contrast).toMatch(/belief_entry[\s\S]*sentence, rule, prediction/i);
    expect(contrast).toMatch(/mode_profile[\s\S]*recurring part-state/i);
    expect(contrast).toMatch(/mode_guide_session[\s\S]*inside the reaction/i);
    expect(contrast).toMatch(
      /event_type[\s\S]*emotion_definition[\s\S]*future trigger reports/i
    );
    expect(contrast).toMatch(
      /one careful\s+hypothesis[\s\S]*protecting[\s\S]*predicts[\s\S]*relief[\s\S]*costs/i
    );
  });

  it("cycle 1 retest: partial answers narrow the next question instead of restarting intake", () => {
    const progressiveDisclosure = getSectionSlice(
      entityPlaybook,
      "Progressive disclosure after partial answers"
    );
    const psycheProgressiveDisclosure = getSectionSlice(
      psychePlaybook,
      "Psyche progressive disclosure"
    );
    const onboardingSource = readRepoFile("server/src/app.ts");
    const openClawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const codexSkill = readRepoFile(
      "plugins/forge-codex/skills/forge-codex/SKILL.md"
    );

    expect(progressiveDisclosure).toMatch(
      /operation, entity or surface, target record,[\s\S]*time span, working wording, owner or placement, route lane, and consent/i
    );
    expect(progressiveDisclosure).toMatch(
      /first missing detail that[\s\S]*would\s+change the action:[\s\S]*duplicate disambiguation[\s\S]*hierarchy parent[\s\S]*weekday[\s\S]*flow, run, node/i
    );
    expect(progressiveDisclosure).toMatch(
      /For normal batch entities,[\s\S]*do not ask for tags, priority, status, color, links,\s+dates, or assignees unless/i
    );
    expect(progressiveDisclosure).toMatch(
      /For specialized Movement, Life Force, and Workbench work,[\s\S]*skip the route-family question[\s\S]*target span, place, weekday, profile field, flow, run, node, output, correction, or\s+consent/i
    );
    expect(psycheProgressiveDisclosure).toMatch(
      /offered belief sentence, value phrase, part voice, urge sentence, trigger\s+episode, event kind, emotion signature, or functional loop/i
    );
    expect(psycheProgressiveDisclosure).toMatch(
      /ask one accuracy or consent\s+question instead of reopening origin, evidence, or repair/i
    );

    for (const source of [
      onboardingSource,
      openClawSkill,
      hermesSkill,
      codexSkill
    ]) {
      expect(source).toMatch(/Treat partial answers as progress/i);
      expect(source).toMatch(
        /operation, entity or surface, target record or time span, working\s+wording, owner or placement, route lane, and consent/i
      );
      expect(source).toMatch(
        /duplicate disambiguation, hierarchy parent, time\s+window, weekday, flow, run, node, correction, link, or save consent/i
      );
      expect(source).toMatch(
        /optional tags, priority, status, dates, color, links, or assignees/i
      );
      expect(source).toMatch(
        /belief sentence, functional loop, part voice,\s+trigger episode, value phrase, event kind,\s+emotion signature, or flashcard message/i
      );
      expect(source).toMatch(
        /ask one accuracy or consent question instead of reopening\s+origin, evidence, or repair/i
      );
    }
  });

  it("cycle 1 retest: route planning stays internal while user-facing wording stays concrete", () => {
    const onboardingSource = readRepoFile("server/src/app.ts");
    const openClawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const codexSkill = readRepoFile(
      "plugins/forge-codex/skills/forge-codex/SKILL.md"
    );

    expect(entityPlaybook).toMatch(/## Internal action trace, external wording/);
    expect(entityPlaybook).toMatch(
      /private action trace:[\s\S]*intent,[\s\S]*entity or dedicated\s+domain lane,[\s\S]*exact read\/write\/run tool,[\s\S]*required target identifiers/i
    );
    expect(entityPlaybook).toMatch(
      /If the trace is not clear,[\s\S]*one product-language question/i
    );
    expect(entityPlaybook).toMatch(
      /Mention route keys, HTTP paths, payloads, or\s+batch routes only for implementation debugging/i
    );

    for (const source of [
      onboardingSource,
      openClawSkill,
      hermesSkill,
      codexSkill
    ]) {
      expect(source).toMatch(/Keep that route plan internal|private action trace/i);
      expect(source).toMatch(
        /intent,[\s\S]*entity or dedicated domain lane,[\s\S]*exact tool or route key|exact read\/write\/run tool/i
      );
      expect(source).toMatch(
        /span, place, weekday, flow, run, node, belief sentence, parent record,\s+or\s+save confirmation/i
      );
      expect(source).toMatch(
        /saved the belief[\s\S]*corrected the\s+missing stay[\s\S]*updated the weekday energy pattern[\s\S]*read the failed node/i
      );
    }
  });

  it("cycle 2: all flows keep a guided reflective stance, with stronger therapist-like pacing for Psyche", () => {
    expect(entityPlaybook).toMatch(/feels important to keep true/i);
    expect(entityPlaybook).toMatch(/Close cleanly/i);
    expect(entityPlaybook).toMatch(/what seems clear now is/i);
    expect(entityPlaybook).toMatch(
      /For review requests, ask what practical question they want the read to answer/i
    );
    expect(entityPlaybook).toMatch(
      /what this would help them decide later is often the clearest scope signal/i
    );
    expect(entityPlaybook).toMatch(/what workflow they are trying to unlock/i);
    expect(entityPlaybook).toMatch(
      /emotionally loaded but the record is still non-Psyche[\s\S]*lived stake once[\s\S]*operational question/i
    );
    expect(entityPlaybook).toMatch(
      /what sentence future-you would need to recover from this note later/i
    );
    expect(entityPlaybook).toMatch(
      /what belongs inside the boundary and what can stay out if the scope still[\s\S]*feels muddy/i
    );
    expect(entityPlaybook).toMatch(
      /situation -> cue -> emotion\/body -> thought\/meaning -> behavior\/urge/i
    );
    expect(entityPlaybook).toMatch(
      /Do not promote self-observation over functional analysis/i
    );
    expect(entityPlaybook).toMatch(
      /Use `wiki_page` when the user wants durable memory/i
    );
    expect(psychePlaybook).toMatch(/## Schema Theme Routing/i);
    expect(psychePlaybook).toMatch(
      /schema theme[\s\S]*belief_entry[\s\S]*behavior_pattern[\s\S]*mode_profile/i
    );
    expect(entityPlaybook).toMatch(
      /self_observation[\s\S]*note-backed|note-backed[\s\S]*self_observation/i
    );
    expect(entityPlaybook).toMatch(
      /sleep_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*sleep_session/i
    );
    expect(entityPlaybook).toMatch(
      /workout_session[\s\S]*shared batch CRUD routes|shared batch CRUD routes[\s\S]*workout_session/i
    );

    expect(psychePlaybook).toMatch(/living center of the moment/i);
    expect(psychePlaybook).toMatch(/First reflection menu/i);
    expect(psychePlaybook).toMatch(/Permission pivots/i);
    expect(psychePlaybook).toMatch(/graspable enough/i);
    expect(psychePlaybook).toMatch(/accurate enough to be held/i);
    expect(psychePlaybook).toMatch(/contain before you interpret/i);
    expect(psychePlaybook).toMatch(
      /old wording no longer holds the whole experience/i
    );
    expect(psychePlaybook).toMatch(/emotionally meaningful kind of moment/i);
    expect(psychePlaybook).toMatch(/lived signature/i);
    expect(psychePlaybook).toMatch(/Interpretive Hypotheses/i);
    expect(psychePlaybook).toMatch(/Hypothesis Wording Shape/i);
    expect(psychePlaybook).toMatch(/Hypothesis Timing Checkpoint/i);
    expect(psychePlaybook).toMatch(/Hypothesis Without Cross-Examination/i);
    expect(psychePlaybook).toMatch(/evidence in the user's own example/i);
    expect(psychePlaybook).toMatch(/function without blame/i);
    expect(psychePlaybook).toMatch(/reduce the user's burden of formulation/i);
    expect(psychePlaybook).toMatch(
      /one fit-or-correction question[\s\S]*Does that fit, or\s+is the danger\/need somewhere else/i
    );
    expect(psychePlaybook).toMatch(
      /smallest lived cue or contrast that\s+would change the formulation/i
    );
    expect(psychePlaybook).toMatch(
      /second or third deepening question[\s\S]*concrete episode, body cue, belief sentence, behavior, or\s+mode voice/i
    );
    expect(psychePlaybook).toMatch(
      /hypothesis would change the record shape, wording, links, or next action/i
    );
    expect(psychePlaybook).toMatch(
      /Do not offer a hypothesis yet[\s\S]*direct mechanical save[\s\S]*diagnosis-like label, origin story/i
    );
    expect(psychePlaybook).toMatch(
      /After the hypothesis, ask exactly one correction question/i
    );
    expect(psychePlaybook).toMatch(/Hypothesis To Record Bridge/i);
    expect(psychePlaybook).toMatch(/collaborative formulations/i);
    expect(psychePlaybook).toMatch(/protecting, predicting, relieving, or\s+costing/i);
    expect(psychePlaybook).toMatch(/Hypotheses are not decorative reassurance/i);
    expect(psychePlaybook).toMatch(
      /one concrete example is visible[\s\S]*offer one careful hypothesis[\s\S]*tests or corrects it/i
    );
    expect(psychePlaybook).toMatch(
      /Do not make the user supply every interpretation alone/i
    );
    expect(psychePlaybook).toMatch(
      /Do not keep asking broad exploratory questions after the cue, meaning, protection,[\s\S]*payoff, or cost is already visible/i
    );
    expect(psychePlaybook).toMatch(
      /active formulation[\s\S]*one hypothesis is[\s\S]*one correction\s+question/i
    );
    expect(psychePlaybook).toMatch(
      /behavior_pattern[\s\S]*belief_entry[\s\S]*mode_profile[\s\S]*mode_guide_session[\s\S]*trigger_report[\s\S]*(empathic|passive) reflection/i
    );
    expect(psychePlaybook).toMatch(
      /Once a hypothesis lands or is corrected[\s\S]*saveable Forge shape/i
    );
    expect(psychePlaybook).toMatch(
      /understanding plus an immediate support action[\s\S]*formulate the primary Psyche record first/i
    );
    expect(psychePlaybook).toMatch(
      /Do not ask for every adjacent entity at once/i
    );
    expect(psychePlaybook).toMatch(
      /similar Psyche record[\s\S]*not treat similarity as a cold duplicate\s+failure/i
    );
    expect(psychePlaybook).toMatch(
      /preserve therapeutic history[\s\S]*updated, linked as history, archived, or kept as a distinct version/i
    );
    expect(psychePlaybook).toMatch(
      /Ask one confirmation question about accuracy, not another broad exploration\s+question/i
    );
    expect(psychePlaybook).toMatch(/## Psyche save-readiness checkpoint/i);
    expect(psychePlaybook).toMatch(
      /belief_entry[\s\S]*accepted sentence or prediction/i
    );
    expect(psychePlaybook).toMatch(
      /behavior_pattern[\s\S]*concrete cue or situation[\s\S]*payoff or cost/i
    );
    expect(psychePlaybook).toMatch(
      /mode_profile[\s\S]*part's voice or posture[\s\S]*protect/i
    );
    expect(psychePlaybook).toMatch(
      /trigger_report[\s\S]*situation[\s\S]*felt stake[\s\S]*consequence/i
    );
    expect(psychePlaybook).toMatch(
      /flashcard[\s\S]*cue or urge sentence[\s\S]*brief message/i
    );
    expect(psychePlaybook).toMatch(
      /Is this true\s+enough to save as a first version/i
    );

    const reflectiveNonPsyche = [
      "Goal",
      "Habit",
      "Note",
      "Self Observation",
      "Sleep Session",
      "Workout Session",
      "Sleep Overview",
      "Sports Overview",
      "Preference Context",
      "Questionnaire Instrument"
    ] as const;

    for (const section of reflectiveNonPsyche) {
      const sectionSlice = getSectionSlice(entityPlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:|Arc:/);
    }

    for (const section of psycheSections) {
      const sectionSlice = getSectionSlice(psychePlaybook, section);
      expect(sectionSlice).toMatch(/Helpful follow-up lanes:/);
      expect(sectionSlice).toMatch(/Likely linked entities:/);
    }
  });

  it("cycle 2 retest: Psyche hypotheses are entity-specific, functional, and correctable", () => {
    const hypothesisMap = getSectionSlice(psychePlaybook, "Psyche Hypothesis Map");
    const onboardingSource = readRepoFile("server/src/app.ts");
    const openClawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const codexSkill = readRepoFile(
      "plugins/forge-codex/skills/forge-codex/SKILL.md"
    );

    for (const entityType of [
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
        hypothesisMap,
        `${entityType} should have a hypothesis shape`
      ).toMatch(new RegExp(`\\\`${escapeRegExp(entityType)}\\\``));
    }

    expect(hypothesisMap).toMatch(
      /cue[\s\S]*body\/emotion[\s\S]*short-term payoff[\s\S]*long-term cost/i
    );
    expect(hypothesisMap).toMatch(/rule, prediction, or self\/other\/world sentence/i);
    expect(hypothesisMap).toMatch(/protective job[\s\S]*feared danger[\s\S]*burden/i);
    expect(hypothesisMap).toMatch(/feeling's body signature[\s\S]*urge[\s\S]*warning/i);
    expect(hypothesisMap).toMatch(/Do not flatten schema work into a loose\s+self-observation/i);

    for (const source of [
      onboardingSource,
      openClawSkill,
      hermesSkill,
      codexSkill
    ]) {
      expect(source).toMatch(
        /Do not keep asking broad exploratory Psyche questions after the cue, meaning,[\s\S]*payoff, or cost is already visible/i
      );
      expect(source).toMatch(
        /behavior_pattern[\s\S]*belief_entry[\s\S]*mode_profile[\s\S]*mode_guide_session[\s\S]*trigger_report[\s\S]*active formulation/i
      );
      expect(source).toMatch(/reduce the formulation burden/i);
      expect(source).toMatch(/one fit-or-correction question/i);
      expect(source).toMatch(/Do not make the user prove the experience/i);
      expect(source).toMatch(
        /Do not leave the user with interpretation alone[\s\S]*primary Forge record[\s\S]*accuracy or consent\s+question/i
      );
    }
  });

  it("cycle 2 retest: specialized mutations and executions verify through dedicated reads", () => {
    const verificationLoop = getSectionSlice(
      entityPlaybook,
      "Dedicated surface verification loop"
    );
    const onboardingSource = readRepoFile("server/src/app.ts");
    const openClawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const codexSkill = readRepoFile(
      "plugins/forge-codex/skills/forge-codex/SKILL.md"
    );

    expect(verificationLoop).toMatch(
      /After Movement overlays[\s\S]*place edits[\s\S]*settings changes[\s\S]*read back the timeline, place list, settings,\s+box\s+detail, or selection view/i
    );
    expect(verificationLoop).toMatch(
      /After Life Force profile edits[\s\S]*weekday-template edits[\s\S]*fatigue signals[\s\S]*read\s+the overview back/i
    );
    expect(verificationLoop).toMatch(
      /After Workbench flow creation\/edit\/deletion[\s\S]*saved-flow execution[\s\S]*one-off\s+execution[\s\S]*read back the flow detail,\s+run\s+detail, node result, latest node output, published output, or run history/i
    );
    expect(verificationLoop).toMatch(
      /Do not perform a read-back as ceremony/i
    );

    expect(getSectionSlice(entityPlaybook, "Movement")).toMatch(
      /known-place edit[\s\S]*settings change[\s\S]*overlay deletion[\s\S]*automatic-box invalidation[\s\S]*verify through the relevant dedicated read/i
    );
    expect(getSectionSlice(entityPlaybook, "Life Force")).toMatch(
      /fatigue signal[\s\S]*profile patch[\s\S]*weekday-template edit[\s\S]*verify through the\s+Life Force overview/i
    );
    expect(getSectionSlice(entityPlaybook, "Workbench")).toMatch(
      /Workbench execution[\s\S]*flow edits[\s\S]*chat follow-ups[\s\S]*publish-related work[\s\S]*run detail[\s\S]*node result[\s\S]*latest node\s+output[\s\S]*published output/i
    );

    for (const source of [
      onboardingSource,
      openClawSkill,
      hermesSkill,
      codexSkill
    ]) {
      expect(source).toMatch(
        /correction, mutation, or\s+result-producing run[\s\S]*timeline or\s+place\/settings detail[\s\S]*Life Force overview[\s\S]*flow detail,\s+run\s+detail, node result, latest node output, published\s+output, or run history/i
      );
      expect(source).toMatch(
        /After any dedicated(?: Movement, Life Force, or Workbench)? read[\s\S]*translate the result[\s\S]*into one next action[\s\S]*Movement overlay\/place\/settings\/link[\s\S]*Workbench/i
      );
      expect(source).toMatch(
        /several (?:next )?actions[\s\S]*(?:choose|narrow)[\s\S]*most directly\s+supported[\s\S]*(?:broad menu|instead of handing)/i
      );
    }
  });

  it("cycle 2 retest: write, read, and run actions close the loop without reopening intake", () => {
    const confirmationLoop = getSectionSlice(
      entityPlaybook,
      "Write/read/run confirmation loop"
    );
    const psycheAfterSave = getSectionSlice(
      psychePlaybook,
      "Psyche after-save close"
    );
    const onboardingSource = readRepoFile("server/src/app.ts");
    const openClawSkill = readRepoFile("skills/forge-openclaw/SKILL.md");
    const hermesSkill = readRepoFile("plugins/forge-hermes/forge_hermes/skill.md");
    const codexSkill = readRepoFile(
      "plugins/forge-codex/skills/forge-codex/SKILL.md"
    );

    expect(confirmationLoop).toMatch(
      /create, update, delete, restore, run, read, or repair actions[\s\S]*close the loop/i
    );
    expect(confirmationLoop).toMatch(
      /Confirm the user-facing record, action, and result[\s\S]*not the internal route/i
    );
    expect(confirmationLoop).toMatch(
      /batch creates and updates[\s\S]*working title or accepted wording[\s\S]*container[\s\S]*owner or placement/i
    );
    expect(confirmationLoop).toMatch(
      /optional tags, priority, status, color, links, dates, or assignees[\s\S]*left\s+provisional/i
    );
    expect(confirmationLoop).toMatch(
      /task run started or\s+completed[\s\S]*work adjustment applied[\s\S]*preference judgment or signal submitted[\s\S]*questionnaire run updated or completed[\s\S]*self-observation note written/i
    );
    expect(confirmationLoop).toMatch(
      /Ask a follow-up only if it changes the next action/i
    );
    expect(psycheAfterSave).toMatch(
      /Confirm the accepted wording[\s\S]*first version, update, link, archive, or distinct version/i
    );
    expect(psycheAfterSave).toMatch(
      /Do not reopen origin, evidence, repair, or adjacent entity mapping after the save/i
    );
    expect(psycheAfterSave).toMatch(
      /one accurate sentence plus any concrete next option/i
    );
    expect(onboardingSource).toMatch(/writeConfirmationRule:/);

    for (const source of [
      onboardingSource,
      openClawSkill,
      hermesSkill,
      codexSkill
    ]) {
      expect(source).toMatch(
        /After create, update, delete, restore, run, read, or repair actions/i
      );
      expect(source).toMatch(
        /user-facing record, action, and result[\s\S]*instead of reopening\s+intake/i
      );
      expect(source).toMatch(
        /task run started or completed[\s\S]*work adjustment applied[\s\S]*preference\s+judgment or signal submitted[\s\S]*questionnaire run updated or completed/i
      );
      expect(source).toMatch(
        /Psyche saves[\s\S]*accepted wording[\s\S]*first version, update, link, archive,[\s\S]*distinct version/i
      );
    }
  });

  it("cycle 3: all flows close efficiently, preserve only helpful questions, and avoid reopening settled formulations", () => {
    expect(entityPlaybook).toMatch(/If no detail is still decision-relevant/i);
    expect(entityPlaybook).toMatch(/revise the working formulation once/i);
    expect(entityPlaybook).toMatch(
      /What feels different enough now that this record needs to change/i
    );
    expect(entityPlaybook).toMatch(
      /I can stay narrow here\. What is the one thing that no longer fits/i
    );
    expect(entityPlaybook).toMatch(
      /When the user already gave the correction in usable language,[\s\S]*what still[\s\S]*seems true,[\s\S]*one thing that no longer fits/i
    );
    expect(entityPlaybook).toMatch(
      /what this would help[\s\S]*decide later is/i
    );
    expect(entityPlaybook).toMatch(
      /meaning-bearing updates[\s\S]*feels newly true/i
    );
    expect(entityPlaybook).toMatch(/repair or revise one saved overlay/i);
    expect(entityPlaybook).toMatch(/delete one saved overlay/i);
    expect(entityPlaybook).toMatch(
      /inspect one saved movement box before repairing it/i
    );
    expect(entityPlaybook).toMatch(
      /read the timeline or saved-box[\s\S]*detail before you mutate it/i
    );
    expect(entityPlaybook).toMatch(
      /passive capture, publish mode, retention, or companion\s+readiness/i
    );
    expect(entityPlaybook).toMatch(
      /GET \/api\/v1\/movement\/settings[\s\S]*PATCH \/api\/v1\/movement\/settings/i
    );
    expect(entityPlaybook).toMatch(
      /repeatable day-shape such as "Mondays crash after lunch"/i
    );
    expect(entityPlaybook).toMatch(
      /overview route key is `overview`[\s\S]*GET \/api\/v1\/life-force[\s\S]*Do not invent `\/api\/v1\/life-force\/overview`/i
    );
    expect(entityPlaybook).toMatch(
      /public input contract or a published output/i
    );
    expect(entityPlaybook).toMatch(
      /flow catalog questions[\s\S]*GET \/api\/v1\/workbench\/flows[\s\S]*available box\s+inputs[\s\S]*GET \/api\/v1\/workbench\/catalog\/boxes/i
    );
    expect(entityPlaybook).toMatch(
      /creating or editing a flow[\s\S]*stable inputs[\s\S]*expected public output/i
    );
    expect(entityPlaybook).toMatch(/run from a one-off input contract/i);
    expect(entityPlaybook).toMatch(/structured\s+input details/i);
    expect(getSectionSlice(entityPlaybook, "Workbench")).not.toMatch(/\bpayload\b/i);
    expect(entityPlaybook).toMatch(
      /delete or archive a flow[\s\S]*future run, published output, or public contract/i
    );
    expect(entityPlaybook).toMatch(
      /send one follow-up message into a saved flow chat/i
    );
    expect(entityPlaybook).toMatch(
      /flow chat follow-ups[\s\S]*saved flow chat route[\s\S]*new flow\s+run, note, or generic entity update/i
    );
    expect(entityPlaybook).toMatch(/run[\s\S]*summary/i);
    expect(entityPlaybook).toMatch(/one node result/i);
    expect(entityPlaybook).toMatch(/latest node output/i);
    expect(entityPlaybook).toMatch(/published output/i);
    expect(entityPlaybook).toMatch(/do not ask a broad review question again/i);
    expect(entityPlaybook).toMatch(
      /After a review, overview, navigation, or specialized read returns data/i
    );
    expect(entityPlaybook).toMatch(/Review-before-write checkpoint/i);
    expect(entityPlaybook).toMatch(
      /review, guide, inspect, compare, or understand before\s+changing anything/i
    );
    expect(entityPlaybook).toMatch(
      /shared batch search or read hints[\s\S]*wiki\/calendar dedicated reads[\s\S]*read-model routes[\s\S]*Movement, Life Force, or Workbench dedicated reads/i
    );
    expect(entityPlaybook).toMatch(
      /First answer the practical question[\s\S]*Name one implication or uncertainty/i
    );
    expect(entityPlaybook).toMatch(
      /Ask a follow-up only if it changes the next action/i
    );
    expect(entityPlaybook).toMatch(
      /the span that is missing[\s\S]*weekday curve[\s\S]*failed run or node/i
    );
    expect(entityPlaybook).toMatch(
      /already gave usable wording[\s\S]*rename it for style/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane question when the user already named[\s\S]*exact correction or[\s\S]*review target/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane[\s\S]*ask only for the missing run, node, or output scope/i
    );
    expect(entityPlaybook).toMatch(
      /skip the meta lane[\s\S]*ask only for the specific weekday, profile field, or signal/i
    );
    expect(entityPlaybook).toMatch(/latest successful node output/i);
    expect(entityPlaybook).toMatch(
      /stable public input contract or published output/i
    );
    expect(entityPlaybook).toMatch(
      /user already gave the correction in usable language/i
    );
    expect(entityPlaybook).toMatch(
      /next answer would not change the entity type, route, wording, timing, or useful links/i
    );
    expect(entityPlaybook).toMatch(
      /read the overview back when the user is[\s\S]*practical impact of the change/i
    );

    expect(psychePlaybook).toMatch(/Change and save pivots/i);
    expect(psychePlaybook).toMatch(/When the user says the formulation lands/i);
    expect(psychePlaybook).toMatch(
      /When the user offers their own sentence[\s\S]*stay inside that sentence first/i
    );
    expect(psychePlaybook).toMatch(
      /what the old wording was trying to[\s\S]*hold and what the new episode or evidence changes/i
    );
    expect(psychePlaybook).toMatch(/Do not reopen the full origin story/i);
    expect(psychePlaybook).toMatch(
      /Do you want to revise the whole formulation, or only the part that now feels inaccurate/i
    );
    expect(psychePlaybook).toMatch(
      /recent charged episode[\s\S]*before you rename the durable/i
    );
    expect(psychePlaybook).toMatch(
      /If the user already gives the new sentence in usable language,[\s\S]*revise the wording[\s\S]*once and save/i
    );
    expect(psychePlaybook).toMatch(/Do not open a second broad origin story/i);
    expect(psychePlaybook).toMatch(
      /formulation already lands[\s\S]*stop asking and save/i
    );
    expect(psychePlaybook).toMatch(
      /do not ask for evidence, origin, or repair[\s\S]*all that is[\s\S]*missing/i
    );
    expect(psychePlaybook).toMatch(
      /do not switch containers unless the user wants to/i
    );
    expect(psychePlaybook).toMatch(
      /say in plain language what makes you think/i
    );
  });

  it("cycle 3: specialized route examples cover Movement, Life Force, and Workbench without guessing", () => {
    const onboardingSource = readRepoFile("server/src/app.ts");
    const typeSource = readRepoFile("src/lib/types.ts");
    const skillSource = readRepoFile("skills/forge-openclaw/SKILL.md");

    expect(onboardingSource).toMatch(/specializedRouteToolExamples:/);
    expect(onboardingSource).toMatch(/operator_context:\s*"\/api\/v1\/operator\/context"/);
    expect(onboardingSource).toMatch(/calendar_overview:\s*"\/api\/v1\/calendar\/overview"/);
    expect(onboardingSource).toMatch(/focus:\s*"operator_overview"[\s\S]*forge_get_operator_overview/i);
    expect(onboardingSource).toMatch(/focus:\s*"operator_context"[\s\S]*forge_get_operator_context/i);
    expect(onboardingSource).toMatch(/focus:\s*"calendar_overview"[\s\S]*forge_get_calendar_overview/i);
    expect(typeSource).toMatch(
      /conceptModel:[\s\S]*movement: string;[\s\S]*lifeForce: string;[\s\S]*workbench: string;[\s\S]*weightLoss: string;/
    );
    expect(typeSource).toMatch(
      /verificationPaths:[\s\S]*trainingLoad: string;[\s\S]*weightLoss: string;/
    );
    expect(typeSource).toMatch(
      /verificationPaths:[\s\S]*weightLossFoodLogs: string;[\s\S]*weightLossExperimentDetail: string;/
    );
    expect(typeSource).toMatch(
      /psycheSubmoduleModel:[\s\S]*modeGuideSession: string;[\s\S]*flashcard: string;[\s\S]*eventType: string;/i
    );
    expect(typeSource).toMatch(
      /AgentOnboardingPsychePlaybook[\s\S]*openingQuestion: string;[\s\S]*exampleQuestions: string\[\];/i
    );
    expect(typeSource).toMatch(
      /interactionGuidance:[\s\S]*psycheExplorationRule: string;[\s\S]*progressiveDisclosureRule: string;[\s\S]*writeConfirmationRule: string;[\s\S]*specializedSurfaceRule: string;/i
    );
    expect(typeSource).toMatch(
      /specializedDomainSurfaces:[\s\S]*classification: "specialized_domain_surface";[\s\S]*aliases: string\[\];[\s\S]*summary: string;[\s\S]*routeKeys: string\[\];[\s\S]*methodRoutes: Record<string, string>;[\s\S]*routeSelectionQuestions: string\[\];/i
    );
    expect(typeSource).toMatch(
      /recommendedPluginTools:[\s\S]*specializedDomainWorkflow: string\[\];/i
    );
    expect(typeSource).toMatch(
      /mutationGuidance:[\s\S]*specializedRouteToolRule: string;[\s\S]*specializedRouteToolExample: string;[\s\S]*specializedRouteToolExamples: Record<string, string>;/i
    );
    expect(onboardingSource).toMatch(
      /movementTimeline[\s\S]*"routeKey":"timeline"[\s\S]*"query"/
    );
    expect(onboardingSource).toMatch(
      /Route-selection questions are internal[\s\S]*time window, place, selected span, stay, or trip/i
    );
    expect(onboardingSource).toMatch(
      /movementAllTime[\s\S]*"routeKey":"allTime"/
    );
    expect(onboardingSource).toMatch(
      /Use allTime for whole-history aggregates[\s\S]*selection for a bounded selected-span aggregate[\s\S]*tripDetail/i
    );
    expect(onboardingSource).toMatch(
      /movementSelection[\s\S]*"routeKey":"selection"[\s\S]*"body"[\s\S]*"placeIds"/
    );
    expect(onboardingSource).not.toMatch(
      /movementSelection:\s*\n\s*'\{"routeKey":"selection","query"/
    );
    expect(onboardingSource).toMatch(
      /movementTripDetail[\s\S]*"routeKey":"tripDetail"[\s\S]*"id":"trip_123"/
    );
    expect(onboardingSource).toMatch(
      /movementSettings[\s\S]*"routeKey":"settings"/
    );
    expect(onboardingSource).toMatch(
      /movementSettingsUpdate[\s\S]*"routeKey":"settingsUpdate"[\s\S]*"publishMode":"draft_review"/
    );
    expect(onboardingSource).toMatch(
      /movementPlaceCreate[\s\S]*"routeKey":"placeCreate"[\s\S]*"label":"Home"/
    );
    expect(onboardingSource).toMatch(
      /movementPlaceUpdate[\s\S]*"routeKey":"placeUpdate"[\s\S]*"pathParams"[\s\S]*"id":"place_home"/
    );
    expect(onboardingSource).toMatch(
      /movementMissingStayPreflight[\s\S]*"routeKey":"userBoxPreflight"[\s\S]*"startedAt"[\s\S]*"placeLabel"/
    );
    expect(onboardingSource).toMatch(
      /movementUserBoxUpdate[\s\S]*"routeKey":"userBoxUpdate"[\s\S]*"pathParams"[\s\S]*"id":"box_manual_123"/
    );
    expect(onboardingSource).toMatch(
      /movementUserBoxDelete[\s\S]*"routeKey":"userBoxDelete"[\s\S]*"pathParams"[\s\S]*"id":"box_manual_123"/
    );
    expect(onboardingSource).toMatch(
      /lifeForceOverview[\s\S]*"routeKey":"overview"/
    );
    expect(onboardingSource).toMatch(
      /Route-selection questions are internal[\s\S]*current read, durable assumption, repeated weekday rhythm, or right-now state/i
    );
    expect(onboardingSource).toMatch(
      /Use routeKey overview for the current read[\s\S]*GET \/api\/v1\/life-force[\s\S]*not \/api\/v1\/life-force\/overview/i
    );
    expect(onboardingSource).toMatch(
      /Life Force overview route key maps to GET \/api\/v1\/life-force[\s\S]*do not invent \/api\/v1\/life-force\/overview/i
    );
    expect(onboardingSource).toMatch(
      /lifeForceProfile[\s\S]*"routeKey":"profile"[\s\S]*"baselineDailyAp"/
    );
    expect(onboardingSource).toMatch(
      /lifeForceWeekdayTemplate[\s\S]*"routeKey":"weekdayTemplate"[\s\S]*"pathParams"[\s\S]*"weekday"/
    );
    expect(onboardingSource).toMatch(
      /lifeForceFatigueSignal[\s\S]*"routeKey":"fatigueSignal"[\s\S]*"intensity"/
    );
    expect(onboardingSource).toMatch(
      /After one concrete example is clear and a hypothesis lands or is corrected[\s\S]*translate it into a saveable record shape/i
    );
    expect(onboardingSource).toMatch(
      /hypothesis timing checkpoint[\s\S]*second or third deepening question[\s\S]*concrete episode, body cue, belief sentence, behavior, or mode voice/i
    );
    expect(onboardingSource).toMatch(
      /hypothesis would change the record shape, wording, links, or next action/i
    );
    expect(onboardingSource).toMatch(
      /Do not hypothesize yet[\s\S]*no concrete moment is visible[\s\S]*direct mechanical save[\s\S]*flooded or unsafe[\s\S]*diagnosis-like/i
    );
    expect(onboardingSource).toMatch(
      /minimum save-readiness checkpoint[\s\S]*accepted wording[\s\S]*meaningful body[\s\S]*optional fields exist/i
    );
    expect(onboardingSource).toMatch(
      /Psyche save-readiness[\s\S]*belief sentence[\s\S]*functional loop[\s\S]*flashcard cue\/message/i
    );
    expect(onboardingSource).toMatch(
      /workbenchFlowCatalog[\s\S]*"routeKey":"listFlows"/
    );
    expect(onboardingSource).toMatch(
      /workbenchFlowDetail[\s\S]*"routeKey":"flowDetail"[\s\S]*"id":"flow_research_digest"/
    );
    expect(onboardingSource).toMatch(
      /Route-selection questions are internal[\s\S]*saved flow, its input contract, one run, one node, or the public result/i
    );
    expect(onboardingSource).toMatch(
      /Use listFlows for the saved flow catalog[\s\S]*boxCatalog for available input-box contracts/i
    );
    expect(onboardingSource).toMatch(
      /workbenchBoxCatalog[\s\S]*"routeKey":"boxCatalog"/
    );
    expect(onboardingSource).toMatch(
      /workbenchCreateFlow[\s\S]*"routeKey":"createFlow"/
    );
    expect(onboardingSource).toMatch(
      /workbenchUpdateFlow[\s\S]*"routeKey":"updateFlow"[\s\S]*"pathParams"/
    );
    expect(onboardingSource).toMatch(
      /workbenchDeleteFlow[\s\S]*"routeKey":"deleteFlow"[\s\S]*"pathParams"/
    );
    expect(onboardingSource).toMatch(
      /workbenchRunHistory[\s\S]*"routeKey":"runHistory"[\s\S]*"limit":10/
    );
    expect(onboardingSource).toMatch(
      /workbenchRunDetail[\s\S]*"routeKey":"runDetail"[\s\S]*"runId"/
    );
    expect(onboardingSource).toMatch(
      /workbenchRunNodes[\s\S]*"routeKey":"runNodes"[\s\S]*"runId"/
    );
    expect(onboardingSource).toMatch(
      /workbenchNodeResult[\s\S]*"routeKey":"nodeResult"[\s\S]*"nodeId"/
    );
    expect(onboardingSource).toMatch(
      /workbenchPublishedOutput[\s\S]*"routeKey":"publishedOutput"/
    );
    expect(onboardingSource).toMatch(
      /workbenchLatestNodeOutput[\s\S]*"routeKey":"latestNodeOutput"[\s\S]*"nodeId"/
    );
    expect(onboardingSource).toMatch(
      /workbenchRunFlow[\s\S]*"routeKey":"runFlow"[\s\S]*"pathParams"/
    );
    expect(onboardingSource).toMatch(
      /workbenchRunByPayload[\s\S]*"routeKey":"runByPayload"[\s\S]*"body"[\s\S]*"input"/
    );
    expect(onboardingSource).toMatch(
      /workbenchChatFlow[\s\S]*"routeKey":"chatFlow"[\s\S]*"message"/
    );
    expect(skillSource).toMatch(
      /Movement known-place creation[\s\S]*"routeKey":"placeCreate"/
    );
    expect(skillSource).toMatch(
      /Movement saved-overlay delete[\s\S]*"routeKey":"userBoxDelete"/
    );
    expect(skillSource).toMatch(
      /Workbench run nodes[\s\S]*"routeKey":"runNodes"/
    );
    expect(skillSource).toMatch(
      /Workbench node result[\s\S]*"routeKey":"nodeResult"/
    );
    expect(onboardingSource).toMatch(
      /saved flow chat follow-ups[\s\S]*POST \/api\/v1\/workbench\/flows\/:id\/chat[\s\S]*new run, note, or generic entity update/i
    );
  });

  it("cycle 3 report retest: durable automation report covers this full run", () => {
    const report = readRepoFile(
      "docs/internal/audits/question-flow-improvement-cycles.md"
    );
    const latestRun = getSectionSlice(report, "2026-06-14 Automation Pass");

    expect(report).toMatch(/Latest run date: 2026-06-14/);
    expect(latestRun).toMatch(/data\/forge\/forge\.sqlite/i);
    expect(latestRun).toMatch(/repo-local[\s\S]*openclaw-plugin\/dist\/openclaw\/index\.js/i);
    expect(latestRun).toMatch(/forge-openclaw-plugin 0\.3\.14/i);
    expect(latestRun).toMatch(/forge-hermes-plugin 0\.3\.14/i);
    expect(latestRun).toMatch(/43 entity catalog\s+entries/i);
    expect(latestRun).toMatch(/199 OpenAPI\s+paths/i);
    expect(latestRun).toMatch(/49\s+focused checks/i);
    expect(latestRun).toMatch(/antiDriftRule/i);
    expect(latestRun).toMatch(/depthCalibrationRule/i);
    expect(latestRun).toMatch(/psycheHypothesisRule/i);
    expect(latestRun).toMatch(/progressiveDisclosureRule/i);
    expect(latestRun).toMatch(/writeConfirmationRule/i);
    expect(latestRun).toMatch(/Internal action trace/i);
    expect(latestRun).toMatch(/Hypothesis Without Cross-Examination/i);
    expect(latestRun).toMatch(/Hypothesis To Record Bridge/i);
    expect(latestRun).toMatch(/Write\/read\/run confirmation loop/i);
    expect(latestRun).toMatch(/Psyche after-save close/i);
    expect(latestRun).toMatch(/Depth calibration/i);
    expect(latestRun).toMatch(/Psyche depth calibration/i);
    expect(latestRun).toMatch(/Dedicated surface route fallback/i);
    expect(latestRun).toMatch(/methodRoutes/i);
    expect(latestRun).toMatch(/do not fall back to generic batch CRUD/i);
    expect(latestRun).toMatch(/flowDetail[\s\S]*runHistory/i);
    expect(latestRun).toMatch(/After a Movement read/i);
    expect(latestRun).toMatch(/After a Life Force overview/i);
    expect(latestRun).toMatch(/After a Workbench read/i);
    expect(latestRun).toMatch(/Do not leave the user with interpretation alone/i);
    expect(latestRun).toMatch(/training_load[\s\S]*weight_loss/i);
    expect(latestRun).toMatch(
      /goal, project, strategy, task,\s+habit, tag, note, insight, task_run, work_adjustment/i
    );
    expect(latestRun).toMatch(
      /preference_catalog[\s\S]*preference_catalog_item[\s\S]*preference_context[\s\S]*preference_item[\s\S]*preference_judgment[\s\S]*preference_signal/i
    );
    expect(latestRun).toMatch(
      /psyche_value[\s\S]*behavior_pattern[\s\S]*behavior[\s\S]*belief_entry[\s\S]*mode_profile[\s\S]*mode_guide_session[\s\S]*flashcard[\s\S]*trigger_report[\s\S]*event_type[\s\S]*emotion_definition/i
    );
    expect(latestRun).toMatch(/training_load[\s\S]*weight_loss/i);
    expect(latestRun).toMatch(/Movement[\s\S]*Life Force[\s\S]*Workbench/i);
    expect(latestRun).toMatch(
      /Cycle 1[\s\S]*Depth calibration[\s\S]*Psyche/i
    );
    expect(latestRun).toMatch(
      /Cycle 2[\s\S]*Dedicated surface route fallback[\s\S]*methodRoutes/i
    );
    expect(latestRun).toMatch(
      /Cycle 3[\s\S]*durable\s+automation freshness[\s\S]*current onboarding\s+contract/i
    );
    expect(latestRun).toMatch(/batch-first normal entity routing/i);
    expect(latestRun).toMatch(/specialized route-key examples/i);
    expect(latestRun).toMatch(/focused retest passed/i);
    expect(latestRun).toMatch(/What happened after retesting/i);
  });
});
