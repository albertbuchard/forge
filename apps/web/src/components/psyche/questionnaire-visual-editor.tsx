import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  QuestionnaireDefinition,
  QuestionnaireItem,
  QuestionnaireOption,
  QuestionnaireProvenance,
  QuestionnaireProvenanceSource,
  QuestionnaireScoreDefinition,
  QuestionnaireScoring,
  QuestionnaireSection,
  QuestionnaireSourceClass
} from "@/lib/questionnaire-types";
import { cn } from "@/lib/utils";

const fieldLabelClass = "text-sm font-medium text-[var(--ui-ink-medium)]";
const fieldControlClass =
  "min-h-11 min-w-0 max-w-full rounded-[12px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2.5 text-sm text-[var(--ui-ink-strong)] outline-none transition placeholder:text-[var(--ui-ink-faint)] focus:border-[color-mix(in_srgb,var(--primary)_45%,var(--ui-border-strong)_55%)]";

function nextStableId(prefix: string, ids: string[]) {
  const used = new Set(ids);
  for (let index = 1; index <= ids.length + 1; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}_${ids.length + 1}`;
}

function defaultOptions() {
  return [
    { key: "0", label: "Not at all", value: 0, description: "" },
    { key: "1", label: "Several days", value: 1, description: "" },
    { key: "2", label: "More than half the days", value: 2, description: "" },
    { key: "3", label: "Nearly every day", value: 3, description: "" }
  ];
}

function newQuestion(
  id: string,
  templateOptions: QuestionnaireOption[]
): QuestionnaireItem {
  return {
    id,
    prompt: "New question",
    shortLabel: "",
    description: "",
    helperText: "",
    required: true,
    visibility: null,
    tags: [],
    options: templateOptions.map((option) => ({ ...option }))
  };
}

function updateSection(
  definition: QuestionnaireDefinition,
  sectionId: string,
  patch: Partial<QuestionnaireSection>
) {
  return {
    ...definition,
    sections: definition.sections.map((section) =>
      section.id === sectionId ? { ...section, ...patch } : section
    )
  };
}

function updateItem(
  definition: QuestionnaireDefinition,
  itemId: string,
  patch: Partial<QuestionnaireItem>
) {
  return {
    ...definition,
    items: definition.items.map((item) =>
      item.id === itemId ? { ...item, ...patch } : item
    )
  };
}

function expressionLabel(score: QuestionnaireScoreDefinition) {
  const { expression } = score;
  if (expression.kind === "sum" || expression.kind === "average") {
    return `${expression.kind === "sum" ? "Sum" : "Average"} of ${expression.itemIds.length} questions`;
  }
  if (expression.kind === "weighted_sum") {
    return `Weighted sum of ${expression.terms.length} questions`;
  }
  return `Advanced ${expression.kind.replaceAll("_", " ")} expression`;
}

function nextScoreKey(scores: QuestionnaireScoreDefinition[]) {
  return nextStableId(
    "score",
    scores.map((score) => score.key)
  );
}

export function QuestionnaireDefinitionEditor({
  definition,
  onChange
}: {
  definition: QuestionnaireDefinition;
  onChange: (definition: QuestionnaireDefinition) => void;
}) {
  const [activeSectionId, setActiveSectionId] = useState(
    definition.sections[0]?.id ?? ""
  );
  const activeSection =
    definition.sections.find((section) => section.id === activeSectionId) ??
    definition.sections[0] ??
    null;
  const itemsById = useMemo(
    () => new Map(definition.items.map((item) => [item.id, item])),
    [definition.items]
  );
  const activeItems =
    activeSection?.itemIds.flatMap((itemId) => {
      const item = itemsById.get(itemId);
      return item ? [item] : [];
    }) ?? [];

  useEffect(() => {
    if (
      definition.sections.length > 0 &&
      !definition.sections.some((section) => section.id === activeSectionId)
    ) {
      setActiveSectionId(definition.sections[0]!.id);
    }
  }, [activeSectionId, definition.sections]);

  const addSection = () => {
    const sectionId = nextStableId(
      "section",
      definition.sections.map((section) => section.id)
    );
    onChange({
      ...definition,
      sections: [
        ...definition.sections,
        {
          id: sectionId,
          title: `Section ${definition.sections.length + 1}`,
          description: "",
          visibility: null,
          itemIds: []
        }
      ]
    });
    setActiveSectionId(sectionId);
  };

  const addQuestion = () => {
    if (!activeSection) return;
    const itemId = nextStableId(
      "item",
      definition.items.map((item) => item.id)
    );
    const templateOptions =
      activeItems.at(-1)?.options ??
      definition.items.at(-1)?.options ??
      defaultOptions();
    const item = newQuestion(itemId, templateOptions);
    onChange({
      ...definition,
      itemIds: [...definition.itemIds, itemId],
      items: [...definition.items, item],
      sections: definition.sections.map((section) =>
        section.id === activeSection.id
          ? { ...section, itemIds: [...section.itemIds, itemId] }
          : section
      )
    });
  };

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-4 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Participant instructions</span>
          <textarea
            value={definition.instructions}
            className={cn(fieldControlClass, "min-h-24 resize-y")}
            onChange={(event) =>
              onChange({ ...definition, instructions: event.target.value })
            }
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className={fieldLabelClass}>Presentation</span>
            <select
              value={definition.presentationMode}
              className={fieldControlClass}
              onChange={(event) =>
                onChange({
                  ...definition,
                  presentationMode: event.target
                    .value as QuestionnaireDefinition["presentationMode"]
                })
              }
            >
              <option value="single_question">One question at a time</option>
              <option value="batched_likert">Batched Likert sections</option>
            </select>
          </label>
          <label className="grid gap-2">
            <span className={fieldLabelClass}>Completion note</span>
            <input
              value={definition.completionNote}
              className={fieldControlClass}
              onChange={(event) =>
                onChange({ ...definition, completionNote: event.target.value })
              }
            />
          </label>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-[var(--ui-ink-strong)]">
              Sections and questions
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {definition.sections.length} sections · {definition.items.length}{" "}
              questions. Only one section is expanded, so long instruments stay
              usable on narrow screens.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={addSection}
          >
            <Plus className="size-4" />
            Add section
          </Button>
        </div>

        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {definition.sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              aria-pressed={section.id === activeSection?.id}
              className={cn(
                "min-h-11 shrink-0 rounded-full border px-3 py-2 text-sm",
                section.id === activeSection?.id
                  ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
              )}
              onClick={() => setActiveSectionId(section.id)}
            >
              {index + 1}. {section.title || "Untitled section"} ·{" "}
              {section.itemIds.length}
            </button>
          ))}
        </div>

        {activeSection ? (
          <div className="grid min-w-0 gap-4 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Section title</span>
                <input
                  value={activeSection.title}
                  className={fieldControlClass}
                  onChange={(event) =>
                    onChange(
                      updateSection(definition, activeSection.id, {
                        title: event.target.value
                      })
                    )
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Section description</span>
                <input
                  value={activeSection.description}
                  className={fieldControlClass}
                  onChange={(event) =>
                    onChange(
                      updateSection(definition, activeSection.id, {
                        description: event.target.value
                      })
                    )
                  }
                />
              </label>
            </div>

            <div className="grid gap-3">
              {activeItems.map((item, index) => (
                <div
                  key={item.id}
                  className="grid min-w-0 gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                      Question {index + 1} · {item.id}
                    </span>
                    <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
                      <input
                        type="checkbox"
                        aria-label={`Required ${item.id}`}
                        checked={item.required}
                        onChange={(event) =>
                          onChange(
                            updateItem(definition, item.id, {
                              required: event.target.checked
                            })
                          )
                        }
                      />
                      Required
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>Question wording</span>
                    <textarea
                      aria-label={`Question wording ${item.id}`}
                      value={item.prompt}
                      className={cn(fieldControlClass, "min-h-20 resize-y")}
                      onChange={(event) =>
                        onChange(
                          updateItem(definition, item.id, {
                            prompt: event.target.value
                          })
                        )
                      }
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>Short label</span>
                      <input
                        aria-label={`Short label ${item.id}`}
                        value={item.shortLabel}
                        className={fieldControlClass}
                        onChange={(event) =>
                          onChange(
                            updateItem(definition, item.id, {
                              shortLabel: event.target.value
                            })
                          )
                        }
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>Answer help</span>
                      <input
                        aria-label={`Answer help ${item.id}`}
                        value={item.helperText}
                        className={fieldControlClass}
                        onChange={(event) =>
                          onChange(
                            updateItem(definition, item.id, {
                              helperText: event.target.value
                            })
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="text-xs leading-5 text-[var(--ui-ink-faint)]">
                    {item.options.length} response choices · conditional rules,
                    option values, and destructive changes remain in Advanced
                    definition JSON so scoring references cannot be broken
                    silently.
                  </div>
                </div>
              ))}
              {activeItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-6 text-center text-sm text-[var(--ui-ink-soft)]">
                  This section has no questions yet.
                </div>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={addQuestion}
              >
                <Plus className="size-4" />
                Add question to {activeSection.title || "this section"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-8 text-center text-sm text-[var(--ui-ink-soft)]">
            Add the first section before adding questions.
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestionnaireScoringEditor({
  scoring,
  itemIds,
  onChange
}: {
  scoring: QuestionnaireScoring;
  itemIds: string[];
  onChange: (scoring: QuestionnaireScoring) => void;
}) {
  const updateScore = (
    scoreKey: string,
    patch: Partial<QuestionnaireScoreDefinition>
  ) => {
    onChange({
      ...scoring,
      scores: scoring.scores.map((score) =>
        score.key === scoreKey ? { ...score, ...patch } : score
      )
    });
  };

  const addScore = () => {
    if (itemIds.length === 0) return;
    const key = nextScoreKey(scoring.scores);
    onChange({
      ...scoring,
      scores: [
        ...scoring.scores,
        {
          key,
          label: `Score ${scoring.scores.length + 1}`,
          description: "",
          valueType: "number",
          expression: { kind: "sum", itemIds: [...itemIds] },
          dependsOnItemIds: [...itemIds],
          missingPolicy: { mode: "require_all" },
          bands: [],
          roundTo: null,
          unitLabel: ""
        }
      ]
    });
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--ui-ink-strong)]">
            Scoring rules
          </div>
          <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
            Edit labels and missing-answer behavior here. Advanced formulas,
            score bands, and cross-score expressions remain available in the
            JSON editor without being discarded.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={itemIds.length === 0}
          onClick={addScore}
        >
          <Plus className="size-4" />
          Add total score
        </Button>
      </div>

      <div className="grid gap-3">
        {scoring.scores.map((score) => (
          <div
            key={score.key}
            className="grid min-w-0 gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                {score.key}
              </span>
              <span className="text-xs text-[var(--ui-ink-soft)]">
                {expressionLabel(score)}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Score label</span>
                <input
                  aria-label={`Score label ${score.key}`}
                  value={score.label}
                  className={fieldControlClass}
                  onChange={(event) =>
                    updateScore(score.key, { label: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Missing answers</span>
                <select
                  aria-label={`Missing answers ${score.key}`}
                  value={score.missingPolicy?.mode ?? "require_all"}
                  className={fieldControlClass}
                  onChange={(event) =>
                    updateScore(score.key, {
                      missingPolicy: {
                        ...score.missingPolicy,
                        mode: event.target.value as NonNullable<
                          QuestionnaireScoreDefinition["missingPolicy"]
                        >["mode"]
                      }
                    })
                  }
                >
                  <option value="require_all">Require every answer</option>
                  <option value="allow_partial">Allow partial answers</option>
                  <option value="min_answered">Require a minimum count</option>
                </select>
              </label>
            </div>
            <label className="grid gap-2">
              <span className={fieldLabelClass}>Score description</span>
              <textarea
                aria-label={`Score description ${score.key}`}
                value={score.description}
                className={cn(fieldControlClass, "min-h-20 resize-y")}
                onChange={(event) =>
                  updateScore(score.key, { description: event.target.value })
                }
              />
            </label>
            {score.missingPolicy?.mode === "min_answered" ? (
              <label className="grid max-w-xs gap-2">
                <span className={fieldLabelClass}>Minimum answered</span>
                <input
                  type="number"
                  aria-label={`Minimum answered ${score.key}`}
                  min={0}
                  max={itemIds.length}
                  value={score.missingPolicy.minAnswered ?? 1}
                  className={fieldControlClass}
                  onChange={(event) =>
                    updateScore(score.key, {
                      missingPolicy: {
                        mode: "min_answered",
                        minAnswered: Number(event.target.value)
                      }
                    })
                  }
                />
              </label>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-xs leading-5 text-[var(--ui-ink-faint)]">
                This action deliberately replaces only this score expression; it
                never rewrites other scores or interpretation bands.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                aria-label={`Include all ${itemIds.length} questions in ${score.key}`}
                disabled={itemIds.length === 0}
                onClick={() =>
                  updateScore(score.key, {
                    expression: { kind: "sum", itemIds: [...itemIds] },
                    dependsOnItemIds: [...itemIds]
                  })
                }
              >
                Include all {itemIds.length} questions
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function emptySource(): QuestionnaireProvenanceSource {
  return { label: "New source", url: "", citation: "", notes: "" };
}

export function QuestionnaireProvenanceEditor({
  provenance,
  onChange
}: {
  provenance: QuestionnaireProvenance;
  onChange: (provenance: QuestionnaireProvenance) => void;
}) {
  const updateSource = (
    index: number,
    patch: Partial<QuestionnaireProvenanceSource>
  ) => {
    onChange({
      ...provenance,
      sources: provenance.sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, ...patch } : source
      )
    });
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div>
        <div className="font-medium text-[var(--ui-ink-strong)]">
          Provenance
        </div>
        <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
          Record where the instrument and scoring rules came from. A source URL
          is evidence, not proof that reuse is legally permitted.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Retrieved</span>
          <input
            type="date"
            value={provenance.retrievalDate}
            className={fieldControlClass}
            onChange={(event) =>
              onChange({ ...provenance, retrievalDate: event.target.value })
            }
          />
        </label>
        <label className="grid gap-2">
          <span className={fieldLabelClass}>Source class</span>
          <select
            value={provenance.sourceClass}
            className={fieldControlClass}
            onChange={(event) =>
              onChange({
                ...provenance,
                sourceClass: event.target.value as QuestionnaireSourceClass
              })
            }
          >
            {[
              "public_domain",
              "free_use",
              "open_access",
              "open_noncommercial",
              "free_clinician",
              "secondary_verified"
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2">
        <span className={fieldLabelClass}>Scoring provenance notes</span>
        <textarea
          value={provenance.scoringNotes}
          className={cn(fieldControlClass, "min-h-24 resize-y")}
          onChange={(event) =>
            onChange({ ...provenance, scoringNotes: event.target.value })
          }
        />
      </label>
      <div className="grid gap-3">
        {provenance.sources.map((source, index) => (
          <div
            key={`source:${index}`}
            className="grid min-w-0 gap-3 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
              Source {index + 1}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Source label</span>
                <input
                  aria-label={`Source label ${index + 1}`}
                  value={source.label}
                  className={fieldControlClass}
                  onChange={(event) =>
                    updateSource(index, { label: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Source URL</span>
                <input
                  type="url"
                  aria-label={`Source URL ${index + 1}`}
                  value={source.url}
                  className={fieldControlClass}
                  onChange={(event) =>
                    updateSource(index, { url: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className={fieldLabelClass}>Citation</span>
              <textarea
                aria-label={`Citation ${index + 1}`}
                value={source.citation}
                className={cn(fieldControlClass, "min-h-20 resize-y")}
                onChange={(event) =>
                  updateSource(index, { citation: event.target.value })
                }
              />
            </label>
            <label className="grid gap-2">
              <span className={fieldLabelClass}>Source notes</span>
              <textarea
                aria-label={`Source notes ${index + 1}`}
                value={source.notes}
                className={cn(fieldControlClass, "min-h-20 resize-y")}
                onChange={(event) =>
                  updateSource(index, { notes: event.target.value })
                }
              />
            </label>
            {provenance.sources.length > 1 ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() =>
                  onChange({
                    ...provenance,
                    sources: provenance.sources.filter(
                      (_, sourceIndex) => sourceIndex !== index
                    )
                  })
                }
              >
                <Trash2 className="size-4" />
                Remove source {index + 1}
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() =>
            onChange({
              ...provenance,
              sources: [...provenance.sources, emptySource()]
            })
          }
        >
          <Plus className="size-4" />
          Add provenance source
        </Button>
      </div>
    </div>
  );
}
