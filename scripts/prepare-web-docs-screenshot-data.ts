import os from "node:os";
import path from "node:path";
import process from "node:process";
import { closeDatabase, configureDatabase, getDatabase, initializeDatabase } from "../server/src/db.js";
import { seedDemoDataIntoRuntime } from "../server/src/demo-data.js";
import { createSleepSession, createWorkoutSession } from "../server/src/health.js";
import {
  createNutritionAppearanceCheckin,
  createNutritionBodyCheckin,
  createNutritionExperiment,
  createNutritionFoodLog,
  createNutritionGutCheckin,
  createNutritionSubjectiveCheckin,
  updateNutritionDailyActiveCalories,
  updateNutritionTarget
} from "../server/src/health-weight-loss.js";
import { createMovementUserBox } from "../server/src/movement.js";
import { updateSettings } from "../server/src/repositories/settings.js";
import { createEntities } from "../server/src/services/entity-crud.js";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const monorepoDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");
const sharedUserDataRoot = path.join(os.homedir(), ".forge");
const requestedDataRoot = process.argv[2] ?? process.env.FORGE_DATA_ROOT;

type CreateInput = Parameters<typeof createEntities>[0];
type EntityType = CreateInput["operations"][number]["entityType"];

const context = {
  source: "system" as const,
  actor: "Forge docs screenshot fixture"
};

function isSameOrInside(candidate: string, parent: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeDataRoot(dataRoot: string) {
  if (!dataRoot.trim()) {
    throw new Error("Provide a fresh temporary FORGE_DATA_ROOT or data-root argument.");
  }

  const resolved = path.resolve(dataRoot);
  const forbiddenRoots = [projectRoot, monorepoDataRoot, sharedUserDataRoot];
  const forbidden = forbiddenRoots.find((root) => isSameOrInside(resolved, root));
  if (forbidden) {
    throw new Error(`Refusing to prepare docs screenshot data inside protected root: ${forbidden}`);
  }

  const allowedRoots = [os.tmpdir(), "/tmp", "/private/tmp"].map((root) => path.resolve(root));
  const insideTempRoot = allowedRoots.some((root) => isSameOrInside(resolved, root));
  if (!insideTempRoot && process.env.ALLOW_FORGE_DOCS_SCREENSHOT_DATA_OUTSIDE_TMP !== "1") {
    throw new Error(
      "Docs screenshot data must live under a temporary directory by default. " +
        "Set ALLOW_FORGE_DOCS_SCREENSHOT_DATA_OUTSIDE_TMP=1 only for an intentionally disposable path."
    );
  }

  return resolved;
}

function isoAtOffset(dayOffset: number, hour: number, minute = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dayKey(dayOffset = 0) {
  return isoAtOffset(dayOffset, 12).slice(0, 10);
}

function createOne(entityType: EntityType, data: Record<string, unknown>, clientRef: string) {
  const result = createEntities({
    atomic: true,
    operations: [
      {
        entityType,
        clientRef,
        data
      }
    ]
  }, context).results[0];
  if (!result?.ok || !result.entity) {
    throw new Error(`${clientRef} failed: ${JSON.stringify(result?.error ?? result)}`);
  }
  return result.entity as Record<string, unknown>;
}

function requireId(entity: Record<string, unknown>, label: string) {
  if (typeof entity.id !== "string" || entity.id.length === 0) {
    throw new Error(`${label} did not return an id.`);
  }
  return entity.id;
}

function rewriteCoreDemoRows() {
  const database = getDatabase();
  const now = new Date().toISOString();

  const updateGoal = database.prepare(
    "UPDATE goals SET title = ?, description = ?, theme_color = ?, updated_at = ? WHERE id = ?"
  );
  updateGoal.run(
    "Build a calm command center",
    "Make planning, reflection, health, and execution visible without turning the day into admin.",
    "#2563eb",
    now,
    "goal_build_forge"
  );
  updateGoal.run(
    "Protect deliberate recovery",
    "Keep training, sleep, movement, and food choices connected to sustainable energy.",
    "#0f8b6d",
    now,
    "goal_train_body"
  );
  updateGoal.run(
    "Practice steadier decisions",
    "Turn emotional signal into clear next steps instead of urgency spirals.",
    "#c2418c",
    now,
    "goal_be_a_good_person"
  );

  const updateProject = database.prepare(
    "UPDATE projects SET title = ?, description = ?, theme_color = ?, updated_at = ? WHERE id = ?"
  );
  updateProject.run(
    "Launch the weekly operating cockpit",
    "Unify overview, board, graph, and agent handoff so the week has one reliable control room.",
    "#5b7cfa",
    now,
    "project_forge_mobile"
  );
  updateProject.run(
    "Design the recovery rhythm",
    "Use sleep, movement, nutrition, and fatigue signals to keep work output sustainable.",
    "#14a085",
    now,
    "project_strength_cycle"
  );
  updateProject.run(
    "Review the decision loop",
    "Name the cue, the protective move, the cost, and the better response before shipping high-stakes work.",
    "#db2777",
    now,
    "project_relationships_ritual"
  );

  const updateTask = database.prepare(
    "UPDATE tasks SET title = ?, description = ?, owner = ?, due_date = ?, updated_at = ? WHERE id = ?"
  );
  updateTask.run(
    "Tune the overview cockpit copy",
    "Make the first screen explain active work, recent evidence, and health signals at a glance.",
    "Mira Vale",
    dayKey(1),
    now,
    "task_flagship_review"
  );
  updateTask.run(
    "Map the agent handoff contract",
    "Keep batch entity writes and specialized Movement, Life Force, and Workbench routes obvious in docs.",
    "Mira Vale",
    dayKey(0),
    now,
    "task_plugin_surface"
  );
  updateTask.run(
    "Prepare the Friday review ritual",
    "Check what moved, what resisted, and what needs a smaller next step.",
    "Mira Vale",
    dayKey(3),
    now,
    "task_weekly_review"
  );
  updateTask.run(
    "Resolve the nutrition target note",
    "Compare target calories against training load and recent energy before changing the plan.",
    "Mira Vale",
    dayKey(-1),
    now,
    "task_strength_session"
  );
  updateTask.run(
    "Take the recovery walk",
    "Short outdoor reset after the planning block.",
    "Mira Vale",
    dayKey(-2),
    now,
    "task_recovery_walk"
  );
}

function createPlanningAndKnowledgeData() {
  const habit = createOne(
    "habit",
    {
      title: "Evening shutdown note",
      description: "Close the laptop by naming what is done, what is next, and what can wait.",
      frequency: "daily",
      targetCount: 1,
      linkedGoalIds: ["goal_build_forge"],
      rewardXp: 18,
      penaltyXp: 6
    },
    "habit_shutdown_note"
  );
  const habitId = requireId(habit, "habit_shutdown_note");

  createOne(
    "calendar_event",
    {
      title: "North Star review",
      description: "Inspect the product cockpit, docs screenshots, and next operating decision.",
      location: "North Pier Studio",
      startAt: isoAtOffset(0, 9, 30),
      endAt: isoAtOffset(0, 10, 30),
      timezone: "UTC",
      eventType: "review",
      categories: ["strategy", "docs"],
      links: [{ entityType: "project", entityId: "project_forge_mobile", relationshipType: "reviews" }]
    },
    "calendar_north_star_review"
  );

  createOne(
    "task_timebox",
    {
      taskId: "task_plugin_surface",
      projectId: "project_forge_mobile",
      title: "Agent contract documentation block",
      startsAt: isoAtOffset(0, 11),
      endsAt: isoAtOffset(0, 12, 30),
      status: "planned"
    },
    "timebox_agent_contract"
  );

  createOne(
    "note",
    {
      kind: "wiki",
      title: "Decision log: calmer weekly cockpit",
      slug: "decision-log-calmer-weekly-cockpit",
      summary: "Why the weekly cockpit favors clear state, fewer jumps, and grounded agent handoffs.",
      contentMarkdown:
        "# Decision log: calmer weekly cockpit\n\nForge should show the current work, the reason it matters, the next smallest action, and the state of recovery in one place.\n\n## What changed\n\n- Overview leads with active work and evidence.\n- Psyche notes stay linked to decisions instead of floating away.\n- Movement, sleep, and nutrition remain inspectable before agents write anything.\n",
      tags: ["docs-demo", "decision-log", "weekly-review"],
      links: [
        { entityType: "project", entityId: "project_forge_mobile" },
        { entityType: "habit", entityId: habitId }
      ]
    },
    "wiki_calmer_weekly_cockpit"
  );
}

function createPreferenceData() {
  createOne(
    "preference_context",
    {
      userId: "user_operator",
      domain: "projects",
      name: "Strategic project reads",
      description:
        "A fictional preference slice for comparing project surfaces by calmness, rigor, and decision support.",
      shareMode: "blended",
      active: true,
      isDefault: true,
      decayDays: 90
    },
    "preference_context_project_reads"
  );

  createOne(
    "preference_item",
    {
      userId: "user_operator",
      domain: "projects",
      label: "Quiet cockpit dashboard",
      description: "Dense, readable overview with state, evidence, and next action in one place.",
      tags: ["dashboard", "calm", "execution"],
      queueForCompare: true,
      featureWeights: {
        novelty: 0.15,
        simplicity: 0.45,
        rigor: 0.75,
        aesthetics: 0.35,
        depth: 0.62,
        structure: 0.9,
        familiarity: 0.25,
        surprise: -0.1
      },
      metadata: { fixture: "docs" }
    },
    "preference_item_quiet_cockpit"
  );
  createOne(
    "preference_item",
    {
      userId: "user_operator",
      domain: "projects",
      label: "Therapist-grade reflection flow",
      description: "Guided questions that help name the cue, belief, protective move, and better pivot.",
      tags: ["psyche", "reflection", "questions"],
      queueForCompare: true,
      featureWeights: {
        novelty: 0.3,
        simplicity: 0.12,
        rigor: 0.86,
        aesthetics: 0.22,
        depth: 0.94,
        structure: 0.78,
        familiarity: -0.05,
        surprise: 0.24
      },
      metadata: { fixture: "docs" }
    },
    "preference_item_reflection_flow"
  );
  createOne(
    "preference_item",
    {
      userId: "user_operator",
      domain: "projects",
      label: "Exploratory neon lab",
      description: "High-energy concept board that is visually loud and less useful for weekly review.",
      tags: ["visual", "concept", "noisy"],
      queueForCompare: true,
      featureWeights: {
        novelty: 0.82,
        simplicity: -0.34,
        rigor: -0.12,
        aesthetics: 0.58,
        depth: 0.08,
        structure: -0.28,
        familiarity: -0.2,
        surprise: 0.75
      },
      metadata: { fixture: "docs" }
    },
    "preference_item_neon_lab"
  );
  createOne(
    "preference_item",
    {
      userId: "user_operator",
      domain: "projects",
      label: "Plain task ledger",
      description: "Very direct task list with little interpretation or cross-surface context.",
      tags: ["tasks", "minimal", "ledger"],
      queueForCompare: true,
      featureWeights: {
        novelty: -0.45,
        simplicity: 0.82,
        rigor: 0.18,
        aesthetics: -0.08,
        depth: -0.22,
        structure: 0.45,
        familiarity: 0.68,
        surprise: -0.64
      },
      metadata: { fixture: "docs" }
    },
    "preference_item_plain_ledger"
  );
}

function createPsycheData() {
  const value = createOne(
    "psyche_value",
    {
      title: "Steady courage",
      description: "Making the honest next move without turning pressure into panic.",
      valuedDirection: "Choose visible, reversible next steps when the work feels loaded.",
      whyItMatters: "It keeps high-stakes work connected to agency instead of urgency.",
      linkedGoalIds: ["goal_be_a_good_person", "goal_build_forge"],
      committedActions: ["Name the decision before optimizing", "Ask what would make this 10% more workable"]
    },
    "psyche_value_steady_courage"
  );
  const valueId = requireId(value, "psyche_value_steady_courage");

  const mode = createOne(
    "mode_profile",
    {
      family: "coping",
      archetype: "Deadline Scout",
      title: "The Deadline Scout",
      persona: "Fast, vigilant, and convinced that relaxing will make the plan collapse.",
      imagery: "A bright map table with every route circled twice.",
      symbolicForm: "Compass and stopwatch",
      facialExpression: "Alert, narrowed eyes",
      fear: "If speed drops, disappointment will arrive before the work is ready.",
      burden: "Carries every possible deadline as if each one is immediate.",
      protectiveJob: "Pushes for constant scanning, checking, and pre-emptive fixes.",
      originContext: "Appears when an ambiguous review could expose a missed detail.",
      linkedValueIds: [valueId]
    },
    "mode_deadline_scout"
  );
  const modeId = requireId(mode, "mode_deadline_scout");

  const belief = createOne(
    "belief_entry",
    {
      statement: "If I slow down, the whole plan will collapse.",
      beliefType: "conditional",
      originNote: "Shows up most strongly before public review or handoff.",
      confidence: 72,
      evidenceFor: ["Past launches did need fast rescue work."],
      evidenceAgainst: ["The best fixes came after naming the real decision, not after more checking."],
      flexibleAlternative: "Slowing down enough to name the decision protects the plan.",
      linkedValueIds: [valueId],
      linkedModeIds: [modeId]
    },
    "belief_slow_plan_collapse"
  );
  const beliefId = requireId(belief, "belief_slow_plan_collapse");

  const behavior = createOne(
    "behavior",
    {
      kind: "away",
      title: "Refresh the dashboard instead of naming the decision",
      description: "A repeated move where more status checking substitutes for a choice.",
      commonCues: ["Open-ended review", "Ambiguous stakeholder feedback", "Late-day fatigue"],
      urgeStory: "One more pass will make the answer undeniable.",
      shortTermPayoff: "Feels safer and buys time.",
      longTermCost: "The decision remains unnamed and the workday stretches.",
      replacementMove: "Write the decision sentence, then choose one reversible next action.",
      repairPlan: "If the loop starts, open the shutdown note and answer the first question only.",
      linkedValueIds: [valueId],
      linkedModeIds: [modeId]
    },
    "behavior_dashboard_refresh_loop"
  );
  const behaviorId = requireId(behavior, "behavior_dashboard_refresh_loop");

  const pattern = createOne(
    "behavior_pattern",
    {
      title: "Avoiding the irreversible next step",
      description: "A functional loop where scanning produces relief but delays commitment.",
      targetBehavior: "Repeatedly checking dashboards, docs, or route lists after the decision is already clear.",
      cueContexts: ["Before reviews", "When a screenshot looks imperfect", "When API route language feels ambiguous"],
      shortTermPayoff: "Avoids the vulnerability of choosing.",
      longTermCost: "Burns focus and makes the decision feel larger than it is.",
      preferredResponse: "Name the choice, ask what evidence would change it, then ship the smallest reviewed version.",
      linkedValueIds: [valueId],
      linkedModeIds: [modeId],
      linkedBeliefIds: [beliefId]
    },
    "pattern_irreversible_step"
  );
  const patternId = requireId(pattern, "pattern_irreversible_step");

  createOne(
    "trigger_report",
    {
      title: "Route review triggered urgency spike",
      status: "reviewed",
      customEventType: "API contract review",
      eventSituation: "Preparing public docs made route ambiguity feel like a personal failure instead of a normal review finding.",
      occurredAt: isoAtOffset(-1, 16, 20),
      emotions: [
        { label: "urgency", intensity: 78, note: "Wanted to fix every surface at once." },
        { label: "protectiveness", intensity: 64, note: "Wanted the system to be trustworthy." }
      ],
      thoughts: [
        { text: "If this is unclear, the whole integration looks careless.", parentMode: "Deadline Scout", beliefId }
      ],
      behaviors: [
        { text: "Kept re-reading route lists instead of drafting the docs sentence.", mode: "Deadline Scout", behaviorId }
      ],
      consequences: {
        selfShortTerm: ["Felt temporarily more in control"],
        selfLongTerm: ["Delayed the actual docs improvement"],
        othersShortTerm: ["No one saw the uncertainty"],
        othersLongTerm: ["Future agent readers would still have to infer too much"]
      },
      linkedPatternIds: [patternId],
      linkedValueIds: [valueId],
      linkedGoalIds: ["goal_build_forge"],
      linkedBehaviorIds: [behaviorId],
      linkedBeliefIds: [beliefId],
      linkedModeIds: [modeId],
      nextMoves: ["Write the route distinction in user-facing language", "Verify it with one live read before mutation"]
    },
    "trigger_report_route_urgency"
  );

  createOne(
    "flashcard",
    {
      title: "Name the decision",
      message: "The next honest sentence is more useful than another hidden scan.",
      triggerSentence: "I need one more pass before I can decide.",
      triggerSituation: "Late-stage review or docs polish",
      tags: ["decision", "review", "steady-courage"],
      backgroundColor: "#f7f9fd",
      textColor: "#172033",
      accentColor: "#2563eb",
      typography: "sans",
      visualStyle: "calm",
      linkedValueIds: [valueId],
      linkedBehaviorIds: [behaviorId],
      linkedPatternIds: [patternId],
      linkedBeliefIds: [beliefId],
      linkedModeIds: [modeId]
    },
    "flashcard_name_decision"
  );
}

function createHealthMovementAndNutritionData() {
  createSleepSession(
    {
      externalUid: "docs_sleep_recovery_night",
      source: "manual",
      sourceType: "docs-fixture",
      sourceDevice: "Forge Docs Fixture",
      startedAt: isoAtOffset(-1, 22, 42),
      endedAt: isoAtOffset(0, 6, 52),
      sourceTimezone: "UTC",
      localDateKey: dayKey(0),
      timeInBedSeconds: 29_400,
      asleepSeconds: 27_600,
      awakeSeconds: 1_800,
      rawSegmentCount: 5,
      stageBreakdown: [
        { stage: "core", seconds: 16_200 },
        { stage: "deep", seconds: 4_200 },
        { stage: "rem", seconds: 7_200 }
      ],
      qualitySummary: "Strong recovery after an earlier shutdown and lower evening caffeine.",
      notes: "Fictional docs fixture for public screenshots.",
      tags: ["docs-demo", "recovery"]
    },
    context
  );

  createWorkoutSession(
    {
      externalUid: "docs_workout_tempo_walk",
      source: "manual",
      sourceType: "docs-fixture",
      sourceDevice: "Forge Docs Fixture",
      workoutType: "Outdoor Walk",
      startedAt: isoAtOffset(0, 7, 24),
      endedAt: isoAtOffset(0, 8, 3),
      activeEnergyKcal: 210,
      totalEnergyKcal: 268,
      distanceMeters: 4100,
      stepCount: 5300,
      exerciseMinutes: 39,
      averageHeartRate: 112,
      maxHeartRate: 138,
      subjectiveEffort: 4,
      moodBefore: "foggy",
      moodAfter: "clearer",
      meaningText: "Recovery walk before the review block.",
      tags: ["docs-demo", "recovery"]
    },
    context
  );

  createMovementUserBox(
    {
      userId: "user_operator",
      kind: "stay",
      startedAt: isoAtOffset(0, 8, 15),
      endedAt: isoAtOffset(0, 10, 45),
      title: "North Pier Studio",
      subtitle: "Planning review and screenshot pass",
      placeLabel: "North Pier Studio",
      tags: ["docs-demo", "deep-work"],
      metadata: { fixture: "docs" }
    },
    context
  );
  createMovementUserBox(
    {
      userId: "user_operator",
      kind: "trip",
      startedAt: isoAtOffset(0, 10, 45),
      endedAt: isoAtOffset(0, 11, 8),
      title: "Walk to library",
      subtitle: "Recovery transition",
      tags: ["docs-demo", "recovery"],
      distanceMeters: 1850,
      averageSpeedMps: 1.34,
      metadata: { fixture: "docs" }
    },
    context
  );
  createMovementUserBox(
    {
      userId: "user_operator",
      kind: "stay",
      startedAt: isoAtOffset(0, 11, 8),
      endedAt: isoAtOffset(0, 13, 20),
      title: "Harbor Library",
      subtitle: "Quiet documentation block",
      placeLabel: "Harbor Library",
      tags: ["docs-demo", "writing"],
      metadata: { fixture: "docs" }
    },
    context
  );

  updateNutritionTarget({
    calorieTarget: 2425,
    proteinGramsTarget: 165,
    fiberGramsTarget: 34,
    carbohydrateGramsTarget: 245,
    fatGramsTarget: 78,
    weightGoalKg: 76.5,
    weeklyRateGoalKg: -0.35,
    dietStyle: "high-protein steady cut",
    bodyGoal: "Lean, steady, and fueled enough for deep work.",
    notes:
      "Fictional docs fixture target; " +
      "sex=male; " +
      "age_years=35; " +
      "height_cm=178; " +
      "activity_kcal=640; " +
      "resting_kcal=1718; " +
      "eat_back_fraction=0.65"
  });
  updateNutritionDailyActiveCalories({
    dayKey: dayKey(0),
    activeCaloriesKcal: 640,
    notes: "Docs fixture active-energy override."
  });
  const breakfast = createNutritionFoodLog({
    loggedAt: isoAtOffset(0, 8, 12),
    mealLabel: "Breakfast",
    source: "manual",
    confirmationState: "confirmed",
    notes: "Simple high-protein start before the review block.",
    items: [
      {
        name: "Greek yogurt bowl",
        quantity: 1,
        unit: "bowl",
        grams: 360,
        calories: 430,
        proteinGrams: 43,
        carbohydrateGrams: 48,
        fatGrams: 8,
        fiberGrams: 7
      }
    ]
  });
  createNutritionFoodLog({
    loggedAt: isoAtOffset(0, 12, 35),
    mealLabel: "Lunch",
    source: "manual",
    confirmationState: "confirmed",
    notes: "Balanced lunch with enough carbs to protect the afternoon work block.",
    items: [
      {
        name: "Salmon rice plate",
        quantity: 1,
        unit: "plate",
        grams: 520,
        calories: 740,
        proteinGrams: 52,
        carbohydrateGrams: 82,
        fatGrams: 24,
        fiberGrams: 9
      }
    ]
  });
  createNutritionBodyCheckin({
    checkedAt: isoAtOffset(0, 6, 58),
    weightKg: 78.4,
    waistCm: 82.5,
    bodyFatPercent: 16.8,
    clothingFitScore: 7,
    notes: "Morning check-in for docs fixture trend."
  });
  createNutritionAppearanceCheckin({
    checkedAt: isoAtOffset(0, 7, 5),
    facePuffiness: 3,
    leanness: 7,
    muscularity: 6,
    posture: 8,
    bloatingLook: 2,
    confidenceScore: 7,
    notes: "Low bloat, steady look."
  });
  createNutritionSubjectiveCheckin({
    checkedAt: isoAtOffset(0, 10, 30),
    mealLogId: breakfast.id,
    timeRelation: "after_2h",
    hunger: 3,
    fullness: 6,
    cravings: 2,
    mood: 7,
    energy: 8,
    focus: 8,
    stress: 4,
    sleepiness: 2,
    crashScore: 1,
    notes: "Good focus after breakfast."
  });
  createNutritionGutCheckin({
    checkedAt: isoAtOffset(0, 13, 10),
    mealLogId: breakfast.id,
    bristolStoolType: 4,
    stoolFrequency: 1,
    bloating: 2,
    gas: 1,
    reflux: 0,
    abdominalPain: 0,
    urgency: 0,
    nausea: 0,
    constipation: 0,
    diarrhea: 0,
    triggerTags: ["dairy-ok"],
    notes: "No notable gut friction."
  });
  createNutritionExperiment({
    title: "Protein-before-deep-work experiment",
    status: "running",
    baselineStart: dayKey(-7),
    baselineEnd: dayKey(-1),
    interventionStart: dayKey(0),
    trackedOutcomes: ["focus", "hunger", "sleepiness"],
    protocol: { breakfastProteinGrams: 40, checkinWindowHours: 2 },
    resultSummary: "Early signal: steadier focus and lower cravings."
  });
}

async function main() {
  const dataRoot = assertSafeDataRoot(requestedDataRoot ?? "");
  const summary = await seedDemoDataIntoRuntime(dataRoot);

  configureDatabase({ dataRoot, seedDemoData: false });
  await initializeDatabase();
  updateSettings(
    {
      profile: {
        operatorName: "Mira Vale",
        operatorEmail: "mira.vale@example.test",
        operatorTitle: "Fictional local-first operator"
      },
      themePreference: "paper",
      gamificationTheme: "dramatic-smithie",
      execution: {
        maxActiveTasks: 3,
        timeAccountingMode: "split"
      }
    },
    context
  );
  rewriteCoreDemoRows();
  createPlanningAndKnowledgeData();
  createPreferenceData();
  createPsycheData();
  createHealthMovementAndNutritionData();
  closeDatabase();

  console.log(`Prepared Forge docs screenshot data at ${summary.dataRoot}`);
  console.log(`Database: ${summary.databasePath}`);
}

main().catch((error) => {
  closeDatabase();
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
