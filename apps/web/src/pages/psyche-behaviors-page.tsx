import { useEffect, useState, type ReactNode } from "react";
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
import {
  behaviorCreateSchema,
  behaviorSchema,
  type BehaviorInput
} from "@/lib/psyche-schemas";
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
import { cn } from "@/lib/utils";

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

export function resolveBehaviorContinueBlocker(
  stepId: string,
  value: BehaviorInput,
  allowSparseOptionalFields = false
) {
  if (stepId === "behavior") {
    if (!value.title.trim()) {
      return "Use your own words to give this action a short, recognizable name.";
    }
    if (!allowSparseOptionalFields && !value.description.trim()) {
      return "Describe what you do, say, avoid, or check so this stays an observable behavior rather than a belief, pattern, goal, or episode report.";
    }
  }

  if (allowSparseOptionalFields) {
    return null;
  }

  if (
    stepId === "context" &&
    !value.commonCues.some((cue) => cue.trim().length > 0)
  ) {
    return "Add at least one situation or cue that tends to come just before this action.";
  }

  if (stepId === "context" && value.kind === "away") {
    if (!value.urgeStory.trim()) {
      return "Write the urge or inner push in the words that actually show up just before the action.";
    }
    if (!value.shortTermPayoff.trim()) {
      return "Name what this action provides right away, such as relief, distance, certainty, or control.";
    }
  }

  if (
    stepId === "response" &&
    value.kind === "away" &&
    !value.longTermCost.trim()
  ) {
    return "Name one cost that appears later, without turning it into a judgment about yourself.";
  }

  if (
    stepId === "response" &&
    value.kind === "recovery" &&
    !value.repairPlan.trim()
  ) {
    return "Describe the action that helps you repair, steady, or return after the difficult moment.";
  }

  return null;
}

function ListeningField({
  value,
  editing,
  question,
  heardLabel,
  children
}: {
  value: string;
  editing: boolean;
  question: string;
  heardLabel: string;
  children: ReactNode;
}) {
  if (!editing || !value.trim()) {
    return <FlowField label={question}>{children}</FlowField>;
  }

  return (
    <div className="grid gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="grid gap-1">
        <div className="text-xs font-medium uppercase text-[var(--ui-ink-faint)]">
          I heard {heardLabel}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ui-ink-strong)]">
          "{value}"
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-[var(--primary)]">
          Edit this wording
        </summary>
        <div className="mt-3">
          <FlowField label={`Your wording for ${heardLabel}`}>
            {children}
          </FlowField>
        </div>
      </details>
    </div>
  );
}

function ListeningLead({ children }: { children: string }) {
  if (!children.trim()) {
    return null;
  }

  return (
    <div className="border-l-2 border-[var(--primary)] pl-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
      I am hearing the action as: "{children}". I will keep that wording and
      only ask for details that are still missing.
    </div>
  );
}

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
      eyebrow: "Observable action",
      title: "What do you actually do?",
      description:
        "A behavior is something you do, say, avoid, or check. An inner sentence is a belief; a recurring cue-to-consequence sequence is a pattern; a desired outcome is a goal; and one specific episode belongs in a trigger report.",
      render: (value, setValue) => (
        <>
          <ListeningField
            value={value.title}
            editing={Boolean(editingBehavior)}
            question="What short name would you use for this action?"
            heardLabel="the name"
          >
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Scroll to numb the impact"
            />
          </ListeningField>
          <ListeningField
            value={value.description}
            editing={Boolean(editingBehavior)}
            question="What would someone see or hear you do?"
            heardLabel="the observable action"
          >
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="I open the app again, reread the message, and stop the task I was doing."
            />
          </ListeningField>
        </>
      )
    },
    {
      id: "classification",
      eyebrow: "Direction",
      title: "What kind of action is this?",
      description:
        "Classify the action itself, not your intention or worth. Away moves narrow life, committed actions move toward a value, and recovery moves help you return after a difficult moment.",
      render: (value, setValue) => {
        const kindControl = (
          <div className="grid gap-3 md:grid-cols-3">
            {(["away", "committed", "recovery"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={cn(
                  "rounded-[8px] border px-4 py-4 text-left transition",
                  value.kind === kind
                    ? "border-[color-mix(in_srgb,var(--primary)_40%,var(--ui-border-subtle)_60%)] bg-[color-mix(in_srgb,var(--primary)_12%,var(--ui-surface-1)_88%)] text-[var(--ui-ink-strong)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                )}
                onClick={() => setValue({ kind })}
              >
                {kindTitleMap[kind]}
              </button>
            ))}
          </div>
        );

        return (
          <>
            <ListeningLead>{value.description}</ListeningLead>
            {editingBehavior ? (
              <ListeningField
                value={kindTitleMap[value.kind]}
                editing
                question="What kind of action is this?"
                heardLabel="the move type"
              >
                {kindControl}
              </ListeningField>
            ) : (
              <FlowField label="Move type">{kindControl}</FlowField>
            )}
          </>
        );
      }
    },
    {
      id: "context",
      eyebrow: "Cue and urge",
      title: "What happens just before, and what pulls you toward it?",
      description:
        "Keep recurring cues here rather than retelling a whole one-off episode. Preserve the urge in the words that actually appear; a broader standing belief can be stored separately.",
      render: (value, setValue) => (
        <>
          <ListeningLead>{value.description}</ListeningLead>
          <ListeningField
            value={value.commonCues.join("\n")}
            editing={Boolean(editingBehavior)}
            question="What tends to be happening just before this action?"
            heardLabel="the recurring cues"
          >
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
          </ListeningField>
          <ListeningField
            value={value.urgeStory}
            editing={Boolean(editingBehavior)}
            question="What urge or inner push shows up just before you act?"
            heardLabel="the urge in your words"
          >
            <Textarea
              value={value.urgeStory}
              onChange={(event) => setValue({ urgeStory: event.target.value })}
              placeholder="Just check once more. Then I will know whether I am safe."
            />
          </ListeningField>
          <ListeningField
            value={value.shortTermPayoff}
            editing={Boolean(editingBehavior)}
            question="What does this action give you right away?"
            heardLabel="the immediate payoff"
          >
            <Textarea
              value={value.shortTermPayoff}
              onChange={(event) =>
                setValue({ shortTermPayoff: event.target.value })
              }
              placeholder="What relief, certainty, distance, or control does it give in the short term?"
            />
          </ListeningField>
        </>
      )
    },
    {
      id: "response",
      eyebrow: "Impact and return",
      title: "What happens later, and what other action could be available?",
      description:
        "Acknowledge what the action was trying to do before considering cost, replacement, or repair. Leave any field blank when it does not fit this action.",
      render: (value, setValue) => (
        <>
          <ListeningLead>{value.description}</ListeningLead>
          <div className="grid gap-4 md:grid-cols-2">
            <ListeningField
              value={value.longTermCost}
              editing={Boolean(editingBehavior)}
              question="What cost shows up later?"
              heardLabel="the later cost"
            >
              <Textarea
                value={value.longTermCost}
                onChange={(event) =>
                  setValue({ longTermCost: event.target.value })
                }
                placeholder="What does this move cost over time?"
              />
            </ListeningField>
            <ListeningField
              value={value.replacementMove}
              editing={Boolean(editingBehavior)}
              question="What other observable action would you like available?"
              heardLabel="the alternative action"
            >
              <Textarea
                value={value.replacementMove}
                onChange={(event) =>
                  setValue({ replacementMove: event.target.value })
                }
                placeholder="What move should replace this one when possible?"
              />
            </ListeningField>
          </div>
          <ListeningField
            value={value.repairPlan}
            editing={Boolean(editingBehavior)}
            question="After a difficult moment, what do you actually do to repair or return?"
            heardLabel="the repair action"
          >
            <Textarea
              value={value.repairPlan}
              onChange={(event) => setValue({ repairPlan: event.target.value })}
              placeholder="Describe the repair path without shame or collapse."
            />
          </ListeningField>
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
          <UserSelectField
            value={value.userId ?? null}
            users={shell.snapshot.users}
            onChange={(userId) => setValue({ userId })}
            defaultLabel={formatOwnerSelectDefaultLabel(
              shell.snapshot.users.find((user) => user.id === defaultUserId) ??
                null,
              "Choose behavior owner"
            )}
            help="Choose an owner only when it changes whose behavior this is. Links may still cross owners."
          />
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
              className="grid min-w-0 gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-[var(--ui-ink-strong)]">
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
                    className={cn(
                      "min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-left transition hover:bg-[var(--ui-surface-hover)]",
                      psycheFocusClass(focusedBehaviorId === behavior.id)
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-[var(--ui-ink-strong)]">
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
                    <div className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {behavior.description}
                    </div>
                    <div className="mt-3 break-words text-sm text-[var(--ui-ink-faint)]">
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
        resolveContinueBlocker={(stepId, value) =>
          resolveBehaviorContinueBlocker(
            stepId,
            value,
            Boolean(editingBehavior)
          )
        }
        submitLabel={editingBehavior ? "Save behavior" : "Create behavior"}
        pending={saveMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          const parsed = editingBehavior
            ? behaviorSchema.safeParse(draft)
            : behaviorCreateSchema.safeParse(draft);
          if (!parsed.success) {
            setSubmitError(
              editingBehavior
                ? "This behavior still needs a kind and a title before it can be saved."
                : "This behavior still needs an observable action, a recurring cue, and the details required for its move type."
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
