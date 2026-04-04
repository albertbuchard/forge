import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import { FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import { EntityLinkMultiSelect, type EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { psycheFocusClass, usePsycheFocusTarget } from "@/components/psyche/use-psyche-focus-target";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { prependEntityToCollection } from "@/lib/query-cache";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import { beliefEntrySchema, type BeliefEntryInput } from "@/lib/psyche-schemas";
import type { Behavior, BeliefEntry, ModeProfile, PsycheValue, SchemaCatalogEntry, TriggerReport } from "@/lib/psyche-types";
import { findSchemaForLink, getSchemaFamilyLabel, getSchemaTypeHelpText, getSchemaTypeLabel, getSchemaVisual } from "@/lib/schema-visuals";
import { createBehavior, createBelief, createMode, createPsycheValue, createTriggerReport, listBehaviors, listBeliefs, listModes, listPsycheValues, listSchemaCatalog, listTriggerReports, patchBelief } from "@/lib/api";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnerSelectDefaultLabel,
  formatOwnedEntityOptionLabel,
  getSingleSelectedUserId
} from "@/lib/user-ownership";

const DEFAULT_BELIEF_INPUT: BeliefEntryInput = {
  schemaId: null,
  statement: "",
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
  userId: null
};

function beliefToInput(belief: BeliefEntry): BeliefEntryInput {
  return {
    schemaId: belief.schemaId,
    statement: belief.statement,
    beliefType: belief.beliefType,
    originNote: belief.originNote,
    confidence: belief.confidence,
    evidenceFor: belief.evidenceFor,
    evidenceAgainst: belief.evidenceAgainst,
    flexibleAlternative: belief.flexibleAlternative,
    linkedValueIds: belief.linkedValueIds,
    linkedBehaviorIds: belief.linkedBehaviorIds,
    linkedModeIds: belief.linkedModeIds,
    linkedReportIds: belief.linkedReportIds,
    userId: belief.userId ?? null
  };
}

function countSchemaLinks({
  schema,
  beliefs,
  behaviors,
  reports
}: {
  schema: SchemaCatalogEntry;
  beliefs: BeliefEntry[];
  behaviors: Behavior[];
  reports: TriggerReport[];
}) {
  const beliefCount = beliefs.filter((belief) => belief.schemaId === schema.id).length;
  const behaviorCount = behaviors.filter((behavior) => behavior.linkedSchemaIds.includes(schema.id)).length;
  const reportCount = reports.filter((report) => report.schemaLinks.some((entry) => {
    const linkedSchema = findSchemaForLink(entry, [schema]);
    return linkedSchema?.id === schema.id;
  })).length;
  return {
    beliefCount,
    behaviorCount,
    reportCount,
    total: beliefCount + behaviorCount + reportCount
  };
}

function SchemaSection({
  title,
  description,
  titleHelp,
  schemas,
  beliefs,
  behaviors,
  reports,
  onOpenBelief
}: {
  title: string;
  description: string;
  titleHelp?: string;
  schemas: SchemaCatalogEntry[];
  beliefs: BeliefEntry[];
  behaviors: Behavior[];
  reports: TriggerReport[];
  onOpenBelief: (belief: BeliefEntry) => void;
}) {
  if (schemas.length === 0) {
    return null;
  }

  const visual = getSchemaVisual(schemas[0].schemaType);

  return (
    <section className={`min-w-0 grid gap-4 rounded-[30px] border p-4 md:p-5 ${visual.sectionTone}`}>
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="grid min-w-0 gap-2">
          <div className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] ${visual.sectionEyebrow}`}>
            <span>{title}</span>
            {titleHelp ? <InfoTooltip content={titleHelp} label={`Explain ${title.toLowerCase()}`} /> : null}
          </div>
          <div className="max-w-3xl text-sm leading-6 text-white/60">{description}</div>
        </div>
        <Badge>{schemas.length} schemas</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {schemas.map((schema) => {
          const stats = countSchemaLinks({ schema, beliefs, behaviors, reports });
          const schemaBeliefs = beliefs.filter((belief) => belief.schemaId === schema.id);
          const schemaVisual = getSchemaVisual(schema.schemaType);

          return (
            <div key={schema.id} className={`min-w-0 rounded-[26px] border p-5 ${schemaVisual.cardTone}`}>
              <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
                <div className="min-w-0">
                  <SchemaBadge label={schema.title} schemaType={schema.schemaType} />
                  <div className="mt-3 text-sm text-white/46">{getSchemaFamilyLabel(schema.family)}</div>
                  <div className="mt-2 text-sm leading-6 text-white/62">{schema.description}</div>
                </div>
                <Badge>{stats.total} {schemaVisual.countLabel}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.06] text-white/68">{stats.beliefCount} beliefs</Badge>
                <Badge className="bg-white/[0.06] text-white/68">{stats.behaviorCount} behaviors</Badge>
                <Badge className="bg-white/[0.06] text-white/68">{stats.reportCount} reports</Badge>
              </div>
              <div className="mt-4 grid gap-3">
                {schemaBeliefs.length > 0 ? (
                  <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/58">
                    {`${schemaBeliefs.length} ${schemaVisual.linkSummary}${schemaBeliefs.length === 1 ? "" : "s"} live here.`}
                  </div>
                ) : (
                  <div className="rounded-[18px] bg-white/[0.03] p-4 text-sm leading-6 text-white/46">{schemaVisual.emptyCopy}</div>
                )}
                {schemaBeliefs.slice(0, 2).map((belief) => (
                  <button
                    key={belief.id}
                    type="button"
                    className="rounded-[20px] bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.08]"
                    onClick={() => onOpenBelief(belief)}
                  >
                    <div className="font-medium text-white">{belief.statement}</div>
                    <div className="mt-2 text-sm leading-6 text-white/60">{belief.flexibleAlternative || "No flexible alternative recorded yet."}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PsycheSchemasBeliefsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBelief, setEditingBelief] = useState<BeliefEntry | null>(null);
  const [draft, setDraft] = useState<BeliefEntryInput>(DEFAULT_BELIEF_INPUT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schemasQuery = useQuery({ queryKey: ["forge-psyche-schema-catalog"], queryFn: listSchemaCatalog });
  const beliefsQuery = useQuery({ queryKey: ["forge-psyche-beliefs"], queryFn: listBeliefs });
  const behaviorsQuery = useQuery({ queryKey: ["forge-psyche-behaviors"], queryFn: listBehaviors });
  const modesQuery = useQuery({ queryKey: ["forge-psyche-modes"], queryFn: listModes });
  const valuesQuery = useQuery({ queryKey: ["forge-psyche-values"], queryFn: listPsycheValues });
  const reportsQuery = useQuery({ queryKey: ["forge-psyche-reports"], queryFn: listTriggerReports });

  const schemas = schemasQuery.data?.schemas ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const values = valuesQuery.data?.values ?? [];
  const reports = reportsQuery.data?.reports ?? [];
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const focusedBeliefId = searchParams.get("focus");
  const notesSummaryByEntity = shell.snapshot.dashboard.notesSummaryByEntity;

  usePsycheFocusTarget(focusedBeliefId);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setEditingBelief(null);
      setDraft({ ...DEFAULT_BELIEF_INPUT, userId: defaultUserId });
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [defaultUserId, searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: BeliefEntryInput) => {
      const parsed = beliefEntrySchema.parse(input);
      if (editingBelief) {
        return patchBelief(editingBelief.id, parsed);
      }
      return createBelief(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingBelief(null);
      setDraft({ ...DEFAULT_BELIEF_INPUT, userId: defaultUserId });
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-beliefs"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
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
  const reportOptions: EntityLinkOption[] = reports.map((report: TriggerReport) => ({
    value: report.id,
    label: formatOwnedEntityOptionLabel(report.title, report.user),
    description: formatOwnedEntityDescription(
      report.customEventType || report.eventSituation,
      report.user
    ),
    searchText: buildOwnedEntitySearchText(
      [report.title, report.customEventType, report.eventSituation],
      report
    ),
    kind: "report"
  }));
  const schemaMap = useMemo(() => new Map(schemas.map((schema) => [schema.id, schema])), [schemas]);
  const maladaptiveSchemas = useMemo(() => schemas.filter((schema) => schema.schemaType === "maladaptive"), [schemas]);
  const adaptiveSchemas = useMemo(() => schemas.filter((schema) => schema.schemaType === "adaptive"), [schemas]);

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

  const createLinkedReport = async (title: string) => {
    const { report } = await createTriggerReport({
      title,
      status: "draft",
      eventTypeId: null,
      customEventType: "",
      eventSituation: title,
      occurredAt: null,
      emotions: [],
      thoughts: [],
      behaviors: [],
      consequences: {
        selfShortTerm: [],
        selfLongTerm: [],
        othersShortTerm: [],
        othersLongTerm: []
      },
      linkedPatternIds: [],
      linkedValueIds: [],
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      linkedBehaviorIds: [],
      linkedBeliefIds: [],
      linkedModeIds: [],
      modeOverlays: [],
      schemaLinks: [],
      modeTimeline: [],
      nextMoves: [],
      userId: draft.userId
    });
    prependEntityToCollection(queryClient, ["forge-psyche-reports"], "reports", report);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return { value: report.id, label: report.title, description: report.customEventType || report.eventSituation, kind: "report" } satisfies EntityLinkOption;
  };

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    setSubmitError(null);
  }, [dialogOpen]);

  const steps: Array<QuestionFlowStep<BeliefEntryInput>> = [
    {
      id: "lens",
      eyebrow: "Lens",
      title: "Choose the schema and belief script",
      description: "Place the belief inside the right schema system, then write the actual inner line that tends to fire there.",
      render: (value, setValue) => (
        <>
          <UserSelectField
            value={value.userId ?? null}
            users={shell.snapshot.users}
            onChange={(userId) => setValue({ userId })}
            defaultLabel={formatOwnerSelectDefaultLabel(
              shell.snapshot.users.find((user) => user.id === defaultUserId) ??
                null,
              "Choose belief owner"
            )}
            help="Beliefs can belong to a human or bot user even when they connect to shared behaviors, modes, and reports."
          />
          <FlowField
            label="Schema"
            description="Choose the schema this belief belongs to, whether it is a recurring old pattern or a healthier pattern you want to strengthen."
            labelHelp="Schemas are the broader repeating themes. Beliefs are the personal scripts that fire inside those themes."
          >
            <div className="grid gap-4">
              {([
                {
                  title: "Maladaptive schemas",
                  schemas: maladaptiveSchemas,
                  description: "Recurring old patterns that tend to get activated and distort how the situation feels.",
                  schemaType: "maladaptive" as const
                },
                {
                  title: "Adaptive schemas",
                  schemas: adaptiveSchemas,
                  description: "Healthier stable themes you want to strengthen, trust, and live from more often.",
                  schemaType: "adaptive" as const
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
                    <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                      {group.schemas.map((schema) => {
                        const selected = value.schemaId === schema.id;
                        return (
                          <button
                            key={schema.id}
                            type="button"
                            className={`w-full rounded-[18px] border px-3 py-2 text-left text-sm leading-5 transition sm:w-auto sm:rounded-full ${selected ? `${visual.badgeTone} ring-1 ring-white/18` : "border-white/8 bg-white/[0.04] text-white/58 hover:bg-white/[0.08] hover:text-white"}`}
                            onClick={() => setValue({ schemaId: schema.id })}
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
          <FlowField
            label="Belief statement"
            description="Write the sentence the mind tends to say in the moment."
            labelHelp="A belief script should sound like the actual inner line that shows up under pressure, not a formal summary."
          >
            <Input value={value.statement} onChange={(event) => setValue({ statement: event.target.value })} placeholder="If they go quiet, I am already being left." />
          </FlowField>
          <FlowField
            label="Belief type"
            description="Choose whether the script sounds absolute or conditional."
            labelHelp="Absolute beliefs sound fixed and global. Conditional beliefs sound more like if-then rules about safety, worth, or closeness."
          >
            <div className="grid gap-3 md:grid-cols-2">
              {(["absolute", "conditional"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${value.beliefType === kind ? "border-white/20 bg-white/[0.12] text-white" : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.07]"}`}
                  onClick={() => setValue({ beliefType: kind })}
                >
                  {kind === "absolute" ? "Absolute: this is simply true" : "Conditional: if this happens, then..."}
                </button>
              ))}
            </div>
          </FlowField>
        </>
      )
    },
    {
      id: "origin",
      eyebrow: "Origin",
      title: "Capture the origin and confidence of the script",
      description: "This keeps the belief from turning into a generic note divorced from actual history.",
      render: (value, setValue) => (
        <>
          <FlowField label="Origin context" description="Capture where this script learned its force or usefulness.">
            <Textarea value={value.originNote} onChange={(event) => setValue({ originNote: event.target.value })} placeholder="It got stronger in periods where silence usually meant anger, distance, or punishment." />
          </FlowField>
          <FlowField
            label="Grip right now"
            description="How strongly does this belief feel true when it gets activated?"
            labelHelp="Grip is the felt strength of the script in the moment, not whether it is objectively true."
          >
            <input type="range" min={0} max={100} value={value.confidence} onChange={(event) => setValue({ confidence: Number(event.target.value) })} />
            <div className="text-sm text-white/48">{value.confidence}% grip</div>
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Evidence for" description="Add one supporting memory, sign, or interpretation per line.">
              <Textarea
                value={value.evidenceFor.join("\n")}
                onChange={(event) =>
                  setValue({
                    evidenceFor: event.target.value
                      .split("\n")
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  })
                }
                placeholder={"One line per sign\nThey stopped replying for days\nI was ignored when I asked directly"}
              />
            </FlowField>
            <FlowField label="Evidence against" description="Add one counterexample, nuance, or disconfirming sign per line.">
              <Textarea
                value={value.evidenceAgainst.join("\n")}
                onChange={(event) =>
                  setValue({
                    evidenceAgainst: event.target.value
                      .split("\n")
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  })
                }
                placeholder={"One line per counterpoint\nThey later explained they were overwhelmed\nOther people stay close without constant contact"}
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "repair",
      eyebrow: "Repair",
      title: "Define the flexible alternative and attach the wider system",
      description: "The flexible alternative is the repair move; the links keep it attached to behaviors, values, modes, and reports.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Flexible alternative"
            description="Write the steadier line you want available when the old script activates."
            labelHelp="A flexible alternative is not fake positivity. It is a truer, more workable belief that leaves room for uncertainty."
          >
            <Textarea value={value.flexibleAlternative} onChange={(event) => setValue({ flexibleAlternative: event.target.value })} placeholder="Silence can mean many things. I can check the facts before deciding I am being left." />
          </FlowField>
          <FlowField label="Linked values" description="Choose the valued directions this belief interferes with most.">
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
          <div className="grid gap-4 md:grid-cols-3">
            <FlowField label="Linked behaviors" description="Choose the moves this belief tends to trigger or justify.">
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
            <FlowField label="Linked modes" description="Choose the inner states that most often carry this script.">
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
            <FlowField label="Linked reports" description="Choose the reflective chains where this script has already shown up.">
              <EntityLinkMultiSelect
                options={reportOptions}
                selectedValues={value.linkedReportIds}
                onChange={(linkedReportIds) => setValue({ linkedReportIds })}
                placeholder="Search or create a report…"
                emptyMessage="No reports match yet."
                createLabel="Create report"
                onCreate={createLinkedReport}
              />
            </FlowField>
          </div>
        </>
      )
    }
  ];

  if (schemasQuery.isLoading || beliefsQuery.isLoading || behaviorsQuery.isLoading || modesQuery.isLoading || valuesQuery.isLoading || reportsQuery.isLoading) {
    return <LoadingState eyebrow="Schemas & beliefs" title="Loading schemas and beliefs" description="Getting schemas, beliefs, behaviors, modes, values, and linked reports ready." />;
  }

  const routeError = schemasQuery.error ?? beliefsQuery.error ?? behaviorsQuery.error ?? modesQuery.error ?? valuesQuery.error ?? reportsQuery.error;
  if (routeError) {
    return <ErrorState eyebrow="Schemas & beliefs" error={routeError} onRetry={() => void Promise.all([schemasQuery.refetch(), beliefsQuery.refetch(), behaviorsQuery.refetch(), modesQuery.refetch(), valuesQuery.refetch(), reportsQuery.refetch()])} />;
  }

  return (
    <div className="grid min-w-0 gap-5">
      <PageHero
        title="Schemas & Beliefs"
        description="Review your schemas and beliefs together. See which beliefs are tied to each schema, then open any belief to edit it in context."
        badge={`${beliefs.length} beliefs`}
        actions={
          <Button
            onClick={() => {
              setEditingBelief(null);
              setDraft({ ...DEFAULT_BELIEF_INPUT, userId: defaultUserId });
              setDialogOpen(true);
            }}
          >
            Add belief
          </Button>
        }
      />
      <PsycheSectionNav />

      <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <AtlasPanel
          eyebrow="Schemas"
          title="Schemas"
          description="Use these groups to notice recurring old patterns and to reinforce healthier patterns you want to rely on more often."
          titleHelp="Schemas are broad recurring patterns that shape how situations feel and how you respond. Use them to organize beliefs, behaviors, and reports around patterns that repeat."
          tone="violet"
        >
          {schemas.length === 0 ? (
            <div className="text-sm text-white/56">Schema data is unavailable right now.</div>
          ) : (
            <div className="grid gap-5">
              <SchemaSection
                title="Maladaptive schemas"
                titleHelp={getSchemaTypeHelpText("maladaptive")}
                description="These schemas describe recurring old patterns that can change how you read situations and react."
                schemas={maladaptiveSchemas}
                beliefs={beliefs}
                behaviors={behaviors}
                reports={reports}
                onOpenBelief={(belief) => {
                  setEditingBelief(belief);
                  setDraft(beliefToInput(belief));
                  setDialogOpen(true);
                }}
              />
              <SchemaSection
                title="Adaptive schemas"
                titleHelp={getSchemaTypeHelpText("adaptive")}
                description="These schemas describe healthier patterns you want to trust, practice, and strengthen over time."
                schemas={adaptiveSchemas}
                beliefs={beliefs}
                behaviors={behaviors}
                reports={reports}
                onOpenBelief={(belief) => {
                  setEditingBelief(belief);
                  setDraft(beliefToInput(belief));
                  setDialogOpen(true);
                }}
              />
            </div>
          )}
        </AtlasPanel>

        <AtlasPanel
          eyebrow="Beliefs"
          title="Beliefs"
          description="Use this list to review and edit the stories you tell yourself. Open any belief to update the wording, evidence, or a more flexible alternative."
          titleHelp="Beliefs are the specific scripts or rules that show up in your mind, such as what you expect from yourself, from other people, or from a situation."
          tone="sky"
        >
          <div className="grid gap-3">
            <Button
              onClick={() => {
                setEditingBelief(null);
                setDraft({ ...DEFAULT_BELIEF_INPUT, userId: defaultUserId });
                setDialogOpen(true);
              }}
            >
              Add belief
            </Button>
            {beliefs.length === 0 ? (
              <div className="text-sm text-white/56">Your beliefs will appear here after you add the first one.</div>
            ) : (
              beliefs.map((belief) => {
                const schema = belief.schemaId ? (schemaMap.get(belief.schemaId) ?? null) : null;
                const isFocused = focusedBeliefId === belief.id;
                return (
                  <div
                    key={belief.id}
                    data-psyche-focus-id={belief.id}
                    className={`rounded-[24px] border border-white/8 bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.08] ${psycheFocusClass(isFocused)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-white">{belief.statement}</div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {belief.user ? <UserBadge user={belief.user} compact /> : null}
                        <EntityNoteCountLink entityType="belief_entry" entityId={belief.id} count={getEntityNotesSummary(notesSummaryByEntity, "belief_entry", belief.id).count} />
                        <Badge>{belief.confidence}% grip</Badge>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingBelief(belief);
                            setDraft(beliefToInput(belief));
                            setDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/58">{belief.flexibleAlternative || "No flexible alternative recorded yet."}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {schema ? <SchemaBadge label={schema.title} schemaType={schema.schemaType} compact showType /> : null}
                      {modes.filter((mode) => belief.linkedModeIds.includes(mode.id)).slice(0, 2).map((mode) => (
                        <EntityBadge key={mode.id} kind="mode" label={mode.title} compact />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </AtlasPanel>
      </section>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Belief"
        title={editingBelief ? "Refine belief" : "Create belief"}
        description="Use this guided flow to capture the belief, what seems to support it, and a more flexible alternative."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel={editingBelief ? "Save belief" : "Create belief"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = beliefEntrySchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError("This belief still needs a statement before it can be saved.");
            return;
          }

          try {
            await saveMutation.mutateAsync(parsed.data);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to save this belief right now.");
          }
        }}
      />
    </div>
  );
}
