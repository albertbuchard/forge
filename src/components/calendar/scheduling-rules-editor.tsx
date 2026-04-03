import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CalendarAvailability, CalendarSchedulingRules, WorkBlockKind } from "@/lib/types";

const WORK_BLOCK_OPTIONS: Array<{ value: WorkBlockKind; label: string }> = [
  { value: "main_activity", label: "Main activity" },
  { value: "secondary_activity", label: "Secondary activity" },
  { value: "third_activity", label: "Third activity" },
  { value: "rest", label: "Rest" },
  { value: "holiday", label: "Holiday" },
  { value: "custom", label: "Custom" }
];

const AVAILABILITY_OPTIONS: Array<{ value: CalendarAvailability; label: string }> = [
  { value: "busy", label: "Busy" },
  { value: "free", label: "Free" }
];

const EMPTY_RULES: CalendarSchedulingRules = {
  allowWorkBlockKinds: [],
  blockWorkBlockKinds: [],
  allowCalendarIds: [],
  blockCalendarIds: [],
  allowEventTypes: [],
  blockEventTypes: [],
  allowEventKeywords: [],
  blockEventKeywords: [],
  allowAvailability: [],
  blockAvailability: []
};

function toCsv(values: string[]) {
  return values.join(", ");
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ChipToggleGroup<T extends string>({
  label,
  selected,
  onToggle,
  options
}: {
  label: string;
  selected: T[];
  onToggle: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              className={`rounded-full px-3 py-2 text-sm transition ${
                active
                  ? "bg-[var(--primary)]/18 text-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.24)]"
                  : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SchedulingRulesEditor({
  title,
  subtitle,
  initialRules,
  initialPlannedDurationSeconds,
  onSave,
  saveLabel = "Save scheduling rules",
  allowPlannedDuration = false
}: {
  title: string;
  subtitle: string;
  initialRules: CalendarSchedulingRules | null | undefined;
  initialPlannedDurationSeconds?: number | null;
  onSave: (input: {
    schedulingRules: CalendarSchedulingRules | null;
    plannedDurationSeconds?: number | null;
  }) => Promise<void>;
  saveLabel?: string;
  allowPlannedDuration?: boolean;
}) {
  const [allowWorkBlockKinds, setAllowWorkBlockKinds] = useState(
    initialRules?.allowWorkBlockKinds ?? EMPTY_RULES.allowWorkBlockKinds
  );
  const [blockWorkBlockKinds, setBlockWorkBlockKinds] = useState(
    initialRules?.blockWorkBlockKinds ?? EMPTY_RULES.blockWorkBlockKinds
  );
  const [allowAvailability, setAllowAvailability] = useState(
    initialRules?.allowAvailability ?? EMPTY_RULES.allowAvailability
  );
  const [blockAvailability, setBlockAvailability] = useState(
    initialRules?.blockAvailability ?? EMPTY_RULES.blockAvailability
  );
  const [allowCalendarIds, setAllowCalendarIds] = useState(
    toCsv(initialRules?.allowCalendarIds ?? EMPTY_RULES.allowCalendarIds)
  );
  const [blockCalendarIds, setBlockCalendarIds] = useState(
    toCsv(initialRules?.blockCalendarIds ?? EMPTY_RULES.blockCalendarIds)
  );
  const [allowEventTypes, setAllowEventTypes] = useState(
    toCsv(initialRules?.allowEventTypes ?? EMPTY_RULES.allowEventTypes)
  );
  const [blockEventTypes, setBlockEventTypes] = useState(
    toCsv(initialRules?.blockEventTypes ?? EMPTY_RULES.blockEventTypes)
  );
  const [allowEventKeywords, setAllowEventKeywords] = useState(
    toCsv(initialRules?.allowEventKeywords ?? EMPTY_RULES.allowEventKeywords)
  );
  const [blockEventKeywords, setBlockEventKeywords] = useState(
    toCsv(initialRules?.blockEventKeywords ?? EMPTY_RULES.blockEventKeywords)
  );
  const [plannedMinutes, setPlannedMinutes] = useState(
    initialPlannedDurationSeconds ? String(Math.round(initialPlannedDurationSeconds / 60)) : "30"
  );
  const [pending, setPending] = useState(false);

  const normalizedRules = useMemo<CalendarSchedulingRules>(() => ({
    allowWorkBlockKinds,
    blockWorkBlockKinds,
    allowCalendarIds: parseCsv(allowCalendarIds),
    blockCalendarIds: parseCsv(blockCalendarIds),
    allowEventTypes: parseCsv(allowEventTypes),
    blockEventTypes: parseCsv(blockEventTypes),
    allowEventKeywords: parseCsv(allowEventKeywords),
    blockEventKeywords: parseCsv(blockEventKeywords),
    allowAvailability,
    blockAvailability
  }), [
    allowAvailability,
    allowCalendarIds,
    allowEventKeywords,
    allowEventTypes,
    allowWorkBlockKinds,
    blockAvailability,
    blockCalendarIds,
    blockEventKeywords,
    blockEventTypes,
    blockWorkBlockKinds
  ]);

  const isEmpty = Object.values(normalizedRules).every((value) => value.length === 0);

  const toggle = <T extends string>(
    values: T[],
    setter: (next: T[]) => void,
    value: T
  ) => {
    setter(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]);
  };

  return (
    <Card className="grid gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{title}</div>
        <p className="mt-2 text-sm leading-6 text-white/60">{subtitle}</p>
      </div>

      {allowPlannedDuration ? (
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Planned duration</div>
          <Input
            type="number"
            min={15}
            step={15}
            value={plannedMinutes}
            onChange={(event) => setPlannedMinutes(event.target.value)}
            placeholder="30"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChipToggleGroup
          label="Allow work blocks"
          selected={allowWorkBlockKinds}
          onToggle={(value) => toggle(allowWorkBlockKinds, setAllowWorkBlockKinds, value)}
          options={WORK_BLOCK_OPTIONS}
        />
        <ChipToggleGroup
          label="Block work blocks"
          selected={blockWorkBlockKinds}
          onToggle={(value) => toggle(blockWorkBlockKinds, setBlockWorkBlockKinds, value)}
          options={WORK_BLOCK_OPTIONS}
        />
        <ChipToggleGroup
          label="Allow availability"
          selected={allowAvailability}
          onToggle={(value) => toggle(allowAvailability, setAllowAvailability, value)}
          options={AVAILABILITY_OPTIONS}
        />
        <ChipToggleGroup
          label="Block availability"
          selected={blockAvailability}
          onToggle={(value) => toggle(blockAvailability, setBlockAvailability, value)}
          options={AVAILABILITY_OPTIONS}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Allow calendar ids</div>
          <Input value={allowCalendarIds} onChange={(event) => setAllowCalendarIds(event.target.value)} placeholder="calendar_123, primary" />
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Block calendar ids</div>
          <Input value={blockCalendarIds} onChange={(event) => setBlockCalendarIds(event.target.value)} placeholder="calendar_456" />
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Allow event types</div>
          <Input value={allowEventTypes} onChange={(event) => setAllowEventTypes(event.target.value)} placeholder="focus, personal" />
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Block event types</div>
          <Input value={blockEventTypes} onChange={(event) => setBlockEventTypes(event.target.value)} placeholder="out-of-office, main-work" />
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Allow event keywords</div>
          <Input value={allowEventKeywords} onChange={(event) => setAllowEventKeywords(event.target.value)} placeholder="creative, writing" />
        </div>
        <div className="grid gap-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Block event keywords</div>
          <Input value={blockEventKeywords} onChange={(event) => setBlockEventKeywords(event.target.value)} placeholder="psychiatrist, clinic, rest" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          pending={pending}
          pendingLabel="Saving"
          onClick={async () => {
            setPending(true);
            try {
              await onSave({
                schedulingRules: isEmpty ? EMPTY_RULES : normalizedRules,
                plannedDurationSeconds: allowPlannedDuration
                  ? Math.max(15, Number(plannedMinutes || 30)) * 60
                  : undefined
              });
            } finally {
              setPending(false);
            }
          }}
        >
          {saveLabel}
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            setPending(true);
            try {
              setAllowWorkBlockKinds([]);
              setBlockWorkBlockKinds([]);
              setAllowAvailability([]);
              setBlockAvailability([]);
              setAllowCalendarIds("");
              setBlockCalendarIds("");
              setAllowEventTypes("");
              setBlockEventTypes("");
              setAllowEventKeywords("");
              setBlockEventKeywords("");
              await onSave({
                schedulingRules: null,
                plannedDurationSeconds: allowPlannedDuration
                  ? Math.max(15, Number(plannedMinutes || 30)) * 60
                  : undefined
              });
            } finally {
              setPending(false);
            }
          }}
        >
          Clear custom rules
        </Button>
      </div>
    </Card>
  );
}
