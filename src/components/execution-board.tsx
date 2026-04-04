import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp, Pencil, Play } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { UserBadge } from "@/components/ui/user-badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import type { Goal, Tag, Task, TaskStatus } from "@/lib/types";
import type { NotesSummaryByEntity } from "@/lib/types";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";

export const LANE_ORDER: TaskStatus[] = ["backlog", "focus", "in_progress", "blocked", "done"];

function isLaneContainerId(value: string) {
  return value.startsWith("lane:") || value.includes(":lane:");
}

function isLaneContainer(container: { id: string | number; data?: { current?: Record<string, unknown> } }) {
  return container.data?.current?.type === "lane" || isLaneContainerId(String(container.id));
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
  notesSummaryByEntity?: NotesSummaryByEntity;
}) {
  const { t, formatDate } = useI18n();
  const previousStatus = LANE_ORDER[LANE_ORDER.indexOf(task.status) - 1] ?? null;
  const nextStatus = LANE_ORDER[LANE_ORDER.indexOf(task.status) + 1] ?? null;
  const noteCount = getEntityNotesSummary(notesSummaryByEntity, "task", task.id).count;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full max-w-full min-w-0 overflow-hidden rounded-[18px] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition cursor-grab active:cursor-grabbing",
        isMobile && "touch-none select-none",
        isOverlay && "rotate-[0.5deg] bg-[linear-gradient(180deg,rgba(192,193,255,0.24),rgba(192,193,255,0.1))] shadow-[0_28px_80px_rgba(8,12,24,0.42),inset_0_0_0_1px_rgba(192,193,255,0.26)]",
        isDragging && !isOverlay && "opacity-35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]",
        isSelected
          ? "bg-[linear-gradient(180deg,rgba(192,193,255,0.18),rgba(192,193,255,0.06))] shadow-[0_16px_40px_rgba(8,12,24,0.32),inset_0_0_0_1px_rgba(192,193,255,0.26)]"
          : "bg-white/5"
      )}
      data-dragging={isDragging ? "true" : "false"}
      data-testid={`task-card-${task.id}`}
      onClick={() => onSelect(task.id)}
      {...dragAttributes}
      {...dragListeners}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Badge className="shrink-0 text-[11px] text-[var(--tertiary)]">{task.priority}</Badge>
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
          <span className="text-[11px] text-white/44">{task.points} xp</span>
        </div>
      </div>
      <EntityName kind="task" label={task.title} className="max-w-full" lines={3} labelClassName="[overflow-wrap:anywhere]" />
      <p className="mt-1.5 line-clamp-3 [overflow-wrap:anywhere] text-[12px] leading-5 text-white/62">{task.description || t("common.executionBoard.noExecutionNote")}</p>
      <div className="mt-2.5 flex min-w-0 flex-wrap gap-1.5">
        {goal ? <EntityBadge kind="goal" label={goal.title} compact wrap className="min-w-0 max-w-full" /> : null}
        <UserBadge user={task.user} compact />
        <EntityNoteCountLink entityType="task" entityId={task.id} count={noteCount} />
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
          <span>{formatDate(task.dueDate)}</span>
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
      notesSummaryByEntity={props.notesSummaryByEntity}
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

export function ExecutionBoard({
  tasks,
  goals,
  tags,
  selectedTaskId,
  onMove,
  onSelectTask,
  onStartTask,
  onQuickReopenTask,
  onOpenTask,
  onEditTask,
  notesSummaryByEntity
}: {
  tasks: Task[];
  goals: Goal[];
  tags: Tag[];
  selectedTaskId: string | null;
  onMove: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  onStartTask?: (taskId: string) => Promise<void>;
  onQuickReopenTask?: (taskId: string) => Promise<void>;
  onOpenTask?: (taskId: string) => void;
  onEditTask?: (taskId: string) => void;
  notesSummaryByEntity?: NotesSummaryByEntity;
}) {
  const { t } = useI18n();
  const boardInstanceId = useId();
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
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, TaskStatus>>({});
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
  const activeTask = activeTaskId ? boardTasks.find((task) => task.id === activeTaskId) ?? null : null;
  const activeGoal = activeTask ? goals.find((goal) => goal.id === activeTask.goalId) : undefined;
  const activeTags = activeTask ? activeTask.tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)).filter(Boolean) as Tag[] : [];

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

  function handleDragStart(event: DragStartEvent) {
    const taskId = event.active.data.current?.taskId;
    if (typeof taskId === "string") {
      setActiveTaskId(taskId);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTaskId(null);
    if (!over || active.id === over.id) {
      return;
    }

    const activeTaskId = typeof active.data.current?.taskId === "string" ? active.data.current.taskId : String(active.id);
    const task = boardTasks.find((entry) => entry.id === activeTaskId);
    if (!task) {
      return;
    }

    const overStatus = typeof over.data.current?.status === "string" ? (over.data.current.status as TaskStatus) : null;
    const overTaskId = typeof over.data.current?.taskId === "string" ? over.data.current.taskId : String(over.id);
    const laneId = overStatus ?? (boardTasks.find((entry) => entry.id === overTaskId)?.status ?? task.status);
    if (laneId !== task.status && LANE_ORDER.includes(laneId)) {
      setOptimisticStatuses((current) => ({
        ...current,
        [task.id]: laneId
      }));
      try {
        await onMove(task.id, laneId);
      } catch (error) {
        setOptimisticStatuses((current) => {
          const next = { ...current };
          delete next[task.id];
          return next;
        });
        throw error;
      }
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={laneFirstCollision}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveTaskId(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <div className="w-full max-w-full min-w-0 pb-2">
        {isMobileBoard ? (
          <div className="grid w-full max-w-full min-w-0 gap-2">
            {LANE_ORDER.map((status) => {
              const laneTasks = boardTasks.filter((task) => task.status === status);
              return (
                <SortableContext key={status} items={laneTasks.map((task) => `${boardInstanceId}:task:${task.id}`)} strategy={verticalListSortingStrategy}>
                  <LaneDropzone
                    droppableId={`${boardInstanceId}:lane:${status}`}
                    status={status}
                    title={laneLabels[status].title}
                    detail={laneLabels[status].detail}
                    count={laneTasks.length}
                    dragging={activeTaskId !== null}
                  >
                    {laneTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        sortableId={`${boardInstanceId}:task:${task.id}`}
                        task={task}
                        goal={goals.find((goal) => goal.id === task.goalId)}
                        tags={task.tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)).filter(Boolean) as Tag[]}
                        isSelected={selectedTaskId === task.id}
                        isMobile
                        onSelect={onSelectTask}
                        onStartTask={onStartTask}
                        onQuickReopen={onQuickReopenTask}
                        onStepTask={handleStepTask}
                        onOpenTask={onOpenTask}
                        onEditTask={onEditTask}
                        notesSummaryByEntity={notesSummaryByEntity}
                      />
                    ))}
                    {laneTasks.length === 0 ? (
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
              const laneTasks = boardTasks.filter((task) => task.status === status);
              return (
                <SortableContext key={status} items={laneTasks.map((task) => `${boardInstanceId}:task:${task.id}`)} strategy={verticalListSortingStrategy}>
                  <LaneDropzone
                    droppableId={`${boardInstanceId}:lane:${status}`}
                    status={status}
                    title={laneLabels[status].title}
                    detail={laneLabels[status].detail}
                    count={laneTasks.length}
                    dragging={activeTaskId !== null}
                  >
                    {laneTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        sortableId={`${boardInstanceId}:task:${task.id}`}
                        task={task}
                        goal={goals.find((goal) => goal.id === task.goalId)}
                        tags={task.tagIds.map((tagId) => tags.find((tag) => tag.id === tagId)).filter(Boolean) as Tag[]}
                        isSelected={selectedTaskId === task.id}
                        onSelect={onSelectTask}
                        onStartTask={onStartTask}
                        onQuickReopen={onQuickReopenTask}
                        onStepTask={handleStepTask}
                        onOpenTask={onOpenTask}
                        onEditTask={onEditTask}
                        notesSummaryByEntity={notesSummaryByEntity}
                      />
                    ))}
                    {laneTasks.length === 0 ? (
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
        {activeTask ? (
          <div className="w-[20rem] max-w-[calc(100vw-2rem)]">
            <TaskCardShell
              task={activeTask}
              goal={activeGoal}
              tags={activeTags}
              isSelected={selectedTaskId === activeTask.id}
              isDragging
              isOverlay
              isMobile={isMobileBoard}
              onSelect={() => {}}
              onStartTask={onStartTask}
              notesSummaryByEntity={notesSummaryByEntity}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
