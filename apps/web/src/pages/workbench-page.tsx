import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from "@tanstack/react-query";
import { Boxes, Network, Plus, Power, PowerOff, RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { WorkbenchCreateFlowDialog } from "@/components/workbench/workbench-create-flow-dialog";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import {
  createWorkbenchFlow,
  listWorkbenchBoxCatalog,
  listWorkbenchFlows
} from "@/lib/api";
import { getEntityKindForWorkbenchFlowKind } from "@/lib/entity-visuals";
import type {
  AiConnectorKind,
  ForgeBoxPortDefinition,
  WorkbenchBoxCatalogItem,
  WorkbenchCatalogFacet,
  WorkbenchFlowCatalogItem
} from "@/lib/types";

const CATALOG_PAGE_SIZE = 24;

type WorkbenchCatalogMode = "flows" | "boxes";

function valuesForPrefix(values: string[], prefix: string) {
  return values
    .filter((value) => value.startsWith(`${prefix}:`))
    .map((value) => value.slice(prefix.length + 1))
    .filter(Boolean);
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function facetOptions(
  prefix: string,
  facets: WorkbenchCatalogFacet[],
  description: string
): FacetedTokenOption[] {
  return facets.map((facet) => ({
    id: `${prefix}:${facet.value}`,
    label: facet.label,
    description: `${description} · ${facet.count.toLocaleString()}`,
    searchText: `${facet.value} ${facet.label}`
  }));
}

function includeSelectedOptions(
  options: FacetedTokenOption[],
  selectedOptionIds: string[]
) {
  const byId = new Map(options.map((option) => [option.id, option]));
  for (const optionId of selectedOptionIds) {
    if (!byId.has(optionId)) {
      const value = optionId.slice(optionId.indexOf(":") + 1);
      byId.set(optionId, {
        id: optionId,
        label: value,
        description: "Selected catalog filter"
      });
    }
  }
  return [...byId.values()];
}

function renderPortSummary(ports: ForgeBoxPortDefinition[]) {
  return ports.length > 0
    ? ports
        .slice(0, 4)
        .map((port) => `${port.key}: ${port.kind}`)
        .join(", ")
    : "None";
}

function PortContract({
  title,
  ports
}: {
  title: string;
  ports: ForgeBoxPortDefinition[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
        {title}
      </h3>
      {ports.length > 0 ? (
        <ul className="mt-2 grid gap-2">
          {ports.map((port) => (
            <li
              key={`${title}-${port.key}`}
              className="min-w-0 text-sm text-[var(--ui-ink-medium)]"
            >
              <code className="break-all text-[12px] text-[var(--ui-ink-strong)]">
                {port.key}
              </code>{" "}
              <span className="text-[var(--ui-ink-faint)]">{port.kind}</span>
              {port.required ? " · required" : " · optional"}
              {port.description ? (
                <div className="mt-1 break-words text-xs leading-5 text-[var(--ui-ink-soft)]">
                  {port.description}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--ui-ink-faint)]">None</p>
      )}
    </div>
  );
}

export function WorkbenchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  const preferredSurface = searchParams.get("surface");
  const catalogMode: WorkbenchCatalogMode =
    searchParams.get("catalog") === "boxes" ? "boxes" : "flows";
  const query = searchParams.get("q") ?? "";
  const selectedOptionIds = searchParams.getAll("filter");
  const deferredQuery = useDeferredValue(query.trim());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createKind, setCreateKind] = useState<AiConnectorKind>("functor");

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  const flowFilters = useMemo(
    () => ({
      q: deferredQuery,
      kinds: valuesForPrefix(selectedOptionIds, "kind").filter(
        (value): value is AiConnectorKind =>
          value === "functor" || value === "chat"
      ),
      homeSurfaceIds: valuesForPrefix(selectedOptionIds, "surface"),
      statuses: valuesForPrefix(selectedOptionIds, "status").filter(
        (value): value is "enabled" | "disabled" =>
          value === "enabled" || value === "disabled"
      )
    }),
    [deferredQuery, selectedOptionIds]
  );
  const boxFilters = useMemo(
    () => ({
      q: deferredQuery,
      categories: valuesForPrefix(selectedOptionIds, "category"),
      surfaceIds: valuesForPrefix(selectedOptionIds, "surface"),
      sources: valuesForPrefix(selectedOptionIds, "source").filter(
        (value): value is "forge" | "flow_output" =>
          value === "forge" || value === "flow_output"
      )
    }),
    [deferredQuery, selectedOptionIds]
  );

  const flowsQuery = useInfiniteQuery({
    queryKey: ["forge-workbench-flows", "catalog", flowFilters],
    initialPageParam: 0,
    enabled: catalogMode === "flows",
    queryFn: ({ pageParam }) =>
      listWorkbenchFlows({
        ...flowFilters,
        limit: CATALOG_PAGE_SIZE,
        offset: pageParam
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.flows.length : undefined,
    placeholderData: (previousData) => previousData,
    retry: false
  });
  const boxesQuery = useInfiniteQuery({
    queryKey: ["forge-workbench-box-catalog", "catalog", boxFilters],
    initialPageParam: 0,
    enabled: catalogMode === "boxes",
    queryFn: ({ pageParam }) =>
      listWorkbenchBoxCatalog({
        ...boxFilters,
        limit: CATALOG_PAGE_SIZE,
        offset: pageParam
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.boxes.length : undefined,
    placeholderData: (previousData) => previousData,
    retry: false
  });
  const createMutation = useMutation({
    mutationFn: createWorkbenchFlow,
    onSuccess: ({ flow }) => {
      void queryClient.invalidateQueries({
        queryKey: ["forge-workbench-flows"]
      });
      navigate(`/workbench/${flow.id}`);
    }
  });

  const flows = useMemo(
    () =>
      uniqueById(flowsQuery.data?.pages.flatMap((page) => page.flows) ?? []),
    [flowsQuery.data?.pages]
  );
  const boxes = useMemo(
    () =>
      uniqueById(boxesQuery.data?.pages.flatMap((page) => page.boxes) ?? []),
    [boxesQuery.data?.pages]
  );
  const flowPage = flowsQuery.data?.pages[0];
  const boxPage = boxesQuery.data?.pages[0];
  const activeResults: Array<
    WorkbenchFlowCatalogItem | WorkbenchBoxCatalogItem
  > = catalogMode === "flows" ? flows : boxes;
  const activeTotal =
    catalogMode === "flows" ? flowPage?.total : boxPage?.total;
  const activeHasData =
    catalogMode === "flows" ? Boolean(flowPage) : Boolean(boxPage);
  const activeIsLoading =
    catalogMode === "flows" ? flowsQuery.isPending : boxesQuery.isPending;
  const activeIsError =
    catalogMode === "flows" ? flowsQuery.isError : boxesQuery.isError;
  const activeError =
    catalogMode === "flows" ? flowsQuery.error : boxesQuery.error;
  const activeIsFetching =
    catalogMode === "flows" ? flowsQuery.isFetching : boxesQuery.isFetching;
  const activeIsFetchingNextPage =
    catalogMode === "flows"
      ? flowsQuery.isFetchingNextPage
      : boxesQuery.isFetchingNextPage;
  const activeIsFetchNextPageError =
    catalogMode === "flows"
      ? flowsQuery.isFetchNextPageError
      : boxesQuery.isFetchNextPageError;
  const activeHasNextPage =
    catalogMode === "flows" ? flowsQuery.hasNextPage : boxesQuery.hasNextPage;
  const activeNoun = catalogMode === "flows" ? "flow" : "node box";
  const hasFilters = query.trim().length > 0 || selectedOptionIds.length > 0;
  const updatingResults =
    activeHasData && activeIsFetching && !activeIsFetchingNextPage;

  const filterOptions = useMemo<FacetedTokenOption[]>(() => {
    const options =
      catalogMode === "flows"
        ? [
            ...facetOptions("kind", flowPage?.facets.kinds ?? [], "Flow kind"),
            ...facetOptions(
              "surface",
              flowPage?.facets.homeSurfaces ?? [],
              "Home surface"
            ),
            ...facetOptions(
              "status",
              flowPage?.facets.statuses ?? [],
              "Callable endpoint state"
            )
          ]
        : [
            ...facetOptions(
              "category",
              boxPage?.facets.categories ?? [],
              "Node box category"
            ),
            ...facetOptions(
              "surface",
              boxPage?.facets.surfaces ?? [],
              "Source Forge surface"
            ),
            ...facetOptions(
              "source",
              boxPage?.facets.sources ?? [],
              "Catalog source"
            )
          ];
    return includeSelectedOptions(options, selectedOptionIds);
  }, [boxPage?.facets, catalogMode, flowPage?.facets, selectedOptionIds]);

  const resultSummary =
    activeTotal === undefined
      ? `Loading ${activeNoun}s`
      : `${activeTotal.toLocaleString()} ${activeTotal === 1 ? activeNoun : `${activeNoun}s`}${activeTotal > activeResults.length ? ` · ${activeResults.length.toLocaleString()} loaded` : ""}${updatingResults ? " · updating" : ""}`;

  function commitSearchParams(
    change: (next: URLSearchParams) => void,
    options: { replace: boolean }
  ) {
    const next = new URLSearchParams(searchParamsRef.current);
    change(next);
    searchParamsRef.current = next;
    setSearchParams(next, options);
  }

  function updateQuery(value: string) {
    commitSearchParams(
      (next) => {
        if (value) next.set("q", value);
        else next.delete("q");
      },
      { replace: true }
    );
  }

  function updateSelectedOptions(values: string[]) {
    commitSearchParams(
      (next) => {
        next.delete("filter");
        for (const value of values) next.append("filter", value);
      },
      { replace: true }
    );
  }

  function switchCatalog(nextMode: WorkbenchCatalogMode) {
    commitSearchParams(
      (next) => {
        if (nextMode === "flows") next.delete("catalog");
        else next.set("catalog", "boxes");
        next.delete("filter");
      },
      { replace: false }
    );
  }

  function handleCatalogKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    mode: WorkbenchCatalogMode
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode = mode === "flows" ? "boxes" : "flows";
    switchCatalog(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`workbench-${nextMode}-tab`)?.focus();
    });
  }

  function openCreateDialog(kind: AiConnectorKind) {
    setCreateKind(kind);
    setCreateDialogOpen(true);
  }

  function fetchNextPage() {
    if (catalogMode === "flows") void flowsQuery.fetchNextPage();
    else void boxesQuery.fetchNextPage();
  }

  function refetchActiveCatalog() {
    if (catalogMode === "flows") void flowsQuery.refetch();
    else void boxesQuery.refetch();
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="workbench"
        title="Workbench"
        titleText="Workbench"
        description="Search reusable Forge boxes and saved flows, then open a flow to inspect or change its graph, tools, prompts, and outputs."
        badge={
          activeTotal === undefined
            ? "Catalog loading"
            : `${activeTotal.toLocaleString()} ${activeTotal === 1 ? activeNoun : `${activeNoun}s`}`
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => openCreateDialog("functor")}
        >
          <Plus className="size-4" aria-hidden="true" />
          New flow
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => openCreateDialog("chat")}
        >
          <Plus className="size-4" aria-hidden="true" />
          New chat flow
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Workbench catalog"
        className="inline-flex w-full max-w-md rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1 sm:w-auto"
      >
        <button
          id="workbench-flows-tab"
          type="button"
          role="tab"
          aria-selected={catalogMode === "flows"}
          aria-controls="workbench-catalog-panel"
          tabIndex={catalogMode === "flows" ? 0 : -1}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm transition sm:flex-none ${
            catalogMode === "flows"
              ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
          }`}
          onClick={() => switchCatalog("flows")}
          onKeyDown={(event) => handleCatalogKeyDown(event, "flows")}
        >
          <Network className="size-4" aria-hidden="true" />
          Flows
        </button>
        <button
          id="workbench-boxes-tab"
          type="button"
          role="tab"
          aria-selected={catalogMode === "boxes"}
          aria-controls="workbench-catalog-panel"
          tabIndex={catalogMode === "boxes" ? 0 : -1}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm transition sm:flex-none ${
            catalogMode === "boxes"
              ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
          }`}
          onClick={() => switchCatalog("boxes")}
          onKeyDown={(event) => handleCatalogKeyDown(event, "boxes")}
        >
          <Boxes className="size-4" aria-hidden="true" />
          Node boxes
        </button>
      </div>

      <section
        id="workbench-catalog-panel"
        role="tabpanel"
        aria-labelledby={`workbench-${catalogMode}-tab`}
        aria-busy={activeIsLoading || updatingResults}
        className="grid min-w-0 gap-5"
      >
        <FacetedTokenSearch
          title={catalogMode === "flows" ? "Flow search" : "Node box search"}
          description={
            catalogMode === "flows"
              ? "Filter by kind, home surface, or endpoint state, then open a flow to inspect or run it."
              : "Filter by category, source surface, or catalog source, then inspect its typed contract."
          }
          query={query}
          onQueryChange={updateQuery}
          options={filterOptions}
          selectedOptionIds={selectedOptionIds}
          onSelectedOptionIdsChange={updateSelectedOptions}
          resultSummary={resultSummary}
          placeholder={
            catalogMode === "flows"
              ? "Search flow title, description, node label, or home surface"
              : "Search box title, route, tag, port, or tool"
          }
        />

        {activeIsLoading && !activeHasData ? (
          <LoadingState
            eyebrow="Workbench catalog"
            title={`Loading ${activeNoun}s`}
            description="Reading the first bounded catalog page from Forge."
          />
        ) : activeIsError && !activeHasData ? (
          <ErrorState
            eyebrow="Workbench catalog"
            error={activeError}
            onRetry={refetchActiveCatalog}
          />
        ) : activeResults.length === 0 ? (
          <EmptyState
            eyebrow="Workbench catalog"
            title={
              hasFilters ? "No catalog matches" : `No ${activeNoun}s available`
            }
            description={
              hasFilters
                ? "Clear or change the current search and filters."
                : catalogMode === "flows"
                  ? "Create a guided flow to start building a reusable graph."
                  : "Forge returned an empty node-box catalog. Retry after the source surfaces are available."
            }
            action={
              !hasFilters && catalogMode === "flows" ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => openCreateDialog("functor")}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Create flow
                </Button>
              ) : !hasFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={refetchActiveCatalog}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Retry catalog
                </Button>
              ) : undefined
            }
          />
        ) : catalogMode === "flows" ? (
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {flows.map((flow) => (
              <button
                key={flow.id}
                type="button"
                aria-label={`Open ${flow.title}`}
                className="min-h-44 min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]"
                onClick={() => navigate(`/workbench/${flow.id}`)}
              >
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-words text-lg font-semibold text-[var(--ui-ink-strong)]">
                      {flow.title}
                    </div>
                    <div className="mt-1 line-clamp-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {flow.description || "No description yet."}
                    </div>
                  </div>
                  <EntityBadge
                    kind={getEntityKindForWorkbenchFlowKind(flow.kind)}
                    label={flow.kind === "chat" ? "Chat flow" : "Functor flow"}
                    compact
                    gradient={false}
                  />
                </div>
                <div className="mt-4 flex min-w-0 flex-wrap gap-x-3 gap-y-2 text-[12px] text-[var(--ui-ink-faint)]">
                  <span>{flow.nodeCount} nodes</span>
                  <span>{flow.edgeCount} edges</span>
                  <span>{flow.publicInputCount} public inputs</span>
                  <span>{flow.publishedOutputCount} outputs</span>
                  {flow.homeSurfaceId ? (
                    <span className="min-w-0 break-words">
                      {flow.homeSurfaceId}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
                  {flow.endpointEnabled ? (
                    <Power
                      className="size-3.5 text-[var(--success)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <PowerOff
                      className="size-3.5 text-[var(--ui-ink-faint)]"
                      aria-hidden="true"
                    />
                  )}
                  <span>
                    Endpoint {flow.endpointEnabled ? "enabled" : "disabled"}
                  </span>
                  {flow.lastRunStatus ? (
                    <span>· Last run {flow.lastRunStatus}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {boxes.map((box) => {
              const outputs = box.outputs ?? box.output ?? [];
              return (
                <section
                  key={box.id}
                  className="min-h-44 min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5"
                >
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold text-[var(--ui-ink-strong)]">
                        {box.title}
                      </h2>
                      <p className="mt-1 line-clamp-3 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {box.description || "No description available."}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-[11px] text-[var(--ui-ink-soft)]">
                      {box.category || "Other"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                        Inputs
                      </div>
                      <div className="mt-2 break-words text-sm text-[var(--ui-ink-medium)]">
                        {renderPortSummary(box.inputs)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                        Outputs
                      </div>
                      <div className="mt-2 break-words text-sm text-[var(--ui-ink-medium)]">
                        {renderPortSummary(outputs)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex min-w-0 flex-wrap gap-x-3 gap-y-2 text-[12px] text-[var(--ui-ink-faint)]">
                    <span>
                      {box.source === "flow_output"
                        ? "Flow output"
                        : "Forge box"}
                    </span>
                    {box.surfaceId ? <span>{box.surfaceId}</span> : null}
                    {box.routePath ? (
                      <span className="min-w-0 break-all">{box.routePath}</span>
                    ) : null}
                    {box.sourceFlowEnabled === false ? (
                      <span>Endpoint disabled</span>
                    ) : null}
                  </div>
                  <details className="mt-4 border-t border-[var(--ui-border-subtle)] pt-3">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]">
                      Inspect full contract
                    </summary>
                    <div className="grid min-w-0 gap-5 pb-2 pt-3 sm:grid-cols-2">
                      <PortContract title="Inputs" ports={box.inputs} />
                      <PortContract title="Parameters" ports={box.params} />
                      <PortContract title="Outputs" ports={outputs} />
                      <div className="min-w-0">
                        <h3 className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                          Tools
                        </h3>
                        {box.tools.length > 0 ? (
                          <ul className="mt-2 grid gap-2 text-sm text-[var(--ui-ink-medium)]">
                            {box.tools.map((tool) => (
                              <li
                                key={tool.key}
                                className="min-w-0 break-words"
                              >
                                <code className="break-all text-[12px] text-[var(--ui-ink-strong)]">
                                  {tool.key}
                                </code>{" "}
                                · {tool.accessMode}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-[var(--ui-ink-faint)]">
                            None
                          </p>
                        )}
                      </div>
                    </div>
                  </details>
                </section>
              );
            })}
          </div>
        )}

        {activeIsFetchNextPageError && activeHasData ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--danger-border)] pt-4 text-sm text-[var(--danger)]"
          >
            <span>
              The next catalog page could not be loaded. Existing results are
              unchanged.
            </span>
            <Button type="button" variant="secondary" onClick={fetchNextPage}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry next page
            </Button>
          </div>
        ) : null}

        {activeHasNextPage && !activeIsFetchNextPageError ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="secondary"
              disabled={activeIsFetchingNextPage}
              onClick={fetchNextPage}
            >
              {activeIsFetchingNextPage
                ? "Loading more"
                : `Load ${Math.min(CATALOG_PAGE_SIZE, Math.max(0, (activeTotal ?? activeResults.length) - activeResults.length))} more`}
            </Button>
          </div>
        ) : null}
      </section>

      <WorkbenchCreateFlowDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialKind={createKind}
        preferredSurface={preferredSurface}
        pending={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input);
        }}
      />
    </div>
  );
}
