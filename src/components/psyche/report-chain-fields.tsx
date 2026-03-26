import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  BeliefEntry,
  Behavior,
  EmotionDefinition,
  ModeProfile,
  ModeTimelineEntry,
  TriggerBehavior,
  TriggerEmotion,
  TriggerThought
} from "@/lib/psyche-types";

function makeLocalId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmotionDraft(): TriggerEmotion {
  return {
    id: makeLocalId("emotion"),
    emotionDefinitionId: null,
    label: "",
    intensity: 55,
    note: ""
  };
}

export function createThoughtDraft(): TriggerThought {
  return {
    id: makeLocalId("thought"),
    text: "",
    parentMode: "",
    criticMode: "",
    beliefId: null
  };
}

export function createBehaviorDraft(): TriggerBehavior {
  return {
    id: makeLocalId("behavior"),
    text: "",
    mode: "",
    behaviorId: null
  };
}

export function createModeTimelineDraft(): ModeTimelineEntry {
  return {
    id: makeLocalId("timeline"),
    stage: "",
    modeId: null,
    label: "",
    note: ""
  };
}

function SectionHeader({
  title,
  description,
  onAdd,
  addLabel
}: {
  title: string;
  description: string;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-base font-medium text-white">{title}</div>
        <div className="mt-1 text-sm leading-6 text-white/56">{description}</div>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-white/[0.06] p-2 text-white/55 transition hover:bg-white/[0.12] hover:text-white"
      onClick={onClick}
      aria-label="Remove row"
    >
      <X className="size-4" />
    </button>
  );
}

export function StringListEditor({
  title,
  description,
  addLabel,
  items,
  onChange,
  placeholder
}: {
  title: string;
  description: string;
  addLabel: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="grid gap-3">
      <SectionHeader
        title={title}
        description={description}
        addLabel={addLabel}
        onAdd={() => onChange([...items, ""])}
      />
      <div className="grid gap-3">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="flex items-start gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
            <Input
              value={item}
              onChange={(event) => onChange(items.map((entry, itemIndex) => (itemIndex === index ? event.target.value : entry)))}
              placeholder={placeholder}
            />
            <RemoveButton onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmotionRowsEditor({
  items,
  onChange,
  definitions
}: {
  items: TriggerEmotion[];
  onChange: (items: TriggerEmotion[]) => void;
  definitions: EmotionDefinition[];
}) {
  return (
    <div className="grid gap-3">
      <SectionHeader
        title="What emotions were present?"
        description="Add one emotion at a time, set the intensity, and note what stood out."
        addLabel="Add emotion"
        onAdd={() => onChange([...items, createEmotionDraft()])}
      />
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_9rem]">
                <label className="grid gap-2">
                  <span className="text-sm text-white/62">Emotion</span>
                  <select
                    className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                    value={item.emotionDefinitionId ?? ""}
                    onChange={(event) => {
                      const definition = definitions.find((entry) => entry.id === event.target.value);
                      onChange(
                        items.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                emotionDefinitionId: event.target.value || null,
                                label: definition?.label ?? entry.label
                              }
                            : entry
                        )
                      );
                    }}
                  >
                    <option value="">Choose or type your own</option>
                    {definitions.map((definition) => (
                      <option key={definition.id} value={definition.id}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-white/62">Intensity</span>
                  <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={item.intensity}
                      onChange={(event) =>
                        onChange(items.map((entry) => (entry.id === item.id ? { ...entry, intensity: Number(event.target.value) } : entry)))
                      }
                    />
                    <div className="mt-2 text-sm text-white/52">{item.intensity}%</div>
                  </div>
                </label>
              </div>
              <RemoveButton onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} />
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/62">If the preset is not right, how would you name it?</span>
              <Input
                value={item.label}
                onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, label: event.target.value } : entry)))}
                placeholder="Tight sadness, panic, shame, relief..."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/62">What was notable about this emotion?</span>
              <Textarea
                value={item.note}
                onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, note: event.target.value } : entry)))}
                placeholder="Short note about what made this emotion stand out."
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThoughtRowsEditor({
  items,
  onChange,
  beliefs,
  modes
}: {
  items: TriggerThought[];
  onChange: (items: TriggerThought[]) => void;
  beliefs: BeliefEntry[];
  modes: ModeProfile[];
}) {
  return (
    <div className="grid gap-3">
      <SectionHeader
        title="What did your mind start saying?"
        description="Capture the thought itself first, then optionally link a belief or mode influence."
        addLabel="Add thought"
        onAdd={() => onChange([...items, createThoughtDraft()])}
      />
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <label className="grid flex-1 gap-2">
                <span className="text-sm text-white/62">Thought</span>
                <Textarea
                  value={item.text}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, text: event.target.value } : entry)))}
                  placeholder="What sentence, image, or conclusion showed up?"
                />
              </label>
              <RemoveButton onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm text-white/62">Parent mode influence</span>
                <select
                  className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                  value={item.parentMode}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, parentMode: event.target.value } : entry)))}
                >
                  <option value="">None</option>
                  {modes.map((mode) => (
                    <option key={mode.id} value={mode.title}>
                      {mode.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/62">Critic mode influence</span>
                <select
                  className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                  value={item.criticMode}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, criticMode: event.target.value } : entry)))}
                >
                  <option value="">None</option>
                  {modes.map((mode) => (
                    <option key={mode.id} value={mode.title}>
                      {mode.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/62">Linked belief</span>
                <select
                  className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                  value={item.beliefId ?? ""}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, beliefId: event.target.value || null } : entry)))}
                >
                  <option value="">None</option>
                  {beliefs.map((belief) => (
                    <option key={belief.id} value={belief.id}>
                      {belief.statement}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BehaviorRowsEditor({
  items,
  onChange,
  behaviors,
  modes
}: {
  items: TriggerBehavior[];
  onChange: (items: TriggerBehavior[]) => void;
  behaviors: Behavior[];
  modes: ModeProfile[];
}) {
  return (
    <div className="grid gap-3">
      <SectionHeader
        title="What did you do, or want to do?"
        description="Capture the move itself, then optionally link an existing behavior and the mode context around it."
        addLabel="Add behavior"
        onAdd={() => onChange([...items, createBehaviorDraft()])}
      />
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <label className="grid flex-1 gap-2">
                <span className="text-sm text-white/62">Behavior or urge</span>
                <Textarea
                  value={item.text}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, text: event.target.value } : entry)))}
                  placeholder="What did you do, or what move did you feel pulled toward?"
                />
              </label>
              <RemoveButton onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-white/62">Linked existing behavior</span>
                <select
                  className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                  value={item.behaviorId ?? ""}
                  onChange={(event) => {
                    const linked = behaviors.find((entry) => entry.id === event.target.value);
                    onChange(
                      items.map((entry) =>
                        entry.id === item.id
                          ? {
                              ...entry,
                              behaviorId: event.target.value || null,
                              text: linked && !entry.text ? linked.title : entry.text
                            }
                          : entry
                      )
                    );
                  }}
                >
                  <option value="">None</option>
                  {behaviors.map((behavior) => (
                    <option key={behavior.id} value={behavior.id}>
                      {behavior.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/62">Mode or urge context</span>
                <select
                  className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                  value={item.mode}
                  onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, mode: event.target.value } : entry)))}
                >
                  <option value="">None</option>
                  {modes.map((mode) => (
                    <option key={mode.id} value={mode.title}>
                      {mode.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModeTimelineEditor({
  items,
  onChange,
  modes,
  stages
}: {
  items: ModeTimelineEntry[];
  onChange: (items: ModeTimelineEntry[]) => void;
  modes: ModeProfile[];
  stages: string[];
}) {
  return (
    <div className="grid gap-3">
      <SectionHeader
        title="How did your state shift through the chain?"
        description="Build the mode timeline one moment at a time instead of typing parser syntax."
        addLabel="Add timeline moment"
        onAdd={() => onChange([...items, createModeTimelineDraft()])}
      />
      <div className="grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 gap-4 md:grid-cols-3">
                <label className="grid gap-2">
                  <span className="text-sm text-white/62">Stage</span>
                  <select
                    className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                    value={item.stage}
                    onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, stage: event.target.value } : entry)))}
                  >
                    <option value="">Choose stage</option>
                    {stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-white/62">Mode</span>
                  <select
                    className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white"
                    value={item.modeId ?? ""}
                    onChange={(event) => {
                      const mode = modes.find((entry) => entry.id === event.target.value);
                      onChange(
                        items.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                modeId: event.target.value || null,
                                label: mode && !entry.label ? mode.title : entry.label
                              }
                            : entry
                        )
                      );
                    }}
                  >
                    <option value="">Choose mode</option>
                    {modes.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-white/62">Moment label</span>
                  <Input
                    value={item.label}
                    onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, label: event.target.value } : entry)))}
                    placeholder="What was happening in this moment?"
                  />
                </label>
              </div>
              <RemoveButton onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} />
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/62">What was important about this shift?</span>
              <Textarea
                value={item.note}
                onChange={(event) => onChange(items.map((entry) => (entry.id === item.id ? { ...entry, note: event.target.value } : entry)))}
                placeholder="Short note about how the mode showed up or what it was protecting."
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
