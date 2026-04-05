import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoonStar, Save } from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
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
  getSleepView,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  patchSleepSession
} from "@/lib/api";
import {
  buildHealthEntityLinkOptions,
  parseHealthLinkValues
} from "@/lib/health-link-options";

function hoursLabel(seconds: number) {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function percentLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatClock(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    : "n/a";
}

export function SleepPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        qualitySummary: string;
        notes: string;
        tagsText: string;
        linkValues: string[];
      }
    >
  >({});
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];

  const sleepQuery = useQuery({
    queryKey: ["forge-sleep", ...selectedUserIds],
    queryFn: async () => (await getSleepView(selectedUserIds)).sleep
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-sleep-values", ...selectedUserIds],
    queryFn: async () => (await listPsycheValues(selectedUserIds)).values
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-sleep-patterns", ...selectedUserIds],
    queryFn: async () => (await listBehaviorPatterns(selectedUserIds)).patterns
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-sleep-behaviors", ...selectedUserIds],
    queryFn: async () => (await listBehaviors(selectedUserIds)).behaviors
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-sleep-beliefs", ...selectedUserIds],
    queryFn: async () => (await listBeliefs(selectedUserIds)).beliefs
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-sleep-reports", ...selectedUserIds],
    queryFn: async () => (await listTriggerReports(selectedUserIds)).reports
  });

  useEffect(() => {
    if (!sleepQuery.data) {
      return;
    }
    setDrafts(
      Object.fromEntries(
        sleepQuery.data.sessions.map((session) => [
          session.id,
          {
            qualitySummary:
              typeof session.annotations.qualitySummary === "string"
                ? session.annotations.qualitySummary
                : "",
            notes:
              typeof session.annotations.notes === "string"
                ? session.annotations.notes
                : "",
            tagsText: Array.isArray(session.annotations.tags)
              ? session.annotations.tags.join(", ")
              : "",
            linkValues: session.links.map(
              (link) => `${link.entityType}:${link.entityId}`
            )
          }
        ])
      )
    );
  }, [sleepQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      sleepId: string;
      qualitySummary: string;
      notes: string;
      tagsText: string;
      linkValues: string[];
    }) =>
      patchSleepSession(input.sleepId, {
        qualitySummary: input.qualitySummary,
        notes: input.notes,
        tags: input.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: parseHealthLinkValues(input.linkValues)
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-sleep"] });
    }
  });

  if (sleepQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Sleep"
        title="Loading sleep view"
        description="Reading HealthKit sleep sessions and reflective links."
        columns={2}
        blocks={6}
      />
    );
  }

  if (sleepQuery.isError || !sleepQuery.data) {
    return (
      <ErrorState
        eyebrow="Sleep"
        error={sleepQuery.error ?? new Error("Sleep data unavailable")}
        onRetry={() => void sleepQuery.refetch()}
      />
    );
  }

  const {
    summary,
    weeklyTrend,
    monthlyPattern,
    stageAverages,
    linkBreakdown,
    sessions
  } = sleepQuery.data;
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
        entityKind="habit"
        title="Sleep"
        description="A reflective sleep surface linking rest, timing, and Psyche-aware context instead of treating nights as disposable telemetry."
        badge={`${sessions.length} nights`}
      />

      <PsycheSectionNav />

      <section className="grid gap-4 lg:grid-cols-4">
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Weekly sleep
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {hoursLabel(summary.totalSleepSeconds)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Total sleep across the recent week.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Average night
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {hoursLabel(summary.averageSleepSeconds)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Mean sleep duration across recent nights.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Sleep score
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.averageSleepScore}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Derived score from duration, efficiency, and stages.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Regularity
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.averageRegularityScore}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Timing consistency across recent nights.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Efficiency
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {percentLabel(summary.averageEfficiency)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Average time asleep relative to time in bed.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Restorative share
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {percentLabel(summary.averageRestorativeShare)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Deep and REM share across the recent week.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Reflected nights
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {summary.reflectiveNightCount}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Nights carrying notes, tags, or linked Psyche context.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Bed and wake window
          </div>
          <div className="mt-3 text-xl text-white">
            {summary.averageBedtimeConsistencyMinutes}m /{" "}
            {summary.averageWakeConsistencyMinutes}m
          </div>
          <div className="mt-2 text-sm text-white/58">
            Mean bedtime and wake-time drift against your recent baseline.
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Trend
              </div>
              <div className="mt-2 text-lg text-white">
                Recent sleep pattern
              </div>
            </div>
            <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
              7 nights
            </Badge>
          </div>
          <div className="grid gap-3">
            {weeklyTrend.map((night) => (
              <div
                key={night.id}
                className="grid gap-2 rounded-[18px] bg-white/[0.04] px-4 py-3 md:grid-cols-[110px_minmax(0,1fr)_100px_100px]"
              >
                <div className="text-sm text-white/62">{night.dateKey}</div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)]"
                      style={{
                        width: `${Math.min(100, (night.sleepHours / 10) * 100)}%`
                      }}
                    />
                  </div>
                  <div className="text-sm text-white">
                    {night.sleepHours.toFixed(1)}h
                  </div>
                </div>
                <div className="text-sm text-white/62">Score {night.score}</div>
                <div className="text-sm text-white/62">
                  Reg {night.regularity}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Latest bedtime</div>
              <div className="mt-2 text-lg text-white">
                {formatClock(summary.latestBedtime)}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Latest wake</div>
              <div className="mt-2 text-lg text-white">
                {formatClock(summary.latestWakeTime)}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Linked nights</div>
              <div className="mt-2 text-lg text-white">
                {summary.linkedNightCount}
              </div>
            </div>
          </div>
        </Card>

        <Card className="grid gap-4">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Pattern surfaces
            </div>
            <div className="mt-2 text-lg text-white">
              Stage, timing, and linked context
            </div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Average stages</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {stageAverages.length > 0 ? (
                  stageAverages.map((stage) => (
                    <Badge key={stage.stage} tone="meta">
                      {stage.stage} {hoursLabel(stage.averageSeconds)}
                    </Badge>
                  ))
                ) : (
                  <div className="text-sm text-white/48">
                    Stage data will appear here when HealthKit exposes it.
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Most-linked context</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {linkBreakdown.length > 0 ? (
                  linkBreakdown.slice(0, 6).map((link) => (
                    <Badge key={link.entityType} tone="meta">
                      {link.entityType.replaceAll("_", " ")} {link.count}
                    </Badge>
                  ))
                ) : (
                  <div className="text-sm text-white/48">
                    Linked habits, beliefs, projects, and reports will
                    accumulate here.
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-[18px] bg-white/[0.04] p-4">
              <div className="text-sm text-white/58">Monthly timing</div>
              <div className="mt-3 grid gap-2">
                {monthlyPattern.slice(-5).map((night) => (
                  <div
                    key={night.id}
                    className="flex items-center justify-between gap-3 text-sm text-white/66"
                  >
                    <span>{night.dateKey}</span>
                    <span>
                      {night.onsetHour}:00 to {night.wakeHour}:00
                    </span>
                    <span>{night.sleepHours.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <div className="grid gap-4">
        {sessions.map((session) => {
          const draft = drafts[session.id] ?? {
            qualitySummary: "",
            notes: "",
            tagsText: "",
            linkValues: []
          };
          return (
            <Card key={session.id} className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-lg text-white">
                    <MoonStar className="size-4 text-[var(--primary)]" />
                    <span>
                      {new Date(session.startedAt).toLocaleString()} to{" "}
                      {new Date(session.endedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{hoursLabel(session.asleepSeconds)} asleep</Badge>
                    <Badge tone="meta">
                      {hoursLabel(session.timeInBedSeconds)} in bed
                    </Badge>
                    <Badge tone="meta">
                      Score {session.sleepScore ?? "n/a"}
                    </Badge>
                    <Badge tone="meta">
                      Eff{" "}
                      {percentLabel(
                        typeof session.derived.efficiency === "number"
                          ? session.derived.efficiency
                          : session.timeInBedSeconds > 0
                            ? session.asleepSeconds / session.timeInBedSeconds
                            : 0
                      )}
                    </Badge>
                    <Badge tone="meta">
                      Restorative{" "}
                      {percentLabel(
                        typeof session.derived.restorativeShare === "number"
                          ? session.derived.restorativeShare
                          : 0
                      )}
                    </Badge>
                    <Badge tone="meta">
                      {session.links.length} linked entities
                    </Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  pending={saveMutation.isPending}
                  pendingLabel="Saving"
                  onClick={() =>
                    void saveMutation.mutateAsync({
                      sleepId: session.id,
                      qualitySummary: draft.qualitySummary,
                      notes: draft.notes,
                      tagsText: draft.tagsText,
                      linkValues: draft.linkValues
                    })
                  }
                >
                  <Save className="size-4" />
                  Save reflection
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-3">
                  <div className="rounded-[18px] bg-white/[0.04] p-4">
                    <div className="text-sm text-white/58">Stage breakdown</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session.stageBreakdown.length > 0 ? (
                        session.stageBreakdown.map((stage) => (
                          <Badge key={stage.stage} tone="meta">
                            {stage.stage} {hoursLabel(stage.seconds)}
                          </Badge>
                        ))
                      ) : (
                        <div className="text-sm text-white/48">
                          No stage data synced for this night.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[18px] bg-white/[0.04] p-4">
                      <div className="text-sm text-white/58">Bedtime drift</div>
                      <div className="mt-2 text-lg text-white">
                        {session.bedtimeConsistencyMinutes ?? 0}m
                      </div>
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] p-4">
                      <div className="text-sm text-white/58">Wake drift</div>
                      <div className="mt-2 text-lg text-white">
                        {session.wakeConsistencyMinutes ?? 0}m
                      </div>
                    </div>
                    <div className="rounded-[18px] bg-white/[0.04] p-4">
                      <div className="text-sm text-white/58">
                        Recovery state
                      </div>
                      <div className="mt-2 text-lg text-white capitalize">
                        {typeof session.derived.recoveryState === "string"
                          ? session.derived.recoveryState
                          : "n/a"}
                      </div>
                    </div>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">
                      Quality summary
                    </span>
                    <Input
                      value={draft.qualitySummary}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            qualitySummary: event.target.value
                          }
                        }))
                      }
                      placeholder="Restless before sleep but recovered by morning."
                    />
                  </label>
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
                      placeholder="overload, rumination, travel, good-routine"
                    />
                  </label>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-2">
                    <span className="text-sm text-white/58">
                      Reflection, habits, beliefs, or trigger context
                    </span>
                    <Textarea
                      className="min-h-[120px]"
                      value={draft.notes}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [session.id]: {
                            ...draft,
                            notes: event.target.value
                          }
                        }))
                      }
                      placeholder="Link this night to overload, bedtime rumination, wind-down habits, values conflict, or project pressure."
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
                      placeholder="Search habits, goals, beliefs, patterns, reports…"
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
