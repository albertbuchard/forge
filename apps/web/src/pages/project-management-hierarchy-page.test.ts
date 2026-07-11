import { describe, expect, it } from "vitest";
import type { Goal, ProjectSummary, WorkItem } from "@/lib/types";
import { buildHierarchyTree } from "./project-management-hierarchy-page";

const goal = {
  id: "goal_hierarchy",
  title: "Hierarchy goal",
  description: "",
  horizon: "year",
  status: "active",
  targetPoints: 400,
  themeColor: "#c8a46b",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
  tagIds: []
} as Goal;

const project = {
  id: "project_hierarchy",
  goalId: goal.id,
  goalTitle: goal.title,
  title: "Hierarchy project",
  description: "",
  productRequirementsDocument: "",
  status: "active",
  workflowStatus: "backlog",
  targetPoints: 240,
  themeColor: "#c0c1ff",
  progress: 0,
  activeTaskCount: 0,
  completedTaskCount: 0,
  totalTasks: 0,
  earnedPoints: 0,
  nextTaskId: null,
  nextTaskTitle: null,
  momentumLabel: "Needs ignition",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
} as ProjectSummary;

function workItem(
  id: string,
  parentWorkItemId: string | null,
  level: WorkItem["level"] = "task",
  owningProject: ProjectSummary = project
) {
  return {
    id,
    title: id,
    description: "",
    level,
    parentWorkItemId,
    projectId: owningProject.id,
    goalId: owningProject.goalId,
    status: "backlog",
    aiInstructions: "",
    executionMode: null,
    tagIds: [],
    assigneeUserIds: [],
    assignees: []
  } as unknown as WorkItem;
}

function flattenIds(nodes: ReturnType<typeof buildHierarchyTree>): string[] {
  return nodes.flatMap((node) => [
    node.entityId,
    ...flattenIds(node.children ?? [])
  ]);
}

describe("buildHierarchyTree", () => {
  it("keeps orphaned and cyclic project work visible exactly once", () => {
    const orphan = workItem("orphan", "missing-parent", "subtask");
    const cycleA = workItem("cycle-a", "cycle-b");
    const cycleB = workItem("cycle-b", "cycle-a", "subtask");

    const tree = buildHierarchyTree({
      goals: [goal],
      strategies: [],
      projects: [project],
      workItems: [orphan, cycleA, cycleB],
      tagNameById: new Map()
    });
    const ids = flattenIds(tree);

    expect(ids).toContain(orphan.id);
    expect(ids).toContain(cycleA.id);
    expect(ids).toContain(cycleB.id);
    expect(ids.filter((id) => id === cycleA.id)).toHaveLength(1);
    expect(ids.filter((id) => id === cycleB.id)).toHaveLength(1);
  });

  it("keeps a cross-project child only under its declared project", () => {
    const secondProject = {
      ...project,
      id: "project_second",
      title: "Second project"
    } as ProjectSummary;
    const firstParent = workItem("first-parent", null);
    const mismatchedChild = workItem(
      "second-child",
      firstParent.id,
      "subtask",
      secondProject
    );

    const tree = buildHierarchyTree({
      goals: [goal],
      strategies: [],
      projects: [project, secondProject],
      workItems: [firstParent, mismatchedChild],
      tagNameById: new Map()
    });
    const ids = flattenIds(tree);

    expect(ids.filter((id) => id === mismatchedChild.id)).toHaveLength(1);
    const firstProjectNode = tree
      .flatMap((node) => node.children ?? [])
      .find((node) => node.entityId === project.id);
    expect(flattenIds(firstProjectNode?.children ?? [])).not.toContain(
      mismatchedChild.id
    );
  });
});
