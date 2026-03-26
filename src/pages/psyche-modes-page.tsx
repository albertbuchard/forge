import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import { EntityLinkMultiSelect, type EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import { ModeChip } from "@/components/psyche/mode-chip";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { prependEntityToCollection } from "@/lib/query-cache";
import { modeProfileSchema, type ModeProfileInput } from "@/lib/psyche-schemas";
import type { Behavior, BehaviorPattern, ModeProfile, PsycheValue } from "@/lib/psyche-types";
import { createBehavior, createBehaviorPattern, createMode, createPsycheValue, listBehaviors, listBehaviorPatterns, listModes, listPsycheValues, patchMode } from "@/lib/api";

const DEFAULT_MODE_INPUT: ModeProfileInput = {
  family: "coping",
  archetype: "",
  title: "",
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
};

function modeToInput(mode: ModeProfile): ModeProfileInput {
  return {
    family: mode.family,
    archetype: mode.archetype,
    title: mode.title,
    persona: mode.persona,
    imagery: mode.imagery,
    symbolicForm: mode.symbolicForm,
    facialExpression: mode.facialExpression,
    fear: mode.fear,
    burden: mode.burden,
    protectiveJob: mode.protectiveJob,
    originContext: mode.originContext,
    firstAppearanceAt: mode.firstAppearanceAt,
    linkedPatternIds: mode.linkedPatternIds,
    linkedBehaviorIds: mode.linkedBehaviorIds,
    linkedValueIds: mode.linkedValueIds
  };
}

const familyLabelMap: Record<ModeProfile["family"], string> = {
  coping: "Coping",
  child: "Child",
  critic_parent: "Critic / parent",
  healthy_adult: "Healthy adult",
  happy_child: "Happy child"
};

export function PsycheModesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<ModeProfile | null>(null);
  const [draft, setDraft] = useState<ModeProfileInput>(DEFAULT_MODE_INPUT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const modesQuery = useQuery({ queryKey: ["forge-psyche-modes"], queryFn: listModes });
  const patternsQuery = useQuery({ queryKey: ["forge-psyche-patterns"], queryFn: listBehaviorPatterns });
  const behaviorsQuery = useQuery({ queryKey: ["forge-psyche-behaviors"], queryFn: listBehaviors });
  const valuesQuery = useQuery({ queryKey: ["forge-psyche-values"], queryFn: listPsycheValues });

  const modes = modesQuery.data?.modes ?? [];
  const patterns = patternsQuery.data?.patterns ?? [];
  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const values = valuesQuery.data?.values ?? [];

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setEditingMode(null);
      setDraft(DEFAULT_MODE_INPUT);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: ModeProfileInput) => {
      const parsed = modeProfileSchema.parse(input);
      if (editingMode) {
        return patchMode(editingMode.id, parsed);
      }
      return createMode(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingMode(null);
      setDraft(DEFAULT_MODE_INPUT);
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-modes"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const patternOptions: EntityLinkOption[] = patterns.map((pattern: BehaviorPattern) => ({
    value: pattern.id,
    label: pattern.title,
    description: pattern.preferredResponse || pattern.targetBehavior,
    kind: "pattern"
  }));
  const behaviorOptions: EntityLinkOption[] = behaviors.map((behavior: Behavior) => ({
    value: behavior.id,
    label: behavior.title,
    description: behavior.kind,
    kind: "behavior"
  }));
  const valueOptions: EntityLinkOption[] = values.map((entry: PsycheValue) => ({
    value: entry.id,
    label: entry.title,
    description: entry.valuedDirection,
    kind: "value"
  }));

  const createLinkedPattern = async (title: string) => {
    const { pattern } = await createBehaviorPattern({
      title,
      description: "",
      targetBehavior: title,
      cueContexts: [],
      shortTermPayoff: "",
      longTermCost: "",
      preferredResponse: "",
      linkedValueIds: [],
      linkedSchemaLabels: [],
      linkedModeIds: [],
      linkedBeliefIds: []
    });
    prependEntityToCollection(queryClient, ["forge-psyche-patterns"], "patterns", pattern);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return {
      value: pattern.id,
      label: pattern.title,
      description: pattern.preferredResponse || pattern.targetBehavior,
      kind: "pattern"
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
      linkedModeIds: []
    });
    prependEntityToCollection(queryClient, ["forge-psyche-behaviors"], "behaviors", behavior);
    await queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] });
    return {
      value: behavior.id,
      label: behavior.title,
      description: behavior.kind,
      kind: "behavior"
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

  const steps: Array<QuestionFlowStep<ModeProfileInput>> = [
    {
      id: "identity",
      eyebrow: "Identity",
      title: "Name the cast member and place it in the right family",
      description: "Start with the mode itself: who it feels like, what family it belongs to, and the recognizable role it plays.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Mode family"
            description="Choose the broader inner family this mode belongs to."
            labelHelp="A mode family is the bigger cluster this state belongs to, like a coping part, a vulnerable child state, or a healthy adult response."
          >
            <div className="grid gap-3 md:grid-cols-3">
              {(["coping", "child", "critic_parent", "healthy_adult", "happy_child"] as const).map((family) => (
                <button
                  key={family}
                  type="button"
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${value.family === family ? "border-white/20 bg-white/[0.12] text-white" : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.07]"}`}
                  onClick={() => setValue({ family })}
                >
                  {familyLabelMap[family]}
                </button>
              ))}
            </div>
          </FlowField>
          <FlowField
            label="Mode name"
            description="Give it a memorable name you would instantly recognize later."
            labelHelp="This is the user-facing name of the mode. It should read like a cast member title, not a clinical record."
          >
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="The Friday Vigil, The Scanner, The Good Son" />
          </FlowField>
          <FlowField
            label="Archetype"
            description="Name the recognizable inner role or pattern this mode most resembles."
            labelHelp="An archetype is the role this mode tends to play, like a protector, a critic, a frightened child, or a calm adult anchor."
          >
            <Input value={value.archetype} onChange={(event) => setValue({ archetype: event.target.value })} placeholder="Detached protector, vulnerable child, demanding critic" />
          </FlowField>
        </>
      )
    },
    {
      id: "texture",
      eyebrow: "Texture",
      title: "Give the mode a recognizable presence",
      description: "Imagery, facial expression, and persona should make the mode instantly memorable.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label="Persona"
              description="Describe how this mode sounds, moves, and carries itself."
              labelHelp="Persona is the tone, posture, and voice of the mode. Imagine how it enters the room and how it speaks."
            >
              <Textarea value={value.persona} onChange={(event) => setValue({ persona: event.target.value })} placeholder="Quiet, hyper-alert, always scanning for threat and trying to stay one step ahead." />
            </FlowField>
            <FlowField
              label="Imagery"
              description="Capture the mental image or scene that helps this mode feel vivid."
              labelHelp="Imagery is the picture that makes the mode easy to remember, like a scene, posture, weather pattern, or atmosphere."
            >
              <Textarea value={value.imagery} onChange={(event) => setValue({ imagery: event.target.value })} placeholder="A night watchman under cold fluorescent light, pacing and checking every door twice." />
            </FlowField>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label="Symbolic form"
              description="Pick the object, creature, or shape that best symbolizes this mode."
              labelHelp="Symbolic form is the metaphor for the mode, like armor, a fox, a storm front, or a glass wall."
            >
              <Input value={value.symbolicForm} onChange={(event) => setValue({ symbolicForm: event.target.value })} placeholder="A locked visor, a fox, a steel shield" />
            </FlowField>
            <FlowField
              label="Facial expression"
              description="Describe what you would see on the mode's face if it took over."
              labelHelp="This is the visible emotional expression of the mode: tight jaw, blank stare, pleading eyes, or calm grounded attention."
            >
              <Input value={value.facialExpression} onChange={(event) => setValue({ facialExpression: event.target.value })} placeholder="Tight jaw, narrowed eyes, forced calm" />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "burden",
      eyebrow: "Burden",
      title: "Map fear, burden, job, and origin",
      description: "This is what turns a named mode into a readable inner-state profile.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <FlowField
              label="Fear"
              description="Name the threat this mode is trying hard to prevent."
              labelHelp="Fear is the danger the mode believes it must protect you from, such as rejection, shame, collapse, failure, or being trapped."
            >
              <Textarea value={value.fear} onChange={(event) => setValue({ fear: event.target.value })} placeholder="If I relax, I will miss the threat and get hurt." />
            </FlowField>
            <FlowField
              label="Burden"
              description="Describe the emotional weight or exhausting role this mode keeps carrying."
              labelHelp="Burden is the heavy job or emotional load the mode feels stuck holding, even when it costs a lot."
            >
              <Textarea value={value.burden} onChange={(event) => setValue({ burden: event.target.value })} placeholder="It believes it must never let the guard down, even when that means constant tension." />
            </FlowField>
            <FlowField
              label="Protective job"
              description="Describe the job this mode thinks it is performing for you."
              labelHelp="Protective job is the function the mode is trying to serve, like preventing rejection, keeping control, stopping humiliation, or preserving closeness."
            >
              <Textarea value={value.protectiveJob} onChange={(event) => setValue({ protectiveJob: event.target.value })} placeholder="Keeps me prepared so I never get blindsided or look naive." />
            </FlowField>
          </div>
          <FlowField
            label="Origin context"
            description="Describe when this mode first became useful or understandable."
            labelHelp="Origin context is the stretch of life where this mode likely learned its job or became especially necessary."
          >
            <Textarea value={value.originContext} onChange={(event) => setValue({ originContext: event.target.value })} placeholder="Started getting stronger during adolescence when mistakes were met with criticism and unpredictability." />
          </FlowField>
        </>
      )
    },
    {
      id: "links",
      eyebrow: "Links",
      title: "Attach the mode to the rest of the psyche system",
      description: "Modes should connect to patterns, behaviors, and values, not sit in isolation.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked patterns" description="Choose the loops this mode tends to activate or maintain.">
            <EntityLinkMultiSelect
              options={patternOptions}
              selectedValues={value.linkedPatternIds}
              onChange={(linkedPatternIds) => setValue({ linkedPatternIds })}
              placeholder="Search or create a pattern…"
              emptyMessage="No patterns match yet."
              createLabel="Create pattern"
              onCreate={createLinkedPattern}
            />
          </FlowField>
          <FlowField label="Linked behaviors" description="Choose the moves this mode tends to trigger, justify, or amplify.">
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
          <FlowField
            label="Colliding values"
            description="Choose the valued directions this mode most often interrupts."
            labelHelp="These are the values that get obscured, sidelined, or distorted when this mode takes over."
          >
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
        </>
      )
    }
  ];

  if (modesQuery.isLoading || patternsQuery.isLoading || behaviorsQuery.isLoading || valuesQuery.isLoading) {
    return <LoadingState eyebrow="Modes" title="Loading modes" description="Getting modes, linked patterns, behaviors, and values ready." />;
  }

  const routeError = modesQuery.error ?? patternsQuery.error ?? behaviorsQuery.error ?? valuesQuery.error;
  if (routeError) {
    return <ErrorState eyebrow="Modes" error={routeError} onRetry={() => void Promise.all([modesQuery.refetch(), patternsQuery.refetch(), behaviorsQuery.refetch(), valuesQuery.refetch()])} />;
  }

  const groupedModes = {
    coping: modes.filter((mode) => mode.family === "coping"),
    child: modes.filter((mode) => mode.family === "child"),
    critic_parent: modes.filter((mode) => mode.family === "critic_parent"),
    healthy_adult: modes.filter((mode) => mode.family === "healthy_adult"),
    happy_child: modes.filter((mode) => mode.family === "happy_child")
  } as const;

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="mode"
        title={<EntityName kind="mode" label="Modes" variant="heading" size="lg" />}
        description="Modes should look and feel like a cast of inner states with identity, burden, and relational links, not a flat list of records."
        badge={`${modes.length} modes`}
        actions={
          <Button
            onClick={() => {
              setEditingMode(null);
              setDraft(DEFAULT_MODE_INPUT);
              setDialogOpen(true);
            }}
          >
            Add mode
          </Button>
        }
      />
      <PsycheSectionNav />

      <AtlasPanel
        eyebrow="Mode families"
        title="Modes by family"
        description="Use these groups to see which modes show up most often, what role they play, and what they are connected to."
        tone="violet"
      >
        {modes.length === 0 ? (
          <div className="flex justify-start">
            <Button onClick={() => setDialogOpen(true)}>Add mode</Button>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {(Object.keys(groupedModes) as Array<keyof typeof groupedModes>).map((family) => (
              <div key={family} className="grid gap-3 rounded-[26px] bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <ModeChip family={family} label={familyLabelMap[family]} />
                  <Badge>{groupedModes[family].length}</Badge>
                </div>
                {groupedModes[family].length === 0 ? (
                  <div className="flex">
                    <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                      Add {familyLabelMap[family].toLowerCase()}
                    </Button>
                  </div>
                ) : (
                  groupedModes[family].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className="rounded-[22px] bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.08]"
                      onClick={() => {
                        setEditingMode(mode);
                        setDraft(modeToInput(mode));
                        setDialogOpen(true);
                      }}
                    >
                      <EntityBadge kind="mode" compact gradient={false} />
                      <EntityName kind="mode" label={mode.title} variant="heading" size="lg" />
                      <div className="mt-2 text-sm text-white/52">{mode.archetype}</div>
                      <div className="mt-3 text-sm leading-6 text-white/62">{mode.persona || mode.protectiveJob || "Open the mode to add persona and protective details."}</div>
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Mode"
        title={editingMode ? "Refine cast member" : "Create mode"}
        description="Use this guided flow to define the mode, how it shows up, what it is protecting, and where it comes from."
        value={draft}
        onChange={setDraft}
        steps={steps}
        submitLabel={editingMode ? "Save mode" : "Create mode"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = modeProfileSchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError("This mode still needs a family and a name before it can be saved.");
            return;
          }

          try {
            await saveMutation.mutateAsync(parsed.data);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to save this mode right now.");
          }
        }}
      />
    </div>
  );
}
