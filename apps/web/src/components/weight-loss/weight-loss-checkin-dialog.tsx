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
  bodyNotes: string;
  subjectiveNotes: string;
  gutNotes: string;
  appearanceNotes: string;
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
    bodyNotes: "",
    subjectiveNotes: "",
    gutNotes: "",
    appearanceNotes: ""
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
          <div className="md:col-span-3">
            <FlowField label="Body measurement context">
              <Textarea
                value={draft.bodyNotes}
                onChange={(event) =>
                  setDraft({ bodyNotes: event.target.value })
                }
                placeholder="Measurement conditions, hydration, clothing..."
              />
            </FlowField>
          </div>
        </div>
      )
    },
    {
      id: "state",
      eyebrow: "State",
      title: "Energy and appetite",
      description:
        "Keep subjective state separate from gut and appearance observations.",
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
          <div className="md:col-span-3">
            <FlowField label="Energy and appetite context">
              <Textarea
                value={draft.subjectiveNotes}
                onChange={(event) =>
                  setDraft({ subjectiveNotes: event.target.value })
                }
                placeholder="Meal timing, sleep, stress, training context..."
              />
            </FlowField>
          </div>
        </div>
      )
    },
    {
      id: "gut",
      eyebrow: "Gut",
      title: "Gut comfort",
      description:
        "Gut symptoms and their context stay in the gut record only.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <FlowField label="Bloating 0-10">
            <Input
              inputMode="decimal"
              value={draft.bloating}
              onChange={(event) => setDraft({ bloating: event.target.value })}
            />
          </FlowField>
          <FlowField label="Gut context">
            <Textarea
              value={draft.gutNotes}
              onChange={(event) => setDraft({ gutNotes: event.target.value })}
              placeholder="Trigger food, timing, stool or reflux context..."
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "appearance",
      eyebrow: "Appearance",
      title: "Appearance signals",
      description:
        "Appearance observations and their context stay in the appearance record only.",
      render: (draft, setDraft) => (
        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="md:col-span-2">
            <FlowField label="Appearance context">
              <Textarea
                value={draft.appearanceNotes}
                onChange={(event) =>
                  setDraft({ appearanceNotes: event.target.value })
                }
                placeholder="Lighting, posture, sodium, soreness, clothing..."
              />
            </FlowField>
          </div>
        </div>
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
      notes: draft.bodyNotes
    },
    subjective: {
      energy: numberOrNull(draft.energy),
      hunger: numberOrNull(draft.hunger),
      cravings: numberOrNull(draft.cravings),
      timeRelation: "unspecified",
      notes: draft.subjectiveNotes
    },
    gut: {
      bloating: numberOrNull(draft.bloating),
      notes: draft.gutNotes
    },
    appearance: {
      facePuffiness: numberOrNull(draft.facePuffiness),
      leanness: numberOrNull(draft.leanness),
      notes: draft.appearanceNotes
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
  const domainContextRequirements = [
    {
      notes: draft.bodyNotes,
      values: [draft.weightKg, draft.waistCm, draft.bodyFatPercent],
      message: "Add a body measurement before saving body context."
    },
    {
      notes: draft.subjectiveNotes,
      values: [draft.energy, draft.hunger, draft.cravings],
      message:
        "Add an energy or appetite rating before saving subjective context."
    },
    {
      notes: draft.gutNotes,
      values: [draft.bloating],
      message: "Add a gut rating before saving gut context."
    },
    {
      notes: draft.appearanceNotes,
      values: [draft.facePuffiness, draft.leanness],
      message: "Add an appearance rating before saving appearance context."
    }
  ];
  for (const requirement of domainContextRequirements) {
    if (
      requirement.notes.trim() &&
      !requirement.values.some((value) => value.trim())
    ) {
      return requirement.message;
    }
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
