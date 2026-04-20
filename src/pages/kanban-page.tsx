import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scissors, Search, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  KanbanBoardBox,
  KanbanFiltersBox,
  KanbanSummaryBox
} from "@/components/workbench-boxes/kanban/kanban-boxes";
import { ExecutionBoard, LANE_ORDER } from "@/components/execution-board";
import { ProjectDialog } from "@/components/project-dialog";
import { ProjectManagementSectionNav } from "@/components/projects/project-management-section-nav";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { TaskDialog } from "@/components/task-dialog";
import { EntityBadge } from "@/components/ui/entity-badge";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createWorkAdjustment,
  deleteTask,
  patchTask,
  splitTask,
  uncompleteTask
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useForgeShell } from "@/components/shell/app-shell";
import { getSingleSelectedUserId } from "@/lib/user-ownership";
import type { UserSummary } from "@/lib/types";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

const ENTITY_FILTER_PREFIX = {
  goal: "goal:",
  project: "project:",
  tag: "tag:"
} as const;

const OWNER_FILTER_PREFIX = {
  user: "user:",
  kind: "kind:"
} as const;

const LEVEL_OPTIONS: Array<{
  value: "project" | "issue" | "task" | "subtask";
  label: string;
  searchText: string;
  kind?: "project" | "issue" | "task";
}> = [
  {
    value: "project",
    label: "Project",
    searchText: "project initiative prd"
  },
  {
    value: "issue",
    label: "Issue",
    searchText: "issue vertical slice tracer bullet"
  },
  {
    value: "task",
    label: "Task",
    searchText: "task focused ai session"
  },
  {
    value: "subtask",
    label: "Subtask",
    searchText: "subtask child step"
  }
];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function parseEntityFilterValues(values: string[]) {
  return values.reduce(
    (accumulator, value) => {
      if (value.startsWith(ENTITY_FILTER_PREFIX.goal)) {
        accumulator.goalIds.push(value.slice(ENTITY_FILTER_PREFIX.goal.length));
      } else if (value.startsWith(ENTITY_FILTER_PREFIX.project)) {
        accumulator.projectIds.push(
          value.slice(ENTITY_FILTER_PREFIX.project.length)
        );
      } else if (value.startsWith(ENTITY_FILTER_PREFIX.tag)) {
        accumulator.tagIds.push(value.slice(ENTITY_FILTER_PREFIX.tag.length));
      }
      return accumulator;
    },
    {
      goalIds: [] as string[],
      projectIds: [] as string[],
      tagIds: [] as string[]
    }
  );
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

function clearKanbanFilters(
  setSelectedEntityFilterIds: (values: string[]) => void,
  setSelectedOwnerFilterIds: (values: string[]) => void,
  setQuery: (value: string) => void,
  setSelectedLevels: (
    values: Array<"project" | "issue" | "task" | "subtask">
  ) => void
) {
  setSelectedEntityFilterIds([]);
  setSelectedOwnerFilterIds([]);
  setQuery("");
  setSelectedLevels(["task", "subtask"]);
}

function buildDefaultSplitTitles(title: string) {
  const cleaned = title.trim();
  if (cleaned.length === 0) {
    return {
      firstTitle: "Split task part 1",
      secondTitle: "Split task part 2"
    };
  }
  return {
    firstTitle: `${cleaned} - part 1`,
    secondTitle: `${cleaned} - part 2`
  };
}

export function KanbanPage() {
  const { t } = useI18n();
  const shell = useForgeShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedEntityFilterIds, setSelectedEntityFilterIds] = useState<
    string[]
  >([]);
  const [selectedOwnerFilterIds, setSelectedOwnerFilterIds] = useState<
    string[]
  >([]);
  const [query, setQuery] = useState("");
  const [selectedLevels, setSelectedLevels] = useState<
    Array<"project" | "issue" | "task" | "subtask">
  >(["task", "subtask"]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    shell.snapshot.workItems?.[0]?.id ?? shell.snapshot.tasks[0]?.id ?? null
  );
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDialogInitialStepId, setProjectDialogInitialStepId] = useState<
    string | undefined
  >(undefined);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDialogInitialStepId, setTaskDialogInitialStepId] = useState<
    string | undefined
  >(undefined);
  const [taskDialogCreationContext, setTaskDialogCreationContext] = useState<{
    initialGoalId?: string | null;
    initialProjectId?: string | null;
    initialParentWorkItemId?: string | null;
    initialLevel?: "issue" | "task" | "subtask";
  } | null>(null);
  const [splittingTaskId, setSplittingTaskId] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState({
    firstTitle: "",
    secondTitle: "",
    remainingRatio: 0.5
  });

  const entityFilterOptions = useMemo<EntityLinkOption[]>(
    () => [
      ...shell.snapshot.goals.map((goal) => ({
        value: `${ENTITY_FILTER_PREFIX.goal}${goal.id}`,
        label: goal.title,
        description: "Goal",
        searchText: `goal ${goal.title} ${goal.description ?? ""}`,
        kind: "goal" as const
      })),
      ...shell.snapshot.dashboard.projects.map((project) => ({
        value: `${ENTITY_FILTER_PREFIX.project}${project.id}`,
        label: project.title,
        description: "Project",
        searchText: `project ${project.title} ${project.description ?? ""} ${project.goalTitle ?? ""}`,
        kind: "project" as const
      })),
      ...shell.snapshot.tags.map((tag) => ({
        value: `${ENTITY_FILTER_PREFIX.tag}${tag.id}`,
        label: tag.name,
        description: "Tag",
        searchText: `tag ${tag.name} ${tag.color ?? ""}`,
        kind: "tag" as const
      }))
    ],
    [shell.snapshot.dashboard.projects, shell.snapshot.goals, shell.snapshot.tags]
  );

  const ownerFilterOptions = useMemo<EntityLinkOption[]>(() => {
    const bots = shell.snapshot.users.filter((user) => user.kind === "bot");
    const humans = shell.snapshot.users.filter((user) => user.kind === "human");

    return [
      {
        value: `${OWNER_FILTER_PREFIX.kind}bot`,
        label: "Bots",
        description: `${bots.length} bot owner${bots.length === 1 ? "" : "s"}`,
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
        description: `${humans.length} human owner${humans.length === 1 ? "" : "s"}`,
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
    () =>
      LEVEL_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        searchText: option.searchText,
        badge:
          option.value === "subtask" ? (
            <EntityBadge
              kind="task"
              label="Subtask"
              compact
              gradient={false}
              className="border-indigo-300/18 bg-indigo-400/12 text-indigo-100"
            />
          ) : (
            <EntityBadge
              kind={(option.kind ?? option.value) as "project" | "issue" | "task"}
              label={option.label}
              compact
              gradient={false}
            />
          ),
        menuBadge:
          option.value === "subtask" ? (
            <EntityBadge
              kind="task"
              label="Subtask"
              compact
              gradient={false}
              className="border-indigo-300/18 bg-indigo-400/12 text-indigo-100"
            />
          ) : (
            <EntityBadge
              kind={(option.kind ?? option.value) as "project" | "issue" | "task"}
              label={option.label}
              compact
              gradient={false}
            />
          )
      })),
    []
  );

  const parsedEntityFilters = useMemo(
    () => parseEntityFilterValues(selectedEntityFilterIds),
    [selectedEntityFilterIds]
  );
  const parsedOwnerFilters = useMemo(
    () => parseOwnerFilterValues(selectedOwnerFilterIds),
    [selectedOwnerFilterIds]
  );
  const normalizedQuery = useMemo(() => normalize(query), [query]);
  const boardWorkItems = useMemo(
    () =>
      shell.snapshot.workItems && shell.snapshot.workItems.length > 0
        ? shell.snapshot.workItems
        : shell.snapshot.tasks,
    [shell.snapshot.tasks, shell.snapshot.workItems]
  );
  const projectById = useMemo(
    () =>
      new Map(
        shell.snapshot.dashboard.projects.map((project) => [project.id, project] as const)
      ),
    [shell.snapshot.dashboard.projects]
  );

  const filteredTasks = boardWorkItems.filter((task) => {
    if (!selectedLevels.includes(task.level)) {
      return false;
    }
    if (normalizedQuery.length > 0) {
      const project = task.projectId ? projectById.get(task.projectId) ?? null : null;
      const searchText = normalize(
        [
          task.title,
          task.description,
          task.level,
          task.aiInstructions ?? "",
          task.executionMode ?? "",
          project?.title ?? "",
          project?.goalTitle ?? "",
          task.user?.displayName ?? "",
          ...(task.assignees ?? []).map((user) => user.displayName)
        ].join(" ")
      );
      if (!searchText.includes(normalizedQuery)) {
        return false;
      }
    }
    if (
      parsedEntityFilters.goalIds.length > 0 &&
      (task.goalId === null ||
        !parsedEntityFilters.goalIds.includes(task.goalId))
    ) {
      return false;
    }
    if (
      parsedEntityFilters.projectIds.length > 0 &&
      (task.projectId === null ||
        !parsedEntityFilters.projectIds.includes(task.projectId))
    ) {
      return false;
    }
    if (
      parsedEntityFilters.tagIds.length > 0 &&
      !parsedEntityFilters.tagIds.every((tagId) => task.tagIds.includes(tagId))
    ) {
      return false;
    }
    if (
      parsedOwnerFilters.userIds.length > 0 ||
      parsedOwnerFilters.kinds.length > 0
    ) {
      const linkedUsers = [
        ...(task.user ? [task.user] : []),
        ...(task.assignees ?? [])
      ];
      const matchesExplicitUser = linkedUsers.some((user) =>
        parsedOwnerFilters.userIds.includes(user.id)
      );
      const matchesOwnerKind = linkedUsers.some((user) =>
        parsedOwnerFilters.kinds.includes(user.kind)
      );

      if (!matchesExplicitUser && !matchesOwnerKind) {
        return false;
      }
    }
    return true;
  });

  const filteredProjects = shell.snapshot.dashboard.projects.filter((project) => {
    if (!selectedLevels.includes("project")) {
      return false;
    }
    if (normalizedQuery.length > 0) {
      const searchText = normalize(
        [
          project.title,
          project.description,
          project.goalTitle,
          project.productRequirementsDocument,
          project.user?.displayName ?? "",
          ...(project.assignees ?? []).map((user) => user.displayName)
        ].join(" ")
      );
      if (!searchText.includes(normalizedQuery)) {
        return false;
      }
    }
    if (
      parsedEntityFilters.goalIds.length > 0 &&
      !parsedEntityFilters.goalIds.includes(project.goalId)
    ) {
      return false;
    }
    if (
      parsedEntityFilters.projectIds.length > 0 &&
      !parsedEntityFilters.projectIds.includes(project.id)
    ) {
      return false;
    }
    if (
      parsedOwnerFilters.userIds.length > 0 ||
      parsedOwnerFilters.kinds.length > 0
    ) {
      const linkedUsers = [
        ...(project.user ? [project.user] : []),
        ...(project.assignees ?? [])
      ];
      const matchesExplicitUser = linkedUsers.some((user) =>
        parsedOwnerFilters.userIds.includes(user.id)
      );
      const matchesOwnerKind = linkedUsers.some((user) =>
        parsedOwnerFilters.kinds.includes(user.kind)
      );
      if (!matchesExplicitUser && !matchesOwnerKind) {
        return false;
      }
    }
    return true;
  });
  const visibleItemCount = filteredTasks.length + filteredProjects.length;
  const hasVisibleBoardContent = filteredProjects.length > 0 || filteredTasks.length > 0;
  const hasActiveFilters =
    query.trim().length > 0 ||
    selectedEntityFilterIds.length > 0 ||
    selectedOwnerFilterIds.length > 0 ||
    selectedLevels.length !== 2 ||
    !selectedLevels.includes("task") ||
    !selectedLevels.includes("subtask");

  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ??
    boardWorkItems.find((task) => task.id === selectedTaskId) ??
    null;
  const editingProject =
    editingProjectId
      ? shell.snapshot.dashboard.projects.find(
          (project) => project.id === editingProjectId
        ) ?? null
      : null;
  const editingTask = editingTaskId
    ? (boardWorkItems.find((task) => task.id === editingTaskId) ?? null)
    : null;
  const blockedCount = filteredTasks.filter(
    (task) => task.status === "blocked"
  ).length;
  const doneCount = filteredTasks.filter(
    (task) => task.status === "done"
  ).length;
  const focusCount = filteredTasks.filter(
    (task) => task.status === "focus" || task.status === "in_progress"
  ).length;
  const liveRunCount = shell.snapshot.activeTaskRuns.length;
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const splittingTask = splittingTaskId
    ? (boardWorkItems.find((task) => task.id === splittingTaskId) ?? null)
    : null;

  const invalidateBoard = async () => {
    await Promise.all([
      shell.refresh(),
      invalidateForgeSnapshot(queryClient),
      queryClient.invalidateQueries({ queryKey: ["project-board"] }),
      queryClient.invalidateQueries({ queryKey: ["task-context"] })
    ]);
  };

  const updateTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      patch
    }: {
      taskId: string;
      patch: Parameters<typeof patchTask>[1];
    }) => shell.patchTask(taskId, patch),
    onSuccess: invalidateBoard
  });
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: invalidateBoard
  });
  const workAdjustmentMutation = useMutation({
    mutationFn: createWorkAdjustment,
    onSuccess: invalidateBoard
  });
  const splitTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      firstTitle,
      secondTitle,
      remainingRatio
    }: {
      taskId: string;
      firstTitle: string;
      secondTitle: string;
      remainingRatio: number;
    }) =>
      splitTask(taskId, {
        firstTitle,
        secondTitle,
        remainingRatio
      }),
    onSuccess: async () => {
      await invalidateBoard();
      setSplittingTaskId(null);
    }
  });

  const openProjectEditor = (projectId: string, initialStepId?: string) => {
    setEditingProjectId(projectId);
    setProjectDialogInitialStepId(initialStepId);
  };

  const openTaskEditor = (taskId: string, initialStepId?: string) => {
    setEditingTaskId(taskId);
    setTaskDialogCreationContext(null);
    setTaskDialogInitialStepId(initialStepId);
  };

  const openTaskCreator = (context: {
    initialGoalId?: string | null;
    initialProjectId?: string | null;
    initialParentWorkItemId?: string | null;
    initialLevel?: "issue" | "task" | "subtask";
  }) => {
    setEditingTaskId(null);
    setTaskDialogInitialStepId(undefined);
    setTaskDialogCreationContext(context);
  };

  if (
    boardWorkItems.length === 0 &&
    shell.snapshot.dashboard.projects.length === 0
  ) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <PageHero
          title="Kanban"
          description="Move tasks across the board, start work quickly, and keep your next step visible."
          badge="0 visible tasks"
          actions={
            <Button size="lg" onClick={() => shell.openStartWork()}>
              Start work
            </Button>
          }
        />
        <EmptyState
          eyebrow={t("common.kanban.heroEyebrow")}
          title={t("common.kanban.emptyTitle")}
          description={t("common.kanban.emptyDescription")}
          action={
            <Link
              to="/goals"
              className="inline-flex whitespace-nowrap rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-slate-950 transition hover:opacity-90"
            >
              {t("common.kanban.emptyAction")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <ProjectManagementSectionNav />
      <PageHero
        title="Kanban"
        description="Move projects, issues, tasks, and subtasks through one shared execution board, then open the right layer when you need to inspect or edit it."
        badge={`${visibleItemCount} visible work items`}
        actions={
          <Button
            size="lg"
            onClick={() =>
              shell.openStartWork(
                selectedTask ? { taskId: selectedTask.id } : undefined
              )
            }
          >
            Start work
          </Button>
        }
      />

      <KanbanSummaryBox>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Board
              </div>
              <div className="mt-2 text-base text-white">
                See projects, issues, tasks, and subtasks in the same workflow
                lanes, with one card language and one shared board state.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/72">
              {focusCount} ready or active
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {blockedCount} blocked
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {doneCount} done
            </Badge>
            <Badge className="bg-white/[0.08] text-white/72">
              {liveRunCount} live timer{liveRunCount === 1 ? "" : "s"}
            </Badge>
            <Badge className="bg-[var(--primary)]/12 text-[var(--primary)]">
              {Math.round(shell.snapshot.lifeForce?.spentTodayAp ?? 0)} /{" "}
              {Math.round(shell.snapshot.lifeForce?.dailyBudgetAp ?? 0)} AP
            </Badge>
            </div>
          </div>
        </Card>
      </KanbanSummaryBox>

      <KanbanFiltersBox>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="type-label text-white/40">Filters</div>
              <div className="mt-2 text-sm text-white/56">
                Use compact entity chips for goals, projects, tags, and owner
                scopes instead of the wide pill rows.
              </div>
            </div>
            {hasActiveFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  clearKanbanFilters(
                    setSelectedEntityFilterIds,
                    setSelectedOwnerFilterIds,
                    setQuery,
                    setSelectedLevels
                  )
                }
              >
                Reset
              </Button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="flex items-center gap-3">
                <Search className="size-4 text-white/36" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects, issues, tasks, subtasks, PRDs, owners, and assignees"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
                />
                {query.trim().length > 0 ? (
                  <button
                    type="button"
                    className="rounded-full text-white/46 transition hover:text-white"
                    onClick={() => setQuery("")}
                    aria-label="Clear board search"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>
            <EntityLinkMultiSelect
              options={levelFilterOptions}
              selectedValues={selectedLevels}
              onChange={(values) =>
                setSelectedLevels(
                  values as Array<"project" | "issue" | "task" | "subtask">
                )
              }
              placeholder="Work item types"
              emptyMessage="No work-item levels."
              variant="action-bar"
            />
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)]">
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Entity filters
              </div>
              <EntityLinkMultiSelect
                options={entityFilterOptions}
                selectedValues={selectedEntityFilterIds}
                onChange={setSelectedEntityFilterIds}
                placeholder="Filter by goal, project, or tag"
                emptyMessage="No matching goals, projects, or tags."
              />
            </div>
            <div className="grid gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                Owner filters
              </div>
              <EntityLinkMultiSelect
                options={ownerFilterOptions}
                selectedValues={selectedOwnerFilterIds}
                onChange={setSelectedOwnerFilterIds}
                placeholder="Type Bo for bots, Hu for humans, or a teammate name"
                emptyMessage="No matching owners."
              />
            </div>
          </div>
        </Card>
      </KanbanFiltersBox>

      {!hasVisibleBoardContent ? (
        <EmptyState
          eyebrow={t("common.kanban.heroEyebrow")}
          title={t("common.kanban.noTasksMatch")}
          description="No tasks match the current filters. Reset the filters to bring the full board back."
          action={
            <Button
              variant="secondary"
              onClick={() =>
                clearKanbanFilters(
                  setSelectedEntityFilterIds,
                  setSelectedOwnerFilterIds,
                  setQuery,
                  setSelectedLevels
                )
              }
            >
              Reset
            </Button>
          }
        />
      ) : (
        <KanbanBoardBox>
          <ExecutionBoard
            tasks={filteredTasks}
            projects={filteredProjects}
            activeRuns={shell.snapshot.activeTaskRuns}
            goals={shell.snapshot.goals}
            tags={shell.snapshot.tags}
            notesSummaryByEntity={shell.snapshot.dashboard.notesSummaryByEntity}
            selectedTaskId={selectedTaskId}
            onMove={async (taskId, nextStatus) => {
              await shell.patchTaskStatus(taskId, nextStatus);
            }}
            onMoveProject={async (projectId, nextStatus) => {
              await shell.patchProject(projectId, {
                workflowStatus: nextStatus
              });
            }}
            onQuickReopenTask={async (taskId) => {
              await uncompleteTask(taskId);
              await invalidateBoard();
            }}
            onDeleteTask={async (taskId) => {
              await deleteTaskMutation.mutateAsync(taskId);
              setSelectedTaskId((current) => {
                if (current !== taskId) {
                  return current;
                }
                return filteredTasks.find((task) => task.id !== taskId)?.id ?? null;
              });
              setEditingTaskId((current) => (current === taskId ? null : current));
            }}
            onStartTask={async (taskId) => {
              await shell.startTaskNow(taskId);
              setSelectedTaskId(taskId);
              await queryClient.invalidateQueries({
                queryKey: ["task-context", taskId]
              });
            }}
            onStopTask={async (run) => {
              await shell.stopTaskRun(run);
              setSelectedTaskId(run.taskId);
              await queryClient.invalidateQueries({
                queryKey: ["task-context", run.taskId]
              });
            }}
            onSelectTask={(taskId) => {
              setSelectedTaskId(taskId);
            }}
            onOpenProject={(projectId) => {
              navigate(`/projects/${projectId}`);
            }}
            onOpenTask={(taskId) => {
              navigate(`/tasks/${taskId}`);
            }}
            onEditProject={(projectId) => {
              openProjectEditor(projectId);
            }}
            onEditTask={(taskId) => {
              openTaskEditor(taskId);
            }}
            onLinkProject={(projectId) => {
              openProjectEditor(projectId, "anchor");
            }}
            onLinkTask={(taskId) => {
              openTaskEditor(taskId, "anchor");
            }}
            onCreateIssueForProject={(projectId) => {
              const project =
                shell.snapshot.dashboard.projects.find(
                  (entry) => entry.id === projectId
                ) ?? null;
              if (!project) {
                return;
              }
              openTaskCreator({
                initialLevel: "issue",
                initialGoalId: project.goalId,
                initialProjectId: project.id
              });
            }}
            onCreateTaskForIssue={(taskId) => {
              const issue =
                boardWorkItems.find((entry) => entry.id === taskId) ?? null;
              if (!issue) {
                return;
              }
              openTaskCreator({
                initialLevel: "task",
                initialGoalId: issue.goalId,
                initialProjectId: issue.projectId,
                initialParentWorkItemId: issue.id
              });
            }}
            onCreateSubtaskForTask={(taskId) => {
              const task =
                boardWorkItems.find((entry) => entry.id === taskId) ?? null;
              if (!task) {
                return;
              }
              openTaskCreator({
                initialLevel: "subtask",
                initialGoalId: task.goalId,
                initialProjectId: task.projectId,
                initialParentWorkItemId: task.id
              });
            }}
            onSplitTask={(taskId) => {
              const task =
                boardWorkItems.find((entry) => entry.id === taskId) ?? null;
              if (!task) {
                return;
              }
              const defaultTitles = buildDefaultSplitTitles(task.title);
              setSplittingTaskId(taskId);
              setSplitDraft({
                firstTitle: defaultTitles.firstTitle,
                secondTitle: defaultTitles.secondTitle,
                remainingRatio: 0.5
              });
            }}
          />
        </KanbanBoardBox>
      )}

      <ProjectDialog
        open={editingProject !== null}
        goals={shell.snapshot.goals}
        users={shell.snapshot.users}
        editingProject={editingProject}
        defaultUserId={editingProject?.userId ?? defaultUserId}
        initialStepId={projectDialogInitialStepId}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProjectId(null);
            setProjectDialogInitialStepId(undefined);
          }
        }}
        onSubmit={async (input, projectId) => {
          if (!projectId) {
            return;
          }
          await shell.patchProject(projectId, input);
          setEditingProjectId(null);
          setProjectDialogInitialStepId(undefined);
        }}
      />

      <TaskDialog
        open={editingTask !== null || taskDialogCreationContext !== null}
        goals={shell.snapshot.goals}
        projects={shell.snapshot.dashboard.projects}
        workItems={boardWorkItems}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        editingTask={editingTask}
        initialGoalId={taskDialogCreationContext?.initialGoalId}
        initialProjectId={taskDialogCreationContext?.initialProjectId}
        initialParentWorkItemId={
          taskDialogCreationContext?.initialParentWorkItemId
        }
        initialLevel={taskDialogCreationContext?.initialLevel}
        initialStepId={taskDialogInitialStepId}
        defaultUserId={editingTask?.userId ?? defaultUserId}
        onRefreshEntities={shell.refresh}
        currentCreditedSeconds={editingTask?.time.totalCreditedSeconds}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTaskId(null);
            setTaskDialogCreationContext(null);
            setTaskDialogInitialStepId(undefined);
          }
        }}
        onAdjustTrackedTime={
          editingTask
            ? async (input) => {
                await workAdjustmentMutation.mutateAsync(input);
              }
            : undefined
        }
        onSubmit={async (input, taskId) => {
          if (taskId) {
            await updateTaskMutation.mutateAsync({ taskId, patch: input });
          } else {
            await shell.createTask(input);
          }
          setEditingTaskId(null);
          setTaskDialogCreationContext(null);
          setTaskDialogInitialStepId(undefined);
        }}
      />

      {splittingTask ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,18,0.74)] p-4 backdrop-blur-xl">
          <Card className="w-full max-w-xl border border-white/10 bg-[linear-gradient(180deg,rgba(16,22,36,0.96),rgba(9,13,22,0.98))] shadow-[0_32px_90px_rgba(5,8,18,0.58)]">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-400/14 text-amber-100">
                <Scissors className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-[1.35rem] leading-tight text-white">
                  Split this task
                </div>
                <div className="mt-2 text-sm leading-6 text-white/64">
                  {splittingTask.title} has grown beyond its expected shape.
                  Split the remaining work into two child tasks while keeping
                  the original history intact.
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  First task name
                </div>
                <Input
                  value={splitDraft.firstTitle}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      firstTitle: event.target.value
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Second task name
                </div>
                <Input
                  value={splitDraft.secondTitle}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      secondTitle: event.target.value
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 rounded-[18px] bg-white/[0.04] px-4 py-4">
                <div className="flex items-center justify-between gap-3 text-sm text-white/70">
                  <span>Remaining work ratio</span>
                  <span>{Math.round(splitDraft.remainingRatio * 100)}% / {100 - Math.round(splitDraft.remainingRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={75}
                  step={5}
                  value={Math.round(splitDraft.remainingRatio * 100)}
                  onChange={(event) =>
                    setSplitDraft((current) => ({
                      ...current,
                      remainingRatio: Number(event.target.value) / 100
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/72">
                    {Math.round(
                      (splittingTask.actionPointSummary?.totalCostAp ?? 0) *
                        splitDraft.remainingRatio
                    )}{" "}
                    AP first child
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/72">
                    {Math.round(
                      (splittingTask.actionPointSummary?.totalCostAp ?? 0) *
                        (1 - splitDraft.remainingRatio)
                    )}{" "}
                    AP second child
                  </Badge>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setSplittingTaskId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                pending={splitTaskMutation.isPending}
                disabled={
                  splitDraft.firstTitle.trim().length === 0 ||
                  splitDraft.secondTitle.trim().length === 0
                }
                onClick={() => {
                  void splitTaskMutation.mutateAsync({
                    taskId: splittingTask.id,
                    firstTitle: splitDraft.firstTitle.trim(),
                    secondTitle: splitDraft.secondTitle.trim(),
                    remainingRatio: splitDraft.remainingRatio
                  });
                }}
              >
                Create split tasks
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
