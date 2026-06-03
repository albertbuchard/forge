import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileStack, LayoutTemplate, PenSquare, Rocket } from "lucide-react";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  cloneQuestionnaire,
  createQuestionnaire,
  ensureQuestionnaireDraft,
  getQuestionnaire,
  publishQuestionnaireDraft,
  updateQuestionnaireDraft
} from "@/lib/api";
import type {
  CreateQuestionnaireInstrumentInput,
  QuestionnaireAvailability,
  QuestionnaireDefinition,
  QuestionnaireInstrumentDetail,
  QuestionnaireProvenance,
  QuestionnaireScoring,
  QuestionnaireSourceClass
} from "@/lib/questionnaire-types";
import { cn } from "@/lib/utils";

type BuilderStep = "metadata" | "structure" | "scoring" | "publish";

type BuilderState = {
  title: string;
  subtitle: string;
  description: string;
  aliases: string;
  symptomDomains: string;
  tags: string;
  sourceClass: QuestionnaireSourceClass;
  availability: QuestionnaireAvailability;
  isSelfReport: boolean;
  label: string;
  definitionJson: string;
  scoringJson: string;
  provenanceJson: string;
};

const EMPTY_DEFINITION: QuestionnaireDefinition = {
  locale: "en",
  instructions: "Add questionnaire instructions here.",
  completionNote: "",
  presentationMode: "single_question",
  responseStyle: "four_point_frequency",
  itemIds: ["item_1"],
  items: [
    {
      id: "item_1",
      prompt: "Sample question",
      shortLabel: "",
      description: "",
      helperText: "",
      required: true,
      visibility: null,
      tags: [],
      options: [
        { key: "0", label: "Not at all", value: 0, description: "" },
        { key: "1", label: "Several days", value: 1, description: "" },
        { key: "2", label: "More than half the days", value: 2, description: "" },
        { key: "3", label: "Nearly every day", value: 3, description: "" }
      ]
    }
  ],
  sections: [
    {
      id: "section_1",
      title: "Section 1",
      description: "",
      visibility: null,
      itemIds: ["item_1"]
    }
  ],
  pageSize: null
};

const EMPTY_SCORING: QuestionnaireScoring = {
  scores: [
    {
      key: "total",
      label: "Total score",
      description: "",
      valueType: "number",
      expression: { kind: "sum", itemIds: ["item_1"] },
      dependsOnItemIds: ["item_1"],
      missingPolicy: { mode: "require_all" },
      bands: [],
      roundTo: null,
      unitLabel: ""
    }
  ]
};

const EMPTY_PROVENANCE: QuestionnaireProvenance = {
  retrievalDate: "2026-04-06",
  sourceClass: "secondary_verified",
  scoringNotes: "Describe the scoring method and provenance here.",
  sources: [
    {
      label: "Primary source",
      url: "https://example.com",
      citation: "Replace with a real citation.",
      notes: ""
    }
  ]
};

function toBuilderState(detail?: QuestionnaireInstrumentDetail | null): BuilderState {
  const version = detail?.draftVersion ?? detail?.currentVersion;
  return {
    title: detail?.title ?? "",
    subtitle: detail?.subtitle ?? "",
    description: detail?.description ?? "",
    aliases: detail?.aliases.join(", ") ?? "",
    symptomDomains: detail?.symptomDomains.join(", ") ?? "",
    tags: detail?.tags.join(", ") ?? "",
    sourceClass: detail?.sourceClass ?? "secondary_verified",
    availability: detail?.availability ?? "custom",
    isSelfReport: detail?.isSelfReport ?? true,
    label: version?.label ?? "Draft 1",
    definitionJson: JSON.stringify(version?.definition ?? EMPTY_DEFINITION, null, 2),
    scoringJson: JSON.stringify(version?.scoring ?? EMPTY_SCORING, null, 2),
    provenanceJson: JSON.stringify(version?.provenance ?? EMPTY_PROVENANCE, null, 2)
  };
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseState(state: BuilderState): CreateQuestionnaireInstrumentInput {
  return {
    title: state.title.trim(),
    subtitle: state.subtitle.trim(),
    description: state.description.trim(),
    aliases: splitCsv(state.aliases),
    symptomDomains: splitCsv(state.symptomDomains),
    tags: splitCsv(state.tags),
    sourceClass: state.sourceClass,
    availability: state.availability,
    isSelfReport: state.isSelfReport,
    versionLabel: state.label.trim() || "Draft 1",
    definition: JSON.parse(state.definitionJson) as QuestionnaireDefinition,
    scoring: JSON.parse(state.scoringJson) as QuestionnaireScoring,
    provenance: JSON.parse(state.provenanceJson) as QuestionnaireProvenance,
    userId: "user_operator"
  };
}

const STEPS: Array<{
  id: BuilderStep;
  label: string;
  icon: typeof PenSquare;
}> = [
  { id: "metadata", label: "Metadata", icon: PenSquare },
  { id: "structure", label: "Structure", icon: LayoutTemplate },
  { id: "scoring", label: "Scoring", icon: FileStack },
  { id: "publish", label: "Publish", icon: Rocket }
];

const fieldLabelClass = "text-sm font-medium text-[var(--ui-ink-medium)]";
const fieldControlClass =
  "min-w-0 max-w-full rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-strong)] outline-none transition placeholder:text-[var(--ui-ink-faint)] focus:border-[color-mix(in_srgb,var(--primary)_45%,var(--ui-border-strong)_55%)] focus:bg-[var(--ui-surface-2)]";
const jsonTextareaClass = cn(
  fieldControlClass,
  "resize-y whitespace-pre-wrap break-words font-mono leading-6 [overflow-wrap:anywhere]"
);
const mutedLabelClass =
  "font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const metricCardClass =
  "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-4";
const inlineCodeClass =
  "mx-1 rounded-[6px] bg-[var(--ui-surface-2)] px-1.5 py-0.5 text-xs text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]";

export function PsycheQuestionnaireBuilderPage() {
  const { instrumentId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<BuilderStep>("metadata");
  const [state, setState] = useState<BuilderState>(() => toBuilderState(null));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["forge-psyche-questionnaire-builder", instrumentId],
    queryFn: () => getQuestionnaire(instrumentId!),
    enabled: Boolean(instrumentId)
  });

  const prepareDraftMutation = useMutation({
    mutationFn: async () => {
      if (!instrumentId) {
        throw new Error("Missing questionnaire id");
      }
      const current = detailQuery.data?.instrument;
      if (current?.isSystem) {
        return cloneQuestionnaire(instrumentId, { userId: "user_operator" });
      }
      return ensureQuestionnaireDraft(instrumentId);
    },
    onSuccess: (payload) => {
      setState(toBuilderState(payload.instrument));
      if (payload.instrument.id !== instrumentId) {
        navigate(`/psyche/questionnaires/${payload.instrument.id}/edit`, {
          replace: true
        });
      }
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => createQuestionnaire(parseState(state)),
    onSuccess: (payload) => {
      navigate(`/psyche/questionnaires/${payload.instrument.id}/edit`, {
        replace: true
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!instrumentId) {
        throw new Error("Missing questionnaire id");
      }
      const payload = parseState(state);
      return updateQuestionnaireDraft(instrumentId, {
        ...payload,
        label: payload.versionLabel
      });
    }
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!instrumentId) {
        throw new Error("Missing questionnaire id");
      }
      return publishQuestionnaireDraft(instrumentId, { label: state.label });
    },
    onSuccess: (payload) => {
      navigate(`/psyche/questionnaires/${payload.instrument.id}`);
    }
  });

  const questionnaireForDraft = detailQuery.data?.instrument;

  useEffect(() => {
    if (!instrumentId) {
      setState(toBuilderState(null));
      return;
    }
    const instrument = questionnaireForDraft;
    if (!instrument) {
      return;
    }
    if (!instrument.draftVersion && !prepareDraftMutation.isPending) {
      prepareDraftMutation.mutate();
      return;
    }
    setState(toBuilderState(instrument));
  }, [instrumentId, prepareDraftMutation.isPending, questionnaireForDraft]);

  const pageTitle = instrumentId ? "Edit questionnaire" : "Build questionnaire";
  const detail = detailQuery.data?.instrument ?? null;
  const isBusy =
    detailQuery.isLoading ||
    prepareDraftMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    publishMutation.isPending;

  const parsedPreview = useMemo(() => {
    try {
      return {
        definition: JSON.parse(state.definitionJson) as QuestionnaireDefinition,
        scoring: JSON.parse(state.scoringJson) as QuestionnaireScoring
      };
    } catch {
      return null;
    }
  }, [state.definitionJson, state.scoringJson]);

  if (instrumentId && detailQuery.isLoading && !detail) {
    return (
      <LoadingState
        eyebrow="Questionnaire builder"
        title="Loading editable draft"
        description="Preparing the current questionnaire draft so the builder can open on real versioned data."
      />
    );
  }

  if (detailQuery.isError) {
    return (
      <ErrorState
        eyebrow="Questionnaire builder"
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const save = async () => {
    try {
      setJsonError(null);
      if (instrumentId) {
        await updateMutation.mutateAsync();
      } else {
        await createMutation.mutateAsync();
      }
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Unable to save questionnaire draft.");
    }
  };

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Psyche"
        title={pageTitle}
        description="Edit versioned questionnaire metadata, structure, scoring, and publication state directly in the app. Seeded instruments branch into editable drafts before any change is made."
        badge={instrumentId ? detail?.title ?? "Draft" : "New draft"}
        actions={
          instrumentId ? (
            <Link to={`/psyche/questionnaires/${instrumentId}`}>
              <Button variant="secondary">Back to detail</Button>
            </Link>
          ) : null
        }
      />

      <PsycheSectionNav />

      <Card className="border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
        <div className="grid gap-3 md:grid-cols-4">
          {STEPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "min-w-0 rounded-[8px] border px-4 py-4 text-left transition",
                step === entry.id
                  ? "border-[color-mix(in_srgb,var(--success)_42%,var(--ui-border-subtle)_58%)] bg-[var(--ui-success-soft)] text-[var(--ui-ink-strong)]"
                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)]"
              )}
              onClick={() => setStep(entry.id)}
            >
              <entry.icon className="size-4 shrink-0" />
              <div className="mt-3 min-w-0 break-words text-sm font-medium">
                {entry.label}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
          {step === "metadata" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Title</span>
                <input
                  value={state.title}
                  onChange={(event) => setState((current) => ({ ...current, title: event.target.value }))}
                  className={fieldControlClass}
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Subtitle</span>
                <input
                  value={state.subtitle}
                  onChange={(event) => setState((current) => ({ ...current, subtitle: event.target.value }))}
                  className={fieldControlClass}
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Description</span>
                <textarea
                  value={state.description}
                  onChange={(event) => setState((current) => ({ ...current, description: event.target.value }))}
                  className={cn(fieldControlClass, "min-h-28 resize-y")}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>Aliases</span>
                  <input
                    value={state.aliases}
                    onChange={(event) => setState((current) => ({ ...current, aliases: event.target.value }))}
                    className={fieldControlClass}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>Symptom domains</span>
                  <input
                    value={state.symptomDomains}
                    onChange={(event) =>
                      setState((current) => ({ ...current, symptomDomains: event.target.value }))
                    }
                    className={fieldControlClass}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>Tags</span>
                  <input
                    value={state.tags}
                    onChange={(event) => setState((current) => ({ ...current, tags: event.target.value }))}
                    className={fieldControlClass}
                  />
                </label>
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>Source class</span>
                  <select
                    value={state.sourceClass}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        sourceClass: event.target.value as QuestionnaireSourceClass
                      }))
                    }
                    className={fieldControlClass}
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
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>Availability</span>
                  <select
                    value={state.availability}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        availability: event.target.value as QuestionnaireAvailability
                      }))
                    }
                    className={fieldControlClass}
                  >
                    {["open", "free_clinician", "custom"].map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {step === "structure" ? (
            <div className="grid min-w-0 gap-2">
              <span className={fieldLabelClass}>Definition JSON</span>
              <div className="min-w-0 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                Items and sections can declare
                <code className={inlineCodeClass}>
                  visibility.script
                </code>
                rules such as
                <code className={inlineCodeClass}>
                  audit_1 &gt; 0
                </code>
                or
                <code className={inlineCodeClass}>
                  answered(question_12) and option(question_12) == "yes"
                </code>
                .
              </div>
              <textarea
                value={state.definitionJson}
                onChange={(event) => setState((current) => ({ ...current, definitionJson: event.target.value }))}
                className={cn(jsonTextareaClass, "min-h-[32rem]")}
              />
            </div>
          ) : null}

          {step === "scoring" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Scoring JSON</span>
                <textarea
                  value={state.scoringJson}
                  onChange={(event) => setState((current) => ({ ...current, scoringJson: event.target.value }))}
                  className={cn(jsonTextareaClass, "min-h-[24rem]")}
                />
              </label>
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Provenance JSON</span>
                <textarea
                  value={state.provenanceJson}
                  onChange={(event) => setState((current) => ({ ...current, provenanceJson: event.target.value }))}
                  className={cn(jsonTextareaClass, "min-h-[16rem]")}
                />
              </label>
            </div>
          ) : null}

          {step === "publish" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className={fieldLabelClass}>Version label</span>
                <input
                  value={state.label}
                  onChange={(event) => setState((current) => ({ ...current, label: event.target.value }))}
                  className={fieldControlClass}
                />
              </label>
              {parsedPreview ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className={metricCardClass}>
                    <div className={mutedLabelClass}>
                      Items
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                      {parsedPreview.definition.items.length}
                    </div>
                  </div>
                  <div className={metricCardClass}>
                    <div className={mutedLabelClass}>
                      Sections
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                      {parsedPreview.definition.sections.length}
                    </div>
                  </div>
                  <div className={metricCardClass}>
                    <div className={mutedLabelClass}>
                      Scores
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                      {parsedPreview.scoring.scores.length}
                    </div>
                  </div>
                </div>
              ) : null}
              <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                Publishing freezes the current draft into an immutable version for
                future runs. Past run history will always keep the version it was
                scored against.
              </p>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-4">
          <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
            <div className={mutedLabelClass}>
              Draft posture
            </div>
            {detail?.isSystem ? (
              <div className="mt-4">
                <EmptyState
                  eyebrow="System seed"
                  title="This started as a read-only seed"
                  description="The builder branched it into a user-owned draft before exposing any editable state."
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-2">
                <Badge className="w-fit border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {detail?.draftVersion ? "Draft available" : "New draft"}
                </Badge>
                <div className="break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Save updates whenever the metadata or JSON changes, then publish
                  once the definition is ready for scoring and longitudinal history.
                </div>
              </div>
            )}
          </Card>

          <Card className="min-w-0 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)]">
            <div className={mutedLabelClass}>
              Actions
            </div>
            <div className="mt-4 grid gap-3">
              <Button onClick={() => void save()} disabled={isBusy}>
                Save draft
              </Button>
              {instrumentId ? (
                <Button
                  variant="secondary"
                  onClick={() => publishMutation.mutate()}
                  disabled={isBusy || Boolean(jsonError)}
                >
                  Publish version
                </Button>
              ) : null}
              {jsonError ? (
                <div className="break-words rounded-[8px] border border-[var(--danger)]/20 bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                  {jsonError}
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
