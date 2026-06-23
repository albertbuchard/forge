import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { EntityBadge } from "@/components/ui/entity-badge";

type ReflectIntent =
  | "trigger_report"
  | "behavior"
  | "belief"
  | "pattern"
  | "value"
  | "execution_tension";

type ReflectDraft = {
  intent: ReflectIntent;
  linkedGoalId: string;
  linkedProjectId: string;
  linkedTaskId: string;
};

const DEFAULT_REFLECT_DRAFT: ReflectDraft = {
  intent: "trigger_report",
  linkedGoalId: "",
  linkedProjectId: "",
  linkedTaskId: ""
};

export function ReflectFlowDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const shell = useForgeShell();
  const [draft, setDraft] = useState<ReflectDraft>(DEFAULT_REFLECT_DRAFT);

  const steps: Array<QuestionFlowStep<ReflectDraft>> = [
    {
      id: "intent",
      eyebrow: "Reflect",
      title: "What do you want to reflect on?",
      description:
        "Choose the entrypoint first. Forge will route you into the right guided flow instead of dropping you into a generic form.",
      render: (value, setValue) => (
        <FlowChoiceGrid
          columns={3}
          value={value.intent}
          onChange={(intent) => setValue({ intent: intent as ReflectIntent })}
          options={[
            {
              value: "trigger_report",
              label: "A situation",
              description:
                "Start a Spark-to-Pivot report about something that happened."
            },
            {
              value: "behavior",
              label: "A behavior",
              description:
                "Trace an away move, committed action, or recovery path."
            },
            {
              value: "belief",
              label: "A belief script",
              description: "Capture or refine the belief beneath the reaction."
            },
            {
              value: "pattern",
              label: "A recurring pattern",
              description: "Map the loop, payoff, cost, and better response."
            },
            {
              value: "value",
              label: "A blocked value",
              description:
                "Clarify which value is being challenged or needs support."
            },
            {
              value: "execution_tension",
              label: "A goal tension",
              description:
                "Reflect on a goal, project, or task that carries friction."
            }
          ]}
        />
      )
    },
    {
      id: "placement",
      eyebrow: "Placement",
      title: "Attach the reflection to the wider system",
      description:
        "This keeps the reflection connected to values, behaviors, and live work instead of becoming an isolated note.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowField label="Goal / project / task tension">
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <EntityBadge
                  kind="goal"
                  label="Goal"
                  compact
                  gradient={false}
                />
                <EntityBadge
                  kind="project"
                  label="Project"
                  compact
                  gradient={false}
                />
                <EntityBadge
                  kind="task"
                  label="Task"
                  compact
                  gradient={false}
                />
              </div>
              <select
                className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                value={value.linkedGoalId}
                onChange={(event) =>
                  setValue({ linkedGoalId: event.target.value })
                }
              >
                <option value="">No goal selected</option>
                {shell.snapshot.goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    Goal · {goal.title}
                  </option>
                ))}
              </select>
              <select
                className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                value={value.linkedProjectId}
                onChange={(event) =>
                  setValue({ linkedProjectId: event.target.value })
                }
              >
                <option value="">No project selected</option>
                {shell.snapshot.dashboard.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    Project · {project.title}
                  </option>
                ))}
              </select>
              <select
                className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                value={value.linkedTaskId}
                onChange={(event) =>
                  setValue({ linkedTaskId: event.target.value })
                }
              >
                <option value="">No task selected</option>
                {shell.snapshot.tasks.slice(0, 40).map((task) => (
                  <option key={task.id} value={task.id}>
                    Task · {task.title}
                  </option>
                ))}
              </select>
            </div>
          </FlowField>
        </div>
      )
    }
  ];

  const launch = async () => {
    const search = new URLSearchParams({ create: "1", intent: draft.intent });
    if (draft.linkedGoalId) {
      search.set("goalId", draft.linkedGoalId);
    }
    if (draft.linkedProjectId) {
      search.set("projectId", draft.linkedProjectId);
    }
    if (draft.linkedTaskId) {
      search.set("taskId", draft.linkedTaskId);
    }

    switch (draft.intent) {
      case "behavior":
        navigate(`/psyche/behaviors?${search.toString()}`);
        break;
      case "belief":
        navigate(`/psyche/schemas-beliefs?${search.toString()}`);
        break;
      case "pattern":
        navigate(`/psyche/patterns?${search.toString()}`);
        break;
      case "value":
        navigate(`/psyche/values?${search.toString()}`);
        break;
      case "execution_tension":
      case "trigger_report":
      default:
        navigate(`/psyche/reports?${search.toString()}`);
        break;
    }

    onOpenChange(false);
    setDraft(DEFAULT_REFLECT_DRAFT);
  };

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Reflect"
      title="Start from the right reflective doorway"
      description="Choose what you want to reflect on first. Forge will take you into the right guided flow instead of leaving you in a generic form."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey="psyche.reflect.launcher"
      steps={steps}
      submitLabel="Open guided reflection"
      onSubmit={launch}
    />
  );
}
