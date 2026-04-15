import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Tree } from "react-arborist";
import { Link } from "react-router-dom";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { ProjectManagementSectionNav } from "@/components/projects/project-management-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { useForgeShell } from "@/components/shell/app-shell";
import { getWorkItemsHierarchy } from "@/lib/api";
import { getEntityVisual } from "@/lib/entity-visuals";
import type {
  Goal,
  ProjectSummary,
  Strategy,
  UserSummary,
  WorkItem
} from "@/lib/types";
import { cn } from "@/lib/utils";

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
  searchText: string;
  href: string | null;
  statusLabel: string | null;
  executionMode: WorkItem["executionMode"] | null;
  goalId: string | null;
  projectId: string | null;
  tagIds: string[];
  user: WorkItem["user"] | ProjectSummary["user"] | Goal["user"] | Strategy["user"];
  assignees: UserSummary[];
  linkedUserIds: string[];
  progressPercent: number | null;
  progressLabel: string | null;
  children?: HierarchyNode[];
};

const OWNER_FILTER_PREFIX = {
  user: "user:",
  kind: "kind:"
} as const;

type HierarchySearchClauseKind = HierarchyKind | "any";

type HierarchySearchClause = {
  id: string;
  query: string;
  kind: HierarchySearchClauseKind;
};

type HierarchySearchSuggestion = {
  id: string;
  query: string;
  kind: HierarchySearchClauseKind;
};

const HIERARCHY_KINDS: HierarchyKind[] = [
  "goal",
  "strategy",
  "project",
  "issue",
  "task",
  "subtask"
];

const DEFAULT_VISIBLE_LEVELS: HierarchyKind[] = [...HIERARCHY_KINDS];

const DEFAULT_STATUS_FILTERS = [
  "active",
  "paused",
  "completed",
  "backlog",
  "focus",
  "in_progress",
  "blocked",
  "done"
] as const;

type HierarchyStateFilter = (typeof DEFAULT_STATUS_FILTERS)[number];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function parseOwnerFilterValues(values: string[]) {
  return values.reduce(
    (accumulator, value) => {
      if (value.startsWith(OWNER_FILTER_PREFIX.user)) {
        accumulator.userIds.push(value.slice(OWNER_FILTER_PREFIX.user.length));
      } else if (value.startsWith(OWNER_FILTER_PREFIX.kind)) {
        const kind = value.slice(OWNER_FILTER_PREFIX.kind.length);
        if (kind === "human" || kind === "bot") {
          accumulator.kinds.push(kind);
        }
      }
      return accumulator;
    },
    {
      userIds: [] as string[],
      kinds: [] as Array<UserSummary["kind"]>
    }
  );
}

function buildClauseId(query: string, kind: HierarchySearchClauseKind) {
  return `${kind}:${normalize(query)}`;
}

function createSearchSuggestions(query: string): HierarchySearchSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return (["any", ...HIERARCHY_KINDS] as HierarchySearchClauseKind[]).map(
    (kind) => ({
      id: buildClauseId(trimmed, kind),
      query: trimmed,
      kind
    })
  );
}

function statusToProgress(statusLabel: string | null) {
  switch (statusLabel) {
    case "done":
    case "completed":
      return 1;
    case "in_progress":
    case "active":
      return 0.66;
    case "focus":
      return 0.45;
    case "blocked":
      return 0.5;
    case "paused":
      return 0.28;
    default:
      return 0.08;
  }
}

function compactDescription(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return fallback;
  }
  return cleaned;
}

function decorateProgress(node: HierarchyNode): HierarchyNode {
  const children = (node.children ?? []).map(decorateProgress);

  if (node.kind === "project") {
    return {
      ...node,
      children,
      progressPercent: node.progressPercent,
      progressLabel:
        node.progressLabel ??
        (typeof node.progressPercent === "number"
          ? `${node.progressPercent}% complete`
          : null)
    };
  }

  if (children.length > 0) {
    const childPercents = children
      .map((child) => child.progressPercent)
      .filter((value): value is number => typeof value === "number");
    if (childPercents.length > 0) {
      const average = Math.round(
        childPercents.reduce((sum, value) => sum + value, 0) /
          childPercents.length
      );
      return {
        ...node,
        children,
        progressPercent: average,
        progressLabel: `${children.length} child item${
          children.length === 1 ? "" : "s"
        }`
      };
    }
  }

  const progressPercent = Math.round(statusToProgress(node.statusLabel) * 100);
  return {
    ...node,
    children,
    progressPercent,
    progressLabel: node.statusLabel ? node.statusLabel.replaceAll("_", " ") : null
  };
}

function buildHierarchyTree(options: {
  goals: Goal[];
  strategies: Strategy[];
  projects: ProjectSummary[];
  workItems: WorkItem[];
  tagNameById: Map<string, string>;
}): HierarchyNode[] {
  const { goals, strategies, projects, workItems, tagNameById } = options;
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

  const mapWorkItem = (item: WorkItem): HierarchyNode =>
    decorateProgress({
      id: `${item.level}:${item.id}`,
      entityId: item.id,
      kind: item.level,
      label: item.title,
      description: compactDescription(
        item.description,
        item.level === "issue"
          ? "Vertical slice issue"
          : item.level === "subtask"
            ? "Granular child step"
          : "Focused AI session task"
      ),
      searchText: normalize(
        [
          item.title,
          item.description,
          item.aiInstructions,
          item.executionMode ?? "",
          item.status,
          item.user?.displayName ?? "",
          ...(item.assignees ?? []).map((user) => user.displayName),
          ...item.tagIds.map((tagId) => tagNameById.get(tagId) ?? "")
        ].join(" ")
      ),
      href: `/tasks/${item.id}`,
      statusLabel: item.status,
      executionMode: item.executionMode,
      goalId: item.goalId,
      projectId: item.projectId,
      tagIds: item.tagIds,
      user: item.user,
      assignees: item.assignees ?? [],
      linkedUserIds: [
        ...(item.user ? [item.user.id] : []),
        ...(item.assigneeUserIds ?? [])
      ],
      progressPercent: null,
      progressLabel: null,
      children: (workItemsByParentId.get(item.id) ?? []).map(mapWorkItem)
    });

  const buildProjectNode = (project: ProjectSummary): HierarchyNode => {
    const lowerStrategies = strategies.filter((strategy) =>
      strategy.targetProjectIds.includes(project.id)
    );

    return decorateProgress({
      id: `project:${project.id}`,
      entityId: project.id,
      kind: "project",
      label: project.title,
      description: compactDescription(
        project.description || project.productRequirementsDocument,
        "PRD-backed initiative"
      ),
      searchText: normalize(
        [
          project.title,
          project.description,
          project.productRequirementsDocument,
          project.goalTitle,
          project.workflowStatus,
          project.status,
          project.user?.displayName ?? "",
          ...(project.assignees ?? []).map((user) => user.displayName)
        ].join(" ")
      ),
      href: `/projects/${project.id}`,
      statusLabel: project.workflowStatus,
      executionMode: null,
      goalId: project.goalId,
      projectId: project.id,
      tagIds: [],
      user: project.user,
      assignees: project.assignees ?? [],
      linkedUserIds: [
        ...(project.user ? [project.user.id] : []),
        ...(project.assigneeUserIds ?? [])
      ],
      progressPercent: project.progress,
      progressLabel: `${project.completedTaskCount}/${project.totalTasks} done`,
      children: [
        ...lowerStrategies.map((strategy) =>
          decorateProgress({
            id: `strategy:${strategy.id}`,
            entityId: strategy.id,
            kind: "strategy",
            label: strategy.title,
            description: compactDescription(
              strategy.overview || strategy.endStateDescription,
              "Execution strategy"
            ),
            searchText: normalize(
              [
                strategy.title,
                strategy.overview,
                strategy.endStateDescription,
                strategy.status,
                strategy.user?.displayName ?? ""
              ].join(" ")
            ),
            href: `/strategies/${strategy.id}`,
            statusLabel: strategy.status,
            executionMode: null,
            goalId: project.goalId,
            projectId: project.id,
            tagIds: [],
            user: strategy.user,
            assignees: [],
            linkedUserIds: strategy.user ? [strategy.user.id] : [],
            progressPercent: null,
            progressLabel: null,
            children: []
          })
        ),
        ...(issuesByProjectId.get(project.id) ?? []).map(mapWorkItem),
        ...(rootWorkItemsByProjectId.get(project.id) ?? []).map(mapWorkItem)
      ]
    });
  };

  return goals.map((goal) => {
    const goalProjects = projects.filter((project) => project.goalId === goal.id);
    const goalStrategies = strategies.filter((strategy) =>
      strategy.targetGoalIds.includes(goal.id)
    );
    const projectByStrategyId = new Map<string, ProjectSummary[]>(
      goalStrategies.map((strategy) => [strategy.id, []])
    );
    const explicitlyNestedProjectIds = new Set<string>();

    for (const project of goalProjects) {
      const firstMatchingStrategy = goalStrategies.find((strategy) =>
        strategy.targetProjectIds.includes(project.id)
      );
      if (!firstMatchingStrategy) {
        continue;
      }
      projectByStrategyId.get(firstMatchingStrategy.id)?.push(project);
      explicitlyNestedProjectIds.add(project.id);
    }

    const strategyNodes = goalStrategies.map((strategy) =>
      decorateProgress({
        id: `strategy:${strategy.id}`,
        entityId: strategy.id,
        kind: "strategy",
        label: strategy.title,
        description: compactDescription(
          strategy.overview || strategy.endStateDescription,
          "High-level strategy"
        ),
        searchText: normalize(
          [
            strategy.title,
            strategy.overview,
            strategy.endStateDescription,
            strategy.status,
            strategy.user?.displayName ?? ""
          ].join(" ")
        ),
        href: `/strategies/${strategy.id}`,
        statusLabel: strategy.status,
        executionMode: null,
        goalId: goal.id,
        projectId: null,
        tagIds: [],
        user: strategy.user,
        assignees: [],
        linkedUserIds: strategy.user ? [strategy.user.id] : [],
        progressPercent: null,
        progressLabel: null,
        children: (projectByStrategyId.get(strategy.id) ?? []).map(
          buildProjectNode
        )
      })
    );

    const projectNodes = goalProjects
      .filter((project) => !explicitlyNestedProjectIds.has(project.id))
      .map(buildProjectNode);

    return decorateProgress({
      id: `goal:${goal.id}`,
      entityId: goal.id,
      kind: "goal",
      label: goal.title,
      description: compactDescription(goal.description, "Strategic goal"),
      searchText: normalize(
        [goal.title, goal.description, goal.status, goal.user?.displayName ?? ""].join(
          " "
        )
      ),
      href: `/goals/${goal.id}`,
      statusLabel: goal.status,
      executionMode: null,
      goalId: goal.id,
      projectId: null,
      tagIds: goal.tagIds,
      user: goal.user,
      assignees: [],
      linkedUserIds: goal.user ? [goal.user.id] : [],
      progressPercent: null,
      progressLabel: null,
      children: [...strategyNodes, ...projectNodes]
    });
  });
}

function countVisibleNodes(nodes: HierarchyNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + 1 + countVisibleNodes(node.children ?? []),
    0
  );
}

function clauseMatchesNode(
  node: HierarchyNode,
  clause: HierarchySearchClause
) {
  return (
    node.searchText.includes(normalize(clause.query)) &&
    (clause.kind === "any" || clause.kind === node.kind)
  );
}

function filterTree(
  node: HierarchyNode,
  options: {
    clauses: HierarchySearchClause[];
    statusFilters: HierarchyStateFilter[];
    ownerUserIds: string[];
    ownerKinds: Array<UserSummary["kind"]>;
    selectedUserIds: string[];
  },
  inheritedClauseMatch = false
): HierarchyNode | null {
  const {
    clauses,
    statusFilters,
    ownerUserIds,
    ownerKinds,
    selectedUserIds
  } = options;
  const selfClauseMatch =
    clauses.length === 0 || clauses.some((clause) => clauseMatchesNode(node, clause));
  const statusMatch =
    statusFilters.length === 0 ||
    (node.statusLabel !== null &&
      statusFilters.includes(node.statusLabel as HierarchyStateFilter));
  const explicitUserMatch =
    ownerUserIds.length === 0 &&
    selectedUserIds.length === 0
      ? true
      : [...ownerUserIds, ...selectedUserIds].some((userId) =>
          node.linkedUserIds.includes(userId)
        );
  const kindMatch =
    ownerKinds.length === 0 ||
    [node.user, ...node.assignees].some(
      (user) => user && ownerKinds.includes(user.kind)
    );
  const selfStructuralMatch = statusMatch && explicitUserMatch && kindMatch;
  const clauseGatePassed =
    clauses.length === 0 || inheritedClauseMatch || selfClauseMatch;

  const children = (node.children ?? [])
    .map((child) =>
      filterTree(
        child,
        options,
        inheritedClauseMatch || (selfStructuralMatch && selfClauseMatch)
      )
    )
    .filter((child): child is HierarchyNode => child !== null);

  if ((selfStructuralMatch && clauseGatePassed) || children.length > 0) {
    return {
      ...node,
      children
    };
  }

  return null;
}

function flattenHiddenLevels(
  nodes: HierarchyNode[],
  visibleLevels: HierarchyKind[]
): HierarchyNode[] {
  return nodes.flatMap((node) => {
    const children = flattenHiddenLevels(node.children ?? [], visibleLevels);
    if (visibleLevels.includes(node.kind)) {
      return [
        {
          ...node,
          children
        }
      ];
    }
    return children;
  });
}

function hierarchyBadgeClass(kind: HierarchyKind) {
  switch (kind) {
    case "goal":
      return "bg-amber-400/12 text-amber-100";
    case "strategy":
      return "bg-cyan-400/12 text-cyan-100";
    case "project":
      return "bg-sky-400/12 text-sky-100";
    case "issue":
      return "bg-orange-400/12 text-orange-100";
    case "subtask":
      return "border-indigo-300/18 bg-indigo-400/12 text-indigo-100";
    default:
      return "bg-indigo-400/12 text-indigo-100";
  }
}

function statusBadgeClass(statusLabel: string | null) {
  switch (statusLabel) {
    case "done":
    case "completed":
      return "bg-emerald-400/12 text-emerald-100";
    case "blocked":
      return "bg-rose-400/12 text-rose-100";
    case "in_progress":
    case "active":
      return "bg-sky-400/12 text-sky-100";
    case "focus":
      return "bg-violet-400/12 text-violet-100";
    default:
      return "bg-white/[0.08] text-white/70";
  }
}

function renderHierarchyClauseBadge(kind: HierarchySearchClauseKind) {
  if (kind === "any") {
    return <Badge className="bg-white/[0.08] text-white/76">Any</Badge>;
  }
  if (kind === "subtask") {
    return (
      <EntityBadge
        kind="task"
        label="Subtask"
        compact
        gradient={false}
        className="border-indigo-300/18 bg-indigo-400/12 text-indigo-100"
      />
    );
  }
  return (
    <EntityBadge
      kind={kind === "issue" ? "issue" : kind}
      label={kind}
      compact
      gradient={false}
    />
  );
}

function HierarchySearchBar({
  query,
  onQueryChange,
  clauses,
  onClausesChange,
  resultSummary
}: {
  query: string;
  onQueryChange: (value: string) => void;
  clauses: HierarchySearchClause[];
  onClausesChange: (value: HierarchySearchClause[]) => void;
  resultSummary: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const suggestions = useMemo(
    () =>
      createSearchSuggestions(query).filter(
        (suggestion) =>
          !clauses.some((clause) => clause.id === suggestion.id)
      ),
    [clauses, query]
  );

  const addClause = (suggestion: HierarchySearchSuggestion) => {
    onClausesChange([...clauses, suggestion]);
    onQueryChange("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeClause = (clauseId: string) => {
    onClausesChange(clauses.filter((clause) => clause.id !== clauseId));
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(135deg,rgba(19,28,48,0.9),rgba(10,14,26,0.98))] p-4 shadow-[0_30px_80px_rgba(3,8,18,0.28)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Hierarchy search
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
              Build OR clauses like <span className="text-white">Goal + "MD"</span> or <span className="text-white">Any + "Happy"</span>. Matching ancestors keep their branches visible so you can explore the hierarchy, not lose it.
            </div>
          </div>
          {clauses.length > 0 || query.trim().length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onQueryChange("");
                onClausesChange([]);
                setHighlightedIndex(0);
                setOpen(false);
              }}
            >
              Clear search
            </Button>
          ) : null}
        </div>

        <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-3">
          {clauses.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {clauses.map((clause) => (
                <span
                  key={clause.id}
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5"
                >
                  {renderHierarchyClauseBadge(clause.kind)}
                  <span className="max-w-[14rem] truncate text-sm text-white/78">
                    "{clause.query}"
                  </span>
                  <button
                    type="button"
                    className="rounded-full text-white/52 transition hover:text-white"
                    onClick={() => removeClause(clause.id)}
                    aria-label={`Remove ${clause.kind} ${clause.query}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="relative">
            <div className="flex items-center gap-3">
              <Search className="size-4 text-white/36" />
              <input
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                  setOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !query && clauses.length > 0) {
                    removeClause(clauses[clauses.length - 1]!.id);
                    return;
                  }

                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setOpen(true);
                    setHighlightedIndex((current) =>
                      suggestions.length === 0
                        ? 0
                        : Math.min(suggestions.length - 1, current + 1)
                    );
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlightedIndex((current) => Math.max(0, current - 1));
                    return;
                  }

                  if (event.key === "Escape") {
                    setOpen(false);
                    return;
                  }

                  if (event.key === "Enter" && suggestions[highlightedIndex]) {
                    event.preventDefault();
                    addClause(suggestions[highlightedIndex]!);
                  }
                }}
                placeholder='Type text, then pick a clause like Goal + "MD" or Any + "Happy"'
                className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
              />
            </div>

            {open ? (
              <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-white/8 bg-[rgba(8,13,24,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
                {suggestions.length > 0 ? (
                  suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                        index === highlightedIndex
                          ? "bg-white/[0.1] text-white"
                          : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addClause(suggestion)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {renderHierarchyClauseBadge(suggestion.kind)}
                          <span className="truncate text-sm font-medium text-white">
                            "{suggestion.query}"
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-white/46">
                          Match {suggestion.kind === "any" ? "any visible hierarchy node" : `${suggestion.kind} nodes`} that mention this text.
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5 text-sm text-white/42">
                    Type a word or phrase to create a new OR clause.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 text-sm text-white/52">{resultSummary}</div>
      </div>
    </div>
  );
}

export function ProjectManagementHierarchyPage() {
  const shell = useForgeShell();
  const treeRef = useRef<any>(null);
  const [query, setQuery] = useState("");
  const [searchClauses, setSearchClauses] = useState<HierarchySearchClause[]>(
    []
  );
  const [selectedOwnerFilterIds, setSelectedOwnerFilterIds] = useState<
    string[]
  >([]);
  const [selectedStatusFilters, setSelectedStatusFilters] = useState<
    HierarchyStateFilter[]
  >([...DEFAULT_STATUS_FILTERS]);
  const [visibleLevels, setVisibleLevels] =
    useState<HierarchyKind[]>(DEFAULT_VISIBLE_LEVELS);

  const hierarchyQuery = useQuery({
    queryKey: ["work-items-hierarchy", ...shell.selectedUserIds],
    queryFn: () =>
      getWorkItemsHierarchy({
        userIds: shell.selectedUserIds
      })
  });

  const ownerFilterOptions = useMemo<EntityLinkOption[]>(() => {
    const bots = shell.snapshot.users.filter((user) => user.kind === "bot");
    const humans = shell.snapshot.users.filter((user) => user.kind === "human");

    return [
      {
        value: `${OWNER_FILTER_PREFIX.kind}bot`,
        label: "Bots",
        description: `${bots.length} bot collaborators`,
        searchText: `bots bot ai agents assistants ${bots.map((user) => `${user.displayName} ${user.handle}`).join(" ")}`,
        badge: (
          <Badge className="border-cyan-300/18 bg-cyan-400/12 text-cyan-50">
            Bots
          </Badge>
        ),
        menuBadge: (
          <Badge className="border-cyan-300/18 bg-cyan-400/12 text-cyan-50">
            Bots
          </Badge>
        )
      },
      {
        value: `${OWNER_FILTER_PREFIX.kind}human`,
        label: "Humans",
        description: `${humans.length} human collaborators`,
        searchText: `humans human people operators ${humans.map((user) => `${user.displayName} ${user.handle}`).join(" ")}`,
        badge: (
          <Badge className="border-amber-300/18 bg-amber-400/12 text-amber-50">
            Humans
          </Badge>
        ),
        menuBadge: (
          <Badge className="border-amber-300/18 bg-amber-400/12 text-amber-50">
            Humans
          </Badge>
        )
      },
      ...shell.snapshot.users.map((user) => ({
        value: `${OWNER_FILTER_PREFIX.user}${user.id}`,
        label: user.displayName,
        description: `${user.kind}${user.handle ? ` · @${user.handle}` : ""}`,
        searchText: `${user.displayName} ${user.handle} ${user.kind} ${user.description}`,
        badge: <UserBadge user={user} compact />,
        menuBadge: <UserBadge user={user} compact />
      }))
    ];
  }, [shell.snapshot.users]);

  const levelFilterOptions = useMemo<EntityLinkOption[]>(
    () => [
      {
        value: "goal",
        label: "Goal",
        searchText: "goal direction objective",
        kind: "goal"
      },
      {
        value: "strategy",
        label: "Strategy",
        searchText: "strategy plan sequencing",
        kind: "strategy"
      },
      {
        value: "project",
        label: "Project",
        searchText: "project initiative prd",
        kind: "project"
      },
      {
        value: "issue",
        label: "Issue",
        searchText: "issue vertical slice tracer bullet",
        kind: "issue"
      },
      {
        value: "task",
        label: "Task",
        searchText: "task execution ai session",
        kind: "task"
      },
      {
        value: "subtask",
        label: "Subtask",
        searchText: "subtask child step",
        badge: (
          <EntityBadge
            kind="task"
            label="Subtask"
            compact
            gradient={false}
            className="border-indigo-300/18 bg-indigo-400/12 text-indigo-100"
          />
        ),
        menuBadge: (
          <EntityBadge
            kind="task"
            label="Subtask"
            compact
            gradient={false}
            className="border-indigo-300/18 bg-indigo-400/12 text-indigo-100"
          />
        )
      }
    ],
    []
  );

  const statusFilterOptions = useMemo<EntityLinkOption[]>(
    () => [
      {
        value: "active",
        label: "Active",
        searchText: "active in progress live"
      },
      {
        value: "paused",
        label: "Paused",
        searchText: "paused suspended"
      },
      {
        value: "completed",
        label: "Completed",
        searchText: "completed finished"
      },
      {
        value: "backlog",
        label: "Backlog",
        searchText: "backlog queued"
      },
      {
        value: "focus",
        label: "Focus",
        searchText: "focus ready"
      },
      {
        value: "in_progress",
        label: "In progress",
        searchText: "in progress active doing"
      },
      {
        value: "blocked",
        label: "Blocked",
        searchText: "blocked stuck"
      },
      {
        value: "done",
        label: "Done",
        searchText: "done complete finished"
      }
    ].map((option) => ({
      ...option,
      badge: (
        <Badge className={statusBadgeClass(option.value)}>
          {option.label}
        </Badge>
      ),
      menuBadge: (
        <Badge className={statusBadgeClass(option.value)}>
          {option.label}
        </Badge>
      )
    })),
    []
  );

  const tagNameById = useMemo(
    () => new Map(shell.snapshot.tags.map((tag) => [tag.id, tag.name] as const)),
    [shell.snapshot.tags]
  );

  const hierarchy = useMemo(() => {
    if (hierarchyQuery.data) {
      return buildHierarchyTree({
        ...hierarchyQuery.data,
        tagNameById
      });
    }
    return buildHierarchyTree({
      goals: shell.snapshot.goals,
      strategies: shell.snapshot.strategies,
      projects: shell.snapshot.dashboard.projects,
      tagNameById,
      workItems:
        shell.snapshot.workItems && shell.snapshot.workItems.length > 0
          ? shell.snapshot.workItems
          : shell.snapshot.tasks
    });
  }, [hierarchyQuery.data, shell.snapshot, tagNameById]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    searchClauses.length > 0 ||
    selectedOwnerFilterIds.length > 0 ||
    selectedStatusFilters.length !== DEFAULT_STATUS_FILTERS.length ||
    DEFAULT_STATUS_FILTERS.some(
      (status) => !selectedStatusFilters.includes(status)
    ) ||
    visibleLevels.length !== DEFAULT_VISIBLE_LEVELS.length ||
    DEFAULT_VISIBLE_LEVELS.some((level) => !visibleLevels.includes(level));

  const parsedOwnerFilters = useMemo(
    () => parseOwnerFilterValues(selectedOwnerFilterIds),
    [selectedOwnerFilterIds]
  );

  const filteredTree = useMemo(() => {
    const structured = hierarchy
      .map((node) =>
        filterTree(node, {
          clauses: searchClauses,
          statusFilters: selectedStatusFilters,
          ownerUserIds: parsedOwnerFilters.userIds,
          ownerKinds: parsedOwnerFilters.kinds,
          selectedUserIds: shell.selectedUserIds
        })
      )
      .filter((node): node is HierarchyNode => node !== null);

    return flattenHiddenLevels(structured, visibleLevels);
  }, [
    hierarchy,
    parsedOwnerFilters.kinds,
    parsedOwnerFilters.userIds,
    searchClauses,
    selectedStatusFilters,
    shell.selectedUserIds,
    visibleLevels
  ]);

  const visibleNodeCount = useMemo(
    () => countVisibleNodes(filteredTree),
    [filteredTree]
  );

  const resultSummary = `${
    searchClauses.length > 0 ? `${searchClauses.length} OR clause${searchClauses.length === 1 ? "" : "s"} active` : "Search across the full hierarchy"
  } · ${visibleNodeCount} visible node${visibleNodeCount === 1 ? "" : "s"}.`;

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
        description="Explore the full Forge stack from goal to subtask in one compact operational tree, with both strategy layers visible and the same control surfaces as the board."
        badge={`${visibleNodeCount} visible nodes`}
      />

      <Card className="min-w-0 overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(16,23,38,0.92),rgba(9,14,24,0.98))]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
              Hierarchy controls
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
              Filter across goals, projects, tags, humans, bots, and work-item
              types, then expand or collapse the full tree without losing the
              hierarchy context.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => treeRef.current?.openAll?.()}
            >
              Expand all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => treeRef.current?.closeAll?.()}
            >
              Collapse all
            </Button>
            {hasActiveFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setSearchClauses([]);
                  setSelectedOwnerFilterIds([]);
                  setSelectedStatusFilters([...DEFAULT_STATUS_FILTERS]);
                  setVisibleLevels(DEFAULT_VISIBLE_LEVELS);
                }}
              >
                Reset
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5">
          <HierarchySearchBar
            query={query}
            onQueryChange={setQuery}
            clauses={searchClauses}
            onClausesChange={setSearchClauses}
            resultSummary={resultSummary}
          />

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <EntityLinkMultiSelect
              options={statusFilterOptions}
              selectedValues={selectedStatusFilters as string[]}
              onChange={(values) =>
                setSelectedStatusFilters(values as HierarchyStateFilter[])
              }
              placeholder="Visible states"
              emptyMessage="No states available."
              variant="action-bar"
            />
            <EntityLinkMultiSelect
              options={levelFilterOptions}
              selectedValues={visibleLevels}
              onChange={(values) =>
                setVisibleLevels(values as HierarchyKind[])
              }
              placeholder="Visible levels"
              emptyMessage="No hierarchy levels."
              className="min-w-0"
              variant="action-bar"
            />
            <EntityLinkMultiSelect
              options={ownerFilterOptions}
              selectedValues={selectedOwnerFilterIds}
              onChange={setSelectedOwnerFilterIds}
              placeholder="Filter by human, bot, or collaborator"
              emptyMessage="No matching collaborators."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/72">
              {filteredTree.length} top-level nodes
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {visibleNodeCount} visible nodes
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {visibleLevels.join(" + ")}
            </Badge>
          </div>
        </div>
      </Card>

      {filteredTree.length === 0 ? (
        <EmptyState
          eyebrow="Hierarchy"
          title="No hierarchy nodes match the current filters"
          description="Clear some filters or broaden the search to bring the full planning ladder back into view."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setSearchClauses([]);
                setSelectedOwnerFilterIds([]);
                setSelectedStatusFilters([...DEFAULT_STATUS_FILTERS]);
                setVisibleLevels(DEFAULT_VISIBLE_LEVELS);
              }}
            >
              Reset hierarchy filters
            </Button>
          }
        />
      ) : (
        <Card className="min-w-0 overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(13,20,31,0.96),rgba(9,15,24,0.98))] p-0">
          <div className="grid grid-cols-[minmax(0,1.8fr)_auto_auto_auto] gap-3 border-b border-white/8 px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-white/38">
            <div>Name</div>
            <div className="hidden lg:block">State</div>
            <div className="hidden xl:block">People</div>
            <div className="hidden lg:block">Progress</div>
          </div>

          <div className="p-2">
            <Tree<HierarchyNode>
              ref={treeRef}
              data={filteredTree}
              width="100%"
              height={760}
              rowHeight={64}
              overscanCount={10}
              childrenAccessor={(node) => node.children ?? null}
              openByDefault
              paddingTop={8}
              paddingBottom={8}
              disableDrag
              className="text-sm"
            >
              {({ node, style }) => {
                const visualKind =
                  node.data.kind === "subtask"
                    ? "task"
                    : (node.data.kind as "goal" | "strategy" | "project" | "issue" | "task");
                const visual = getEntityVisual(visualKind);
                const accent = visual.colorToken.rgb.join(", ");

                return (
                  <div style={style} className="px-2 py-1.5">
                    <div
                      className={cn(
                        "grid min-w-0 items-center gap-3 rounded-[16px] border border-white/8 px-3 py-2 transition hover:border-white/14 hover:bg-white/[0.05]",
                        "grid-cols-[minmax(0,1.8fr)_auto] lg:grid-cols-[minmax(0,1.8fr)_auto_auto] xl:grid-cols-[minmax(0,1.8fr)_auto_auto_auto]"
                      )}
                      style={{
                        marginLeft: `${node.level * 14}px`,
                        background:
                          `linear-gradient(180deg, rgba(${accent}, 0.07), rgba(255,255,255,0.02))`
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          type="button"
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/62 transition hover:bg-white/[0.1] hover:text-white"
                          onClick={() => node.toggle()}
                          disabled={node.isLeaf}
                          aria-label={
                            node.isOpen
                              ? `Collapse ${node.data.label}`
                              : `Expand ${node.data.label}`
                          }
                        >
                          {node.isLeaf ? (
                            <span className="size-2 rounded-full bg-white/22" />
                          ) : node.isOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>

                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border",
                            visual.subtleBadgeClassName
                          )}
                        >
                          <visual.icon className={cn("size-4", visual.iconClassName)} />
                        </span>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={hierarchyBadgeClass(node.data.kind)}>
                              {node.data.kind}
                            </Badge>
                            {node.data.executionMode ? (
                              <Badge
                                className={
                                  node.data.executionMode === "afk"
                                    ? "bg-emerald-400/12 text-emerald-100"
                                    : "bg-amber-400/12 text-amber-100"
                                }
                              >
                                {node.data.executionMode.toUpperCase()}
                              </Badge>
                            ) : null}
                            <div className="truncate text-[13px] font-medium text-white">
                              {node.data.label}
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] leading-5 text-white/46">
                            {node.data.description}
                          </div>
                        </div>
                      </div>

                      <div className="hidden lg:flex justify-end">
                        <Badge className={statusBadgeClass(node.data.statusLabel)}>
                          {node.data.statusLabel
                            ? node.data.statusLabel.replaceAll("_", " ")
                            : "linked"}
                        </Badge>
                      </div>

                      <div className="hidden xl:flex items-center justify-end gap-2">
                        {node.data.user ? <UserBadge user={node.data.user} compact /> : null}
                        {node.data.assignees.length > 0 ? (
                          <Badge className="bg-white/[0.08] text-white/72">
                            +{node.data.assignees.length}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="hidden lg:flex min-w-[11rem] items-center justify-end gap-3">
                        <div className="min-w-[7.5rem]">
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${node.data.progressPercent ?? 0}%`,
                                background: `linear-gradient(90deg, rgba(${accent}, 0.96), rgba(${accent}, 0.72))`
                              }}
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-white/44">
                            {node.data.progressLabel ??
                              `${node.data.progressPercent ?? 0}% complete`}
                          </div>
                        </div>
                        {node.data.href ? (
                          <Link
                            to={node.data.href}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white/72 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
                          >
                            Open
                          </Link>
                        ) : (
                          <span className="w-[3.75rem]" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              }}
            </Tree>
          </div>
        </Card>
      )}
    </div>
  );
}
