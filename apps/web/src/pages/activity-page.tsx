import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { ActivityTable } from "@/components/activity-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { listActivity, removeActivityLog } from "@/lib/api";
import {
  getExclusiveActivityEndDate,
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import {
  getActivityEventCtaLabel,
  getActivityEventHref
} from "@/lib/entity-links";
import { formatDateTime } from "@/lib/utils";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";

export function ActivityPage() {
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const entityId = searchParams.get("entityId") ?? undefined;
  const entityType = searchParams.get("entityType") ?? undefined;
  const source = searchParams.get("source") as
    | "ui"
    | "openclaw"
    | "agent"
    | "system"
    | null;
  const from = searchParams.get("from") ?? "";
  const through = searchParams.get("through") ?? "";
  const includeCorrected = searchParams.get("includeCorrected") === "true";
  const highlightedEventId = searchParams.get("eventId");
  const activityQuery = useQuery({
    queryKey: [
      "activity-archive",
      entityType,
      entityId,
      source,
      from,
      through,
      includeCorrected,
      ...selectedUserIds
    ],
    queryFn: () =>
      listActivity({
        limit: 100,
        entityType,
        entityId,
        source: source ?? undefined,
        from: from || undefined,
        to: through ? getExclusiveActivityEndDate(through) : undefined,
        includeCorrected,
        userIds: selectedUserIds
      })
  });
  const removeEventMutation = useMutation({
    mutationFn: (eventId: string) => removeActivityLog(eventId),
    onMutate: () => setRemoveError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activity-archive"] }),
        invalidateForgeSnapshot(queryClient),
        queryClient.invalidateQueries({ queryKey: ["task-context"] }),
        queryClient.invalidateQueries({ queryKey: ["project-board"] })
      ]);
    },
    onError: (error) => {
      setRemoveError(
        error instanceof Error
          ? error.message
          : "Forge could not remove that activity entry."
      );
    }
  });

  const rows = activityQuery.data?.activity ?? [];
  const visibleRows = (() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((event) =>
      [
        getReadableActivityTitle(event),
        getReadableActivityDescription(event),
        event.source,
        event.user?.displayName ?? ""
      ].some((value) => value.toLocaleLowerCase().includes(query))
    );
  })();

  function updateFilter(key: string, value: string | boolean) {
    const next = new URLSearchParams(searchParams);
    if (value === "" || value === false) {
      next.delete(key);
    } else {
      next.set(key, value === true ? "true" : value);
    }
    setSearchParams(next, { replace: true });
  }

  function resetFilters() {
    const next = new URLSearchParams();
    if (entityId) {
      next.set("entityId", entityId);
    }
    if (highlightedEventId) {
      next.set("eventId", highlightedEventId);
    }
    setSearchText("");
    setSearchParams(next, { replace: true });
  }

  if (activityQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Evidence archive"
        title="Loading activity"
        description="Pulling the visible audit trail, grouped evidence, and correction history."
      />
    );
  }

  if (activityQuery.isError) {
    return (
      <ErrorState
        eyebrow="Evidence archive"
        error={activityQuery.error}
        onRetry={() => void activityQuery.refetch()}
      />
    );
  }

  const grouped = visibleRows.reduce<Record<string, typeof visibleRows>>(
    (accumulator, event) => {
      const key = event.createdAt.slice(0, 10);
      accumulator[key] = [...(accumulator[key] ?? []), event];
      return accumulator;
    },
    {}
  );

  return (
    <div className="grid gap-5">
      <PageHero
        title="Activity"
        description={
          entityId
            ? "This filtered archive shows the evidence connected to the item you opened, so you can confirm what changed and when."
            : "Activity is your visible audit trail. Use it to inspect progress, confirm corrections, and trace work back to the goal, project, or task it came from."
        }
        badge={`${visibleRows.length} of ${rows.length} events`}
      />

      <Card className="min-w-0">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(12rem,1fr)_repeat(4,minmax(9rem,0.55fr))_auto] lg:items-end">
          <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            Search visible activity
            <Input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Title, evidence, source, or owner"
            />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            Source
            <select
              value={source ?? ""}
              onChange={(event) => updateFilter("source", event.target.value)}
              className="interactive-tap min-h-12 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm text-[var(--ui-ink-strong)] outline-none focus:border-[var(--primary)]/35"
            >
              <option value="">All sources</option>
              <option value="ui">Forge UI</option>
              <option value="agent">Agent</option>
              <option value="openclaw">OpenClaw</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            Entity type
            <select
              value={entityType ?? ""}
              onChange={(event) =>
                updateFilter("entityType", event.target.value)
              }
              disabled={Boolean(entityId)}
              className="interactive-tap min-h-12 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm text-[var(--ui-ink-strong)] outline-none focus:border-[var(--primary)]/35 disabled:opacity-60"
            >
              <option value="">All entity types</option>
              <option value="task">Tasks</option>
              <option value="task_run">Task runs</option>
              <option value="project">Projects</option>
              <option value="goal">Goals</option>
              <option value="habit">Habits</option>
              <option value="insight">Insights</option>
              <option value="agent_action">Agent actions</option>
              <option value="calendar_connection">Calendar sync</option>
              <option value="sleep_session">Sleep</option>
              <option value="workout_session">Workouts</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            From
            <Input
              type="date"
              value={from}
              onChange={(event) => updateFilter("from", event.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
            Through
            <Input
              type="date"
              value={through}
              min={from || undefined}
              onChange={(event) => updateFilter("through", event.target.value)}
            />
          </label>
          <Button type="button" variant="secondary" onClick={resetFilters}>
            Reset
          </Button>
        </div>
        <label className="mt-4 flex min-h-10 items-center gap-3 text-sm text-[var(--ui-ink-soft)]">
          <input
            type="checkbox"
            checked={includeCorrected}
            onChange={(event) =>
              updateFilter("includeCorrected", event.target.checked)
            }
            className="size-4 accent-[var(--primary)]"
          />
          Show corrected and correction entries
        </label>
      </Card>

      {removeError ? (
        <div
          role="alert"
          className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {removeError}
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <EmptyState
          eyebrow="Evidence archive"
          title={rows.length === 0 ? "No activity matched" : "No visible match"}
          description={
            rows.length === 0
              ? "No events fall inside the current source, entity, date, and correction filters."
              : "The bounded archive loaded, but no visible event matches this search."
          }
          action={
            <Button type="button" variant="secondary" onClick={resetFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <ActivityTable
            rows={visibleRows}
            removingEventId={
              removeEventMutation.isPending
                ? (removeEventMutation.variables ?? null)
                : null
            }
            onRemove={async (eventId) => {
              await removeEventMutation.mutateAsync(eventId);
            }}
          />
          <div className="grid gap-4">
            {Object.entries(grouped)
              .slice(0, 6)
              .map(([day, events]) => (
                <Card key={day} className="min-w-0">
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    {day}
                  </div>
                  <div className="mt-4 grid gap-3">
                    {events.slice(0, 3).map((event) => (
                      <div
                        key={event.id}
                        className={`min-w-0 rounded-[18px] border p-4 ${
                          highlightedEventId === event.id
                            ? "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--ui-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_16%,transparent)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]"
                        }`}
                      >
                        <div className="break-words font-medium text-[var(--ui-ink-strong)]">
                          {getReadableActivityTitle(event)}
                        </div>
                        <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
                          {getReadableActivityDescription(event)}
                        </div>
                        <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                          {formatDateTime(event.createdAt)}
                        </div>
                        {getActivityEventHref(event) &&
                        getActivityEventCtaLabel(event) ? (
                          <Link
                            to={getActivityEventHref(event)!}
                            className="mt-3 inline-flex text-[11px] uppercase tracking-[0.16em] text-[var(--primary)] transition hover:text-[var(--ui-ink-strong)]"
                          >
                            {getActivityEventCtaLabel(event)}
                          </Link>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
