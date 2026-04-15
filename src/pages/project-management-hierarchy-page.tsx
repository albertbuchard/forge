import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tree } from "react-arborist";
import { Link } from "react-router-dom";
import { ProjectManagementSectionNav } from "@/components/projects/project-management-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import { useForgeShell } from "@/components/shell/app-shell";
import { getWorkItemsHierarchy } from "@/lib/api";
import type { Goal, ProjectSummary, Strategy, WorkItem } from "@/lib/types";

type HierarchyKind =
  | "goal"
  | "strategy"
  | "project"
  | "issue"
  | "task"
  | "subtask";

type HierarchyNode = {
  id: string;
  entityId: string;
  kind: HierarchyKind;
  label: string;
  description: string;
  href: string | null;
  statusLabel: string | null;
  ownerLabel: string | null;
  user: WorkItem["user"] | ProjectSummary["user"] | Goal["user"] | Strategy["user"];
  children?: HierarchyNode[];
};

const DEFAULT_VISIBLE_LEVELS: HierarchyKind[] = ["task", "subtask"];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function buildHierarchyTree(options: {
  goals: Goal[];
  strategies: Strategy[];
  projects: ProjectSummary[];
  workItems: WorkItem[];
}): HierarchyNode[] {
  const { goals, strategies, projects, workItems } = options;
  const workItemsByParentId = new Map<string, WorkItem[]>();
  const issuesByProjectId = new Map<string, WorkItem[]>();
  const rootWorkItemsByProjectId = new Map<string, WorkItem[]>();

  for (const item of workItems) {
    if (item.parentWorkItemId) {
      const current = workItemsByParentId.get(item.parentWorkItemId) ?? [];
      current.push(item);
      workItemsByParentId.set(item.parentWorkItemId, current);
    } else if (item.level === "issue" && item.projectId) {
      const current = issuesByProjectId.get(item.projectId) ?? [];
      current.push(item);
      issuesByProjectId.set(item.projectId, current);
    } else if (item.projectId) {
      const current = rootWorkItemsByProjectId.get(item.projectId) ?? [];
      current.push(item);
      rootWorkItemsByProjectId.set(item.projectId, current);
    }
  }

  const mapWorkItem = (item: WorkItem): HierarchyNode => ({
    id: `${item.level}:${item.id}`,
    entityId: item.id,
    kind: item.level,
    label: item.title,
    description: item.description,
    href: item.level === "task" ? `/tasks/${item.id}` : null,
    statusLabel: item.status.replaceAll("_", " "),
    ownerLabel: item.owner,
    user: item.user,
    children: (workItemsByParentId.get(item.id) ?? []).map(mapWorkItem)
  });

  return goals.map((goal) => {
    const goalProjects = projects.filter((project) => project.goalId === goal.id);
    const goalStrategies = strategies.filter((strategy) =>
      strategy.targetGoalIds.includes(goal.id)
    );

    const strategyNodes: HierarchyNode[] = goalStrategies.map((strategy) => ({
      id: `strategy:${strategy.id}`,
      entityId: strategy.id,
      kind: "strategy",
      label: strategy.title,
      description: strategy.overview,
      href: `/strategies/${strategy.id}`,
      statusLabel: strategy.status,
      ownerLabel: strategy.user?.displayName ?? null,
      user: strategy.user,
      children: []
    }));

    const projectNodes: HierarchyNode[] = goalProjects.map((project) => {
      const lowerStrategies = strategies.filter((strategy) =>
        strategy.targetProjectIds.includes(project.id)
      );
      return {
        id: `project:${project.id}`,
        entityId: project.id,
        kind: "project",
        label: project.title,
        description:
          project.productRequirementsDocument || project.description || "",
        href: `/projects/${project.id}`,
        statusLabel: project.workflowStatus.replaceAll("_", " "),
        ownerLabel: project.user?.displayName ?? null,
        user: project.user,
        children: [
          ...lowerStrategies.map((strategy) => ({
            id: `strategy:${strategy.id}`,
            entityId: strategy.id,
            kind: "strategy" as const,
            label: strategy.title,
            description: strategy.overview,
            href: `/strategies/${strategy.id}`,
            statusLabel: strategy.status,
            ownerLabel: strategy.user?.displayName ?? null,
            user: strategy.user,
            children: []
          })),
          ...(issuesByProjectId.get(project.id) ?? []).map(mapWorkItem),
          ...(rootWorkItemsByProjectId.get(project.id) ?? []).map(mapWorkItem)
        ]
      };
    });

    return {
      id: `goal:${goal.id}`,
      entityId: goal.id,
      kind: "goal" as const,
      label: goal.title,
      description: goal.description,
      href: `/goals/${goal.id}`,
      statusLabel: goal.status,
      ownerLabel: goal.user?.displayName ?? null,
      user: goal.user,
      children: [...strategyNodes, ...projectNodes]
    };
  });
}

function filterTree(
  node: HierarchyNode,
  query: string,
  visibleLevels: HierarchyKind[],
  selectedUserIds: string[]
): HierarchyNode | null {
  const normalizedQuery = normalize(query);
  const children = (node.children ?? [])
    .map((child) => filterTree(child, query, visibleLevels, selectedUserIds))
    .filter((child): child is HierarchyNode => child !== null);
  const queryMatch =
    normalizedQuery.length === 0 ||
    normalize(`${node.label} ${node.description} ${node.statusLabel ?? ""}`).includes(
      normalizedQuery
    );
  const userMatch =
    selectedUserIds.length === 0 ||
    (node.user ? selectedUserIds.includes(node.user.id) : false);
  const levelVisible =
    node.kind === "goal" ||
    node.kind === "strategy" ||
    visibleLevels.includes(node.kind);
  if ((queryMatch && userMatch && levelVisible) || children.length > 0) {
    return {
      ...node,
      children
    };
  }
  return null;
}

export function ProjectManagementHierarchyPage() {
  const shell = useForgeShell();
  const [query, setQuery] = useState("");
  const [visibleLevels, setVisibleLevels] =
    useState<HierarchyKind[]>(DEFAULT_VISIBLE_LEVELS);
  const hierarchyQuery = useQuery({
    queryKey: ["work-items-hierarchy", ...shell.selectedUserIds],
    queryFn: () =>
      getWorkItemsHierarchy({
        userIds: shell.selectedUserIds
      })
  });

  const hierarchy = useMemo(() => {
    if (hierarchyQuery.data) {
      return buildHierarchyTree(hierarchyQuery.data);
    }
    return buildHierarchyTree({
      goals: shell.snapshot.goals,
      strategies: shell.snapshot.strategies,
      projects: shell.snapshot.projects,
      workItems:
        shell.snapshot.workItems && shell.snapshot.workItems.length > 0
          ? shell.snapshot.workItems
          : shell.snapshot.tasks
    });
  }, [hierarchyQuery.data, shell.snapshot]);

  const filteredTree = useMemo(
    () =>
      hierarchy
        .map((node) =>
          filterTree(node, query, visibleLevels, shell.selectedUserIds)
        )
        .filter((node): node is HierarchyNode => node !== null),
    [hierarchy, query, shell.selectedUserIds, visibleLevels]
  );

  if (hierarchyQuery.isLoading && hierarchy.length === 0) {
    return (
      <LoadingState
        eyebrow="Hierarchy"
        title="Building Forge hierarchy"
        description="Loading goals, strategies, projects, issues, tasks, and subtasks into the compact hierarchy view."
      />
    );
  }

  if (hierarchyQuery.isError && hierarchy.length === 0) {
    return (
      <ErrorState
        eyebrow="Hierarchy"
        error={hierarchyQuery.error}
        onRetry={() => void hierarchyQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <ProjectManagementSectionNav />
      <PageHero
        title="Hierarchy"
        description="Explore the full Forge execution stack from goals down to subtasks, with both strategy layers kept visible in the same compact tree."
        badge={`${filteredTree.length} top-level goals`}
      />

      <Card className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search goals, strategies, projects, issues, tasks, and subtasks"
          />
          <div className="flex flex-wrap gap-2">
            {(["project", "issue", "task", "subtask"] as HierarchyKind[]).map(
              (level) => {
                const selected = visibleLevels.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    className={selected
                      ? "rounded-full border border-sky-300/30 bg-sky-400/14 px-3 py-2 text-xs uppercase tracking-[0.16em] text-sky-100"
                      : "rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs uppercase tracking-[0.16em] text-white/62"}
                    onClick={() =>
                      setVisibleLevels((current) =>
                        current.includes(level)
                          ? current.filter((entry) => entry !== level)
                          : [...current, level]
                      )
                    }
                  >
                    {level}
                  </button>
                );
              }
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,20,31,0.96),rgba(9,15,24,0.96))] p-2">
          <Tree<HierarchyNode>
            data={filteredTree}
            width="100%"
            height={720}
            rowHeight={58}
            overscanCount={8}
            childrenAccessor={(node) => node.children ?? null}
            openByDefault={false}
            paddingTop={8}
            paddingBottom={8}
            disableDrag
            className="text-sm"
          >
            {({ node, style, dragHandle }) => (
              <div
                ref={dragHandle}
                style={style}
                className="group flex items-center gap-3 rounded-[18px] border border-white/6 bg-white/[0.03] px-3 py-2 text-white/78 transition hover:border-white/10 hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Badge className="bg-white/[0.08] text-white/68">
                    {node.data.kind}
                  </Badge>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {node.data.label}
                    </div>
                    <div className="truncate text-xs text-white/46">
                      {node.data.statusLabel ?? node.data.description}
                    </div>
                  </div>
                </div>
                {node.data.user ? <UserBadge user={node.data.user} compact /> : null}
                {node.data.href ? (
                  <Link
                    to={node.data.href}
                    className="text-xs uppercase tracking-[0.16em] text-sky-100/80 transition hover:text-sky-100"
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            )}
          </Tree>
        </div>
      </Card>
    </div>
  );
}
