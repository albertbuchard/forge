import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { Plus, Search } from "lucide-react";
import { Dispatch, SetStateAction } from "react";

import { FlowField } from "@/components/flows/question-flow-dialog";
import {
  type InlineTaskDraft,
  type StrategyDialogDraft,
  type StrategyDialogDraftNode,
  toggleLinkedEntity,
  toggleString
} from "@/components/strategy-dialog-model";
import { SortableSequenceCard } from "@/components/strategy-sequence-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Input } from "@/components/ui/input";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import type {
  DashboardGoal,
  ProjectSummary,
  Task,
  UserSummary
} from "@/lib/types";

const strategySelectClassName =
  "min-h-10 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_34%,transparent)]";

type StrategyReadinessCheck = {
  id: string;
  label: string;
  satisfied: boolean;
};

type StrategyAlignmentMetric = {
  id: string;
  label: string;
  value: number;
};

export function StrategySequenceBuilder({
  draft,
  setDraft,
  sequenceSearchQuery,
  setSequenceSearchQuery,
  openInlineTaskComposer,
  showInlineTaskComposer,
  setShowInlineTaskComposer,
  inlineTaskDraft,
  setInlineTaskDraft,
  inlineTaskError,
  setInlineTaskError,
  inlineTaskPending,
  submitInlineTask,
  defaultUserId,
  goals,
  projects,
  inlineTaskProjects,
  projectsById,
  tasksById,
  usersById,
  goalsById,
  sequenceEntityKeys,
  hasSequenceQuery,
  hasSequenceResults,
  limitedSequenceGoals,
  limitedSequenceProjects,
  limitedSequenceTasks,
  limitedSuggestedProjects,
  limitedSuggestedTasks,
  appendSequenceNode,
  updateNode,
  removeNode,
  reorderNodes,
  contractChecks,
  alignmentBreakdown
}: {
  draft: StrategyDialogDraft;
  setDraft: Dispatch<SetStateAction<StrategyDialogDraft>>;
  sequenceSearchQuery: string;
  setSequenceSearchQuery: (query: string) => void;
  openInlineTaskComposer: () => void;
  showInlineTaskComposer: boolean;
  setShowInlineTaskComposer: (show: boolean) => void;
  inlineTaskDraft: InlineTaskDraft;
  setInlineTaskDraft: Dispatch<SetStateAction<InlineTaskDraft>>;
  inlineTaskError: string | null;
  setInlineTaskError: (error: string | null) => void;
  inlineTaskPending: boolean;
  submitInlineTask: () => void;
  defaultUserId: string | null;
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  inlineTaskProjects: ProjectSummary[];
  projectsById: Map<string, ProjectSummary>;
  tasksById: Map<string, Task>;
  usersById: Map<string, UserSummary>;
  goalsById: Map<string, DashboardGoal>;
  sequenceEntityKeys: Set<string>;
  hasSequenceQuery: boolean;
  hasSequenceResults: boolean;
  limitedSequenceGoals: DashboardGoal[];
  limitedSequenceProjects: ProjectSummary[];
  limitedSequenceTasks: Task[];
  limitedSuggestedProjects: ProjectSummary[];
  limitedSuggestedTasks: Task[];
  appendSequenceNode: (
    entityType: "project" | "task",
    entityId: string
  ) => void;
  updateNode: (nodeId: string, patch: Partial<StrategyDialogDraftNode>) => void;
  removeNode: (nodeId: string) => void;
  reorderNodes: (activeId: string, overId: string) => void;
  contractChecks: StrategyReadinessCheck[];
  alignmentBreakdown: StrategyAlignmentMetric[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Search and add
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Search goals, projects, tasks, humans, and bots.
            </div>
          </div>
          <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
            {draft.nodes.length} planned steps
          </Badge>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
          <Search className="size-4 text-[var(--ui-ink-faint)]" />
          <Input
            className="border-none bg-transparent px-0 py-0"
            value={sequenceSearchQuery}
            onChange={(event) => setSequenceSearchQuery(event.target.value)}
            placeholder="Search goals, projects, tasks, owners, humans, or bots"
          />
        </div>

        <div className="mt-4 grid gap-3">
          <Button
            type="button"
            className="w-full justify-start"
            variant="secondary"
            onClick={openInlineTaskComposer}
          >
            <Plus className="size-4" />
            Create new task
          </Button>

          {showInlineTaskComposer ? (
            <InlineTaskComposer
              inlineTaskDraft={inlineTaskDraft}
              setInlineTaskDraft={setInlineTaskDraft}
              inlineTaskError={inlineTaskError}
              setInlineTaskError={setInlineTaskError}
              inlineTaskPending={inlineTaskPending}
              setShowInlineTaskComposer={setShowInlineTaskComposer}
              submitInlineTask={submitInlineTask}
              goals={goals}
              projects={projects}
              inlineTaskProjects={inlineTaskProjects}
              projectsById={projectsById}
              defaultUserId={defaultUserId}
            />
          ) : null}

          <SequenceSearchResults
            draft={draft}
            setDraft={setDraft}
            hasSequenceQuery={hasSequenceQuery}
            hasSequenceResults={hasSequenceResults}
            sequenceEntityKeys={sequenceEntityKeys}
            limitedSequenceGoals={limitedSequenceGoals}
            limitedSequenceProjects={limitedSequenceProjects}
            limitedSequenceTasks={limitedSequenceTasks}
            limitedSuggestedProjects={limitedSuggestedProjects}
            limitedSuggestedTasks={limitedSuggestedTasks}
            appendSequenceNode={appendSequenceNode}
          />
        </div>
      </div>

      <div className="grid min-w-0 gap-4">
        <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Sequence
              </div>
              <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Keep the flow mostly linear here. When a step should open beside
                the previous one, switch it to parallel. Use custom only for
                special joins.
              </div>
            </div>
            <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
              {draft.nodes.length} planned steps
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {draft.targetGoalIds.map((goalId) => {
              const goal = goalsById.get(goalId);
              return goal ? (
                <EntityBadge
                  key={goalId}
                  kind="goal"
                  label={goal.title}
                  compact
                  gradient={false}
                />
              ) : null;
            })}
            {draft.targetProjectIds.map((projectId) => {
              const project = projectsById.get(projectId);
              return project ? (
                <EntityBadge
                  key={projectId}
                  kind="project"
                  label={project.title}
                  compact
                  gradient={false}
                />
              ) : null;
            })}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            if (!event.over || event.active.id === event.over.id) {
              return;
            }
            reorderNodes(String(event.active.id), String(event.over.id));
          }}
        >
          <SortableContext
            items={draft.nodes.map((node) => node.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-3">
              {draft.nodes.map((node, index) => (
                <SortableSequenceCard
                  key={node.id}
                  node={node}
                  index={index}
                  total={draft.nodes.length}
                  projectsById={projectsById}
                  tasksById={tasksById}
                  usersById={usersById}
                  allNodes={draft.nodes}
                  onUpdate={updateNode}
                  onRemove={removeNode}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Contract readiness
          </div>
          <div className="mt-3 grid gap-2">
            {contractChecks.map((check) => (
              <div
                key={check.id}
                className="flex items-center justify-between gap-3 rounded-[14px] bg-[var(--ui-surface-1)] px-3 py-2"
              >
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  {check.label}
                </div>
                <Badge
                  className={
                    check.satisfied
                      ? "bg-[var(--ui-success-soft)] text-[var(--success)]"
                      : "bg-[var(--ui-warning-soft)] text-[var(--warning)]"
                  }
                >
                  {check.satisfied ? "Ready" : "Missing"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Alignment preview
          </div>
          <div className="mt-3 grid gap-3">
            {alignmentBreakdown.map((metric) => (
              <div key={metric.id}>
                <div className="flex items-center justify-between gap-3 text-sm text-[var(--ui-ink-muted)]">
                  <span>{metric.label}</span>
                  <span>{metric.value}%</span>
                </div>
                <ProgressMeter value={metric.value} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineTaskComposer({
  inlineTaskDraft,
  setInlineTaskDraft,
  inlineTaskError,
  setInlineTaskError,
  inlineTaskPending,
  setShowInlineTaskComposer,
  submitInlineTask,
  goals,
  projects,
  inlineTaskProjects,
  projectsById,
  defaultUserId
}: {
  inlineTaskDraft: InlineTaskDraft;
  setInlineTaskDraft: Dispatch<SetStateAction<InlineTaskDraft>>;
  inlineTaskError: string | null;
  setInlineTaskError: (error: string | null) => void;
  inlineTaskPending: boolean;
  setShowInlineTaskComposer: (show: boolean) => void;
  submitInlineTask: () => void;
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  inlineTaskProjects: ProjectSummary[];
  projectsById: Map<string, ProjectSummary>;
  defaultUserId: string | null;
}) {
  const closeComposer = () => {
    setShowInlineTaskComposer(false);
    setInlineTaskError(null);
  };

  return (
    <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--ui-ink-strong)]">
            New task
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Add the task and place it in the sequence.
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          onClick={closeComposer}
        >
          Close
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <FlowField label="Task title">
          <Input
            value={inlineTaskDraft.title}
            onChange={(event) =>
              setInlineTaskDraft((current) => ({
                ...current,
                title: event.target.value
              }))
            }
            placeholder="Draft the shared strategy hierarchy view"
          />
        </FlowField>

        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Goal">
            <select
              value={inlineTaskDraft.goalId}
              onChange={(event) => {
                const nextGoalId = event.target.value;
                const nextProject =
                  projects.find((project) => project.goalId === nextGoalId) ??
                  null;
                setInlineTaskDraft((current) => ({
                  ...current,
                  goalId: nextGoalId,
                  projectId: nextProject?.id ?? "",
                  userId: nextProject?.userId ?? current.userId ?? defaultUserId
                }));
              }}
              className={strategySelectClassName}
            >
              <option value="">Select goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </FlowField>

          <FlowField label="Project">
            <select
              value={inlineTaskDraft.projectId}
              onChange={(event) =>
                setInlineTaskDraft((current) => ({
                  ...current,
                  projectId: event.target.value,
                  goalId:
                    projectsById.get(event.target.value)?.goalId ??
                    current.goalId,
                  userId:
                    projectsById.get(event.target.value)?.userId ??
                    current.userId
                }))
              }
              className={strategySelectClassName}
            >
              <option value="">Select project</option>
              {inlineTaskProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </FlowField>
        </div>

        <FlowField label="Notes">
          <Textarea
            value={inlineTaskDraft.description}
            onChange={(event) =>
              setInlineTaskDraft((current) => ({
                ...current,
                description: event.target.value
              }))
            }
            placeholder="Optional detail or acceptance note."
          />
        </FlowField>

        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Priority">
            <select
              value={inlineTaskDraft.priority}
              onChange={(event) =>
                setInlineTaskDraft((current) => ({
                  ...current,
                  priority: event.target.value as InlineTaskDraft["priority"]
                }))
              }
              className={strategySelectClassName}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </FlowField>

          <FlowField label="Points">
            <Input
              type="number"
              value={inlineTaskDraft.points}
              onChange={(event) =>
                setInlineTaskDraft((current) => ({
                  ...current,
                  points: Number(event.target.value) || 0
                }))
              }
            />
          </FlowField>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Effort">
            <select
              value={inlineTaskDraft.effort}
              onChange={(event) =>
                setInlineTaskDraft((current) => ({
                  ...current,
                  effort: event.target.value as InlineTaskDraft["effort"]
                }))
              }
              className={strategySelectClassName}
            >
              <option value="light">Light</option>
              <option value="deep">Deep</option>
              <option value="extended">Extended</option>
            </select>
          </FlowField>

          <FlowField label="Energy">
            <select
              value={inlineTaskDraft.energy}
              onChange={(event) =>
                setInlineTaskDraft((current) => ({
                  ...current,
                  energy: event.target.value as InlineTaskDraft["energy"]
                }))
              }
              className={strategySelectClassName}
            >
              <option value="calm">Calm</option>
              <option value="steady">Steady</option>
              <option value="intense">Intense</option>
            </select>
          </FlowField>
        </div>

        {inlineTaskError ? (
          <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            {inlineTaskError}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={closeComposer}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            pending={inlineTaskPending}
            pendingLabel="Creating task"
            onClick={submitInlineTask}
          >
            <Plus className="size-4" />
            Create task
          </Button>
        </div>
      </div>
    </div>
  );
}

function SequenceSearchResults({
  draft,
  setDraft,
  hasSequenceQuery,
  hasSequenceResults,
  sequenceEntityKeys,
  limitedSequenceGoals,
  limitedSequenceProjects,
  limitedSequenceTasks,
  limitedSuggestedProjects,
  limitedSuggestedTasks,
  appendSequenceNode
}: {
  draft: StrategyDialogDraft;
  setDraft: Dispatch<SetStateAction<StrategyDialogDraft>>;
  hasSequenceQuery: boolean;
  hasSequenceResults: boolean;
  sequenceEntityKeys: Set<string>;
  limitedSequenceGoals: DashboardGoal[];
  limitedSequenceProjects: ProjectSummary[];
  limitedSequenceTasks: Task[];
  limitedSuggestedProjects: ProjectSummary[];
  limitedSuggestedTasks: Task[];
  appendSequenceNode: (
    entityType: "project" | "task",
    entityId: string
  ) => void;
}) {
  if (hasSequenceQuery) {
    if (!hasSequenceResults) {
      return (
        <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
          No goals, projects, or tasks match this search.
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        {limitedSequenceGoals.length > 0 ? (
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Goals
          </div>
        ) : null}
        {limitedSequenceGoals.map((goal) => {
          const targeted = draft.targetGoalIds.includes(goal.id);
          const linked = draft.linkedEntities.some(
            (entry) => entry.entityType === "goal" && entry.entityId === goal.id
          );
          return (
            <div
              key={goal.id}
              className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <EntityBadge
                      kind="goal"
                      label={goal.title}
                      compact
                      gradient={false}
                    />
                    <UserBadge user={goal.user} compact />
                  </div>
                  {goal.description ? (
                    <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {goal.description}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    variant={targeted ? "secondary" : "primary"}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        targetGoalIds: toggleString(
                          current.targetGoalIds,
                          goal.id
                        )
                      }))
                    }
                  >
                    {targeted ? "Targeted" : "Add target"}
                  </Button>
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    variant="secondary"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        linkedEntities: toggleLinkedEntity(
                          current.linkedEntities,
                          {
                            entityType: "goal",
                            entityId: goal.id
                          }
                        )
                      }))
                    }
                  >
                    {linked ? "Unlink" : "Link"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {limitedSequenceProjects.length > 0 ? (
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Projects
          </div>
        ) : null}
        {limitedSequenceProjects.map((project) => (
          <SequenceProjectResult
            key={`sequence-project:${project.id}`}
            project={project}
            inSequence={sequenceEntityKeys.has(`project:${project.id}`)}
            appendSequenceNode={appendSequenceNode}
          />
        ))}

        {limitedSequenceTasks.length > 0 ? (
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Tasks
          </div>
        ) : null}
        {limitedSequenceTasks.map((task) => (
          <SequenceTaskResult
            key={`sequence-task:${task.id}`}
            task={task}
            inSequence={sequenceEntityKeys.has(`task:${task.id}`)}
            appendSequenceNode={appendSequenceNode}
          />
        ))}
      </div>
    );
  }

  if (limitedSuggestedProjects.length > 0 || limitedSuggestedTasks.length > 0) {
    return (
      <div className="grid gap-3">
        <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          Suggested from targets
        </div>
        {limitedSuggestedProjects.map((project) => (
          <SequenceProjectResult
            key={`suggested-project:${project.id}`}
            project={project}
            inSequence={sequenceEntityKeys.has(`project:${project.id}`)}
            appendSequenceNode={appendSequenceNode}
          />
        ))}
        {limitedSuggestedTasks.map((task) => (
          <SequenceTaskResult
            key={`suggested-task:${task.id}`}
            task={task}
            inSequence={sequenceEntityKeys.has(`task:${task.id}`)}
            appendSequenceNode={appendSequenceNode}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
      Type to search.
    </div>
  );
}

function SequenceProjectResult({
  project,
  inSequence,
  appendSequenceNode
}: {
  project: ProjectSummary;
  inSequence: boolean;
  appendSequenceNode: (
    entityType: "project" | "task",
    entityId: string
  ) => void;
}) {
  return (
    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <EntityBadge
              kind="project"
              label={project.title}
              compact
              gradient={false}
            />
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {project.goalTitle}
            </Badge>
            <UserBadge user={project.user} compact />
          </div>
          <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {project.description || project.goalTitle}
          </div>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          variant={inSequence ? "secondary" : "primary"}
          disabled={inSequence}
          onClick={() => appendSequenceNode("project", project.id)}
        >
          {inSequence ? "In sequence" : "Add step"}
        </Button>
      </div>
    </div>
  );
}

function SequenceTaskResult({
  task,
  inSequence,
  appendSequenceNode
}: {
  task: Task;
  inSequence: boolean;
  appendSequenceNode: (
    entityType: "project" | "task",
    entityId: string
  ) => void;
}) {
  return (
    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <EntityBadge
              kind="task"
              label={task.title}
              compact
              gradient={false}
            />
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {task.status}
            </Badge>
            <UserBadge user={task.user} compact />
          </div>
          <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            {task.description || `${task.owner} · ${task.status}`}
          </div>
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          variant={inSequence ? "secondary" : "primary"}
          disabled={inSequence}
          onClick={() => appendSequenceNode("task", task.id)}
        >
          {inSequence ? "In sequence" : "Add step"}
        </Button>
      </div>
    </div>
  );
}
