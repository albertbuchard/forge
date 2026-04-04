import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import { EntityLinkMultiSelect, type EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import {
  BehaviorRowsEditor,
  EmotionRowsEditor,
  ModeTimelineEditor,
  StringListEditor,
  ThoughtRowsEditor
} from "@/components/psyche/report-chain-fields";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { EntityName } from "@/components/ui/entity-name";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { prependEntityToCollection } from "@/lib/query-cache";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import {
  createBehavior,
  createBelief,
  createMode,
  createPsycheValue,
  createTriggerReport,
  listBeliefs,
  listBehaviors,
  listEmotionDefinitions,
  listEventTypes,
  listModes,
  listPsycheValues,
  listSchemaCatalog,
  listTriggerReports
} from "@/lib/api";
import { triggerReportSchema, type TriggerReportInput } from "@/lib/psyche-schemas";
import type { Behavior, BeliefEntry, ModeProfile, ModeTimelineEntry, PsycheValue, SchemaCatalogEntry, TriggerBehavior, TriggerEmotion, TriggerThought } from "@/lib/psyche-types";
import { findSchemaForLink, getSchemaTypeHelpText, getSchemaTypeLabel, getSchemaVisual, toggleSchemaSelection } from "@/lib/schema-visuals";
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
  emotions: TriggerEmotion[];
  thoughts: TriggerThought[];
  behaviors: TriggerBehavior[];
  selfShortTerm: string[];
  selfLongTerm: string[];
  othersShortTerm: string[];
  othersLongTerm: string[];
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
  userId: string | null;
};

const DEFAULT_REPORT_DRAFT: ReportDraft = {
  title: "",
  status: "draft",
  eventTypeId: "",
  customEventType: "",
  eventSituation: "",
  occurredAt: "",
  emotions: [],
  thoughts: [],
  behaviors: [],
  selfShortTerm: [],
  selfLongTerm: [],
  othersShortTerm: [],
  othersLongTerm: [],
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
  userId: null
};

export function PsycheReportsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ReportDraft>(DEFAULT_REPORT_DRAFT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const reportsQuery = useQuery({ queryKey: ["forge-psyche-reports"], queryFn: listTriggerReports });
  const valuesQuery = useQuery({ queryKey: ["forge-psyche-values"], queryFn: listPsycheValues });
  const behaviorsQuery = useQuery({ queryKey: ["forge-psyche-behaviors"], queryFn: listBehaviors });
  const beliefsQuery = useQuery({ queryKey: ["forge-psyche-beliefs"], queryFn: listBeliefs });
  const modesQuery = useQuery({ queryKey: ["forge-psyche-modes"], queryFn: listModes });
  const schemasQuery = useQuery({ queryKey: ["forge-psyche-schema-catalog"], queryFn: listSchemaCatalog });
  const eventTypesQuery = useQuery({ queryKey: ["forge-psyche-event-types"], queryFn: listEventTypes });
  const emotionsQuery = useQuery({ queryKey: ["forge-psyche-emotions"], queryFn: listEmotionDefinitions });

  const reports = reportsQuery.data?.reports ?? [];
  const values = valuesQuery.data?.values ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const eventTypes = eventTypesQuery.data?.eventTypes ?? [];
  const emotions = emotionsQuery.data?.emotions ?? [];
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const notesSummaryByEntity = shell.snapshot.dashboard.notesSummaryByEntity;

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setDraft({
        ...DEFAULT_REPORT_DRAFT,
        userId: defaultUserId,
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
        linkedValueIds: searchParams.get("valueId") ? [searchParams.get("valueId")!] : [],
        linkedBehaviorIds: searchParams.get("behaviorId") ? [searchParams.get("behaviorId")!] : [],
        linkedBeliefIds: searchParams.get("beliefId") ? [searchParams.get("beliefId")!] : [],
        linkedGoalIds: searchParams.get("goalId") ? [searchParams.get("goalId")!] : [],
        linkedProjectIds: searchParams.get("projectId") ? [searchParams.get("projectId")!] : [],
        linkedTaskIds: searchParams.get("taskId") ? [searchParams.get("taskId")!] : []
      });
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      next.delete("intent");
      next.delete("valueId");
      next.delete("behaviorId");
      next.delete("beliefId");
      next.delete("goalId");
      next.delete("projectId");
      next.delete("taskId");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (value: ReportDraft) => {
      const parsed = triggerReportSchema.parse({
        title: value.title,
        status: value.status,
        eventTypeId: value.eventTypeId || null,
        customEventType: value.customEventType,
        eventSituation: value.eventSituation,
        occurredAt: value.occurredAt ? new Date(value.occurredAt).toISOString() : null,
        emotions: value.emotions.filter((entry) => entry.label.trim().length > 0),
        thoughts: value.thoughts.filter((entry) => entry.text.trim().length > 0),
        behaviors: value.behaviors.filter((entry) => entry.text.trim().length > 0),
        consequences: {
          selfShortTerm: value.selfShortTerm,
          selfLongTerm: value.selfLongTerm,
          othersShortTerm: value.othersShortTerm,
          othersLongTerm: value.othersLongTerm
        },
        linkedPatternIds: [],
        linkedValueIds: value.linkedValueIds,
        linkedGoalIds: value.linkedGoalIds,
        linkedProjectIds: value.linkedProjectIds,
        linkedTaskIds: value.linkedTaskIds,
        linkedBehaviorIds: value.linkedBehaviorIds,
        linkedBeliefIds: value.linkedBeliefIds,
        linkedModeIds: value.linkedModeIds,
        modeOverlays: [],
        schemaLinks: value.schemaLinks.filter(Boolean),
        modeTimeline: value.modeTimeline.filter((entry) => entry.stage.trim().length > 0 && entry.label.trim().length > 0),
        nextMoves: value.nextMoves.filter(Boolean),
        userId: value.userId
      } satisfies TriggerReportInput);

      return createTriggerReport(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setDraft({ ...DEFAULT_REPORT_DRAFT, userId: defaultUserId });
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] })
      ]);
    }
  });

  const valueOptions: EntityLinkOption[] = values.map((entry: PsycheValue) => ({
    value: entry.id,
    label: formatOwnedEntityOptionLabel(entry.title, entry.user),
    description: formatOwnedEntityDescription(entry.valuedDirection, entry.user),
    searchText: buildOwnedEntitySearchText(
      [entry.title, entry.valuedDirection, entry.description],
      entry
    ),
    kind: "value"
  }));
  const behaviorOptions: EntityLinkOption[] = behaviors.map((behavior: Behavior) => ({
    value: behavior.id,
    label: formatOwnedEntityOptionLabel(behavior.title, behavior.user),
    description: formatOwnedEntityDescription(behavior.kind, behavior.user),
    searchText: buildOwnedEntitySearchText(
      [behavior.title, behavior.kind, behavior.description],
      behavior
    ),
    kind: "behavior"
  }));
  const beliefOptions: EntityLinkOption[] = beliefs.map((belief: BeliefEntry) => ({
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
  }));
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
    prependEntityToCollection(queryClient, ["forge-psyche-values"], "values", value);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return { value: value.id, label: value.title, description: value.valuedDirection, kind: "value" } satisfies EntityLinkOption;
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
    prependEntityToCollection(queryClient, ["forge-psyche-behaviors"], "behaviors", behavior);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return { value: behavior.id, label: behavior.title, description: behavior.kind, kind: "behavior" } satisfies EntityLinkOption;
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
    prependEntityToCollection(queryClient, ["forge-psyche-beliefs"], "beliefs", belief);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return { value: belief.id, label: belief.statement, description: belief.flexibleAlternative || belief.originNote, kind: "belief" } satisfies EntityLinkOption;
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
    prependEntityToCollection(queryClient, ["forge-psyche-modes"], "modes", mode);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return { value: mode.id, label: mode.title, description: mode.archetype || mode.family, kind: "mode" } satisfies EntityLinkOption;
  };

  const steps: Array<QuestionFlowStep<ReportDraft>> = [
    {
      id: "spark",
      eyebrow: "Spark",
      title: "Capture the trigger and the situation",
      description: "Start with what happened concretely before interpretation takes over.",
      render: (value, setValue) => (
        <>
          <UserSelectField
            value={value.userId}
            users={shell.snapshot.users}
            onChange={(userId) => setValue({ userId })}
            defaultLabel={formatOwnerSelectDefaultLabel(
              shell.snapshot.users.find((user) => user.id === defaultUserId) ??
                null,
              "Choose report owner"
            )}
            help="Trigger reports can belong to a human or bot user while still linking to shared values, behaviors, beliefs, and modes."
          />
          <FlowField label="Report title">
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Friday silence spiral" />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Event type">
              <select className="rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white" value={value.eventTypeId} onChange={(event) => setValue({ eventTypeId: event.target.value })}>
                <option value="">Custom or uncategorized</option>
                {eventTypes.map((eventType) => (
                  <option key={eventType.id} value={eventType.id}>
                    {eventType.label}
                  </option>
                ))}
              </select>
            </FlowField>
            <FlowField label="Occurred at">
              <Input type="datetime-local" value={value.occurredAt} onChange={(event) => setValue({ occurredAt: event.target.value })} />
            </FlowField>
          </div>
          <FlowField label="Custom event label">
            <Input value={value.customEventType} onChange={(event) => setValue({ customEventType: event.target.value })} placeholder="Unexpected distance after vulnerability" />
          </FlowField>
          <FlowField label="Situation">
            <Textarea value={value.eventSituation} onChange={(event) => setValue({ eventSituation: event.target.value })} placeholder="Describe what happened concretely, without explaining it away yet." />
          </FlowField>
        </>
      )
    },
    {
      id: "wave-script-move",
      eyebrow: "Wave, script, move",
      title: "Capture the emotional wave, thought script, and behavior",
      description: "These stay structured, but the flow keeps them staged instead of dumping everything into one giant form.",
      render: (value, setValue) => (
        <>
          <EmotionRowsEditor items={value.emotions} onChange={(items) => setValue({ emotions: items })} definitions={emotions} />
          <ThoughtRowsEditor items={value.thoughts} onChange={(items) => setValue({ thoughts: items })} beliefs={beliefs} modes={modes} />
          <BehaviorRowsEditor items={value.behaviors} onChange={(items) => setValue({ behaviors: items })} behaviors={behaviors} modes={modes} />
        </>
      )
    },
    {
      id: "lens-state",
      eyebrow: "Lens and state",
      title: "Link the report to beliefs, modes, values, and behavior history",
      description: "This is where the report becomes part of the larger graphical psyche system.",
      render: (value, setValue) => (
        <>
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
            {value.linkedGoalIds.length > 0 ? <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/62">Linked to {value.linkedGoalIds.length} goal tension</div> : null}
            {value.linkedProjectIds.length > 0 ? <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/62">Linked to {value.linkedProjectIds.length} project tension</div> : null}
            {value.linkedTaskIds.length > 0 ? <div className="rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white/62">Linked to {value.linkedTaskIds.length} task tension</div> : null}
          </div>
        </>
      )
    },
    {
      id: "horizon-pivot",
      eyebrow: "Horizon and pivot",
      title: "Record consequences, schema pressure, and the next move",
      description: "Use this step to record what happened next, which schemas were involved, and what you want to do after this moment.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <StringListEditor title="Short-term impact on you" description="Add the immediate effects on your body, mood, or direction." addLabel="Add self effect" items={value.selfShortTerm} onChange={(items) => setValue({ selfShortTerm: items })} placeholder="I shut down and lost the rest of the evening." />
            <StringListEditor title="Long-term impact on you" description="Capture what this pattern costs when it keeps repeating." addLabel="Add self cost" items={value.selfLongTerm} onChange={(items) => setValue({ selfLongTerm: items })} placeholder="It keeps reinforcing the same abandonment story." />
            <StringListEditor title="Short-term impact on others" description="Note what happened to the people around you right away." addLabel="Add other effect" items={value.othersShortTerm} onChange={(items) => setValue({ othersShortTerm: items })} placeholder="They felt pushed away and confused." />
            <StringListEditor title="Long-term impact on others" description="Capture the longer pattern this creates in relationships." addLabel="Add other cost" items={value.othersLongTerm} onChange={(items) => setValue({ othersLongTerm: items })} placeholder="Trust gets thinner every time this loop takes over." />
          </div>
          <div className="grid gap-4">
            <FlowField
              label="Schema links"
              description="Choose the schemas that were active or that you want to strengthen in this moment."
              labelHelp="Use maladaptive schemas for recurring old patterns that felt active here. Use adaptive schemas for healthier patterns you want to rely on more."
            >
              <div className="grid gap-4">
                {([
                  {
                    title: "Maladaptive schemas",
                    schemas: schemas.filter((schema) => schema.schemaType === "maladaptive"),
                    schemaType: "maladaptive" as const,
                    description: "Recurring old patterns that felt active in this moment."
                  },
                  {
                    title: "Adaptive schemas",
                    schemas: schemas.filter((schema) => schema.schemaType === "adaptive"),
                    schemaType: "adaptive" as const,
                    description: "Healthier stable themes you want this repair move to strengthen."
                  }
                ]).map((group) => {
                  const visual = getSchemaVisual(group.schemaType);
                  return (
                    <div key={group.schemaType} className={`rounded-[24px] border p-4 ${visual.cardTone}`}>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-white">{group.title}</div>
                        <InfoTooltip content={getSchemaTypeHelpText(group.schemaType)} label={`Explain ${getSchemaTypeLabel(group.schemaType)}`} />
                      </div>
                      <FieldHint className="mt-2">{group.description}</FieldHint>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {group.schemas.map((schema) => {
                          const selected = value.schemaLinks.some((entry) => findSchemaForLink(entry, [schema])?.id === schema.id);
                          return (
                            <button
                              key={schema.id}
                              type="button"
                              className={`rounded-full border px-3 py-2 text-sm transition ${selected ? `${visual.badgeTone} ring-1 ring-white/18` : "border-white/8 bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                              onClick={() => setValue({ schemaLinks: toggleSchemaSelection(value.schemaLinks, schema) })}
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
              stages={["Spark", "Wave", "Script", "Lens", "State", "Move", "Horizon", "Pivot"]}
            />
            <StringListEditor title="Next moves" description="Finish with concrete next moves that protect the value or repair the situation." addLabel="Add next move" items={value.nextMoves} onChange={(items) => setValue({ nextMoves: items })} placeholder="Send one honest repair message tomorrow morning." />
          </div>
        </>
      )
    }
  ];

  if (reportsQuery.isLoading || valuesQuery.isLoading || behaviorsQuery.isLoading || beliefsQuery.isLoading || modesQuery.isLoading || schemasQuery.isLoading || eventTypesQuery.isLoading || emotionsQuery.isLoading) {
    return <LoadingState eyebrow="Reports" title="Loading reports" description="Getting reports, values, behaviors, beliefs, modes, event labels, and emotions ready." />;
  }

  const routeError = reportsQuery.error ?? valuesQuery.error ?? behaviorsQuery.error ?? beliefsQuery.error ?? modesQuery.error ?? schemasQuery.error ?? eventTypesQuery.error ?? emotionsQuery.error;
  if (routeError) {
    return <ErrorState eyebrow="Trigger reports" error={routeError} onRetry={() => void Promise.all([reportsQuery.refetch(), valuesQuery.refetch(), behaviorsQuery.refetch(), beliefsQuery.refetch(), modesQuery.refetch(), schemasQuery.refetch(), eventTypesQuery.refetch(), emotionsQuery.refetch()])} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="report"
        title={<EntityName kind="report" label="Reports" variant="heading" size="lg" />}
        description="Capture the trigger, emotional wave, script, state, and next pivot in one guided reflective chain instead of a single massive worksheet."
        badge={`${reports.length} reports`}
        actions={
          <Button
            onClick={() => {
              setDraft({ ...DEFAULT_REPORT_DRAFT, userId: defaultUserId });
              setDialogOpen(true);
            }}
          >
            Reflect
          </Button>
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
              description="Start a first Spark-to-Pivot chain so Forge can track the full reflective arc instead of isolated notes."
            />
          ) : (
            reports.map((report) => (
              <div key={report.id} className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5 transition hover:bg-white/[0.07]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <EntityName kind="report" label={report.title} variant="heading" size="xl" />
                    <div className="mt-2 text-sm text-white/54">{report.customEventType || report.eventSituation}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {report.user ? <UserBadge user={report.user} compact /> : null}
                    <EntityNoteCountLink entityType="trigger_report" entityId={report.id} count={getEntityNotesSummary(notesSummaryByEntity, "trigger_report", report.id).count} />
                    <Badge>{report.status}</Badge>
                    <Link to={`/psyche/reports/${report.id}`} className="inline-flex min-h-10 items-center rounded-full bg-white/[0.08] px-3 py-2 text-sm text-white transition hover:bg-white/[0.12]">
                      Open report
                    </Link>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 xl:grid-cols-4">
                  <div className="rounded-[20px] bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Spark</div>
                    <div className="mt-3 text-sm leading-6 text-white/66">{report.eventSituation}</div>
                  </div>
                  <div className="rounded-[20px] bg-[rgba(110,231,183,0.08)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Wave</div>
                    <div className="mt-3 text-sm leading-6 text-white/66">{report.emotions[0]?.label ?? "No emotion captured yet"}</div>
                  </div>
                  <div className="rounded-[20px] bg-[rgba(196,181,253,0.08)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Lens</div>
                    <div className="mt-3">
                      {report.schemaLinks[0] ? (
                        (() => {
                          const schema = findSchemaForLink(report.schemaLinks[0], schemas);
                          return schema ? (
                            <SchemaBadge label={schema.title} schemaType={schema.schemaType} compact />
                          ) : (
                            <div className="text-sm leading-6 text-white/66">{report.schemaLinks[0]}</div>
                          );
                        })()
                      ) : (
                        <div className="text-sm leading-6 text-white/66">No schema link yet</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-[20px] bg-[rgba(251,191,36,0.08)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Pivot</div>
                    <div className="mt-3 text-sm leading-6 text-white/66">{report.nextMoves[0] ?? "No next move yet"}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Trigger report"
        title="Build a reflective chain"
        description="This guided flow replaces the old open worksheet with a staged Spark-to-Pivot capture."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel="Create report"
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = triggerReportSchema.safeParse({
            title: draft.title,
            status: draft.status,
            eventTypeId: draft.eventTypeId || null,
            customEventType: draft.customEventType,
            eventSituation: draft.eventSituation,
            occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : null,
            emotions: draft.emotions.filter((entry) => entry.label.trim().length > 0),
            thoughts: draft.thoughts.filter((entry) => entry.text.trim().length > 0),
            behaviors: draft.behaviors.filter((entry) => entry.text.trim().length > 0),
            consequences: {
              selfShortTerm: draft.selfShortTerm,
              selfLongTerm: draft.selfLongTerm,
              othersShortTerm: draft.othersShortTerm,
              othersLongTerm: draft.othersLongTerm
            },
            linkedPatternIds: [],
            linkedValueIds: draft.linkedValueIds,
            linkedGoalIds: draft.linkedGoalIds,
            linkedProjectIds: draft.linkedProjectIds,
            linkedTaskIds: draft.linkedTaskIds,
            linkedBehaviorIds: draft.linkedBehaviorIds,
            linkedBeliefIds: draft.linkedBeliefIds,
            linkedModeIds: draft.linkedModeIds,
            modeOverlays: [],
            schemaLinks: draft.schemaLinks.filter(Boolean),
            modeTimeline: draft.modeTimeline.filter((entry) => entry.stage.trim().length > 0 && entry.label.trim().length > 0),
            nextMoves: draft.nextMoves.filter(Boolean)
          } satisfies TriggerReportInput);

          if (!parsed.success) {
            setSubmitError("This report still needs a title and concrete triggering situation.");
            return;
          }

          try {
            await saveMutation.mutateAsync(draft);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to create this report right now.");
          }
        }}
      />
    </div>
  );
}
