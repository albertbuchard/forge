import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, CalendarDays, MoonStar, Save } from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
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
import type { SleepSessionRecord } from "@/lib/types";

type SleepDraft = {
  qualitySummary: string;
  notes: string;
  tagsText: string;
  linkValues: string[];
};

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

function formatSleepWindow(startedAt: string, endedAt: string) {
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

function buildSleepDraft(session: SleepSessionRecord): SleepDraft {
  return {
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
    linkValues: Array.isArray(session.links)
      ? session.links.map((link) => `${link.entityType}:${link.entityId}`)
      : []
  };
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function buildSleepSearchText(session: SleepSessionRecord, draft: SleepDraft) {
  return normalize(
    [
      session.sourceType,
      session.sourceDevice,
      formatSleepWindow(session.startedAt, session.endedAt),
      draft.qualitySummary,
      draft.notes,
      draft.tagsText,
      String(session.sleepScore ?? ""),
      String(session.regularityScore ?? ""),
      typeof session.derived.recoveryState === "string"
        ? session.derived.recoveryState
        : ""
    ].join(" ")
  );
}

function createSleepFilterOptions(
  sessions: SleepSessionRecord[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();

  for (const session of sessions) {
    options.set(`source:${session.sourceType}`, {
      id: `source:${session.sourceType}`,
      label: session.sourceType.replaceAll("_", " "),
      description: "Source type",
      badge: (
        <Badge tone="meta" className="capitalize">
          {session.sourceType.replaceAll("_", " ")}
        </Badge>
      )
    });
    if (typeof session.derived.recoveryState === "string") {
      options.set(`recovery:${session.derived.recoveryState}`, {
        id: `recovery:${session.derived.recoveryState}`,
        label: session.derived.recoveryState,
        description: "Derived recovery state",
        badge: (
          <Badge tone="meta" className="capitalize">
            {session.derived.recoveryState}
          </Badge>
        )
      });
    }
  }

  options.set("linked:yes", {
    id: "linked:yes",
    label: "Linked nights",
    description: "Already tied to Forge or Psyche context",
    badge: <Badge tone="meta">Linked</Badge>
  });
  options.set("linked:no", {
    id: "linked:no",
    label: "Needs links",
    description: "No Forge or Psyche links yet",
    badge: <Badge tone="meta">Needs links</Badge>
  });
  options.set("reflective:yes", {
    id: "reflective:yes",
    label: "Reflected",
    description: "Already has notes, quality summary, tags, or links",
    badge: <Badge tone="meta">Reflected</Badge>
  });
  options.set("reflective:no", {
    id: "reflective:no",
    label: "Needs reflection",
    description: "Still missing reflection context",
    badge: <Badge tone="meta">Needs reflection</Badge>
  });
  options.set("stages:yes", {
    id: "stages:yes",
    label: "Has stage data",
    description: "Night includes sleep stages",
    badge: <Badge tone="meta">Stages</Badge>
  });

  return Array.from(options.values());
}

function matchesSleepFilters(session: SleepSessionRecord, selectedFilterIds: string[]) {
  return selectedFilterIds.every((filterId) => {
    if (filterId.startsWith("source:")) {
      return session.sourceType === filterId.slice("source:".length);
    }
    if (filterId.startsWith("recovery:")) {
      return session.derived.recoveryState === filterId.slice("recovery:".length);
    }
    if (filterId === "linked:yes") {
      return session.links.length > 0;
    }
    if (filterId === "linked:no") {
      return session.links.length === 0;
    }
    if (filterId === "reflective:yes") {
      return (
        (typeof session.annotations.notes === "string" &&
          session.annotations.notes.trim().length > 0) ||
        (typeof session.annotations.qualitySummary === "string" &&
          session.annotations.qualitySummary.trim().length > 0) ||
        (Array.isArray(session.annotations.tags) && session.annotations.tags.length > 0) ||
        session.links.length > 0
      );
    }
    if (filterId === "reflective:no") {
      return (
        (!Array.isArray(session.annotations.tags) ||
          session.annotations.tags.length === 0) &&
        (!(typeof session.annotations.notes === "string") ||
          session.annotations.notes.trim().length === 0) &&
        (!(typeof session.annotations.qualitySummary === "string") ||
          session.annotations.qualitySummary.trim().length === 0) &&
        session.links.length === 0
      );
    }
    if (filterId === "stages:yes") {
      return session.stageBreakdown.length > 0;
    }
    return true;
  });
}

function SleepSessionEditor({
  session,
  draft,
  linkOptions,
  pending,
  step,
  onStepChange,
  onDraftChange,
  onSave
}: {
  session: SleepSessionRecord;
  draft: SleepDraft;
  linkOptions: ReturnType<typeof buildHealthEntityLinkOptions>;
  pending: boolean;
  step: number;
  onStepChange: (next: number) => void;
  onDraftChange: (patch: Partial<SleepDraft>) => void;
  onSave: () => void;
}) {
  const steps = [
    {
      id: "night",
      title: "Night context",
      description: "Inspect the timing, stage data, and quick quality summary."
    },
    {
      id: "reflection",
      title: "Reflection",
      description: "Capture what shaped the night and what it meant."
    },
    {
      id: "links",
      title: "Links",
      description: "Tie the night back to habits, projects, beliefs, patterns, or reports."
    }
  ] as const;

  const efficiency =
    typeof session.derived.efficiency === "number"
      ? session.derived.efficiency
      : session.timeInBedSeconds > 0
        ? session.asleepSeconds / session.timeInBedSeconds
        : 0;
  const restorativeShare =
    typeof session.derived.restorativeShare === "number"
      ? session.derived.restorativeShare
      : 0;

  return (
    <div className="grid gap-5">
      <div className="rounded-[24px] bg-white/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg text-white">
              <MoonStar className="size-4 text-[var(--primary)]" />
              <span>Night review</span>
            </div>
            <div className="mt-2 text-sm text-white/58">
              {formatSleepWindow(session.startedAt, session.endedAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{hoursLabel(session.asleepSeconds)} asleep</Badge>
            <Badge tone="meta">{hoursLabel(session.timeInBedSeconds)} in bed</Badge>
            <Badge tone="meta">Score {session.sleepScore ?? "n/a"}</Badge>
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
                <div className="text-sm text-white/58">Efficiency</div>
                <div className="mt-2 text-lg text-white">
                  {percentLabel(efficiency)}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-sm text-white/58">Restorative share</div>
                <div className="mt-2 text-lg text-white">
                  {percentLabel(restorativeShare)}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.04] p-4">
                <div className="text-sm text-white/58">Recovery state</div>
                <div className="mt-2 text-lg text-white capitalize">
                  {typeof session.derived.recoveryState === "string"
                    ? session.derived.recoveryState
                    : "n/a"}
                </div>
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
                <div className="text-sm text-white/58">Source</div>
                <div className="mt-2 text-lg text-white capitalize">
                  {session.sourceType.replaceAll("_", " ")}
                </div>
              </div>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Quality summary</span>
              <Input
                value={draft.qualitySummary}
                onChange={(event) =>
                  onDraftChange({ qualitySummary: event.target.value })
                }
                placeholder="Restless before sleep but recovered by morning."
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Tags</span>
              <Input
                value={draft.tagsText}
                onChange={(event) => onDraftChange({ tagsText: event.target.value })}
                placeholder="travel, overload, good-routine, late-caffeine"
              />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm text-white/58">
                Reflection, trigger context, habits, or belief patterns
              </span>
              <Textarea
                className="min-h-[180px]"
                value={draft.notes}
                onChange={(event) => onDraftChange({ notes: event.target.value })}
                placeholder="This night followed a late work push, poor wind-down, and rising rumination around the project deadline."
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 grid gap-3">
            <div className="text-sm text-white/58">
              Search habits, goals, beliefs, patterns, projects, or reports and attach the context that explains this night.
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
            ? "Move through the night in steps, then save the reflection once the context is clear."
            : "Everything is ready. Save the night reflection back into Forge."}
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
          <Button type="button" pending={pending} pendingLabel="Saving" onClick={onSave}>
            <Save className="size-4" />
            Save night
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SleepPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SleepDraft>>({});
  const [query, setQuery] = useState("");
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [selectedSleepId, setSelectedSleepId] = useState<string | null>(null);
  const [editorStep, setEditorStep] = useState(0);
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
        sleepQuery.data.sessions.map((session) => [session.id, buildSleepDraft(session)])
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

  const sleep = sleepQuery.data;
  const sessions = sleep?.sessions ?? [];
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
    () => createSleepFilterOptions(sessions),
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
        const draft = drafts[session.id] ?? buildSleepDraft(session);
        const textMatch =
          normalizedQuery.length === 0 ||
          buildSleepSearchText(session, draft).includes(normalizedQuery);
        return textMatch && matchesSleepFilters(session, selectedFilterIds);
      });
  }, [drafts, query, selectedFilterIds, sessions]);
  const resultSummary =
    filteredSessions.length === sessions.length &&
    query.trim().length === 0 &&
    selectedFilterIds.length === 0
      ? `${sessions.length} nights visible`
      : `${filteredSessions.length} of ${sessions.length} nights visible`;
  const activeSession =
    filteredSessions.find((session) => session.id === selectedSleepId) ??
    sessions.find((session) => session.id === selectedSleepId) ??
    null;
  const activeDraft = activeSession
    ? drafts[activeSession.id] ?? buildSleepDraft(activeSession)
    : null;

  const rowVirtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 176,
    overscan: 8
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

  if (sleepQuery.isError || !sleep) {
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
    linkBreakdown
  } = sleep;

  function patchDraft(sessionId: string, patch: Partial<SleepDraft>) {
    setDrafts((current) => {
      const session = sessions.find((entry) => entry.id === sessionId);
      const base = current[sessionId] ?? (session ? buildSleepDraft(session) : {
        qualitySummary: "",
        notes: "",
        tagsText: "",
        linkValues: []
      });
      return {
        ...current,
        [sessionId]: {
          ...base,
          ...patch
        }
      };
    });
  }

  async function saveSleep(sleepId: string) {
    const session = sessions.find((entry) => entry.id === sleepId);
    if (!session) {
      return;
    }
    const draft = drafts[sleepId] ?? buildSleepDraft(session);
    await saveMutation.mutateAsync({
      sleepId,
      qualitySummary: draft.qualitySummary,
      notes: draft.notes,
      tagsText: draft.tagsText,
      linkValues: draft.linkValues
    });
    setSelectedSleepId(null);
    setEditorStep(0);
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="habit"
        title="Sleep"
        description="A reflective sleep surface linking rest, timing, and Psyche-aware context instead of treating nights as disposable telemetry."
        badge={`${sessions.length} nights`}
      />

      <PsycheSectionNav />

      <WorkbenchSection boxId="surface:sleep-index:summary" surfaceId="sleep-index">
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
      </WorkbenchSection>

      <WorkbenchSection boxId="surface:sleep-index:patterns" surfaceId="sleep-index">
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
                    Linked habits, beliefs, projects, and reports will accumulate here.
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
      </WorkbenchSection>

      <WorkbenchSection boxId="surface:sleep-index:browser" surfaceId="sleep-index">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        <FacetedTokenSearch
          title="Night browser"
          description="Search previous nights by source, recovery state, reflective status, or whether they still need links."
          query={query}
          onQueryChange={setQuery}
          options={searchOptions}
          selectedOptionIds={selectedFilterIds}
          onSelectedOptionIdsChange={setSelectedFilterIds}
          resultSummary={resultSummary}
          placeholder="Search nights, devices, summaries, notes, or filter chips"
          emptyStateMessage="Keep typing or pick a filter chip to narrow the sleep history."
        />

        <Card className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Night history
              </div>
              <div className="mt-2 text-lg text-white">
                Open a night to add reflection and links in a guided modal.
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
                No night matches the current search yet. Clear some filters or search by recovery state, device, or reflection text.
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const session = filteredSessions[virtualRow.index]!;
                  const hasReflection =
                    ((typeof session.annotations.notes === "string" &&
                      session.annotations.notes.trim().length > 0) ||
                      (typeof session.annotations.qualitySummary === "string" &&
                        session.annotations.qualitySummary.trim().length > 0) ||
                      (Array.isArray(session.annotations.tags) &&
                        session.annotations.tags.length > 0) ||
                      session.links.length > 0);
                  return (
                    <div
                      key={session.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="absolute left-0 top-0 w-full px-3 py-2"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      <button
                        type="button"
                        className="grid w-full gap-3 rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                        onClick={() => {
                          setSelectedSleepId(session.id);
                          setEditorStep(0);
                        }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-white">
                              <MoonStar className="size-4 shrink-0 text-[var(--primary)]" />
                              <span className="truncate text-base font-medium">
                                {formatSleepWindow(session.startedAt, session.endedAt)}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm text-white/56">
                              <CalendarDays className="size-3.5 shrink-0" />
                              <span className="truncate">
                                {session.sourceType.replaceAll("_", " ")} · {session.sourceDevice}
                              </span>
                            </div>
                          </div>
                          <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-white/70">
                            <span>{hasReflection ? "Reflected" : "Needs reflection"}</span>
                            <ArrowRight className="size-3.5" />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge>{hoursLabel(session.asleepSeconds)} asleep</Badge>
                          <Badge tone="meta">{hoursLabel(session.timeInBedSeconds)} in bed</Badge>
                          <Badge tone="meta">Score {session.sleepScore ?? "n/a"}</Badge>
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
                          {typeof session.derived.recoveryState === "string" ? (
                            <Badge tone="meta" className="capitalize">
                              {session.derived.recoveryState}
                            </Badge>
                          ) : null}
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
              setSelectedSleepId(null);
              setEditorStep(0);
            }
          }}
          eyebrow="Sleep session"
          title="Night reflection"
          description="Capture context without crowding the main sleep surface."
        >
          <SleepSessionEditor
            session={activeSession}
            draft={activeDraft}
            linkOptions={linkOptions}
            pending={
              saveMutation.isPending &&
              saveMutation.variables?.sleepId === activeSession.id
            }
            step={editorStep}
            onStepChange={setEditorStep}
            onDraftChange={(patch) => patchDraft(activeSession.id, patch)}
            onSave={() => void saveSleep(activeSession.id)}
          />
        </SheetScaffold>
      ) : null}
    </div>
  );
}
