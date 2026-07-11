import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type WeightLossCheckinDraft = {
  weightKg: string;
  waistCm: string;
  bodyFatPercent: string;
  energy: string;
  hunger: string;
  cravings: string;
  bloating: string;
  facePuffiness: string;
  leanness: string;
  notes: string;
};

export function buildInitialCheckinDraft(): WeightLossCheckinDraft {
  return {
    weightKg: "",
    waistCm: "",
    bodyFatPercent: "",
    energy: "",
    hunger: "",
    cravings: "",
    bloating: "",
    facePuffiness: "",
    leanness: "",
    notes: ""
  };
}

export function WeightLossCheckinDialog({
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
  value: WeightLossCheckinDraft;
  onChange: (value: WeightLossCheckinDraft) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  error?: string | null;
}) {
  const steps: Array<QuestionFlowStep<WeightLossCheckinDraft>> = [
    {
      id: "body",
      eyebrow: "Body",
      title: "Measurements",
      description:
        "Add weight and body measures when you have them. Empty fields are ignored.",
      render: (draft, setDraft) => (
        <div className="grid gap-4 md:grid-cols-3">
          <FlowField label="Weight kg">
            <Input
              inputMode="decimal"
              value={draft.weightKg}
              onChange={(event) => setDraft({ weightKg: event.target.value })}
            />
          </FlowField>
          <FlowField label="Waist cm">
            <Input
              inputMode="decimal"
              value={draft.waistCm}
              onChange={(event) => setDraft({ waistCm: event.target.value })}
            />
          </FlowField>
          <FlowField label="Body fat %">
            <Input
              inputMode="decimal"
              value={draft.bodyFatPercent}
              onChange={(event) =>
                setDraft({ bodyFatPercent: event.target.value })
              }
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "state",
      eyebrow: "State",
      title: "Energy, appetite, and gut",
      description:
        "These subjective signals are what make the view more useful than a calorie ledger.",
      render: (draft, setDraft) => (
        <div className="grid gap-4 md:grid-cols-3">
          <FlowField label="Energy 0-10">
            <Input
              inputMode="decimal"
              value={draft.energy}
              onChange={(event) => setDraft({ energy: event.target.value })}
            />
          </FlowField>
          <FlowField label="Hunger 0-10">
            <Input
              inputMode="decimal"
              value={draft.hunger}
              onChange={(event) => setDraft({ hunger: event.target.value })}
            />
          </FlowField>
          <FlowField label="Cravings 0-10">
            <Input
              inputMode="decimal"
              value={draft.cravings}
              onChange={(event) => setDraft({ cravings: event.target.value })}
            />
          </FlowField>
          <FlowField label="Bloating 0-10">
            <Input
              inputMode="decimal"
              value={draft.bloating}
              onChange={(event) => setDraft({ bloating: event.target.value })}
            />
          </FlowField>
          <FlowField label="Face puffiness 0-10">
            <Input
              inputMode="decimal"
              value={draft.facePuffiness}
              onChange={(event) =>
                setDraft({ facePuffiness: event.target.value })
              }
            />
          </FlowField>
          <FlowField label="Leanness 0-10">
            <Input
              inputMode="decimal"
              value={draft.leanness}
              onChange={(event) => setDraft({ leanness: event.target.value })}
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "notes",
      eyebrow: "Context",
      title: "Notes",
      description: "Capture anything that explains the signal.",
      render: (draft, setDraft) => (
        <FlowField label="Notes">
          <Textarea
            value={draft.notes}
            onChange={(event) => setDraft({ notes: event.target.value })}
            placeholder="Sleep, sodium, workout soreness, stressful day..."
          />
        </FlowField>
      )
    }
  ];
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Check-in"
      title="Add body signal"
      description="Add measurements, energy, gut, and appearance signals."
      value={value}
      onChange={onChange}
      steps={steps}
      onSubmit={onSubmit}
      submitLabel="Save check-in"
      pending={pending}
      pendingLabel="Saving check-in"
      error={error}
      draftPersistenceKey="weight-loss-checkin"
    />
  );
}

export function buildCheckinPayloads(draft: WeightLossCheckinDraft) {
  const numberOrNull = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    body: {
      weightKg: numberOrNull(draft.weightKg),
      waistCm: numberOrNull(draft.waistCm),
      bodyFatPercent: numberOrNull(draft.bodyFatPercent),
      notes: draft.notes
    },
    subjective: {
      energy: numberOrNull(draft.energy),
      hunger: numberOrNull(draft.hunger),
      cravings: numberOrNull(draft.cravings),
      timeRelation: "unspecified",
      notes: draft.notes
    },
    gut: {
      bloating: numberOrNull(draft.bloating),
      notes: draft.notes
    },
    appearance: {
      facePuffiness: numberOrNull(draft.facePuffiness),
      leanness: numberOrNull(draft.leanness),
      notes: draft.notes
    }
  };
}

export function validateCheckinDraft(draft: WeightLossCheckinDraft) {
  const definitions: Array<{
    key: keyof WeightLossCheckinDraft;
    label: string;
    min: number;
    max: number;
  }> = [
    { key: "weightKg", label: "Weight", min: 1, max: 500 },
    { key: "waistCm", label: "Waist", min: 1, max: 500 },
    { key: "bodyFatPercent", label: "Body fat", min: 0, max: 100 },
    { key: "energy", label: "Energy", min: 0, max: 10 },
    { key: "hunger", label: "Hunger", min: 0, max: 10 },
    { key: "cravings", label: "Cravings", min: 0, max: 10 },
    { key: "bloating", label: "Bloating", min: 0, max: 10 },
    { key: "facePuffiness", label: "Face puffiness", min: 0, max: 10 },
    { key: "leanness", label: "Leanness", min: 0, max: 10 }
  ];
  const populated = definitions.filter(({ key }) => draft[key].trim());
  if (populated.length === 0) {
    return "Add at least one measurement or signal before saving.";
  }
  for (const { key, label, min, max } of populated) {
    const value = Number(draft[key]);
    if (!Number.isFinite(value)) {
      return `${label} must be a number.`;
    }
    if (value < min || value > max) {
      return `${label} must be between ${min} and ${max}.`;
    }
  }
  return null;
}
