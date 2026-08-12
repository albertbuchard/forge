import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Tags } from "lucide-react";
import {
  FlowField,
  FlowChoiceGrid,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import {
  BehaviorRowsEditor,
  EmotionRowsEditor,
  ModeTimelineEditor,
  StringListEditor,
  ThoughtRowsEditor
} from "@/components/psyche/report-chain-fields";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import {
  createPsycheVocabularyDraft,
  PsycheVocabularyFlowDialog,
  type PsycheVocabularyDraft
} from "@/components/psyche/psyche-vocabulary-flow-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { EntityName } from "@/components/ui/entity-name";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { prependEntityToCollection } from "@/lib/query-cache";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import {
  createBehavior,
  createBelief,
  createEmotionDefinition,
  createEventType,
  createMode,
  createPsycheValue,
  createTriggerReport,
  deleteEmotionDefinition,
  deleteEventType,
  listBehaviorPatterns,
  listBeliefs,
  listBehaviors,
  listEmotionDefinitions,
  listEventTypes,
  listModes,
  listPsycheValues,
  listSchemaCatalog,
  listTriggerReports,
  patchEmotionDefinition,
  patchEventType
} from "@/lib/api";
import {
  triggerReportSchema,
  type TriggerReportInput
} from "@/lib/psyche-schemas";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  ModeProfile,
  ModeTimelineEntry,
  PsycheValue,
  TriggerBehavior,
  TriggerEmotion,
  TriggerThought
} from "@/lib/psyche-types";
import {
  findSchemaForLink,
  getSchemaTypeHelpText,
  getSchemaTypeLabel,
  getSchemaVisual,
  toggleSchemaSelection
} from "@/lib/schema-visuals";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnerSelectDefaultLabel,
  formatOwnedEntityOptionLabel,
  getSingleSelectedUserId
} from "@/lib/user-ownership";

type ReportDraft = {
  title: string;
  status: "draft" | "reviewed" | "integrated";
  eventTypeId: string;
  customEventType: string;
  eventSituation: string;
  occurredAt: string;
  bodyCues: string[];
  emotions: TriggerEmotion[];
  thoughts: TriggerThought[];
  behaviors: TriggerBehavior[];
  selfShortTerm: string[];
  selfLongTerm: string[];
  othersShortTerm: string[];
  othersLongTerm: string[];
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  schemaLinks: string[];
  modeTimeline: ModeTimelineEntry[];
  nextMoves: string[];
  memoryClarity: "unspecified" | "clear" | "partial" | "uncertain";
  reflection: string;
  hypothesis: string;
  hypothesisFit: "not_reviewed" | "fits" | "partly_fits" | "does_not_fit";
  hypothesisCorrection: string;
  interpretationConsent: boolean;
  userId: string | null;
};

const DEFAULT_REPORT_DRAFT: ReportDraft = {
  title: "",
  status: "draft",
  eventTypeId: "",
  customEventType: "",
  eventSituation: "",
  occurredAt: "",
  bodyCues: [],
  emotions: [],
  thoughts: [],
  behaviors: [],
  selfShortTerm: [],
  selfLongTerm: [],
  othersShortTerm: [],
  othersLongTerm: [],
  linkedPatternIds: [],
  linkedValueIds: [],
  linkedBehaviorIds: [],
  linkedBeliefIds: [],
  linkedModeIds: [],
  linkedGoalIds: [],
  linkedProjectIds: [],
  linkedTaskIds: [],
  schemaLinks: [],
  modeTimeline: [],
  nextMoves: [],
  memoryClarity: "unspecified",
  reflection: "",
  hypothesis: "",
  hypothesisFit: "not_reviewed",
  hypothesisCorrection: "",
  interpretationConsent: false,
  userId: null
};

function createRequestKey() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `trigger-report-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function hasRecognizableReportSlice(value: ReportDraft) {
  const textParts = [
    value.title,
    value.customEventType,
    value.eventSituation,
    value.reflection,
    value.interpretationConsent ? value.hypothesis : "",
    ...value.bodyCues,
    ...value.selfShortTerm,
    ...value.selfLongTerm,
    ...value.othersShortTerm,
    ...value.othersLongTerm,
    ...value.nextMoves
  ];
  return (
    textParts.some((entry) => entry.trim().length > 0) ||
    value.emotions.some((entry) => entry.label.trim().length > 0) ||
    value.thoughts.some((entry) => entry.text.trim().length > 0) ||
    value.behaviors.some((entry) => entry.text.trim().length > 0) ||
    value.modeTimeline.some(
      (entry) => entry.label.trim().length > 0 || entry.note.trim().length > 0
    )
  );
}

function toTriggerReportInput(
  value: ReportDraft,
  status: ReportDraft["status"] = value.status
) {
  const title =
    value.title.trim() ||
    value.customEventType.trim() ||
    value.eventSituation.trim().slice(0, 120) ||
    "Trigger report";

  return triggerReportSchema.parse({
    title,
    status,
    eventTypeId: value.eventTypeId || null,
    customEventType: value.customEventType,
    eventSituation: value.eventSituation,
    occurredAt: value.occurredAt
      ? new Date(value.occurredAt).toISOString()
      : null,
    bodyCues: value.bodyCues.filter(Boolean),
    emotions: value.emotions.filter((entry) => entry.label.trim().length > 0),
    thoughts: value.thoughts.filter((entry) => entry.text.trim().length > 0),
    behaviors: value.behaviors.filter((entry) => entry.text.trim().length > 0),
    consequences: {
      selfShortTerm: value.selfShortTerm,
      selfLongTerm: value.selfLongTerm,
      othersShortTerm: value.othersShortTerm,
      othersLongTerm: value.othersLongTerm
    },
    linkedPatternIds: value.linkedPatternIds,
    linkedValueIds: value.linkedValueIds,
    linkedGoalIds: value.linkedGoalIds,
    linkedProjectIds: value.linkedProjectIds,
    linkedTaskIds: value.linkedTaskIds,
    linkedBehaviorIds: value.linkedBehaviorIds,
    linkedBeliefIds: value.linkedBeliefIds,
    linkedModeIds: value.linkedModeIds,
    modeOverlays: [],
    schemaLinks: value.schemaLinks.filter(Boolean),
    modeTimeline: value.modeTimeline.filter(
      (entry) => entry.stage.trim().length > 0 && entry.label.trim().length > 0
    ),
    nextMoves: value.nextMoves.filter(Boolean),
    memoryClarity: value.memoryClarity,
    reflection: value.reflection,
    hypothesis: value.interpretationConsent ? value.hypothesis : "",
    hypothesisFit: value.interpretationConsent
      ? value.hypothesisFit
      : "not_reviewed",
    hypothesisCorrection: value.interpretationConsent
      ? value.hypothesisCorrection
      : "",
    interpretationConsent: value.interpretationConsent,
    userId: value.userId
  } satisfies TriggerReportInput);
}

function formatDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function PsycheReportsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ReportDraft>(DEFAULT_REPORT_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabularyDraft, setVocabularyDraft] = useState<PsycheVocabularyDraft>(
    () => createPsycheVocabularyDraft(null)
  );
  const [vocabularyError, setVocabularyError] = useState<string | null>(null);
  const createRequestKeyRef = useRef(createRequestKey());
  const vocabularyRequestKeyRef = useRef(createRequestKey());
  const resolvedVocabularyFocusRef = useRef<string | null>(null);
  const reportsQuery = useInfiniteQuery({
    queryKey: ["forge-psyche-reports", shell.selectedUserIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listTriggerReports(shell.selectedUserIds, {
        limit: 25,
        cursor: pageParam
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values"],
    queryFn: listPsycheValues,
    enabled: dialogOpen
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns", ...shell.selectedUserIds],
    queryFn: () => listBehaviorPatterns(shell.selectedUserIds),
    enabled: dialogOpen
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors"],
    queryFn: listBehaviors,
    enabled: dialogOpen
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-psyche-beliefs"],
    queryFn: listBeliefs,
    enabled: dialogOpen
  });
  const modesQuery = useQuery({
    queryKey: ["forge-psyche-modes"],
    queryFn: listModes,
    enabled: dialogOpen
  });
  const schemasQuery = useQuery({
    queryKey: ["forge-psyche-schema-catalog"],
    queryFn: listSchemaCatalog
  });
  const eventTypesQuery = useQuery({
    queryKey: ["forge-psyche-event-types", ...shell.selectedUserIds],
    queryFn: () => listEventTypes(shell.selectedUserIds),
    enabled: dialogOpen || vocabularyOpen
  });
  const emotionsQuery = useQuery({
    queryKey: ["forge-psyche-emotions", ...shell.selectedUserIds],
    queryFn: () => listEmotionDefinitions(shell.selectedUserIds),
    enabled: dialogOpen || vocabularyOpen
  });

  const reports =
    reportsQuery.data?.pages.flatMap((page) => page.reports) ?? [];
  const reportTotal = reportsQuery.data?.pages[0]?.total ?? reports.length;
  const values = valuesQuery.data?.values ?? [];
  const patterns = patternsQuery.data?.patterns ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const eventTypes = useMemo(
    () => eventTypesQuery.data?.eventTypes ?? [],
    [eventTypesQuery.data?.eventTypes]
  );
  const emotions = useMemo(
    () => emotionsQuery.data?.emotions ?? [],
    [emotionsQuery.data?.emotions]
  );
  const supportingCatalogQueries = [
    valuesQuery,
    patternsQuery,
    behaviorsQuery,
    beliefsQuery,
    modesQuery,
    schemasQuery,
    eventTypesQuery,
    emotionsQuery
  ];
  const supportingCatalogsLoading = supportingCatalogQueries.some(
    (query) => query.isLoading
  );
  const supportingCatalogsError = supportingCatalogQueries.some(
    (query) => query.isError
  );
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const notesSummaryByEntity = shell.snapshot.dashboard.notesSummaryByEntity;

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      createRequestKeyRef.current = createRequestKey();
      setDialogOpen(true);
      setDraft({
        ...DEFAULT_REPORT_DRAFT,
        userId: searchParams.get("userId") ?? defaultUserId,
        occurredAt: searchParams.get("occurredAt")
          ? formatDateTimeLocal(searchParams.get("occurredAt")!)
          : "",
        customEventType:
          searchParams.get("intent") === "execution_tension"
            ? "Execution tension"
            : searchParams.get("intent") === "belief"
              ? "Belief script activation"
              : searchParams.get("intent") === "behavior"
                ? "Behavior spike"
                : searchParams.get("intent") === "pattern"
                  ? "Recurring pattern"
                  : searchParams.get("intent") === "value"
                    ? "Blocked value"
                    : "",
        linkedValueIds: searchParams.get("valueId")
          ? [searchParams.get("valueId")!]
          : [],
        linkedPatternIds: searchParams.get("patternId")
          ? [searchParams.get("patternId")!]
          : [],
        linkedBehaviorIds: searchParams.get("behaviorId")
          ? [searchParams.get("behaviorId")!]
          : [],
        linkedBeliefIds: searchParams.get("beliefId")
          ? [searchParams.get("beliefId")!]
          : [],
        linkedGoalIds: searchParams.get("goalId")
          ? [searchParams.get("goalId")!]
          : [],
        linkedProjectIds: searchParams.get("projectId")
          ? [searchParams.get("projectId")!]
          : [],
        linkedTaskIds: searchParams.get("taskId")
          ? [searchParams.get("taskId")!]
          : []
      });
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      next.delete("intent");
      next.delete("occurredAt");
      next.delete("userId");
      next.delete("valueId");
      next.delete("patternId");
      next.delete("behaviorId");
      next.delete("beliefId");
      next.delete("goalId");
      next.delete("projectId");
      next.delete("taskId");
      setSearchParams(next, { replace: true });
    }
  }, [defaultUserId, searchParams, setSearchParams]);

  useEffect(() => {
    const kind = searchParams.get("vocabulary");
    const selectedId = searchParams.get("focusVocabulary");
    if (
      (kind !== "event_type" && kind !== "emotion_definition") ||
      !selectedId
    ) {
      return;
    }
    vocabularyRequestKeyRef.current = createRequestKey();
    resolvedVocabularyFocusRef.current = null;
    setVocabularyDraft({
      ...createPsycheVocabularyDraft(defaultUserId),
      kind,
      selectedId
    });
    setVocabularyError(null);
    setVocabularyOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("vocabulary");
    next.delete("focusVocabulary");
    setSearchParams(next, { replace: true });
  }, [defaultUserId, searchParams, setSearchParams]);

  useEffect(() => {
    if (
      !vocabularyOpen ||
      !vocabularyDraft.selectedId ||
      vocabularyDraft.action
    ) {
      return;
    }
    const focusKey = `${vocabularyDraft.kind}:${vocabularyDraft.selectedId}`;
    if (resolvedVocabularyFocusRef.current === focusKey) {
      return;
    }
    const entries =
      vocabularyDraft.kind === "event_type" ? eventTypes : emotions;
    const entry = entries.find(
      (candidate) => candidate.id === vocabularyDraft.selectedId
    );
    if (entry) {
      resolvedVocabularyFocusRef.current = focusKey;
      setVocabularyDraft((current) => ({
        ...current,
        action: entry.system ? null : "update",
        search: entry.system ? entry.label : current.search,
        label: entry.label,
        description: entry.description,
        category:
          "category" in entry && typeof entry.category === "string"
            ? entry.category
            : "",
        userId: entry.userId ?? current.userId
      }));
      return;
    }
    const querySucceeded =
      vocabularyDraft.kind === "event_type"
        ? eventTypesQuery.isSuccess
        : emotionsQuery.isSuccess;
    if (querySucceeded) {
      resolvedVocabularyFocusRef.current = focusKey;
      setVocabularyError(
        "That linked vocabulary record is unavailable in this owner scope."
      );
    }
  }, [
    emotions,
    emotionsQuery.isSuccess,
    eventTypes,
    eventTypesQuery.isSuccess,
    vocabularyDraft.action,
    vocabularyDraft.kind,
    vocabularyDraft.selectedId,
    vocabularyOpen
  ]);

  const saveMutation = useMutation({
    mutationFn: async (value: ReportDraft) => {
      return createTriggerReport(toTriggerReportInput(value), {
        idempotencyKey: createRequestKeyRef.current
      });
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setDraft({ ...DEFAULT_REPORT_DRAFT, userId: defaultUserId });
      setSubmitError(null);
      createRequestKeyRef.current = createRequestKey();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] })
      ]);
    }
  });

  const vocabularyMutation = useMutation({
    mutationFn: async (value: PsycheVocabularyDraft) => {
      if (!value.action) {
        throw new Error("Choose a vocabulary action before saving.");
      }
      if (value.action === "delete") {
        if (!value.selectedId || !value.confirmDelete) {
          throw new Error("Confirm the custom label you want to delete.");
        }
        return value.kind === "event_type"
          ? deleteEventType(value.selectedId)
          : deleteEmotionDefinition(value.selectedId);
      }

      const input = {
        label: value.label.trim(),
        description: value.description.trim(),
        userId: value.userId
      };
      if (!input.label) {
        throw new Error("Add the wording you want to reuse.");
      }
      if (value.action === "create") {
        return value.kind === "event_type"
          ? createEventType(input, {
              idempotencyKey: vocabularyRequestKeyRef.current
            })
          : createEmotionDefinition(
              { ...input, category: value.category.trim() },
              { idempotencyKey: vocabularyRequestKeyRef.current }
            );
      }
      if (!value.selectedId) {
        throw new Error("Choose the custom label you want to update.");
      }
      return value.kind === "event_type"
        ? patchEventType(value.selectedId, input)
        : patchEmotionDefinition(value.selectedId, {
            ...input,
            category: value.category.trim()
          });
    },
    onSuccess: async () => {
      setVocabularyOpen(false);
      setVocabularyDraft(createPsycheVocabularyDraft(defaultUserId));
      setVocabularyError(null);
      vocabularyRequestKeyRef.current = createRequestKey();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-event-types"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-emotions"]
        })
      ]);
    }
  });

  const valueOptions: EntityLinkOption[] = values.map((entry: PsycheValue) => ({
    value: entry.id,
    label: formatOwnedEntityOptionLabel(entry.title, entry.user),
    description: formatOwnedEntityDescription(
      entry.valuedDirection,
      entry.user
    ),
    searchText: buildOwnedEntitySearchText(
      [entry.title, entry.valuedDirection, entry.description],
      entry
    ),
    kind: "value"
  }));
  const patternOptions: EntityLinkOption[] = patterns.map(
    (pattern: BehaviorPattern) => ({
      value: pattern.id,
      label: formatOwnedEntityOptionLabel(pattern.title, pattern.user),
      description: formatOwnedEntityDescription(
        pattern.targetBehavior || pattern.preferredResponse,
        pattern.user,
        "Pattern"
      ),
      searchText: buildOwnedEntitySearchText(
        [
          pattern.title,
          pattern.description,
          pattern.targetBehavior,
          pattern.preferredResponse
        ],
        pattern
      ),
      kind: "pattern"
    })
  );
  const behaviorOptions: EntityLinkOption[] = behaviors.map(
    (behavior: Behavior) => ({
      value: behavior.id,
      label: formatOwnedEntityOptionLabel(behavior.title, behavior.user),
      description: formatOwnedEntityDescription(behavior.kind, behavior.user),
      searchText: buildOwnedEntitySearchText(
        [behavior.title, behavior.kind, behavior.description],
        behavior
      ),
      kind: "behavior"
    })
  );
  const beliefOptions: EntityLinkOption[] = beliefs.map(
    (belief: BeliefEntry) => ({
      value: belief.id,
      label: formatOwnedEntityOptionLabel(belief.statement, belief.user),
      description: formatOwnedEntityDescription(
        belief.flexibleAlternative || belief.originNote,
        belief.user
      ),
      searchText: buildOwnedEntitySearchText(
        [
          belief.statement,
          belief.flexibleAlternative,
          belief.originNote,
          belief.beliefType
        ],
        belief
      ),
      kind: "belief"
    })
  );
  const modeOptions: EntityLinkOption[] = modes.map((mode: ModeProfile) => ({
    value: mode.id,
    label: formatOwnedEntityOptionLabel(mode.title, mode.user),
    description: formatOwnedEntityDescription(
      mode.archetype || mode.family,
      mode.user
    ),
    searchText: buildOwnedEntitySearchText(
      [mode.title, mode.archetype, mode.family, mode.persona],
      mode
    ),
    kind: "mode"
  }));

  const createLinkedValue = async (title: string) => {
    const { value } = await createPsycheValue({
      title,
      description: "",
      valuedDirection: title,
      whyItMatters: "",
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      committedActions: [],
      userId: draft.userId
    });
    prependEntityToCollection(
      queryClient,
      ["forge-psyche-values"],
      "values",
      value
    );
    await queryClient.invalidateQueries({
      queryKey: ["forge-psyche-overview"]
    });
    return {
      value: value.id,
      label: value.title,
      description: value.valuedDirection,
      kind: "value"
    } satisfies EntityLinkOption;
  };

  const createLinkedBehavior = async (title: string) => {
    const { behavior } = await createBehavior({
      kind: "away",
      title,
      description: "",
      commonCues: [],
      urgeStory: "",
      shortTermPayoff: "",
      longTermCost: "",
      replacementMove: "",
      repairPlan: "",
      linkedPatternIds: [],
      linkedValueIds: [],
      linkedSchemaIds: [],
      linkedModeIds: [],
      userId: draft.userId
    });
    prependEntityToCollection(
      queryClient,
      ["forge-psyche-behaviors"],
      "behaviors",
      behavior
    );
    await queryClient.invalidateQueries({
      queryKey: ["forge-psyche-overview"]
    });
    return {
      value: behavior.id,
      label: behavior.title,
      description: behavior.kind,
      kind: "behavior"
    } satisfies EntityLinkOption;
  };

  const createLinkedBelief = async (statement: string) => {
    const { belief } = await createBelief({
      schemaId: null,
      statement,
      beliefType: "absolute",
      originNote: "",
      confidence: 60,
      evidenceFor: [],
      evidenceAgainst: [],
      flexibleAlternative: "",
      linkedValueIds: [],
      linkedBehaviorIds: [],
      linkedModeIds: [],
      linkedReportIds: [],
      userId: draft.userId
    });
    prependEntityToCollection(
      queryClient,
      ["forge-psyche-beliefs"],
      "beliefs",
      belief
    );
    await queryClient.invalidateQueries({
      queryKey: ["forge-psyche-overview"]
    });
    return {
      value: belief.id,
      label: belief.statement,
      description: belief.flexibleAlternative || belief.originNote,
      kind: "belief"
    } satisfies EntityLinkOption;
  };

  const createLinkedMode = async (title: string) => {
    const { mode } = await createMode({
      family: "coping",
      archetype: "",
      title,
      persona: "",
      imagery: "",
      symbolicForm: "",
      facialExpression: "",
      fear: "",
      burden: "",
      protectiveJob: "",
      originContext: "",
      firstAppearanceAt: null,
      linkedPatternIds: [],
      linkedBehaviorIds: [],
      linkedValueIds: [],
      userId: draft.userId
    });
    prependEntityToCollection(
      queryClient,
      ["forge-psyche-modes"],
      "modes",
      mode
    );
    await queryClient.invalidateQueries({
      queryKey: ["forge-psyche-overview"]
    });
    return {
      value: mode.id,
      label: mode.title,
      description: mode.archetype || mode.family,
      kind: "mode"
    } satisfies EntityLinkOption;
  };

  const saveDraftAndPause = async (value: ReportDraft) => {
    setSubmitError(null);
    if (!hasRecognizableReportSlice(value)) {
      setSubmitError(
        "Add one part of the episode before saving, even if it is only a title, body cue, emotion, thought, action, or reflection."
      );
      return;
    }
    try {
      await saveMutation.mutateAsync({ ...value, status: "draft" });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Unable to save this partial report right now."
      );
    }
  };

  const renderPauseAction = (value: ReportDraft) => {
    const canSave = hasRecognizableReportSlice(value);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
        <p className="max-w-xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          {canSave
            ? "You can stop here. Forge will keep only what you entered and mark the report as a draft."
            : "Add one recognizable part of the episode, then you can save a sparse draft and pause."}
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={!canSave}
          pending={saveMutation.isPending}
          onClick={() => void saveDraftAndPause(value)}
        >
          Save draft and pause
        </Button>
      </div>
    );
  };

  const steps: Array<QuestionFlowStep<ReportDraft>> = [
    {
      id: "spark",
      eyebrow: "The episode",
      title: "What happened, as best as you remember it?",
      description:
        "Start with the concrete moment. It is fine if the sequence is incomplete or uncertain.",
      render: (value, setValue) => (
        <>
          <div
            className="grid gap-2"
            role="group"
            aria-labelledby="trigger-memory-clarity-label"
          >
            <div
              id="trigger-memory-clarity-label"
              className="text-sm font-medium text-[var(--ui-ink-strong)]"
            >
              How clear is the memory?
            </div>
            <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
              Choose the closest fit. Forge will keep uncertainty explicit
              instead of filling gaps.
            </p>
            <FlowChoiceGrid
              value={value.memoryClarity}
              onChange={(memoryClarity) =>
                setValue({
                  memoryClarity: memoryClarity as ReportDraft["memoryClarity"]
                })
              }
              options={[
                {
                  value: "unspecified",
                  label: "Not recorded",
                  description: "I do not want to rate the memory yet."
                },
                {
                  value: "clear",
                  label: "Clear",
                  description: "The sequence feels reliable."
                },
                {
                  value: "partial",
                  label: "Partial",
                  description: "Some parts are missing or blurred."
                },
                {
                  value: "uncertain",
                  label: "Uncertain",
                  description: "I am not sure what happened in what order."
                }
              ]}
            />
          </div>
          <FlowField label="The concrete moment">
            <Textarea
              value={value.eventSituation}
              onChange={(event) =>
                setValue({ eventSituation: event.target.value })
              }
              placeholder="What was said or done, where you were, and what changed. Leave out explanations for now."
            />
          </FlowField>
          <FlowField
            label="A short name"
            description="Optional. Forge can use the event label or the first part of the situation if you leave this blank."
          >
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Friday silence spiral"
            />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Event type">
              <select
                className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
                value={value.eventTypeId}
                onChange={(event) => {
                  const eventTypeId = event.target.value;
                  const previousDefinition = eventTypes.find(
                    (entry) => entry.id === value.eventTypeId
                  );
                  const nextDefinition = eventTypes.find(
                    (entry) => entry.id === eventTypeId
                  );
                  const wordingFollowsPreset =
                    !value.customEventType.trim() ||
                    value.customEventType === previousDefinition?.label;
                  setValue({
                    eventTypeId,
                    customEventType:
                      wordingFollowsPreset && nextDefinition
                        ? nextDefinition.label
                        : value.customEventType
                  });
                }}
              >
                <option value="">Custom or uncategorized</option>
                {eventTypes.map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>
                    {eventType.label}
                  </option>
                ))}
              </select>
            </FlowField>
            <FlowField label="Occurred at">
              <Input
                type="datetime-local"
                value={value.occurredAt}
                onChange={(event) =>
                  setValue({ occurredAt: event.target.value })
                }
              />
            </FlowField>
          </div>
          <FlowField label="Custom event label">
            <Input
              value={value.customEventType}
              onChange={(event) =>
                setValue({ customEventType: event.target.value })
              }
              placeholder="Unexpected distance after vulnerability"
            />
          </FlowField>
          {renderPauseAction(value)}
        </>
      )
    },
    {
      id: "body-wave",
      eyebrow: "Body and emotion",
      title: "What did you notice in your body and emotions?",
      description:
        "Name only what you actually noticed. A body cue or emotion can be enough for now.",
      render: (value, setValue) => (
        <>
          <StringListEditor
            title="Body cues"
            description="Include sensations, impulses, posture, breathing, numbness, or shutdown."
            addLabel="Add body cue"
            items={value.bodyCues}
            onChange={(items) => setValue({ bodyCues: items })}
            placeholder="My chest tightened and I stopped breathing fully."
          />
          <EmotionRowsEditor
            items={value.emotions}
            onChange={(items) => setValue({ emotions: items })}
            definitions={emotions}
          />
          {renderPauseAction(value)}
        </>
      )
    },
    {
      id: "script-move",
      eyebrow: "Meaning and action",
      title: "What did the moment start to mean, and what did you do?",
      description:
        "Separate the thought or meaning from the action, urge, avoidance, or check that followed.",
      render: (value, setValue) => (
        <>
          <ThoughtRowsEditor
            items={value.thoughts}
            onChange={(items) => setValue({ thoughts: items })}
            beliefs={beliefs}
            modes={modes}
          />
          <BehaviorRowsEditor
            items={value.behaviors}
            onChange={(items) => setValue({ behaviors: items })}
            behaviors={behaviors}
            modes={modes}
          />
          {renderPauseAction(value)}
        </>
      )
    },
    {
      id: "formulation",
      eyebrow: "Reflection and hypothesis",
      title: "What seems important about this episode?",
      description:
        "Record your own reflection first. A tentative interpretation is optional and must remain open to correction.",
      render: (value, setValue) => (
        <>
          <FlowField label="Your reflection">
            <Textarea
              value={value.reflection}
              onChange={(event) => setValue({ reflection: event.target.value })}
              placeholder="What feels most important, painful, protective, or revealing about this episode?"
            />
          </FlowField>
          <button
            type="button"
            role="switch"
            aria-checked={value.interpretationConsent}
            className="flex min-w-0 items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4 text-left"
            onClick={() =>
              setValue(
                !value.interpretationConsent
                  ? { interpretationConsent: true }
                  : {
                      interpretationConsent: false,
                      hypothesis: "",
                      hypothesisFit: "not_reviewed",
                      hypothesisCorrection: ""
                    }
              )
            }
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
                value.interpretationConsent
                  ? "justify-end bg-[var(--primary)]"
                  : "justify-start bg-[var(--ui-surface-3)]"
              }`}
            >
              <span className="size-5 rounded-full bg-[var(--ui-ink-strong)] shadow-sm" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-[var(--ui-ink-strong)]">
                Include a tentative interpretation
              </span>
              <span className="mt-1 block text-sm leading-6 text-[var(--ui-ink-soft)]">
                This is a discussable hypothesis, not a diagnosis or a fact.
              </span>
            </span>
          </button>
          {value.interpretationConsent ? (
            <>
              <FlowField
                label="Tentative hypothesis"
                description="Use language such as “one possibility is…” and keep it tied to this episode."
              >
                <Textarea
                  value={value.hypothesis}
                  onChange={(event) =>
                    setValue({ hypothesis: event.target.value })
                  }
                  placeholder="One possibility is that the silence felt like rejection, so withdrawal became a fast way to avoid more exposure."
                />
              </FlowField>
              {value.hypothesis.trim() ? (
                <div
                  className="grid gap-2"
                  role="group"
                  aria-labelledby="trigger-hypothesis-fit-label"
                >
                  <div
                    id="trigger-hypothesis-fit-label"
                    className="text-sm font-medium text-[var(--ui-ink-strong)]"
                  >
                    How well does that hypothesis fit?
                  </div>
                  <FlowChoiceGrid
                    value={value.hypothesisFit}
                    onChange={(hypothesisFit) =>
                      setValue({
                        hypothesisFit:
                          hypothesisFit as ReportDraft["hypothesisFit"]
                      })
                    }
                    options={[
                      { value: "fits", label: "It fits" },
                      { value: "partly_fits", label: "It partly fits" },
                      { value: "does_not_fit", label: "It does not fit" },
                      { value: "not_reviewed", label: "Not ready to judge" }
                    ]}
                  />
                </div>
              ) : null}
              {value.hypothesisFit === "partly_fits" ||
              value.hypothesisFit === "does_not_fit" ? (
                <FlowField label="Your correction">
                  <Textarea
                    value={value.hypothesisCorrection}
                    onChange={(event) =>
                      setValue({ hypothesisCorrection: event.target.value })
                    }
                    placeholder="What is missing, overstated, or different?"
                  />
                </FlowField>
              ) : null}
            </>
          ) : null}
          {renderPauseAction(value)}
        </>
      )
    },
    {
      id: "lens-state",
      eyebrow: "Lens and state",
      title: "What larger patterns or values does this connect to?",
      description:
        "Link only records that genuinely help explain or revisit this episode.",
      render: (value, setValue) => (
        <>
          {supportingCatalogsLoading ? (
            <div
              role="status"
              className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]"
            >
              Linked records are still loading. You can continue and add links
              when they are ready.
            </div>
          ) : supportingCatalogsError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-strong)]"
            >
              <span>
                Some linked records could not load. You can save this report now
                and add links later.
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void Promise.all(
                    supportingCatalogQueries.map((query) => query.refetch())
                  )
                }
              >
                Retry links
              </Button>
            </div>
          ) : null}
          <FlowField label="Linked patterns">
            <EntityLinkMultiSelect
              options={patternOptions}
              selectedValues={value.linkedPatternIds}
              onChange={(linkedPatternIds) => setValue({ linkedPatternIds })}
              placeholder="Search linked patterns…"
              emptyMessage="No patterns in scope yet."
            />
          </FlowField>
          <FlowField label="Linked values">
            <EntityLinkMultiSelect
              options={valueOptions}
              selectedValues={value.linkedValueIds}
              onChange={(linkedValueIds) => setValue({ linkedValueIds })}
              placeholder="Search or create a value…"
              emptyMessage="No values match yet."
              createLabel="Create value"
              onCreate={createLinkedValue}
            />
          </FlowField>
          <FlowField label="Linked behaviors">
            <EntityLinkMultiSelect
              options={behaviorOptions}
              selectedValues={value.linkedBehaviorIds}
              onChange={(linkedBehaviorIds) => setValue({ linkedBehaviorIds })}
              placeholder="Search or create a behavior…"
              emptyMessage="No behaviors match yet."
              createLabel="Create behavior"
              onCreate={createLinkedBehavior}
            />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Linked beliefs">
              <EntityLinkMultiSelect
                options={beliefOptions}
                selectedValues={value.linkedBeliefIds}
                onChange={(linkedBeliefIds) => setValue({ linkedBeliefIds })}
                placeholder="Search or create a belief…"
                emptyMessage="No beliefs match yet."
                createLabel="Create belief"
                onCreate={createLinkedBelief}
              />
            </FlowField>
            <FlowField label="Linked modes">
              <EntityLinkMultiSelect
                options={modeOptions}
                selectedValues={value.linkedModeIds}
                onChange={(linkedModeIds) => setValue({ linkedModeIds })}
                placeholder="Search or create a mode…"
                emptyMessage="No modes match yet."
                createLabel="Create mode"
                onCreate={createLinkedMode}
              />
            </FlowField>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {value.linkedGoalIds.length > 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]">
                Linked to {value.linkedGoalIds.length} goal tension
              </div>
            ) : null}
            {value.linkedProjectIds.length > 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]">
                Linked to {value.linkedProjectIds.length} project tension
              </div>
            ) : null}
            {value.linkedTaskIds.length > 0 ? (
              <div className="rounded-[18px] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]">
                Linked to {value.linkedTaskIds.length} task tension
              </div>
            ) : null}
          </div>
          {renderPauseAction(value)}
        </>
      )
    },
    {
      id: "horizon-pivot",
      eyebrow: "Horizon and pivot",
      title: "Record consequences, schema pressure, and the next move",
      description:
        "Use this step to record what happened next, which schemas were involved, and what you want to do after this moment.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <StringListEditor
              title="Short-term impact on you"
              description="Add the immediate effects on your body, mood, or direction."
              addLabel="Add self effect"
              items={value.selfShortTerm}
              onChange={(items) => setValue({ selfShortTerm: items })}
              placeholder="I shut down and lost the rest of the evening."
            />
            <StringListEditor
              title="Long-term impact on you"
              description="Capture what this pattern costs when it keeps repeating."
              addLabel="Add self cost"
              items={value.selfLongTerm}
              onChange={(items) => setValue({ selfLongTerm: items })}
              placeholder="It keeps reinforcing the same abandonment story."
            />
            <StringListEditor
              title="Short-term impact on others"
              description="Note what happened to the people around you right away."
              addLabel="Add other effect"
              items={value.othersShortTerm}
              onChange={(items) => setValue({ othersShortTerm: items })}
              placeholder="They felt pushed away and confused."
            />
            <StringListEditor
              title="Long-term impact on others"
              description="Capture the longer pattern this creates in relationships."
              addLabel="Add other cost"
              items={value.othersLongTerm}
              onChange={(items) => setValue({ othersLongTerm: items })}
              placeholder="Trust gets thinner every time this loop takes over."
            />
          </div>
          <div className="grid gap-4">
            <FlowField
              label="Schema links"
              description="Choose the schemas that were active or that you want to strengthen in this moment."
              labelHelp="Use maladaptive schemas for recurring old patterns that felt active here. Use adaptive schemas for healthier patterns you want to rely on more."
            >
              <div className="grid gap-4">
                {[
                  {
                    title: "Maladaptive schemas",
                    schemas: schemas.filter(
                      (schema) => schema.schemaType === "maladaptive"
                    ),
                    schemaType: "maladaptive" as const,
                    description:
                      "Recurring old patterns that felt active in this moment."
                  },
                  {
                    title: "Adaptive schemas",
                    schemas: schemas.filter(
                      (schema) => schema.schemaType === "adaptive"
                    ),
                    schemaType: "adaptive" as const,
                    description:
                      "Healthier stable themes you want this repair move to strengthen."
                  }
                ].map((group) => {
                  const visual = getSchemaVisual(group.schemaType);
                  return (
                    <div
                      key={group.schemaType}
                      className={`rounded-[24px] border p-4 ${visual.cardTone}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                          {group.title}
                        </div>
                        <InfoTooltip
                          content={getSchemaTypeHelpText(group.schemaType)}
                          label={`Explain ${getSchemaTypeLabel(group.schemaType)}`}
                        />
                      </div>
                      <FieldHint className="mt-2">
                        {group.description}
                      </FieldHint>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {group.schemas.map((schema) => {
                          const selected = value.schemaLinks.some(
                            (entry) =>
                              findSchemaForLink(entry, [schema])?.id ===
                              schema.id
                          );
                          return (
                            <button
                              key={schema.id}
                              type="button"
                              className={`rounded-full border px-3 py-2 text-sm transition ${selected ? `${visual.badgeTone} ring-1 ring-[color-mix(in_srgb,var(--primary)_28%,transparent)]` : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"}`}
                              onClick={() =>
                                setValue({
                                  schemaLinks: toggleSchemaSelection(
                                    value.schemaLinks,
                                    schema
                                  )
                                })
                              }
                            >
                              {schema.title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FlowField>
            <ModeTimelineEditor
              items={value.modeTimeline}
              onChange={(items) => setValue({ modeTimeline: items })}
              modes={modes}
              stages={[
                "Spark",
                "Wave",
                "Script",
                "Lens",
                "State",
                "Move",
                "Horizon",
                "Pivot"
              ]}
            />
            <StringListEditor
              title="Next moves"
              description="Finish with concrete next moves that protect the value or repair the situation."
              addLabel="Add next move"
              items={value.nextMoves}
              onChange={(items) => setValue({ nextMoves: items })}
              placeholder="Send one honest repair message tomorrow morning."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Review state">
                <select
                  className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
                  value={value.status}
                  onChange={(event) =>
                    setValue({
                      status: event.target.value as ReportDraft["status"]
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="integrated">Integrated</option>
                </select>
              </FlowField>
              <UserSelectField
                value={value.userId}
                users={shell.snapshot.users}
                onChange={(userId) => setValue({ userId })}
                defaultLabel={formatOwnerSelectDefaultLabel(
                  shell.snapshot.users.find(
                    (user) => user.id === defaultUserId
                  ) ?? null,
                  "Choose report owner"
                )}
                help="Ownership controls whose Psyche scope contains this report."
              />
            </div>
          </div>
        </>
      )
    }
  ];

  if (reportsQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Reports"
        title="Loading reports"
        description="Getting your trigger reports ready."
      />
    );
  }

  const routeError = reportsQuery.error;
  if (routeError) {
    return (
      <ErrorState
        eyebrow="Trigger reports"
        error={routeError}
        onRetry={() => void reportsQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="report"
        title={
          <EntityName
            kind="report"
            label="Reports"
            variant="heading"
            size="lg"
          />
        }
        description="Capture what happened, what you noticed, what followed, and what you may want to do next."
        badge={`${reportTotal} reports`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                vocabularyRequestKeyRef.current = createRequestKey();
                setVocabularyDraft(createPsycheVocabularyDraft(defaultUserId));
                setVocabularyError(null);
                setVocabularyOpen(true);
              }}
            >
              <Tags className="size-4" />
              Manage vocabulary
            </Button>
            <Button
              onClick={() => {
                createRequestKeyRef.current = createRequestKey();
                setDraft({ ...DEFAULT_REPORT_DRAFT, userId: defaultUserId });
                setDialogOpen(true);
              }}
            >
              Reflect
            </Button>
          </div>
        }
      />
      <PsycheSectionNav />

      <AtlasPanel
        eyebrow="Reports"
        title="Recent reports"
        description="Open any report to review what happened, which beliefs and schemas were involved, and what you want to do next."
        tone="violet"
      >
        <div className="grid gap-4">
          {reports.length === 0 ? (
            <EmptyState
              eyebrow="Trigger reports"
              title="No reports yet"
              description="Record an episode as clearly or partially as you remember it, then return to it when you are ready."
            />
          ) : (
            reports.map((report) => (
              <div
                key={report.id}
                className="min-w-0 max-w-full rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5 transition hover:bg-[var(--ui-surface-hover)]"
              >
                <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <EntityName
                      kind="report"
                      label={report.title}
                      variant="heading"
                      size="xl"
                      lines={2}
                      className="w-full"
                    />
                    <div className="mt-2 min-w-0 break-words text-sm text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
                      {report.customEventType || report.eventSituation}
                    </div>
                  </div>
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 md:justify-end">
                    {report.user ? (
                      <UserBadge user={report.user} compact />
                    ) : null}
                    <EntityNoteCountLink
                      entityType="trigger_report"
                      entityId={report.id}
                      count={
                        getEntityNotesSummary(
                          notesSummaryByEntity,
                          "trigger_report",
                          report.id
                        ).count
                      }
                    />
                    <Badge>{report.status}</Badge>
                    <Link
                      to={`/psyche/reports/${report.id}`}
                      className="inline-flex min-h-10 max-w-full items-center rounded-full bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
                    >
                      Open report
                    </Link>
                  </div>
                </div>
                <div className="mt-5 grid min-w-0 gap-3 xl:grid-cols-4">
                  <div className="min-w-0 rounded-[20px] bg-[var(--ui-surface-1)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Spark
                    </div>
                    <div className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                      {report.eventSituation}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[20px] bg-[var(--ui-success-soft)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Wave
                    </div>
                    <div className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                      {report.emotions[0]?.label ?? "No emotion captured yet"}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[20px] bg-[var(--ui-info-soft)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Lens
                    </div>
                    <div className="mt-3 min-w-0">
                      {report.schemaLinks[0] ? (
                        (() => {
                          const schema = findSchemaForLink(
                            report.schemaLinks[0],
                            schemas
                          );
                          return schema ? (
                            <SchemaBadge
                              label={schema.title}
                              schemaType={schema.schemaType}
                              compact
                            />
                          ) : (
                            <div className="break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                              {report.schemaLinks[0]}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                          No schema link yet
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-[20px] bg-[var(--ui-warning-soft)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                      Pivot
                    </div>
                    <div className="mt-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
                      {report.nextMoves[0] ?? "No next move yet"}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          {reportsQuery.hasNextPage ? (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="secondary"
                pending={reportsQuery.isFetchingNextPage}
                onClick={() => void reportsQuery.fetchNextPage()}
              >
                Load more reports
              </Button>
            </div>
          ) : null}
        </div>
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Trigger report"
        title="Build a reflective chain"
        description="Move from the concrete episode to body cues, thoughts, actions, reflection, links, and possible next moves."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel="Create report"
        pending={saveMutation.isPending}
        error={submitError}
        resolveContinueNudge={(stepId, value) => {
          if (stepId === "spark" && !value.eventSituation.trim()) {
            return "You can continue with an incomplete memory, or save this as a draft now.";
          }
          if (
            stepId === "formulation" &&
            !value.reflection.trim() &&
            !value.interpretationConsent
          ) {
            return "A reflection or interpretation is optional; the observed chain can stand on its own.";
          }
          return null;
        }}
        onSubmit={async () => {
          setSubmitError(null);
          if (!hasRecognizableReportSlice(draft)) {
            setSubmitError(
              "Add one part of the episode before creating the report, even if the memory is incomplete."
            );
            return;
          }
          try {
            toTriggerReportInput(draft);
            await saveMutation.mutateAsync(draft);
          } catch (error) {
            setSubmitError(
              error instanceof Error
                ? error.message
                : "Unable to create this report right now."
            );
          }
        }}
      />
      <PsycheVocabularyFlowDialog
        open={vocabularyOpen}
        onOpenChange={setVocabularyOpen}
        value={vocabularyDraft}
        onChange={setVocabularyDraft}
        eventTypes={eventTypes}
        emotions={emotions}
        users={shell.snapshot.users}
        loading={eventTypesQuery.isLoading || emotionsQuery.isLoading}
        loadError={eventTypesQuery.isError || emotionsQuery.isError}
        onRetry={() => {
          void Promise.all([
            eventTypesQuery.refetch(),
            emotionsQuery.refetch()
          ]);
        }}
        pending={vocabularyMutation.isPending}
        error={vocabularyError}
        onSubmit={async () => {
          setVocabularyError(null);
          try {
            await vocabularyMutation.mutateAsync(vocabularyDraft);
          } catch (error) {
            setVocabularyError(
              error instanceof Error
                ? error.message
                : "Unable to save this vocabulary change right now."
            );
          }
        }}
      />
    </div>
  );
}
