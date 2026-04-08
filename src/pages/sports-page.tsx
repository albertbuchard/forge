import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  CalendarDays,
  Dumbbell,
  HeartPulse,
  Save
} from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { FacetedTokenSearch, type FacetedTokenOption } from "@/components/search/faceted-token-search";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { WorkbenchSection } from "@/components/workbench/workbench-section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import {
  getFitnessView,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  patchWorkoutSession
} from "@/lib/api";
import {
  buildHealthEntityLinkOptions,
  parseHealthLinkValues
} from "@/lib/health-link-options";
import type { FitnessViewData, WorkoutSessionRecord } from "@/lib/types";

type WorkoutDraft = {
  subjectiveEffort: string;
  moodBefore: string;
  moodAfter: string;
  meaningText: string;
  plannedContext: string;
  socialContext: string;
  tagsText: string;
  linkValues: string[];
};

function minutesLabel(seconds: number) {
  return `${Math.round(seconds / 60)}m`;
}

function kilometersLabel(distanceMeters: number | null) {
  if (!distanceMeters) {
    return "n/a";
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatWorkoutWindow(startedAt: string, endedAt: string) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${dateFormatter.format(new Date(startedAt))} · ${timeFormatter.format(new Date(startedAt))} - ${timeFormatter.format(new Date(endedAt))}`;
}

function buildWorkoutDraft(session: WorkoutSessionRecord): WorkoutDraft {
  return {
    subjectiveEffort:
      session.subjectiveEffort !== null ? String(session.subjectiveEffort) : "",
    moodBefore: session.moodBefore ?? "",
    moodAfter: session.moodAfter ?? "",
    meaningText: session.meaningText ?? "",
    plannedContext: session.plannedContext ?? "",
    socialContext: session.socialContext ?? "",
    tagsText: Array.isArray(session.tags) ? session.tags.join(", ") : "",
    linkValues: Array.isArray(session.links)
      ? session.links.map((link) => `${link.entityType}:${link.entityId}`)
      : []
  };
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function buildWorkoutSearchText(session: WorkoutSessionRecord, draft: WorkoutDraft) {
  return normalize(
    [
      session.workoutType,
      session.sourceType,
      session.sourceDevice,
      session.reconciliationStatus,
      session.moodBefore,
      session.moodAfter,
      session.meaningText,
      session.plannedContext,
      session.socialContext,
      session.tags.join(" "),
      draft.moodBefore,
      draft.moodAfter,
      draft.meaningText,
      draft.plannedContext,
      draft.socialContext,
      draft.tagsText,
      formatWorkoutWindow(session.startedAt, session.endedAt)
    ].join(" ")
  );
}

function createWorkoutFilterOptions(
  sessions: WorkoutSessionRecord[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();

  for (const session of sessions) {
    options.set(`workout:${session.workoutType}`, {
      id: `workout:${session.workoutType}`,
      label: session.workoutType,
      description: "Workout type",
      searchText: `${session.workoutType} workout`,
      badge: <Badge tone="meta">{session.workoutType}</Badge>
    });
    options.set(`source:${session.sourceType}`, {
      id: `source:${session.sourceType}`,
      label: session.sourceType.replaceAll("_", " "),
      description: "Source type",
      searchText: `${session.sourceType} source`,
      badge: (
        <Badge tone="meta" className="capitalize">
          {session.sourceType.replaceAll("_", " ")}
        </Badge>
      )
    });
    options.set(`status:${session.reconciliationStatus}`, {
      id: `status:${session.reconciliationStatus}`,
      label: session.reconciliationStatus.replaceAll("_", " "),
      description: "Reconciliation status",
      searchText: `${session.reconciliationStatus} status`,
      badge: (
        <Badge tone="meta" className="capitalize">
          {session.reconciliationStatus.replaceAll("_", " ")}
        </Badge>
      )
    });
  }

  options.set("linked:yes", {
    id: "linked:yes",
    label: "Linked",
    description: "Already tied to Forge or Psyche context",
    badge: <Badge tone="meta">Linked</Badge>
  });
  options.set("linked:no", {
    id: "linked:no",
    label: "Needs links",
    description: "No Forge or Psyche links yet",
    badge: <Badge tone="meta">Needs links</Badge>
  });
  options.set("habit:yes", {
    id: "habit:yes",
    label: "Habit-generated",
    description: "Created from a habit completion",
    badge: <Badge tone="meta">Habit-generated</Badge>
  });
  options.set("effort:rated", {
    id: "effort:rated",
    label: "Effort rated",
    description: "Already has a subjective effort score",
    badge: <Badge tone="meta">Effort rated</Badge>
  });

  return Array.from(options.values());
}

function matchesWorkoutFilters(
  session: WorkoutSessionRecord,
  selectedFilterIds: string[]
) {
  return selectedFilterIds.every((filterId) => {
    if (filterId.startsWith("workout:")) {
      return session.workoutType === filterId.slice("workout:".length);
    }
    if (filterId.startsWith("source:")) {
      return session.sourceType === filterId.slice("source:".length);
    }
    if (filterId.startsWith("status:")) {
      return session.reconciliationStatus === filterId.slice("status:".length);
    }
    if (filterId === "linked:yes") {
      return session.links.length > 0;
    }
    if (filterId === "linked:no") {
      return session.links.length === 0;
    }
    if (filterId === "habit:yes") {
      return Boolean(session.generatedFromHabitId);
    }
    if (filterId === "effort:rated") {
      return session.subjectiveEffort !== null;
    }
    return true;
  });
}

function SportsSessionEditor({
  session,
  draft,
  linkOptions,
  pending,
  step,
  onStepChange,
  onDraftChange,
  onSave
}: {
  session: WorkoutSessionRecord;
  draft: WorkoutDraft;
  linkOptions: ReturnType<typeof buildHealthEntityLinkOptions>;
  pending: boolean;
  step: number;
  onStepChange: (next: number) => void;
  onDraftChange: (patch: Partial<WorkoutDraft>) => void;
  onSave: () => void;
}) {
  const steps = [
    {
      id: "context",
      title: "Session context",
      description: "Quick facts, effort, and how this session happened."
    },
    {
      id: "reflection",
      title: "Reflection",
      description: "Mood, meaning, and what the session actually did for you."
    },
    {
      id: "links",
      title: "Links",
      description: "Tie the session back to Forge and Psyche context."
    }
  ] as const;

  return (
    <div className="grid gap-5">
      <div className="rounded-[24px] bg-white/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg text-white">
              <Dumbbell className="size-4 text-[var(--primary)]" />
              <span>{session.workoutType}</span>
            </div>
            <div className="mt-2 text-sm text-white/58">
              {formatWorkoutWindow(session.startedAt, session.endedAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{minutesLabel(session.durationSeconds)}</Badge>
            {session.totalEnergyKcal ? (
              <Badge tone="meta">{Math.round(session.totalEnergyKcal)} kcal</Badge>
            ) : null}
            {session.distanceMeters ? (
              <Badge tone="meta">{kilometersLabel(session.distanceMeters)}</Badge>
            ) : null}
            <Badge tone="meta" className="capitalize">
              {session.reconciliationStatus.replaceAll("_", " ")}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {steps.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onStepChange(index)}
            className={`rounded-[20px] border px-4 py-3 text-left transition ${
              step === index
                ? "border-[var(--primary)] bg-[var(--primary)]/10 text-white"
                : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
              Step {index + 1}
            </div>
            <div className="mt-2 text-sm font-medium">{entry.title}</div>
          </button>
        ))}
      </div>

      <div className="rounded-[24px] bg-white/[0.03] p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
          {steps[step]!.title}
        </div>
        <div className="mt-2 text-sm leading-6 text-white/58">
          {steps[step]!.description}
        </div>

        {step === 0 ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-sm text-white/58">Source</div>
                <div className="mt-2 text-lg text-white capitalize">
                  {session.sourceType.replaceAll("_", " ")}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-sm text-white/58">Steps</div>
                <div className="mt-2 text-lg text-white">
                  {session.stepCount ?? "n/a"}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-sm text-white/58">Max HR</div>
                <div className="mt-2 text-lg text-white">
                  {session.maxHeartRate ? Math.round(session.maxHeartRate) : "n/a"}
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Effort</span>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.subjectiveEffort}
                  onChange={(event) =>
                    onDraftChange({ subjectiveEffort: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Planned vs spontaneous</span>
                <Input
                  value={draft.plannedContext}
                  onChange={(event) =>
                    onDraftChange({ plannedContext: event.target.value })
                  }
                  placeholder="Planned recovery block"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Social context</span>
                <Input
                  value={draft.socialContext}
                  onChange={(event) =>
                    onDraftChange({ socialContext: event.target.value })
                  }
                  placeholder="Solo, coach, group class, partner"
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Tags</span>
              <Input
                value={draft.tagsText}
                onChange={(event) => onDraftChange({ tagsText: event.target.value })}
                placeholder="recovery, interval-block, stress-release"
              />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Mood before</span>
                <Input
                  value={draft.moodBefore}
                  onChange={(event) => onDraftChange({ moodBefore: event.target.value })}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-white/58">Mood after</span>
                <Input
                  value={draft.moodAfter}
                  onChange={(event) => onDraftChange({ moodAfter: event.target.value })}
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">
                Meaning, impact, and why this session mattered
              </span>
              <Textarea
                className="min-h-[160px]"
                value={draft.meaningText}
                onChange={(event) => onDraftChange({ meaningText: event.target.value })}
                placeholder="This session was planned as active recovery after a heavy work block and helped reset stress before sleep."
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 grid gap-3">
            <div className="text-sm text-white/58">
              Search goals, projects, habits, values, beliefs, patterns, or reports and attach the ones that explain this session.
            </div>
            <EntityLinkMultiSelect
              options={linkOptions}
              selectedValues={draft.linkValues}
              onChange={(linkValues) => onDraftChange({ linkValues })}
              placeholder="Search Forge and Psyche records…"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/48">
          {step < steps.length - 1
            ? "Move through the session one step at a time, then save when the context is clean."
            : "Everything is in place. Save the session metadata back into Forge."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onStepChange(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={() => onStepChange(step + 1)}>
              Next
              <ArrowRight className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            pending={pending}
            pendingLabel="Saving"
            onClick={onSave}
          >
            <Save className="size-4" />
            Save session
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SportsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [drafts, setDrafts] = useState<Record<string, WorkoutDraft>>({});
  const [query, setQuery] = useState("");
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [editorStep, setEditorStep] = useState(0);

  const fitnessQuery = useQuery({
    queryKey: ["forge-fitness", ...selectedUserIds],
    queryFn: async () => (await getFitnessView(selectedUserIds)).fitness
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-health-values", ...selectedUserIds],
    queryFn: async () => (await listPsycheValues(selectedUserIds)).values
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-health-patterns", ...selectedUserIds],
    queryFn: async () => (await listBehaviorPatterns(selectedUserIds)).patterns
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-health-behaviors", ...selectedUserIds],
    queryFn: async () => (await listBehaviors(selectedUserIds)).behaviors
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-health-beliefs", ...selectedUserIds],
    queryFn: async () => (await listBeliefs(selectedUserIds)).beliefs
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-health-reports", ...selectedUserIds],
    queryFn: async () => (await listTriggerReports(selectedUserIds)).reports
  });

  useEffect(() => {
    if (!fitnessQuery.data) {
      return;
    }
    setDrafts(
      Object.fromEntries(
        fitnessQuery.data.sessions.map((session) => [session.id, buildWorkoutDraft(session)])
      )
    );
  }, [fitnessQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      workoutId: string;
      subjectiveEffort: string;
      moodBefore: string;
      moodAfter: string;
      meaningText: string;
      plannedContext: string;
      socialContext: string;
      tagsText: string;
      linkValues: string[];
    }) =>
      patchWorkoutSession(input.workoutId, {
        subjectiveEffort:
          input.subjectiveEffort.trim().length > 0
            ? Number(input.subjectiveEffort)
            : null,
        moodBefore: input.moodBefore,
        moodAfter: input.moodAfter,
        meaningText: input.meaningText,
        plannedContext: input.plannedContext,
        socialContext: input.socialContext,
        tags: input.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: parseHealthLinkValues(input.linkValues)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-fitness"] });
    }
  });

  const fitness = fitnessQuery.data;
  const sessions = fitness?.sessions ?? [];
  const linkOptions = buildHealthEntityLinkOptions({
    goals: shell.snapshot.dashboard.goals,
    projects: shell.snapshot.dashboard.projects,
    tasks: shell.snapshot.dashboard.tasks,
    habits: shell.snapshot.dashboard.habits,
    values: valuesQuery.data ?? [],
    patterns: patternsQuery.data ?? [],
    behaviors: behaviorsQuery.data ?? [],
    beliefs: beliefsQuery.data ?? [],
    reports: reportsQuery.data ?? []
  });
  const searchOptions = useMemo(
    () => createWorkoutFilterOptions(sessions),
    [sessions]
  );
  const filteredSessions = useMemo(() => {
    const normalizedQuery = normalize(query);
    return [...sessions]
      .sort(
        (left, right) =>
          new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
      )
      .filter((session) => {
        const draft = drafts[session.id] ?? buildWorkoutDraft(session);
        const textMatch =
          normalizedQuery.length === 0 ||
          buildWorkoutSearchText(session, draft).includes(normalizedQuery);
        return textMatch && matchesWorkoutFilters(session, selectedFilterIds);
      });
  }, [drafts, query, selectedFilterIds, sessions]);
  const resultSummary =
    filteredSessions.length === sessions.length &&
    query.trim().length === 0 &&
    selectedFilterIds.length === 0
      ? `${sessions.length} workout sessions visible`
      : `${filteredSessions.length} of ${sessions.length} workout sessions visible`;
  const activeSession =
    filteredSessions.find((session) => session.id === selectedWorkoutId) ??
    sessions.find((session) => session.id === selectedWorkoutId) ??
    null;
  const activeDraft = activeSession
    ? drafts[activeSession.id] ?? buildWorkoutDraft(activeSession)
    : null;

  const rowVirtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 108,
    overscan: 8
  });

  if (fitnessQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Sports"
        title="Loading sports view"
        description="Reading synced workouts and local reflection metadata."
        columns={2}
        blocks={6}
      />
    );
  }

  if (fitnessQuery.isError || !fitness) {
    return (
      <ErrorState
        eyebrow="Sports"
        error={fitnessQuery.error ?? new Error("Sports data unavailable")}
        onRetry={() => void fitnessQuery.refetch()}
      />
    );
  }

  const { summary, weeklyTrend, typeBreakdown } = fitness;

  function patchDraft(sessionId: string, patch: Partial<WorkoutDraft>) {
    setDrafts((current) => {
      const base =
        current[sessionId] ??
        buildWorkoutDraft(
          sessions.find((entry) => entry.id === sessionId) as WorkoutSessionRecord
        );
      return {
        ...current,
        [sessionId]: {
          ...base,
          ...patch
        }
      };
    });
  }

  async function saveWorkout(workoutId: string) {
    const session = sessions.find((entry) => entry.id === workoutId);
    if (!session) {
      return;
    }
    const draft = drafts[workoutId] ?? buildWorkoutDraft(session);
    await saveMutation.mutateAsync({
      workoutId,
      subjectiveEffort: draft.subjectiveEffort,
      moodBefore: draft.moodBefore,
      moodAfter: draft.moodAfter,
      meaningText: draft.meaningText,
      plannedContext: draft.plannedContext,
      socialContext: draft.socialContext,
      tagsText: draft.tagsText,
      linkValues: draft.linkValues
    });
    setSelectedWorkoutId(null);
    setEditorStep(0);
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="project"
        title="Sports"
        description="A session-first training surface for workout data, subjective meaning, and links back into Forge execution and Psyche."
        badge={`${sessions.length} sessions`}
      />

      <WorkbenchSection boxId="surface:sports-index:summary" surfaceId="sports-index">
        <section className="grid gap-4 lg:grid-cols-4">
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Weekly volume
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {minutesLabel(summary.weeklyVolumeSeconds)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Total training time in the recent week.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Exercise minutes
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.exerciseMinutes}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Aggregate exercise minutes from synced sessions.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Energy burned
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.energyBurnedKcal}
          </div>
          <div className="mt-2 text-sm text-white/58">Recent weekly kcal.</div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Training streak
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.streakDays}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Distinct workout days in the recent week.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Average session
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.averageSessionMinutes}m
          </div>
          <div className="mt-2 text-sm text-white/58">
            Mean duration across recent sessions.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Average effort
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.averageEffort || "n/a"}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Subjective effort across sessions that carry a rating.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Linked sessions
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.linkedSessionCount}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Sessions already tied to Forge or Psyche entities.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Top block
          </div>
          <div className="mt-3 text-xl text-white">
            {summary.topWorkoutType ?? "n/a"}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Dominant workout type across the recent window.
          </div>
        </Card>
        </section>
      </WorkbenchSection>

      <WorkbenchSection boxId="surface:sports-index:composition" surfaceId="sports-index">
        <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="grid gap-4">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Recent volume
          </div>
          <div className="grid gap-3">
            {weeklyTrend.map((session) => (
              <div
                key={session.id}
                className="grid gap-2 rounded-[18px] bg-white/[0.04] px-4 py-3 md:grid-cols-[110px_150px_minmax(0,1fr)_90px]"
              >
                <div className="text-sm text-white/62">{session.dateKey}</div>
                <div className="text-sm text-white">{session.workoutType}</div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{
                        width: `${Math.min(100, (session.durationMinutes / 120) * 100)}%`
                      }}
                    />
                  </div>
                  <div className="text-sm text-white">
                    {session.durationMinutes}m
                  </div>
                </div>
                <div className="text-sm text-white/62">{session.energyKcal} kcal</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Distance</div>
              <div className="mt-2 text-lg text-white">
                {kilometersLabel(summary.distanceMeters)}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Planned sessions</div>
              <div className="mt-2 text-lg text-white">
                {summary.plannedSessionCount}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Imported / merged</div>
              <div className="mt-2 text-lg text-white">
                {summary.importedSessionCount} / {summary.reconciledSessionCount}
              </div>
            </div>
          </div>
        </Card>

        <Card className="grid gap-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Training composition
            </div>
            <div className="mt-2 text-lg text-white">
              Workout type and provenance mix
            </div>
          </div>
          <div className="grid gap-3">
            {typeBreakdown.slice(0, 6).map((entry) => (
              <div
                key={entry.workoutType}
                className="grid gap-2 rounded-[18px] bg-white/[0.04] px-4 py-3 md:grid-cols-[minmax(0,1fr)_90px_90px]"
              >
                <div>
                  <div className="text-white">{entry.workoutType}</div>
                  <div className="mt-1 text-sm text-white/58">
                    {entry.sessionCount} sessions
                  </div>
                </div>
                <div className="text-sm text-white/72">{entry.totalMinutes}m</div>
                <div className="text-sm text-white/72">{entry.energyKcal} kcal</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Habit-generated</div>
              <div className="mt-2 text-lg text-white">
                {summary.habitGeneratedSessionCount}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Forge-linked</div>
              <div className="mt-2 text-lg text-white">
                {summary.linkedSessionCount}
              </div>
            </div>
          </div>
        </Card>
        </section>
      </WorkbenchSection>

      <WorkbenchSection boxId="surface:sports-index:browser" surfaceId="sports-index">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <FacetedTokenSearch
          title="Session browser"
          description="Search past activities by workout type, source, reconciliation state, or whether they still need context."
          query={query}
          onQueryChange={setQuery}
          options={searchOptions}
          selectedOptionIds={selectedFilterIds}
          onSelectedOptionIdsChange={setSelectedFilterIds}
          resultSummary={resultSummary}
          placeholder="Search workouts, devices, notes, moods, or filter chips"
          emptyStateMessage="Keep typing or pick a filter chip to narrow the activity history."
        />

        <Card className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Activity history
              </div>
              <div className="mt-2 text-lg text-white">
                Open a workout to add reflection and links in a guided modal.
              </div>
            </div>
            <Badge tone="meta">{resultSummary}</Badge>
          </div>

          <div
            ref={listRef}
            className="h-[34rem] overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03]"
          >
            {filteredSessions.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-white/50">
                No workout matches the current search yet. Clear some filters or search by workout type, device, or reflection text.
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const session = filteredSessions[virtualRow.index]!;
                  const hasReflection =
                    session.meaningText.trim().length > 0 ||
                    session.moodBefore.trim().length > 0 ||
                    session.moodAfter.trim().length > 0 ||
                    session.tags.length > 0 ||
                    session.links.length > 0;
                  return (
                    <div
                      key={session.id}
                      className="absolute left-0 top-0 w-full px-3 py-2"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      <button
                        type="button"
                        className="grid w-full gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                        onClick={() => {
                          setSelectedWorkoutId(session.id);
                          setEditorStep(0);
                        }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-white">
                              <Dumbbell className="size-4 shrink-0 text-[var(--primary)]" />
                              <span className="truncate text-base font-medium">
                                {session.workoutType}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm text-white/56">
                              <CalendarDays className="size-3.5 shrink-0" />
                              <span className="truncate">
                                {formatWorkoutWindow(session.startedAt, session.endedAt)}
                              </span>
                            </div>
                          </div>
                          <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-white/70">
                            <span>{hasReflection ? "Reflected" : "Needs reflection"}</span>
                            <ArrowRight className="size-3.5" />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge>{minutesLabel(session.durationSeconds)}</Badge>
                          {session.totalEnergyKcal ? (
                            <Badge tone="meta">{Math.round(session.totalEnergyKcal)} kcal</Badge>
                          ) : null}
                          {session.distanceMeters ? (
                            <Badge tone="meta">{kilometersLabel(session.distanceMeters)}</Badge>
                          ) : null}
                          {session.averageHeartRate ? (
                            <Badge tone="meta">
                              <HeartPulse className="mr-1 size-3.5" />
                              {Math.round(session.averageHeartRate)} bpm
                            </Badge>
                          ) : null}
                          <Badge tone="meta" className="capitalize">
                            {session.sourceType.replaceAll("_", " ")}
                          </Badge>
                          <Badge tone="meta" className="capitalize">
                            {session.reconciliationStatus.replaceAll("_", " ")}
                          </Badge>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
        </section>
      </WorkbenchSection>

      {activeSession && activeDraft ? (
        <SheetScaffold
          open={Boolean(activeSession)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorkoutId(null);
              setEditorStep(0);
            }
          }}
          eyebrow="Sports session"
          title={activeSession.workoutType}
          description="Add contextual meaning without crowding the main training surface."
        >
          <SportsSessionEditor
            session={activeSession}
            draft={activeDraft}
            linkOptions={linkOptions}
            pending={
              saveMutation.isPending &&
              saveMutation.variables?.workoutId === activeSession.id
            }
            step={editorStep}
            onStepChange={setEditorStep}
            onDraftChange={(patch) => patchDraft(activeSession.id, patch)}
            onSave={() => void saveWorkout(activeSession.id)}
          />
        </SheetScaffold>
      ) : null}
    </div>
  );
}
