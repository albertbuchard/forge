import { describe, expect, it } from "vitest";
import { buildGoalGravityScene, type GoalGravityCluster } from "@/components/psyche/goal-gravity-scene";
import type { TriggerReport } from "@/lib/psyche-types";
import type { Goal } from "@/lib/types";

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
});
