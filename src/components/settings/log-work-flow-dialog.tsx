import { useEffect, useState } from "react";
import { FlowChoiceGrid, FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OperatorLogWorkInput } from "@/lib/types";
import type { Task } from "@/lib/types";

type LogWorkDraft = {
  source: "existing" | "new";
  taskId: string;
  title: string;
  description: string;
  owner: string;
  projectId: string;
  status: "backlog" | "focus" | "in_progress" | "blocked" | "done";
  points: number;
};

type ActiveProject = { id: string; title: string };

function buildInitialDraft(defaultOwner: string): LogWorkDraft {
  return {
    source: "new",
    taskId: "",
    title: "",
    description: "",
    owner: defaultOwner,
    projectId: "",
    status: "done",
    points: 40
  };
}

export function LogWorkFlowDialog({
  open,
  onOpenChange,
  pending = false,
  defaultOwner = "",
  availableTasks = [],
  availableProjects = [],
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  defaultOwner?: string;
  availableTasks?: Task[];
  availableProjects?: ActiveProject[];
  onSubmit: (input: OperatorLogWorkInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LogWorkDraft>(() => buildInitialDraft(defaultOwner));
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(buildInitialDraft(defaultOwner));
      setSubmitError(null);
    }
  }, [open, defaultOwner]);

  const patch = (update: Partial<LogWorkDraft>) => setDraft((prev) => ({ ...prev, ...update }));

  const steps: Array<QuestionFlowStep<LogWorkDraft>> = [
    {
      id: "source",
      eyebrow: "Log work",
      title: "Is this work already tracked?",
      description:
        "If a task exists, link the work to it so Forge can update the record with the right status and XP. If not, a new task will be created from what you describe.",
      render: (value, setValue) => (
        <>
          <FlowChoiceGrid
            columns={2}
            value={value.source}
            onChange={(next) => setValue({ source: next as "existing" | "new", taskId: "" })}
            options={[
              {
                value: "new",
                label: "New task",
                description: "The work is not tracked yet — Forge will create a task and log the time against it."
              },
              {
                value: "existing",
                label: "Existing task",
                description: "Pick a task already in the board. The log will update its record and award XP."
              }
            ]}
          />
          {value.source === "existing" && availableTasks.length > 0 ? (
            <FlowField label="Pick the task" description="Select the task this work belongs to.">
              <select
                className="rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
                value={value.taskId}
                onChange={(e) => setValue({ taskId: e.target.value })}
              >
                <option value="">— choose a task —</option>
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} · {task.status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </FlowField>
          ) : value.source === "existing" && availableTasks.length === 0 ? (
            <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/58">
              No tasks are loaded yet. Switch to "New task" to create one from scratch.
            </div>
          ) : null}
        </>
      )
    },
    {
      id: "details",
      eyebrow: "Work details",
      title: "Describe what was done",
      description:
        "Give the work a clear title and enough context to understand it later. These become the task record if you are creating a new one.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Title"
            labelHelp="Write the title like a short achievement: what was completed, not what was started."
          >
            <Input
              value={value.title}
              placeholder="Write postmortem draft"
              onChange={(e) => setValue({ title: e.target.value })}
            />
          </FlowField>
          <FlowField label="Owner" description="Who did this work? Defaults to the operator name.">
            <Input
              value={value.owner}
              placeholder="Your name"
              onChange={(e) => setValue({ owner: e.target.value })}
            />
          </FlowField>
          <FlowField
            label="Description"
            description="What moved forward? What should remain visible in the project history?"
          >
            <Textarea
              className="min-h-28"
              value={value.description}
              placeholder="Wrote the full incident timeline and drafted the three key learnings for the team retrospective."
              onChange={(e) => setValue({ description: e.target.value })}
            />
          </FlowField>
        </>
      )
    },
    {
      id: "placement",
      eyebrow: "Placement",
      title: "Set the context and XP value",
      description:
        "Assign the work to a project and choose its final status. The XP value controls how much this work contributes to the operator's progress curve.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <FlowField label="Project" description="Link this work to an active project if it belongs to one.">
              <select
                className="rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
                value={value.projectId}
                onChange={(e) => setValue({ projectId: e.target.value })}
              >
                <option value="">No project link</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </FlowField>
            <FlowField
              label="Final status"
              labelHelp="'Done' is the most common choice. Use 'In progress' if the work was real but the task is still open."
            >
              <FlowChoiceGrid
                columns={2}
                value={value.status}
                onChange={(next) => setValue({ status: next as LogWorkDraft["status"] })}
                options={[
                  { value: "done", label: "Done", description: "Work is complete." },
                  { value: "in_progress", label: "In progress", description: "Still active but already worth logging." },
                  { value: "focus", label: "Focus", description: "Moved into focus." },
                  { value: "blocked", label: "Blocked", description: "Work hit a wall." }
                ]}
              />
            </FlowField>
          </div>
          <FlowField
            label="XP value"
            labelHelp="Typical task XP ranges from 20 to 100. Use 40 for routine tasks, 80+ for complex deliverables."
          >
            <div className="flex items-center gap-4">
              <Input
                type="number"
                min={5}
                max={500}
                className="w-36"
                value={value.points}
                onChange={(e) => setValue({ points: Number(e.target.value) })}
              />
              <div className="flex gap-2">
                {[20, 40, 80, 120].map((pts) => (
                  <button
                    key={pts}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs transition ${value.points === pts ? "bg-white/18 text-white" : "bg-white/[0.06] text-white/55 hover:bg-white/[0.10]"}`}
                    onClick={() => setValue({ points: pts })}
                  >
                    {pts} xp
                  </button>
                ))}
              </div>
            </div>
          </FlowField>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Log work"
      title="Log retroactive work"
      description="Capture work that happened outside the timer so it counts toward progress and XP."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Log work"
      pending={pending}
      pendingLabel="Logging work…"
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        if (draft.source === "new" && draft.title.trim().length === 0) {
          setSubmitError("Add a title so Forge knows what work to create.");
          return;
        }
        if (draft.source === "existing" && !draft.taskId) {
          setSubmitError("Pick an existing task or switch to New task.");
          return;
        }

        try {
          await onSubmit({
            taskId: draft.source === "existing" && draft.taskId ? draft.taskId : undefined,
            title: draft.source === "new" && draft.title.trim() ? draft.title.trim() : undefined,
            description: draft.description.trim() || undefined,
            owner: draft.owner.trim() || undefined,
            projectId: draft.projectId || null,
            status: draft.status,
            points: draft.points
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Could not log the work right now.");
        }
      }}
    />
  );
}
