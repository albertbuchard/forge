import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { WORK_BLOCK_PRESETS, WEEKDAY_LABELS, minutesToLabel } from "@/lib/calendar-ui";
import type { WorkBlockKind, WorkBlockTemplate } from "@/lib/types";

type WorkBlockDraft = {
  title: string;
  kind: WorkBlockKind;
  color: string;
  timezone: string;
  weekDays: number[];
  startMinute: number;
  endMinute: number;
  startsOn: string | null;
  endsOn: string | null;
  blockingState: "allowed" | "blocked";
};

function buildDraft(template?: WorkBlockTemplate | null): WorkBlockDraft {
  if (template) {
    return {
      title: template.title,
      kind: template.kind,
      color: template.color,
      timezone: template.timezone,
      weekDays: template.weekDays,
      startMinute: template.startMinute,
      endMinute: template.endMinute,
      startsOn: template.startsOn,
      endsOn: template.endsOn,
      blockingState: template.blockingState
    };
  }

  const preset = WORK_BLOCK_PRESETS[0];
  return {
    title: preset.title,
    kind: preset.kind,
    color: preset.color,
    timezone:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : "UTC",
    weekDays: [1, 2, 3, 4, 5],
    startMinute: preset.startMinute,
    endMinute: preset.endMinute,
    startsOn: null,
    endsOn: null,
    blockingState: preset.blockingState
  };
}

function asDateInputValue(value: string | null) {
  return value ?? "";
}

export function WorkBlockFlowDialog({
  open,
  onOpenChange,
  onSubmit,
  pending = false,
  template = null
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: WorkBlockDraft) => Promise<void>;
  pending?: boolean;
  template?: WorkBlockTemplate | null;
}) {
  const [draft, setDraft] = useState<WorkBlockDraft>(() => buildDraft(template));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEditing = template !== null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitError(null);
    setDraft(buildDraft(template));
  }, [open, template]);

  const steps = useMemo<Array<QuestionFlowStep<WorkBlockDraft>>>(
    () => [
      {
        id: "preset",
        eyebrow: "Preset",
        title: "Start from a recurring block that already matches the rhythm",
        description:
          "Use a preset to seed the schedule, then tune the dates and recurrence in the next step.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Block type">
              <FlowChoiceGrid
                value={value.kind}
                columns={3}
                onChange={(next) => {
                  const preset = WORK_BLOCK_PRESETS.find((entry) => entry.kind === next);
                  if (preset) {
                    const defaultWeekDays =
                      preset.kind === "holiday" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
                    setValue({
                      kind: preset.kind,
                      title: preset.title,
                      color: preset.color,
                      weekDays: defaultWeekDays,
                      startMinute: preset.startMinute,
                      endMinute: preset.endMinute,
                      blockingState: preset.blockingState
                    });
                    return;
                  }
                  setValue({
                    kind: "custom",
                    title: "Custom block",
                    color: "#7dd3fc"
                  });
                }}
                options={[
                  ...WORK_BLOCK_PRESETS.map((preset) => ({
                    value: preset.kind,
                    label: preset.title,
                    description: `${minutesToLabel(preset.startMinute)}-${minutesToLabel(preset.endMinute)}`
                  })),
                  {
                    value: "custom",
                    label: "Custom",
                    description: "Build a different recurring window."
                  }
                ]}
              />
            </FlowField>
          </div>
        )
      },
      {
        id: "shape",
        eyebrow: "Schedule",
        title: "Define when this recurring block should exist",
        description:
          "Weekdays and times describe the recurring pattern. Optional start and end dates bound when the template is active.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Block title">
              <Input
                value={value.title}
                onChange={(event) => setValue({ title: event.target.value })}
                placeholder="Main Activity"
              />
            </FlowField>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Start minute">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={value.startMinute}
                  onChange={(event) => setValue({ startMinute: Number(event.target.value) || 0 })}
                />
              </FlowField>
              <FlowField label="End minute">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={value.endMinute}
                  onChange={(event) => setValue({ endMinute: Number(event.target.value) || 0 })}
                />
              </FlowField>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Start date">
                <Input
                  type="date"
                  value={asDateInputValue(value.startsOn)}
                  onChange={(event) =>
                    setValue({ startsOn: event.target.value.trim() || null })
                  }
                />
              </FlowField>
              <FlowField label="End date">
                <Input
                  type="date"
                  value={asDateInputValue(value.endsOn)}
                  onChange={(event) =>
                    setValue({ endsOn: event.target.value.trim() || null })
                  }
                />
              </FlowField>
            </div>
            <div className="text-sm leading-6 text-white/54">
              Leave the end date empty to keep repeating indefinitely. Holiday blocks work well
              with all seven weekdays and `0-1440`.
            </div>
            <FlowField label="Weekdays">
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((label, day) => {
                  const active = value.weekDays.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setValue({
                          weekDays: active
                            ? value.weekDays.filter((entry) => entry !== day)
                            : [...value.weekDays, day].sort((a, b) => a - b)
                        })
                      }
                      className={`rounded-full px-3 py-2 text-sm transition ${
                        active
                          ? "bg-[var(--primary)]/18 text-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(192,193,255,0.24)]"
                          : "bg-white/[0.05] text-white/62 hover:bg-white/[0.08]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </FlowField>
          </div>
        )
      },
      {
        id: "policy",
        eyebrow: "Policy",
        title: "Tell Forge whether this block allows or blocks work",
        description:
          "Use blocked mode for time that should normally stop optional work. Use allowed mode for protected focus windows.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Work effect">
              <FlowChoiceGrid
                value={value.blockingState}
                onChange={(next) =>
                  setValue({ blockingState: next as WorkBlockDraft["blockingState"] })
                }
                options={[
                  {
                    value: "blocked",
                    label: "Blocks work",
                    description: "Starting blocked tasks should require an explicit override."
                  },
                  {
                    value: "allowed",
                    label: "Allows work",
                    description: "Use this for protected windows where the right tasks should fit."
                  }
                ]}
              />
            </FlowField>
            <FlowField label="Color">
              <div className="flex items-center gap-3 rounded-[22px] border border-white/8 bg-white/6 px-4 py-3">
                <input
                  className="h-10 w-12 rounded-lg border border-white/10 bg-transparent"
                  type="color"
                  value={value.color}
                  onChange={(event) => setValue({ color: event.target.value })}
                />
                <Input
                  className="border-none bg-transparent px-0 py-0"
                  value={value.color}
                  onChange={(event) => setValue({ color: event.target.value })}
                />
              </div>
            </FlowField>
          </div>
        )
      }
    ],
    []
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title={isEditing ? "Edit work block" : "Create a work block"}
      description={
        isEditing
          ? "Adjust the recurring pattern, date bounds, or work policy for this block."
          : "Build recurring half-day, holiday, or custom blocks so Forge can understand when work should be protected or blocked."
      }
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={isEditing ? "Save changes" : "Save work block"}
      pending={pending}
      pendingLabel={isEditing ? "Saving changes" : "Saving"}
      error={submitError}
      onSubmit={async () => {
        if (!draft.title.trim()) {
          setSubmitError("Give the block a title so it stays readable in the calendar.");
          return;
        }
        if (draft.weekDays.length === 0) {
          setSubmitError("Select at least one weekday for the recurring block.");
          return;
        }
        if (draft.endMinute <= draft.startMinute) {
          setSubmitError("The end minute needs to be later than the start minute.");
          return;
        }
        if (draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn) {
          setSubmitError("The end date needs to be on or after the start date.");
          return;
        }
        try {
          setSubmitError(null);
          await onSubmit({
            ...draft,
            title: draft.title.trim()
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error ? error.message : "Forge could not save this work block."
          );
        }
      }}
    />
  );
}
