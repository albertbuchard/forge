import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCheck,
  CircleAlert,
  Clock3,
  Files,
  GitBranch,
  Pencil,
  Play,
  Sparkles,
  Target
} from "lucide-react";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { TaskSchedulingDialog } from "@/components/calendar/task-scheduling-dialog";
import { TimeboxPlanningDialog } from "@/components/calendar/timebox-planning-dialog";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PreferenceEntityHandoffButton } from "@/components/preferences/preference-entity-handoff-button";
import { TaskDialog } from "@/components/task-dialog";
import { WorkAdjustmentDialog } from "@/components/work-adjustment-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState } from "@/components/ui/page-state";
import { UserBadge } from "@/components/ui/user-badge";
import {
  completeTaskRun,
  createTaskTimebox,
  createWorkAdjustment,
  deleteTask,
  deleteTaskTimebox,
  getCalendarOverview,
  getLifeForce,
  getTaskContext,
  patchTaskTimebox,
  patchTask,
  releaseTaskRun,
  removeActivityLog,
  uncompleteTask
} from "@/lib/api";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import {
  evaluateSchedulingRulesNow,
  getTaskSchedulingRules
} from "@/lib/calendar-rules";
import {
  getActivityEventCtaLabel,
  getActivityEventHref
} from "@/lib/entity-links";
import { useI18n } from "@/lib/i18n";
import {
  estimateTaskTimeboxActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import { cn } from "@/lib/utils";
import { useForgeShell } from "@/components/shell/app-shell";
import type { TaskStatus, TaskTimebox } from "@/lib/types";
import { getSingleSelectedUserId } from "@/lib/user-ownership";

function DetailLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-white/58">
      <span>{label}</span>
      {help ? <InfoTooltip content={help} label={`Explain ${label}`} /> : null}
    </div>
  );
}

const STATUS_META: Array<{
  status: TaskStatus;
  label: string;
  description: string;
  icon: typeof Clock3;
}> = [
  {
    status: "backlog",
    label: "Backlog",
    description: "Not started yet.",
    icon: Clock3
  },
  {
    status: "focus",
    label: "Focus",
    description: "Ready to start soon.",
    icon: Target
  },
  {
    status: "in_progress",
    label: "In progress",
    description: "Work is active now.",
    icon: Play
  },
  {
    status: "blocked",
    label: "Blocked",
    description: "Something is stopping progress.",
    icon: CircleAlert
  },
  {
    status: "done",
    label: "Done",
    description: "The task is completed.",
    icon: CheckCheck
  }
];

const WORK_ITEM_LEVEL_META = {
  issue: {
    label: "Issue",
    noun: "issue",
    descriptor: "Vertical slice issue",
    heroDescription:
      "Track the vertical slice, keep the acceptance bar explicit, and surface the execution context without losing the product-level story."
  },
  task: {
    label: "Task",
    noun: "task",
    descriptor: "AI session task",
    heroDescription:
      "Drive one focused AI execution session, keep the work contract crisp, and show the concrete evidence of what changed."
  },
  subtask: {
    label: "Subtask",
    noun: "subtask",
    descriptor: "Granular child step",
    heroDescription:
      "Keep the child step sharply scoped, trace its parent chain, and make the work evidence visible without opening the editor."
  }
} as const;

const GIT_REF_META = {
  commit: {
    label: "Commit",
    className: "bg-emerald-500/12 text-emerald-100"
  },
  branch: {
    label: "Branch",
    className: "bg-sky-500/12 text-sky-100"
  },
  pull_request: {
    label: "Pull request",
    className: "bg-fuchsia-500/12 text-fuchsia-100"
  }
} as const;

function getWorkItemVisualKind(level: "issue" | "task" | "subtask") {
  return level === "issue" ? "issue" : "task";
}

function getEntityHref(entityType: string, entityId: string) {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "strategy":
      return `/strategies/${entityId}`;
    case "habit":
      return "/habits";
    default:
      return null;
  }
}

function formatDurationLabel(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) {
    return "0 min";
  }
  if (seconds < 3600) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
  className
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-4 sm:p-5",
        className
      )}
    >
      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
        {eyebrow}
      </div>
      <div className="mt-2 text-lg font-medium text-white">{title}</div>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-white/56">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  className
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-white/8 bg-white/[0.035] px-4 py-3",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
        {label}
      </div>
      <div className="mt-2 text-base font-medium text-white">{value}</div>
      {hint ? (
        <div className="mt-1 text-sm leading-5 text-white/52">{hint}</div>
      ) : null}
    </div>
  );
}

export function TaskDetailPage() {
  const { t, formatDate, formatDateTime } = useI18n();
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workAdjustmentOpen, setWorkAdjustmentOpen] = useState(false);
  const [timeboxDialogOpen, setTimeboxDialogOpen] = useState(false);
  const [taskSchedulingDialogOpen, setTaskSchedulingDialogOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [editingTimebox, setEditingTimebox] = useState<TaskTimebox | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : false
  );
  const [calendarWindow] = useState(() => {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString()
    };
  });
  const [planningWindow] = useState(() => {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    to.setHours(23, 59, 59, 999);
    return {
      from: from.toISOString(),
      to: to.toISOString()
    };
  });
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const sync = (event?: MediaQueryListEvent) =>
      setIsMobile(event ? event.matches : mediaQuery.matches);
    sync();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }
    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  const taskContextQuery = useQuery({
    queryKey: ["task-context", params.taskId],
    queryFn: () => getTaskContext(params.taskId!),
    enabled: Boolean(params.taskId)
  });
  const calendarOverviewQuery = useQuery({
    queryKey: [
      "task-calendar-overview",
      params.taskId,
      calendarWindow.from,
      calendarWindow.to,
      ...selectedUserIds
    ],
    queryFn: () =>
      getCalendarOverview({
        ...calendarWindow,
        userIds: selectedUserIds
      }),
    enabled: Boolean(params.taskId)
  });
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: async () => (await getLifeForce(selectedUserIds)).lifeForce
  });
  const planningCalendarOverviewQuery = useQuery({
    queryKey: [
      "task-calendar-overview",
      params.taskId,
      planningWindow.from,
      planningWindow.to,
      ...selectedUserIds
    ],
    queryFn: () =>
      getCalendarOverview({
        ...planningWindow,
        userIds: selectedUserIds
      }),
    enabled: Boolean(params.taskId)
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
      queryClient.invalidateQueries({
        queryKey: ["task-context", params.taskId]
      }),
      queryClient.invalidateQueries({ queryKey: ["activity-archive"] }),
      queryClient.invalidateQueries({ queryKey: ["project-board"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-operator-context"] }),
      queryClient.invalidateQueries({
        queryKey: ["task-calendar-overview", params.taskId]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-calendar-overview"] })
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
    onSuccess: invalidateAll
  });
  const uncompleteMutation = useMutation({
    mutationFn: (taskId: string) => uncompleteTask(taskId),
    onSuccess: invalidateAll
  });
  const removeEventMutation = useMutation({
    mutationFn: (eventId: string) => removeActivityLog(eventId),
    onSuccess: invalidateAll
  });
  const releaseRunMutation = useMutation({
    mutationFn: ({
      runId,
      actor,
      note
    }: {
      runId: string;
      actor?: string;
      note?: string;
    }) => releaseTaskRun(runId, { actor, note: note ?? "" }),
    onSuccess: invalidateAll
  });
  const completeRunMutation = useMutation({
    mutationFn: ({
      runId,
      actor,
      note
    }: {
      runId: string;
      actor?: string;
      note?: string;
    }) => completeTaskRun(runId, { actor, note: note ?? "" }),
    onSuccess: invalidateAll
  });
  const workAdjustmentMutation = useMutation({
    mutationFn: createWorkAdjustment,
    onSuccess: invalidateAll
  });
  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: invalidateAll
  });
  const createTimeboxMutation = useMutation({
    mutationFn: createTaskTimebox,
    onSuccess: invalidateAll
  });
  const patchTimeboxMutation = useMutation({
    mutationFn: ({
      timeboxId,
      patch
    }: {
      timeboxId: string;
      patch: Parameters<typeof patchTaskTimebox>[1];
    }) => patchTaskTimebox(timeboxId, patch),
    onSuccess: invalidateAll
  });
  const deleteTimeboxMutation = useMutation({
    mutationFn: deleteTaskTimebox,
    onSuccess: invalidateAll
  });

  const payload = taskContextQuery.data;

  if (taskContextQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (taskContextQuery.isError) {
    return (
      <ErrorState
        eyebrow={t("common.taskDetail.errorEyebrow")}
        error={taskContextQuery.error}
        onRetry={() => void taskContextQuery.refetch()}
      />
    );
  }

  if (!payload) {
    return (
      <ErrorState
        eyebrow={t("common.taskDetail.errorEyebrow")}
        error={new Error(t("common.taskDetail.emptyPayload"))}
        onRetry={() => void taskContextQuery.refetch()}
      />
    );
  }

  const currentRun = payload.activeTaskRun ?? null;
  const actionPointSummary = payload.task.actionPointSummary ?? null;
  const currentStatus =
    STATUS_META.find((entry) => entry.status === payload.task.status) ??
    STATUS_META[0];
  const taskLevel = payload.task.level ?? "task";
  const aiInstructions = payload.task.aiInstructions ?? "";
  const effectiveSchedulingRules = getTaskSchedulingRules(
    payload.task,
    payload.project?.schedulingRules
  );
  const schedulingState = evaluateSchedulingRulesNow({
    rules: effectiveSchedulingRules,
    overview: calendarOverviewQuery.data?.calendar
  });
  const scheduledTimeboxes = (
    planningCalendarOverviewQuery.data?.calendar.timeboxes ?? []
  )
    .filter((timebox) => timebox.taskId === payload.task.id)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const nextScheduledTimebox = scheduledTimeboxes[0] ?? null;
  const workItemMeta = WORK_ITEM_LEVEL_META[taskLevel];
  const workItemVisualKind = getWorkItemVisualKind(taskLevel);
  const relatedWorkItems = shell.snapshot.workItems ?? shell.snapshot.tasks ?? [];
  const parentWorkItem = payload.task.parentWorkItemId
    ? relatedWorkItems.find((item) => item.id === payload.task.parentWorkItemId) ??
      null
    : null;
  const childWorkItems = relatedWorkItems
    .filter((item) => item.parentWorkItemId === payload.task.id)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const availableTags = shell.snapshot.tags ?? [];
  const mappedTags = (payload.task.tagIds ?? [])
    .map((tagId) => availableTags.find((tag) => tag.id === tagId) ?? null)
    .filter((tag): tag is (typeof availableTags)[number] => Boolean(tag));
  const acceptanceCriteria = payload.task.acceptanceCriteria ?? [];
  const blockerLinks = payload.task.blockerLinks ?? [];
  const gitRefs = payload.task.gitRefs ?? [];
  const completionReport = payload.task.completionReport;
  const linkedGitRefIds = new Set(completionReport?.linkedGitRefIds ?? []);
  const closeoutGitRefs = gitRefs.filter((ref) => linkedGitRefIds.has(ref.id));
  const supportingGitRefs = gitRefs.filter((ref) => !linkedGitRefIds.has(ref.id));
  const botOwner =
    payload.task.user?.kind === "bot" || payload.task.ownerUser?.kind === "bot";
  const botAssignees = (payload.task.assignees ?? []).filter(
    (user) => user.kind === "bot"
  );
  const hasAiBrief = aiInstructions.trim().length > 0;
  const actionButtonClass = isMobile ? "w-full justify-start" : "";

  const describeRunStatus = (
    status: (typeof payload.taskRuns)[number]["status"]
  ) => {
    switch (status) {
      case "active":
        return "Active";
      case "completed":
        return "Completed";
      case "released":
        return "Paused";
      case "timed_out":
        return "Timed out";
      default:
        return status;
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    await shell.patchTaskStatus(payload.task.id, status);
    await invalidateAll();
    setStatusSheetOpen(false);
  };

  const handleDeleteTask = async () => {
    const confirmed = window.confirm(
      `Delete ${workItemMeta.noun} "${payload.task.title}"?`
    );
    if (!confirmed) {
      return;
    }
    await deleteTaskMutation.mutateAsync(payload.task.id);
    navigate(
      payload.project
        ? `/projects/${payload.project.id}`
        : payload.goal
          ? `/goals/${payload.goal.id}`
          : "/kanban"
    );
  };

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind={workItemVisualKind}
        title={
          <EntityName
            kind={workItemVisualKind}
            label={payload.task.title}
            variant="heading"
            size="lg"
            lines={3}
            className="max-w-full"
            labelClassName="[overflow-wrap:anywhere]"
          />
        }
        titleText={payload.task.title}
        description={
          payload.task.description ? (
            <NoteMarkdown
              markdown={payload.task.description}
              className="[&>p]:text-[13px] [&>p]:leading-6 [&>blockquote]:text-[13px] [&>ul]:text-[13px] [&>ol]:text-[13px]"
            />
          ) : (
            workItemMeta.heroDescription
          )
        }
        badge={
          actionPointSummary
            ? `${payload.task.points} xp · ${Math.round(actionPointSummary.totalCostAp)} AP`
            : `${payload.task.points} xp`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <PreferenceEntityHandoffButton
              userId={defaultUserId}
              domain="tasks"
              entityType="task"
              entityId={payload.task.id}
              label={payload.task.title}
              description={payload.task.description}
            />
            <OpenInGraphButton entityType="task" entityId={payload.task.id} />
          </div>
        }
      />

      <Card className="min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              {workItemMeta.label}
            </div>
            <div className="mt-2">
              <EntityName
                kind={workItemVisualKind}
                label={payload.task.title}
                variant="heading"
                size="xl"
                lines={3}
                className="max-w-full"
                labelClassName="[overflow-wrap:anywhere]"
              />
            </div>
            <div className="mt-3 text-sm leading-6 text-white/60">
              {payload.task.description ? (
                <NoteMarkdown
                  markdown={payload.task.description}
                  className="[&>p]:text-sm [&>p]:leading-6 [&>blockquote]:text-sm [&>ul]:text-sm [&>ol]:text-sm"
                />
              ) : (
                `This page shows the ${workItemMeta.noun}, where it belongs, what is driving it, and the concrete evidence of what has happened on it so far.`
              )}
            </div>
          </div>
          <div className={cn("shrink-0", isMobile ? "w-full" : "")}>
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                isMobile && "grid w-full grid-cols-1"
              )}
            >
              <Button
                className={actionButtonClass}
                pending={taskContextQuery.isFetching}
                pendingLabel={currentRun ? "Opening" : "Starting"}
                onClick={async () => {
                  await shell.startTaskNow(payload.task.id);
                  await invalidateAll();
                }}
              >
                <Play className="size-4 fill-current" />
                {currentRun ? "Focus work" : "Start work"}
              </Button>
              {currentRun ? (
                <>
                  <Button
                    className={actionButtonClass}
                    variant="secondary"
                    pending={releaseRunMutation.isPending}
                    pendingLabel="Pausing"
                    onClick={async () => {
                      await releaseRunMutation.mutateAsync({
                        runId: currentRun.id,
                        actor: currentRun.actor,
                        note: currentRun.note
                      });
                    }}
                  >
                    Pause
                  </Button>
                  <Button
                    className={actionButtonClass}
                    variant="secondary"
                    pending={completeRunMutation.isPending}
                    pendingLabel="Completing"
                    onClick={async () => {
                      await completeRunMutation.mutateAsync({
                        runId: currentRun.id,
                        actor: currentRun.actor,
                        note: currentRun.note
                      });
                    }}
                  >
                    Complete
                  </Button>
                </>
              ) : null}
              <Button
                className={actionButtonClass}
                variant="secondary"
                onClick={() => setStatusSheetOpen(true)}
              >
                <currentStatus.icon className="size-4" />
                Change status
              </Button>
              <Button
                className={actionButtonClass}
                variant="secondary"
                onClick={() => setDialogOpen(true)}
              >
                <Pencil className="size-4" />
                Edit {workItemMeta.noun}
              </Button>
              <Button
                className={actionButtonClass}
                variant="secondary"
                onClick={() => setWorkAdjustmentOpen(true)}
              >
                <Clock3 className="size-4" />
                Adjust work
              </Button>
              <Button
                className={actionButtonClass}
                variant="secondary"
                pending={createTimeboxMutation.isPending}
                pendingLabel="Planning"
                onClick={() => setTimeboxDialogOpen(true)}
              >
                <CalendarDays className="size-4" />
                Time Box
              </Button>
              {payload.task.status === "done" ? (
                <Button
                  className={actionButtonClass}
                  variant="secondary"
                  onClick={async () => {
                    await uncompleteMutation.mutateAsync(payload.task.id);
                  }}
                >
                  Mark as not done
                </Button>
              ) : null}
              <Button
                className={cn(actionButtonClass, "text-rose-200 hover:bg-rose-500/10")}
                variant="ghost"
                pending={deleteTaskMutation.isPending}
                pendingLabel={t("common.taskDetail.deleting")}
                onClick={() => void handleDeleteTask()}
              >
                Delete {workItemMeta.noun}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
            {workItemMeta.label}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {workItemMeta.descriptor}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {currentStatus.label}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {t(`common.enums.priority.${payload.task.priority}`)}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {t(`common.enums.effort.${payload.task.effort}`)}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {t(`common.enums.energy.${payload.task.energy}`)}
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">
            {payload.task.points} xp
          </Badge>
          {payload.task.time.totalCreditedSeconds > 0 ? (
            <Badge className="bg-white/[0.08] text-white/72">
              {Math.floor(payload.task.time.totalCreditedSeconds / 60)} min
              tracked
            </Badge>
          ) : null}
          {currentRun ? (
            <Badge className="bg-emerald-500/12 text-emerald-200">
              Timer active
            </Badge>
          ) : null}
          {payload.task.executionMode ? (
            <Badge
              className={
                payload.task.executionMode === "afk"
                  ? "bg-emerald-500/12 text-emerald-100"
                  : "bg-amber-500/12 text-amber-100"
              }
            >
              {payload.task.executionMode.toUpperCase()}
            </Badge>
          ) : null}
          {hasAiBrief ? (
            <Badge className="bg-sky-500/12 text-sky-100">
              AI brief ready
            </Badge>
          ) : null}
          {botOwner || botAssignees.length > 0 ? (
            <Badge className="bg-fuchsia-500/12 text-fuchsia-100">
              Bot collaboration live
            </Badge>
          ) : null}
          {nextScheduledTimebox ? (
            <Link
              to={`/calendar?timeboxId=${encodeURIComponent(nextScheduledTimebox.id)}`}
              className="inline-flex"
            >
              <Badge className="cursor-pointer bg-[var(--primary)]/16 text-[var(--primary)] transition hover:bg-[var(--primary)]/24">
                Timeboxed · {formatDateTime(nextScheduledTimebox.startsAt)}
              </Badge>
            </Link>
          ) : null}
        </div>

        {!isMobile ? (
          <div className="mt-5">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Status
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              {STATUS_META.map((entry) => {
                const Icon = entry.icon;
                const selected = entry.status === payload.task.status;
                return (
                  <button
                    key={entry.status}
                    type="button"
                    disabled={selected || updateTaskMutation.isPending}
                    className={`rounded-[18px] border px-3.5 py-3 text-left transition ${
                      selected
                        ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                        : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]"
                    }`}
                    onClick={() => void handleStatusChange(entry.status)}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-[var(--primary)]" />
                      <span className="font-medium">{entry.label}</span>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-white/54">
                      {entry.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <SectionCard
            eyebrow="Hierarchy"
            title="Context map"
            description={`See where this ${workItemMeta.noun} sits in the larger planning ladder without opening the board.`}
          >
            <div className="grid gap-4">
              <div>
                <DetailLabel
                  label="Project"
                  help={`The project is the main work stream this ${workItemMeta.noun} belongs to.`}
                />
                <div className="mt-2">
                  {payload.project ? (
                    <Link
                      to={`/projects/${payload.project.id}`}
                      className="inline-flex max-w-full"
                    >
                      <EntityBadge
                        kind="project"
                        label={payload.project.title}
                        compact
                        gradient={false}
                        wrap
                        className="max-w-full"
                      />
                    </Link>
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No project linked
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <DetailLabel
                  label="Goal"
                  help="The goal shows the longer-term result this work supports."
                />
                <div className="mt-2">
                  {payload.goal ? (
                    <Link
                      to={`/goals/${payload.goal.id}`}
                      className="inline-flex max-w-full"
                    >
                      <EntityBadge
                        kind="goal"
                        label={payload.goal.title}
                        compact
                        gradient={false}
                        wrap
                        className="max-w-full"
                      />
                    </Link>
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No goal linked
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <DetailLabel
                  label="Parent item"
                  help="Issues parent tasks, tasks parent subtasks, and split child items stay legible here."
                />
                <div className="mt-2">
                  {parentWorkItem ? (
                    <Link
                      to={`/tasks/${parentWorkItem.id}`}
                      className="inline-flex max-w-full"
                    >
                      <EntityBadge
                        kind={getWorkItemVisualKind(parentWorkItem.level)}
                        label={parentWorkItem.title}
                        compact
                        gradient={false}
                        wrap
                        className="max-w-full"
                      />
                    </Link>
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No parent work item
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <DetailLabel
                  label="Child items"
                  help="Child work items let you scan the next layer down without leaving the detail view."
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {childWorkItems.length > 0 ? (
                    childWorkItems.map((item) => (
                      <Link
                        key={item.id}
                        to={`/tasks/${item.id}`}
                        className="inline-flex max-w-full"
                      >
                        <EntityBadge
                          kind={getWorkItemVisualKind(item.level)}
                          label={item.title}
                          compact
                          gradient={false}
                          wrap
                          className="max-w-full"
                        />
                      </Link>
                    ))
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No child work items
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Execution"
            title="Execution profile"
            description="Surface the operating mode, AI posture, tags, and blockers as a single readable brief."
          >
            <div className="grid gap-3">
              <StatTile
                label="Work-item type"
                value={workItemMeta.descriptor}
                hint={
                  taskLevel === "task"
                    ? "Tasks are meant to fit one focused AI session."
                    : taskLevel === "issue"
                      ? "Issues hold the vertical slice and its delivery contract."
                      : "Subtasks stay intentionally small and concrete."
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile
                  label="Execution mode"
                  value={
                    payload.task.executionMode
                      ? payload.task.executionMode.toUpperCase()
                      : "Not set"
                  }
                />
                <StatTile
                  label="AI posture"
                  value={
                    hasAiBrief
                      ? "AI brief ready"
                      : taskLevel === "issue"
                        ? "Issue narrative only"
                        : "Needs AI brief"
                  }
                />
              </div>
              <div>
                <DetailLabel
                  label="Tags"
                  help="Tags shape filtering and fast scanning across the board and hierarchy views."
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {mappedTags.length > 0 ? (
                    mappedTags.map((tag) => (
                      <Badge key={tag.id} className="bg-white/[0.08] text-white/72">
                        {tag.name}
                      </Badge>
                    ))
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No tags
                    </Badge>
                  )}
                </div>
              </div>
              <div>
                <DetailLabel
                  label="Blockers"
                  help="Blockers tie this work item to the entities that currently constrain it."
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {blockerLinks.length > 0 ? (
                    blockerLinks.map((blocker) => {
                      const href = getEntityHref(
                        blocker.entityType,
                        blocker.entityId
                      );
                      const content = (
                        <Badge
                          key={`${blocker.entityType}:${blocker.entityId}`}
                          wrap
                          className="bg-amber-500/12 text-amber-100"
                        >
                          {blocker.label ??
                            `${blocker.entityType} · ${blocker.entityId}`}
                        </Badge>
                      );
                      if (!href) {
                        return content;
                      }
                      return (
                        <Link
                          key={`${blocker.entityType}:${blocker.entityId}`}
                          to={href}
                          className="inline-flex max-w-full"
                        >
                          {content}
                        </Link>
                      );
                    })
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No blockers linked
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="People and timing"
            title="Accountability surface"
            description="Show who owns the work, who is helping, and when the record moved."
          >
            <div className="grid gap-3">
              <StatTile
                label="Owner"
                value={
                  <div className="flex flex-wrap items-center gap-2">
                    {payload.task.user ? (
                      <UserBadge user={payload.task.user} compact />
                    ) : null}
                    <span>{payload.task.owner}</span>
                    {botOwner ? (
                      <Badge className="bg-fuchsia-500/12 text-fuchsia-100">
                        <Bot className="mr-1 size-3.5" />
                        Bot owner
                      </Badge>
                    ) : null}
                  </div>
                }
              />
              <div>
                <DetailLabel label="Assignees" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {payload.task.assignees && payload.task.assignees.length > 0 ? (
                    payload.task.assignees.map((user) => (
                      <div
                        key={user.id}
                        className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.05] px-3 py-1.5 text-sm text-white/72"
                      >
                        <UserBadge user={user} compact />
                        <span>{user.displayName}</span>
                        {user.kind === "bot" ? (
                          <Bot className="size-3.5 text-fuchsia-200" />
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <Badge className="bg-white/[0.08] text-white/65">
                      No assignees
                    </Badge>
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile
                  label="Due date"
                  value={formatDate(payload.task.dueDate)}
                  hint={`Use due dates only when timing materially matters for this ${workItemMeta.noun}.`}
                />
                <StatTile
                  label="Completed"
                  value={
                    payload.task.completedAt
                      ? formatDateTime(payload.task.completedAt)
                      : "Not completed"
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile
                  label="Created"
                  value={formatDateTime(payload.task.createdAt)}
                />
                <StatTile
                  label="Updated"
                  value={formatDateTime(payload.task.updatedAt)}
                />
              </div>
            </div>
          </SectionCard>
        </div>

        {hasAiBrief ||
        acceptanceCriteria.length > 0 ||
        completionReport ||
        gitRefs.length > 0 ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <SectionCard
              eyebrow="Execution brief"
              title="AI and delivery instructions"
              description="The narrative, criteria, and execution intent live together so the detail view can stand on its own."
            >
              <div className="grid gap-4">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm text-white/62">
                    <Sparkles className="size-4 text-[var(--primary)]" />
                    <span>AI instructions</span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/72">
                    {hasAiBrief ? (
                      <NoteMarkdown
                        markdown={aiInstructions}
                        className="[&>p]:text-sm [&>p]:leading-6 [&>blockquote]:text-sm [&>ul]:text-sm [&>ol]:text-sm"
                      />
                    ) : (
                      `No AI instructions have been written for this ${workItemMeta.noun} yet.`
                    )}
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm text-white/62">
                    <Target className="size-4 text-emerald-200" />
                    <span>Acceptance criteria</span>
                  </div>
                  {acceptanceCriteria.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {acceptanceCriteria.map((criterion, index) => (
                        <div
                          key={`${payload.task.id}-criterion-${index}`}
                          className="rounded-[16px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/72"
                        >
                          {criterion}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-[16px] border border-dashed border-white/10 px-4 py-3 text-sm text-white/52">
                      No acceptance criteria captured yet.
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              eyebrow="Evidence"
              title="Work done, changed files, and git traceability"
              description="Show the work summary, file footprint, and linked refs directly in the detail view."
            >
              <div className="grid gap-4">
                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm text-white/62">
                    <BriefcaseBusiness className="size-4 text-sky-200" />
                    <span>Work summary</span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/72">
                    {completionReport?.workSummary ? (
                      <NoteMarkdown
                        markdown={completionReport.workSummary}
                        className="[&>p]:text-sm [&>p]:leading-6 [&>blockquote]:text-sm [&>ul]:text-sm [&>ol]:text-sm"
                      />
                    ) : (
                      "No work summary yet."
                    )}
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm text-white/62">
                    <Files className="size-4 text-amber-200" />
                    <span>Changed files</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {completionReport?.modifiedFiles &&
                    completionReport.modifiedFiles.length > 0 ? (
                      completionReport.modifiedFiles.map((file) => (
                        <Badge
                          key={file}
                          wrap
                          className="bg-white/[0.08] font-mono text-[11px] text-white/74"
                        >
                          {file}
                        </Badge>
                      ))
                    ) : (
                      <Badge className="bg-white/[0.08] text-white/65">
                        No changed files listed
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm text-white/62">
                    <GitBranch className="size-4 text-fuchsia-200" />
                    <span>Git refs</span>
                  </div>
                  <div className="mt-3 grid gap-3">
                    {[closeoutGitRefs, supportingGitRefs]
                      .filter((group) => group.length > 0)
                      .map((group, groupIndex) => (
                        <div key={`git-group-${groupIndex}`} className="grid gap-2">
                          {closeoutGitRefs.length > 0 && supportingGitRefs.length > 0 ? (
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                              {groupIndex === 0
                                ? "Linked in completion report"
                                : "Other recorded refs"}
                            </div>
                          ) : null}
                          {group.map((ref) => {
                            const refMeta = GIT_REF_META[ref.refType];
                            const refBody = (
                              <div className="rounded-[16px] border border-white/8 bg-white/[0.04] px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge className={refMeta.className}>
                                    {refMeta.label}
                                  </Badge>
                                  <div className="font-mono text-sm text-white/84">
                                    {ref.refValue}
                                  </div>
                                </div>
                                <div className="mt-2 text-sm text-white/58">
                                  {ref.displayTitle || ref.repository || ref.provider}
                                </div>
                              </div>
                            );
                            if (!ref.url) {
                              return <div key={ref.id}>{refBody}</div>;
                            }
                            return (
                              <a
                                key={ref.id}
                                href={ref.url}
                                target="_blank"
                                rel="noreferrer"
                                className="group block"
                              >
                                {refBody}
                                <div className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-[var(--primary)]">
                                  Open ref
                                  <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      ))}
                    {gitRefs.length === 0 ? (
                      <Badge className="bg-white/[0.08] text-white/65">
                        No git refs recorded
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <SectionCard
            eyebrow="Work done"
            title="Execution ledger"
            description="Surface tracked work, credited work, and manual adjustments without opening the timer history."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Tracked total"
                value={formatDurationLabel(payload.task.time.totalTrackedSeconds)}
              />
              <StatTile
                label="Credited total"
                value={formatDurationLabel(payload.task.time.totalCreditedSeconds)}
              />
              <StatTile
                label="Live work"
                value={formatDurationLabel(payload.task.time.liveCreditedSeconds)}
              />
              <StatTile
                label="Manual adjustments"
                value={formatDurationLabel(payload.task.time.manualAdjustedSeconds)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="bg-white/[0.08] text-white/72">
                Today credited {formatDurationLabel(payload.task.time.todayCreditedSeconds ?? 0)}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Live tracked {formatDurationLabel(payload.task.time.liveTrackedSeconds)}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Active runs {payload.task.time.activeRunCount}
              </Badge>
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Workflow health"
            title="Signal scan"
            description="A fast read on how ready this work item is for execution and closeout."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile
                label="Closeout readiness"
                value={
                  completionReport?.workSummary || closeoutGitRefs.length > 0
                    ? "Evidence present"
                    : "Needs closeout evidence"
                }
                hint={
                  completionReport?.modifiedFiles?.length
                    ? `${completionReport.modifiedFiles.length} changed file${completionReport.modifiedFiles.length === 1 ? "" : "s"} listed`
                    : "No changed-file evidence captured yet."
                }
              />
              <StatTile
                label="Collaboration model"
                value={
                  botOwner || botAssignees.length > 0
                    ? "Human + bot"
                    : payload.task.assignees && payload.task.assignees.length > 0
                      ? "Shared human work"
                      : "Single owner"
                }
                hint={
                  botAssignees.length > 0
                    ? `${botAssignees.length} bot assignee${botAssignees.length === 1 ? "" : "s"} attached`
                    : "No bot assignee attached."
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="bg-white/[0.08] text-white/72">
                Priority {t(`common.enums.priority.${payload.task.priority}`)}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Effort {t(`common.enums.effort.${payload.task.effort}`)}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Energy {t(`common.enums.energy.${payload.task.energy}`)}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                Duration {formatDurationLabel(payload.task.plannedDurationSeconds)}
              </Badge>
            </div>
          </SectionCard>
        </div>

        <div className="mt-5 rounded-[20px] bg-white/[0.04] p-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Action Point load
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Total cost" />
              <div className="mt-2 text-lg text-white">
                {actionPointSummary
                  ? formatLifeForceAp(actionPointSummary.totalCostAp)
                  : "Not calibrated"}
              </div>
            </div>
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Today debit" />
              <div className="mt-2 text-lg text-white">
                {actionPointSummary
                  ? formatLifeForceAp(actionPointSummary.spentTodayAp)
                  : "0 AP"}
              </div>
            </div>
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Sustain rate" />
              <div className="mt-2 text-lg text-white">
                {actionPointSummary
                  ? formatLifeForceRate(
                      actionPointSummary.sustainRateApPerHour
                    )
                  : "0 AP/h"}
              </div>
            </div>
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Expected duration" />
              <div className="mt-2 text-lg text-white">
                {actionPointSummary
                  ? `${Math.round(
                      actionPointSummary.expectedDurationSeconds / 3600
                    )} h`
                  : "No target"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {payload.task.splitSuggestion?.shouldSplit ? (
              <Badge className="bg-amber-400/12 text-amber-100">
                Split it
              </Badge>
            ) : null}
            {actionPointSummary ? (
              <Badge className="bg-white/[0.08] text-white/72">
                Remaining {formatLifeForceAp(actionPointSummary.remainingAp)}
              </Badge>
            ) : null}
            {actionPointSummary ? (
              <Badge className="bg-white/[0.08] text-white/72">
                Spent total {formatLifeForceAp(actionPointSummary.spentTotalAp)}
              </Badge>
            ) : null}
            {actionPointSummary ? (
              <Badge className="bg-white/[0.08] text-white/72">
                {actionPointSummary.costBand}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-white/58">
            This task only debits the Action Points you actually worked today.
            Marking it done does not consume the full estimate by itself.
          </p>
        </div>

        <div className="mt-5 rounded-[20px] bg-white/[0.04] p-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Today&apos;s Life Force context
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Daily AP" />
              <div className="mt-2 text-lg text-white">
                {lifeForceQuery.data
                  ? `${formatLifeForceAp(lifeForceQuery.data.spentTodayAp)} / ${formatLifeForceAp(lifeForceQuery.data.dailyBudgetAp)}`
                  : "Loading..."}
              </div>
            </div>
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Instant headroom" />
              <div className="mt-2 text-lg text-white">
                {lifeForceQuery.data
                  ? formatLifeForceRate(lifeForceQuery.data.instantFreeApPerHour)
                  : "Loading..."}
              </div>
            </div>
            <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
              <DetailLabel label="Forecast" />
              <div className="mt-2 text-lg text-white">
                {lifeForceQuery.data
                  ? `${formatLifeForceAp(lifeForceQuery.data.forecastAp)} / ${formatLifeForceAp(lifeForceQuery.data.dailyBudgetAp)}`
                  : "Loading..."}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[20px] bg-white/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm text-white/58">
            <span>Current timer</span>
            <InfoTooltip
              content="This shows whether work is running on the task right now and how much time has been credited."
              label="Explain current timer"
            />
          </div>
          <div className="mt-3 text-white">
            {currentRun
              ? `${currentRun.timerMode === "planned" ? "Planned" : "Unlimited"} timer active with ${Math.floor(currentRun.creditedSeconds / 60)} credited minutes.`
              : "No timer is running on this task right now."}
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="rounded-[20px] bg-white/[0.04] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Task scheduling
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
                <DetailLabel label="Rule source" />
                <div className="mt-2 text-white">
                  {payload.task.schedulingRules
                    ? "Task-specific override"
                    : "Uses project defaults"}
                </div>
              </div>
              <div className="rounded-[16px] bg-white/[0.03] px-3.5 py-3">
                <DetailLabel label="Planned duration" />
                <div className="mt-2 text-white">
                  {payload.task.plannedDurationSeconds
                    ? `${Math.round(payload.task.plannedDurationSeconds / 60)} min`
                    : "No duration target"}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/58">
              Scheduling rules now live behind the guided modal flow instead of an inline editor. Use it to change eligible blocks, blocked contexts, and the planning duration without overcrowding the task page.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setTaskSchedulingDialogOpen(true)}>
                <CalendarDays className="size-4" />
                Edit task scheduling
              </Button>
              <Link to="/calendar">
                <Button variant="secondary">Open calendar workspace</Button>
              </Link>
            </div>
          </div>

          <div className="rounded-[20px] bg-white/[0.04] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Calendar status
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge
                className={
                  schedulingState.tone === "blocked"
                    ? "bg-rose-500/14 text-rose-100"
                    : schedulingState.tone === "waiting"
                      ? "bg-amber-500/14 text-amber-100"
                      : "bg-emerald-500/14 text-emerald-100"
                }
              >
                {schedulingState.label}
              </Badge>
              <Badge className="bg-white/[0.08] text-white/72">
                {payload.task.schedulingRules
                  ? "Task override"
                  : "Using project defaults"}
              </Badge>
              {payload.task.plannedDurationSeconds ? (
                <Badge className="bg-white/[0.08] text-white/72">
                  {Math.round(payload.task.plannedDurationSeconds / 60)} min
                  target
                </Badge>
              ) : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-white/58">
              Forge checks these rules before a live run starts. If the current
              calendar context is blocked, you can still override with an
              explicit reason.
            </p>
            {schedulingState.context.length > 0 ? (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                  Current context
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {schedulingState.context.map((entry) => (
                    <Badge
                      key={entry}
                      className="bg-white/[0.08] text-white/72"
                    >
                      {entry}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {schedulingState.conflicts.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {schedulingState.conflicts.map((entry) => (
                  <div
                    key={entry}
                    className="rounded-[16px] bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
                  >
                    {entry}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                pending={createTimeboxMutation.isPending || patchTimeboxMutation.isPending}
                pendingLabel="Planning"
                onClick={() => {
                  setEditingTimebox(null);
                  setTimeboxDialogOpen(true);
                }}
              >
                <CalendarDays className="size-4" />
                Time Box
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[20px] bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Scheduled blocks
              </div>
              <p className="mt-2 text-sm leading-6 text-white/58">
                Open a scheduled block to edit the day, the hour range, or the AP profile tied to this task.
              </p>
            </div>
            <Badge className="bg-white/[0.08] text-white/72">
              {scheduledTimeboxes.length}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {scheduledTimeboxes.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.03] px-4 py-4 text-sm text-white/55">
                No future timeboxes are attached to this task yet.
              </div>
            ) : null}
            {scheduledTimeboxes.map((timebox) => (
              <div
                key={timebox.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setEditingTimebox(timebox);
                  setTimeboxDialogOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditingTimebox(timebox);
                    setTimeboxDialogOpen(true);
                  }
                }}
                className="rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(26,32,49,0.86),rgba(16,21,34,0.86))] p-4 text-left transition hover:bg-[linear-gradient(180deg,rgba(30,36,54,0.92),rgba(18,23,37,0.92))]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 font-medium leading-6 text-white">
                      {timebox.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-white/58">
                      <Clock3 className="size-3.5 shrink-0" />
                      {formatDateTime(timebox.startsAt)} to {formatDateTime(timebox.endsAt)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/72">
                    {timebox.source}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/72">
                    {timebox.status}
                  </Badge>
                  <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
                    {formatLifeForceRate(
                      estimateTaskTimeboxActionPointLoad(timebox).rateApPerHour
                    )}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/72">
                    {formatLifeForceAp(
                      estimateTaskTimeboxActionPointLoad(timebox).totalAp
                    )}
                  </Badge>
                  {timebox.overrideReason ? (
                    <Badge className="bg-white/[0.08] text-white/72">
                      {timebox.overrideReason}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-[999px] bg-white/[0.08] px-3 py-1 text-xs text-white/72">
                    Edit in guide
                  </span>
                  <Link
                    to={`/calendar?timeboxId=${encodeURIComponent(timebox.id)}`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-[999px] bg-white/[0.08] px-3 py-1 text-xs text-white/72 transition hover:bg-white/[0.12]"
                  >
                    Open in calendar
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <EntityNotesSurface
            entityType="task"
            entityId={payload.task.id}
            title={`${workItemMeta.label} notes`}
            description={`Capture real progress, blockers, and context in Markdown so the ${workItemMeta.noun} keeps a durable work log.`}
            invalidateQueryKeys={[
              ["task-context", params.taskId],
              ...(payload.task.projectId
                ? ([["project-board", payload.task.projectId]] as const)
                : [])
            ]}
          />
        </div>

        <div className="mt-5">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Activity
          </div>
          <div className="mt-4 grid gap-3">
            {payload.activity.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/55">
                No activity has been recorded for this task yet.
              </div>
            ) : null}
            {payload.activity.map((event) => (
              <div
                key={event.id}
                className="rounded-[18px] bg-white/[0.04] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-white">
                      {getReadableActivityTitle(event)}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/58">
                      {getReadableActivityDescription(event)}
                    </div>
                    <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/35">
                      {formatDateTime(event.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={async () => {
                      await removeEventMutation.mutateAsync(event.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
                {getActivityEventHref(event) &&
                getActivityEventCtaLabel(event) ? (
                  <Link
                    to={getActivityEventHref(event)!}
                    className="mt-3 inline-flex text-[11px] uppercase tracking-[0.16em] text-[var(--primary)]"
                  >
                    {getActivityEventCtaLabel(event)}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Timer sessions
          </div>
          <div className="mt-4 grid gap-3">
            {payload.taskRuns.length === 0 ? (
              <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/55">
                No timer sessions have been recorded for this task yet.
              </div>
            ) : null}
            {payload.taskRuns.map((run) => (
              <div key={run.id} className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-white">{run.actor}</div>
                  <Badge>{describeRunStatus(run.status)}</Badge>
                </div>
                <div className="mt-2 text-sm text-white/58">
                  {run.note || t("common.labels.noRunNote")}
                </div>
                <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-white/35">
                  {formatDateTime(run.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <TaskDialog
        open={dialogOpen}
        goals={shell.snapshot.goals}
        projects={shell.snapshot.dashboard.projects}
        workItems={shell.snapshot.workItems}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        editingTask={payload.task}
        defaultUserId={payload.task.userId ?? defaultUserId}
        onRefreshEntities={shell.refresh}
        onOpenChange={setDialogOpen}
        onSubmit={async (input, taskId) => {
          if (!taskId) {
            return;
          }
          await updateTaskMutation.mutateAsync({ taskId, patch: input });
        }}
      />

      <WorkAdjustmentDialog
        open={workAdjustmentOpen}
        onOpenChange={setWorkAdjustmentOpen}
        entityType="task"
        entityId={payload.task.id}
        targetLabel={payload.task.title}
        currentCreditedSeconds={payload.task.time.totalCreditedSeconds}
        pending={workAdjustmentMutation.isPending}
        onSubmit={async (input) => {
          await workAdjustmentMutation.mutateAsync(input);
        }}
      />

      <TimeboxPlanningDialog
        open={timeboxDialogOpen}
        onOpenChange={(open) => {
          setTimeboxDialogOpen(open);
          if (!open) {
            setEditingTimebox(null);
          }
        }}
        tasks={[payload.task]}
        initialTaskId={payload.task.id}
        lockedTaskId={payload.task.id}
        editingTimebox={editingTimebox}
        from={planningWindow.from}
        to={planningWindow.to}
        userIds={selectedUserIds}
        onCreateTimebox={async (input) => {
          await createTimeboxMutation.mutateAsync({
            ...input,
            userId: defaultUserId ?? undefined
          });
        }}
        onUpdateTimebox={async (timeboxId, patch) => {
          await patchTimeboxMutation.mutateAsync({
            timeboxId,
            patch: {
              ...patch,
              userId: defaultUserId ?? undefined
            }
          });
        }}
        onDeleteTimebox={async (timeboxId) => {
          await deleteTimeboxMutation.mutateAsync(timeboxId);
        }}
      />

      <TaskSchedulingDialog
        open={taskSchedulingDialogOpen}
        onOpenChange={setTaskSchedulingDialogOpen}
        tasks={[payload.task]}
        onSave={async ({ taskId, schedulingRules, plannedDurationSeconds }) => {
          await updateTaskMutation.mutateAsync({
            taskId,
            patch: {
              schedulingRules,
              plannedDurationSeconds
            }
          });
          await queryClient.invalidateQueries({
            queryKey: ["task-calendar-overview", params.taskId]
          });
        }}
      />

      <SheetScaffold
        open={statusSheetOpen}
        onOpenChange={setStatusSheetOpen}
        eyebrow={`${workItemMeta.label} status`}
        title="Change status"
        description={`Pick the state that best matches where this ${workItemMeta.noun} is right now.`}
      >
        <div className="grid gap-3">
          {STATUS_META.map((entry) => {
            const Icon = entry.icon;
            const selected = entry.status === payload.task.status;
            return (
              <button
                key={entry.status}
                type="button"
                disabled={selected || updateTaskMutation.isPending}
                className={`rounded-[22px] border px-4 py-4 text-left transition ${
                  selected
                    ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                    : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]"
                }`}
                onClick={() => void handleStatusChange(entry.status)}
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-[var(--primary)]" />
                  <div>
                    <div className="font-medium">{entry.label}</div>
                    <div className="mt-1 text-sm text-white/54">
                      {entry.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetScaffold>
    </div>
  );
}
