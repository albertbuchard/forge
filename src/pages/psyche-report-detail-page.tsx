import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ChainCanvas } from "@/components/psyche/chain-canvas";
import { InsightFlowDialog } from "@/components/insights/insight-flow-dialog";
import { EntityNotesSurface } from "@/components/notes/entity-notes-surface";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import {
  BehaviorRowsEditor,
  EmotionRowsEditor,
  ModeTimelineEditor,
  StringListEditor,
  ThoughtRowsEditor
} from "@/components/psyche/report-chain-fields";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createInsight,
  getTriggerReport,
  listBehaviors,
  listBeliefs,
  listEmotionDefinitions,
  listEventTypes,
  listSchemaCatalog,
  listModes,
  patchTriggerReport
} from "@/lib/api";
import { formatLines } from "@/lib/psyche-formats";
import { triggerReportSchema } from "@/lib/psyche-schemas";
import type { ModeTimelineEntry, SchemaCatalogEntry, TriggerBehavior, TriggerEmotion, TriggerReport, TriggerThought } from "@/lib/psyche-types";
import { findSchemaForLink, getSchemaTypeHelpText, getSchemaTypeLabel, getSchemaVisual, toggleSchemaSelection } from "@/lib/schema-visuals";
import { formatDateTime } from "@/lib/utils";

type ReportEditorShape = {
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
  modeOverlaysText: string;
  schemaLinks: string[];
  modeTimeline: ModeTimelineEntry[];
  nextMoves: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
};

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}

function toEditor(report: TriggerReport): ReportEditorShape {
  return {
    title: report.title,
    status: report.status,
    eventTypeId: report.eventTypeId ?? "",
    customEventType: report.customEventType,
    eventSituation: report.eventSituation,
    occurredAt: report.occurredAt ? report.occurredAt.slice(0, 16) : "",
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
    linkedModeIds: report.linkedModeIds
  };
}

export function PsycheReportDetailPage() {
  const { reportId } = useParams();
  const queryClient = useQueryClient();
  const [activeStage, setActiveStage] = useState("spark");
  const [draft, setDraft] = useState<ReportEditorShape | null>(null);
  const [insightFlowOpen, setInsightFlowOpen] = useState(false);
  const reportQuery = useQuery({
    queryKey: ["forge-psyche-report", reportId],
    queryFn: () => getTriggerReport(reportId!),
    enabled: Boolean(reportId)
  });
  const behaviorsQuery = useQuery({ queryKey: ["forge-psyche-behaviors"], queryFn: listBehaviors });
  const beliefsQuery = useQuery({ queryKey: ["forge-psyche-beliefs"], queryFn: listBeliefs });
  const modesQuery = useQuery({ queryKey: ["forge-psyche-modes"], queryFn: listModes });
  const schemasQuery = useQuery({ queryKey: ["forge-psyche-schema-catalog"], queryFn: listSchemaCatalog });
  const eventTypesQuery = useQuery({ queryKey: ["forge-psyche-event-types"], queryFn: listEventTypes });
  const emotionsQuery = useQuery({ queryKey: ["forge-psyche-emotions"], queryFn: listEmotionDefinitions });

  useEffect(() => {
    if (reportQuery.data?.report) {
      setDraft(toEditor(reportQuery.data.report));
    }
  }, [reportQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (value: ReportEditorShape) => {
      const currentReport = reportQuery.data?.report;
      const payload = triggerReportSchema.parse({
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
        linkedPatternIds: currentReport?.linkedPatternIds ?? [],
        linkedValueIds: currentReport?.linkedValueIds ?? [],
        linkedGoalIds: currentReport?.linkedGoalIds ?? [],
        linkedProjectIds: currentReport?.linkedProjectIds ?? [],
        linkedTaskIds: currentReport?.linkedTaskIds ?? [],
        linkedBehaviorIds: value.linkedBehaviorIds,
        linkedBeliefIds: value.linkedBeliefIds,
        linkedModeIds: value.linkedModeIds,
        modeOverlays: value.modeOverlaysText
          .split("\n")
          .map((entry) => entry.trim())
          .filter(Boolean),
        schemaLinks: value.schemaLinks.filter(Boolean),
        modeTimeline: value.modeTimeline.filter((entry) => entry.stage.trim().length > 0 && entry.label.trim().length > 0),
        nextMoves: value.nextMoves.filter(Boolean)
      });
      return patchTriggerReport(reportId!, payload);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-report", reportId] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-reward-ledger"] })
      ]);
    }
  });

  const insightMutation = useMutation({
    mutationFn: createInsight,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-psyche-report", reportId] });
      await queryClient.invalidateQueries({ queryKey: ["forge-insights"] });
    }
  });

  const detailError = reportQuery.error ?? behaviorsQuery.error ?? beliefsQuery.error ?? modesQuery.error ?? schemasQuery.error ?? eventTypesQuery.error ?? emotionsQuery.error ?? null;

  if (reportQuery.isLoading || !draft) {
    return <SurfaceSkeleton />;
  }

  if (detailError) {
    return <ErrorState eyebrow="Trigger report" error={detailError} onRetry={() => void Promise.all([reportQuery.refetch(), behaviorsQuery.refetch(), beliefsQuery.refetch(), modesQuery.refetch(), schemasQuery.refetch(), eventTypesQuery.refetch(), emotionsQuery.refetch()])} />;
  }

  if (!reportQuery.data) {
    return <ErrorState eyebrow="Trigger report" error={new Error("Forge returned an empty trigger report payload.")} onRetry={() => void reportQuery.refetch()} />;
  }

  const payload = reportQuery.data;
  const report = payload.report;
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const eventTypes = eventTypesQuery.data?.eventTypes ?? [];
  const emotions = emotionsQuery.data?.emotions ?? [];
  const stages = [
    { id: "spark", label: "Spark", summary: "What happened concretely?" },
    { id: "wave", label: "Wave", summary: "What emotional wave moved through you?" },
    { id: "script", label: "Script", summary: "What did the mind start saying?" },
    { id: "lens", label: "Lens", summary: "Which schemas and beliefs got activated?" },
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
            <span className="text-sm text-white/58">Title</span>
            <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-white/58">Status</span>
            <select className="rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ReportEditorShape["status"] })}>
              <option value="draft">draft</option>
              <option value="reviewed">reviewed</option>
              <option value="integrated">integrated</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm text-white/58">Event type</span>
            <select className="rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-sm text-white" value={draft.eventTypeId} onChange={(event) => setDraft({ ...draft, eventTypeId: event.target.value })}>
              <option value="">Custom or uncategorized</option>
              {eventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>
                  {eventType.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-white/58">Occurred at</span>
            <Input type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="text-sm text-white/58">Custom event label</span>
          <Input value={draft.customEventType} onChange={(event) => setDraft({ ...draft, customEventType: event.target.value })} />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-white/58">Situation</span>
          <Textarea value={draft.eventSituation} onChange={(event) => setDraft({ ...draft, eventSituation: event.target.value })} />
        </label>
      </div>
    ),
    wave: (
      <EmotionRowsEditor items={draft.emotions} onChange={(items) => setDraft({ ...draft, emotions: items })} definitions={emotions} />
    ),
    script: (
      <ThoughtRowsEditor items={draft.thoughts} onChange={(items) => setDraft({ ...draft, thoughts: items })} beliefs={beliefs} modes={modes} />
    ),
    lens: (
      <div className="grid gap-4">
        <div className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-white">Schema links</div>
            <InfoTooltip content="Use maladaptive schemas for recurring old patterns that were active here. Use adaptive schemas for healthier patterns you want this response to build on." label="Explain schema links" />
          </div>
          <FieldHint>Choose the schemas that were active here or that you want the repair move to strengthen.</FieldHint>
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
              description: "Healthier stable themes you want this chain to strengthen."
            }
          ]).map((group) => {
            const visual = getSchemaVisual(group.schemaType);
            return (
              <div key={group.schemaType} className={`rounded-[22px] border p-4 ${visual.cardTone}`}>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-white">{group.title}</div>
                  <InfoTooltip content={getSchemaTypeHelpText(group.schemaType)} label={`Explain ${getSchemaTypeLabel(group.schemaType)}`} />
                </div>
                <FieldHint className="mt-2">{group.description}</FieldHint>
                <div className="mt-4 flex flex-wrap gap-2">
                  {group.schemas.map((schema) => {
                    const selected = draft.schemaLinks.some((entry) => findSchemaForLink(entry, [schema])?.id === schema.id);
                    return (
                      <button
                        key={schema.id}
                        type="button"
                        className={`rounded-full border px-3 py-2 text-sm transition ${selected ? `${visual.badgeTone} ring-1 ring-white/18` : "border-white/8 bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                        onClick={() => setDraft({ ...draft, schemaLinks: toggleSchemaSelection(draft.schemaLinks, schema) })}
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
          <div className="text-sm text-white/58">Linked beliefs</div>
          <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
            {beliefs.map((belief) => {
              const selected = draft.linkedBeliefIds.includes(belief.id);
              return (
                <button
                  key={belief.id}
                  type="button"
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[rgba(196,181,253,0.18)] text-violet-100" : "bg-white/[0.05] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                  onClick={() => setDraft({ ...draft, linkedBeliefIds: toggleId(draft.linkedBeliefIds, belief.id) })}
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
          <span className="text-sm text-white/58">Mode overlays</span>
          <Textarea value={draft.modeOverlaysText} onChange={(event) => setDraft({ ...draft, modeOverlaysText: event.target.value })} />
        </label>
        <ModeTimelineEditor
          items={draft.modeTimeline}
          onChange={(items) => setDraft({ ...draft, modeTimeline: items })}
          modes={modes}
          stages={stages.map((stage) => stage.label)}
        />
        <div>
          <div className="text-sm text-white/58">Linked modes</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {modes.map((mode) => {
              const selected = draft.linkedModeIds.includes(mode.id);
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[rgba(251,191,36,0.18)] text-amber-100" : "bg-white/[0.05] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                  onClick={() => setDraft({ ...draft, linkedModeIds: toggleId(draft.linkedModeIds, mode.id) })}
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
        <BehaviorRowsEditor items={draft.behaviors} onChange={(items) => setDraft({ ...draft, behaviors: items })} behaviors={behaviors} modes={modes} />
        <div>
          <div className="text-sm text-white/58">Linked behaviors</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {behaviors.map((behavior) => {
              const selected = draft.linkedBehaviorIds.includes(behavior.id);
              return (
                <button
                  key={behavior.id}
                  type="button"
                  className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-[rgba(251,113,133,0.16)] text-rose-100" : "bg-white/[0.05] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                  onClick={() => setDraft({ ...draft, linkedBehaviorIds: toggleId(draft.linkedBehaviorIds, behavior.id) })}
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
        <StringListEditor title="Short-term impact on you" description="What happened to you right away?" addLabel="Add self effect" items={draft.selfShortTerm} onChange={(items) => setDraft({ ...draft, selfShortTerm: items })} placeholder="I shut down and lost the evening." />
        <StringListEditor title="Long-term impact on you" description="What does this cost if it keeps repeating?" addLabel="Add self cost" items={draft.selfLongTerm} onChange={(items) => setDraft({ ...draft, selfLongTerm: items })} placeholder="It keeps training the same abandonment script." />
        <StringListEditor title="Short-term impact on others" description="What happened to other people right away?" addLabel="Add other effect" items={draft.othersShortTerm} onChange={(items) => setDraft({ ...draft, othersShortTerm: items })} placeholder="They felt shut out." />
        <StringListEditor title="Long-term impact on others" description="What pattern does this create over time?" addLabel="Add other cost" items={draft.othersLongTerm} onChange={(items) => setDraft({ ...draft, othersLongTerm: items })} placeholder="Trust gets thinner each time." />
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
        <div className="flex justify-end">
          <Button pending={saveMutation.isPending} onClick={() => void saveMutation.mutateAsync(draft)}>
            Save chain
          </Button>
        </div>
      </div>
    )
  } as const;

  const inspector = (
    <>
      <div className="rounded-[22px] bg-white/[0.04] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Linked modes</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {modes.filter((mode) => draft.linkedModeIds.includes(mode.id)).map((mode) => (
            <EntityBadge key={mode.id} kind="mode" label={mode.title} compact />
          ))}
          {draft.linkedModeIds.length === 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setActiveStage("state")}>
              Link mode
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-[22px] bg-white/[0.04] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Linked beliefs</div>
        <div className="mt-3 grid gap-2">
          {beliefs.filter((belief) => draft.linkedBeliefIds.includes(belief.id)).map((belief) => (
            <div key={belief.id} className="rounded-[16px] bg-white/[0.04] px-3 py-3">
              <EntityBadge kind="belief" label={belief.statement} compact />
            </div>
          ))}
          {draft.linkedBeliefIds.length === 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setActiveStage("lens")}>
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
        invalidateQueryKeys={[["forge-psyche-report", reportId], ["forge-psyche-reports"], ["forge-psyche-overview"]]}
      />
      <div className="rounded-[22px] bg-white/[0.04] p-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Insights</div>
        <div className="mt-3 grid gap-2">
          {payload.insights.map((insight) => (
            <div key={insight.id} className="rounded-[16px] bg-white/[0.04] px-3 py-3 text-sm text-white/72">
              <div className="font-medium text-white">{insight.title}</div>
              <div className="mt-2 text-white/62">{insight.summary}</div>
            </div>
          ))}
          <Button variant="secondary" pending={insightMutation.isPending} onClick={() => setInsightFlowOpen(true)}>
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
      />
      <PsycheSectionNav />

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
    </div>
  );
}
