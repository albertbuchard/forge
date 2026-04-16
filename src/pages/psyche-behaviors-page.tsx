import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { AtlasPanel } from "@/components/psyche/atlas-panel";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { ReturnPathStrip } from "@/components/psyche/return-path-strip";
import { SchemaBadge } from "@/components/psyche/schema-badge";
import {
  psycheFocusClass,
  usePsycheFocusTarget
} from "@/components/psyche/use-psyche-focus-target";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityName } from "@/components/ui/entity-name";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { prependEntityToCollection } from "@/lib/query-cache";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import { behaviorSchema, type BehaviorInput } from "@/lib/psyche-schemas";
import type {
  Behavior,
  BehaviorPattern,
  ModeProfile,
  PsycheValue,
  SchemaCatalogEntry
} from "@/lib/psyche-types";
import { getSchemaFamilyLabel } from "@/lib/schema-visuals";
import {
  createBehavior,
  createBehaviorPattern,
  createMode,
  createPsycheValue,
  listBehaviorPatterns,
  listBehaviors,
  listModes,
  listPsycheValues,
  listSchemaCatalog,
  patchBehavior
} from "@/lib/api";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnerSelectDefaultLabel,
  formatOwnedEntityOptionLabel,
  getSingleSelectedUserId
} from "@/lib/user-ownership";

const DEFAULT_BEHAVIOR_INPUT: BehaviorInput = {
  kind: "away",
  title: "",
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
  userId: null
};

function behaviorToInput(behavior: Behavior): BehaviorInput {
  return {
    kind: behavior.kind,
    title: behavior.title,
    description: behavior.description,
    commonCues: behavior.commonCues,
    urgeStory: behavior.urgeStory,
    shortTermPayoff: behavior.shortTermPayoff,
    longTermCost: behavior.longTermCost,
    replacementMove: behavior.replacementMove,
    repairPlan: behavior.repairPlan,
    linkedPatternIds: behavior.linkedPatternIds,
    linkedValueIds: behavior.linkedValueIds,
    linkedSchemaIds: behavior.linkedSchemaIds,
    linkedModeIds: behavior.linkedModeIds,
    userId: behavior.userId ?? null
  };
}

const kindTitleMap: Record<Behavior["kind"], string> = {
  away: "Away moves",
  committed: "Committed actions",
  recovery: "Recovery moves"
};

export function PsycheBehaviorsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBehavior, setEditingBehavior] = useState<Behavior | null>(null);
  const [draft, setDraft] = useState<BehaviorInput>(DEFAULT_BEHAVIOR_INPUT);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors"],
    queryFn: listBehaviors
  });
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

  const behaviors = behaviorsQuery.data?.behaviors ?? [];
  const patterns = patternsQuery.data?.patterns ?? [];
  const values = valuesQuery.data?.values ?? [];
  const schemas = schemasQuery.data?.schemas ?? [];
  const modes = modesQuery.data?.modes ?? [];
  const defaultUserId = getSingleSelectedUserId(shell.selectedUserIds);
  const focusedBehaviorId = searchParams.get("focus");
  const notesSummaryByEntity = shell.snapshot.dashboard.notesSummaryByEntity;

  usePsycheFocusTarget(focusedBehaviorId);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setDialogOpen(true);
      setEditingBehavior(null);
      setDraft({ ...DEFAULT_BEHAVIOR_INPUT, userId: defaultUserId });
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [defaultUserId, searchParams, setSearchParams]);

  const saveMutation = useMutation({
    mutationFn: async (input: BehaviorInput) => {
      const parsed = behaviorSchema.parse(input);
      if (editingBehavior) {
        return patchBehavior(editingBehavior.id, parsed);
      }
      return createBehavior(parsed);
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingBehavior(null);
      setDraft({ ...DEFAULT_BEHAVIOR_INPUT, userId: defaultUserId });
      setSubmitError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-behaviors"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const patternOptions: EntityLinkOption[] = patterns.map(
    (pattern: BehaviorPattern) => ({
      value: pattern.id,
      label: formatOwnedEntityOptionLabel(pattern.title, pattern.user),
      description: formatOwnedEntityDescription(
        pattern.preferredResponse || pattern.targetBehavior,
        pattern.user
      ),
      searchText: buildOwnedEntitySearchText(
        [
          pattern.title,
          pattern.preferredResponse,
          pattern.targetBehavior,
          pattern.description
        ],
        pattern
      ),
      kind: "pattern"
    })
  );
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
  const schemaOptions: EntityLinkOption[] = schemas.map(
    (schema: SchemaCatalogEntry) => ({
      value: schema.id,
      label: schema.title,
      description: `${schema.description} ${getSchemaFamilyLabel(schema.family)}`,
      searchText: `${schema.slug} ${schema.family} ${schema.schemaType}`,
      badge: (
        <SchemaBadge
          label={schema.title}
          schemaType={schema.schemaType}
          compact
        />
      ),
      menuBadge: (
        <SchemaBadge
          label={schema.title}
          schemaType={schema.schemaType}
          compact
        />
      )
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
      linkedBeliefIds: [],
      userId: draft.userId
    });
    prependEntityToCollection(
      queryClient,
      ["forge-psyche-patterns"],
      "patterns",
      pattern
    );
    await queryClient.invalidateQueries({
      queryKey: ["forge-psyche-overview"]
    });
    return {
      value: pattern.id,
      label: pattern.title,
      description: pattern.preferredResponse || pattern.targetBehavior,
      kind: "pattern"
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

  const steps: Array<QuestionFlowStep<BehaviorInput>> = [
    {
      id: "behavior",
      eyebrow: "Behavior",
      title: "Describe the move or urge in plain language",
      description:
        "Start with the behavior itself so the map reads like something you can instantly recognize in real life.",
      render: (value, setValue) => (
        <>
          <UserSelectField
            value={value.userId ?? null}
            users={shell.snapshot.users}
            onChange={(userId) => setValue({ userId })}
            defaultLabel={formatOwnerSelectDefaultLabel(
              shell.snapshot.users.find((user) => user.id === defaultUserId) ??
                null,
              "Choose behavior owner"
            )}
            help="Behaviors can belong to a human or bot user while still linking across shared patterns, schemas, and modes."
          />
          <FlowField label="Behavior title">
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Scroll to numb the impact"
            />
          </FlowField>
          <FlowField label="What does the move look like?">
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="Describe the move the way you would recognize it in the moment, not in therapist shorthand."
            />
          </FlowField>
        </>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "Capture the cue, the pull, and the immediate payoff",
      description:
        "Make the move readable as a real pattern instead of a label.",
      render: (value, setValue) => (
        <>
          <FlowField label="Common cues">
            <Textarea
              value={value.commonCues.join("\n")}
              onChange={(event) =>
                setValue({
                  commonCues: event.target.value
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                })
              }
              placeholder={
                "One line per cue\nLate-night ambiguity\nFeedback after a hard week"
              }
            />
          </FlowField>
          <FlowField label="What inner push or story shows up?">
            <Textarea
              value={value.urgeStory}
              onChange={(event) => setValue({ urgeStory: event.target.value })}
              placeholder="What inner push or justification tends to appear?"
            />
          </FlowField>
          <FlowField label="What do you get right away from this move?">
            <Textarea
              value={value.shortTermPayoff}
              onChange={(event) =>
                setValue({ shortTermPayoff: event.target.value })
              }
              placeholder="What relief, certainty, distance, or control does it give in the short term?"
            />
          </FlowField>
        </>
      )
    },
    {
      id: "classification",
      eyebrow: "Classification",
      title: "Now classify the move and define the return path",
      description:
        "Once the move is clear, decide whether it is an away move, a committed action, or a recovery path.",
      render: (value, setValue) => (
        <>
          <FlowField label="Move type">
            <div className="grid gap-3 md:grid-cols-3">
              {(["away", "committed", "recovery"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${value.kind === kind ? "border-white/20 bg-white/[0.12] text-white" : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.07]"}`}
                  onClick={() => setValue({ kind })}
                >
                  {kindTitleMap[kind]}
                </button>
              ))}
            </div>
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="What does it cost over time?">
              <Textarea
                value={value.longTermCost}
                onChange={(event) =>
                  setValue({ longTermCost: event.target.value })
                }
                placeholder="What does this move cost over time?"
              />
            </FlowField>
            <FlowField label="What move should replace or steady it?">
              <Textarea
                value={value.replacementMove}
                onChange={(event) =>
                  setValue({ replacementMove: event.target.value })
                }
                placeholder="What move should replace this one when possible?"
              />
            </FlowField>
          </div>
          <FlowField label="If the slip happens, how do you repair and return?">
            <Textarea
              value={value.repairPlan}
              onChange={(event) => setValue({ repairPlan: event.target.value })}
              placeholder="Describe the repair path without shame or collapse."
            />
          </FlowField>
        </>
      )
    },
    {
      id: "links",
      eyebrow: "Links",
      title: "Attach the move to patterns, values, schemas, and modes",
      description:
        "This turns the move into part of the full graphical psyche system.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked patterns">
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
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Linked schemas">
              <EntityLinkMultiSelect
                options={schemaOptions}
                selectedValues={value.linkedSchemaIds}
                onChange={(linkedSchemaIds) => setValue({ linkedSchemaIds })}
                placeholder="Search schema themes…"
                emptyMessage="No schema themes match."
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
        </>
      )
    }
  ];

  if (
    behaviorsQuery.isLoading ||
    patternsQuery.isLoading ||
    valuesQuery.isLoading ||
    schemasQuery.isLoading ||
    modesQuery.isLoading
  ) {
    return (
      <LoadingState
        eyebrow="Behaviors"
        title="Loading behaviors"
        description="Getting behaviors, patterns, values, schemas, and modes ready."
      />
    );
  }

  const routeError =
    behaviorsQuery.error ??
    patternsQuery.error ??
    valuesQuery.error ??
    schemasQuery.error ??
    modesQuery.error;
  if (routeError) {
    return (
      <ErrorState
        eyebrow="Psyche behaviors"
        error={routeError}
        onRetry={() =>
          void Promise.all([
            behaviorsQuery.refetch(),
            patternsQuery.refetch(),
            valuesQuery.refetch(),
            schemasQuery.refetch(),
            modesQuery.refetch()
          ])
        }
      />
    );
  }

  const grouped = {
    away: behaviors.filter((behavior) => behavior.kind === "away"),
    committed: behaviors.filter((behavior) => behavior.kind === "committed"),
    recovery: behaviors.filter((behavior) => behavior.kind === "recovery")
  };

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="behavior"
        title={
          <EntityName
            kind="behavior"
            label="Behaviors"
            variant="heading"
            size="lg"
          />
        }
        description="Group behaviors by what pulls you away, what moves you toward your values, and what helps you recover after a slip."
        badge={`${behaviors.length} mapped`}
        actions={
          <Button
            onClick={() => {
              setEditingBehavior(null);
              setDraft({ ...DEFAULT_BEHAVIOR_INPUT, userId: defaultUserId });
              setDialogOpen(true);
            }}
          >
            Add behavior
          </Button>
        }
      />
      <PsycheSectionNav />

      <AtlasPanel
        eyebrow="Overview"
        title="Behavior summary"
        description="This summary keeps the three behavior types visible together: away, committed, and recovery."
        tone="amber"
      >
        <ReturnPathStrip
          entries={[
            {
              id: "away",
              title: grouped.away[0]?.title ?? "No away move mapped yet",
              summary:
                grouped.away[0]?.replacementMove ||
                "Map the move that tends to pull you away first.",
              href: "#behavior-columns",
              tone: "away"
            },
            {
              id: "committed",
              title:
                grouped.committed[0]?.title ?? "No committed action mapped yet",
              summary:
                grouped.committed[0]?.replacementMove ||
                "Map the move you want to practice instead.",
              href: "#behavior-columns",
              tone: "committed"
            },
            {
              id: "recovery",
              title:
                grouped.recovery[0]?.title ?? "No recovery move mapped yet",
              summary:
                grouped.recovery[0]?.repairPlan ||
                "Map how you return after a slip without turning it into collapse.",
              href: "#behavior-columns",
              tone: "recovery"
            }
          ]}
        />
      </AtlasPanel>

      <AtlasPanel
        eyebrow="Behaviors"
        title="Behaviors by type"
        description="Use these columns to separate what pulls you off course, what helps you move toward your values, and what helps you recover."
        tone="default"
      >
        <div id="behavior-columns" className="grid gap-4 xl:grid-cols-3">
          {(["away", "committed", "recovery"] as const).map((kind) => (
            <div
              key={kind}
              className="grid gap-3 rounded-[24px] bg-white/[0.04] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-white">
                  {kindTitleMap[kind]}
                </div>
                <Badge>{grouped[kind].length}</Badge>
              </div>
              {grouped[kind].length === 0 ? (
                <div className="flex">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingBehavior(null);
                      setDraft({
                        ...DEFAULT_BEHAVIOR_INPUT,
                        userId: defaultUserId
                      });
                      setDialogOpen(true);
                    }}
                  >
                    Add{" "}
                    {kind === "away"
                      ? "away move"
                      : kind === "committed"
                        ? "committed action"
                        : "recovery move"}
                  </Button>
                </div>
              ) : (
                grouped[kind].map((behavior) => (
                  <div
                    key={behavior.id}
                    data-psyche-focus-id={behavior.id}
                    className={`rounded-[22px] border border-white/8 bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.08] ${psycheFocusClass(focusedBehaviorId === behavior.id)}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-white">
                          {behavior.title}
                        </div>
                        {behavior.user ? (
                          <UserBadge user={behavior.user} compact />
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <EntityNoteCountLink
                          entityType="behavior"
                          entityId={behavior.id}
                          count={
                            getEntityNotesSummary(
                              notesSummaryByEntity,
                              "behavior",
                              behavior.id
                            ).count
                          }
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditingBehavior(behavior);
                            setDraft(behaviorToInput(behavior));
                            setDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/58">
                      {behavior.description}
                    </div>
                    <div className="mt-3 text-sm text-white/46">
                      {behavior.replacementMove ||
                        behavior.repairPlan ||
                        "No recovery step recorded yet."}
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </AtlasPanel>

      <QuestionFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eyebrow="Behavior"
        title={editingBehavior ? "Refine behavior path" : "Create behavior"}
        description="Use this guided flow to describe the behavior, when it shows up, what it gives you, and what kind of move it is."
        value={draft}
        onChange={setDraft}
        draftPersistenceKey={
          editingBehavior
            ? `psyche.behavior.${editingBehavior.id}`
            : "psyche.behavior.new"
        }
        steps={steps}
        submitLabel={editingBehavior ? "Save behavior" : "Create behavior"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = behaviorSchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError(
              "This behavior still needs a kind and a title before it can be saved."
            );
            return;
          }

          try {
            await saveMutation.mutateAsync(parsed.data);
          } catch (error) {
            setSubmitError(
              error instanceof Error
                ? error.message
                : "Unable to save this behavior right now."
            );
          }
        }}
      />
    </div>
  );
}
