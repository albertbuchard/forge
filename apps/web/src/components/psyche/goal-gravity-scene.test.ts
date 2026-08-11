import { describe, expect, it } from "vitest";
import {
  buildGoalGravityScene,
  type GoalGravityCluster
} from "@/components/psyche/goal-gravity-scene";
import type { Behavior, PsycheValue, TriggerReport } from "@/lib/psyche-types";
import type { Goal, Habit } from "@/lib/types";

function buildGoal(id: string, title: string): Goal {
  return {
    id,
    title,
    description: `${title} description`,
    horizon: "year",
    status: "active",
    targetPoints: 100,
    themeColor: "#5b6ee1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tagIds: []
  };
}

function buildValue(goalId: string): PsycheValue {
  return {
    id: "value_shared",
    domainId: "psyche",
    title: "Steadiness",
    description: "Respond steadily.",
    valuedDirection: "Move with steadiness.",
    whyItMatters: "It supports deliberate action.",
    linkedGoalIds: [goalId],
    linkedProjectIds: [],
    linkedTaskIds: [],
    committedActions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function buildHabit(goalId: string, direct: boolean): Habit {
  return {
    id: direct ? "habit_direct" : "habit_shared_value",
    title: direct ? "Direct habit" : "Shared-value habit",
    description: "A test habit.",
    status: "active",
    polarity: "positive",
    frequency: "daily",
    timezone: "UTC",
    dayBoundaryMode: "fixed",
    effectiveTimezone: "UTC",
    currentDateKey: "2026-01-01",
    targetCount: 1,
    weekDays: [],
    linkedGoalIds: direct ? [goalId] : [],
    linkedProjectIds: [],
    linkedTaskIds: [],
    linkedValueIds: ["value_shared"],
    linkedPatternIds: [],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    linkedReportIds: [],
    linkedBehaviorId: null,
    linkedBehaviorTitle: null,
    linkedBehaviorTitles: [],
    rewardXp: 5,
    penaltyXp: 0,
    generatedHealthEventTemplate: {
      enabled: false,
      workoutType: "",
      title: "",
      durationMinutes: 0,
      xpReward: 0,
      tags: [],
      links: [],
      notesTemplate: ""
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastCheckInAt: null,
    lastCheckInStatus: null,
    streakCount: 0,
    completionRate: 0,
    dueToday: false,
    checkIns: []
  };
}

function buildBehavior(): Behavior {
  return {
    id: "behavior_shared_value",
    domainId: "psyche",
    kind: "committed",
    title: "Pause before replying",
    description: "A linked behavior.",
    commonCues: [],
    urgeStory: "",
    shortTermPayoff: "",
    longTermCost: "",
    replacementMove: "Pause.",
    repairPlan: "",
    linkedPatternIds: [],
    linkedValueIds: ["value_shared"],
    linkedSchemaIds: [],
    linkedModeIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("buildGoalGravityScene", () => {
  it("creates unique node ids when the same report is linked to multiple goals", () => {
    const sharedReport: TriggerReport = {
      id: "trg_45b3c591ec",
      domainId: "psyche",
      title: "Shared report",
      status: "draft",
      linkedGoalIds: ["goal_1", "goal_2"],
      nextMoves: [],
      emotions: [],
      thoughts: [],
      behaviors: [],
      eventSituation: "",
      customEventType: "",
      eventTypeId: null,
      occurredAt: null,
      bodyCues: [],
      consequences: {
        selfShortTerm: [],
        selfLongTerm: [],
        othersShortTerm: [],
        othersLongTerm: []
      },
      linkedPatternIds: [],
      linkedValueIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      linkedBehaviorIds: [],
      linkedBeliefIds: [],
      linkedModeIds: [],
      modeOverlays: [],
      schemaLinks: [],
      modeTimeline: [],
      memoryClarity: "clear",
      reflection: "",
      hypothesis: "",
      hypothesisFit: "not_reviewed",
      hypothesisCorrection: "",
      interpretationConsent: false,
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    const clusters: GoalGravityCluster[] = [
      {
        goal: buildGoal("goal_1", "Goal one"),
        linkedValues: [],
        linkedProjects: [],
        linkedHabits: [],
        linkedReports: [sharedReport],
        linkedBehaviors: [],
        linkedBeliefs: []
      },
      {
        goal: buildGoal("goal_2", "Goal two"),
        linkedValues: [],
        linkedProjects: [],
        linkedHabits: [],
        linkedReports: [sharedReport],
        linkedBehaviors: [],
        linkedBeliefs: []
      }
    ];

    const scene = buildGoalGravityScene(clusters);
    const nodeIds = scene.nodes.map((node) => node.id);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toContain("report:goal_1:trg_45b3c591ec");
    expect(nodeIds).toContain("report:goal_2:trg_45b3c591ec");
  });

  it("distinguishes explicit links from indirect shared-value associations", () => {
    const goal = buildGoal("goal_1", "Goal one");
    const scene = buildGoalGravityScene([
      {
        goal,
        linkedValues: [buildValue(goal.id)],
        linkedProjects: [],
        linkedHabits: [buildHabit(goal.id, true), buildHabit(goal.id, false)],
        linkedReports: [],
        linkedBehaviors: [buildBehavior()],
        linkedBeliefs: []
      }
    ]);

    expect(
      scene.edges.find((edge) => edge.to.includes("habit_direct"))
    ).toMatchObject({
      dashed: false,
      label: "Explicit habit-to-goal link"
    });
    expect(
      scene.edges.find((edge) => edge.to.includes("habit_shared_value"))
    ).toMatchObject({
      dashed: true,
      strength: "low",
      label: "Habit and goal share a linked value"
    });
    expect(
      scene.edges.find((edge) => edge.to.includes("behavior_shared_value"))
    ).toMatchObject({
      dashed: true,
      strength: "low",
      label: "Behavior and goal share a linked value"
    });
  });
});
