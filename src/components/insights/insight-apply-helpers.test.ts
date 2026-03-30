import { describe, expect, it } from "vitest";
import {
  buildInsightGoalDefaults,
  buildInsightNoteMarkdown,
  buildInsightProjectDefaults,
  buildInsightTaskDefaults,
  getAvailableApplyKinds,
  getInsightSourceLink,
  getRecommendedApplyKind
} from "@/components/insights/insight-apply-helpers";
import type { Goal, Insight, ProjectSummary, Task } from "@/lib/types";

const goal: Goal = {
  id: "goal_1",
  title: "Build the atlas",
  description: "Strategic direction",
  horizon: "year",
  status: "active",
  targetPoints: 500,
  themeColor: "#c8a46b",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  tagIds: []
};

const project: ProjectSummary = {
  id: "project_1",
  goalId: goal.id,
  title: "Atlas initiative",
  description: "Operational project",
  status: "active",
  targetPoints: 240,
  themeColor: "#c0c1ff",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  goalTitle: goal.title,
  activeTaskCount: 1,
  completedTaskCount: 0,
  totalTasks: 1,
  earnedPoints: 0,
  progress: 0,
  nextTaskId: "task_1",
  nextTaskTitle: "Draft the first sketch",
  momentumLabel: "Fresh",
  time: {
    totalTrackedSeconds: 0,
    totalCreditedSeconds: 0,
    liveTrackedSeconds: 0,
    liveCreditedSeconds: 0,
    manualAdjustedSeconds: 0,
    activeRunCount: 0,
    hasCurrentRun: false,
    currentRunId: null
  }
};

const task: Task = {
  id: "task_1",
  title: "Draft the first sketch",
  description: "Make the first draft",
  status: "focus",
  priority: "medium",
  owner: "Albert",
  goalId: goal.id,
  projectId: project.id,
  dueDate: null,
  effort: "deep",
  energy: "steady",
  points: 60,
  sortOrder: 1,
  completedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  tagIds: [],
  time: {
    totalTrackedSeconds: 0,
    totalCreditedSeconds: 0,
    liveTrackedSeconds: 0,
    liveCreditedSeconds: 0,
    manualAdjustedSeconds: 0,
    activeRunCount: 0,
    hasCurrentRun: false,
    currentRunId: null
  }
};

const insight: Insight = {
  id: "ins_1",
  originType: "user",
  originAgentId: null,
  originLabel: null,
  visibility: "visible",
  status: "open",
  entityType: "project",
  entityId: project.id,
  timeframeLabel: "This week",
  title: "Tighten the weekly close-out",
  summary: "Weekly reviews lose momentum because the close-out is vague.",
  recommendation: "Create one concrete next task during every close-out.",
  rationale: "Without a crisp handoff, next week starts in ambiguity.",
  confidence: 0.8,
  ctaLabel: "Review insight",
  evidence: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

describe("insight apply helpers", () => {
  it("derives the available and recommended apply kinds from current context", () => {
    expect(getAvailableApplyKinds(insight, [goal], [project])).toEqual(["task", "project", "goal", "note"]);
    expect(getRecommendedApplyKind(insight, [goal], [project])).toBe("task");
  });

  it("builds task and project defaults from the linked context", () => {
    const taskDefaults = buildInsightTaskDefaults(insight, [project], [task]);
    expect(taskDefaults.projectId).toBe(project.id);
    expect(taskDefaults.goalId).toBe(goal.id);
    expect(taskDefaults.title).toContain("Create one concrete next task");

    const projectDefaults = buildInsightProjectDefaults(insight, [goal], [project], [task]);
    expect(projectDefaults.goalId).toBe(goal.id);
    expect(projectDefaults.description).toContain("Recommendation:");
  });

  it("builds goal and note defaults that preserve the recommendation", () => {
    const goalDefaults = buildInsightGoalDefaults(insight);
    expect(goalDefaults.title).toBe("Tighten the weekly close-out");
    expect(goalDefaults.description).toContain(insight.recommendation);

    const markdown = buildInsightNoteMarkdown(insight);
    expect(markdown).toContain("## Tighten the weekly close-out");
    expect(markdown).toContain("### Recommendation");
    expect(markdown).toContain("### Why this matters");
  });

  it("returns the source link only for supported linked entities", () => {
    expect(getInsightSourceLink(insight)).toEqual({
      entityType: "project",
      entityId: project.id,
      anchorKey: null
    });

    expect(
      getInsightSourceLink({
        ...insight,
        entityType: null,
        entityId: null
      })
    ).toBeNull();
  });
});
