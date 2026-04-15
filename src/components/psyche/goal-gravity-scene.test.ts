import { describe, expect, it } from "vitest";
import { buildGoalGravityScene, type GoalGravityCluster } from "@/components/psyche/goal-gravity-scene";

describe("buildGoalGravityScene", () => {
  it("creates unique node ids when the same report is linked to multiple goals", () => {
    const sharedReport = {
      id: "trg_45b3c591ec",
      title: "Shared report",
      status: "open",
      linkedGoalIds: ["goal_1", "goal_2"],
      nextMoves: [],
      emotions: [],
      behaviors: [],
      eventSituation: "",
      customEventType: ""
    };

    const clusters: GoalGravityCluster[] = [
      {
        goal: {
          id: "goal_1",
          title: "Goal one",
          description: "First goal"
        } as any,
        linkedValues: [],
        linkedProjects: [],
        linkedHabits: [],
        linkedReports: [sharedReport as any],
        linkedBehaviors: [],
        linkedBeliefs: []
      },
      {
        goal: {
          id: "goal_2",
          title: "Goal two",
          description: "Second goal"
        } as any,
        linkedValues: [],
        linkedProjects: [],
        linkedHabits: [],
        linkedReports: [sharedReport as any],
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
