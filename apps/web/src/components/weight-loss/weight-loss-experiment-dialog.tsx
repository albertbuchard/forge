import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NutritionExperimentInput } from "@/lib/weight-loss-types";

export type WeightLossExperimentDraft = {
  title: string;
  hypothesis: string;
  metricKey: string;
  intervention: string;
  successCriteria: string;
  confounders: string;
  baselineStart: string;
  baselineEnd: string;
  experimentStart: string;
  experimentEnd: string;
  status: "planned" | "running";
};

export function buildInitialExperimentDraft(): WeightLossExperimentDraft {
  return {
    title: "",
    hypothesis: "",
    metricKey: "",
    intervention: "",
    successCriteria: "",
    confounders: "",
    baselineStart: "",
    baselineEnd: "",
    experimentStart: "",
    experimentEnd: "",
    status: "planned"
  };
}

function nullable(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildExperimentInput(
  draft: WeightLossExperimentDraft
): NutritionExperimentInput {
  return {
    title: draft.title.trim(),
    hypothesis: draft.hypothesis.trim(),
    metricKey: draft.metricKey.trim(),
    intervention: draft.intervention.trim(),
    baselineStart: nullable(draft.baselineStart),
    baselineEnd: nullable(draft.baselineEnd),
    experimentStart: nullable(draft.experimentStart),
    experimentEnd: nullable(draft.experimentEnd),
    status: draft.status,
    successCriteria: nullable(draft.successCriteria),
    confounders: draft.confounders
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(
        (entry, index, entries) =>
          entry.length > 0 && entries.indexOf(entry) === index
      )
  };
}

export function validateExperimentDraft(draft: WeightLossExperimentDraft) {
  const missing = [
    draft.title.trim() ? null : "a short title",
    draft.hypothesis.trim() ? null : "the change you expect",
    draft.intervention.trim() ? null : "what you will change",
    draft.metricKey.trim() ? null : "one primary outcome"
  ].filter(Boolean);
  if (missing.length > 0) {
    return `Add ${missing.join(", ")} before saving the experiment.`;
  }
  for (const [start, end, label] of [
    [draft.baselineStart, draft.baselineEnd, "baseline"],
    [draft.experimentStart, draft.experimentEnd, "experiment"]
  ] as const) {
    if (start && end && start > end) {
      return `The ${label} end date must be on or after its start date.`;
    }
  }
  return null;
}

export function WeightLossExperimentDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSubmit,
  pending,
  error
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: WeightLossExperimentDraft;
  onChange: (value: WeightLossExperimentDraft) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  error?: string | null;
}) {
  const steps: Array<QuestionFlowStep<WeightLossExperimentDraft>> = [
    {
      id: "question",
      eyebrow: "Question",
      title: "What are you trying to learn?",
      description:
        "Name the experiment and state the result you expect. Keep it specific enough that the result can challenge the hypothesis.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <FlowField label="Experiment title">
            <Input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft({ title: event.target.value })}
              placeholder="Carbohydrates before kickboxing"
            />
          </FlowField>
          <FlowField label="Hypothesis">
            <Textarea
              value={draft.hypothesis}
              onChange={(event) => setDraft({ hypothesis: event.target.value })}
              placeholder="Eating 60 g of carbohydrates two hours before training will improve performance without increasing gut discomfort."
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "method",
      eyebrow: "Method",
      title: "What will change, and what will show it?",
      description:
        "Choose one primary outcome. Additional observations can provide context, but they should not redefine success after the experiment starts.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <FlowField label="Intervention">
            <Textarea
              value={draft.intervention}
              onChange={(event) =>
                setDraft({ intervention: event.target.value })
              }
              placeholder="Eat 60 g of low-fat carbohydrates 90-120 minutes before each kickboxing session."
            />
          </FlowField>
          <FlowField
            label="Primary outcome"
            hint="Choose a metric you can record consistently. You can enter a custom metric."
          >
            <Input
              list="nutrition-experiment-metrics"
              value={draft.metricKey}
              onChange={(event) => setDraft({ metricKey: event.target.value })}
              placeholder="workoutPerformance"
            />
            <datalist id="nutrition-experiment-metrics">
              <option value="workoutPerformance" />
              <option value="energy" />
              <option value="hunger" />
              <option value="cravings" />
              <option value="bloating" />
              <option value="weightTrend" />
              <option value="waist" />
              <option value="sleepQuality" />
            </datalist>
          </FlowField>
          <FlowField label="Success criteria">
            <Input
              value={draft.successCriteria}
              onChange={(event) =>
                setDraft({ successCriteria: event.target.value })
              }
              placeholder="Average performance improves by at least 1 point without higher bloating."
            />
          </FlowField>
          <FlowField
            label="Factors to watch"
            hint="Separate entries with commas or new lines."
          >
            <Textarea
              value={draft.confounders}
              onChange={(event) =>
                setDraft({ confounders: event.target.value })
              }
              placeholder="Sleep, training intensity, illness"
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "timeline",
      eyebrow: "Timeline",
      title: "When will you compare the change?",
      description:
        "A baseline is optional, but it makes the result easier to interpret. Leave dates empty when the schedule is not decided yet.",
      render: (draft, setDraft) => (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FlowField label="Baseline starts">
              <Input
                type="date"
                value={draft.baselineStart}
                onChange={(event) =>
                  setDraft({ baselineStart: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Baseline ends">
              <Input
                type="date"
                value={draft.baselineEnd}
                onChange={(event) =>
                  setDraft({ baselineEnd: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Experiment starts">
              <Input
                type="date"
                value={draft.experimentStart}
                onChange={(event) =>
                  setDraft({ experimentStart: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Experiment ends">
              <Input
                type="date"
                value={draft.experimentEnd}
                onChange={(event) =>
                  setDraft({ experimentEnd: event.target.value })
                }
              />
            </FlowField>
          </div>
          <FlowField label="Starting state">
            <FlowChoiceGrid
              value={draft.status}
              onChange={(status) =>
                setDraft({ status: status as "planned" | "running" })
              }
              options={[
                {
                  value: "planned",
                  label: "Planned",
                  description: "Save the method before the intervention begins."
                },
                {
                  value: "running",
                  label: "Running",
                  description: "The intervention has already started."
                }
              ]}
            />
          </FlowField>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Nutrition experiment"
      title="New nutrition experiment"
      description="Define a testable food or fueling experiment."
      value={value}
      onChange={onChange}
      steps={steps}
      onSubmit={onSubmit}
      submitLabel="Save experiment"
      pending={pending}
      pendingLabel="Saving experiment"
      error={error}
      draftPersistenceKey="weight-loss-experiment"
    />
  );
}
