import { useEffect, useMemo, useState } from "react";
import { Play, Search, Timer, TimerReset, X } from "lucide-react";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  ProjectSummary,
  Task,
  TaskRunGitContext,
  TimeAccountingMode
} from "@/lib/types";
import { cn } from "@/lib/utils";

type TimerStartInput = {
  timerMode: "planned" | "unlimited";
  plannedDurationSeconds: number | null;
  gitContext: TaskRunGitContext | null;
};

type StartWorkComposerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  projects: ProjectSummary[];
  activeRunCount: number;
  maxActiveTasks: number;
  timeAccountingMode: TimeAccountingMode;
  pending: boolean;
  errorMessage: string | null;
  initialTaskId?: string | null;
  defaultProjectId?: string | null;
  presentation?: "responsive" | "desktop_inline" | "mobile_sheet";
  onStartExisting: (taskId: string, input: TimerStartInput) => Promise<void>;
  onCreateAndStart: (input: {
    title: string;
    description: string;
    projectId: string;
    timerMode: "planned" | "unlimited";
    plannedDurationSeconds: number | null;
    gitContext: TaskRunGitContext | null;
  }) => Promise<void>;
};

function toPlannedMinutes(plannedDurationSeconds: number | null) {
  return plannedDurationSeconds === null ? "20" : String(Math.max(1, Math.round(plannedDurationSeconds / 60)));
}

type ComposerBodyProps = Omit<StartWorkComposerProps, "open" | "onOpenChange"> & {
  onCancel: () => void;
};

function StartWorkComposerBody({
  tasks,
  projects,
  activeRunCount,
  maxActiveTasks,
  timeAccountingMode,
  pending,
  errorMessage,
  initialTaskId,
  defaultProjectId,
  onCancel,
  onStartExisting,
  onCreateAndStart
}: ComposerBodyProps) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [taskQuery, setTaskQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [timerMode, setTimerMode] = useState<"planned" | "unlimited">("planned");
  const [plannedMinutes, setPlannedMinutes] = useState("20");
  const [gitRepository, setGitRepository] = useState("");
  const [gitBranch, setGitBranch] = useState("");

  useEffect(() => {
    setMode(initialTaskId ? "existing" : "new");
    setTaskQuery("");
    setSelectedTaskId(initialTaskId ?? null);
    setTitle("");
    setDescription("");
    setProjectId(defaultProjectId ?? "");
    setTimerMode("planned");
    setPlannedMinutes("20");
    setGitRepository("");
    setGitBranch("");
  }, [defaultProjectId, initialTaskId]);

  const sortedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status !== "done")
        .sort((left, right) => {
          if (left.time.hasCurrentRun !== right.time.hasCurrentRun) {
            return Number(right.time.hasCurrentRun) - Number(left.time.hasCurrentRun);
          }
          if (left.status !== right.status) {
            return left.status.localeCompare(right.status);
          }
          return left.title.localeCompare(right.title);
        }),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    if (!query) {
      return sortedTasks;
    }
    return sortedTasks.filter((task) => {
      const project = projects.find((entry) => entry.id === task.projectId);
      return [
        task.title,
        task.description,
        task.owner,
        task.user?.displayName ?? "",
        task.user?.handle ?? "",
        task.user?.kind ?? "",
        project?.title ?? "",
        project?.user?.displayName ?? "",
        project?.user?.handle ?? "",
        project?.user?.kind ?? ""
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [projects, sortedTasks, taskQuery]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projectId, projects]);
  const plannedDurationSeconds = timerMode === "planned" ? Math.max(60, (Number.parseInt(plannedMinutes, 10) || 20) * 60) : null;
  const gitContext = useMemo<TaskRunGitContext | null>(() => {
    const repository = gitRepository.trim();
    const branch = gitBranch.trim();
    if (!repository && !branch) {
      return null;
    }
    return {
      provider: "github",
      repository,
      branch,
      baseBranch: "main",
      branchUrl:
        repository && branch
          ? `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`
          : null,
      pullRequestUrl: null,
      pullRequestNumber: null,
      compareUrl:
        repository && branch
          ? `https://github.com/${repository}/compare/main...${encodeURIComponent(branch)}`
          : null
    };
  }, [gitBranch, gitRepository]);
  const canSubmit = mode === "existing" ? Boolean(selectedTaskId) : Boolean(title.trim() && projectId);
  const policyLabel =
    timeAccountingMode === "split"
      ? "Split time"
      : timeAccountingMode === "parallel"
        ? "Parallel time"
        : "Primary only";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Start work</div>
          <h3 className="mt-2 font-display text-[clamp(1.2rem,1.8vw,1.65rem)] text-white">Pick a task and start the timer</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Use an existing task or create a new one quickly. Forge will move the task into in progress as soon as work starts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-white/[0.08] text-white/72">
            {activeRunCount}/{maxActiveTasks} live
          </Badge>
          <Badge className="bg-white/[0.08] text-white/72">{policyLabel}</Badge>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {([
          { value: "existing", label: "Existing task", detail: "Search and start something that already exists." },
          { value: "new", label: "New quick task", detail: "Create a task with a title, short description, and project." }
        ] as const).map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-[18px] border px-4 py-4 text-left transition",
                selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/65 hover:bg-white/[0.07]"
              )}
              onClick={() => setMode(option.value)}
            >
              <div className="font-medium">{option.label}</div>
              <div className="mt-2 text-sm leading-6 text-inherit/80">{option.detail}</div>
            </button>
          );
        })}
      </div>

      {mode === "existing" ? (
        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="type-label text-white/45">Search tasks</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/32" />
              <Input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Search task, project, human, bot, or owner" className="pl-10" />
            </div>
          </label>

          <div className="grid max-h-[19rem] gap-2 overflow-y-auto rounded-[20px] bg-white/[0.03] p-2">
            {filteredTasks.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-white/8 px-4 py-8 text-center text-sm text-white/42">
                No tasks match. Switch to New quick task to create one now.
              </div>
            ) : (
              filteredTasks.slice(0, 16).map((task) => {
                const selected = selectedTaskId === task.id;
                const project = projects.find((entry) => entry.id === task.projectId);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={cn(
                      "rounded-[16px] border px-4 py-3 text-left transition",
                      selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                    )}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <EntityName kind="task" label={task.title} className="max-w-full" />
                        <div className="mt-2 flex flex-wrap gap-2">
                          {project ? <EntityBadge kind="project" label={project.title} compact gradient={false} /> : null}
                          <Badge className="bg-white/[0.08] text-white/70">{task.status.replaceAll("_", " ")}</Badge>
                          {task.time.activeRunCount > 0 ? <Badge className="bg-emerald-500/12 text-emerald-200">{task.time.activeRunCount} live</Badge> : null}
                        </div>
                      </div>
                      <span className="text-[12px] text-white/45">{task.points} xp</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="type-label text-white/45">Task title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Write the next concrete task" />
          </label>
          <label className="grid gap-2">
            <span className="type-label text-white/45">Short description</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Keep it short and concrete." />
          </label>
          <label className="grid gap-2">
            <span className="type-label text-white/45">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.user
                    ? `${project.title} · ${project.user.displayName} (${project.user.kind})`
                    : project.title}
                </option>
              ))}
            </select>
          </label>
          {selectedProject ? (
            <div className="rounded-[16px] bg-white/[0.04] px-4 py-3 text-sm text-white/62">
              This task will be created inside <span className="font-medium text-white">{selectedProject.title}</span>
              {selectedProject.user
                ? ` for ${selectedProject.user.displayName} (${selectedProject.user.kind})`
                : ""}
              {" "}and started immediately.
            </div>
          ) : null}
        </div>
      )}

      <div className="grid gap-2">
        <span className="type-label text-white/45">Timer</span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
          {([
            { value: "planned", label: "20 min planned", detail: "Pomodoro-style by default." },
            { value: "unlimited", label: "Unlimited", detail: "Keep tracking until you stop." }
          ] as const).map((option) => {
            const selected = timerMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "rounded-[18px] border px-4 py-3 text-left transition",
                  selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/65 hover:bg-white/[0.07]"
                )}
                onClick={() => setTimerMode(option.value)}
              >
                <div className="font-medium">{option.label}</div>
                <div className="mt-1.5 text-sm leading-6 text-inherit/80">{option.detail}</div>
              </button>
            );
          })}
          <label className={cn("grid gap-2", timerMode !== "planned" && "opacity-50")}>
            <span className="type-label text-white/45">Minutes</span>
            <Input
              type="number"
              min={1}
              max={240}
              disabled={timerMode !== "planned"}
              value={plannedMinutes}
              onChange={(event) => setPlannedMinutes(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
        <div>
          <div className="type-label text-white/45">GitHub context</div>
          <div className="mt-2 text-sm leading-6 text-white/56">
            Optional. Record the repository and branch for this work session so the project board can show the live agent branch.
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="type-label text-white/45">Repository</span>
            <Input
              value={gitRepository}
              onChange={(event) => setGitRepository(event.target.value)}
              placeholder="owner/repo"
            />
          </label>
          <label className="grid gap-2">
            <span className="type-label text-white/45">Branch</span>
            <Input
              value={gitBranch}
              onChange={(event) => setGitBranch(event.target.value)}
              placeholder="agent/board-redesign"
            />
          </label>
        </div>
      </div>

      {errorMessage ? <div className="rounded-[18px] bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-200">{errorMessage}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-4">
        <div className="flex flex-wrap gap-2 text-[12px] text-white/45">
          <div className="rounded-full bg-white/[0.05] px-3 py-2">Starts in progress</div>
          <div className="rounded-full bg-white/[0.05] px-3 py-2">{timerMode === "planned" ? `${toPlannedMinutes(plannedDurationSeconds)} min target` : "Unlimited timer"}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="lg"
            pending={pending}
            pendingLabel="Starting"
            disabled={!canSubmit}
            onClick={async () => {
              if (!canSubmit) {
                return;
              }
              if (mode === "existing" && selectedTaskId) {
                await onStartExisting(selectedTaskId, {
                  timerMode,
                  plannedDurationSeconds,
                  gitContext
                });
                return;
              }
              await onCreateAndStart({
                title: title.trim(),
                description: description.trim(),
                projectId,
                timerMode,
                plannedDurationSeconds,
                gitContext
              });
            }}
          >
            {mode === "existing" ? <Timer className="size-4" /> : <TimerReset className="size-4" />}
            Start work
            <Play className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StartWorkComposer({ open, onOpenChange, presentation = "responsive", ...props }: StartWorkComposerProps) {
  const composer = <StartWorkComposerBody {...props} onCancel={() => onOpenChange(false)} />;

  return (
    <>
      {open && presentation !== "mobile_sheet" ? (
        <div className="hidden lg:block">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(11,16,28,0.97))] p-4 shadow-[0_24px_60px_rgba(3,8,18,0.28)]">
            <div className="mb-3 flex justify-end">
              <Button variant="ghost" size="sm" className="px-3" onClick={() => onOpenChange(false)}>
                <X className="size-4" />
                Close
              </Button>
            </div>
            {composer}
          </div>
        </div>
      ) : null}

      {presentation !== "desktop_inline" ? (
        <div className={presentation === "responsive" ? "lg:hidden" : ""}>
          <SheetScaffold
            open={open}
            onOpenChange={onOpenChange}
            eyebrow="Start work"
            title="Start work"
            description="Pick an existing task or create a new one quickly, then start the timer immediately."
          >
            {composer}
          </SheetScaffold>
        </div>
      ) : null}
    </>
  );
}
