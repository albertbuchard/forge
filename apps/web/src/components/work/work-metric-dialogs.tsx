import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveWorkMetricDefinition } from "@/lib/work-api";
import type { WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  message,
  recordValue,
  Select,
  Check
} from "./work-operational-dialog-shared";

type MetricDefinitionDraft = {
  canonicalKey: string;
  displayName: string;
  description: string;
  valueKind: "ordinal" | "numeric" | "categorical";
  minimum: string;
  maximum: string;
  options: string;
  targetMinimum: string;
  targetMaximum: string;
  warningBelow: string;
  warningAbove: string;
  reviewCadence: string;
  enabled: boolean;
};

function metricDefinitionDraft(value?: WorkRecord): MetricDefinitionDraft {
  const scale = recordValue(value?.scale);
  const target = recordValue(value?.target);
  const warning = recordValue(value?.warning);
  return {
    canonicalKey: String(value?.canonicalKey ?? ""),
    displayName: String(value?.displayName ?? ""),
    description: String(value?.description ?? ""),
    valueKind: (["ordinal", "numeric", "categorical"].includes(
      String(value?.valueKind)
    )
      ? value?.valueKind
      : "ordinal") as MetricDefinitionDraft["valueKind"],
    minimum: scale.minimum == null ? "1" : String(scale.minimum),
    maximum: scale.maximum == null ? "5" : String(scale.maximum),
    options: Array.isArray(scale.options)
      ? scale.options.map(String).join("\n")
      : "",
    targetMinimum: target.minimum == null ? "" : String(target.minimum),
    targetMaximum: target.maximum == null ? "" : String(target.maximum),
    warningBelow: warning.below == null ? "" : String(warning.below),
    warningAbove: warning.above == null ? "" : String(warning.above),
    reviewCadence: String(value?.reviewCadence ?? "monthly"),
    enabled: value?.enabled !== false
  };
}

export function MetricDefinitionDialog({
  open,
  onOpenChange,
  userIds,
  definition,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  definition?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => metricDefinitionDraft(definition));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBuiltIn = definition?.isBuiltin === true;
  useEffect(() => {
    if (open) {
      setDraft(metricDefinitionDraft(definition));
      setError(null);
    }
  }, [definition, open]);
  const steps = useMemo<Array<QuestionFlowStep<MetricDefinitionDraft>>>(
    () => [
      {
        id: "definition",
        eyebrow: isBuiltIn ? "Built-in Work metric" : "Custom Work metric",
        title: definition ? "Edit check-in metric" : "Add a check-in metric",
        description: isBuiltIn
          ? "You can rename this metric, change when it is reviewed, adjust warnings, or hide it. Its 1–5 meaning stays consistent over time."
          : "Define one clear question and answer scale. Earlier check-ins keep the meaning they had when recorded.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Name" className="md:col-span-2">
              <Input
                value={value.displayName}
                onChange={(event) => {
                  const displayName = event.target.value;
                  setValue({
                    displayName,
                    ...(!definition
                      ? {
                          canonicalKey: displayName
                            .toLowerCase()
                            .trim()
                            .replaceAll(/[^a-z0-9]+/gu, "_")
                            .replaceAll(/^_+|_+$/gu, "")
                        }
                      : {})
                  });
                }}
                autoFocus
              />
            </FlowField>
            <details className="rounded-[16px] border border-[var(--ui-border-subtle)] p-3 md:col-span-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-medium)]">
                Technical details
              </summary>
              <FlowField
                label="Stable metric key"
                hint="Used to keep the same measurement connected over time."
              >
                <Input
                  value={value.canonicalKey}
                  disabled={Boolean(definition)}
                  onChange={(event) =>
                    setValue({
                      canonicalKey: event.target.value
                        .toLowerCase()
                        .replaceAll(/[^a-z0-9_]/gu, "_")
                    })
                  }
                />
              </FlowField>
            </details>
            <FlowField label="Description" className="md:col-span-2">
              <Textarea
                rows={3}
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
              />
            </FlowField>
            <Select
              label="Value type"
              value={value.valueKind}
              onChange={(valueKind) =>
                setValue({
                  valueKind: valueKind as MetricDefinitionDraft["valueKind"]
                })
              }
              hint={isBuiltIn ? "Built-in metrics remain ordinal." : undefined}
            >
              {["ordinal", "numeric", "categorical"].map((option) => (
                <option
                  key={option}
                  value={option}
                  disabled={isBuiltIn && option !== "ordinal"}
                >
                  {option}
                </option>
              ))}
            </Select>
            <FlowField label="Review cadence">
              <Input
                value={value.reviewCadence}
                onChange={(event) =>
                  setValue({ reviewCadence: event.target.value })
                }
                placeholder="weekly, monthly, quarterly…"
              />
            </FlowField>
            {value.valueKind === "categorical" ? (
              <FlowField
                label="Allowed categories"
                hint="One unambiguous option per line"
                className="md:col-span-2"
              >
                <Textarea
                  rows={5}
                  value={value.options}
                  onChange={(event) =>
                    setValue({ options: event.target.value })
                  }
                />
              </FlowField>
            ) : (
              <>
                <FlowField label="Scale minimum">
                  <Input
                    type="number"
                    value={value.minimum}
                    disabled={isBuiltIn}
                    onChange={(event) =>
                      setValue({ minimum: event.target.value })
                    }
                  />
                </FlowField>
                <FlowField label="Scale maximum">
                  <Input
                    type="number"
                    value={value.maximum}
                    disabled={isBuiltIn}
                    onChange={(event) =>
                      setValue({ maximum: event.target.value })
                    }
                  />
                </FlowField>
              </>
            )}
            <FlowField label="Acceptable minimum" hint="Optional">
              <Input
                type="number"
                value={value.targetMinimum}
                onChange={(event) =>
                  setValue({ targetMinimum: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Acceptable maximum" hint="Optional">
              <Input
                type="number"
                value={value.targetMaximum}
                onChange={(event) =>
                  setValue({ targetMaximum: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Warn below" hint="Optional">
              <Input
                type="number"
                value={value.warningBelow}
                onChange={(event) =>
                  setValue({ warningBelow: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Warn above" hint="Optional">
              <Input
                type="number"
                value={value.warningAbove}
                onChange={(event) =>
                  setValue({ warningAbove: event.target.value })
                }
              />
            </FlowField>
            <div className="md:col-span-2">
              <Check
                checked={value.enabled}
                onChange={(enabled) => setValue({ enabled })}
              >
                Show this metric in Work check-ins. Disabling it preserves every
                prior observation and trend.
              </Check>
            </div>
          </div>
        )
      }
    ],
    [definition, isBuiltIn]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Check-ins"
      title={definition ? "Edit metric" : "Add custom metric"}
      description="Earlier check-ins keep the question and scale that were used when you recorded them."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={definition ? "Save metric" : "Add metric"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-metric-${definition?.id ?? "new"}`}
      resolveContinueBlocker={() =>
        !draft.canonicalKey.match(/^[a-z][a-z0-9_]{1,119}$/u)
          ? "Enter a name with at least two letters or numbers."
          : !draft.displayName.trim()
            ? "Enter a display name."
            : draft.valueKind === "categorical" &&
                lines(draft.options).length < 2
              ? "Add at least two categorical options."
              : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const number = (value: string) =>
          value.trim() === "" ? undefined : Number(value);
        const scale =
          draft.valueKind === "categorical"
            ? { options: lines(draft.options), precision: "categorical" }
            : isBuiltIn
              ? {
                  minimum: 1,
                  maximum: 5,
                  anchors: [
                    { value: 1, label: "Very low" },
                    { value: 2, label: "Low" },
                    { value: 3, label: "Mixed" },
                    { value: 4, label: "High" },
                    { value: 5, label: "Very high" }
                  ],
                  precision: "ordinal"
                }
              : {
                  minimum: number(draft.minimum),
                  maximum: number(draft.maximum),
                  precision: draft.valueKind
                };
        try {
          await saveWorkMetricDefinition(userIds, {
            canonicalKey: draft.canonicalKey,
            displayName: draft.displayName,
            description: draft.description,
            valueKind: isBuiltIn ? "ordinal" : draft.valueKind,
            scale,
            target: {
              minimum: number(draft.targetMinimum),
              maximum: number(draft.targetMaximum)
            },
            warning: {
              below: number(draft.warningBelow),
              above: number(draft.warningAbove)
            },
            reviewCadence: draft.reviewCadence,
            enabled: draft.enabled,
            expectedRevision: definition
              ? Number(definition.version ?? 1)
              : undefined,
            provenance
          });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
