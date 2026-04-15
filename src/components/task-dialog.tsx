import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { defaultGoalValues } from "@/components/goal-dialog";
import { InlineNoteFields } from "@/components/notes/inline-note-fields";
import { defaultProjectValues } from "@/components/project-dialog";
import { Badge } from "@/components/ui/badge";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { createGoal, createProject, createWorkItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { quickTaskSchema, type QuickTaskInput } from "@/lib/schemas";
import type {
  Goal,
  ProjectSummary,
  Tag,
  Task,
  UserSummary,
  WorkItemLevel
} from "@/lib/types";
import { formatOwnerSelectDefaultLabel } from "@/lib/user-ownership";
import { cn } from "@/lib/utils";

export const defaultTaskValues: QuickTaskInput = {
  title: "",
  description: "",
  level: "task",
  owner: "Albert",
  userId: null,
  assigneeUserIds: [],
  goalId: "",
  projectId: "",
  parentWorkItemId: null,
  priority: "medium",
  status: "focus",
  effort: "deep",
  energy: "steady",
  dueDate: "",
  points: 60,
  plannedDurationSeconds: 86_400,
  actionCostBand: "standard",
  aiInstructions: "",
  executionMode: null,
  acceptanceCriteria: [],
  blockerLinks: [],
  completionReport: null,
  gitRefs: [],
  tagIds: [],
  notes: []
};

const EMPTY_WORK_ITEMS: Task[] = [];

function parseMultilineList(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildCompletionReport(options: {
  modifiedFiles: string[];
  workSummary: string;
  linkedGitRefIds: string[];
}) {
  if (
    options.modifiedFiles.length === 0 &&
    options.workSummary.trim().length === 0 &&
    options.linkedGitRefIds.length === 0
  ) {
    return null;
  }
  return {
    modifiedFiles: options.modifiedFiles,
    workSummary: options.workSummary,
    linkedGitRefIds: options.linkedGitRefIds
  };
}

type AnchorKind = "goal" | "project" | "issue" | "task";

type ExistingAnchorOption = {
  id: string;
  kind: AnchorKind;
  mode: "existing";
  entityId: string;
  label: string;
  description: string;
  searchText: string;
  goalId: string | null;
  projectId: string | null;
  parentWorkItemId: string | null;
};

type CreateAnchorOption = {
  id: string;
  kind: AnchorKind;
  mode: "create";
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
};

type AnchorOption = ExistingAnchorOption | CreateAnchorOption;

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function getAllowedAnchorKinds(level: WorkItemLevel): AnchorKind[] {
  if (level === "issue") {
    return ["goal", "project"];
  }
  if (level === "task") {
    return ["goal", "project", "issue"];
  }
  return ["goal", "project", "task"];
}

function getCreatableAnchorKinds(level: WorkItemLevel): AnchorKind[] {
  if (level === "issue") {
    return ["goal", "project"];
  }
  if (level === "task") {
    return ["goal", "project", "issue"];
  }
  return ["goal", "project"];
}

function anchorKindToEntityKind(kind: AnchorKind) {
  return kind === "task" ? "task" : kind;
}

function buildTaskDraft(options: {
  editingTask: Task | null;
  initialProjectId?: string | null;
  initialGoalId?: string | null;
  initialParentWorkItemId?: string | null;
  initialLevel?: QuickTaskInput["level"];
  defaultUserId?: string | null;
  projects: ProjectSummary[];
  users: UserSummary[];
  workItems: Task[];
}): QuickTaskInput {
  const {
    editingTask,
    initialGoalId,
    initialLevel,
    initialParentWorkItemId,
    initialProjectId,
    defaultUserId,
    projects,
    users,
    workItems
  } = options;

  if (editingTask) {
    return taskToFormValues(editingTask);
  }

  const parent =
    initialParentWorkItemId
      ? workItems.find((item) => item.id === initialParentWorkItemId) ?? null
      : null;
  const project =
    projects.find((entry) => entry.id === (parent?.projectId ?? initialProjectId)) ??
    null;
  const userId = project?.userId ?? defaultUserId ?? null;

  return {
    ...defaultTaskValues,
    level:
      initialLevel ??
      (parent?.level === "issue"
        ? "task"
        : parent?.level === "task"
          ? "subtask"
          : defaultTaskValues.level),
    owner:
      users.find((user) => user.id === userId)?.displayName ??
      defaultTaskValues.owner,
    userId,
    goalId: parent?.goalId ?? project?.goalId ?? initialGoalId ?? "",
    projectId: project?.id ?? "",
    parentWorkItemId: parent?.id ?? null
  };
}

function buildSelectedAnchorOptions(options: {
  draft: QuickTaskInput;
  goals: Goal[];
  projects: ProjectSummary[];
  workItems: Task[];
}): ExistingAnchorOption[] {
  const { draft, goals, projects, workItems } = options;
  const selected: ExistingAnchorOption[] = [];

  if (draft.goalId) {
    const goal = goals.find((entry) => entry.id === draft.goalId);
    if (goal) {
      selected.push({
        id: `goal:${goal.id}`,
        kind: "goal",
        mode: "existing",
        entityId: goal.id,
        label: goal.title,
        description: "Goal",
        searchText: normalize(`${goal.title} ${goal.description}`),
        goalId: goal.id,
        projectId: null,
        parentWorkItemId: null
      });
    }
  }

  if (draft.projectId) {
    const project = projects.find((entry) => entry.id === draft.projectId);
    if (project) {
      selected.push({
        id: `project:${project.id}`,
        kind: "project",
        mode: "existing",
        entityId: project.id,
        label: project.title,
        description: "Project",
        searchText: normalize(
          `${project.title} ${project.description} ${project.goalTitle}`
        ),
        goalId: project.goalId,
        projectId: project.id,
        parentWorkItemId: null
      });
    }
  }

  if (draft.parentWorkItemId) {
    const parent = workItems.find((entry) => entry.id === draft.parentWorkItemId);
    if (parent) {
      selected.push({
        id: `${parent.level}:${parent.id}`,
        kind: parent.level === "issue" ? "issue" : "task",
        mode: "existing",
        entityId: parent.id,
        label: parent.title,
        description: parent.level === "issue" ? "Issue" : "Task",
        searchText: normalize(
          `${parent.title} ${parent.description} ${parent.aiInstructions}`
        ),
        goalId: parent.goalId,
        projectId: parent.projectId,
        parentWorkItemId: parent.parentWorkItemId
      });
    }
  }

  return selected;
}

function buildExistingAnchorOptions(options: {
  goals: Goal[];
  projects: ProjectSummary[];
  workItems: Task[];
  allowedKinds: AnchorKind[];
  editingTaskId?: string;
}): ExistingAnchorOption[] {
  const { goals, projects, workItems, allowedKinds, editingTaskId } = options;
  const anchors: ExistingAnchorOption[] = [];

  if (allowedKinds.includes("goal")) {
    anchors.push(
      ...goals.map((goal) => ({
        id: `goal:${goal.id}`,
        kind: "goal" as const,
        mode: "existing" as const,
        entityId: goal.id,
        label: goal.title,
        description: "Goal",
        searchText: normalize(`${goal.title} ${goal.description}`),
        goalId: goal.id,
        projectId: null,
        parentWorkItemId: null
      }))
    );
  }

  if (allowedKinds.includes("project")) {
    anchors.push(
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        kind: "project" as const,
        mode: "existing" as const,
        entityId: project.id,
        label: project.title,
        description: `Project · ${project.goalTitle}`,
        searchText: normalize(
          `${project.title} ${project.description} ${project.goalTitle} ${project.productRequirementsDocument}`
        ),
        goalId: project.goalId,
        projectId: project.id,
        parentWorkItemId: null
      }))
    );
  }

  if (allowedKinds.includes("issue")) {
    anchors.push(
      ...workItems
        .filter((item) => item.level === "issue" && item.id !== editingTaskId)
        .map((item) => ({
          id: `issue:${item.id}`,
          kind: "issue" as const,
          mode: "existing" as const,
          entityId: item.id,
          label: item.title,
          description: "Issue",
          searchText: normalize(
            `${item.title} ${item.description} ${item.aiInstructions} ${item.executionMode ?? ""}`
          ),
          goalId: item.goalId,
          projectId: item.projectId,
          parentWorkItemId: null
        }))
    );
  }

  if (allowedKinds.includes("task")) {
    anchors.push(
      ...workItems
        .filter((item) => item.level === "task" && item.id !== editingTaskId)
        .map((item) => ({
          id: `task:${item.id}`,
          kind: "task" as const,
          mode: "existing" as const,
          entityId: item.id,
          label: item.title,
          description: "Task",
          searchText: normalize(
            `${item.title} ${item.description} ${item.aiInstructions} ${item.executionMode ?? ""}`
          ),
          goalId: item.goalId,
          projectId: item.projectId,
          parentWorkItemId: item.parentWorkItemId
        }))
    );
  }

  return anchors;
}

function applyAnchorSelection(
  current: QuickTaskInput,
  option: ExistingAnchorOption,
  workItems: Task[]
): Partial<QuickTaskInput> {
  if (option.kind === "goal") {
    const currentProject = current.projectId
      ? workItems.find((item) => item.projectId === current.projectId) ?? null
      : null;
    const projectStillMatches =
      !current.projectId ||
      currentProject?.goalId === option.entityId ||
      option.goalId === current.goalId;
    return {
      goalId: option.entityId,
      projectId: projectStillMatches ? current.projectId : "",
      parentWorkItemId: projectStillMatches ? current.parentWorkItemId : null
    };
  }

  if (option.kind === "project") {
    const currentParent = current.parentWorkItemId
      ? workItems.find((item) => item.id === current.parentWorkItemId) ?? null
      : null;
    return {
      goalId: option.goalId ?? current.goalId,
      projectId: option.entityId,
      parentWorkItemId:
        !currentParent || currentParent.projectId === option.entityId
          ? current.parentWorkItemId
          : null
    };
  }

  return {
    goalId: option.goalId ?? current.goalId,
    projectId: option.projectId ?? current.projectId,
    parentWorkItemId: option.entityId
  };
}

function clearAnchorSelection(
  kind: AnchorKind
): Partial<QuickTaskInput> {
  if (kind === "goal") {
    return { goalId: "", projectId: "", parentWorkItemId: null };
  }
  if (kind === "project") {
    return { projectId: "", parentWorkItemId: null };
  }
  return { parentWorkItemId: null };
}

function taskToFormValues(task: Task): QuickTaskInput {
  return {
    title: task.title,
    description: task.description,
    level: task.level,
    owner: task.owner,
    userId: task.userId ?? null,
    assigneeUserIds: task.assigneeUserIds ?? [],
    goalId: task.goalId ?? "",
    projectId: task.projectId ?? "",
    parentWorkItemId: task.parentWorkItemId ?? null,
    priority: task.priority,
    status: task.status,
    effort: task.effort,
    energy: task.energy,
    dueDate: task.dueDate ?? "",
    points: task.points,
    plannedDurationSeconds: task.plannedDurationSeconds ?? 86_400,
    actionCostBand: task.actionPointSummary?.costBand ?? "standard",
    aiInstructions: task.aiInstructions,
    executionMode: task.executionMode,
    acceptanceCriteria: task.acceptanceCriteria,
    blockerLinks: task.blockerLinks,
    completionReport: task.completionReport,
    gitRefs: task.gitRefs,
    tagIds: task.tagIds,
    notes: []
  };
}

export function TaskDialog({
  open,
  goals,
  projects,
  workItems,
  tags,
  users,
  editingTask,
  initialProjectId,
  initialGoalId,
  initialParentWorkItemId,
  initialLevel,
  initialStepId,
  defaultUserId = null,
  onRefreshEntities,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  goals: Goal[];
  projects: ProjectSummary[];
  workItems?: Task[];
  tags: Tag[];
  users?: UserSummary[];
  editingTask: Task | null;
  initialProjectId?: string | null;
  initialGoalId?: string | null;
  initialParentWorkItemId?: string | null;
  initialLevel?: QuickTaskInput["level"];
  initialStepId?: string;
  defaultUserId?: string | null;
  onRefreshEntities?: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: QuickTaskInput, taskId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const safeGoals = goals ?? [];
  const safeProjects = projects ?? [];
  const safeWorkItems = workItems ?? EMPTY_WORK_ITEMS;
  const safeTags = tags ?? [];
  const safeUsers = users ?? [];
  const [draft, setDraft] = useState<QuickTaskInput>(defaultTaskValues);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [anchorQuery, setAnchorQuery] = useState("");
  const [anchorOpen, setAnchorOpen] = useState(false);
  const [anchorHighlightedIndex, setAnchorHighlightedIndex] = useState(0);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [anchorCreatePendingId, setAnchorCreatePendingId] =
    useState<string | null>(null);

  const updateFieldErrors = (errors: Record<string, string[] | undefined>) => {
    setFieldErrors(
      Object.fromEntries(
        Object.entries(errors).map(([key, value]) => [key, value?.[0]])
      )
    );
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    setSubmitError(null);
    setFieldErrors({});
    setAnchorQuery("");
    setAnchorOpen(false);
    setAnchorHighlightedIndex(0);
    setAnchorError(null);
    setAnchorCreatePendingId(null);

    setDraft(
      buildTaskDraft({
        editingTask,
        initialGoalId,
        initialLevel,
        initialParentWorkItemId,
        initialProjectId,
        defaultUserId,
        projects: safeProjects,
        users: safeUsers,
        workItems: safeWorkItems
      })
    );
  }, [
    defaultUserId,
    editingTask,
    initialGoalId,
    initialLevel,
    initialParentWorkItemId,
    initialProjectId,
    open,
    safeProjects,
    safeUsers,
    safeWorkItems
  ]);

  const selectedProject = useMemo(
    () =>
      safeProjects.find((project) => project.id === draft.projectId) ?? null,
    [draft.projectId, safeProjects]
  );
  const allowedAnchorKinds = useMemo(
    () => getAllowedAnchorKinds(draft.level),
    [draft.level]
  );
  const creatableAnchorKinds = useMemo(
    () => getCreatableAnchorKinds(draft.level),
    [draft.level]
  );
  const selectedAnchorOptions = useMemo(
    () =>
      buildSelectedAnchorOptions({
        draft,
        goals: safeGoals,
        projects: safeProjects,
        workItems: safeWorkItems
      }),
    [draft, safeGoals, safeProjects, safeWorkItems]
  );
  const availableAnchorOptions = useMemo(
    () =>
      buildExistingAnchorOptions({
        goals: safeGoals,
        projects: safeProjects,
        workItems: safeWorkItems,
        allowedKinds: allowedAnchorKinds,
        editingTaskId: editingTask?.id
      }),
    [allowedAnchorKinds, editingTask?.id, safeGoals, safeProjects, safeWorkItems]
  );
  const anchorSuggestions = useMemo<AnchorOption[]>(() => {
    const normalizedQuery = normalize(anchorQuery);
    const matchingExisting =
      normalizedQuery.length === 0
        ? availableAnchorOptions.slice(0, 8)
        : availableAnchorOptions
            .filter((option) => option.searchText.includes(normalizedQuery))
            .slice(0, 8);

    if (normalizedQuery.length === 0) {
      return matchingExisting;
    }

    const createSuggestions = creatableAnchorKinds.map((kind) => {
      if (kind === "project" && !draft.goalId) {
        return {
          id: `create:${kind}:${normalizedQuery}`,
          kind,
          mode: "create" as const,
          label: anchorQuery.trim(),
          description: "Pick or create a goal first, then create a project here.",
          disabled: true,
          disabledReason: "Pick or create a goal first."
        };
      }
      if (kind === "issue" && !draft.projectId) {
        return {
          id: `create:${kind}:${normalizedQuery}`,
          kind,
          mode: "create" as const,
          label: anchorQuery.trim(),
          description: "Pick or create a project first, then create an issue here.",
          disabled: true,
          disabledReason: "Pick or create a project first."
        };
      }
      return {
        id: `create:${kind}:${normalizedQuery}`,
        kind,
        mode: "create" as const,
        label: anchorQuery.trim(),
        description: `Create a new ${kind} from "${anchorQuery.trim()}".`
      };
    });

    return [...matchingExisting, ...createSuggestions];
  }, [
    anchorQuery,
    availableAnchorOptions,
    creatableAnchorKinds,
    draft.goalId,
    draft.projectId
  ]);
  const suggestedUser =
    safeUsers.find(
      (user) => user.id === (selectedProject?.userId ?? defaultUserId)
    ) ?? null;

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (draft.goalId !== selectedProject.goalId) {
      setDraft((current) => ({ ...current, goalId: selectedProject.goalId }));
    }
  }, [draft.goalId, selectedProject]);

  const selectAnchor = (option: ExistingAnchorOption) => {
    setDraft((current) => ({
      ...current,
      ...applyAnchorSelection(current, option, safeWorkItems)
    }));
    setAnchorQuery("");
    setAnchorError(null);
    setAnchorHighlightedIndex(0);
    setAnchorOpen(false);
  };

  const removeAnchor = (kind: AnchorKind) => {
    setDraft((current) => ({
      ...current,
      ...clearAnchorSelection(kind)
    }));
    setAnchorError(null);
  };

  const createAnchor = async (option: CreateAnchorOption) => {
    if (option.disabled) {
      setAnchorError(option.disabledReason ?? option.description);
      return;
    }

    const title = option.label.trim();
    if (!title) {
      return;
    }

    setAnchorCreatePendingId(option.id);
    setAnchorError(null);

    try {
      if (option.kind === "goal") {
        const response = await createGoal({
          ...defaultGoalValues,
          title,
          userId: draft.userId ?? null
        });
        await onRefreshEntities?.();
        selectAnchor({
          id: `goal:${response.goal.id}`,
          kind: "goal",
          mode: "existing",
          entityId: response.goal.id,
          label: response.goal.title,
          description: "Goal",
          searchText: normalize(`${response.goal.title} ${response.goal.description}`),
          goalId: response.goal.id,
          projectId: null,
          parentWorkItemId: null
        });
        return;
      }

      if (option.kind === "project") {
        if (!draft.goalId) {
          throw new Error("Pick or create a goal first.");
        }
        const response = await createProject({
          ...defaultProjectValues,
          goalId: draft.goalId,
          title,
          userId: draft.userId ?? null,
          assigneeUserIds: draft.assigneeUserIds
        });
        await onRefreshEntities?.();
        selectAnchor({
          id: `project:${response.project.id}`,
          kind: "project",
          mode: "existing",
          entityId: response.project.id,
          label: response.project.title,
          description: "Project",
          searchText: normalize(
            `${response.project.title} ${response.project.description}`
          ),
          goalId: response.project.goalId,
          projectId: response.project.id,
          parentWorkItemId: null
        });
        return;
      }

      if (option.kind === "issue") {
        if (!draft.projectId) {
          throw new Error("Pick or create a project first.");
        }
        const response = await createWorkItem({
          ...defaultTaskValues,
          level: "issue",
          title,
          owner: draft.owner,
          userId: draft.userId ?? null,
          assigneeUserIds: draft.assigneeUserIds,
          goalId: draft.goalId,
          projectId: draft.projectId,
          executionMode: "afk"
        });
        await onRefreshEntities?.();
        selectAnchor({
          id: `issue:${response.workItem.id}`,
          kind: "issue",
          mode: "existing",
          entityId: response.workItem.id,
          label: response.workItem.title,
          description: "Issue",
          searchText: normalize(
            `${response.workItem.title} ${response.workItem.description}`
          ),
          goalId: response.workItem.goalId,
          projectId: response.workItem.projectId,
          parentWorkItemId: null
        });
      }
    } catch (error) {
      setAnchorError(
        error instanceof Error
          ? error.message
          : "Unable to create that linked entity right now."
      );
    } finally {
      setAnchorCreatePendingId(null);
    }
  };

  const steps: Array<QuestionFlowStep<QuickTaskInput>> = [
    {
      id: "anchor",
      eyebrow: "Placement",
      title: "Choose where this work belongs",
      description:
        "Anchor the work through the hierarchy. Tasks can carry a goal, project, and issue parent together so the chain of meaning stays explicit.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Hierarchy anchors"
            labelHelp="Pick the goal and project anchors, then choose the real parent where needed. Tasks can live under issues, subtasks under tasks."
            error={fieldErrors.projectId ?? null}
          >
            <div className="grid gap-3">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                {selectedAnchorOptions.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {selectedAnchorOptions.map((option) => (
                      <span
                        key={option.id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5"
                      >
                        <EntityBadge
                          kind={anchorKindToEntityKind(option.kind)}
                          label={option.label}
                          compact
                          gradient={false}
                          className="max-w-[16rem]"
                        />
                        <button
                          type="button"
                          className="rounded-full text-white/52 transition hover:text-white"
                          onClick={() => removeAnchor(option.kind)}
                          aria-label={`Remove ${option.label}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="relative">
                  <div className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                    <Search className="size-4 text-white/36" />
                    <input
                      value={anchorQuery}
                      onChange={(event) => {
                        setAnchorQuery(event.target.value);
                        setAnchorOpen(true);
                        setAnchorHighlightedIndex(0);
                        setAnchorError(null);
                      }}
                      onFocus={() => setAnchorOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setAnchorOpen(false), 120);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Backspace" &&
                          !anchorQuery &&
                          selectedAnchorOptions.length > 0
                        ) {
                          removeAnchor(
                            selectedAnchorOptions[selectedAnchorOptions.length - 1]!.kind
                          );
                          return;
                        }

                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setAnchorOpen(true);
                          setAnchorHighlightedIndex((current) =>
                            anchorSuggestions.length === 0
                              ? 0
                              : Math.min(anchorSuggestions.length - 1, current + 1)
                          );
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setAnchorHighlightedIndex((current) =>
                            Math.max(0, current - 1)
                          );
                          return;
                        }

                        if (event.key === "Escape") {
                          setAnchorOpen(false);
                          return;
                        }

                        if (
                          event.key === "Enter" &&
                          anchorSuggestions[anchorHighlightedIndex]
                        ) {
                          event.preventDefault();
                          const suggestion =
                            anchorSuggestions[anchorHighlightedIndex]!;
                          if (suggestion.mode === "existing") {
                            selectAnchor(suggestion);
                          } else {
                            void createAnchor(suggestion);
                          }
                        }
                      }}
                      placeholder='Search or create Goal, Project, or parent Issue like Goal + "Creative system"'
                      className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
                    />
                  </div>

                  {anchorOpen ? (
                    <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-white/8 bg-[rgba(8,13,24,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
                      {anchorSuggestions.length > 0 ? (
                        anchorSuggestions.map((suggestion, index) => (
                          <button
                            key={suggestion.id}
                            type="button"
                            disabled={
                              suggestion.mode === "create" && suggestion.disabled
                            }
                            className={cn(
                              "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                              index === anchorHighlightedIndex
                                ? "bg-white/[0.1] text-white"
                                : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                              suggestion.mode === "create" &&
                                suggestion.disabled &&
                                "cursor-not-allowed opacity-45"
                            )}
                            onMouseEnter={() => setAnchorHighlightedIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              if (suggestion.mode === "existing") {
                                selectAnchor(suggestion);
                                return;
                              }
                              void createAnchor(suggestion);
                            }}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <EntityBadge
                                  kind={anchorKindToEntityKind(suggestion.kind)}
                                  label={
                                    suggestion.mode === "create"
                                      ? `Create ${suggestion.kind}`
                                      : suggestion.label
                                  }
                                  compact
                                  gradient={false}
                                />
                                {suggestion.mode === "create" ? (
                                  <Badge className="bg-white/[0.08] text-white/70">
                                    "{suggestion.label}"
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-white/46">
                                {suggestion.description}
                              </div>
                            </div>
                            {suggestion.mode === "create" ? (
                              <span className="rounded-full bg-[var(--primary)]/12 p-2 text-[var(--primary)]">
                                <Plus className="size-3.5" />
                              </span>
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2.5 text-sm text-white/42">
                          Type to find an existing anchor or create a new one.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

	                {anchorError ? (
	                  <div className="mt-3 rounded-[16px] border border-rose-400/16 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
	                    {anchorError}
	                  </div>
	                ) : null}
	              </div>
	            </div>
	          </FlowField>
	          <div className="grid gap-3 md:grid-cols-2">
            <FlowField label="Resolved project">
              <Input
                readOnly
                value={selectedProject?.title ?? ""}
                placeholder="Select or create a project anchor"
              />
            </FlowField>
            <FlowField label="Resolved goal">
              <Input
                readOnly
                value={
                  safeGoals.find((goal) => goal.id === value.goalId)?.title ?? ""
                }
                placeholder="Select or create a goal anchor"
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "shape",
      eyebrow: "Shape",
      title: "Define the next concrete move",
      description:
        "Keep the task small enough to be actionable and strong enough to clearly move the project forward.",
      render: (value, setValue) => (
        <>
          <FlowField label="Hierarchy level" error={fieldErrors.level ?? null}>
            <FlowChoiceGrid
              value={value.level}
              onChange={(next) =>
                setValue({ level: next as QuickTaskInput["level"] })
              }
              options={[
                {
                  value: "issue",
                  label: "Issue",
                  description: "Vertical slice with AFK or HITL execution mode."
                },
                {
                  value: "task",
                  label: "Task",
                  description: "One focused AI session with direct instructions."
                },
                {
                  value: "subtask",
                  label: "Subtask",
                  description: "A lightweight child step under a task."
                }
              ]}
            />
          </FlowField>
          <FlowField
            label={t("common.dialogs.task.title")}
            error={fieldErrors.title ?? null}
          >
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Draft the first mode atlas sketch"
            />
          </FlowField>
          <FlowField label={t("common.dialogs.task.descriptionLabel")}>
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="Write the task description in Markdown. Keep it short or turn it into a full acceptance doc."
            />
          </FlowField>
          {value.level === "issue" || value.level === "task" ? (
            <>
              <FlowField label="Execution mode">
                <FlowChoiceGrid
                  value={value.executionMode ?? "afk"}
                  onChange={(next) =>
                    setValue({
                      executionMode:
                        next as NonNullable<QuickTaskInput["executionMode"]>
                    })
                  }
                  options={[
                    {
                      value: "afk",
                      label: "AFK",
                      description:
                        "AI can complete the issue flow without waiting on a human decision."
                    },
                    {
                      value: "hitl",
                      label: "HITL",
                      description:
                        "A human decision is required somewhere in the slice."
                    }
                  ]}
                />
              </FlowField>
              <FlowField label="Acceptance criteria">
                <Textarea
                  value={value.acceptanceCriteria.join("\n")}
                  onChange={(event) =>
                    setValue({
                      acceptanceCriteria: event.target.value
                        .split("\n")
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 0)
                    })
                  }
                  placeholder="Given ... / When ... / Then ..."
                />
              </FlowField>
            </>
          ) : null}
          {value.level !== "issue" ? (
            <FlowField label="AI instructions">
              <Textarea
                value={value.aiInstructions}
                onChange={(event) =>
                  setValue({ aiInstructions: event.target.value })
                }
                placeholder="Tell the executing agent which files and patterns matter, and what finished work looks like."
              />
            </FlowField>
          ) : null}
          <FlowField
            label={t("common.dialogs.task.owner")}
            labelHelp="The owner is the person or role expected to carry this task."
            error={fieldErrors.owner ?? null}
          >
            <Input
              value={value.owner}
              onChange={(event) => setValue({ owner: event.target.value })}
              placeholder="Albert"
            />
          </FlowField>
          <UserSelectField
            value={value.userId}
            users={safeUsers}
            onChange={(userId) =>
              setValue({
                userId,
                owner:
                  safeUsers.find((user) => user.id === userId)?.displayName ??
                  value.owner
              })
            }
            label="Owner user"
            defaultLabel={formatOwnerSelectDefaultLabel(suggestedUser)}
            help="Tasks can belong to a human or bot user. The linked project owner is suggested first so cross-user task routing stays explicit."
          />
          <FlowField label="Assignees">
            <select
              multiple
              value={value.assigneeUserIds}
              onChange={(event) =>
                setValue({
                  assigneeUserIds: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value
                  )
                })
              }
              className="min-h-28 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
            >
              {safeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} · {user.kind}
                </option>
              ))}
            </select>
          </FlowField>
        </>
      )
    },
    {
      id: "execution",
      eyebrow: "Execution",
      title: "Set priority, status, effort, and energy",
      description:
        "This is the minimum the execution engine needs in order to place the task well and show the right next move.",
      render: (value, setValue) => (
        <>
          <FlowField
            label={t("common.dialogs.task.priority")}
            labelHelp="Priority controls how strongly Forge should surface this task in the board and daily views."
          >
            <FlowChoiceGrid
              value={value.priority}
              onChange={(next) =>
                setValue({ priority: next as QuickTaskInput["priority"] })
              }
              options={[
                { value: "low", label: t("common.enums.priority.low") },
                { value: "medium", label: t("common.enums.priority.medium") },
                { value: "high", label: t("common.enums.priority.high") },
                {
                  value: "critical",
                  label: t("common.enums.priority.critical")
                }
              ]}
            />
          </FlowField>
          <FlowField
            label={t("common.dialogs.task.status")}
            labelHelp="Status tells Forge whether the task is waiting, ready for focus, active, blocked, or done."
          >
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) =>
                setValue({ status: next as QuickTaskInput["status"] })
              }
              options={[
                {
                  value: "backlog",
                  label: t("common.enums.taskStatus.backlog")
                },
                { value: "focus", label: t("common.enums.taskStatus.focus") },
                {
                  value: "in_progress",
                  label: t("common.enums.taskStatus.in_progress")
                },
                {
                  value: "blocked",
                  label: t("common.enums.taskStatus.blocked")
                }
              ]}
            />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label={t("common.dialogs.task.effort")}
              labelHelp="Effort describes how much concentration and time this task usually needs."
            >
              <FlowChoiceGrid
                value={value.effort}
                onChange={(next) =>
                  setValue({ effort: next as QuickTaskInput["effort"] })
                }
                options={[
                  { value: "light", label: t("common.enums.effort.light") },
                  { value: "deep", label: t("common.enums.effort.deep") },
                  {
                    value: "marathon",
                    label: t("common.enums.effort.marathon")
                  }
                ]}
              />
            </FlowField>
            <FlowField
              label={t("common.dialogs.task.energy")}
              labelHelp="Energy helps you match this task to a low-energy, steady, or high-energy moment."
            >
              <FlowChoiceGrid
                value={value.energy}
                onChange={(next) =>
                  setValue({ energy: next as QuickTaskInput["energy"] })
                }
                options={[
                  { value: "low", label: t("common.enums.energy.low") },
                  { value: "steady", label: t("common.enums.energy.steady") },
                  { value: "high", label: t("common.enums.energy.high") }
                ]}
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "signal",
      eyebrow: "Reward and timing",
      title: "Set the reward and timing details",
      description:
        "This keeps the daily surfaces honest without forcing you through a bloated last-mile form.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label={t("common.dialogs.task.xp")}
              labelHelp="XP is the reward weight for finishing this task. Higher XP should mean more meaningful work."
              error={fieldErrors.points ?? null}
            >
              <Input
                type="number"
                value={value.points}
                onChange={(event) =>
                  setValue({ points: Number(event.target.value) || 0 })
                }
                placeholder="60"
              />
            </FlowField>
            <FlowField
              label={t("common.dialogs.task.dueDate")}
              labelHelp="Only add a due date when timing really matters for this task."
            >
              <Input
                type="date"
                value={value.dueDate}
                onChange={(event) => setValue({ dueDate: event.target.value })}
              />
            </FlowField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label="Expected duration"
              labelHelp="Life Force uses this as the expected shape of the task. The default is one day."
              error={fieldErrors.plannedDurationSeconds ?? null}
            >
              <Input
                type="number"
                min={15}
                max={7 * 24 * 60}
                step={15}
                value={Math.max(
                  15,
                  Math.round((value.plannedDurationSeconds ?? 86_400) / 60)
                )}
                onChange={(event) =>
                  setValue({
                    plannedDurationSeconds: Math.max(
                      60,
                      (Number(event.target.value) || 24 * 60) * 60
                    )
                  })
                }
              />
            </FlowField>
            <FlowField
              label="Action cost"
              labelHelp="Choose a simple AP band now. Advanced AP editing can happen later inside the task."
            >
              <FlowChoiceGrid
                value={value.actionCostBand ?? "standard"}
                onChange={(next) =>
                  setValue({
                    actionCostBand:
                      next as NonNullable<QuickTaskInput["actionCostBand"]>
                  })
                }
                options={[
                  { value: "tiny", label: "Tiny" },
                  { value: "light", label: "Light" },
                  { value: "standard", label: "Standard" },
                  { value: "heavy", label: "Heavy" },
                  { value: "brutal", label: "Brutal" }
                ]}
              />
            </FlowField>
          </div>
          <FlowField label={t("common.dialogs.task.tags")}>
            <div className="flex flex-wrap gap-2">
              {safeTags.map((tag) => {
                const selected = value.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-white/16 text-white" : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white"}`}
                    onClick={() =>
                      setValue({
                        tagIds: selected
                          ? value.tagIds.filter((entry) => entry !== tag.id)
                          : [...value.tagIds, tag.id]
                      })
                    }
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </FlowField>
        </>
      )
    },
    {
      id: "notes",
      eyebrow: "Closeout",
      title: "Capture what changed when the work is done",
      description:
        "Completion stays truthful when the closeout records modified files, a concise work summary, and the associated commit refs.",
      render: (value, setValue) => (
        <>
          {value.level !== "issue" ? (
            <>
              <FlowField label="Work summary">
                <Textarea
                  value={value.completionReport?.workSummary ?? ""}
                  onChange={(event) =>
                    setValue({
                      completionReport: buildCompletionReport({
                        modifiedFiles:
                          value.completionReport?.modifiedFiles ?? [],
                        workSummary: event.target.value,
                        linkedGitRefIds:
                          value.completionReport?.linkedGitRefIds ?? []
                      })
                    })
                  }
                  placeholder="Summarize what changed in this session and what is now true."
                />
              </FlowField>
              <FlowField label="Modified files">
                <Textarea
                  value={(value.completionReport?.modifiedFiles ?? []).join("\n")}
                  onChange={(event) =>
                    setValue({
                      completionReport: buildCompletionReport({
                        modifiedFiles: parseMultilineList(event.target.value),
                        workSummary: value.completionReport?.workSummary ?? "",
                        linkedGitRefIds:
                          value.completionReport?.linkedGitRefIds ?? []
                      })
                    })
                  }
                  placeholder="src/pages/kanban-page.tsx&#10;server/src/repositories/tasks.ts"
                />
              </FlowField>
              <FlowField label="Associated commits">
                <Textarea
                  value={value.gitRefs
                    .filter((ref) => ref.refType === "commit")
                    .map((ref) => ref.refValue)
                    .join("\n")}
                  onChange={(event) => {
                    const commitRefs = parseMultilineList(event.target.value).map(
                      (refValue, index) => ({
                        id: `draft-commit-${index + 1}`,
                        refType: "commit" as const,
                        provider: "git",
                        repository: "",
                        refValue,
                        url: null,
                        displayTitle: ""
                      })
                    );
                    const nextGitRefs = [
                      ...value.gitRefs.filter((ref) => ref.refType !== "commit"),
                      ...commitRefs
                    ];
                    setValue({
                      gitRefs: nextGitRefs,
                      completionReport: buildCompletionReport({
                        modifiedFiles:
                          value.completionReport?.modifiedFiles ?? [],
                        workSummary: value.completionReport?.workSummary ?? "",
                        linkedGitRefIds: commitRefs.map((ref) => ref.id ?? "")
                      })
                    });
                  }}
                  placeholder="abc1234&#10;def5678"
                />
              </FlowField>
            </>
          ) : null}
          <FlowField label="Creation notes">
            <InlineNoteFields
              notes={value.notes}
              onChange={(notes) => setValue({ notes })}
              entityLabel="task"
            />
          </FlowField>
        </>
      )
    },
    {
      id: "notes-evidence",
      eyebrow: "Evidence",
      title: "Capture launch context if this task needs a durable work note",
      description:
        "These notes become linked Markdown evidence on the task immediately, which helps preserve setup context, blockers, or handoff detail.",
      render: (value, setValue) => (
        <div className="text-sm leading-6 text-white/62">
          Use the previous step for completion closeout. Use linked notes here
          only when you want durable extra context, setup detail, or handoff
          evidence beyond the structured completion report.
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={t("common.dialogs.task.eyebrow")}
      title={
        editingTask
          ? t("common.dialogs.task.editTitle")
          : t("common.dialogs.task.createTitle")
      }
      description={t("common.dialogs.task.description")}
      value={draft}
      onChange={setDraft}
      steps={steps}
      initialStepId={initialStepId}
      submitLabel={
        editingTask
          ? t("common.dialogs.task.save")
          : t("common.dialogs.task.create")
      }
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const parsed = quickTaskSchema.safeParse(draft);
        if (!parsed.success) {
          updateFieldErrors(parsed.error.flatten().fieldErrors);
          setSubmitError(
            "A few task details still need attention before this move can be saved."
          );
          return;
        }

        setFieldErrors({});

        try {
          await onSubmit(parsed.data, editingTask?.id);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Unable to save this task right now."
          );
        }
      }}
    />
  );
}
