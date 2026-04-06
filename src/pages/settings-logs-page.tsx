import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { PageHero } from "@/components/shell/page-hero";
import { SettingsSectionNav } from "@/components/settings/settings-section-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EntityBadge } from "@/components/ui/entity-badge";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { UserBadge } from "@/components/ui/user-badge";
import { getForgeSnapshot, listDiagnosticLogs } from "@/lib/api";
import { type EntityKind, isEntityKind } from "@/lib/entity-visuals";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnedEntityOptionLabel
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";
import type {
  DiagnosticLogCursor,
  DiagnosticLogEntry,
  DiagnosticLogLevel,
  DiagnosticLogSource,
  ForgeSnapshot,
  Tag,
  UserSummary
} from "@/lib/types";

type FilterOption = {
  id: string;
  label: string;
  description?: string;
  searchText?: string;
  badge: ReactNode;
  menuBadge?: ReactNode;
};

const LEVELS: DiagnosticLogLevel[] = ["error", "warning", "info", "debug"];
const SOURCES: DiagnosticLogSource[] = [
  "server",
  "ui",
  "system",
  "agent",
  "openclaw"
];
const DIAGNOSTIC_LOG_PAGE_SIZE = 120;

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter(Boolean)
    )
  );
}

function readMultiFilter(searchParams: URLSearchParams, key: string) {
  const values = uniqueValues(searchParams.getAll(key));
  if (values.length > 0) {
    return values;
  }
  const legacy = searchParams.get(key);
  return legacy?.trim() ? [legacy.trim()] : [];
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function levelTone(level: DiagnosticLogLevel) {
  if (level === "error") {
    return "border-rose-400/20 bg-rose-500/[0.08] text-rose-100";
  }
  if (level === "warning") {
    return "border-amber-400/20 bg-amber-500/[0.08] text-amber-100";
  }
  if (level === "info") {
    return "border-sky-400/20 bg-sky-500/[0.08] text-sky-100";
  }
  return "border-white/10 bg-white/[0.04] text-white/68";
}

function formatLevelLabel(level: DiagnosticLogLevel) {
  if (level === "error") {
    return "Errors";
  }
  if (level === "warning") {
    return "Warnings";
  }
  if (level === "info") {
    return "Info";
  }
  return "Debug";
}

function formatSourceLabel(source: DiagnosticLogSource) {
  if (source === "openclaw") {
    return "OpenClaw";
  }
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function copyableDetailRows(entry: DiagnosticLogEntry) {
  return [
    entry.scope ? `scope: ${entry.scope}` : null,
    entry.eventKey ? `event: ${entry.eventKey}` : null,
    entry.route ? `route: ${entry.route}` : null,
    entry.functionName ? `function: ${entry.functionName}` : null,
    entry.jobId ? `job: ${entry.jobId}` : null,
    entry.entityType && entry.entityId
      ? `entity: ${entry.entityType}:${entry.entityId}`
      : null,
    entry.requestId ? `request: ${entry.requestId}` : null
  ].filter((row): row is string => Boolean(row));
}

function buildLogSearchText(entry: DiagnosticLogEntry) {
  return normalize(
    [
      entry.message,
      entry.scope,
      entry.eventKey,
      entry.route,
      entry.functionName,
      entry.requestId,
      entry.entityType,
      entry.entityId,
      entry.jobId,
      JSON.stringify(entry.details)
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function renderSoftBadge(label: string, className?: string) {
  return (
    <Badge size="sm" className={cn("bg-white/[0.08] text-white/74", className)}>
      {label}
    </Badge>
  );
}

function renderEntityFilterBadge(
  entityType: string,
  label: string,
  user?: UserSummary | null,
  tag?: Tag | null
) {
  if (entityType === "user") {
    return <UserBadge user={user ?? null} compact />;
  }
  if (entityType === "tag") {
    return (
      <Badge
        size="sm"
        className="bg-white/[0.08] text-white/84"
        style={tag?.color ? { color: tag.color } : undefined}
      >
        {label}
      </Badge>
    );
  }
  if (isEntityKind(entityType)) {
    return (
      <EntityBadge
        kind={entityType as EntityKind}
        label={label}
        compact
        gradient={false}
      />
    );
  }
  return renderSoftBadge(label, "bg-[rgba(192,193,255,0.12)] text-white/84");
}

function CompactFilterMultiSelect({
  label,
  placeholder,
  options,
  selectedIds,
  onChange,
  emptyMessage = "No matches yet."
}: {
  label: string;
  placeholder: string;
  options: FilterOption[];
  selectedIds: string[];
  onChange: (values: string[]) => void;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedOptions = useMemo(
    () =>
      selectedIds
        .map((id) => options.find((option) => option.id === id) ?? null)
        .filter((option): option is FilterOption => option !== null),
    [options, selectedIds]
  );

  const normalizedQuery = normalize(query);
  const filteredOptions = useMemo(() => {
    const pool = options.filter((option) => !selectedIds.includes(option.id));
    if (!normalizedQuery) {
      return pool.slice(0, 10);
    }
    return pool
      .filter((option) =>
        normalize(
          `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`
        ).includes(normalizedQuery)
      )
      .slice(0, 10);
  }, [normalizedQuery, options, selectedIds]);

  const addOption = (optionId: string) => {
    if (selectedIds.includes(optionId)) {
      return;
    }
    onChange([...selectedIds, optionId]);
    setQuery("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeOption = (optionId: string) => {
    onChange(selectedIds.filter((id) => id !== optionId));
  };

  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
        {label}
      </span>
      <div className="relative rounded-[20px] border border-white/8 bg-white/[0.04] px-3 py-2.5">
        {selectedOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.05] px-1.5 py-1"
              >
                {option.badge}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-white/46 transition hover:text-white"
                  onClick={() => removeOption(option.id)}
                  aria-label={`Remove ${option.label}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Search className="size-3.5 text-white/34" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && selectedIds.length > 0) {
                removeOption(selectedIds[selectedIds.length - 1]!);
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlightedIndex((current) =>
                  filteredOptions.length === 0
                    ? 0
                    : Math.min(filteredOptions.length - 1, current + 1)
                );
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((current) => Math.max(0, current - 1));
                return;
              }

              if (event.key === "Escape") {
                setOpen(false);
                return;
              }

              if (event.key === "Enter" && filteredOptions[highlightedIndex]) {
                event.preventDefault();
                addOption(filteredOptions[highlightedIndex]!.id);
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
          />
        </div>

        {open ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-[20px] border border-white/8 bg-[rgba(8,13,24,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-[16px] px-3 py-2 text-left transition",
                    index === highlightedIndex
                      ? "bg-white/[0.1] text-white"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addOption(option.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {option.menuBadge ?? option.badge}
                    </div>
                    {option.description ? (
                      <div className="mt-1 text-xs leading-5 text-white/46">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-white/42">{emptyMessage}</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function addEntityOption(
  registry: Map<string, FilterOption>,
  input: {
    entityType: string;
    entityId: string;
    label: string;
    description?: string;
    searchText?: string;
    badge: ReactNode;
    menuBadge?: ReactNode;
  }
) {
  const key = `${input.entityType}:${input.entityId}`;
  if (registry.has(key)) {
    return;
  }
  registry.set(key, {
    id: key,
    label: input.label,
    description: input.description,
    searchText: input.searchText,
    badge: input.badge,
    menuBadge: input.menuBadge
  });
}

function buildEntityOptions(
  snapshot: ForgeSnapshot | undefined,
  logs: DiagnosticLogEntry[]
) {
  const options = new Map<string, FilterOption>();

  if (snapshot) {
    for (const goal of snapshot.dashboard.goals) {
      addEntityOption(options, {
        entityType: "goal",
        entityId: goal.id,
        label: formatOwnedEntityOptionLabel(goal.title, goal.user),
        description: formatOwnedEntityDescription(goal.description, goal.user),
        searchText: buildOwnedEntitySearchText(
          [goal.title, goal.description, goal.status, goal.horizon],
          goal
        ),
        badge: renderEntityFilterBadge("goal", goal.title, goal.user),
        menuBadge: renderEntityFilterBadge("goal", goal.title, goal.user)
      });
    }

    for (const project of snapshot.dashboard.projects) {
      addEntityOption(options, {
        entityType: "project",
        entityId: project.id,
        label: formatOwnedEntityOptionLabel(project.title, project.user),
        description: formatOwnedEntityDescription(project.description, project.user),
        searchText: buildOwnedEntitySearchText(
          [project.title, project.description, project.status, project.goalTitle],
          project
        ),
        badge: renderEntityFilterBadge("project", project.title, project.user),
        menuBadge: renderEntityFilterBadge("project", project.title, project.user)
      });
    }

    for (const task of snapshot.dashboard.tasks) {
      addEntityOption(options, {
        entityType: "task",
        entityId: task.id,
        label: formatOwnedEntityOptionLabel(task.title, task.user),
        description: formatOwnedEntityDescription(
          task.description,
          task.user
        ),
        searchText: buildOwnedEntitySearchText(
          [
            task.title,
            task.description,
            task.status
          ],
          task
        ),
        badge: renderEntityFilterBadge("task", task.title, task.user),
        menuBadge: renderEntityFilterBadge("task", task.title, task.user)
      });
    }

    for (const habit of snapshot.dashboard.habits) {
      addEntityOption(options, {
        entityType: "habit",
        entityId: habit.id,
        label: formatOwnedEntityOptionLabel(habit.title, habit.user),
        description: formatOwnedEntityDescription(habit.description, habit.user),
        searchText: buildOwnedEntitySearchText(
          [habit.title, habit.description, habit.frequency, habit.status],
          habit
        ),
        badge: renderEntityFilterBadge("habit", habit.title, habit.user),
        menuBadge: renderEntityFilterBadge("habit", habit.title, habit.user)
      });
    }

    for (const strategy of snapshot.strategies) {
      addEntityOption(options, {
        entityType: "strategy",
        entityId: strategy.id,
        label: formatOwnedEntityOptionLabel(strategy.title, strategy.user),
        description: formatOwnedEntityDescription(
          strategy.overview,
          strategy.user
        ),
        searchText: buildOwnedEntitySearchText(
          [strategy.title, strategy.overview, strategy.endStateDescription],
          strategy
        ),
        badge: renderEntityFilterBadge("strategy", strategy.title, strategy.user),
        menuBadge: renderEntityFilterBadge(
          "strategy",
          strategy.title,
          strategy.user
        )
      });
    }

    for (const tag of snapshot.dashboard.tags) {
      addEntityOption(options, {
        entityType: "tag",
        entityId: tag.id,
        label: tag.name,
        description: tag.description || "Forge tag",
        searchText: normalize(`${tag.name} ${tag.description ?? ""}`),
        badge: renderEntityFilterBadge("tag", tag.name, null, tag),
        menuBadge: renderEntityFilterBadge("tag", tag.name, null, tag)
      });
    }

    for (const user of snapshot.users) {
      addEntityOption(options, {
        entityType: "user",
        entityId: user.id,
        label: formatOwnedEntityOptionLabel(user.displayName, user),
        description: user.description || `${user.kind} Forge user`,
        searchText: normalize(
          `${user.displayName} ${user.handle ?? ""} ${user.kind} ${user.description ?? ""}`
        ),
        badge: renderEntityFilterBadge("user", user.displayName, user),
        menuBadge: renderEntityFilterBadge("user", user.displayName, user)
      });
    }
  }

  for (const entry of logs) {
    if (!entry.entityType || !entry.entityId) {
      continue;
    }
    const key = `${entry.entityType}:${entry.entityId}`;
    if (options.has(key)) {
      continue;
    }
    const fallbackLabel =
      entry.entityType === "wiki_ingest_job"
        ? `Ingest ${entry.entityId}`
        : `${entry.entityType} ${entry.entityId}`;
    addEntityOption(options, {
      entityType: entry.entityType,
      entityId: entry.entityId,
      label: fallbackLabel,
      description: "Seen in diagnostics logs",
      searchText: normalize(
        `${fallbackLabel} ${entry.scope} ${entry.message} ${entry.eventKey}`
      ),
      badge: renderEntityFilterBadge(entry.entityType, fallbackLabel),
      menuBadge: renderEntityFilterBadge(entry.entityType, fallbackLabel)
    });
  }

  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

export function SettingsLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => {
    const legacyEntityType = searchParams.get("entityType")?.trim() || "";
    const legacyEntityId = searchParams.get("entityId")?.trim() || "";
    const entityFilters = readMultiFilter(searchParams, "entity");
    if (
      entityFilters.length === 0 &&
      legacyEntityType &&
      legacyEntityId
    ) {
      entityFilters.push(`${legacyEntityType}:${legacyEntityId}`);
    }
    return {
      search: searchParams.get("search") || "",
      levels: readMultiFilter(searchParams, "level"),
      sources: readMultiFilter(searchParams, "source"),
      scopes: readMultiFilter(searchParams, "scope"),
      routes: readMultiFilter(searchParams, "route"),
      jobs: readMultiFilter(searchParams, "jobId"),
      entities: uniqueValues(entityFilters)
    };
  }, [searchParams]);

  const logsQuery = useInfiniteQuery({
    queryKey: ["forge-diagnostic-logs", "settings-filters"],
    initialPageParam: null as DiagnosticLogCursor | null,
    queryFn: ({ pageParam }) =>
      listDiagnosticLogs({
        limit: DIAGNOSTIC_LOG_PAGE_SIZE,
        beforeCreatedAt: pageParam?.beforeCreatedAt,
        beforeId: pageParam?.beforeId
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });

  const snapshotQuery = useQuery({
    queryKey: ["forge-diagnostic-log-entities"],
    queryFn: () => getForgeSnapshot(),
    staleTime: 60_000
  });

  const setTextFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) {
      next.set(key, value.trim());
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const setMultiFilter = (
    key: string,
    values: string[],
    legacyKeys: string[] = []
  ) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    for (const legacyKey of legacyKeys) {
      next.delete(legacyKey);
    }
    for (const value of uniqueValues(values)) {
      next.append(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    [
      "search",
      "level",
      "source",
      "scope",
      "route",
      "jobId",
      "entity",
      "entityType",
      "entityId"
    ].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  if (logsQuery.isPending) {
    return (
      <SurfaceSkeleton
        eyebrow="Settings"
        title="Loading diagnostics"
        description="Collecting the latest frontend, backend, and runtime traces."
        columns={1}
        blocks={6}
      />
    );
  }

  if (logsQuery.isError) {
    return (
      <ErrorState
        eyebrow="Settings"
        error={logsQuery.error}
        onRetry={() => void logsQuery.refetch()}
      />
    );
  }

  const rawLogs = useMemo(
    () => logsQuery.data?.pages.flatMap((page) => page.logs) ?? [],
    [logsQuery.data]
  );
  const normalizedSearch = normalize(filters.search);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);

  const levelOptions = useMemo<FilterOption[]>(
    () =>
      LEVELS.map((level) => ({
        id: level,
        label: formatLevelLabel(level),
        searchText: `${level} ${formatLevelLabel(level)}`,
        badge: (
          <Badge size="sm" className={levelTone(level)}>
            {formatLevelLabel(level)}
          </Badge>
        )
      })),
    []
  );

  const sourceOptions = useMemo<FilterOption[]>(
    () =>
      SOURCES.map((source) => ({
        id: source,
        label: formatSourceLabel(source),
        searchText: `${source} ${formatSourceLabel(source)}`,
        badge: renderSoftBadge(formatSourceLabel(source))
      })),
    []
  );

  const scopeOptions = useMemo<FilterOption[]>(
    () =>
      uniqueValues(rawLogs.map((entry) => entry.scope)).map((scope) => ({
        id: scope,
        label: scope,
        searchText: scope,
        badge: renderSoftBadge(scope)
      })),
    [rawLogs]
  );

  const routeOptions = useMemo<FilterOption[]>(
    () =>
      uniqueValues(rawLogs.map((entry) => entry.route)).map((route) => ({
        id: route,
        label: route,
        description: "Filter logs to one or more exact routes.",
        searchText: route,
        badge: renderSoftBadge(route, "max-w-[16rem]"),
        menuBadge: renderSoftBadge(route)
      })),
    [rawLogs]
  );

  const jobOptions = useMemo<FilterOption[]>(
    () =>
      uniqueValues(rawLogs.map((entry) => entry.jobId)).map((jobId) => ({
        id: jobId,
        label: jobId,
        description: "Background job or ingest run id.",
        searchText: jobId,
        badge: renderSoftBadge(jobId, "max-w-[14rem]"),
        menuBadge: renderSoftBadge(jobId)
      })),
    [rawLogs]
  );

  const entityOptions = useMemo(
    () => buildEntityOptions(snapshotQuery.data, rawLogs),
    [rawLogs, snapshotQuery.data]
  );

  const filteredLogs = useMemo(
    () =>
      rawLogs.filter((entry) => {
        if (
          normalizedSearch &&
          !buildLogSearchText(entry).includes(normalizedSearch)
        ) {
          return false;
        }
        if (
          filters.levels.length > 0 &&
          !filters.levels.includes(entry.level)
        ) {
          return false;
        }
        if (
          filters.sources.length > 0 &&
          !filters.sources.includes(entry.source)
        ) {
          return false;
        }
        if (
          filters.scopes.length > 0 &&
          !filters.scopes.includes(entry.scope)
        ) {
          return false;
        }
        if (
          filters.routes.length > 0 &&
          !filters.routes.includes(entry.route ?? "")
        ) {
          return false;
        }
        if (
          filters.jobs.length > 0 &&
          !filters.jobs.includes(entry.jobId ?? "")
        ) {
          return false;
        }
        if (filters.entities.length > 0) {
          const entityKey =
            entry.entityType && entry.entityId
              ? `${entry.entityType}:${entry.entityId}`
              : "";
          if (!entityKey || !filters.entities.includes(entityKey)) {
            return false;
          }
        }
        return true;
      }),
    [filters, normalizedSearch, rawLogs]
  );

  const filterSignature = [
    filters.search,
    filters.levels.join("|"),
    filters.sources.join("|"),
    filters.scopes.join("|"),
    filters.routes.join("|"),
    filters.jobs.join("|"),
    filters.entities.join("|")
  ].join("::");

  useEffect(() => {
    scrollParentRef.current?.scrollTo({ top: 0 });
  }, [filterSignature]);

  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 260,
    overscan: 8
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const handleLogScroll = () => {
    const element = scrollParentRef.current;
    if (!element || !logsQuery.hasNextPage || logsQuery.isFetchingNextPage) {
      return;
    }
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= 800) {
      void logsQuery.fetchNextPage();
    }
  };

  const activeFilterCount =
    filters.levels.length +
    filters.sources.length +
    filters.scopes.length +
    filters.routes.length +
    filters.jobs.length +
    filters.entities.length +
    (filters.search.trim() ? 1 : 0);

  return (
    <div className="mx-auto grid w-full max-w-[1220px] gap-5">
      <PageHero
        title="Logs"
        description="Inspect shared diagnostics from the UI, backend routes, background jobs, and LLM flows."
        badge={`${filteredLogs.length} matching${filteredLogs.length !== rawLogs.length ? ` · ${rawLogs.length} loaded` : ""}${logsQuery.hasNextPage ? " · more available" : ""}`}
      />

      <SettingsSectionNav />

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              Filters
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
              Use token filters with OR-style badge selections for levels,
              sources, routes, jobs, scopes, and linked entities. Search still
              matches the message body and structured details.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear {activeFilterCount}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void logsQuery.refetch()}
              pending={logsQuery.isRefetching && !logsQuery.isFetchingNextPage}
              pendingLabel="Refreshing"
            >
              Refresh
            </Button>
          </div>
        </div>

        <label className="grid gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
            Search message or details
          </span>
          <Input
            value={filters.search}
            onChange={(event) => setTextFilter("search", event.target.value)}
            placeholder="LLM compilation failed, wiki_ingest, request_failed…"
            className="h-11 rounded-[20px]"
          />
        </label>

        <div className="grid gap-3 xl:grid-cols-2">
          <CompactFilterMultiSelect
            label="Levels"
            placeholder="Add one or more levels"
            options={levelOptions}
            selectedIds={filters.levels}
            onChange={(values) => setMultiFilter("level", values)}
            emptyMessage="No additional log levels."
          />
          <CompactFilterMultiSelect
            label="Sources"
            placeholder="Add one or more sources"
            options={sourceOptions}
            selectedIds={filters.sources}
            onChange={(values) => setMultiFilter("source", values)}
            emptyMessage="No additional log sources."
          />
          <CompactFilterMultiSelect
            label="Scopes"
            placeholder="Search scopes"
            options={scopeOptions}
            selectedIds={filters.scopes}
            onChange={(values) => setMultiFilter("scope", values)}
            emptyMessage="No scopes match the current logs."
          />
          <CompactFilterMultiSelect
            label="Routes"
            placeholder="Search exact routes"
            options={routeOptions}
            selectedIds={filters.routes}
            onChange={(values) => setMultiFilter("route", values)}
            emptyMessage="No routes match the current logs."
          />
          <CompactFilterMultiSelect
            label="Jobs"
            placeholder="Search job ids"
            options={jobOptions}
            selectedIds={filters.jobs}
            onChange={(values) => setMultiFilter("jobId", values)}
            emptyMessage="No job ids match the current logs."
          />
          <CompactFilterMultiSelect
            label="Entities"
            placeholder="Search Forge entities or logged ids"
            options={entityOptions}
            selectedIds={filters.entities}
            onChange={(values) =>
              setMultiFilter("entity", values, ["entityType", "entityId"])
            }
            emptyMessage={
              snapshotQuery.isFetching
                ? "Loading Forge entities…"
                : "No Forge entities or logged ids match yet."
            }
          />
        </div>
      </Card>

      <div className="grid gap-3">
        {filteredLogs.length === 0 ? (
          <Card className="text-sm text-white/58">
            No diagnostic entries match the current filters yet.
          </Card>
        ) : (
          <Card className="p-0">
            <div
              ref={scrollParentRef}
              onScroll={handleLogScroll}
              className="h-[72vh] overflow-y-auto px-3 py-3"
            >
              <div
                className="relative"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {virtualRows.map((virtualRow) => {
                  const entry = filteredLogs[virtualRow.index];
                  if (!entry) {
                    return null;
                  }
                  return (
                    <div
                      key={entry.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="absolute left-0 top-0 w-full pb-3"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      <Card className="grid gap-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="grid gap-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                  levelTone(entry.level)
                                )}
                              >
                                {entry.level}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
                                {entry.source}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
                                {entry.scope}
                              </span>
                              {entry.eventKey ? (
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/46">
                                  {entry.eventKey}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-base font-medium text-white">
                              {entry.message}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-white/45">
                              {copyableDetailRows(entry).map((row) => (
                                <span key={row}>{row}</span>
                              ))}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-xs text-white/40">
                            <div>{formatTimestamp(entry.createdAt)}</div>
                            <div className="mt-1 font-mono text-[11px]">
                              {entry.id}
                            </div>
                          </div>
                        </div>

                        {Object.keys(entry.details).length > 0 ? (
                          <details className="rounded-[18px] border border-white/8 bg-[rgba(7,11,21,0.72)] px-4 py-3">
                            <summary className="cursor-pointer text-sm text-white/70">
                              View structured details
                            </summary>
                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-white/58">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </Card>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-white/6 px-1 py-3 text-center text-xs text-white/46">
                {logsQuery.isFetchingNextPage
                  ? "Loading older logs…"
                  : logsQuery.hasNextPage
                    ? "Scroll to load older logs."
                    : `Showing all ${rawLogs.length} loaded logs.`}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
