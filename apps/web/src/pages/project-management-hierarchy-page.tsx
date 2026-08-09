import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Tree, type TreeApi } from "react-arborist";
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
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
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
  user:
    | WorkItem["user"]
    | ProjectSummary["user"]
    | Goal["user"]
    | Strategy["user"];
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

export const HIERARCHY_OPEN_STATE_STORAGE_KEY =
  "forge:project-hierarchy:open-state:v1";
const MAX_PERSISTED_HIERARCHY_NODES = 5_000;
const MAX_PERSISTED_HIERARCHY_CHARACTERS = 256_000;
const MAX_PERSISTED_HIERARCHY_ID_CHARACTERS = 256;

export type HierarchyOpenState = Record<string, boolean>;

function boundHierarchyOpenState(
  entries: Array<[string, unknown]>
): HierarchyOpenState {
  const bounded: HierarchyOpenState = {};
  let serializedCharacters = 2;
  let entryCount = 0;

  for (const [id, open] of entries) {
    if (
      id.length === 0 ||
      id.length > MAX_PERSISTED_HIERARCHY_ID_CHARACTERS ||
      typeof open !== "boolean"
    ) {
      continue;
    }
    const entryCharacters =
      (entryCount === 0 ? 0 : 1) +
      JSON.stringify(id).length +
      1 +
      (open ? 4 : 5);
    if (
      entryCount >= MAX_PERSISTED_HIERARCHY_NODES ||
      serializedCharacters + entryCharacters >
        MAX_PERSISTED_HIERARCHY_CHARACTERS
    ) {
      break;
    }
    bounded[id] = open;
    entryCount += 1;
    serializedCharacters += entryCharacters;
  }

  return bounded;
}

export function parseHierarchyOpenState(
  raw: string | null
): HierarchyOpenState {
  if (!raw || raw.length > MAX_PERSISTED_HIERARCHY_CHARACTERS) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return boundHierarchyOpenState(Object.entries(parsed));
  } catch {
    return {};
  }
}

export function serializeHierarchyOpenState(
  openState: HierarchyOpenState
): string {
  return JSON.stringify(boundHierarchyOpenState(Object.entries(openState)));
}

function readPersistedHierarchyOpenState(): HierarchyOpenState {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return parseHierarchyOpenState(
      window.localStorage.getItem(HIERARCHY_OPEN_STATE_STORAGE_KEY)
    );
  } catch {
    return {};
  }
}

function writePersistedHierarchyOpenState(openState: HierarchyOpenState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      HIERARCHY_OPEN_STATE_STORAGE_KEY,
      serializeHierarchyOpenState(openState)
    );
  } catch {
    // Storage can be unavailable or full. The in-memory tree remains usable.
  }
}

export function useHierarchyOpenStatePersistence(treeRef: {
  readonly current: { openState: HierarchyOpenState } | null;
}) {
  const [initialOpenState] = useState(readPersistedHierarchyOpenState);
  const pendingOpenStateRef = useRef<HierarchyOpenState | null>(null);
  const openStateTimerRef = useRef<number | null>(null);

  const flushOpenState = useCallback(() => {
    const pendingOpenState = pendingOpenStateRef.current;
    if (!pendingOpenState) {
      return;
    }
    writePersistedHierarchyOpenState(pendingOpenState);
    pendingOpenStateRef.current = null;
  }, []);

  const scheduleOpenStatePersistence = useCallback(() => {
    const nextOpenState = treeRef.current?.openState;
    if (!nextOpenState) {
      return;
    }
    pendingOpenStateRef.current = { ...nextOpenState };
    if (typeof window === "undefined") {
      return;
    }
    if (openStateTimerRef.current !== null) {
      window.clearTimeout(openStateTimerRef.current);
    }
    openStateTimerRef.current = window.setTimeout(() => {
      openStateTimerRef.current = null;
      flushOpenState();
    }, 50);
  }, [flushOpenState, treeRef]);

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && openStateTimerRef.current !== null) {
        window.clearTimeout(openStateTimerRef.current);
      }
      flushOpenState();
    },
    [flushOpenState]
  );

  return { initialOpenState, scheduleOpenStatePersistence };
}

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
    progressLabel: node.statusLabel
      ? node.statusLabel.replaceAll("_", " ")
      : null
  };
}

export function buildHierarchyTree(options: {
  goals: Goal[];
  strategies: Strategy[];
  projects: ProjectSummary[];
  workItems: WorkItem[];
  tagNameById: Map<string, string>;
}): HierarchyNode[] {
  const { goals, strategies, projects, workItems, tagNameById } = options;
  const workItemsByParentId = new Map<string, WorkItem[]>();
  const workItemsByProjectId = new Map<string, WorkItem[]>();
  const issuesByProjectId = new Map<string, WorkItem[]>();
  const rootWorkItemsByProjectId = new Map<string, WorkItem[]>();
  const projectsByGoalId = new Map<string, ProjectSummary[]>();
  const strategiesByGoalId = new Map<string, Strategy[]>();
  const strategiesByProjectId = new Map<string, Strategy[]>();

  for (const project of projects) {
    const current = projectsByGoalId.get(project.goalId) ?? [];
    current.push(project);
    projectsByGoalId.set(project.goalId, current);
  }

  for (const strategy of strategies) {
    for (const goalId of strategy.targetGoalIds) {
      const current = strategiesByGoalId.get(goalId) ?? [];
      current.push(strategy);
      strategiesByGoalId.set(goalId, current);
    }
    for (const projectId of strategy.targetProjectIds) {
      const current = strategiesByProjectId.get(projectId) ?? [];
      current.push(strategy);
      strategiesByProjectId.set(projectId, current);
    }
  }

  for (const item of workItems) {
    if (item.projectId) {
      const projectItems = workItemsByProjectId.get(item.projectId) ?? [];
      projectItems.push(item);
      workItemsByProjectId.set(item.projectId, projectItems);
    }
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

  const buildProjectNode = (project: ProjectSummary): HierarchyNode => {
    const lowerStrategies = strategiesByProjectId.get(project.id) ?? [];
    const renderedWorkItemIds = new Set<string>();
    const mapProjectWorkItem = (
      item: WorkItem,
      ancestry: Set<string> = new Set()
    ): HierarchyNode | null => {
      if (ancestry.has(item.id) || renderedWorkItemIds.has(item.id)) {
        return null;
      }
      renderedWorkItemIds.add(item.id);
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(item.id);
      const children = (workItemsByParentId.get(item.id) ?? [])
        .filter((child) => child.projectId === project.id)
        .map((child) => mapProjectWorkItem(child, nextAncestry))
        .filter((child): child is HierarchyNode => child !== null);

      return decorateProgress({
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
        children
      });
    };
    const primaryWorkItemNodes = [
      ...(issuesByProjectId.get(project.id) ?? []),
      ...(rootWorkItemsByProjectId.get(project.id) ?? [])
    ]
      .map((item) => mapProjectWorkItem(item))
      .filter((node): node is HierarchyNode => node !== null);
    const fallbackWorkItemNodes = (workItemsByProjectId.get(project.id) ?? [])
      .filter((item) => !renderedWorkItemIds.has(item.id))
      .map((item) => mapProjectWorkItem(item))
      .filter((node): node is HierarchyNode => node !== null);

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
        ...primaryWorkItemNodes,
        ...fallbackWorkItemNodes
      ]
    });
  };

  return goals.map((goal) => {
    const goalProjects = projectsByGoalId.get(goal.id) ?? [];
    const goalStrategies = strategiesByGoalId.get(goal.id) ?? [];
    const goalStrategyIds = new Set(
      goalStrategies.map((strategy) => strategy.id)
    );
    const projectByStrategyId = new Map<string, ProjectSummary[]>(
      goalStrategies.map((strategy) => [strategy.id, []])
    );
    const explicitlyNestedProjectIds = new Set<string>();

    for (const project of goalProjects) {
      const firstMatchingStrategy = (
        strategiesByProjectId.get(project.id) ?? []
      ).find((strategy) => goalStrategyIds.has(strategy.id));
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
        [
          goal.title,
          goal.description,
          goal.status,
          goal.user?.displayName ?? ""
        ].join(" ")
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

function clauseMatchesNode(node: HierarchyNode, clause: HierarchySearchClause) {
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
  const { clauses, statusFilters, ownerUserIds, ownerKinds, selectedUserIds } =
    options;
  const selfClauseMatch =
    clauses.length === 0 ||
    clauses.some((clause) => clauseMatchesNode(node, clause));
  const statusMatch =
    statusFilters.length === 0 ||
    (node.statusLabel !== null &&
      statusFilters.includes(node.statusLabel as HierarchyStateFilter));
  const explicitUserMatch =
    ownerUserIds.length === 0 && selectedUserIds.length === 0
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
      return "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]";
    case "strategy":
      return "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]";
    case "project":
      return "bg-[var(--ui-accent-soft)] text-[var(--primary)]";
    case "issue":
      return "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_72%,var(--ui-ink-strong)_28%)]";
    case "subtask":
      return "border-[color-mix(in_srgb,var(--tertiary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]";
    default:
      return "bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]";
  }
}

function statusBadgeClass(statusLabel: string | null) {
  switch (statusLabel) {
    case "done":
    case "completed":
      return "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";
    case "blocked":
      return "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]";
    case "in_progress":
    case "active":
      return "bg-[var(--ui-accent-soft)] text-[var(--primary)]";
    case "focus":
      return "bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]";
    default:
      return "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]";
  }
}

export type HierarchyToggleNode = {
  data: { label: string };
  isLeaf: boolean;
  isOpen: boolean;
  toggle: () => void;
};

export function HierarchyToggleButton({ node }: { node: HierarchyToggleNode }) {
  return (
    <button
      type="button"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
      onClick={() => node.toggle()}
      disabled={node.isLeaf}
      aria-label={
        node.isOpen
          ? `Collapse ${node.data.label}`
          : `Expand ${node.data.label}`
      }
    >
      {node.isLeaf ? (
        <span className="size-2 rounded-full bg-[var(--ui-ink-muted)]" />
      ) : node.isOpen ? (
        <ChevronDown className="size-4" />
      ) : (
        <ChevronRight className="size-4" />
      )}
    </button>
  );
}

export function HierarchyOpenLink({
  href,
  label,
  mobile = false
}: {
  href: string | null;
  label: string;
  mobile?: boolean;
}) {
  if (!href) {
    return null;
  }

  return (
    <Link
      to={href}
      aria-label={`Open ${label}`}
      className={cn(
        "min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-medium)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]",
        mobile ? "inline-flex lg:hidden" : "hidden lg:inline-flex"
      )}
    >
      Open
    </Link>
  );
}

function renderHierarchyClauseBadge(kind: HierarchySearchClauseKind) {
  if (kind === "any") {
    return (
      <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
        Any
      </Badge>
    );
  }
  if (kind === "subtask") {
    return (
      <EntityBadge
        kind="task"
        label="Subtask"
        compact
        gradient={false}
        className="border-[color-mix(in_srgb,var(--tertiary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]"
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
        (suggestion) => !clauses.some((clause) => clause.id === suggestion.id)
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
      <div className="rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 shadow-[var(--ui-shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
              Hierarchy search
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
              Build OR clauses like{" "}
              <span className="text-[var(--ui-ink-strong)]">Goal + "MD"</span>{" "}
              or{" "}
              <span className="text-[var(--ui-ink-strong)]">Any + "Happy"</span>
              . Matching ancestors keep their branches visible so you can
              explore the hierarchy, not lose it.
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

        <div className="mt-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
          {clauses.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {clauses.map((clause) => (
                <span
                  key={clause.id}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1.5"
                >
                  {renderHierarchyClauseBadge(clause.kind)}
                  <span className="max-w-[14rem] truncate text-sm text-[var(--ui-ink-medium)]">
                    "{clause.query}"
                  </span>
                  <button
                    type="button"
                    className="rounded-full text-[var(--ui-ink-soft)] transition hover:text-[var(--ui-ink-strong)]"
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
              <Search className="size-4 text-[var(--ui-ink-muted)]" />
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
                  if (
                    event.key === "Backspace" &&
                    !query &&
                    clauses.length > 0
                  ) {
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
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-muted)] focus:outline-none"
              />
            </div>

            {open ? (
              <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-2 shadow-[var(--ui-shadow-strong)] backdrop-blur-xl">
                {suggestions.length > 0 ? (
                  suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                        index === highlightedIndex
                          ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                          : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addClause(suggestion)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {renderHierarchyClauseBadge(suggestion.kind)}
                          <span className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                            "{suggestion.query}"
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                          Match{" "}
                          {suggestion.kind === "any"
                            ? "any visible hierarchy node"
                            : `${suggestion.kind} nodes`}{" "}
                          that mention this text.
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]">
                    Type a word or phrase to create a new OR clause.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
          {resultSummary}
        </div>
      </div>
    </div>
  );
}

export function ProjectManagementHierarchyPage() {
  const shell = useForgeShell();
  const treeRef = useRef<TreeApi<HierarchyNode> | null>(null);
  const { initialOpenState, scheduleOpenStatePersistence } =
    useHierarchyOpenStatePersistence(treeRef);
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
  const [visibleLevels, setVisibleLevels] = useState<HierarchyKind[]>(
    DEFAULT_VISIBLE_LEVELS
  );

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
          <Badge className="border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]">
            Bots
          </Badge>
        ),
        menuBadge: (
          <Badge className="border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]">
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
          <Badge className="border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]">
            Humans
          </Badge>
        ),
        menuBadge: (
          <Badge className="border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]">
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
            className="border-[color-mix(in_srgb,var(--tertiary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]"
          />
        ),
        menuBadge: (
          <EntityBadge
            kind="task"
            label="Subtask"
            compact
            gradient={false}
            className="border-[color-mix(in_srgb,var(--tertiary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-tertiary-soft)] text-[var(--tertiary)]"
          />
        )
      }
    ],
    []
  );

  const statusFilterOptions = useMemo<EntityLinkOption[]>(
    () =>
      [
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
    () =>
      new Map(shell.snapshot.tags.map((tag) => [tag.id, tag.name] as const)),
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
    searchClauses.length > 0
      ? `${searchClauses.length} OR clause${searchClauses.length === 1 ? "" : "s"} active`
      : "Search across the full hierarchy"
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

      <Card className="min-w-0 overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ui-border-subtle)] px-5 py-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Hierarchy controls
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
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
              onChange={(values) => setVisibleLevels(values as HierarchyKind[])}
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
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {filteredTree.length} top-level nodes
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {visibleNodeCount} visible nodes
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
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
        <Card className="min-w-0 overflow-hidden border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-0">
          <div className="grid grid-cols-[minmax(0,1.8fr)_auto_auto_auto] gap-3 border-b border-[var(--ui-border-subtle)] px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
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
              rowHeight={76}
              overscanCount={10}
              childrenAccessor={(node) => node.children ?? null}
              openByDefault
              initialOpenState={initialOpenState}
              onToggle={scheduleOpenStatePersistence}
              paddingTop={8}
              paddingBottom={8}
              disableDrag
              className="text-sm"
            >
              {({ node, style }) => {
                const visualKind =
                  node.data.kind === "subtask"
                    ? "task"
                    : (node.data.kind as
                        | "goal"
                        | "strategy"
                        | "project"
                        | "issue"
                        | "task");
                const visual = getEntityVisual(visualKind);
                const accent = visual.colorToken.rgb.join(", ");

                return (
                  <div style={style} className="px-2 py-1.5">
                    <div
                      className={cn(
                        "grid min-w-0 items-center gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] px-3 py-2 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
                        "grid-cols-[minmax(0,1.8fr)_auto] lg:grid-cols-[minmax(0,1.8fr)_auto_auto] xl:grid-cols-[minmax(0,1.8fr)_auto_auto_auto]"
                      )}
                      style={{
                        marginLeft: `${node.level * 14}px`,
                        background: `color-mix(in srgb, rgb(${accent}) 7%, var(--ui-surface-1))`
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <HierarchyToggleButton node={node} />

                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] border",
                            visual.subtleBadgeClassName
                          )}
                        >
                          <visual.icon
                            className={cn("size-4", visual.iconClassName)}
                          />
                        </span>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className={hierarchyBadgeClass(node.data.kind)}
                            >
                              {node.data.kind}
                            </Badge>
                            {node.data.executionMode ? (
                              <Badge
                                className={
                                  node.data.executionMode === "afk"
                                    ? "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                                    : "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]"
                                }
                              >
                                {node.data.executionMode.toUpperCase()}
                              </Badge>
                            ) : null}
                            <div className="truncate text-[13px] font-medium text-[var(--ui-ink-strong)]">
                              {node.data.label}
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] leading-5 text-[var(--ui-ink-soft)]">
                            {node.data.description}
                          </div>
                        </div>
                      </div>

                      <HierarchyOpenLink
                        href={node.data.href}
                        label={node.data.label}
                        mobile
                      />

                      <div className="hidden lg:flex justify-end">
                        <Badge
                          className={statusBadgeClass(node.data.statusLabel)}
                        >
                          {node.data.statusLabel
                            ? node.data.statusLabel.replaceAll("_", " ")
                            : "linked"}
                        </Badge>
                      </div>

                      <div className="hidden xl:flex items-center justify-end gap-2">
                        {node.data.user ? (
                          <UserBadge user={node.data.user} compact />
                        ) : null}
                        {node.data.assignees.length > 0 ? (
                          <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                            +{node.data.assignees.length}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="hidden lg:flex min-w-[11rem] items-center justify-end gap-3">
                        <div className="min-w-[7.5rem]">
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${node.data.progressPercent ?? 0}%`,
                                background: `linear-gradient(90deg, rgb(${accent}), color-mix(in srgb, rgb(${accent}) 72%, var(--ui-surface-1)))`
                              }}
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--ui-ink-faint)]">
                            {node.data.progressLabel ??
                              `${node.data.progressPercent ?? 0}% complete`}
                          </div>
                        </div>
                        {node.data.href ? (
                          <HierarchyOpenLink
                            href={node.data.href}
                            label={node.data.label}
                          />
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
