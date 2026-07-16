import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { ChainCanvas } from "@/components/psyche/chain-canvas";
import { InsightFlowDialog } from "@/components/insights/insight-flow-dialog";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { PlanningRecordDeleteDialog } from "@/components/planning/planning-record-delete-dialog";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import {
  BehaviorRowsEditor,
  EmotionRowsEditor,
  ModeTimelineEditor,
  StringListEditor,
  ThoughtRowsEditor
} from "@/components/psyche/report-chain-fields";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createInsight,
  deleteTriggerReport,
  getTriggerReport,
  listBehaviorPatterns,
  listBehaviors,
  listBeliefs,
  listEmotionDefinitions,
  listEventTypes,
  listSchemaCatalog,
  listModes,
  listPsycheValues,
  patchTriggerReport
} from "@/lib/api";
import { formatLines } from "@/lib/psyche-formats";
import { triggerReportSchema } from "@/lib/psyche-schemas";
import type {
  BehaviorPattern,
  ModeTimelineEntry,
  PsycheValue,
  TriggerBehavior,
  TriggerEmotion,
  TriggerReport,
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
  formatOwnedEntityOptionLabel
} from "@/lib/user-ownership";

export type ReportEditorShape = {
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
  modeOverlaysText: string;
  schemaLinks: string[];
  modeTimeline: ModeTimelineEntry[];
  nextMoves: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  memoryClarity: "unspecified" | "clear" | "partial" | "uncertain";
  reflection: string;
  hypothesis: string;
  hypothesisFit: "not_reviewed" | "fits" | "partly_fits" | "does_not_fit";
  hypothesisCorrection: string;
  interpretationConsent: boolean;
  revision: number;
};

function toggleId(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((entry) => entry !== id)
    : [...current, id];
}

export function formatTriggerReportDateTimeLocal(value: string) {
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

export function toTriggerReportEditor(
  report: TriggerReport
): ReportEditorShape {
  return {
    title: report.title,
    status: report.status,
    eventTypeId: report.eventTypeId ?? "",
    customEventType: report.customEventType,
    eventSituation: report.eventSituation,
    occurredAt: report.occurredAt
      ? formatTriggerReportDateTimeLocal(report.occurredAt)
      : "",
    bodyCues: report.bodyCues,
    emotions: report.emotions,
    thoughts: report.thoughts,
    behaviors: report.behaviors,
    selfShortTerm: report.consequences.selfShortTerm,
    selfLongTerm: report.consequences.selfLongTerm,
    othersShortTerm: report.consequences.othersShortTerm,
    othersLongTerm: report.consequences.othersLongTerm,
    modeOverlaysText: formatLines(report.modeOverlays),
    schemaLinks: report.schemaLinks,
    modeTimeline: report.modeTimeline,
    nextMoves: report.nextMoves,
    linkedBehaviorIds: report.linkedBehaviorIds,
    linkedBeliefIds: report.linkedBeliefIds,
    linkedModeIds: report.linkedModeIds,
    linkedPatternIds: report.linkedPatternIds,
    linkedValueIds: report.linkedValueIds,
    linkedGoalIds: report.linkedGoalIds,
    linkedProjectIds: report.linkedProjectIds,
    linkedTaskIds: report.linkedTaskIds,
    memoryClarity: report.memoryClarity,
    reflection: report.reflection,
    hypothesis: report.hypothesis,
    hypothesisFit: report.hypothesisFit,
    hypothesisCorrection: report.hypothesisCorrection,
    interpretationConsent: report.interpretationConsent,
    revision: report.revision
  };
}

function reportEditorFieldEquals(
  left: ReportEditorShape[keyof ReportEditorShape],
  right: ReportEditorShape[keyof ReportEditorShape]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isTriggerReportEditorDirty(
  draft: ReportEditorShape,
  baseline: ReportEditorShape
) {
  return (Object.keys(draft) as Array<keyof ReportEditorShape>).some(
    (key) => !reportEditorFieldEquals(draft[key], baseline[key])
  );
}

export function rebaseTriggerReportEditor(
  baseline: ReportEditorShape,
  localDraft: ReportEditorShape,
  latestReport: TriggerReport
) {
  const latestDraft = toTriggerReportEditor(latestReport);
  return Object.fromEntries(
    (Object.keys(latestDraft) as Array<keyof ReportEditorShape>).map((key) => [
      key,
      reportEditorFieldEquals(localDraft[key], baseline[key])
        ? latestDraft[key]
        : localDraft[key]
    ])
  ) as ReportEditorShape;
}

export function buildTriggerReportPatch(value: ReportEditorShape) {
  const payload = triggerReportSchema.parse({
    title: value.title,
    status: value.status,
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
    modeOverlays: value.modeOverlaysText
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean),
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
    interpretationConsent: value.interpretationConsent
  });
  return {
    ...payload,
    expectedRevision: value.revision
  };
}

export function PsycheReportDetailPage() {
  const shell = useForgeShell();
  const navigate = useNavigate();
  const { reportId } = useParams();
  const queryClient = useQueryClient();
  const [activeStage, setActiveStage] = useState("spark");
  const [draft, setDraft] = useState<ReportEditorShape | null>(null);
  const [baselineDraft, setBaselineDraft] = useState<ReportEditorShape | null>(
    null
  );
  const [pendingServerReport, setPendingServerReport] =
    useState<TriggerReport | null>(null);
  const [insightFlowOpen, setInsightFlowOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const loadedReportIdRef = useRef<string | null>(null);
  const reportQuery = useQuery({
    queryKey: ["forge-psyche-report", reportId],
    queryFn: () => getTriggerReport(reportId!),
    enabled: Boolean(reportId)
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns", ...shell.selectedUserIds],
    queryFn: () => listBehaviorPatterns(shell.selectedUserIds)
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values", ...shell.selectedUserIds],
    queryFn: () => listPsycheValues(shell.selectedUserIds)
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors", ...shell.selectedUserIds],
    queryFn: () => listBehaviors(shell.selectedUserIds)
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-psyche-beliefs", ...shell.selectedUserIds],
    queryFn: () => listBeliefs(shell.selectedUserIds)
  });
  const modesQuery = useQuery({
    queryKey: ["forge-psyche-modes", ...shell.selectedUserIds],
    queryFn: () => listModes(shell.selectedUserIds)
  });
  const schemasQuery = useQuery({
    queryKey: ["forge-psyche-schema-catalog"],
    queryFn: listSchemaCatalog
  });
  const eventTypesQuery = useQuery({
    queryKey: ["forge-psyche-event-types", ...shell.selectedUserIds],
    queryFn: () => listEventTypes(shell.selectedUserIds)
  });
  const emotionsQuery = useQuery({
    queryKey: ["forge-psyche-emotions", ...shell.selectedUserIds],
    queryFn: () => listEmotionDefinitions(shell.selectedUserIds)
  });

  useEffect(() => {
    const latestReport = reportQuery.data?.report;
    if (!latestReport) {
      return;
    }

    const latestDraft = toTriggerReportEditor(latestReport);
    if (
      loadedReportIdRef.current !== latestReport.id ||
      !draft ||
      !baselineDraft
    ) {
      loadedReportIdRef.current = latestReport.id;
      setDraft(latestDraft);
      setBaselineDraft(latestDraft);
      setPendingServerReport(null);
      return;
    }

    if (latestReport.revision <= baselineDraft.revision) {
      return;
    }

    if (!isTriggerReportEditorDirty(draft, baselineDraft)) {
      setDraft(latestDraft);
      setBaselineDraft(latestDraft);
      setPendingServerReport(null);
      return;
    }

    if (pendingServerReport?.revision !== latestReport.revision) {
      setPendingServerReport(latestReport);
    }
  }, [baselineDraft, draft, pendingServerReport?.revision, reportQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (value: ReportEditorShape) => {
      return patchTriggerReport(reportId!, buildTriggerReportPatch(value));
    },
    onSuccess: async ({ report: savedReport }) => {
      const savedDraft = toTriggerReportEditor(savedReport);
      setDraft(savedDraft);
      setBaselineDraft(savedDraft);
      setPendingServerReport(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-report", reportId]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] })
      ]);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTriggerReport(reportId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] })
      ]);
      navigate("/psyche/reports", { replace: true });
    }
  });

  const insightMutation = useMutation({
    mutationFn: createInsight,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-psyche-report", reportId]
      });
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const detailError = reportQuery.error ?? null;
  const supportingCatalogQueries = [
    patternsQuery,
    valuesQuery,
    behaviorsQuery,
    beliefsQuery,
    modesQuery,
    schemasQuery,
    eventTypesQuery,
    emotionsQuery
  ];
  const supportingCatalogsError = supportingCatalogQueries.some(
    (query) => query.isError
  );

  if (detailError) {
    return (
      <ErrorState
        eyebrow="Trigger report"
        error={detailError}
        onRetry={() => void reportQuery.refetch()}
      />
    );
  }

  if (reportQuery.isLoading || !draft || !baselineDraft) {
    return <SurfaceSkeleton />;
  }

  if (!reportQuery.data) {
    return (
      <ErrorState
        eyebrow="Trigger report"
        error={new Error("Forge returned an empty trigger report payload.")}
        onRetry={() => void reportQuery.refetch()}
      />
    );
  }

  const payload = reportQuery.data;
  const report = payload.report;
  const patterns = patternsQuery.data?.patterns ?? [];
  const values = valuesQuery.data?.values ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const eventTypes = eventTypesQuery.data?.eventTypes ?? [];
  const emotions = emotionsQuery.data?.emotions ?? [];
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
  const valueOptions: EntityLinkOption[] = values.map((value: PsycheValue) => ({
    value: value.id,
    label: formatOwnedEntityOptionLabel(value.title, value.user),
    description: formatOwnedEntityDescription(
      value.valuedDirection,
      value.user,
      "Value"
    ),
    searchText: buildOwnedEntitySearchText(
      [value.title, value.description, value.valuedDirection],
      value
    ),
    kind: "value"
  }));
  const goalOptions: EntityLinkOption[] = shell.snapshot.goals.map((goal) => ({
    value: goal.id,
    label: formatOwnedEntityOptionLabel(goal.title, goal.user),
    description: formatOwnedEntityDescription(
      goal.description,
      goal.user,
      "Goal"
    ),
    searchText: buildOwnedEntitySearchText(
      [goal.title, goal.description],
      goal
    ),
    kind: "goal"
  }));
  const projectOptions: EntityLinkOption[] = shell.snapshot.projects.map(
    (project) => ({
      value: project.id,
      label: formatOwnedEntityOptionLabel(project.title, project.user),
      description: formatOwnedEntityDescription(
        project.description,
        project.user,
        "Project"
      ),
      searchText: buildOwnedEntitySearchText(
        [project.title, project.description],
        project
      ),
      kind: "project"
    })
  );
  const taskOptions: EntityLinkOption[] = shell.snapshot.tasks.map((task) => ({
    value: task.id,
    label: formatOwnedEntityOptionLabel(task.title, task.user),
    description: formatOwnedEntityDescription(
      task.description,
      task.user,
      task.owner || "Task"
    ),
    searchText: buildOwnedEntitySearchText(
      [task.title, task.description, task.owner],
      task
    ),
    kind: "task"
  }));
  const stages = [
    { id: "spark", label: "Spark", summary: "What happened concretely?" },
    {
      id: "wave",
      label: "Wave",
      summary: "What emotional wave moved through you?"
    },
    {
      id: "script",
      label: "Script",
      summary: "What did the mind start saying?"
    },
    {
      id: "lens",
      label: "Lens",
      summary: "Which schemas and beliefs got activated?"
    },
    { id: "state", label: "State", summary: "Which modes took the wheel?" },
    { id: "move", label: "Move", summary: "What did you do or want to do?" },
    { id: "horizon", label: "Horizon", summary: "What were the consequences?" },
    { id: "pivot", label: "Pivot", summary: "What is the next move now?" }
  ];

  const stageContent = {
    spark: (
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
          <label className="grid gap-2">
            <span className="text-sm text-[var(--ui-ink-soft)]">Title</span>
            <Input
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--ui-ink-soft)]">Status</span>
            <select
              className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as ReportEditorShape["status"]
                })
              }
            >
              <option value="draft">draft</option>
              <option value="reviewed">reviewed</option>
              <option value="integrated">integrated</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm text-[var(--ui-ink-soft)]">
              Event type
            </span>
            <select
              className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
              value={draft.eventTypeId}
              onChange={(event) => {
                const eventTypeId = event.target.value;
                const previousDefinition = eventTypes.find(
                  (entry) => entry.id === draft.eventTypeId
                );
                const nextDefinition = eventTypes.find(
                  (entry) => entry.id === eventTypeId
                );
                const wordingFollowsPreset =
                  !draft.customEventType.trim() ||
                  draft.customEventType === previousDefinition?.label;
                setDraft({
                  ...draft,
                  eventTypeId,
                  customEventType:
                    wordingFollowsPreset && nextDefinition
                      ? nextDefinition.label
                      : draft.customEventType
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
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-[var(--ui-ink-soft)]">
              Occurred at
            </span>
            <Input
              type="datetime-local"
              value={draft.occurredAt}
              onChange={(event) =>
                setDraft({ ...draft, occurredAt: event.target.value })
              }
            />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ui-ink-soft)]">
            Custom event label
          </span>
          <Input
            value={draft.customEventType}
            onChange={(event) =>
              setDraft({ ...draft, customEventType: event.target.value })
            }
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ui-ink-soft)]">Situation</span>
          <Textarea
            value={draft.eventSituation}
            onChange={(event) =>
              setDraft({ ...draft, eventSituation: event.target.value })
            }
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ui-ink-soft)]">
            Memory clarity
          </span>
          <select
            className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
            value={draft.memoryClarity}
            onChange={(event) =>
              setDraft({
                ...draft,
                memoryClarity: event.target
                  .value as ReportEditorShape["memoryClarity"]
              })
            }
          >
            <option value="unspecified">Not recorded</option>
            <option value="clear">Clear</option>
            <option value="partial">Partial</option>
            <option value="uncertain">Uncertain</option>
          </select>
        </label>
      </div>
    ),
    wave: (
      <div className="grid gap-4">
        <StringListEditor
          title="Body cues"
          description="What sensations, impulses, posture, breathing, numbness, or shutdown did you notice?"
          addLabel="Add body cue"
          items={draft.bodyCues}
          onChange={(items) => setDraft({ ...draft, bodyCues: items })}
          placeholder="My chest tightened and I stopped breathing fully."
        />
        <EmotionRowsEditor
          items={draft.emotions}
          onChange={(items) => setDraft({ ...draft, emotions: items })}
          definitions={emotions}
        />
      </div>
    ),
    script: (
      <ThoughtRowsEditor
        items={draft.thoughts}
        onChange={(items) => setDraft({ ...draft, thoughts: items })}
        beliefs={beliefs}
        modes={modes}
      />
    ),
    lens: (
      <div className="grid gap-4">
        {supportingCatalogsError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-strong)]"
          >
            <span>
              Some linked records could not load. Your report is still
              available, and you can retry these choices separately.
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
        <div className="grid gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
          <div>
            <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
              Connected records
            </div>
            <FieldHint className="mt-1">
              Link only the patterns, values, goals, projects, or tasks that
              help explain or revisit this episode.
            </FieldHint>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <div className="text-sm text-[var(--ui-ink-soft)]">Patterns</div>
              <EntityLinkMultiSelect
                options={patternOptions}
                selectedValues={draft.linkedPatternIds}
                onChange={(linkedPatternIds) =>
                  setDraft({ ...draft, linkedPatternIds })
                }
                placeholder="Search linked patterns"
                emptyMessage="No patterns in scope yet."
              />
            </div>
            <div className="grid gap-2">
              <div className="text-sm text-[var(--ui-ink-soft)]">Values</div>
              <EntityLinkMultiSelect
                options={valueOptions}
                selectedValues={draft.linkedValueIds}
                onChange={(linkedValueIds) =>
                  setDraft({ ...draft, linkedValueIds })
                }
                placeholder="Search linked values"
                emptyMessage="No values in scope yet."
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <div className="text-sm text-[var(--ui-ink-soft)]">Goals</div>
              <EntityLinkMultiSelect
                options={goalOptions}
                selectedValues={draft.linkedGoalIds}
                onChange={(linkedGoalIds) =>
                  setDraft({ ...draft, linkedGoalIds })
                }
                placeholder="Search linked goals"
                emptyMessage="No goals in scope yet."
              />
            </div>
            <div className="grid gap-2">
              <div className="text-sm text-[var(--ui-ink-soft)]">Projects</div>
              <EntityLinkMultiSelect
                options={projectOptions}
                selectedValues={draft.linkedProjectIds}
                onChange={(linkedProjectIds) =>
                  setDraft({ ...draft, linkedProjectIds })
                }
                placeholder="Search linked projects"
                emptyMessage="No projects in scope yet."
              />
            </div>
            <div className="grid gap-2">
              <div className="text-sm text-[var(--ui-ink-soft)]">Tasks</div>
              <EntityLinkMultiSelect
                options={taskOptions}
                selectedValues={draft.linkedTaskIds}
                onChange={(linkedTaskIds) =>
                  setDraft({ ...draft, linkedTaskIds })
                }
                placeholder="Search linked tasks"
                emptyMessage="No tasks in scope yet."
              />
            </div>
          </div>
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
            Your reflection
          </span>
          <Textarea
            value={draft.reflection}
            onChange={(event) =>
              setDraft({ ...draft, reflection: event.target.value })
            }
            placeholder="What feels most important, painful, protective, or revealing about this episode?"
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={draft.interpretationConsent}
          className="flex min-w-0 items-start gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4 text-left"
          onClick={() =>
            setDraft(
              !draft.interpretationConsent
                ? { ...draft, interpretationConsent: true }
                : {
                    ...draft,
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
              draft.interpretationConsent
                ? "justify-end bg-[var(--primary)]"
                : "justify-start bg-[var(--ui-surface-3)]"
            }`}
          >
            <span className="size-5 rounded-full bg-white shadow-sm" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-[var(--ui-ink-strong)]">
              Include a tentative interpretation
            </span>
            <span className="mt-1 block text-sm leading-6 text-[var(--ui-ink-soft)]">
              Keep it discussable and open to correction.
            </span>
          </span>
        </button>
        {draft.interpretationConsent ? (
          <div className="grid gap-4 rounded-[20px] border border-[var(--ui-border-subtle)] p-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                Tentative hypothesis
              </span>
              <Textarea
                value={draft.hypothesis}
                onChange={(event) =>
                  setDraft({ ...draft, hypothesis: event.target.value })
                }
                placeholder="One possibility is that the silence felt like rejection, so withdrawal became a fast protection."
              />
            </label>
            {draft.hypothesis.trim() ? (
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">Fit</span>
                <select
                  className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
                  value={draft.hypothesisFit}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      hypothesisFit: event.target
                        .value as ReportEditorShape["hypothesisFit"]
                    })
                  }
                >
                  <option value="not_reviewed">Not ready to judge</option>
                  <option value="fits">It fits</option>
                  <option value="partly_fits">It partly fits</option>
                  <option value="does_not_fit">It does not fit</option>
                </select>
              </label>
            ) : null}
            {draft.hypothesisFit === "partly_fits" ||
            draft.hypothesisFit === "does_not_fit" ? (
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Your correction
                </span>
                <Textarea
                  value={draft.hypothesisCorrection}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      hypothesisCorrection: event.target.value
                    })
                  }
                  placeholder="What is missing, overstated, or different?"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
              Schema links
            </div>
            <InfoTooltip
              content="Use maladaptive schemas for recurring old patterns that were active here. Use adaptive schemas for healthier patterns you want this response to build on."
              label="Explain schema links"
            />
          </div>
          <FieldHint>
            Choose the schemas that were active here or that you want the repair
            move to strengthen.
          </FieldHint>
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
                "Healthier stable themes you want this chain to strengthen."
            }
          ].map((group) => {
            const visual = getSchemaVisual(group.schemaType);
            return (
              <div
                key={group.schemaType}
                className={`rounded-[22px] border p-4 ${visual.cardTone}`}
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
                <FieldHint className="mt-2">{group.description}</FieldHint>
                <div className="mt-4 flex flex-wrap gap-2">
                  {group.schemas.map((schema) => {
                    const selected = draft.schemaLinks.some(
                      (entry) =>
                        findSchemaForLink(entry, [schema])?.id === schema.id
                    );
                    return (
                      <button
                        key={schema.id}
                        type="button"
                        aria-pressed={selected}
                        className={`rounded-full border px-3 py-2 text-sm transition ${selected ? `${visual.badgeTone} ring-1 ring-[color-mix(in_srgb,var(--primary)_28%,transparent)]` : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            schemaLinks: toggleSchemaSelection(
                              draft.schemaLinks,
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
        <div>
          <div className="text-sm text-[var(--ui-ink-soft)]">
            Linked beliefs
          </div>
          <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
            {beliefs.map((belief) => {
              const selected = draft.linkedBeliefIds.includes(belief.id);
              return (
                <button
                  key={belief.id}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]" : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      linkedBeliefIds: toggleId(
                        draft.linkedBeliefIds,
                        belief.id
                      )
                    })
                  }
                >
                  {belief.statement}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ),
    state: (
      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ui-ink-soft)]">
            Mode overlays
          </span>
          <Textarea
            value={draft.modeOverlaysText}
            onChange={(event) =>
              setDraft({ ...draft, modeOverlaysText: event.target.value })
            }
          />
        </label>
        <ModeTimelineEditor
          items={draft.modeTimeline}
          onChange={(items) => setDraft({ ...draft, modeTimeline: items })}
          modes={modes}
          stages={stages.map((stage) => stage.label)}
        />
        <div>
          <div className="text-sm text-[var(--ui-ink-soft)]">Linked modes</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {modes.map((mode) => {
              const selected = draft.linkedModeIds.includes(mode.id);
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]" : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      linkedModeIds: toggleId(draft.linkedModeIds, mode.id)
                    })
                  }
                >
                  {mode.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ),
    move: (
      <div className="grid gap-4">
        <BehaviorRowsEditor
          items={draft.behaviors}
          onChange={(items) => setDraft({ ...draft, behaviors: items })}
          behaviors={behaviors}
          modes={modes}
        />
        <div>
          <div className="text-sm text-[var(--ui-ink-soft)]">
            Linked behaviors
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {behaviors.map((behavior) => {
              const selected = draft.linkedBehaviorIds.includes(behavior.id);
              return (
                <button
                  key={behavior.id}
                  type="button"
                  aria-pressed={selected}
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]" : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      linkedBehaviorIds: toggleId(
                        draft.linkedBehaviorIds,
                        behavior.id
                      )
                    })
                  }
                >
                  {behavior.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ),
    horizon: (
      <div className="grid gap-4 md:grid-cols-2">
        <StringListEditor
          title="Short-term impact on you"
          description="What happened to you right away?"
          addLabel="Add self effect"
          items={draft.selfShortTerm}
          onChange={(items) => setDraft({ ...draft, selfShortTerm: items })}
          placeholder="I shut down and lost the evening."
        />
        <StringListEditor
          title="Long-term impact on you"
          description="What does this cost if it keeps repeating?"
          addLabel="Add self cost"
          items={draft.selfLongTerm}
          onChange={(items) => setDraft({ ...draft, selfLongTerm: items })}
          placeholder="It keeps training the same abandonment script."
        />
        <StringListEditor
          title="Short-term impact on others"
          description="What happened to other people right away?"
          addLabel="Add other effect"
          items={draft.othersShortTerm}
          onChange={(items) => setDraft({ ...draft, othersShortTerm: items })}
          placeholder="They felt shut out."
        />
        <StringListEditor
          title="Long-term impact on others"
          description="What pattern does this create over time?"
          addLabel="Add other cost"
          items={draft.othersLongTerm}
          onChange={(items) => setDraft({ ...draft, othersLongTerm: items })}
          placeholder="Trust gets thinner each time."
        />
      </div>
    ),
    pivot: (
      <div className="grid gap-4">
        <StringListEditor
          title="What is the next move now?"
          description="Finish with concrete repairs, boundaries, or committed actions."
          addLabel="Add next move"
          items={draft.nextMoves}
          onChange={(items) => setDraft({ ...draft, nextMoves: items })}
          placeholder="Send one honest repair message tomorrow morning."
        />
        {saveMutation.error ? (
          <div
            role="alert"
            className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
          >
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Unable to save this report."}
          </div>
        ) : null}
        {saveMutation.isSuccess ? (
          <div
            role="status"
            className="rounded-[18px] border border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] px-4 py-3 text-sm text-[var(--ui-ink-strong)]"
          >
            Report saved.
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            pending={saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
          >
            Save chain
          </Button>
        </div>
      </div>
    )
  } as const;

  const inspector = (
    <>
      <div className="rounded-[22px] bg-[var(--ui-surface-1)] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Linked modes
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {modes
            .filter((mode) => draft.linkedModeIds.includes(mode.id))
            .map((mode) => (
              <EntityBadge
                key={mode.id}
                kind="mode"
                label={mode.title}
                compact
              />
            ))}
          {draft.linkedModeIds.length === 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveStage("state")}
            >
              Link mode
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-[22px] bg-[var(--ui-surface-1)] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Linked beliefs
        </div>
        <div className="mt-3 grid gap-2">
          {beliefs
            .filter((belief) => draft.linkedBeliefIds.includes(belief.id))
            .map((belief) => (
              <div
                key={belief.id}
                className="rounded-[16px] bg-[var(--ui-surface-1)] px-3 py-3"
              >
                <EntityBadge kind="belief" label={belief.statement} compact />
              </div>
            ))}
          {draft.linkedBeliefIds.length === 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveStage("lens")}
            >
              Link belief
            </Button>
          ) : null}
        </div>
      </div>
      <EntityNotesSurface
        entityType="trigger_report"
        entityId={report.id}
        anchorKey={activeStage}
        includeAnchorlessWhenAnchored
        compact
        title={`Stage notes on ${activeStage}`}
        description="Use anchored Markdown notes to capture what became clear at this stage of the chain."
        invalidateQueryKeys={[
          ["forge-psyche-report", reportId],
          ["forge-psyche-reports"],
          ["forge-psyche-overview"]
        ]}
      />
      <div className="rounded-[22px] bg-[var(--ui-surface-1)] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          Insights
        </div>
        <div className="mt-3 grid gap-2">
          {payload.insights.map((insight) => (
            <div
              key={insight.id}
              className="rounded-[16px] bg-[var(--ui-surface-1)] px-3 py-3 text-sm text-[var(--ui-ink-soft)]"
            >
              <div className="font-medium text-[var(--ui-ink-strong)]">
                {insight.title}
              </div>
              <div className="mt-2 text-[var(--ui-ink-soft)]">
                {insight.summary}
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            pending={insightMutation.isPending}
            onClick={() => setInsightFlowOpen(true)}
          >
            Store insight
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Trigger report"
        title={report.title}
        description="Move through Spark to Pivot in one chain canvas."
        badge={report.status}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OpenInGraphButton
              entityType="trigger_report"
              entityId={report.id}
            />
            <Button
              type="button"
              variant="ghost"
              className="text-[var(--danger)] hover:bg-[var(--ui-danger-soft)]"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete report
            </Button>
          </div>
        }
      />
      <PsycheSectionNav />

      {pendingServerReport ? (
        <div
          role="alert"
          className="grid gap-3 rounded-[24px] border border-[color-mix(in_srgb,var(--warning)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-warning-soft)] p-4 text-[var(--ui-ink-strong)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        >
          <div className="min-w-0">
            <div className="font-medium">A newer version is available</div>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Forge kept your unsaved edits. Reload the latest version, or keep
              your changed fields while bringing in newer untouched fields.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const latestDraft = toTriggerReportEditor(pendingServerReport);
                setDraft(latestDraft);
                setBaselineDraft(latestDraft);
                setPendingServerReport(null);
              }}
            >
              Reload latest
            </Button>
            <Button
              type="button"
              onClick={() => {
                const latestDraft = toTriggerReportEditor(pendingServerReport);
                setDraft(
                  rebaseTriggerReportEditor(
                    baselineDraft,
                    draft,
                    pendingServerReport
                  )
                );
                setBaselineDraft(latestDraft);
                setPendingServerReport(null);
              }}
            >
              Keep my edits
            </Button>
          </div>
        </div>
      ) : null}

      <ChainCanvas
        stages={stages}
        activeStageId={activeStage}
        onStageChange={setActiveStage}
        stageContent={stageContent[activeStage as keyof typeof stageContent]}
        inspector={inspector}
      />

      <InsightFlowDialog
        open={insightFlowOpen}
        onOpenChange={setInsightFlowOpen}
        eyebrow="Report insight"
        title="Store report insight"
        description="Capture the insight from this report as a guided recommendation instead of a raw side-panel form."
        submitLabel="Store insight"
        pending={insightMutation.isPending}
        lockedEntity={{
          entityType: "trigger_report",
          entityId: report.id,
          kind: "report",
          label: report.title,
          description: `Anchored to the ${activeStage} stage of this reflective chain.`
        }}
        initialValue={{
          originType: "user",
          originLabel: "Forge Psyche",
          timeframeLabel: "Current trigger report",
          rationale: `Captured from the ${activeStage} stage of the Psyche chain canvas.`
        }}
        onSubmit={async (value) => {
          await insightMutation.mutateAsync(value);
        }}
      />
      <PlanningRecordDeleteDialog
        open={deleteDialogOpen}
        recordKind="trigger report"
        recordTitle={report.title}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            deleteMutation.reset();
          }
        }}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </div>
  );
}
