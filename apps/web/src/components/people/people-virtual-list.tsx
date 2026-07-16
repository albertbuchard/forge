import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FreshnessBadge } from "@/components/people/people-status";
import { cn } from "@/lib/utils";
import type { PersonSummary } from "@/components/people/people-types";

const PEOPLE_ROW_SIZE = 96;
const PEOPLE_PAGE_JUMP = 8;
const PEOPLE_SCROLL_RESTORATION_LIMIT = 40;
const peopleScrollOffsets = new Map<string, number>();

function rememberPeopleScrollOffset(key: string, offset: number) {
  peopleScrollOffsets.delete(key);
  peopleScrollOffsets.set(key, offset);
  if (peopleScrollOffsets.size <= PEOPLE_SCROLL_RESTORATION_LIMIT) {
    return;
  }
  const oldestKey = peopleScrollOffsets.keys().next().value;
  if (oldestKey) {
    peopleScrollOffsets.delete(oldestKey);
  }
}

function initials(value: string) {
  const result = value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
  return result || "?";
}

function personResultId(person: PersonSummary) {
  return `people-result-${encodeURIComponent(person.id)}`;
}

function connectionLabel(person: PersonSummary) {
  switch (person.connectionState) {
    case "local_only":
      return "Local only";
    case "invited":
      return "Invitation open";
    case "pending":
      return "Review pending";
    case "paired":
      return "Paired";
    case "paused":
      return "Paused";
    case "conflict":
      return "Grant conflict";
    case "revoked":
      return "Revoked";
    case "unknown":
      return null;
  }
}

function hasMeaningfulFreshness(person: PersonSummary) {
  return !(
    person.connectionState === "unknown" &&
    person.freshnessState === "unavailable" &&
    person.sourceLabel === "Local Person record"
  );
}

function meaningfulSupportingText(person: PersonSummary) {
  if (person.shortDescription) {
    return person.shortDescription;
  }
  return person.sourceLabel === "Local Person record"
    ? null
    : person.sourceLabel;
}

export function PeopleVirtualList({
  people,
  total,
  selectedPersonId,
  hasNextPage,
  fetchingNextPage,
  busy,
  restorationKey = "people-collection",
  onLoadMore,
  onSelect
}: {
  people: PersonSummary[];
  total: number | null;
  selectedPersonId: string | null;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  busy: boolean;
  restorationKey?: string;
  onLoadMore: () => void;
  onSelect: (personId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restorationKeyRef = useRef(restorationKey);
  const pendingRestoredOffsetRef = useRef<number | null>(null);
  const lastAutoScrolledSelectionRef = useRef<string | null>(null);
  const selectedIndex = useMemo(
    () => people.findIndex((person) => person.id === selectedPersonId),
    [people, selectedPersonId]
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    selectedIndex >= 0 ? selectedIndex : 0
  );
  const itemCount = people.length + (hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PEOPLE_ROW_SIZE,
    getItemKey: (index) => people[index]?.id ?? "people-load-more",
    initialOffset: peopleScrollOffsets.get(restorationKey) ?? 0,
    overscan: 10
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows.at(-1)?.index ?? -1;
  const firstRenderedPersonIndex =
    virtualRows.find((row) => row.index < people.length)?.index ?? -1;
  const activeIndexIsRendered = virtualRows.some(
    (row) => row.index === activeIndex && row.index < people.length
  );
  const navigationActiveIndex = activeIndexIsRendered
    ? activeIndex
    : firstRenderedPersonIndex >= 0
      ? firstRenderedPersonIndex
      : activeIndex;
  const activeDescendantId = people[navigationActiveIndex]
    ? personResultId(people[navigationActiveIndex])
    : undefined;

  useLayoutEffect(() => {
    const previousKey = restorationKeyRef.current;
    if (previousKey === restorationKey) {
      return;
    }

    const scrollElement = scrollRef.current;
    if (scrollElement) {
      rememberPeopleScrollOffset(previousKey, scrollElement.scrollTop);
    }
    restorationKeyRef.current = restorationKey;

    const restoredOffset = peopleScrollOffsets.get(restorationKey) ?? 0;
    pendingRestoredOffsetRef.current = restoredOffset;
    if (scrollElement) {
      scrollElement.scrollTop = 0;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [people.length, restorationKey, selectedIndex, virtualizer]);

  useLayoutEffect(() => {
    const desiredOffset = pendingRestoredOffsetRef.current;
    if (desiredOffset === null) {
      return;
    }
    const maximumLoadedOffset = Math.max(
      0,
      (people.length - 1) * PEOPLE_ROW_SIZE
    );
    if (desiredOffset > maximumLoadedOffset && busy) {
      return;
    }
    const restoredOffset = Math.min(desiredOffset, maximumLoadedOffset);
    pendingRestoredOffsetRef.current = null;
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      scrollElement.scrollTop = restoredOffset;
    }
    virtualizer.scrollToOffset(restoredOffset, { align: "start" });
    setActiveIndex(
      selectedIndex >= 0
        ? selectedIndex
        : Math.max(
            0,
            Math.min(
              Math.floor(restoredOffset / PEOPLE_ROW_SIZE),
              Math.max(0, people.length - 1)
            )
          )
    );
  }, [busy, people.length, selectedIndex, virtualizer]);

  useEffect(() => {
    if (
      hasNextPage &&
      !fetchingNextPage &&
      lastVirtualIndex >= Math.max(0, people.length - 4)
    ) {
      onLoadMore();
    }
  }, [
    fetchingNextPage,
    hasNextPage,
    lastVirtualIndex,
    onLoadMore,
    people.length
  ]);

  useEffect(() => {
    if (people.length === 0) {
      setActiveIndex(0);
      lastAutoScrolledSelectionRef.current = null;
      return;
    }
    if (
      selectedPersonId &&
      selectedIndex >= 0 &&
      lastAutoScrolledSelectionRef.current !== selectedPersonId
    ) {
      lastAutoScrolledSelectionRef.current = selectedPersonId;
      setActiveIndex(selectedIndex);
      virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
      return;
    }
    if (!selectedPersonId) {
      lastAutoScrolledSelectionRef.current = null;
    }
    setActiveIndex((current) => Math.min(current, people.length - 1));
  }, [people.length, selectedIndex, selectedPersonId, virtualizer]);

  const moveActive = (nextIndex: number) => {
    if (people.length === 0) {
      return;
    }
    const boundedIndex = Math.max(0, Math.min(nextIndex, people.length - 1));
    setActiveIndex(boundedIndex);
    virtualizer.scrollToIndex(boundedIndex, { align: "auto" });
  };

  return (
    <div className="min-w-0">
      <p id="people-list-keyboard-help" className="sr-only">
        Use arrow, Page Up, Page Down, Home, and End keys to move through
        results. Press Enter to open the active person.
      </p>
      <div
        ref={scrollRef}
        role="group"
        aria-label="People result navigation"
        tabIndex={0}
        data-testid="people-virtual-scroll"
        className="h-[calc(100dvh-22rem)] min-h-[22rem] max-h-[46rem] overflow-y-auto overscroll-contain rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]"
        aria-describedby="people-list-keyboard-help people-active-person"
        aria-activedescendant={activeDescendantId}
        onScroll={(event) => {
          rememberPeopleScrollOffset(
            restorationKey,
            event.currentTarget.scrollTop
          );
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveActive(navigationActiveIndex + 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(navigationActiveIndex - 1);
          } else if (event.key === "PageDown") {
            event.preventDefault();
            moveActive(navigationActiveIndex + PEOPLE_PAGE_JUMP);
          } else if (event.key === "PageUp") {
            event.preventDefault();
            moveActive(navigationActiveIndex - PEOPLE_PAGE_JUMP);
          } else if (event.key === "Home") {
            event.preventDefault();
            moveActive(0);
          } else if (event.key === "End") {
            event.preventDefault();
            moveActive(people.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            const activePerson = people[navigationActiveIndex];
            if (activePerson) {
              event.preventDefault();
              onSelect(activePerson.id);
            }
          }
        }}
      >
        <div
          id="people-collection-list"
          role="list"
          aria-label="People results"
          aria-busy={busy || fetchingNextPage}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%"
          }}
        >
          {virtualRows.map((virtualRow) => {
            const person = people[virtualRow.index];
            if (!person) {
              return (
                <div
                  key={virtualRow.key}
                  role="listitem"
                  className="absolute left-0 top-0 flex h-24 w-full items-center justify-center text-sm text-[var(--ui-ink-muted)]"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {fetchingNextPage ? "Loading more people..." : "More people"}
                </div>
              );
            }
            const selected = person.id === selectedPersonId;
            const active = virtualRow.index === navigationActiveIndex;
            const knownConnectionLabel = connectionLabel(person);
            const showFreshness = hasMeaningfulFreshness(person);
            const supportingText = meaningfulSupportingText(person);
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                role="listitem"
                data-index={virtualRow.index}
                data-person-id={person.id}
                data-virtual-key={String(virtualRow.key)}
                aria-posinset={virtualRow.index + 1}
                aria-setsize={total ?? undefined}
                className="absolute left-0 top-0 h-24 w-full px-1 py-1"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <button
                  id={personResultId(person)}
                  type="button"
                  tabIndex={-1}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`Open ${person.displayName}`}
                  onMouseMove={() => setActiveIndex(virtualRow.index)}
                  onClick={() => onSelect(person.id)}
                  className={cn(
                    "grid h-full w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]",
                    selected
                      ? "border-[color-mix(in_srgb,var(--primary)_42%,var(--ui-border-subtle)_58%)] bg-[var(--ui-accent-soft)]"
                      : active
                        ? "border-[var(--ui-border-strong)] bg-[var(--ui-surface-hover)]"
                        : "border-transparent bg-transparent hover:border-[var(--ui-border-subtle)] hover:bg-[var(--ui-surface-hover)]"
                  )}
                >
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-sm font-semibold text-[var(--ui-ink-strong)]"
                    aria-hidden="true"
                  >
                    {initials(person.displayName)}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                        {person.displayName}
                      </span>
                      {(person.pendingRequestCount ?? 0) > 0 ? (
                        <Badge size="xs" tone="signal">
                          {person.pendingRequestCount} pending
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs text-[var(--ui-ink-muted)]">
                        {person.relationshipLabel ??
                          person.relationshipCategory}
                      </span>
                      {knownConnectionLabel ? (
                        <>
                          <span
                            className="text-[var(--ui-ink-faint)]"
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span className="truncate text-xs text-[var(--ui-ink-muted)]">
                            {knownConnectionLabel}
                          </span>
                        </>
                      ) : null}
                    </span>
                    {showFreshness || supportingText ? (
                      <span className="mt-1 flex min-w-0 items-center gap-2">
                        {showFreshness ? (
                          <FreshnessBadge
                            state={person.freshnessState}
                            label={person.freshnessLabel}
                          />
                        ) : null}
                        {supportingText ? (
                          <span
                            className="truncate text-[11px] text-[var(--ui-ink-faint)]"
                            title={supportingText}
                          >
                            {supportingText}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    className="size-4 text-[var(--ui-ink-faint)]"
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div
        id="people-active-person"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {people[navigationActiveIndex]
          ? `${people[navigationActiveIndex].displayName}, result ${navigationActiveIndex + 1}${total === null ? "" : ` of ${total}`}`
          : total === null
            ? `${people.length} loaded results`
            : `${total} results`}
      </div>
    </div>
  );
}
