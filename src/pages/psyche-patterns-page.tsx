import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import { EntityLinkMultiSelect, type EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import { OrbitMap } from "@/components/psyche/orbit-map";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import { psycheFocusClass, usePsycheFocusTarget } from "@/components/psyche/use-psyche-focus-target";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { prependEntityToCollection } from "@/lib/query-cache";
import { behaviorPatternSchema, type BehaviorPatternInput } from "@/lib/psyche-schemas";
import type { BehaviorPattern, BeliefEntry, ModeProfile, SchemaCatalogEntry } from "@/lib/psyche-types";
import { findSchemaForLink, getSchemaFamilyLabel } from "@/lib/schema-visuals";
import { createBehaviorPattern, createBelief, createMode, createPsycheValue, listBehaviorPatterns, listBehaviors, listBeliefs, listModes, listPsycheValues, listSchemaCatalog, patchBehaviorPattern } from "@/lib/api";

const DEFAULT_PATTERN_INPUT: BehaviorPatternInput = {
  title: "",
  description: "",
  targetBehavior: "",
  cueContexts: [],
  shortTermPayoff: "",
  longTermCost: "",
  preferredResponse: "",
  linkedValueIds: [],
  linkedSchemaLabels: [],
  linkedModeIds: [],
  linkedBeliefIds: []
};

function patternToInput(pattern: BehaviorPattern): BehaviorPatternInput {
  return {
    title: pattern.title,
    description: pattern.description,
    targetBehavior: pattern.targetBehavior,
    cueContexts: pattern.cueContexts,
    shortTermPayoff: pattern.shortTermPayoff,
    longTermCost: pattern.longTermCost,
    preferredResponse: pattern.preferredResponse,
    linkedValueIds: pattern.linkedValueIds,
    linkedSchemaLabels: pattern.linkedSchemaLabels,
    linkedModeIds: pattern.linkedModeIds,
    linkedBeliefIds: pattern.linkedBeliefIds
  };
}

export function PsychePatternsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<BehaviorPattern | null>(null);
  const [draft, setDraft] = useState<BehaviorPatternInput>(DEFAULT_PATTERN_INPUT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns"],
    queryFn: listBehaviorPatterns
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values"],
    queryFn: listPsycheValues
  });
  const schemasQuery = useQuery({
    queryKey: ["forge-psyche-schema-catalog"],
    queryFn: listSchemaCatalog
  });
  const modesQuery = useQuery({
    queryKey: ["forge-psyche-modes"],
    queryFn: listModes
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-psyche-beliefs"],
    queryFn: listBeliefs
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors"],
    queryFn: listBehaviors
  });

  const patterns = patternsQuery.data?.patterns ?? [];
  const values = valuesQuery.data?.values ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const beliefs = beliefsQuery.data?.beliefs ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const focusedPatternId = searchParams.get("focus");

  usePsycheFocusTarget(focusedPatternId);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setEditingPattern(null);
      setDraft(DEFAULT_PATTERN_INPUT);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: BehaviorPatternInput) => {
      const parsed = behaviorPatternSchema.parse(input);
      if (editingPattern) {
        return patchBehaviorPattern(editingPattern.id, parsed);
      }
      return createBehaviorPattern(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingPattern(null);
      setDraft(DEFAULT_PATTERN_INPUT);
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-patterns"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const valueOptions: EntityLinkOption[] = values.map((entry) => ({
    value: entry.id,
    label: entry.title,
    description: entry.valuedDirection,
    kind: "value"
  }));
  const schemaOptions: EntityLinkOption[] = schemas.map((schema: SchemaCatalogEntry) => ({
    value: schema.title,
    label: schema.title,
    description: `${schema.description} ${getSchemaFamilyLabel(schema.family)}`,
    searchText: `${schema.slug} ${schema.family} ${schema.schemaType}`,
    badge: <SchemaBadge label={schema.title} schemaType={schema.schemaType} compact />,
    menuBadge: <SchemaBadge label={schema.title} schemaType={schema.schemaType} compact />
  }));
  const modeOptions: EntityLinkOption[] = modes.map((mode: ModeProfile) => ({
    value: mode.id,
    label: mode.title,
    description: mode.archetype || mode.family,
    kind: "mode"
  }));
  const beliefOptions: EntityLinkOption[] = beliefs.map((belief: BeliefEntry) => ({
    value: belief.id,
    label: belief.statement,
    description: belief.flexibleAlternative || belief.originNote,
    kind: "belief"
  }));

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
      linkedValueIds: []
    });
    prependEntityToCollection(queryClient, ["forge-psyche-modes"], "modes", mode);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return {
      value: mode.id,
      label: mode.title,
      description: mode.archetype || mode.family,
      kind: "mode"
    } satisfies EntityLinkOption;
  };

  const createLinkedValue = async (title: string) => {
    const { value } = await createPsycheValue({
      title,
      description: "",
      valuedDirection: title,
      whyItMatters: "",
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      committedActions: []
    });
    prependEntityToCollection(queryClient, ["forge-psyche-values"], "values", value);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return {
      value: value.id,
      label: value.title,
      description: value.valuedDirection,
      kind: "value"
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
      linkedReportIds: []
    });
    prependEntityToCollection(queryClient, ["forge-psyche-beliefs"], "beliefs", belief);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return {
      value: belief.id,
      label: belief.statement,
      description: belief.flexibleAlternative || belief.originNote,
      kind: "belief"
    } satisfies EntityLinkOption;
  };

  const seedablePatterns = useMemo(
    () => patterns.filter((pattern) => !behaviors.some((behavior) => behavior.kind === "away" && behavior.linkedPatternIds.includes(pattern.id))),
    [patterns, behaviors]
  );

  const orbitNodes = patterns.slice(0, 5).map((pattern, index) => ({
    id: pattern.id,
    label: `${pattern.linkedValueIds.length} values`,
    title: pattern.title,
    detail: pattern.preferredResponse,
    href: `/psyche/patterns?focus=${pattern.id}#pattern-lanes`,
    angle: -92 + index * 70,
    radius: 150 + (index % 2) * 14,
    tone: (["rose", "sky", "violet", "mint"] as const)[index % 4]
  }));

  const steps: Array<QuestionFlowStep<BehaviorPatternInput>> = [
    {
      id: "loop",
      eyebrow: "Loop",
      title: "Name the pattern and the behavior it keeps producing",
      description: "This should feel like a recognizable loop, not a diagnostic label.",
      render: (value, setValue) => (
        <>
          <FlowField label="Pattern name" description="Give the loop a name you will recognize quickly later.">
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Anxious reassurance loop" />
          </FlowField>
          <FlowField label="What happens in the loop" description="Describe the actual sequence of behavior, not the diagnosis.">
            <Textarea value={value.targetBehavior} onChange={(event) => setValue({ targetBehavior: event.target.value })} placeholder="What do you actually do when the trigger hits?" />
          </FlowField>
          <FlowField label="Description" description="Write the loop in plain language so it stays usable in the future.">
            <Textarea value={value.description} onChange={(event) => setValue({ description: event.target.value })} placeholder="Describe the loop in plain human language so it stays recognizable later." />
          </FlowField>
        </>
      )
    },
    {
      id: "dynamics",
      eyebrow: "Dynamics",
      title: "Capture cues, payoff, cost, and the desired response",
      description: "The goal is to make the action map obvious at a glance.",
      render: (value, setValue) => (
        <>
          <FlowField label="Common cues" description="Add one cue per line so the trigger pattern stays easy to scan.">
            <Textarea
              value={value.cueContexts.join("\n")}
              onChange={(event) =>
                setValue({
                  cueContexts: event.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                })
              }
              placeholder={"One line per cue\nSilence after vulnerability\nLate-night social comparison"}
            />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Short-term payoff" description="What relief, certainty, control, or distance do you get right away?">
              <Textarea value={value.shortTermPayoff} onChange={(event) => setValue({ shortTermPayoff: event.target.value })} placeholder="What relief do you get right away?" />
            </FlowField>
            <FlowField label="Long-term cost" description="What does the loop cost you later in closeness, energy, values, or progress?">
              <Textarea value={value.longTermCost} onChange={(event) => setValue({ longTermCost: event.target.value })} placeholder="What does this cost over time?" />
            </FlowField>
          </div>
          <FlowField label="Preferred response" description="Name the return-path response you want to practice instead.">
            <Textarea value={value.preferredResponse} onChange={(event) => setValue({ preferredResponse: event.target.value })} placeholder="What do you want to practice instead?" />
          </FlowField>
        </>
      )
    },
    {
      id: "links",
      eyebrow: "Links",
      title: "Attach the loop to values, schemas, modes, and beliefs",
      description: "This is what turns a private note into a navigable graphical system.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked values" description="Choose the values this loop pulls against or tries to protect badly.">
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
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Schema labels" description="Attach the schema themes that define the pressure in this loop.">
              <EntityLinkMultiSelect
                options={schemaOptions}
                selectedValues={value.linkedSchemaLabels}
                onChange={(linkedSchemaLabels) => setValue({ linkedSchemaLabels })}
                placeholder="Search schema themes…"
                emptyMessage="No schema themes match."
              />
            </FlowField>
            <FlowField label="Linked modes" description="Search for an existing mode or press Enter to create and link one immediately.">
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
          <FlowField label="Linked beliefs" description="Search for a belief, or type a new one and press Enter to create it inline.">
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
        </>
      )
    }
  ];

  if (patternsQuery.isLoading || valuesQuery.isLoading || schemasQuery.isLoading || modesQuery.isLoading || beliefsQuery.isLoading || behaviorsQuery.isLoading) {
    return <LoadingState eyebrow="Patterns" title="Loading patterns" description="Getting patterns, values, schemas, beliefs, modes, and linked behaviors ready." />;
  }

  const routeError = patternsQuery.error ?? valuesQuery.error ?? schemasQuery.error ?? modesQuery.error ?? beliefsQuery.error ?? behaviorsQuery.error;
  if (routeError) {
    return <ErrorState eyebrow="Psyche patterns" error={routeError} onRetry={() => void Promise.all([patternsQuery.refetch(), valuesQuery.refetch(), schemasQuery.refetch(), modesQuery.refetch(), beliefsQuery.refetch(), behaviorsQuery.refetch()])} />;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="pattern"
        title={<EntityName kind="pattern" label="Patterns" variant="heading" size="lg" />}
        description="See each pattern as a loop: what starts it, what payoff it gives, what it costs, and what you want to do instead."
        badge={`${patterns.length} patterns`}
        actions={
          <Button
            onClick={() => {
              setEditingPattern(null);
              setDraft(DEFAULT_PATTERN_INPUT);
              setDialogOpen(true);
            }}
          >
            Add pattern
          </Button>
        }
      />
      <PsycheSectionNav />

      <OrbitMap
        title="See the loops that keep pulling against your values"
        description="This map shows which patterns are hot, what they are connected to, and which response wants to replace them."
        centerLabel="Pattern field"
        centerValue={`${patterns.length} tracked`}
        nodes={orbitNodes}
        action={<Button onClick={() => setDialogOpen(true)}>Add pattern</Button>}
      />

      {seedablePatterns.length > 0 ? (
        <AtlasPanel
          eyebrow="Seed behavior drafts"
          title="Some patterns still do not have an explicit away-move draft"
          description="These are the best candidates to push into the Behaviors page next."
          tone="rose"
        >
          <div className="flex flex-wrap gap-2">
            {seedablePatterns.slice(0, 8).map((pattern) => (
              <EntityBadge key={pattern.id} kind="pattern" label={pattern.title} compact />
            ))}
          </div>
        </AtlasPanel>
      ) : null}

      <AtlasPanel
        eyebrow="Pattern action map"
        title="Read each loop from cue to return path"
        description="Each lane turns a raw pattern into a visible behavior map: cues, short-term relief, long-term cost, and the move you actually want."
        tone="sky"
        className="scroll-mt-24"
      >
        <div id="pattern-lanes" className="grid gap-4">
          {patterns.length === 0 ? (
            <div className="flex justify-start">
              <Button onClick={() => setDialogOpen(true)}>Add pattern</Button>
            </div>
          ) : (
            patterns.map((pattern) => {
              const linkedValues = values.filter((value) => pattern.linkedValueIds.includes(value.id));
              const linkedModes = modes.filter((mode) => pattern.linkedModeIds.includes(mode.id));
              const linkedBeliefs = beliefs.filter((belief) => pattern.linkedBeliefIds.includes(belief.id));
              const isFocused = focusedPatternId === pattern.id;
              return (
                <div key={pattern.id} data-psyche-focus-id={pattern.id} className={`rounded-[28px] border border-white/8 bg-white/[0.04] p-5 transition ${psycheFocusClass(isFocused)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <EntityName kind="pattern" label={pattern.title} variant="heading" size="xl" />
                      <div className="mt-2 text-sm leading-7 text-white/58">{pattern.description}</div>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingPattern(pattern);
                        setDraft(patternToInput(pattern));
                        setDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                  <div className="mt-5 grid gap-3 xl:grid-cols-4">
                    <div className="rounded-[22px] bg-white/[0.04] p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Cue</div>
                      <div className="mt-3 text-sm leading-6 text-white/68">{pattern.cueContexts[0] ?? "No cue captured yet."}</div>
                    </div>
                    <div className="rounded-[22px] bg-[rgba(251,113,133,0.08)] p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Loop</div>
                      <div className="mt-3 text-sm leading-6 text-white/68">{pattern.targetBehavior}</div>
                    </div>
                    <div className="rounded-[22px] bg-[rgba(251,191,36,0.08)] p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Short-term relief / long-term cost</div>
                      <div className="mt-3 text-sm leading-6 text-white/68">{pattern.shortTermPayoff || "No payoff note yet."}</div>
                      <div className="mt-2 text-sm leading-6 text-white/52">{pattern.longTermCost || "No long-term cost note yet."}</div>
                    </div>
                    <div className="rounded-[22px] bg-[rgba(110,231,183,0.08)] p-4">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Return path</div>
                      <div className="mt-3 text-sm leading-6 text-white/68">{pattern.preferredResponse}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {linkedValues.map((value) => (
                      <EntityBadge key={value.id} kind="value" label={value.title} compact />
                    ))}
                    {linkedModes.map((mode) => (
                      <EntityBadge key={mode.id} kind="mode" label={mode.title} compact />
                    ))}
                    {pattern.linkedModeLabels.map((label) => (
                      <Badge key={`legacy-${label}`} className="text-violet-100">
                        {label}
                      </Badge>
                    ))}
                    {pattern.linkedSchemaLabels.map((label) => (
                      <SchemaBadge
                        key={label}
                        label={findSchemaForLink(label, schemas)?.title ?? label}
                        schemaType={findSchemaForLink(label, schemas)?.schemaType ?? "maladaptive"}
                        compact
                      />
                    ))}
                    {linkedBeliefs.map((belief) => (
                      <EntityBadge key={belief.id} kind="belief" label={belief.statement} compact />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Behavior pattern"
        title={editingPattern ? "Refine pattern lane" : "Create pattern"}
        description="Pattern capture should feel like mapping a loop, not filling an admin form."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel={editingPattern ? "Save pattern" : "Create pattern"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = behaviorPatternSchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError("This pattern still needs a title, a loop description, and a preferred response.");
            return;
          }

          try {
            await saveMutation.mutateAsync(parsed.data);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to save this pattern right now.");
          }
        }}
      />
    </div>
  );
}
