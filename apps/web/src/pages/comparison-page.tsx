import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/page-state";
import { getComparison, listComparisonCatalog } from "@/lib/api";
import {
  COMPARISON_FAMILIES,
  type ComparisonAlignment,
  type ComparisonCatalogItem,
  type ComparisonFamily,
  type ComparisonLane,
  type ComparisonPoint
} from "@/lib/comparison-types";

const CATALOG_PAGE_SIZE = 40;
const MAX_SELECTIONS = 8;

const FAMILY_LABELS: Record<ComparisonFamily, string> = {
  preference: "Preferences",
  health: "Health",
  psyche: "Psyche",
  insight: "Insights",
  note: "Notes",
  wiki: "Wiki"
};

function ComparisonError({
  eyebrow,
  error,
  onRetry
}: {
  eyebrow: string;
  error: unknown;
  onRetry: () => void;
}) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Forge could not load this comparison data.";
  return (
    <Card
      role="alert"
      aria-live="assertive"
      className="mx-auto grid w-full max-w-2xl gap-3"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--danger)]">
        {eyebrow}
      </p>
      <h3 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
        This part of the comparison did not load
      </h3>
      <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">{message}</p>
      <div>
        <Button type="button" variant="secondary" size="lg" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Card>
  );
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function canonicalTimeZone(value: string) {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

function defaultDateRange(timeZone: string) {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1_000);
  return {
    from: dateKeyInTimeZone(from, timeZone),
    to: dateKeyInTimeZone(to, timeZone)
  };
}

function parseFamily(value: string | null): ComparisonFamily | undefined {
  return COMPARISON_FAMILIES.find((family) => family === value);
}

function parseAlignment(value: string | null): ComparisonAlignment {
  return value === "shared_axis" ? "shared_axis" : "separate_tracks";
}

function uniqueSelections(searchParams: URLSearchParams) {
  return [
    ...new Set(searchParams.getAll("selection").map((value) => value.trim()))
  ].filter(Boolean);
}

function readablePointValue(point: ComparisonPoint, unit: string | null) {
  if (point.missingReason === "not_stored") return "Not stored";
  if (point.missingReason === "not_recorded") return "Not recorded";
  if (point.value !== null) {
    return unit ? `${point.value} ${unit}` : String(point.value);
  }
  return point.label ?? "Recorded event";
}

type NumericScale = { minimum: number; maximum: number };

function NumericTrack({
  lane,
  scale
}: {
  lane: ComparisonLane;
  scale?: NumericScale;
}) {
  const numericPoints = lane.points.filter(
    (point): point is ComparisonPoint & { value: number } =>
      point.value !== null
  );
  if (numericPoints.length === 0) return null;
  const values = numericPoints.map((point) => point.value);
  const minimum = scale?.minimum ?? Math.min(...values);
  const maximum = scale?.maximum ?? Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  return (
    <div
      className="overflow-x-auto rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4"
      aria-label={`${lane.title} visual timeline`}
    >
      <div
        className="flex h-32 items-end gap-1"
        style={{ minWidth: `${Math.max(480, numericPoints.length * 12)}px` }}
        aria-hidden="true"
      >
        {numericPoints.map((point, index) => {
          const height = 18 + ((point.value - minimum) / span) * 82;
          return (
            <span
              key={`${point.at}-${index}`}
              className="min-w-2 flex-1 rounded-t-full bg-[var(--primary)]/75"
              style={{ height: `${height}%` }}
              title={`${point.dateKey}: ${readablePointValue(point, lane.unit)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-[var(--ui-ink-muted)]">
        <span>{numericPoints[0]?.dateKey}</span>
        <span>
          {minimum}–{maximum}
          {lane.unit ? ` ${lane.unit}` : ""}
        </span>
        <span>{numericPoints.at(-1)?.dateKey}</span>
      </div>
    </div>
  );
}

function ObservationTable({ lane }: { lane: ComparisonLane }) {
  return (
    <details className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]">
      <summary className="interactive-tap flex min-h-11 cursor-pointer items-center px-4 py-3 font-semibold text-[var(--ui-ink-strong)]">
        View all {lane.pointCount} observations and sources
      </summary>
      <div className="overflow-x-auto border-t border-[var(--ui-border-subtle)]">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.12em] text-[var(--ui-ink-muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Value or event</th>
              <th className="px-4 py-3 font-semibold">Evidence</th>
              <th className="px-4 py-3 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {lane.points.map((point, index) => (
              <tr
                key={`${point.at}-${index}`}
                className="border-t border-[var(--ui-border-subtle)] align-top"
              >
                <td className="px-4 py-3 text-[var(--ui-ink)]">
                  <time dateTime={point.at}>{point.dateKey}</time>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--ui-ink-strong)]">
                  {readablePointValue(point, lane.unit)}
                </td>
                <td className="px-4 py-3 text-[var(--ui-ink-muted)]">
                  {point.evidence.length > 0
                    ? point.evidence
                        .map((reference) => reference.label)
                        .join(", ")
                    : "No separate evidence reference"}
                </td>
                <td className="px-4 py-2">
                  {point.source ? (
                    <Link
                      to={point.source.href}
                      className="interactive-tap inline-flex min-h-11 items-center font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
                    >
                      Open source
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-11 items-center text-[var(--ui-ink-muted)]">
                      No source available
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ComparisonLaneCard({
  lane,
  scale,
  onRemove
}: {
  lane: ComparisonLane;
  scale?: NumericScale;
  onRemove: () => void;
}) {
  if (lane.state === "unavailable") {
    return (
      <Card className="grid gap-2 border-dashed">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
          Unavailable selection
        </p>
        <h2 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
          This record is not available
        </h2>
        <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">
          It may have been removed, or your current access may not include it.
          Forge does not reveal which reason applies.
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onRemove}
          >
            Remove this selection
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
            {lane.family ? FAMILY_LABELS[lane.family] : "Forge record"}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
            {lane.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--ui-ink-muted)]">
          <span className="rounded-full bg-[var(--ui-surface-2)] px-3 py-2">
            {lane.pointCount} observations
          </span>
          <span className="rounded-full bg-[var(--ui-surface-2)] px-3 py-2">
            {lane.unit ?? (lane.valueKind === "event" ? "Events" : "No unit")}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>

      {lane.pointCount === 0 && lane.sourceHref ? (
        <div>
          <Link
            to={lane.sourceHref}
            className="interactive-tap inline-flex min-h-11 items-center font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
          >
            Open source
          </Link>
        </div>
      ) : null}

      {lane.limitation ? (
        <p className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-muted)]">
          {lane.limitation}
        </p>
      ) : null}

      {lane.pointCount === 0 ? (
        <p className="rounded-[22px] border border-dashed border-[var(--ui-border-subtle)] p-5 text-sm text-[var(--ui-ink-muted)]">
          No observations were recorded in this date range. Forge has not filled
          the gap with zeroes.
        </p>
      ) : (
        <>
          {lane.valueKind === "number" ? (
            <NumericTrack lane={lane} scale={scale} />
          ) : null}
          <ObservationTable lane={lane} />
        </>
      )}

      {lane.sourceReferencesTruncated ? (
        <p className="text-sm text-[var(--ui-ink-muted)]">
          The observations are complete, but the response reached its separate
          source-reference limit. Open the record for its full evidence history.
        </p>
      ) : null}
    </Card>
  );
}

function CatalogItemRow({
  item,
  selected,
  selectionLimitReached,
  onToggle
}: {
  item: ComparisonCatalogItem;
  selected: boolean;
  selectionLimitReached: boolean;
  onToggle: (item: ComparisonCatalogItem) => void;
}) {
  return (
    <li className="grid gap-3 border-t border-[var(--ui-border-subtle)] py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-[var(--ui-ink-strong)]">
            {item.title}
          </h3>
          <span className="rounded-full bg-[var(--ui-surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--ui-ink-muted)]">
            {FAMILY_LABELS[item.family]}
          </span>
          {item.unit ? (
            <span className="text-xs text-[var(--ui-ink-muted)]">
              {item.unit}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
          {item.description}
        </p>
        {item.availability === "current_only" ? (
          <p className="mt-1 text-xs font-medium text-[var(--ui-ink-muted)]">
            Current record only; Forge does not have historical value snapshots.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 w-full sm:w-auto"
        data-comparison-selector={item.selector}
        disabled={!selected && selectionLimitReached}
        aria-pressed={selected}
        onClick={() => onToggle(item)}
      >
        {selected ? "Remove" : "Add to comparison"}
      </Button>
    </li>
  );
}

export function ComparisonPage() {
  const shell = useForgeShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const exactUserId = selectedUserIds.length === 1 ? selectedUserIds[0] : null;
  const defaultTimeZone = useMemo(
    () =>
      canonicalTimeZone(
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      ) ?? "UTC",
    []
  );
  const timeZoneParameter = searchParams.get("timeZone");
  const requestedTimeZone = timeZoneParameter?.trim() ?? "";
  const canonicalRequestedTimeZone = requestedTimeZone
    ? canonicalTimeZone(requestedTimeZone)
    : null;
  const timeZoneValid =
    requestedTimeZone.length === 0 || canonicalRequestedTimeZone !== null;
  const timeZone = canonicalRequestedTimeZone ?? defaultTimeZone;
  const defaults = useMemo(() => defaultDateRange(timeZone), [timeZone]);
  const requestedFrom = searchParams.get("from")?.trim() ?? "";
  const requestedTo = searchParams.get("to")?.trim() ?? "";
  const from = requestedFrom || defaults.from;
  const to = requestedTo || defaults.to;
  const fromValid = isDateKey(from);
  const toValid = isDateKey(to);
  const alignment = parseAlignment(searchParams.get("alignment"));
  const query = searchParams.get("query")?.trim() ?? "";
  const family = parseFamily(searchParams.get("family"));
  const selections = uniqueSelections(searchParams);
  const [searchDraft, setSearchDraft] = useState(query);
  const pendingFocusSelector = useRef<string | null>(null);

  useEffect(() => setSearchDraft(query), [query]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!requestedTimeZone) {
      next.set("timeZone", defaultTimeZone);
      changed = true;
    } else if (
      canonicalRequestedTimeZone &&
      timeZoneParameter !== canonicalRequestedTimeZone
    ) {
      next.set("timeZone", canonicalRequestedTimeZone);
      changed = true;
    }
    if (!requestedFrom) {
      next.set("from", defaults.from);
      changed = true;
    }
    if (!requestedTo) {
      next.set("to", defaults.to);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [
    canonicalRequestedTimeZone,
    defaultTimeZone,
    defaults.from,
    defaults.to,
    requestedFrom,
    requestedTimeZone,
    requestedTo,
    searchParams,
    setSearchParams,
    timeZoneParameter
  ]);

  useLayoutEffect(() => {
    const selector = pendingFocusSelector.current;
    if (!selector) return;
    const catalogButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-comparison-selector]"
      )
    ).find((button) => button.dataset.comparisonSelector === selector);
    const fallback = document.getElementById("comparison-results-title");
    (catalogButton ?? fallback)?.focus();
    pendingFocusSelector.current = null;
  }, [searchParams]);

  const dateRangeValid = fromValid && toValid && from <= to;
  const selectionCountValid =
    selections.length > 0 && selections.length <= MAX_SELECTIONS;
  const canQueryComparison = Boolean(
    exactUserId && timeZoneValid && dateRangeValid && selectionCountValid
  );

  const catalogQuery = useInfiniteQuery({
    queryKey: ["comparison-catalog", exactUserId, query, family ?? "all"],
    initialPageParam: null as string | null,
    enabled: Boolean(exactUserId),
    queryFn: ({ pageParam, signal }) =>
      listComparisonCatalog({
        userId: exactUserId!,
        query: query || undefined,
        family,
        limit: CATALOG_PAGE_SIZE,
        cursor: pageParam ?? undefined,
        signal
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    retry: false
  });
  const comparisonQuery = useQuery({
    queryKey: [
      "comparison",
      exactUserId,
      from,
      to,
      timeZone,
      alignment,
      ...selections
    ],
    enabled: canQueryComparison,
    queryFn: ({ signal }) =>
      getComparison({
        userId: exactUserId!,
        selections,
        from,
        to,
        timeZone,
        alignment,
        signal
      }),
    retry: false
  });

  const catalogItems = useMemo(
    () => catalogQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogQuery.data]
  );
  const catalogTotal = catalogQuery.data?.pages[0]?.total ?? 0;
  const sharedNumericScale = useMemo<NumericScale | undefined>(() => {
    const response = comparisonQuery.data;
    if (!response || response.alignmentApplied !== "shared_axis")
      return undefined;
    const values = response.lanes.flatMap((lane) =>
      lane.points.flatMap((point) =>
        typeof point.value === "number" ? [point.value] : []
      )
    );
    return values.length > 0
      ? { minimum: Math.min(...values), maximum: Math.max(...values) }
      : undefined;
  }, [comparisonQuery.data]);

  function updateSearchParams(
    apply: (next: URLSearchParams) => void,
    options?: { replace?: boolean }
  ) {
    const next = new URLSearchParams(searchParams);
    apply(next);
    setSearchParams(next, options);
  }

  function toggleSelection(item: ComparisonCatalogItem) {
    const selected = selections.includes(item.selector);
    if (selected) pendingFocusSelector.current = item.selector;
    const nextSelections = selected
      ? selections.filter((selection) => selection !== item.selector)
      : selections.length < MAX_SELECTIONS
        ? [...selections, item.selector]
        : selections;
    updateSearchParams((next) => {
      next.delete("selection");
      for (const selection of nextSelections)
        next.append("selection", selection);
    });
  }

  function removeSelection(selector: string) {
    pendingFocusSelector.current = selector;
    updateSearchParams((next) => {
      next.delete("selection");
      for (const selection of selections) {
        if (selection !== selector) next.append("selection", selection);
      }
    });
  }

  const userScopeMessage =
    selectedUserIds.length === 0
      ? "Choose one person in the Forge user selector before comparing records."
      : "Choose exactly one person. Forge will not mix records from several people in one comparison.";

  return (
    <div className="grid gap-5">
      <PageHero
        title="Compare records"
        description="Compare selected records on one timeline while keeping each record’s original unit and source."
        badge={
          selections.length > 0
            ? `${selections.length} of ${MAX_SELECTIONS} selected`
            : "No records selected"
        }
      />

      {!exactUserId ? (
        <Card className="grid gap-2" role="status" aria-live="polite">
          <h2 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
            One person is required
          </h2>
          <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">
            {userScopeMessage}
          </p>
        </Card>
      ) : (
        <>
          <Card className="grid gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                Comparison range
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                Forge keeps missing observations as gaps and never treats them
                as zero. Dates use {timeZone}.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                From
                <Input
                  type="date"
                  value={fromValid ? from : ""}
                  onChange={(event) =>
                    updateSearchParams((next) =>
                      next.set("from", event.target.value)
                    )
                  }
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                Through
                <Input
                  type="date"
                  value={toValid ? to : ""}
                  onChange={(event) =>
                    updateSearchParams((next) =>
                      next.set("to", event.target.value)
                    )
                  }
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                Scale
                <select
                  className="interactive-tap min-h-11 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm text-[var(--ui-ink-strong)] outline-none focus:border-[var(--primary)]/50"
                  value={alignment}
                  onChange={(event) =>
                    updateSearchParams((next) =>
                      next.set("alignment", event.target.value)
                    )
                  }
                >
                  <option value="separate_tracks">Keep original scales</option>
                  <option value="shared_axis">
                    Use one scale when units match
                  </option>
                </select>
              </label>
            </div>
            {!timeZoneValid ? (
              <div className="grid gap-3" role="alert">
                <p className="text-sm font-semibold text-[var(--danger)]">
                  The time zone in this link is not valid. Use this device’s
                  time zone to continue.
                </p>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() =>
                      updateSearchParams((next) =>
                        next.set("timeZone", defaultTimeZone)
                      )
                    }
                  >
                    Use this device’s time zone
                  </Button>
                </div>
              </div>
            ) : null}
            {!fromValid || !toValid ? (
              <p
                className="text-sm font-semibold text-[var(--danger)]"
                role="alert"
              >
                The dates in this link are not valid. Choose a valid start and
                end date.
              </p>
            ) : from > to ? (
              <p
                className="text-sm font-semibold text-[var(--danger)]"
                role="alert"
              >
                The start date must be on or before the end date.
              </p>
            ) : null}
            {selections.length > MAX_SELECTIONS ? (
              <div className="grid gap-3" role="alert">
                <p className="text-sm font-semibold text-[var(--danger)]">
                  Remove {selections.length - MAX_SELECTIONS} selection
                  {selections.length - MAX_SELECTIONS === 1 ? "" : "s"}. A
                  comparison can contain at most {MAX_SELECTIONS} records.
                </p>
                <div className="flex flex-wrap gap-2">
                  {selections.map((selection, index) => (
                    <Button
                      key={selection}
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => removeSelection(selection)}
                    >
                      Remove selected record {index + 1}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="grid gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
                Add records
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                Search only the records you can open for the selected person.
              </p>
            </div>
            <form
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.35fr)_auto] md:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                updateSearchParams(
                  (next) => {
                    if (searchDraft.trim())
                      next.set("query", searchDraft.trim());
                    else next.delete("query");
                  },
                  { replace: true }
                );
              }}
            >
              <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                Find a record
                <Input
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Name or description"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                Record family
                <select
                  className="interactive-tap min-h-11 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 text-sm text-[var(--ui-ink-strong)] outline-none focus:border-[var(--primary)]/50"
                  value={family ?? ""}
                  onChange={(event) =>
                    updateSearchParams(
                      (next) => {
                        if (event.target.value)
                          next.set("family", event.target.value);
                        else next.delete("family");
                      },
                      { replace: true }
                    )
                  }
                >
                  <option value="">All families</option>
                  {COMPARISON_FAMILIES.map((option) => (
                    <option key={option} value={option}>
                      {FAMILY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="min-h-11 w-full md:w-auto">
                Apply search
              </Button>
            </form>

            {catalogQuery.isLoading ? (
              <LoadingState
                eyebrow="Available records"
                title="Loading records"
                description="Checking the selected person’s records and your current access."
              />
            ) : catalogQuery.isError ? (
              <ComparisonError
                eyebrow="Available records"
                error={catalogQuery.error}
                onRetry={() => void catalogQuery.refetch()}
              />
            ) : catalogItems.length === 0 ? (
              <p className="rounded-[22px] border border-dashed border-[var(--ui-border-subtle)] p-5 text-sm text-[var(--ui-ink-muted)]">
                No available records match this search. Try a different name or
                record family.
              </p>
            ) : (
              <>
                <p
                  className="text-xs font-medium text-[var(--ui-ink-muted)]"
                  aria-live="polite"
                >
                  Showing {catalogItems.length} of {catalogTotal} available
                  records.
                </p>
                <ul>
                  {catalogItems.map((item) => (
                    <CatalogItemRow
                      key={item.selector}
                      item={item}
                      selected={selections.includes(item.selector)}
                      selectionLimitReached={
                        selections.length >= MAX_SELECTIONS
                      }
                      onToggle={toggleSelection}
                    />
                  ))}
                </ul>
                {catalogQuery.hasNextPage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11 w-full sm:w-auto"
                    disabled={catalogQuery.isFetchingNextPage}
                    onClick={() => void catalogQuery.fetchNextPage()}
                  >
                    {catalogQuery.isFetchingNextPage
                      ? "Loading more records…"
                      : "Load more records"}
                  </Button>
                ) : null}
              </>
            )}
          </Card>

          <section
            className="grid gap-4"
            aria-labelledby="comparison-results-title"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2
                  id="comparison-results-title"
                  tabIndex={-1}
                  className="text-2xl font-semibold text-[var(--ui-ink-strong)]"
                >
                  Comparison
                </h2>
                <p className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                  {selections.length === 0
                    ? "Add at least one record to begin."
                    : `${selections.length} selected record${selections.length === 1 ? "" : "s"}, ${from} through ${to}.`}
                </p>
              </div>
            </div>

            {selections.length === 0 ? (
              <Card className="border-dashed text-sm text-[var(--ui-ink-muted)]">
                Choose a record above. Forge will keep its original unit,
                missing observations, and source links visible.
              </Card>
            ) : !selectionCountValid ||
              !dateRangeValid ? null : comparisonQuery.isLoading ? (
              <LoadingState
                eyebrow="Comparison"
                title="Loading the timeline"
                description="Reading the selected records without changing their units or filling gaps."
              />
            ) : comparisonQuery.isError ? (
              <ComparisonError
                eyebrow="Comparison"
                error={comparisonQuery.error}
                onRetry={() => void comparisonQuery.refetch()}
              />
            ) : comparisonQuery.data ? (
              <>
                <Card
                  className="grid gap-1 text-sm"
                  role="status"
                  aria-live="polite"
                >
                  <p className="font-semibold text-[var(--ui-ink-strong)]">
                    {comparisonQuery.data.alignmentApplied === "shared_axis"
                      ? "One shared scale is in use."
                      : "Each record keeps its own scale."}
                  </p>
                  {comparisonQuery.data.sharedAxisReason ? (
                    <p className="text-[var(--ui-ink-muted)]">
                      {comparisonQuery.data.sharedAxisReason}
                    </p>
                  ) : null}
                  <p className="text-[var(--ui-ink-muted)]">
                    {comparisonQuery.data.totals.pointCount} observations across{" "}
                    {comparisonQuery.data.totals.laneCount} record
                    {comparisonQuery.data.totals.laneCount === 1 ? "" : "s"}.
                  </p>
                </Card>
                {comparisonQuery.data.lanes.map((lane) => (
                  <ComparisonLaneCard
                    key={lane.selector}
                    lane={lane}
                    scale={sharedNumericScale}
                    onRemove={() => removeSelection(lane.selector)}
                  />
                ))}
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
