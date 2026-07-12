import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { Link2, Search } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { createTask } from "@/lib/api";
import {
  buildStrategyContractChecks,
  isStrategyContractReady
} from "@/lib/strategy-contract";
import { buildStrategyAlignmentBreakdown } from "@/lib/strategy-metrics";
import type {
  DashboardGoal,
  Habit,
  ProjectSummary,
  Strategy,
  Task,
  UserSummary
} from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnerSelectDefaultLabel
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STRATEGY_DRAFT,
  buildDraftGraph,
  buildDraftMetrics,
  createDraftNode,
  createInlineTaskDraft,
  hasGraphCycle,
  normalize,
  strategyToDraft,
  toggleLinkedEntity,
  toggleString,
  type InlineTaskDraft,
  type StrategyDialogDraft,
  type StrategyDialogDraftNode
} from "@/components/strategy-dialog-model";
import { StrategySequenceBuilder } from "@/components/strategy-sequence-builder";

type LinkableEntityOption = {
  key: string;
  entityType: "goal" | "project" | "task" | "habit" | "strategy";
  entityId: string;
  label: string;
  description: string;
  user: UserSummary | null;
};

export function StrategyDialog({
  open,
  pending = false,
  editingStrategy,
  goals,
  projects,
  tasks,
  habits,
  strategies,
  users,
  defaultUserId = null,
  initialStepId,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  pending?: boolean;
  editingStrategy: Strategy | null;
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  tasks: Task[];
  habits: Habit[];
  strategies: Strategy[];
  users: UserSummary[];
  defaultUserId?: string | null;
  initialStepId?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    input: Omit<StrategyDialogDraft, "nodes"> & { graph: Strategy["graph"] },
    strategyId?: string
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StrategyDialogDraft>(
    DEFAULT_STRATEGY_DRAFT
  );
  const [objectiveSearchQuery, setObjectiveSearchQuery] = useState("");
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [sequenceSearchQuery, setSequenceSearchQuery] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdTasks, setCreatedTasks] = useState<Task[]>([]);
  const [inlineTaskDraft, setInlineTaskDraft] = useState<InlineTaskDraft>(
    createInlineTaskDraft(defaultUserId, projects)
  );
  const [showInlineTaskComposer, setShowInlineTaskComposer] = useState(false);
  const [inlineTaskError, setInlineTaskError] = useState<string | null>(null);
  const [inlineTaskPending, setInlineTaskPending] = useState(false);
  const [nodeHistory, setNodeHistory] = useState<StrategyDialogDraftNode[][]>(
    []
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDraft = editingStrategy
      ? strategyToDraft(editingStrategy)
      : {
          ...DEFAULT_STRATEGY_DRAFT,
          userId: defaultUserId,
          nodes: [createDraftNode("project", { dependencyMode: "start" })]
        };
    setDraft(nextDraft);
    setObjectiveSearchQuery("");
    setContextSearchQuery("");
    setSequenceSearchQuery("");
    setCreatedTasks([]);
    setShowInlineTaskComposer(false);
    setInlineTaskDraft(
      createInlineTaskDraft(defaultUserId, projects).projectId &&
        nextDraft.targetProjectIds[0]
        ? {
            ...createInlineTaskDraft(defaultUserId, projects),
            goalId:
              projects.find(
                (project) => project.id === nextDraft.targetProjectIds[0]
              )?.goalId ?? "",
            projectId: nextDraft.targetProjectIds[0] ?? projects[0]?.id ?? "",
            userId:
              projects.find(
                (project) => project.id === nextDraft.targetProjectIds[0]
              )?.userId ?? defaultUserId
          }
        : createInlineTaskDraft(defaultUserId, projects)
    );
    setInlineTaskError(null);
    setSubmitError(null);
    setNodeHistory([]);
  }, [defaultUserId, editingStrategy, open, projects]);

  useEffect(() => {
    if (!open || nodeHistory.length === 0) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      const previousNodes = nodeHistory[nodeHistory.length - 1];
      if (!previousNodes) {
        return;
      }
      setNodeHistory((current) => current.slice(0, -1));
      setDraft((current) => ({ ...current, nodes: previousNodes }));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodeHistory, open]);

  const objectiveQuery = useDeferredValue(objectiveSearchQuery);
  const contextQuery = useDeferredValue(contextSearchQuery);
  const sequenceQuery = useDeferredValue(sequenceSearchQuery);
  const allTasks = useMemo(() => {
    const createdIds = new Set(createdTasks.map((task) => task.id));
    return [
      ...createdTasks,
      ...tasks.filter((task) => !createdIds.has(task.id))
    ];
  }, [createdTasks, tasks]);
  const goalsById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal] as const)),
    [goals]
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects]
  );
  const tasksById = useMemo(
    () => new Map(allTasks.map((task) => [task.id, task] as const)),
    [allTasks]
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user] as const)),
    [users]
  );
  const defaultUser = users.find((user) => user.id === defaultUserId) ?? null;
  const selectedStrategyUser =
    users.find((user) => user.id === draft.userId) ?? defaultUser;

  const matchesOwnedEntityQuery = (
    query: string,
    parts: Array<string | null | undefined>,
    user?: UserSummary | null
  ) => {
    const normalizedQuery = normalize(query);
    return (
      normalizedQuery.length === 0 ||
      buildOwnedEntitySearchText(parts, user).includes(normalizedQuery)
    );
  };

  const visibleGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [contextQuery, goals]
  );
  const objectiveGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          objectiveQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [goals, objectiveQuery]
  );
  const objectiveProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          objectiveQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [objectiveQuery, projects]
  );
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [contextQuery, projects]
  );
  const visibleTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [task.title, task.description, task.owner, task.status],
          task.user
        )
      ),
    [allTasks, contextQuery]
  );
  const visibleHabits = useMemo(
    () =>
      habits.filter((habit) =>
        matchesOwnedEntityQuery(
          contextQuery,
          [habit.title, habit.description, habit.frequency, habit.status],
          habit.user
        )
      ),
    [contextQuery, habits]
  );
  const visibleStrategies = useMemo(
    () =>
      strategies.filter(
        (strategy) =>
          strategy.id !== editingStrategy?.id &&
          matchesOwnedEntityQuery(
            contextQuery,
            [
              strategy.title,
              strategy.overview,
              strategy.endStateDescription,
              strategy.status
            ],
            strategy.user
          )
      ),
    [contextQuery, editingStrategy?.id, strategies]
  );

  const linkableEntities = useMemo(() => {
    const options: LinkableEntityOption[] = [
      ...visibleGoals.map((goal) => ({
        key: `goal:${goal.id}`,
        entityType: "goal" as const,
        entityId: goal.id,
        label: goal.title,
        description: formatOwnedEntityDescription(
          goal.description,
          goal.user,
          "Goal"
        ),
        user: goal.user ?? null
      })),
      ...visibleProjects.map((project) => ({
        key: `project:${project.id}`,
        entityType: "project" as const,
        entityId: project.id,
        label: project.title,
        description: formatOwnedEntityDescription(
          `${project.goalTitle}${project.goalTitle ? " · " : ""}${project.status}`,
          project.user,
          `Project · ${project.goalTitle}`
        ),
        user: project.user ?? null
      })),
      ...visibleTasks.map((task) => ({
        key: `task:${task.id}`,
        entityType: "task" as const,
        entityId: task.id,
        label: task.title,
        description: formatOwnedEntityDescription(
          `${task.status} · ${task.owner}`,
          task.user,
          `Task · ${task.owner}`
        ),
        user: task.user ?? null
      })),
      ...visibleHabits.map((habit) => ({
        key: `habit:${habit.id}`,
        entityType: "habit" as const,
        entityId: habit.id,
        label: habit.title,
        description: formatOwnedEntityDescription(
          habit.description,
          habit.user,
          "Habit"
        ),
        user: habit.user ?? null
      })),
      ...visibleStrategies.map((strategy) => ({
        key: `strategy:${strategy.id}`,
        entityType: "strategy" as const,
        entityId: strategy.id,
        label: strategy.title,
        description: formatOwnedEntityDescription(
          strategy.overview,
          strategy.user,
          "Strategy"
        ),
        user: strategy.user ?? null
      }))
    ];
    return options.sort((left, right) => left.label.localeCompare(right.label));
  }, [
    visibleGoals,
    visibleHabits,
    visibleProjects,
    visibleStrategies,
    visibleTasks
  ]);

  const draftGraph = useMemo(
    () => buildDraftGraph(draft, projectsById, tasksById),
    [draft, projectsById, tasksById]
  );
  const draftMetrics = useMemo(
    () =>
      buildDraftMetrics({
        draft,
        graph: draftGraph,
        goals,
        projects,
        projectsById,
        tasks: allTasks,
        tasksById
      }),
    [allTasks, draft, draftGraph, goals, projects, projectsById, tasksById]
  );
  const contractChecks = useMemo(
    () => [
      ...buildStrategyContractChecks({
        title: draft.title,
        overview: draft.overview,
        endStateDescription: draft.endStateDescription,
        targetGoalIds: draft.targetGoalIds,
        targetProjectIds: draft.targetProjectIds,
        graph: draftGraph
      }),
      {
        id: "acyclic",
        label: "Graph stays directed and non-looping",
        satisfied: !hasGraphCycle(draft.nodes)
      }
    ],
    [
      draft.endStateDescription,
      draft.nodes,
      draft.overview,
      draft.targetGoalIds,
      draft.targetProjectIds,
      draft.title,
      draftGraph
    ]
  );
  const contractReady = useMemo(
    () =>
      isStrategyContractReady({
        title: draft.title,
        overview: draft.overview,
        endStateDescription: draft.endStateDescription,
        targetGoalIds: draft.targetGoalIds,
        targetProjectIds: draft.targetProjectIds,
        graph: draftGraph
      }),
    [
      draft.endStateDescription,
      draft.overview,
      draft.targetGoalIds,
      draft.targetProjectIds,
      draft.title,
      draftGraph
    ]
  );
  const alignmentBreakdown = useMemo(
    () => buildStrategyAlignmentBreakdown(draftMetrics),
    [draftMetrics]
  );

  const validationMessage = useMemo(() => {
    if (!draft.title.trim()) {
      return "Strategy title is required.";
    }
    if (draft.nodes.length === 0) {
      return "Add at least one project or task step.";
    }
    const seenEntityKeys = new Set<string>();
    for (const node of draft.nodes) {
      if (!node.entityId) {
        return "Every step needs a linked project or task.";
      }
      const entityKey = `${node.entityType}:${node.entityId}`;
      if (seenEntityKeys.has(entityKey)) {
        return "Each project or task should appear only once in the sequence.";
      }
      seenEntityKeys.add(entityKey);
    }
    if (hasGraphCycle(draft.nodes)) {
      return "Strategy graph must stay directed and non-loopy.";
    }
    return null;
  }, [draft.nodes, draft.title]);
  const stepErrorMessage = (stepId: string) => {
    if (stepId === "sequence") {
      return (
        submitError ??
        validationMessage ??
        (!contractReady
          ? "This can still be saved as a draft. Add the target plus the overview or end state later, then lock it as the contract from the strategy detail page."
          : null)
      );
    }
    return null;
  };

  const sequenceGoals = useMemo(
    () =>
      goals.filter((goal) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [goal.title, goal.description],
          goal.user
        )
      ),
    [goals, sequenceQuery]
  );
  const sequenceProjects = useMemo(
    () =>
      projects.filter((project) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [
            project.title,
            project.description,
            project.goalTitle,
            project.status
          ],
          project.user
        )
      ),
    [projects, sequenceQuery]
  );
  const sequenceTasks = useMemo(
    () =>
      allTasks.filter((task) =>
        matchesOwnedEntityQuery(
          sequenceQuery,
          [task.title, task.description, task.owner, task.status],
          task.user
        )
      ),
    [allTasks, sequenceQuery]
  );
  const targetGoalSet = useMemo(
    () => new Set(draft.targetGoalIds),
    [draft.targetGoalIds]
  );
  const targetProjectSet = useMemo(
    () => new Set(draft.targetProjectIds),
    [draft.targetProjectIds]
  );
  const sequenceEntityKeys = useMemo(
    () =>
      new Set(draft.nodes.map((node) => `${node.entityType}:${node.entityId}`)),
    [draft.nodes]
  );
  const selectedGoals = useMemo(
    () =>
      draft.targetGoalIds
        .map((goalId) => goalsById.get(goalId))
        .filter((goal): goal is DashboardGoal => Boolean(goal)),
    [draft.targetGoalIds, goalsById]
  );
  const selectedProjects = useMemo(
    () =>
      draft.targetProjectIds
        .map((projectId) => projectsById.get(projectId))
        .filter((project): project is ProjectSummary => Boolean(project)),
    [draft.targetProjectIds, projectsById]
  );
  const suggestedProjects = useMemo(
    () =>
      sequenceProjects.filter(
        (project) =>
          targetProjectSet.has(project.id) || targetGoalSet.has(project.goalId)
      ),
    [sequenceProjects, targetGoalSet, targetProjectSet]
  );
  const suggestedTasks = useMemo(
    () =>
      sequenceTasks.filter(
        (task) =>
          targetProjectSet.has(task.projectId ?? "") ||
          targetGoalSet.has(task.goalId ?? "")
      ),
    [sequenceTasks, targetGoalSet, targetProjectSet]
  );
  const limitedObjectiveGoals = useMemo(
    () => objectiveGoals.slice(0, 8),
    [objectiveGoals]
  );
  const limitedObjectiveProjects = useMemo(
    () => objectiveProjects.slice(0, 8),
    [objectiveProjects]
  );
  const limitedContextEntities = useMemo(
    () => linkableEntities.slice(0, 12),
    [linkableEntities]
  );
  const limitedSequenceGoals = useMemo(
    () => sequenceGoals.slice(0, 6),
    [sequenceGoals]
  );
  const limitedSequenceProjects = useMemo(
    () => sequenceProjects.slice(0, 8),
    [sequenceProjects]
  );
  const limitedSequenceTasks = useMemo(
    () => sequenceTasks.slice(0, 10),
    [sequenceTasks]
  );
  const limitedSuggestedProjects = useMemo(
    () => suggestedProjects.slice(0, 4),
    [suggestedProjects]
  );
  const limitedSuggestedTasks = useMemo(
    () => suggestedTasks.slice(0, 6),
    [suggestedTasks]
  );
  const inlineTaskProjects = useMemo(() => {
    if (!inlineTaskDraft.goalId) {
      return projects;
    }
    const matchingProjects = projects.filter(
      (project) => project.goalId === inlineTaskDraft.goalId
    );
    return matchingProjects.length > 0 ? matchingProjects : projects;
  }, [inlineTaskDraft.goalId, projects]);
  const hasSequenceQuery = sequenceQuery.length > 0;
  const hasSequenceResults =
    limitedSequenceGoals.length > 0 ||
    limitedSequenceProjects.length > 0 ||
    limitedSequenceTasks.length > 0;

  const updateNode = (
    nodeId: string,
    patch: Partial<StrategyDialogDraftNode>
  ) => {
    setNodeHistory((current) => [...current.slice(-49), draft.nodes]);
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...patch } : node
      )
    }));
  };

  const appendSequenceNode = (
    entityType: "project" | "task",
    entityId: string
  ) => {
    if (
      draft.nodes.some(
        (node) => node.entityType === entityType && node.entityId === entityId
      )
    ) {
      return;
    }
    setNodeHistory((current) => [...current.slice(-49), draft.nodes]);
    setDraft((current) => {
      const emptyNodeId = current.nodes.find((node) => !node.entityId)?.id;
      return {
        ...current,
        nodes: emptyNodeId
          ? current.nodes.map((node) =>
              node.id === emptyNodeId
                ? {
                    ...node,
                    entityType,
                    entityId
                  }
                : node
            )
          : [
              ...current.nodes,
              createDraftNode(entityType, {
                entityId,
                dependencyMode:
                  current.nodes.length === 0 ? "start" : "after_previous"
              })
            ]
      };
    });
  };

  const removeNode = (nodeId: string) => {
    setNodeHistory((current) => [...current.slice(-49), draft.nodes]);
    setDraft((current) => {
      const remaining = current.nodes.filter((node) => node.id !== nodeId);
      return {
        ...current,
        nodes: remaining.map((node, index) => ({
          ...node,
          dependencyMode:
            index === 0 && node.dependencyMode === "after_previous"
              ? "start"
              : node.dependencyMode,
          customPredecessorIds: node.customPredecessorIds.filter(
            (candidateId) => candidateId !== nodeId
          )
        }))
      };
    });
  };

  const reorderNodes = (activeId: string, overId: string) => {
    const oldIndex = draft.nodes.findIndex((node) => node.id === activeId);
    const newIndex = draft.nodes.findIndex((node) => node.id === overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      return;
    }
    setNodeHistory((current) => [...current.slice(-49), draft.nodes]);
    setDraft((current) => {
      const oldIndex = current.nodes.findIndex((node) => node.id === activeId);
      const newIndex = current.nodes.findIndex((node) => node.id === overId);
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return {
        ...current,
        nodes: arrayMove(current.nodes, oldIndex, newIndex)
      };
    });
  };

  const undoNodes = () => {
    const previousNodes = nodeHistory[nodeHistory.length - 1];
    if (!previousNodes) {
      return;
    }
    setNodeHistory((current) => current.slice(0, -1));
    setDraft((current) => ({ ...current, nodes: previousNodes }));
  };

  const openInlineTaskComposer = () => {
    const seededQuery = sequenceSearchQuery.trim();
    const targetProject =
      draft.targetProjectIds
        .map((projectId) => projectsById.get(projectId))
        .find((project): project is ProjectSummary => Boolean(project)) ??
      projectsById.get(inlineTaskDraft.projectId) ??
      projects[0] ??
      null;
    const nextGoalId = targetProject?.goalId ?? draft.targetGoalIds[0] ?? "";
    const nextProject =
      projects.find(
        (project) =>
          project.goalId === nextGoalId &&
          (targetProject ? project.id === targetProject.id : true)
      ) ??
      projects.find((project) => project.goalId === nextGoalId) ??
      targetProject;

    setInlineTaskDraft((current) => ({
      ...createInlineTaskDraft(defaultUserId, projects),
      title: seededQuery || current.title,
      description: current.description,
      goalId: nextGoalId,
      projectId: nextProject?.id ?? current.projectId,
      userId: nextProject?.userId ?? current.userId ?? defaultUserId
    }));
    setInlineTaskError(null);
    setShowInlineTaskComposer(true);
  };

  const submitInlineTask = async () => {
    const selectedProject = projectsById.get(inlineTaskDraft.projectId);
    if (!inlineTaskDraft.title.trim()) {
      setInlineTaskError("Task title is required.");
      return;
    }
    if (!selectedProject) {
      setInlineTaskError("Pick a project for the new task.");
      return;
    }

    setInlineTaskPending(true);
    setInlineTaskError(null);
    try {
      const taskOwner =
        usersById.get(inlineTaskDraft.userId ?? selectedProject.userId ?? "") ??
        selectedProject.user ??
        selectedStrategyUser ??
        defaultUser;
      const createdTask = (
        await createTask({
          title: inlineTaskDraft.title.trim(),
          description: inlineTaskDraft.description.trim(),
          level: "task",
          owner: taskOwner?.displayName ?? "Albert",
          userId:
            inlineTaskDraft.userId ?? selectedProject.userId ?? draft.userId,
          assigneeUserIds: [],
          goalId: selectedProject.goalId,
          projectId: selectedProject.id,
          parentWorkItemId: null,
          priority: inlineTaskDraft.priority,
          status: "focus",
          effort: inlineTaskDraft.effort,
          energy: inlineTaskDraft.energy,
          dueDate: "",
          points: inlineTaskDraft.points,
          plannedDurationSeconds: 86_400,
          aiInstructions: "",
          executionMode: null,
          acceptanceCriteria: [],
          blockerLinks: [],
          completionReport: null,
          gitRefs: [],
          tagIds: [],
          notes: []
        })
      ).task;

      setCreatedTasks((current) => [createdTask, ...current]);
      appendSequenceNode("task", createdTask.id);
      setInlineTaskDraft({
        ...createInlineTaskDraft(defaultUserId, projects),
        goalId: selectedProject.goalId,
        projectId: selectedProject.id,
        userId: createdTask.userId ?? selectedProject.userId ?? draft.userId
      });
      setSequenceSearchQuery("");
      setShowInlineTaskComposer(false);
    } catch (error) {
      setInlineTaskError(
        error instanceof Error ? error.message : "Task creation failed."
      );
    } finally {
      setInlineTaskPending(false);
    }
  };

  const submitDraft = async () => {
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    try {
      await onSubmit(
        {
          title: draft.title.trim(),
          overview: draft.overview.trim(),
          endStateDescription: draft.endStateDescription.trim(),
          status: draft.status,
          userId: draft.userId,
          targetGoalIds: draft.targetGoalIds,
          targetProjectIds: draft.targetProjectIds,
          linkedEntities: draft.linkedEntities,
          graph: draftGraph
        },
        editingStrategy?.id
      );
      setSubmitError(null);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Strategy save failed."
      );
    }
  };

  const steps: Array<QuestionFlowStep<StrategyDialogDraft>> = [
    {
      id: "foundation",
      eyebrow: "Foundation",
      title: "Set the owner and the strategic frame",
      description:
        "Start with who owns the strategy, what the plan is called, and whether this should open as active, paused, or already landed.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]">
            <FlowField label="Strategy title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                placeholder="Land the multi-user planning system"
              />
            </FlowField>
            <FlowField label="Status">
              <FlowChoiceGrid
                value={value.status}
                onChange={(next) =>
                  setValue({ status: next as Strategy["status"] })
                }
                options={[
                  {
                    value: "active",
                    label: "Active",
                    description: "Use this when the plan should drive work now."
                  },
                  {
                    value: "paused",
                    label: "Paused",
                    description:
                      "Keep the strategy visible without active pressure."
                  },
                  {
                    value: "completed",
                    label: "Completed",
                    description: "The end state is already landed."
                  }
                ]}
              />
            </FlowField>
          </div>

          <UserSelectField
            value={value.userId}
            users={users}
            onChange={(userId) => setValue({ userId })}
            label="Owner user"
            defaultLabel={formatOwnerSelectDefaultLabel(defaultUser)}
            help="Strategies can belong to a human or a bot even when the sequence spans multiple owners."
          />

          <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-accent-soft)] px-5 py-5">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Live posture
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <EntityBadge
                kind="strategy"
                label={value.title.trim() || "Untitled strategy"}
                compact
                gradient={false}
              />
              <Badge className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]">
                {value.status}
              </Badge>
              {selectedStrategyUser ? (
                <UserBadge user={selectedStrategyUser} compact />
              ) : null}
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              This flow is built to keep strategy creation as guided as the
              other major entities in Forge: clear questions first, then a
              focused sequence stage at the end.
            </div>
          </div>
        </>
      )
    },
    {
      id: "objective",
      eyebrow: "Objective",
      title: "Define the objective and the end targets",
      description:
        "Capture what this strategy is coordinating, what done looks like, and which goals or projects are the real targets.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4">
            <FlowField label="Overview">
              <Textarea
                value={value.overview}
                onChange={(event) => setValue({ overview: event.target.value })}
                placeholder="Explain what this strategy is coordinating and why it matters right now."
              />
            </FlowField>
            <FlowField label="End state">
              <Textarea
                value={value.endStateDescription}
                onChange={(event) =>
                  setValue({ endStateDescription: event.target.value })
                }
                placeholder="Describe what reality should look like when this strategy lands."
              />
            </FlowField>
          </div>

          <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] px-5 py-5">
            <FlowField
              label="Search goals or projects"
              description="Keep this page search-first. Add only the targets that truly define what this strategy is trying to land."
            >
              <div className="flex items-center gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
                <Search className="size-4 text-[var(--ui-ink-faint)]" />
                <Input
                  className="border-none bg-transparent px-0 py-0"
                  value={objectiveSearchQuery}
                  onChange={(event) =>
                    setObjectiveSearchQuery(event.target.value)
                  }
                  placeholder="Search goals, projects, owners, humans, or bots"
                />
              </div>
            </FlowField>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Selected goals
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedGoals.length === 0 ? (
                    <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                      No target goals yet
                    </Badge>
                  ) : (
                    selectedGoals.map((goal) => (
                      <button
                        key={goal.id}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--ui-accent-soft)] px-3 py-1.5 text-sm text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-accent-soft-hover)]"
                        onClick={() =>
                          setValue({
                            targetGoalIds: toggleString(
                              value.targetGoalIds,
                              goal.id
                            )
                          })
                        }
                      >
                        <EntityBadge
                          kind="goal"
                          label={goal.title}
                          compact
                          gradient={false}
                        />
                        <span>Remove</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Selected projects
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedProjects.length === 0 ? (
                    <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                      No target projects yet
                    </Badge>
                  ) : (
                    selectedProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--ui-accent-soft)] px-3 py-1.5 text-sm text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-accent-soft-hover)]"
                        onClick={() =>
                          setValue({
                            targetProjectIds: toggleString(
                              value.targetProjectIds,
                              project.id
                            )
                          })
                        }
                      >
                        <EntityBadge
                          kind="project"
                          label={project.title}
                          compact
                          gradient={false}
                        />
                        <span>Remove</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Goal matches
                </div>
                {objectiveQuery ? (
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                    {objectiveGoals.length} found
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3">
                {!objectiveQuery ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Search for the goal this strategy is meant to land.
                  </div>
                ) : limitedObjectiveGoals.length === 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    No goals match this search yet.
                  </div>
                ) : (
                  limitedObjectiveGoals.map((goal) => {
                    const selected = value.targetGoalIds.includes(goal.id);
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        className={cn(
                          "rounded-[22px] border px-4 py-4 text-left transition",
                          selected
                            ? "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onClick={() =>
                          setValue({
                            targetGoalIds: toggleString(
                              value.targetGoalIds,
                              goal.id
                            )
                          })
                        }
                      >
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <EntityName
                            kind="goal"
                            label={goal.title}
                            className="max-w-full min-w-0"
                          />
                          <UserBadge user={goal.user} compact />
                        </div>
                        <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                          {goal.description ||
                            "No strategic note attached yet."}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Project matches
                </div>
                {objectiveQuery ? (
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                    {objectiveProjects.length} found
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3">
                {!objectiveQuery ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Search for the concrete project this strategy should land or
                    organize.
                  </div>
                ) : limitedObjectiveProjects.length === 0 ? (
                  <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    No projects match this search yet.
                  </div>
                ) : (
                  limitedObjectiveProjects.map((project) => {
                    const selected = value.targetProjectIds.includes(
                      project.id
                    );
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={cn(
                          "rounded-[22px] border px-4 py-4 text-left transition",
                          selected
                            ? "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onClick={() =>
                          setValue({
                            targetProjectIds: toggleString(
                              value.targetProjectIds,
                              project.id
                            )
                          })
                        }
                      >
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <EntityName
                            kind="project"
                            label={project.title}
                            className="max-w-full min-w-0"
                            showIcon={false}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                              {project.goalTitle}
                            </Badge>
                            <UserBadge user={project.user} compact />
                          </div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                          {project.description ||
                            "No project summary attached yet."}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "Keep the right supporting entities in view",
      description:
        "Linked entities stay visible in the strategy context without becoming part of the main execution sequence.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Search supporting context"
            description="Search across goals, projects, tasks, habits, and other strategies."
          >
            <div className="flex items-center gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
              <Search className="size-4 text-[var(--ui-ink-faint)]" />
              <Input
                className="border-none bg-transparent px-0 py-0"
                value={contextSearchQuery}
                onChange={(event) => setContextSearchQuery(event.target.value)}
                placeholder="Search by title, owner, @handle, human, or bot"
              />
            </div>
          </FlowField>

          <div className="flex flex-wrap gap-2">
            {value.linkedEntities.length === 0 ? (
              <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]">
                No extra linked context yet
              </Badge>
            ) : (
              value.linkedEntities.map((entity) => {
                const option = linkableEntities.find(
                  (candidate) =>
                    candidate.entityType === entity.entityType &&
                    candidate.entityId === entity.entityId
                );
                return (
                  <button
                    key={`${entity.entityType}:${entity.entityId}`}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--ui-accent-soft)] px-3 py-1.5 text-sm text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-accent-soft-hover)]"
                    onClick={() =>
                      setValue({
                        linkedEntities: value.linkedEntities.filter(
                          (entry) =>
                            !(
                              entry.entityType === entity.entityType &&
                              entry.entityId === entity.entityId
                            )
                        )
                      })
                    }
                  >
                    <Link2 className="mr-1 size-3.5" />
                    {option?.label ?? `${entity.entityType}:${entity.entityId}`}
                    <span>Remove</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="grid gap-3">
            {!contextQuery ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Search when you want to pull another entity into the background
                context. This keeps the page focused instead of dumping every
                record into one long list.
              </div>
            ) : limitedContextEntities.length === 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                No supporting entities match this search yet.
              </div>
            ) : (
              limitedContextEntities.map((option) => {
                const selected = value.linkedEntities.some(
                  (entry) =>
                    entry.entityType === option.entityType &&
                    entry.entityId === option.entityId
                );
                return (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-[20px] border px-4 py-4",
                      selected
                        ? "border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[var(--ui-accent-soft)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
                    )}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <EntityBadge
                          kind={option.entityType}
                          label={option.label}
                          compact
                          gradient={false}
                        />
                        {option.user ? (
                          <UserBadge user={option.user} compact />
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {option.description}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setValue({
                          linkedEntities: toggleLinkedEntity(
                            value.linkedEntities,
                            {
                              entityType: option.entityType,
                              entityId: option.entityId
                            }
                          )
                        })
                      }
                    />
                  </label>
                );
              })
            )}
          </div>
        </>
      )
    },
    {
      id: "sequence",
      eyebrow: "Sequence",
      title: "Build the execution sequence",
      description: "Search, add steps, and create missing tasks.",
      render: () => (
        <StrategySequenceBuilder
          draft={draft}
          setDraft={setDraft}
          sequenceSearchQuery={sequenceSearchQuery}
          setSequenceSearchQuery={setSequenceSearchQuery}
          openInlineTaskComposer={openInlineTaskComposer}
          showInlineTaskComposer={showInlineTaskComposer}
          setShowInlineTaskComposer={setShowInlineTaskComposer}
          inlineTaskDraft={inlineTaskDraft}
          setInlineTaskDraft={setInlineTaskDraft}
          inlineTaskError={inlineTaskError}
          setInlineTaskError={setInlineTaskError}
          inlineTaskPending={inlineTaskPending}
          submitInlineTask={() => void submitInlineTask()}
          defaultUserId={defaultUserId}
          goals={goals}
          projects={projects}
          inlineTaskProjects={inlineTaskProjects}
          projectsById={projectsById}
          tasksById={tasksById}
          usersById={usersById}
          goalsById={goalsById}
          sequenceEntityKeys={sequenceEntityKeys}
          hasSequenceQuery={hasSequenceQuery}
          hasSequenceResults={hasSequenceResults}
          limitedSequenceGoals={limitedSequenceGoals}
          limitedSequenceProjects={limitedSequenceProjects}
          limitedSequenceTasks={limitedSequenceTasks}
          limitedSuggestedProjects={limitedSuggestedProjects}
          limitedSuggestedTasks={limitedSuggestedTasks}
          appendSequenceNode={appendSequenceNode}
          updateNode={updateNode}
          removeNode={removeNode}
          reorderNodes={reorderNodes}
          undoNodes={undoNodes}
          canUndoNodes={nodeHistory.length > 0}
          contractChecks={contractChecks}
          alignmentBreakdown={alignmentBreakdown}
        />
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Strategy"
      title={editingStrategy ? "Edit strategy" : "Create strategy"}
      description="Strategies connect goals, projects, and tasks into a guided multi-step plan with a focused sequence builder at the end."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        editingStrategy ? `strategy.${editingStrategy.id}` : "strategy.new"
      }
      steps={steps}
      initialStepId={initialStepId}
      contentClassName="lg:h-[min(56rem,calc(100vh-1rem))] lg:w-[min(78rem,calc(100vw-1.5rem))]"
      submitLabel={
        editingStrategy
          ? contractReady
            ? "Save strategy"
            : "Save draft"
          : contractReady
            ? "Create strategy"
            : "Create draft"
      }
      pending={pending}
      pendingLabel="Saving strategy"
      resolveError={stepErrorMessage}
      onSubmit={submitDraft}
    />
  );
}
