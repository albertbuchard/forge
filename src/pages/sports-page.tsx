import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Save } from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

function minutesLabel(seconds: number) {
  return `${Math.round(seconds / 60)}m`;
}

function kilometersLabel(distanceMeters: number | null) {
  if (!distanceMeters) {
    return "n/a";
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function SportsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        subjectiveEffort: string;
        moodBefore: string;
        moodAfter: string;
        meaningText: string;
        plannedContext: string;
        socialContext: string;
        tagsText: string;
        linkValues: string[];
      }
    >
  >({});

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
        fitnessQuery.data.sessions.map((session) => [
          session.id,
          {
            subjectiveEffort:
              session.subjectiveEffort !== null
                ? String(session.subjectiveEffort)
                : "",
            moodBefore: session.moodBefore ?? "",
            moodAfter: session.moodAfter ?? "",
            meaningText: session.meaningText ?? "",
            plannedContext: session.plannedContext ?? "",
            socialContext: session.socialContext ?? "",
            tagsText: session.tags.join(", "),
            linkValues: session.links.map(
              (link) => `${link.entityType}:${link.entityId}`
            )
          }
        ])
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

  if (fitnessQuery.isError || !fitnessQuery.data) {
    return (
      <ErrorState
        eyebrow="Sports"
        error={fitnessQuery.error ?? new Error("Sports data unavailable")}
        onRetry={() => void fitnessQuery.refetch()}
      />
    );
  }

  const { summary, weeklyTrend, typeBreakdown, sessions } = fitnessQuery.data;
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

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="project"
        title="Sports"
        description="A session-first training surface for workout data, subjective meaning, and links back into Forge execution and Psyche."
        badge={`${sessions.length} sessions`}
      />

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

      <div className="grid gap-4">
        {sessions.map((session) => {
          const draft = drafts[session.id] ?? {
            subjectiveEffort: "",
            moodBefore: "",
            moodAfter: "",
            meaningText: ""
          };
          return (
            <Card key={session.id} className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-lg text-white">
                    <Dumbbell className="size-4 text-[var(--primary)]" />
                    <span>{session.workoutType}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{minutesLabel(session.durationSeconds)}</Badge>
                    {session.totalEnergyKcal ? (
                      <Badge tone="meta">
                        {Math.round(session.totalEnergyKcal)} kcal
                      </Badge>
                    ) : null}
                    {session.distanceMeters ? (
                      <Badge tone="meta">
                        {(session.distanceMeters / 1000).toFixed(1)} km
                      </Badge>
                    ) : null}
                    {session.averageHeartRate ? (
                      <Badge tone="meta">
                        Avg HR {Math.round(session.averageHeartRate)}
                      </Badge>
                    ) : null}
                    <Badge tone="meta">
                      {session.reconciliationStatus}
                    </Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  pending={saveMutation.isPending}
                  pendingLabel="Saving"
                  onClick={() =>
                    void saveMutation.mutateAsync({
                      workoutId: session.id,
                      subjectiveEffort: draft.subjectiveEffort,
                      moodBefore: draft.moodBefore,
                      moodAfter: draft.moodAfter,
                      meaningText: draft.meaningText,
                      plannedContext: draft.plannedContext,
                      socialContext: draft.socialContext,
                      tagsText: draft.tagsText,
                      linkValues: draft.linkValues
                    })
                  }
                >
                  <Save className="size-4" />
                  Save metadata
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-3">
                  <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm text-white/62">
                    {new Date(session.startedAt).toLocaleString()} to{" "}
                    {new Date(session.endedAt).toLocaleString()} ·{" "}
                    {session.sourceDevice}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[18px] bg-white/[0.04] p-4">
                      <div className="text-sm text-white/58">Source</div>
                      <div className="mt-2 text-lg text-white">
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
                        {session.maxHeartRate
                          ? Math.round(session.maxHeartRate)
                          : "n/a"}
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
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              subjectiveEffort: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Mood before</span>
                      <Input
                        value={draft.moodBefore}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              moodBefore: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Mood after</span>
                      <Input
                        value={draft.moodAfter}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              moodAfter: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">
                        Planned vs spontaneous
                      </span>
                      <Input
                        value={draft.plannedContext}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              plannedContext: event.target.value
                            }
                          }))
                        }
                        placeholder="Planned recovery block"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-white/58">Social context</span>
                      <Input
                        value={draft.socialContext}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [session.id]: {
                              ...draft,
                              socialContext: event.target.value
                            }
                          }))
                        }
                        placeholder="Solo, coach, group class, partner"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">Tags</span>
                    <Input
                      value={draft.tagsText}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            tagsText: event.target.value
                          }
                        }))
                      }
                      placeholder="sleep-support, recovery, strength-block"
                    />
                  </label>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">
                      Meaning, link to sleep, project, value, or therapeutic plan
                    </span>
                    <Textarea
                      className="min-h-[120px]"
                      value={draft.meaningText}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            meaningText: event.target.value
                          }
                        }))
                      }
                      placeholder="Planned recovery walk linked to sleep repair, stress regulation, or a specific project rhythm."
                    />
                  </label>
                  <div className="grid gap-2">
                    <span className="text-sm text-white/58">
                      Linked Forge and Psyche records
                    </span>
                    <EntityLinkMultiSelect
                      options={linkOptions}
                      selectedValues={draft.linkValues}
                      onChange={(linkValues) =>
                        setDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            linkValues
                          }
                        }))
                      }
                      placeholder="Search goals, projects, habits, values, beliefs, patterns…"
                    />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
