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

  useEffect(() => {
    if (!instrumentId) {
      setState(toBuilderState(null));
      return;
    }
    const instrument = detailQuery.data?.instrument;
    if (!instrument) {
      return;
    }
    if (!instrument.draftVersion && !prepareDraftMutation.isPending) {
      prepareDraftMutation.mutate();
      return;
    }
    setState(toBuilderState(instrument));
  }, [detailQuery.data?.instrument, instrumentId, prepareDraftMutation]);

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

      <Card className="bg-[linear-gradient(180deg,rgba(15,23,34,0.98),rgba(8,13,20,0.98))]">
        <div className="grid gap-3 md:grid-cols-4">
          {STEPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "rounded-[22px] border px-4 py-4 text-left transition",
                step === entry.id
                  ? "border-[rgba(110,231,183,0.24)] bg-[rgba(110,231,183,0.12)] text-white"
                  : "border-white/8 bg-white/[0.03] text-white/64 hover:bg-white/[0.05]"
              )}
              onClick={() => setStep(entry.id)}
            >
              <entry.icon className="size-4" />
              <div className="mt-3 text-sm font-medium">{entry.label}</div>
            </button>
          ))}
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <Card className="bg-[linear-gradient(180deg,rgba(16,24,34,0.98),rgba(10,15,24,0.96))]">
          {step === "metadata" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Title</span>
                <input
                  value={state.title}
                  onChange={(event) => setState((current) => ({ ...current, title: event.target.value }))}
                  className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Subtitle</span>
                <input
                  value={state.subtitle}
                  onChange={(event) => setState((current) => ({ ...current, subtitle: event.target.value }))}
                  className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Description</span>
                <textarea
                  value={state.description}
                  onChange={(event) => setState((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-28 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm text-white/72">Aliases</span>
                  <input
                    value={state.aliases}
                    onChange={(event) => setState((current) => ({ ...current, aliases: event.target.value }))}
                    className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-white/72">Symptom domains</span>
                  <input
                    value={state.symptomDomains}
                    onChange={(event) =>
                      setState((current) => ({ ...current, symptomDomains: event.target.value }))
                    }
                    className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="grid gap-2">
                  <span className="text-sm text-white/72">Tags</span>
                  <input
                    value={state.tags}
                    onChange={(event) => setState((current) => ({ ...current, tags: event.target.value }))}
                    className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-white/72">Source class</span>
                  <select
                    value={state.sourceClass}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        sourceClass: event.target.value as QuestionnaireSourceClass
                      }))
                    }
                    className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
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
                  <span className="text-sm text-white/72">Availability</span>
                  <select
                    value={state.availability}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        availability: event.target.value as QuestionnaireAvailability
                      }))
                    }
                    className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
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
            <label className="grid gap-2">
              <span className="text-sm text-white/72">Definition JSON</span>
              <textarea
                value={state.definitionJson}
                onChange={(event) => setState((current) => ({ ...current, definitionJson: event.target.value }))}
                className="min-h-[32rem] rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none"
              />
            </label>
          ) : null}

          {step === "scoring" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Scoring JSON</span>
                <textarea
                  value={state.scoringJson}
                  onChange={(event) => setState((current) => ({ ...current, scoringJson: event.target.value }))}
                  className="min-h-[24rem] rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Provenance JSON</span>
                <textarea
                  value={state.provenanceJson}
                  onChange={(event) => setState((current) => ({ ...current, provenanceJson: event.target.value }))}
                  className="min-h-[16rem] rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white outline-none"
                />
              </label>
            </div>
          ) : null}

          {step === "publish" ? (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm text-white/72">Version label</span>
                <input
                  value={state.label}
                  onChange={(event) => setState((current) => ({ ...current, label: event.target.value }))}
                  className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              {parsedPreview ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                      Items
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {parsedPreview.definition.items.length}
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                      Sections
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {parsedPreview.definition.sections.length}
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                      Scores
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-white">
                      {parsedPreview.scoring.scores.length}
                    </div>
                  </div>
                </div>
              ) : null}
              <p className="text-sm leading-6 text-white/58">
                Publishing freezes the current draft into an immutable version for
                future runs. Past run history will always keep the version it was
                scored against.
              </p>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-4">
          <Card className="bg-[linear-gradient(180deg,rgba(14,21,31,0.98),rgba(9,14,22,0.96))]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
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
                <Badge className="w-fit bg-white/[0.08] text-white/78">
                  {detail?.draftVersion ? "Draft available" : "New draft"}
                </Badge>
                <div className="text-sm leading-6 text-white/60">
                  Save updates whenever the metadata or JSON changes, then publish
                  once the definition is ready for scoring and longitudinal history.
                </div>
              </div>
            )}
          </Card>

          <Card className="bg-[linear-gradient(180deg,rgba(15,23,33,0.98),rgba(9,15,23,0.96))]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
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
                <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
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
