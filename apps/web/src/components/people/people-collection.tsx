import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  UserRoundPlus,
  UsersRound
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  ConnectionBanner,
  InlineEmpty,
  PeopleStateBanner
} from "@/components/people/people-status";
import { PeopleVirtualList } from "@/components/people/people-virtual-list";
import { useDelayedFlag } from "@/components/people/use-delayed-flag";
import type {
  PeopleCollectionFilters,
  PeopleCollectionPage,
  PersonConnectionState,
  PersonImportance,
  PersonRelationshipCategory
} from "@/components/people/people-types";

const PEOPLE_PAGE_SIZE = 100;

export const DEFAULT_PEOPLE_FILTERS: PeopleCollectionFilters = {
  query: "",
  relationship: "any",
  importance: "any",
  connection: "any",
  freshness: "any",
  recentContact: "any",
  sort: "name"
};

function SelectControl<TValue extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<{ value: TValue; label: string }>;
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-xs font-medium text-[var(--ui-ink-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--ui-ring)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CollectionSkeleton({ slow }: { slow: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading people"
      className="grid min-h-[22rem] gap-2 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-[5.5rem] animate-pulse rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] motion-reduce:animate-none"
        />
      ))}
      <span className="sr-only">
        {slow
          ? "People are taking longer than expected to load."
          : "Loading People results..."}
      </span>
      {slow ? (
        <p className="self-end px-3 pb-2 text-center text-xs text-[var(--ui-ink-muted)]">
          Still loading. Your list will stay in place while Forge reconnects.
        </p>
      ) : null}
    </div>
  );
}

export function PeopleCollection({
  selectedPersonId,
  onSelectPerson,
  onAddPerson
}: {
  selectedPersonId: string | null;
  onSelectPerson: (personId: string) => void;
  onAddPerson: () => void;
}) {
  const gateway = usePeopleGateway();
  const [filters, setFilters] = useState<PeopleCollectionFilters>(
    DEFAULT_PEOPLE_FILTERS
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const deferredQuery = useDeferredValue(filters.query.trim());
  const requestFilters = useMemo(
    () => ({ ...filters, query: deferredQuery }),
    [deferredQuery, filters]
  );

  const collectionQuery = useInfiniteQuery<PeopleCollectionPage>({
    queryKey: ["people", "collection", requestFilters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      gateway.listPeople({
        ...requestFilters,
        cursor: typeof pageParam === "string" ? pageParam : undefined,
        limit: PEOPLE_PAGE_SIZE
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    placeholderData: (previousData) => previousData
  });

  const people = useMemo(() => {
    const uniquePeople = new Map<
      string,
      PeopleCollectionPage["people"][number]
    >();
    for (const person of collectionQuery.data?.pages.flatMap(
      (page) => page.people
    ) ?? []) {
      if (!uniquePeople.has(person.id)) {
        uniquePeople.set(person.id, person);
      }
    }
    return [...uniquePeople.values()];
  }, [collectionQuery.data?.pages]);
  const firstPage = collectionQuery.data?.pages[0];
  const total = firstPage?.total ?? null;
  const partial =
    collectionQuery.data?.pages.some((page) => page.partial) ?? false;
  const hasFilters =
    requestFilters.query.length > 0 ||
    requestFilters.relationship !== "any" ||
    requestFilters.importance !== "any" ||
    requestFilters.connection !== "any" ||
    requestFilters.freshness !== "any" ||
    requestFilters.recentContact !== "any";
  const slowInitialLoad = useDelayedFlag(collectionQuery.isLoading);
  const updatingResults =
    collectionQuery.isFetching && !collectionQuery.isFetchingNextPage;
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError
  } = collectionQuery;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  const retryLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <section
      aria-labelledby="people-collection-heading"
      aria-busy={collectionQuery.isLoading || updatingResults}
      className="min-w-0 bg-[var(--ui-bg)]"
    >
      <div className="border-b border-[var(--ui-border-subtle)] px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UsersRound
                className="size-4 text-[var(--primary)]"
                aria-hidden="true"
              />
              <h2
                id="people-collection-heading"
                className="text-base font-semibold text-[var(--ui-ink-strong)]"
              >
                People
              </h2>
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-1 text-xs text-[var(--ui-ink-muted)]"
            >
              {collectionQuery.isLoading
                ? "Loading results"
                : updatingResults
                  ? `Updating results, ${people.length.toLocaleString()} currently shown`
                  : total === null
                    ? `${people.length.toLocaleString()} loaded`
                    : `${total.toLocaleString()} ${total === 1 ? "person" : "people"}${total > people.length ? `, ${people.length.toLocaleString()} loaded` : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="md"
              variant="secondary"
              className="size-11 shrink-0 px-0"
              aria-label="Refresh People"
              title="Refresh People"
              pending={
                collectionQuery.isRefetching &&
                !collectionQuery.isFetchingNextPage
              }
              onClick={() => void collectionQuery.refetch()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
            <Button type="button" onClick={onAddPerson}>
              <UserRoundPlus className="size-4" aria-hidden="true" />
              Add person
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="relative min-w-0">
            <span className="sr-only">Search People</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ui-ink-faint)]"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value
                }))
              }
              className="rounded-lg pl-10"
              placeholder="Search by name or relationship"
              autoComplete="off"
              aria-controls="people-collection-list"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="size-11 shrink-0 px-0"
            aria-label="Filters"
            title="Filters"
            aria-expanded={filtersOpen}
            aria-controls="people-filter-controls"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            {hasFilters ? (
              <span
                className="size-2 rounded-full bg-[var(--primary)]"
                aria-label="Filters active"
              />
            ) : null}
          </Button>
        </div>

        {filtersOpen ? (
          <div
            id="people-filter-controls"
            className="mt-3 grid gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            <SelectControl<PersonRelationshipCategory | "any">
              label="Relationship"
              value={filters.relationship}
              onChange={(relationship) =>
                setFilters((current) => ({ ...current, relationship }))
              }
              options={[
                { value: "any", label: "Any relationship" },
                { value: "family", label: "Family" },
                { value: "friend", label: "Friend" },
                { value: "partner", label: "Partner" },
                { value: "colleague", label: "Colleague" },
                { value: "community", label: "Community" },
                { value: "professional", label: "Professional" },
                { value: "other", label: "Other" }
              ]}
            />
            <SelectControl<PersonImportance | "any">
              label="Importance"
              value={filters.importance}
              onChange={(importance) =>
                setFilters((current) => ({ ...current, importance }))
              }
              options={[
                { value: "any", label: "Any importance" },
                { value: "essential", label: "Essential" },
                { value: "high", label: "High" },
                { value: "normal", label: "Normal" },
                { value: "low", label: "Low" }
              ]}
            />
            <SelectControl<PersonConnectionState | "any">
              label="Connection"
              value={filters.connection}
              onChange={(connection) =>
                setFilters((current) => ({ ...current, connection }))
              }
              options={[
                { value: "any", label: "Any connection" },
                { value: "local_only", label: "Local only" },
                { value: "paired", label: "Paired" },
                { value: "paused", label: "Paused" },
                { value: "pending", label: "Pending" },
                { value: "revoked", label: "Revoked" },
                { value: "unknown", label: "Unknown" }
              ]}
            />
            <SelectControl<PeopleCollectionFilters["sort"]>
              label="Sort"
              value={filters.sort}
              onChange={(sort) =>
                setFilters((current) => ({ ...current, sort }))
              }
              options={[
                { value: "name", label: "Name" },
                { value: "recent", label: "Recently updated" }
              ]}
            />
            <div className="flex items-end sm:col-span-2 xl:col-span-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11"
                disabled={!hasFilters && filters.sort === "name"}
                onClick={() => setFilters(DEFAULT_PEOPLE_FILTERS)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset filters
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 p-4">
        {firstPage ? (
          <ConnectionBanner
            connection={firstPage.connection}
            partial={partial}
            onRetry={() => void collectionQuery.refetch()}
          />
        ) : null}
        {isFetchNextPageError && people.length > 0 ? (
          <PeopleStateBanner
            state="warning"
            title="We couldn't load more people"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 flex-1">
                The people already shown are still here. Try again when you're
                ready; Forge will not keep retrying in the background.
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={isFetchingNextPage}
                onClick={retryLoadMore}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Retry loading more
              </Button>
            </div>
          </PeopleStateBanner>
        ) : collectionQuery.error && people.length > 0 ? (
          <PeopleStateBanner
            state="warning"
            title="Showing the people already loaded"
          >
            Forge couldn't refresh this list. Some details may be out of date.
          </PeopleStateBanner>
        ) : null}

        {collectionQuery.isLoading ? (
          <CollectionSkeleton slow={slowInitialLoad} />
        ) : collectionQuery.error && people.length === 0 ? (
          <div
            role="alert"
            className="grid min-h-[22rem] place-items-center rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] p-6 text-center"
          >
            <div className="max-w-md">
              <div className="text-base font-semibold text-[var(--ui-ink-strong)]">
                People could not be loaded
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                {collectionQuery.error instanceof Error
                  ? collectionQuery.error.message
                  : "Something went wrong while loading your people."}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={() => void collectionQuery.refetch()}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          </div>
        ) : people.length === 0 ? (
          <div className="grid min-h-[22rem] place-items-center">
            <div className="max-w-md text-center">
              <InlineEmpty>
                {hasFilters
                  ? partial
                    ? "No one in the loaded results matches these filters."
                    : "No one matches this search and these filters."
                  : "You haven't added anyone yet."}
              </InlineEmpty>
              {!hasFilters ? (
                <Button type="button" className="mt-4" onClick={onAddPerson}>
                  <UserRoundPlus className="size-4" aria-hidden="true" />
                  Add first person
                </Button>
              ) : (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {partial && collectionQuery.hasNextPage ? (
                    <Button
                      type="button"
                      variant="secondary"
                      pending={collectionQuery.isFetchingNextPage}
                      onClick={loadMore}
                    >
                      Load more
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setFilters(DEFAULT_PEOPLE_FILTERS);
                      setFiltersOpen(false);
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Clear search and filters
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <PeopleVirtualList
            people={people}
            total={total}
            selectedPersonId={selectedPersonId}
            hasNextPage={Boolean(hasNextPage) && !isFetchNextPageError}
            fetchingNextPage={isFetchingNextPage}
            busy={
              collectionQuery.isFetching && !collectionQuery.isFetchingNextPage
            }
            restorationKey={JSON.stringify(requestFilters)}
            onLoadMore={loadMore}
            onSelect={onSelectPerson}
          />
        )}

        {isFetchingNextPage ? (
          <div
            role="status"
            className="flex min-h-8 items-center justify-center gap-2 text-xs text-[var(--ui-ink-muted)]"
          >
            <Spinner className="size-3.5" tone="subtle" />
            Loading more People
          </div>
        ) : null}
      </div>
    </section>
  );
}
