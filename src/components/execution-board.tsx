import {
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  PlusCircle,
  Scissors,
  Trash2
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { UserBadge } from "@/components/ui/user-badge";
import { getEntityVisual } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import type { Goal, ProjectSummary, Tag, Task, TaskStatus } from "@/lib/types";
import type { NotesSummaryByEntity } from "@/lib/types";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import {
  FloatingActionMenu,
  type FloatingActionMenuItem
} from "@/components/ui/floating-action-menu";

export const LANE_ORDER: TaskStatus[] = ["backlog", "focus", "in_progress", "blocked", "done"];

type BoardItem =
  | {
      kind: "task";
      id: string;
      status: TaskStatus;
      task: Task;
      goal: Goal | undefined;
      tags: Tag[];
    }
  | {
      kind: "project";
      id: string;
      status: TaskStatus;
      project: ProjectSummary;
      goal: Goal | undefined;
    };

function isLaneContainerId(value: string) {
  return value.startsWith("lane:") || value.includes(":lane:");
}

function isLaneContainer(container: { id: string | number; data?: { current?: Record<string, unknown> } }) {
  return container.data?.current?.type === "lane" || isLaneContainerId(String(container.id));
}

function isTrashContainer(container: { data?: { current?: Record<string, unknown> } }) {
  return container.data?.current?.type === "trash";
}

function getRectIntersectionArea(
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number }
) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

export const laneFirstCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  const trashHit = pointerHits.find((entry) => {
    const container = args.droppableContainers.find(
      (candidate) => candidate.id === entry.id
    );
    return container ? isTrashContainer(container) : false;
  });
  if (trashHit) {
    return [trashHit];
  }
  const laneHit = pointerHits.find((entry) => isLaneContainerId(String(entry.id)));
  if (laneHit) {
    return [laneHit];
  }

  const laneContainers = args.droppableContainers.filter((container) => isLaneContainer(container));
  const laneIntersections = laneContainers
    .map((container) => {
      const rect = args.droppableRects.get(container.id);
      if (!rect) {
        return null;
      }

      const value = getRectIntersectionArea(args.collisionRect, rect);
      if (value <= 0) {
        return null;
      }

      return {
        id: container.id,
        data: {
          droppableContainer: container,
          value
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => ((right?.data?.value as number | undefined) ?? 0) - ((left?.data?.value as number | undefined) ?? 0));
  if (laneIntersections.length > 0) {
    return laneIntersections as ReturnType<CollisionDetection>;
  }
  if (pointerHits.length > 0) {
    return pointerHits;
  }
  return closestCorners(args);
};

function TaskCardShell({
  task,
  goal,
  tags,
  isSelected,
  isDragging = false,
  isOverlay = false,
  style,
  setNodeRef,
  dragAttributes,
  dragListeners,
  isMobile = false,
  onSelect,
  onStartTask,
  onQuickReopen,
  onStepTask,
  onOpenTask,
  onEditTask,
  onSplitTask,
  onOpenMenu,
  notesSummaryByEntity
}: {
  task: Task;
  goal: Goal | undefined;
  tags: Tag[];
  isSelected: boolean;
  isDragging?: boolean;
  isOverlay?: boolean;
  style?: React.CSSProperties;
  setNodeRef?: (element: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: any;
  isMobile?: boolean;
  onSelect: (taskId: string) => void;
  onStartTask?: (taskId: string) => Promise<void>;
  onQuickReopen?: (taskId: string) => Promise<void>;
  onStepTask?: (taskId: string, direction: "previous" | "next") => Promise<void>;
  onOpenTask?: (taskId: string) => void;
  onEditTask?: (taskId: string) => void;
  onSplitTask?: (taskId: string) => void;
  onOpenMenu?: (
    event: ReactMouseEvent<HTMLButtonElement>,
    task: Task
  ) => void;
  notesSummaryByEntity?: NotesSummaryByEntity;
}) {
  const { t, formatDate } = useI18n();
  const previousStatus = LANE_ORDER[LANE_ORDER.indexOf(task.status) - 1] ?? null;
  const nextStatus = LANE_ORDER[LANE_ORDER.indexOf(task.status) + 1] ?? null;
  const noteCount = getEntityNotesSummary(notesSummaryByEntity, "task", task.id).count;
  const entityKind = task.level === "issue" ? "issue" : "task";
  const entityVisual = getEntityVisual(entityKind);
  const accent =
    task.level === "subtask"
      ? "136,146,255"
      : entityVisual.colorToken.rgb.join(", ");
  const dueLabel =
    task.dueDate && !Number.isNaN(Date.parse(task.dueDate))
      ? formatDate(task.dueDate)
      : "No due date";

  return (
    <article
      ref={setNodeRef}
      style={{
        ...style,
        ["--board-card-accent" as string]: accent
      }}
      className={cn(
        "w-full max-w-full min-w-0 overflow-hidden rounded-[18px] p-3 shadow-[inset_0_0_0_1px_rgba(var(--board-card-accent),0.12)] transition cursor-grab active:cursor-grabbing",
        isMobile && "touch-none select-none",
        isOverlay && "rotate-[0.5deg] bg-[linear-gradient(180deg,rgba(var(--board-card-accent),0.22),rgba(var(--board-card-accent),0.08))] shadow-[0_28px_80px_rgba(8,12,24,0.42),inset_0_0_0_1px_rgba(var(--board-card-accent),0.28)]",
        isDragging && !isOverlay && "opacity-35 shadow-[inset_0_0_0_1px_rgba(var(--board-card-accent),0.08)]",
        isSelected
          ? "bg-[linear-gradient(180deg,rgba(var(--board-card-accent),0.18),rgba(var(--board-card-accent),0.06))] shadow-[0_16px_40px_rgba(8,12,24,0.32),inset_0_0_0_1px_rgba(var(--board-card-accent),0.26)]"
          : "bg-[linear-gradient(180deg,rgba(var(--board-card-accent),0.08),rgba(255,255,255,0.03))]"
      )}
      data-dragging={isDragging ? "true" : "false"}
      data-testid={`task-card-${task.id}`}
      onClick={() => onSelect(task.id)}
      {...dragAttributes}
      {...dragListeners}
    >
      <div
        className="mb-3 h-px w-full rounded-full"
        style={{ background: `linear-gradient(90deg, rgba(${accent}, 0.96), rgba(${accent}, 0.18))` }}
      />
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <EntityBadge kind={entityKind} label={task.level} compact gradient={false} />
          <Badge className="shrink-0 text-[11px] text-[var(--tertiary)]">
            {task.priority}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onEditTask ? (
            <button
              type="button"
              aria-label={`Edit ${task.title}`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEditTask(task.id);
              }}
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {onOpenMenu ? (
            <button
              type="button"
              aria-label={`Open ${task.title} actions`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenMenu(event, task);
              }}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          ) : null}
          {onOpenTask ? (
            <button
              type="button"
              aria-label={`Open ${task.title} details`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenTask(task.id);
              }}
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          ) : null}
          {isMobile ? (
            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                aria-label={`Move ${task.title} to the previous lane`}
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white disabled:opacity-35"
                disabled={!previousStatus}
                onClick={() => {
                  if (previousStatus) {
                    void onStepTask?.(task.id, "previous");
                  }
                }}
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${task.title} to the next lane`}
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white disabled:opacity-35"
                disabled={!nextStatus}
                onClick={() => {
                  if (nextStatus) {
                    void onStepTask?.(task.id, "next");
                  }
                }}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          ) : null}
          {task.status !== "done" ? (
            <button
              type="button"
              aria-label={`Start work on ${task.title}`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--primary)]/16 text-[var(--primary)] transition hover:bg-[var(--primary)]/24"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onStartTask?.(task.id);
              }}
            >
              <Play className="size-4 fill-current" />
            </button>
          ) : null}
          {task.splitSuggestion?.shouldSplit && onSplitTask ? (
            <button
              type="button"
              aria-label={`Split ${task.title}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-amber-100 transition hover:bg-amber-400/18"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSplitTask(task.id);
              }}
            >
              <Scissors className="size-3.5" />
              Split it
            </button>
          ) : null}
          <span className="text-[11px] text-white/44">{task.points} xp</span>
        </div>
      </div>
      <EntityName kind={entityKind} label={task.title} className="max-w-full" lines={3} labelClassName="[overflow-wrap:anywhere]" />
      <p className="mt-1.5 line-clamp-3 [overflow-wrap:anywhere] text-[12px] leading-5 text-white/62">{task.description || t("common.executionBoard.noExecutionNote")}</p>
      <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
        {goal ? <EntityBadge kind="goal" label={goal.title} compact wrap className="min-w-0 max-w-full" /> : null}
        <UserBadge user={task.user} compact />
        <EntityNoteCountLink entityType="task" entityId={task.id} count={noteCount} />
        {task.actionPointSummary ? (
          <Badge className="bg-[var(--primary)]/12 text-[var(--primary)]">
            {Math.round(task.actionPointSummary.totalCostAp)} AP
          </Badge>
        ) : null}
        {task.actionPointSummary ? (
          <Badge className="bg-white/8 text-white/72">
            {task.actionPointSummary.costBand}
          </Badge>
        ) : null}
        {task.actionPointSummary ? (
          <Badge className="bg-white/8 text-white/72">
            {Math.round(task.actionPointSummary.expectedDurationSeconds / 3600)} h target
          </Badge>
        ) : null}
        {task.time.totalCreditedSeconds > 0 ? <Badge className="bg-white/8 text-white/72">{Math.floor(task.time.totalCreditedSeconds / 60)} min</Badge> : null}
        {task.time.activeRunCount > 0 ? <Badge className="bg-emerald-500/12 text-emerald-200">{task.time.activeRunCount} live</Badge> : null}
        {tags.slice(0, 2).map((tag) => (
          <Badge key={tag.id} className="bg-white/8" style={{ color: tag.color }}>
            {tag.name}
          </Badge>
        ))}
      </div>
      <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 text-[11px] text-white/45">
        <span className="min-w-0 truncate">
          {task.effort} / {task.energy}
        </span>
        <div className="flex min-w-0 shrink-0 items-center gap-2 text-right">
          {task.status === "done" && onQuickReopen ? (
            <button
              type="button"
              className="rounded-full bg-white/8 px-3 py-1 text-[10px] tracking-[0.16em] text-white transition hover:bg-white/12"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onQuickReopen(task.id);
              }}
            >
              {t("common.executionBoard.reopen")}
            </button>
          ) : null}
          <span>{dueLabel}</span>
        </div>
      </div>
    </article>
  );
}

function SortableTaskCard(props: {
  sortableId: string;
  task: Task;
  goal: Goal | undefined;
  tags: Tag[];
  isSelected: boolean;
  isMobile?: boolean;
  onSelect: (taskId: string) => void;
  onStartTask?: (taskId: string) => Promise<void>;
  onQuickReopen?: (taskId: string) => Promise<void>;
  onStepTask?: (taskId: string, direction: "previous" | "next") => Promise<void>;
  onOpenTask?: (taskId: string) => void;
  onEditTask?: (taskId: string) => void;
  onSplitTask?: (taskId: string) => void;
  onOpenMenu?: (
    event: ReactMouseEvent<HTMLButtonElement>,
    task: Task
  ) => void;
  notesSummaryByEntity?: NotesSummaryByEntity;
}) {
  const { task, sortableId } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: {
      type: "task",
      taskId: task.id,
      status: task.status
    }
  });

  return (
    <TaskCardShell
      {...props}
      setNodeRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      isDragging={isDragging}
      isMobile={props.isMobile}
      onStartTask={props.onStartTask}
      onStepTask={props.onStepTask}
      onSplitTask={props.onSplitTask}
      notesSummaryByEntity={props.notesSummaryByEntity}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
    />
  );
}

function ProjectCardShell({
  project,
  goal,
  isDragging = false,
  isOverlay = false,
  style,
  setNodeRef,
  dragAttributes,
  dragListeners,
  isMobile = false,
  onStepProject,
  onOpenProject,
  onOpenMenu
}: {
  project: ProjectSummary;
  goal: Goal | undefined;
  isDragging?: boolean;
  isOverlay?: boolean;
  style?: React.CSSProperties;
  setNodeRef?: (element: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: any;
  isMobile?: boolean;
  onStepProject?: (
    projectId: string,
    direction: "previous" | "next"
  ) => Promise<void>;
  onOpenProject?: (projectId: string) => void;
  onOpenMenu?: (
    event: ReactMouseEvent<HTMLButtonElement>,
    project: ProjectSummary
  ) => void;
}) {
  const { formatDate } = useI18n();
  const previousStatus =
    LANE_ORDER[LANE_ORDER.indexOf(project.workflowStatus) - 1] ?? null;
  const nextStatus =
    LANE_ORDER[LANE_ORDER.indexOf(project.workflowStatus) + 1] ?? null;
  const entityVisual = getEntityVisual("project");
  const accent = entityVisual.colorToken.rgb.join(", ");
  const workflowLabel = project.workflowStatus.replaceAll("_", " ");
  const lifecycleLabel = project.status.replaceAll("_", " ");
  const updatedLabel =
    project.updatedAt && !Number.isNaN(Date.parse(project.updatedAt))
      ? formatDate(project.updatedAt)
      : "No recent update";

  return (
    <article
      ref={setNodeRef}
      style={{
        ...style,
        ["--board-card-accent" as string]: accent
      }}
      className={cn(
        "w-full max-w-full min-w-0 overflow-hidden rounded-[18px] p-3 shadow-[inset_0_0_0_1px_rgba(var(--board-card-accent),0.12)] transition cursor-grab active:cursor-grabbing",
        isMobile && "touch-none select-none",
        isOverlay && "rotate-[0.5deg] bg-[linear-gradient(180deg,rgba(var(--board-card-accent),0.22),rgba(var(--board-card-accent),0.08))] shadow-[0_28px_80px_rgba(8,12,24,0.42),inset_0_0_0_1px_rgba(var(--board-card-accent),0.28)]",
        isDragging && !isOverlay && "opacity-35 shadow-[inset_0_0_0_1px_rgba(var(--board-card-accent),0.08)]",
        !isDragging &&
          !isOverlay &&
          "bg-[linear-gradient(180deg,rgba(var(--board-card-accent),0.08),rgba(255,255,255,0.03))]"
      )}
      data-testid={`project-card-${project.id}`}
      {...dragAttributes}
      {...dragListeners}
    >
      <div
        className="mb-3 h-px w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, rgba(${accent}, 0.96), rgba(${accent}, 0.18))`
        }}
      />
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <EntityBadge kind="project" label="project" compact gradient={false} />
          <Badge className="bg-[var(--primary)]/12 text-[var(--primary)]">
            {workflowLabel}
          </Badge>
          <Badge className="bg-white/8 text-white/72">
            {lifecycleLabel}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenMenu ? (
            <button
              type="button"
              aria-label={`Open ${project.title} actions`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenMenu(event, project);
              }}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          ) : null}
          {onOpenProject ? (
            <button
              type="button"
              aria-label={`Open ${project.title} details`}
              className="inline-flex size-8 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenProject(project.id);
              }}
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          ) : null}
          {isMobile ? (
            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                aria-label={`Move ${project.title} to the previous lane`}
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white disabled:opacity-35"
                disabled={!previousStatus}
                onClick={() => {
                  if (previousStatus) {
                    void onStepProject?.(project.id, "previous");
                  }
                }}
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${project.title} to the next lane`}
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/8 text-white/62 transition hover:bg-white/12 hover:text-white disabled:opacity-35"
                disabled={!nextStatus}
                onClick={() => {
                  if (nextStatus) {
                    void onStepProject?.(project.id, "next");
                  }
                }}
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <EntityName
        kind="project"
        label={project.title}
        className="max-w-full"
        lines={3}
        labelClassName="[overflow-wrap:anywhere]"
      />
      <p className="mt-1.5 line-clamp-3 [overflow-wrap:anywhere] text-[12px] leading-5 text-white/62">
        {project.description || "PRD-backed initiative spanning multiple work items."}
      </p>
      <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
        {goal ? (
          <EntityBadge
            kind="goal"
            label={goal.title}
            compact
            wrap
            className="min-w-0 max-w-full"
          />
        ) : null}
        <UserBadge user={project.user} compact />
        {(project.assignees ?? []).slice(0, 2).map((user) => (
          <UserBadge key={user.id} user={user} compact />
        ))}
        <Badge className="bg-[var(--primary)]/12 text-[var(--primary)]">
          {project.progress}% progress
        </Badge>
        <Badge className="bg-white/8 text-white/72">
          {project.totalTasks} linked tasks
        </Badge>
      </div>
      <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 text-[11px] text-white/45">
        <span className="min-w-0 truncate">{project.goalTitle}</span>
        <span>{updatedLabel}</span>
      </div>
    </article>
  );
}

function SortableProjectCard(props: {
  sortableId: string;
  project: ProjectSummary;
  goal: Goal | undefined;
  isMobile?: boolean;
  onStepProject?: (
    projectId: string,
    direction: "previous" | "next"
  ) => Promise<void>;
  onOpenProject?: (projectId: string) => void;
  onOpenMenu?: (
    event: ReactMouseEvent<HTMLButtonElement>,
    project: ProjectSummary
  ) => void;
}) {
  const { project, sortableId } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: sortableId,
      data: {
        type: "project",
        projectId: project.id,
        status: project.workflowStatus
      }
    });

  return (
    <ProjectCardShell
      {...props}
      setNodeRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      isDragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
    />
  );
}

function LaneDropzone({
  droppableId,
  status,
  title,
  detail,
  count,
  dragging,
  children
}: {
  droppableId: string;
  status: TaskStatus;
  title: string;
  detail: string;
  count: number;
  dragging: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: {
      type: "lane",
      status
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={cn("w-full max-w-full min-w-0 overflow-hidden rounded-[24px] transition", isOver && "scale-[1.005]")}
      data-lane-id={status}
      data-testid={`kanban-lane-${status}`}
      data-lane-hover={isOver ? "true" : "false"}
    >
      <Card
        className={cn(
          "h-full w-full max-w-full min-w-0 overflow-hidden p-3 transition-[background-color,box-shadow,border-color,transform]",
          dragging && "border border-white/8",
          isOver
            ? "border border-[rgba(125,211,252,0.38)] bg-[linear-gradient(180deg,rgba(125,211,252,0.12),rgba(125,211,252,0.05))] shadow-[0_18px_54px_rgba(14,165,233,0.12)]"
            : "border border-transparent"
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="type-label text-white/45">{detail}</div>
            <h3 className="mt-1 break-words text-[1.45rem] leading-[1] text-white">{title}</h3>
          </div>
          <div className="shrink-0 font-display text-[1.45rem] text-[var(--primary)]">{count}</div>
        </div>
        <div className={cn("grid w-full max-w-full min-w-0 min-h-48 content-start gap-2 rounded-[18px] p-2 transition", isOver ? "bg-[rgba(125,211,252,0.08)]" : "bg-white/[0.02]")}>
          {children}
        </div>
      </Card>
    </div>
  );
}

function TrashDropzone({
  droppableId,
  title,
  detail
}: {
  droppableId: string;
  title: string;
  detail: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: {
      type: "trash"
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "pointer-events-auto fixed right-4 top-4 z-50 w-[min(18rem,calc(100vw-2rem))] rounded-[28px] border px-5 py-4 shadow-[0_24px_80px_rgba(6,10,20,0.48)] backdrop-blur-2xl transition lg:right-6 lg:top-6",
        isOver
          ? "border-rose-300/38 bg-[linear-gradient(180deg,rgba(244,63,94,0.28),rgba(120,24,42,0.46))] text-white scale-[1.02]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(18,24,38,0.96),rgba(10,14,24,0.94))] text-white/84"
      )}
      data-testid="kanban-trash-dropzone"
      data-trash-hover={isOver ? "true" : "false"}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-12 items-center justify-center rounded-full border transition",
            isOver
              ? "border-white/28 bg-white/12"
              : "border-white/12 bg-white/6"
          )}
        >
          <Trash2 className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/55">
            Bin
          </div>
          <div className="mt-1 text-base font-medium text-white">{title}</div>
          <div className="mt-1 text-sm leading-5 text-white/62">{detail}</div>
        </div>
      </div>
    </div>
  );
}

export function ExecutionBoard({
  tasks,
  projects = [],
  goals,
  tags,
  selectedTaskId,
  onMove,
  onMoveProject,
  onSelectTask,
  onStartTask,
  onQuickReopenTask,
  onDeleteTask,
  onOpenProject,
  onOpenTask,
  onEditProject,
  onEditTask,
  onLinkProject,
  onLinkTask,
  onCreateIssueForProject,
  onCreateTaskForIssue,
  onCreateSubtaskForTask,
  onSplitTask,
  notesSummaryByEntity
}: {
  tasks: Task[];
  projects?: ProjectSummary[];
  goals: Goal[];
  tags: Tag[];
  selectedTaskId: string | null;
  onMove: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
  onMoveProject?: (
    projectId: string,
    nextStatus: TaskStatus
  ) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onStartTask?: (taskId: string) => Promise<void>;
  onQuickReopenTask?: (taskId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onOpenProject?: (projectId: string) => void;
  onOpenTask?: (taskId: string) => void;
  onEditProject?: (projectId: string) => void;
  onEditTask?: (taskId: string) => void;
  onLinkProject?: (projectId: string) => void;
  onLinkTask?: (taskId: string) => void;
  onCreateIssueForProject?: (projectId: string) => void;
  onCreateTaskForIssue?: (taskId: string) => void;
  onCreateSubtaskForTask?: (taskId: string) => void;
  onSplitTask?: (taskId: string) => void;
  notesSummaryByEntity?: NotesSummaryByEntity;
}) {
  const { t } = useI18n();
  const boardInstanceId = useId();
  const trashDroppableId = `${boardInstanceId}:trash`;
  const [isMobileBoard, setIsMobileBoard] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    kind: "project" | "task";
    entityId: string;
    position: { x: number; y: number };
  } | null>(null);
  const [confirmingDeleteTask, setConfirmingDeleteTask] = useState<Task | null>(
    null
  );
  const [deletePendingTaskId, setDeletePendingTaskId] = useState<string | null>(
    null
  );
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return (
      window.localStorage.getItem("forge.kanban-skip-delete-confirmation") ===
      "true"
    );
  });
  const [disableDeleteConfirmChoice, setDisableDeleteConfirmChoice] =
    useState(false);
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, TaskStatus>>({});
  const [optimisticProjectStatuses, setOptimisticProjectStatuses] = useState<
    Record<string, TaskStatus>
  >({});
  const laneLabels: Record<TaskStatus, { title: string; detail: string }> = {
    backlog: { title: t("common.executionBoard.laneBacklogTitle"), detail: t("common.executionBoard.laneBacklogDetail") },
    focus: { title: t("common.executionBoard.laneFocusTitle"), detail: t("common.executionBoard.laneFocusDetail") },
    in_progress: { title: t("common.executionBoard.laneProgressTitle"), detail: t("common.executionBoard.laneProgressDetail") },
    blocked: { title: t("common.executionBoard.laneBlockedTitle"), detail: t("common.executionBoard.laneBlockedDetail") },
    done: { title: t("common.executionBoard.laneDoneTitle"), detail: t("common.executionBoard.laneDoneDetail") }
  };
  const boardTasks = useMemo(
    () =>
      tasks.map((task) => {
        const optimisticStatus = optimisticStatuses[task.id];
        return optimisticStatus ? { ...task, status: optimisticStatus } : task;
      }),
    [optimisticStatuses, tasks]
  );
  const boardProjects = useMemo(
    () =>
      projects.map((project) => {
        const optimisticStatus = optimisticProjectStatuses[project.id];
        return optimisticStatus
          ? { ...project, workflowStatus: optimisticStatus }
          : project;
      }),
    [optimisticProjectStatuses, projects]
  );
  const boardItems = useMemo<BoardItem[]>(
    () => [
      ...boardProjects.map((project) => ({
        kind: "project" as const,
        id: project.id,
        status: project.workflowStatus,
        project,
        goal: goals.find((goal) => goal.id === project.goalId)
      })),
      ...boardTasks.map((task) => ({
        kind: "task" as const,
        id: task.id,
        status: task.status,
        task,
        goal: goals.find((goal) => goal.id === task.goalId),
        tags: task.tagIds
          .map((tagId) => tags.find((tag) => tag.id === tagId))
          .filter(Boolean) as Tag[]
      }))
    ],
    [boardProjects, boardTasks, goals, tags]
  );
  const activeBoardItem = activeTaskId
    ? boardItems.find((item) => item.id === activeTaskId) ?? null
    : null;
  const activeMenuItems = useMemo<FloatingActionMenuItem[]>(() => {
    if (!menuState) {
      return [];
    }

    if (menuState.kind === "project") {
      const project = boardProjects.find((entry) => entry.id === menuState.entityId);
      if (!project) {
        return [];
      }

      return [
        {
          id: "open-project",
          label: "Open",
          description: "Jump to the project detail view.",
          icon: ArrowUpRight,
          onSelect: () => onOpenProject?.(project.id)
        },
        {
          id: "edit-project",
          label: "Edit",
          description: "Open the guided project editor.",
          icon: Pencil,
          onSelect: () => onEditProject?.(project.id)
        },
        {
          id: "link-project",
          label: "Link",
          description: "Open the anchor step to relink the project to its goal.",
          icon: Link2,
          onSelect: () => onLinkProject?.(project.id)
        },
        {
          id: "create-issue",
          label: "Create issue",
          description: "Break this project into a new vertical slice issue.",
          icon: PlusCircle,
          onSelect: () => onCreateIssueForProject?.(project.id)
        },
        ...LANE_ORDER.filter((status) => status !== project.workflowStatus).map(
          (status) => ({
            id: `move-project-${status}`,
            label: `Move to ${status.replaceAll("_", " ")}`,
            description: "Update the project workflow lane without leaving the board.",
            onSelect: () => void onMoveProject?.(project.id, status)
          })
        )
      ];
    }

    const task = boardTasks.find((entry) => entry.id === menuState.entityId);
    if (!task) {
      return [];
    }

    const childCreateItem =
      task.level === "issue"
        ? {
            id: "create-task",
            label: "Create task",
            description: "Add a focused execution task under this issue.",
            icon: PlusCircle,
            onSelect: () => onCreateTaskForIssue?.(task.id)
          }
        : task.level === "task"
          ? {
              id: "create-subtask",
              label: "Create subtask",
              description: "Add a granular child step under this task.",
              icon: PlusCircle,
              onSelect: () => onCreateSubtaskForTask?.(task.id)
            }
          : null;

    return [
      {
        id: "open-task",
        label: "Open",
        description: "Jump to the work-item detail view.",
        icon: ArrowUpRight,
        onSelect: () => onOpenTask?.(task.id)
      },
      {
        id: "edit-task",
        label: "Edit",
        description: "Open the guided work-item editor.",
        icon: Pencil,
        onSelect: () => onEditTask?.(task.id)
      },
      {
        id: "link-task",
        label: "Link",
        description: "Open the placement step to relink this work item.",
        icon: Link2,
        onSelect: () => onLinkTask?.(task.id)
      },
      ...(childCreateItem ? [childCreateItem] : []),
      ...LANE_ORDER.filter((status) => status !== task.status).map((status) => ({
        id: `move-task-${status}`,
        label: `Move to ${status.replaceAll("_", " ")}`,
        description: "Update the workflow lane for this work item.",
        onSelect: () => void onMove(task.id, status)
      }))
    ];
  }, [
    boardProjects,
    boardTasks,
    menuState,
    onCreateIssueForProject,
    onCreateSubtaskForTask,
    onCreateTaskForIssue,
    onEditProject,
    onEditTask,
    onLinkProject,
    onLinkTask,
    onMove,
    onMoveProject,
    onOpenProject,
    onOpenTask
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const sync = (event?: MediaQueryListEvent) => {
      setIsMobileBoard(event ? event.matches : mediaQuery.matches);
    };

    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!activeTaskId) {
      document.body.style.cursor = "";
      return;
    }

    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = "";
    };
  }, [activeTaskId]);

  useEffect(() => {
    setOptimisticStatuses((current) => {
      const taskIds = new Set(tasks.map((task) => task.id));
      let changed = false;
      const next: Record<string, TaskStatus> = {};

      for (const [taskId, status] of Object.entries(current)) {
        const task = tasks.find((entry) => entry.id === taskId);
        if (!taskIds.has(taskId) || !task || task.status === status) {
          changed = true;
          continue;
        }
        next[taskId] = status;
      }

      return changed ? next : current;
    });
  }, [tasks]);

  useEffect(() => {
    setOptimisticProjectStatuses((current) => {
      const projectIds = new Set(projects.map((project) => project.id));
      let changed = false;
      const next: Record<string, TaskStatus> = {};

      for (const [projectId, status] of Object.entries(current)) {
        const project = projects.find((entry) => entry.id === projectId);
        if (!projectIds.has(projectId) || !project || project.workflowStatus === status) {
          changed = true;
          continue;
        }
        next[projectId] = status;
      }

      return changed ? next : current;
    });
  }, [projects]);

  function handleDragStart(event: DragStartEvent) {
    const taskId = event.active.data.current?.taskId;
    const projectId = event.active.data.current?.projectId;
    if (typeof taskId === "string") {
      setActiveTaskId(taskId);
    } else if (typeof projectId === "string") {
      setActiveTaskId(projectId);
    }
  }

  const persistDeleteConfirmPreference = (value: boolean) => {
    setSkipDeleteConfirm(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "forge.kanban-skip-delete-confirmation",
        value ? "true" : "false"
      );
    }
  };

  const deleteTaskNow = async (task: Task, disableConfirm: boolean) => {
    if (!onDeleteTask) {
      return;
    }

    setDeletePendingTaskId(task.id);
    try {
      if (disableConfirm) {
        persistDeleteConfirmPreference(true);
      }
      await onDeleteTask(task.id);
      setConfirmingDeleteTask(null);
      setDisableDeleteConfirmChoice(false);
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    } finally {
      setDeletePendingTaskId(null);
    }
  };

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTaskId(null);
    if (!over || active.id === over.id) {
      return;
    }

    const activeTaskId = typeof active.data.current?.taskId === "string" ? active.data.current.taskId : null;
    const activeProjectId =
      typeof active.data.current?.projectId === "string"
        ? active.data.current.projectId
        : null;
    const boardItem =
      (activeTaskId
        ? boardItems.find((entry) => entry.kind === "task" && entry.id === activeTaskId)
        : null) ??
      (activeProjectId
        ? boardItems.find(
            (entry) => entry.kind === "project" && entry.id === activeProjectId
          )
        : null);
    if (!boardItem) {
      return;
    }

    if (over.data.current?.type === "trash") {
      if (boardItem.kind !== "task" || !onDeleteTask) {
        return;
      }
      if (skipDeleteConfirm) {
        await deleteTaskNow(boardItem.task, false);
        return;
      }
      setDisableDeleteConfirmChoice(false);
      setConfirmingDeleteTask(boardItem.task);
      return;
    }

    const overStatus = typeof over.data.current?.status === "string" ? (over.data.current.status as TaskStatus) : null;
    const overTaskId =
      typeof over.data.current?.taskId === "string"
        ? over.data.current.taskId
        : null;
    const overProjectId =
      typeof over.data.current?.projectId === "string"
        ? over.data.current.projectId
        : null;
    const overItem =
      (overTaskId
        ? boardItems.find((entry) => entry.kind === "task" && entry.id === overTaskId)
        : null) ??
      (overProjectId
        ? boardItems.find(
            (entry) => entry.kind === "project" && entry.id === overProjectId
          )
        : null);
    const laneId = overStatus ?? overItem?.status ?? boardItem.status;
    if (laneId === boardItem.status || !LANE_ORDER.includes(laneId)) {
      return;
    }

    if (boardItem.kind === "task") {
      setOptimisticStatuses((current) => ({
        ...current,
        [boardItem.task.id]: laneId
      }));
      try {
        await onMove(boardItem.task.id, laneId);
      } catch (error) {
        setOptimisticStatuses((current) => {
          const next = { ...current };
          delete next[boardItem.task.id];
          return next;
        });
        throw error;
      }
      return;
    }

    if (!onMoveProject) {
      return;
    }

    setOptimisticProjectStatuses((current) => ({
      ...current,
      [boardItem.project.id]: laneId
    }));
    try {
      await onMoveProject(boardItem.project.id, laneId);
    } catch (error) {
      setOptimisticProjectStatuses((current) => {
        const next = { ...current };
        delete next[boardItem.project.id];
        return next;
      });
      throw error;
    }
  }

  async function handleStepTask(taskId: string, direction: "previous" | "next") {
    const task = boardTasks.find((entry) => entry.id === taskId);
    if (!task) {
      return;
    }

    const currentIndex = LANE_ORDER.indexOf(task.status);
    const nextIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
    const nextStatus = LANE_ORDER[nextIndex] ?? null;
    if (!nextStatus || nextStatus === task.status) {
      return;
    }

    setOptimisticStatuses((current) => ({
      ...current,
      [task.id]: nextStatus
    }));

    try {
      await onMove(task.id, nextStatus);
    } catch (error) {
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      throw error;
    }
  }

  async function handleStepProject(
    projectId: string,
    direction: "previous" | "next"
  ) {
    const project = boardProjects.find((entry) => entry.id === projectId);
    if (!project || !onMoveProject) {
      return;
    }

    const currentIndex = LANE_ORDER.indexOf(project.workflowStatus);
    const nextIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
    const nextStatus = LANE_ORDER[nextIndex] ?? null;
    if (!nextStatus || nextStatus === project.workflowStatus) {
      return;
    }

    setOptimisticProjectStatuses((current) => ({
      ...current,
      [project.id]: nextStatus
    }));

    try {
      await onMoveProject(project.id, nextStatus);
    } catch (error) {
      setOptimisticProjectStatuses((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      throw error;
    }
  }

  function openTaskMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    task: Task
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuState({
      kind: "task",
      entityId: task.id,
      position: {
        x: rect.right - 8,
        y: rect.bottom + 8
      }
    });
  }

  function openProjectMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    project: ProjectSummary
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuState({
      kind: "project",
      entityId: project.id,
      position: {
        x: rect.right - 8,
        y: rect.bottom + 8
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={laneFirstCollision}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveTaskId(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      {activeBoardItem?.kind === "task" && onDeleteTask ? (
        <TrashDropzone
          droppableId={trashDroppableId}
          title={t("common.executionBoard.deleteDropTitle")}
          detail={t("common.executionBoard.deleteDropDetail")}
        />
      ) : null}
      <div className="w-full max-w-full min-w-0 pb-2">
        {isMobileBoard ? (
          <div className="grid w-full max-w-full min-w-0 gap-2">
            {LANE_ORDER.map((status) => {
              const laneItems = boardItems.filter((item) => item.status === status);
              return (
                <SortableContext
                  key={status}
                  items={laneItems.map((item) => `${boardInstanceId}:${item.kind}:${item.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <LaneDropzone
                    droppableId={`${boardInstanceId}:lane:${status}`}
                    status={status}
                    title={laneLabels[status].title}
                    detail={laneLabels[status].detail}
                    count={laneItems.length}
                    dragging={activeTaskId !== null}
                  >
                    {laneItems.map((item) =>
                      item.kind === "task" ? (
                        <SortableTaskCard
                          key={item.task.id}
                          sortableId={`${boardInstanceId}:task:${item.task.id}`}
                          task={item.task}
                          goal={item.goal}
                          tags={item.tags}
                          isSelected={selectedTaskId === item.task.id}
                          isMobile
                          onSelect={onSelectTask}
                          onStartTask={onStartTask}
                          onQuickReopen={onQuickReopenTask}
                          onStepTask={handleStepTask}
                          onOpenTask={onOpenTask}
                          onEditTask={onEditTask}
                          onOpenMenu={openTaskMenu}
                          onSplitTask={onSplitTask}
                          notesSummaryByEntity={notesSummaryByEntity}
                        />
                      ) : (
                        <SortableProjectCard
                          key={item.project.id}
                          sortableId={`${boardInstanceId}:project:${item.project.id}`}
                          project={item.project}
                          goal={item.goal}
                          isMobile
                          onStepProject={handleStepProject}
                          onOpenProject={onOpenProject}
                          onOpenMenu={openProjectMenu}
                        />
                      )
                    )}
                    {laneItems.length === 0 ? (
                      <div className="w-full max-w-full rounded-[18px] border border-dashed border-white/8 px-4 py-8 text-center text-sm text-white/35">
                        {t("common.executionBoard.emptyLane")}
                      </div>
                    ) : null}
                  </LaneDropzone>
                </SortableContext>
              );
            })}
          </div>
        ) : (
          <div className="grid w-full min-w-0 gap-0.5 xl:grid-cols-[repeat(5,minmax(0,1fr))]">
            {LANE_ORDER.map((status) => {
              const laneItems = boardItems.filter((item) => item.status === status);
              return (
                <SortableContext
                  key={status}
                  items={laneItems.map((item) => `${boardInstanceId}:${item.kind}:${item.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <LaneDropzone
                    droppableId={`${boardInstanceId}:lane:${status}`}
                    status={status}
                    title={laneLabels[status].title}
                    detail={laneLabels[status].detail}
                    count={laneItems.length}
                    dragging={activeTaskId !== null}
                  >
                    {laneItems.map((item) =>
                      item.kind === "task" ? (
                        <SortableTaskCard
                          key={item.task.id}
                          sortableId={`${boardInstanceId}:task:${item.task.id}`}
                          task={item.task}
                          goal={item.goal}
                          tags={item.tags}
                          isSelected={selectedTaskId === item.task.id}
                          onSelect={onSelectTask}
                          onStartTask={onStartTask}
                          onQuickReopen={onQuickReopenTask}
                          onStepTask={handleStepTask}
                          onOpenTask={onOpenTask}
                          onEditTask={onEditTask}
                          onOpenMenu={openTaskMenu}
                          onSplitTask={onSplitTask}
                          notesSummaryByEntity={notesSummaryByEntity}
                        />
                      ) : (
                        <SortableProjectCard
                          key={item.project.id}
                          sortableId={`${boardInstanceId}:project:${item.project.id}`}
                          project={item.project}
                          goal={item.goal}
                          onStepProject={handleStepProject}
                          onOpenProject={onOpenProject}
                          onOpenMenu={openProjectMenu}
                        />
                      )
                    )}
                    {laneItems.length === 0 ? (
                      <div className="w-full max-w-full rounded-[18px] border border-dashed border-white/8 px-4 py-8 text-center text-sm text-white/35">
                        {t("common.executionBoard.emptyLane")}
                      </div>
                    ) : null}
                  </LaneDropzone>
                </SortableContext>
              );
            })}
          </div>
        )}
      </div>
      <DragOverlay adjustScale={false} dropAnimation={null}>
        {activeBoardItem ? (
          <div className="w-[20rem] max-w-[calc(100vw-2rem)]">
            {activeBoardItem.kind === "task" ? (
              <TaskCardShell
                task={activeBoardItem.task}
                goal={activeBoardItem.goal}
                tags={activeBoardItem.tags}
                isSelected={selectedTaskId === activeBoardItem.task.id}
                isDragging
                isOverlay
                isMobile={isMobileBoard}
                onSelect={() => {}}
                onStartTask={onStartTask}
                onSplitTask={onSplitTask}
                notesSummaryByEntity={notesSummaryByEntity}
              />
            ) : (
              <ProjectCardShell
                project={activeBoardItem.project}
                goal={activeBoardItem.goal}
                isDragging
                isOverlay
                isMobile={isMobileBoard}
                onOpenProject={onOpenProject}
              />
            )}
          </div>
        ) : null}
      </DragOverlay>
      <FloatingActionMenu
        open={menuState !== null}
        title={
          menuState?.kind === "project"
            ? boardProjects.find((entry) => entry.id === menuState.entityId)?.title ??
              "Project actions"
            : boardTasks.find((entry) => entry.id === menuState?.entityId)?.title ??
              "Work item actions"
        }
        subtitle={
          menuState?.kind === "project"
            ? "Edit, relink, move, or break this project into issues."
            : "Edit, relink, move, or create the next child work item."
        }
        items={activeMenuItems}
        position={menuState?.position ?? null}
        onClose={() => setMenuState(null)}
      />
      {confirmingDeleteTask ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,18,0.74)] p-4 backdrop-blur-xl">
          <Card className="w-full max-w-md border border-white/10 bg-[linear-gradient(180deg,rgba(16,22,36,0.96),rgba(9,13,22,0.98))] shadow-[0_32px_90px_rgba(5,8,18,0.58)]">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-rose-500/14 text-rose-100">
                <Trash2 className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-[1.35rem] leading-tight text-white">
                  {t("common.executionBoard.deleteConfirmTitle")}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/64">
                  {t("common.executionBoard.deleteConfirmDescription", {
                    title: confirmingDeleteTask.title
                  })}
                </div>
              </div>
            </div>
            <label className="mt-5 flex items-center gap-3 rounded-[18px] bg-white/[0.05] px-4 py-3 text-sm text-white/76">
              <input
                type="checkbox"
                checked={disableDeleteConfirmChoice}
                onChange={(event) =>
                  setDisableDeleteConfirmChoice(event.target.checked)
                }
                className="size-4 rounded border-white/20 bg-transparent text-[var(--primary)]"
              />
              <span>{t("common.executionBoard.deleteConfirmCheckbox")}</span>
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmingDeleteTask(null);
                  setDisableDeleteConfirmChoice(false);
                }}
              >
                {t("common.executionBoard.deleteConfirmCancel")}
              </Button>
              <Button
                className="bg-[linear-gradient(135deg,rgba(251,113,133,0.3),rgba(190,24,93,0.26))] text-white shadow-[0_16px_36px_rgba(190,24,93,0.18)]"
                pending={deletePendingTaskId === confirmingDeleteTask.id}
                pendingLabel={t("common.executionBoard.deletingTask")}
                onClick={() =>
                  void deleteTaskNow(
                    confirmingDeleteTask,
                    disableDeleteConfirmChoice
                  )
                }
              >
                {t("common.executionBoard.deleteConfirmSubmit")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </DndContext>
  );
}
