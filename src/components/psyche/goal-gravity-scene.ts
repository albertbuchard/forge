import type { Goal, Habit, ProjectSummary } from "@/lib/types";
import type { Behavior, BeliefEntry, PsycheValue, TriggerReport } from "@/lib/psyche-types";
import type { PsycheGraphEdge, PsycheGraphField, PsycheGraphNode, PsycheGraphTone } from "@/components/psyche/psyche-graph";
import type { EntityKind } from "@/lib/entity-visuals";

export interface GoalGravityCluster {
  goal: Goal;
  linkedValues: PsycheValue[];
  linkedProjects: ProjectSummary[];
  linkedHabits: Habit[];
  linkedReports: TriggerReport[];
  linkedBehaviors: Behavior[];
  linkedBeliefs: BeliefEntry[];
}

export interface GoalGravityInspector {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  href: string;
  ctaLabel: string;
  tone: PsycheGraphTone;
  entityKind?: EntityKind;
  chips: string[];
  stats: string[];
}

export interface GoalGravityScene {
  nodes: PsycheGraphNode[];
  edges: PsycheGraphEdge[];
  fields: PsycheGraphField[];
  inspectors: Record<string, GoalGravityInspector>;
  defaultSelectedId: string;
}

function clusterScopedNodeId(
  clusterGoalId: string,
  entityKind: string,
  entityId: string
) {
  return `${entityKind}:${clusterGoalId}:${entityId}`;
}

type MutablePackedNode = PsycheGraphNode & {
  homeX: number;
  homeY: number;
  locked: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function estimateLineCount(label: string, maxCharsPerLine: number, maxLines: number) {
  return Math.min(maxLines, Math.max(1, Math.ceil(label.trim().length / maxCharsPerLine)));
}

function estimateGoalRadius(label: string, { compact }: { compact: boolean }) {
  const lineCount = estimateLineCount(label, compact ? 13 : 14, 4);
  const baseRadius = compact ? 114 : 156;
  const radius = baseRadius + (lineCount - 1) * (compact ? 12 : 18) + Math.min(24, Math.max(0, label.trim().length - 18)) * (compact ? 0.7 : 1);
  return clamp(radius, compact ? 118 : 164, compact ? 154 : 210);
}

function estimateValueRadius(label: string, { compact }: { compact: boolean }) {
  const lineCount = estimateLineCount(label, compact ? 11 : 13, 3);
  const baseRadius = compact ? 40 : 48;
  const radius =
    baseRadius +
    (lineCount - 1) * (compact ? 6 : 8) +
    Math.min(compact ? 18 : 26, Math.max(0, label.trim().length - (compact ? 12 : 16))) * (compact ? 0.45 : 0.55);
  return clamp(radius, compact ? 42 : 50, compact ? 56 : 68);
}

function estimateRectNodeSize(
  label: string,
  { compact, emphasis = false }: { compact: boolean; emphasis?: boolean }
) {
  const maxCharsPerLine = compact ? 16 : emphasis ? 22 : 20;
  const lineCount = estimateLineCount(label, maxCharsPerLine, emphasis ? 3 : 2);
  const width = clamp(
    (compact ? (emphasis ? 184 : 152) : emphasis ? 224 : 176) + Math.min(label.length, 48) * (compact ? 1.8 : 2.15),
    compact ? (emphasis ? 188 : 156) : emphasis ? 228 : 184,
    compact ? (emphasis ? 248 : 208) : emphasis ? 300 : 244
  );
  const height = lineCount === 1 ? (compact ? 64 : 70) : lineCount === 2 ? (compact ? 82 : 92) : compact ? 98 : 110;

  return { width, height };
}

function nodeHalfSize(node: PsycheGraphNode) {
  if (node.kind === "goal" || node.kind === "value" || node.kind === "ghost") {
    const radius = node.radius ?? (node.kind === "goal" ? 76 : 34);
    return { halfWidth: radius, halfHeight: radius };
  }

  return {
    halfWidth: (node.width ?? 146) / 2,
    halfHeight: (node.height ?? 58) / 2
  };
}

function packSceneNodes(nodes: PsycheGraphNode[], { compact }: { compact: boolean }): PsycheGraphNode[] {
  const packed: MutablePackedNode[] = nodes.map((node) => ({
    ...node,
    homeX: node.x,
    homeY: node.y,
    locked: node.kind === "goal" || node.kind === "ghost"
  }));
  const gap = compact ? 28 : 40;
  const spring = compact ? 0.08 : 0.06;

  for (let iteration = 0; iteration < 180; iteration += 1) {
    for (const node of packed) {
      if (node.locked) {
        continue;
      }
      node.x += (node.homeX - node.x) * spring;
      node.y += (node.homeY - node.y) * spring;
    }

    for (let leftIndex = 0; leftIndex < packed.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < packed.length; rightIndex += 1) {
        const left = packed[leftIndex]!;
        const right = packed[rightIndex]!;
        const leftSize = nodeHalfSize(left);
        const rightSize = nodeHalfSize(right);
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const overlapX = leftSize.halfWidth + rightSize.halfWidth + gap - Math.abs(deltaX);
        const overlapY = leftSize.halfHeight + rightSize.halfHeight + gap - Math.abs(deltaY);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        const axis = overlapX < overlapY ? "x" : "y";
        const direction = axis === "x" ? Math.sign(deltaX || rightIndex - leftIndex || 1) : Math.sign(deltaY || rightIndex - leftIndex || 1);
        const push = (axis === "x" ? overlapX : overlapY) / (left.locked || right.locked ? 1 : 2);

        if (!left.locked) {
          if (axis === "x") {
            left.x -= direction * push;
          } else {
            left.y -= direction * push;
          }
        }

        if (!right.locked) {
          if (axis === "x") {
            right.x += direction * push;
          } else {
            right.y += direction * push;
          }
        }
      }
    }
  }

  return packed.map(({ homeX: _homeX, homeY: _homeY, locked: _locked, ...node }) => node);
}

function buildGhostScene(): GoalGravityScene {
  return {
    nodes: [
      { id: "ghost_goal_north", kind: "ghost", x: -250, y: -20, radius: 68, label: "First goal", meta: "Goal", href: "/goals" },
      { id: "ghost_goal_center", kind: "ghost", x: 0, y: 34, radius: 74, label: "Life goals", meta: "Goal", href: "/goals" },
      { id: "ghost_goal_south", kind: "ghost", x: 250, y: -10, radius: 68, label: "Direction", meta: "Goal", href: "/goals" }
    ],
    edges: [],
    fields: [],
    inspectors: {
      ghost_goal_center: {
        id: "ghost_goal_center",
        eyebrow: "Goals",
        title: "Add the first life goal",
        summary: "The graph is already laid out. Once a goal exists, values, reports, beliefs, and behaviors will start orbiting it instead of staying fragmented.",
        href: "/goals",
        ctaLabel: "Open life goals",
        tone: "sky",
        entityKind: "goal",
        chips: ["Goals", "Values", "Reports"],
        stats: ["0 goals mapped yet"]
      }
    },
    defaultSelectedId: "ghost_goal_center"
  };
}

export function buildGoalGravityScene(clusters: GoalGravityCluster[], { compact = false }: { compact?: boolean } = {}): GoalGravityScene {
  if (clusters.length === 0) {
    return buildGhostScene();
  }

  const nodes: PsycheGraphNode[] = [];
  const edges: PsycheGraphEdge[] = [];
  const fields: PsycheGraphField[] = [];
  const inspectors: Record<string, GoalGravityInspector> = {};

  const spacing = compact ? 560 : 840;
  const startX = -((clusters.length - 1) * spacing) / 2;

  clusters.forEach((cluster, clusterIndex) => {
    const goalX = startX + clusterIndex * spacing;
    const goalY = clusterIndex % 2 === 0 ? 92 : 146;
    const frictionCount = cluster.linkedBehaviors.length + cluster.linkedBeliefs.length + cluster.linkedReports.length + cluster.linkedHabits.length;
    const goalNodeId = `goal:${cluster.goal.id}`;

    nodes.push({
      id: goalNodeId,
      kind: "goal",
      x: goalX,
      y: goalY,
      radius: estimateGoalRadius(cluster.goal.title, { compact }),
      tone: "amber",
      label: cluster.goal.title,
      href: `/goals/${cluster.goal.id}`
    });

    inspectors[goalNodeId] = {
      id: goalNodeId,
      eyebrow: "Goal",
      title: cluster.goal.title,
      summary: cluster.goal.description,
      href: `/goals/${cluster.goal.id}`,
      ctaLabel: "Open goal",
      tone: "amber",
      entityKind: "goal",
        chips: cluster.linkedValues.slice(0, 4).map((value) => value.title),
        stats: [
          `${cluster.linkedValues.length} linked value${cluster.linkedValues.length === 1 ? "" : "s"}`,
          `${cluster.linkedProjects.length} live project${cluster.linkedProjects.length === 1 ? "" : "s"}`,
          `${cluster.linkedHabits.length} linked habit${cluster.linkedHabits.length === 1 ? "" : "s"}`,
          `${frictionCount} friction signal${frictionCount === 1 ? "" : "s"}`
        ]
      };

    if (frictionCount > 0) {
      fields.push({
        id: `field:${cluster.goal.id}`,
        x: goalX + 18,
        y: goalY + 20,
        radiusX: compact ? 144 : 176,
        radiusY: compact ? 104 : 132,
        tone: "rose",
        opacity: Math.min(0.42, 0.14 + frictionCount * 0.04)
      });
    }

    const valueOrbitRadius = compact ? 208 : 282;
    cluster.linkedValues.slice(0, compact ? 4 : 5).forEach((value, valueIndex) => {
      const angle = (-95 + valueIndex * (compact ? 78 : 64)) * (Math.PI / 180);
      const nodeRadius = estimateValueRadius(value.title, { compact });
      const valueX = goalX + Math.cos(angle) * valueOrbitRadius;
      const valueY = goalY + Math.sin(angle) * valueOrbitRadius;
      const nodeId = clusterScopedNodeId(cluster.goal.id, "value", value.id);

      nodes.push({
        id: nodeId,
        kind: "value",
        x: valueX,
        y: valueY,
        radius: nodeRadius,
        tone: "mint",
        label: value.title,
        meta: `${value.linkedGoalIds.length} goal${value.linkedGoalIds.length === 1 ? "" : "s"}`,
        href: `/psyche/values?focus=${value.id}#values-atlas`
      });

      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "mint",
        strength: "medium"
      });

      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Value",
        title: value.title,
        summary: value.valuedDirection || value.whyItMatters || value.description,
        href: `/psyche/values?focus=${value.id}#values-atlas`,
        ctaLabel: "Open values",
        tone: "mint",
        entityKind: "value",
        chips: value.committedActions.slice(0, 3),
        stats: [
          `${value.linkedProjectIds.length} linked project${value.linkedProjectIds.length === 1 ? "" : "s"}`,
          `${value.linkedTaskIds.length} linked task${value.linkedTaskIds.length === 1 ? "" : "s"}`
        ]
      };
    });

    const visibleProjects = cluster.linkedProjects.slice(0, compact ? 2 : 3).map((project) => ({
      project,
      size: estimateRectNodeSize(project.title, { compact, emphasis: true })
    }));
    const projectGap = compact ? 24 : 30;
    const projectSpan =
      visibleProjects.reduce((sum, entry) => sum + entry.size.width, 0) + Math.max(0, visibleProjects.length - 1) * projectGap;
    let projectOffset = -projectSpan / 2;

    visibleProjects.forEach(({ project, size }, projectIndex) => {
      const nodeId = clusterScopedNodeId(cluster.goal.id, "project", project.id);
      const projectX = goalX + projectOffset + size.width / 2;
      const projectY = goalY - (compact ? 330 : 434) - projectIndex * (compact ? 16 : 20);
      projectOffset += size.width + projectGap;
      nodes.push({
        id: nodeId,
        kind: "project",
        x: projectX,
        y: projectY,
        width: size.width,
        height: size.height,
        tone: "sky",
        label: project.title,
        meta: "Project",
        href: `/projects/${project.id}`
      });
      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "sky",
        strength: "medium"
      });
      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Project",
        title: project.title,
        summary: project.description,
        href: `/projects/${project.id}`,
        ctaLabel: "Open project",
        tone: "sky",
        entityKind: "project",
        chips: [project.status, project.goalTitle],
        stats: [`${project.progress}% progress`, `${project.activeTaskCount} active task${project.activeTaskCount === 1 ? "" : "s"}`]
      };
    });

    cluster.linkedHabits.slice(0, compact ? 2 : 3).forEach((habit, habitIndex) => {
      const nodeId = clusterScopedNodeId(cluster.goal.id, "habit", habit.id);
      const habitSize = estimateRectNodeSize(habit.title, { compact });
      const habitX = goalX - (compact ? 44 : 58);
      const habitY = goalY + (compact ? 228 : 294) + habitIndex * (compact ? 92 : 104);
      nodes.push({
        id: nodeId,
        kind: "habit",
        x: habitX,
        y: habitY,
        width: habitSize.width,
        height: habitSize.height,
        tone: "mint",
        label: habit.title,
        meta: habit.polarity,
        href: "/habits"
      });
      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "mint",
        strength: habit.dueToday ? "high" : "medium"
      });
      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Habit",
        title: habit.title,
        summary: habit.description || "Recurring operating record connected directly to this goal field.",
        href: "/habits",
        ctaLabel: "Open habits",
        tone: "mint",
        entityKind: "habit",
        chips: [habit.polarity, habit.frequency, habit.dueToday ? "due today" : "checked in"],
        stats: [`${habit.streakCount} streak`, `${habit.rewardXp}/${habit.penaltyXp} xp flow`]
      };
    });

    let behaviorY = goalY + (compact ? 132 : 156);
    cluster.linkedBehaviors.slice(0, compact ? 2 : 3).forEach((behavior) => {
      const nodeId = clusterScopedNodeId(cluster.goal.id, "behavior", behavior.id);
      const behaviorSize = estimateRectNodeSize(behavior.title, { compact });
      const behaviorX = goalX - (compact ? 272 : 352);
      nodes.push({
        id: nodeId,
        kind: "behavior",
        x: behaviorX,
        y: behaviorY,
        width: behaviorSize.width,
        height: behaviorSize.height,
        tone: "orange",
        label: behavior.title,
        meta: behavior.kind,
        href: `/psyche/behaviors?focus=${behavior.id}#behavior-columns`
      });
      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "orange",
        dashed: behavior.kind !== "committed",
        strength: behavior.kind === "committed" ? "medium" : "low"
      });
      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Behavior",
        title: behavior.title,
        summary: behavior.replacementMove || behavior.description || behavior.urgeStory,
        href: `/psyche/behaviors?focus=${behavior.id}#behavior-columns`,
        ctaLabel: "Open behaviors",
        tone: "orange",
        entityKind: "behavior",
        chips: [behavior.kind, ...behavior.commonCues.slice(0, 2)],
        stats: [
          behavior.shortTermPayoff ? "Short-term payoff mapped" : "Payoff still to map",
          behavior.longTermCost ? "Long-term cost mapped" : "Cost still to map"
        ]
      };
      behaviorY += behaviorSize.height + (compact ? 18 : 22);
    });

    let beliefY = goalY + (compact ? 8 : 10);
    cluster.linkedBeliefs.slice(0, compact ? 2 : 3).forEach((belief) => {
      const nodeId = clusterScopedNodeId(cluster.goal.id, "belief", belief.id);
      const beliefSize = estimateRectNodeSize(belief.statement, { compact, emphasis: true });
      const beliefX = goalX + (compact ? 278 : 362);
      nodes.push({
        id: nodeId,
        kind: "belief",
        x: beliefX,
        y: beliefY,
        width: beliefSize.width,
        height: beliefSize.height,
        tone: "violet",
        label: belief.statement,
        meta: "belief",
        href: `/psyche/schemas-beliefs?focus=${belief.id}`
      });
      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "violet",
        dashed: true,
        strength: "low"
      });
      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Belief",
        title: belief.statement,
        summary: belief.flexibleAlternative || belief.originNote || "Belief script attached to this part of the map.",
        href: `/psyche/schemas-beliefs?focus=${belief.id}`,
        ctaLabel: "Open beliefs",
        tone: "violet",
        entityKind: "belief",
        chips: [belief.beliefType, `${belief.confidence}% grip`],
        stats: [`${belief.linkedBehaviorIds.length} linked behavior${belief.linkedBehaviorIds.length === 1 ? "" : "s"}`, `${belief.linkedReportIds.length} linked report${belief.linkedReportIds.length === 1 ? "" : "s"}`]
      };
      beliefY += beliefSize.height + (compact ? 18 : 22);
    });

    const visibleReports = cluster.linkedReports.slice(0, compact ? 2 : 3).map((report) => ({
      report,
      size: estimateRectNodeSize(report.title, { compact })
    }));
    const reportGap = compact ? 20 : 26;
    const reportSpan =
      visibleReports.reduce((sum, entry) => sum + entry.size.width, 0) + Math.max(0, visibleReports.length - 1) * reportGap;
    let reportOffset = -reportSpan / 2;

    visibleReports.forEach(({ report, size }) => {
      const nodeId = clusterScopedNodeId(cluster.goal.id, "report", report.id);
      const reportX = goalX + reportOffset + size.width / 2;
      const reportY = goalY + (compact ? 332 : 430);
      reportOffset += size.width + reportGap;
      nodes.push({
        id: nodeId,
        kind: "report",
        x: reportX,
        y: reportY,
        width: size.width,
        height: size.height,
        tone: "blue",
        label: report.title,
        meta: report.status,
        href: `/psyche/reports/${report.id}`
      });
      edges.push({
        id: `${goalNodeId}->${nodeId}`,
        from: goalNodeId,
        to: nodeId,
        tone: "sky",
        strength: "medium"
      });
      inspectors[nodeId] = {
        id: nodeId,
        eyebrow: "Report",
        title: report.title,
        summary: report.eventSituation || report.customEventType || "Reflective chain linked into this goal.",
        href: `/psyche/reports/${report.id}`,
        ctaLabel: "Open report",
        tone: "blue",
        entityKind: "report",
        chips: [report.status, ...report.nextMoves.slice(0, 2)],
        stats: [
          `${report.emotions.length} emotion${report.emotions.length === 1 ? "" : "s"}`,
          `${report.behaviors.length} move${report.behaviors.length === 1 ? "" : "s"}`
        ]
      };
    });
  });

  const defaultSelectedId = nodes[0]?.id ?? "ghost_goal_center";
  return {
    nodes: packSceneNodes(nodes, { compact }),
    edges,
    fields,
    inspectors,
    defaultSelectedId
  };
}
