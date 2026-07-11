import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Network, Plus, RefreshCw } from "lucide-react";
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
import type { AiConnectorKind } from "@/lib/types";

const CATALOG_PAGE_SIZE = 24;

type WorkbenchCatalogMode = "flows" | "boxes";

export function WorkbenchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredSurface = searchParams.get("surface");
  const [catalogMode, setCatalogMode] = useState<WorkbenchCatalogMode>("flows");
  const [query, setQuery] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createKind, setCreateKind] = useState<AiConnectorKind>("functor");
  const flowsQuery = useQuery({
    queryKey: ["forge-workbench-flows"],
    queryFn: listWorkbenchFlows
  });
  const boxesQuery = useQuery({
    queryKey: ["forge-workbench-box-catalog"],
    queryFn: listWorkbenchBoxCatalog
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
    () => flowsQuery.data?.flows ?? [],
    [flowsQuery.data?.flows]
  );
  const boxes = useMemo(
    () => boxesQuery.data?.boxes ?? [],
    [boxesQuery.data?.boxes]
  );
  const filterOptions = useMemo<FacetedTokenOption[]>(() => {
    if (catalogMode === "boxes") {
      const categories = Array.from(
        new Set(
          boxes
            .map((box) => box.category)
            .filter((category): category is string => Boolean(category))
        )
      ).map((category) => ({
        id: `category:${category}`,
        label: category,
        description: "Node box category"
      }));
      const surfaces = Array.from(
        new Set(
          boxes
            .map((box) => box.surfaceId)
            .filter((surfaceId): surfaceId is string => Boolean(surfaceId))
        )
      ).map((surfaceId) => ({
        id: `surface:${surfaceId}`,
        label: surfaceId,
        description: "Source Forge surface"
      }));
      return [...categories, ...surfaces];
    }
    const byKind: FacetedTokenOption[] = [
      {
        id: "kind:functor",
        label: "Functor",
        description: "Single transformation flows"
      },
      {
        id: "kind:chat",
        label: "Chat",
        description: "Conversational flows with user input"
      }
    ];
    const surfaceOptions = Array.from(
      new Set(
        flows
          .map((flow) => flow.homeSurfaceId)
          .filter((entry): entry is string => Boolean(entry))
      )
    ).map((surfaceId) => ({
      id: `surface:${surfaceId}`,
      label: surfaceId,
      description: "Home surface"
    }));
    return [...byKind, ...surfaceOptions];
  }, [boxes, catalogMode, flows]);

  const filteredFlows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return flows.filter((flow) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          flow.title,
          flow.description,
          flow.kind,
          flow.homeSurfaceId ?? "",
          ...flow.graph.nodes.map((node) => node.data.label)
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesTokens = selectedOptionIds.every((token) => {
        if (token.startsWith("kind:")) {
          return flow.kind === token.replace("kind:", "");
        }
        if (token.startsWith("surface:")) {
          return flow.homeSurfaceId === token.replace("surface:", "");
        }
        return true;
      });
      return matchesQuery && matchesTokens;
    });
  }, [flows, query, selectedOptionIds]);

  const filteredBoxes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return boxes.filter((box) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          box.title,
          box.description,
          box.category,
          box.surfaceId,
          box.routePath,
          ...box.tags,
          ...box.inputs.map(
            (input) => `${input.label} ${input.key} ${input.kind}`
          ),
          ...(box.outputs ?? box.output ?? []).map(
            (output) => `${output.label} ${output.key} ${output.kind}`
          )
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesTokens = selectedOptionIds.every((token) => {
        if (token.startsWith("category:")) {
          return box.category === token.replace("category:", "");
        }
        if (token.startsWith("surface:")) {
          return box.surfaceId === token.replace("surface:", "");
        }
        return true;
      });
      return matchesQuery && matchesTokens;
    });
  }, [boxes, query, selectedOptionIds]);

  const activeResults = catalogMode === "flows" ? filteredFlows : filteredBoxes;
  const activeTotal = catalogMode === "flows" ? flows.length : boxes.length;
  const activeQuery = catalogMode === "flows" ? flowsQuery : boxesQuery;
  const visibleResults = activeResults.slice(0, visibleCount);

  useEffect(() => {
    setSelectedOptionIds([]);
    setVisibleCount(CATALOG_PAGE_SIZE);
  }, [catalogMode]);

  useEffect(() => {
    setVisibleCount(CATALOG_PAGE_SIZE);
  }, [query, selectedOptionIds]);

  function openCreateDialog(kind: AiConnectorKind) {
    setCreateKind(kind);
    setCreateDialogOpen(true);
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="workbench"
        title="Workbench"
        titleText="Workbench"
        description="Search and launch reusable Forge flows, then open a flow to edit its graph, tools, prompts, and outputs."
        badge={`${flows.length} flows`}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={() => openCreateDialog("functor")}
        >
          <Plus className="size-4" />
          New flow
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => openCreateDialog("chat")}
        >
          <Plus className="size-4" />
          New chat flow
        </Button>
      </div>

      <div
        role="group"
        aria-label="Workbench catalog"
        className="inline-flex w-full max-w-md rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1 sm:w-auto"
      >
        <button
          type="button"
          aria-pressed={catalogMode === "flows"}
          className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm transition sm:flex-none ${
            catalogMode === "flows"
              ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
          }`}
          onClick={() => setCatalogMode("flows")}
        >
          <Network className="size-4" />
          Flows
        </button>
        <button
          type="button"
          aria-pressed={catalogMode === "boxes"}
          className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm transition sm:flex-none ${
            catalogMode === "boxes"
              ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
              : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
          }`}
          onClick={() => setCatalogMode("boxes")}
        >
          <Boxes className="size-4" />
          Node boxes
        </button>
      </div>

      <FacetedTokenSearch
        title={catalogMode === "flows" ? "Flow search" : "Node box search"}
        description={
          catalogMode === "flows"
            ? "Filter by flow kind or surface, then open a flow to edit or run it."
            : "Filter reusable boxes by category or source surface, then inspect their typed contracts."
        }
        query={query}
        onQueryChange={setQuery}
        options={filterOptions}
        selectedOptionIds={selectedOptionIds}
        onSelectedOptionIdsChange={setSelectedOptionIds}
        resultSummary={`${activeResults.length} of ${activeTotal} ${catalogMode === "flows" ? "flows" : "node boxes"}`}
        placeholder={
          catalogMode === "flows"
            ? "Search flow title, description, nodes, or home surface"
            : "Search box title, route, tags, or typed ports"
        }
      />

      {activeQuery.isLoading ? (
        <LoadingState
          eyebrow="Workbench catalog"
          title={`Loading ${catalogMode === "flows" ? "flows" : "node boxes"}`}
          description="Reading the saved Workbench catalog from Forge."
        />
      ) : activeQuery.isError ? (
        <ErrorState
          eyebrow="Workbench catalog"
          error={activeQuery.error}
          onRetry={() => void activeQuery.refetch()}
        />
      ) : activeResults.length === 0 ? (
        <EmptyState
          eyebrow="Workbench catalog"
          title={
            activeTotal === 0
              ? `No ${catalogMode === "flows" ? "flows" : "node boxes"} available`
              : "No catalog matches"
          }
          description={
            activeTotal === 0
              ? catalogMode === "flows"
                ? "Create a guided flow to start building a reusable graph."
                : "Forge returned an empty node-box catalog. Retry after the source surfaces are available."
              : "Clear or change the current search and filters."
          }
          action={
            activeTotal === 0 && catalogMode === "flows" ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => openCreateDialog("functor")}
              >
                <Plus className="size-4" />
                Create flow
              </Button>
            ) : activeTotal === 0 && catalogMode === "boxes" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void boxesQuery.refetch()}
              >
                <RefreshCw className="size-4" />
                Retry catalog
              </Button>
            ) : undefined
          }
        />
      ) : catalogMode === "flows" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {(visibleResults as typeof filteredFlows).map((flow) => (
            <button
              key={flow.id}
              type="button"
              className="min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5 text-left transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-ring)]"
              onClick={() => navigate(`/workbench/${flow.id}`)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-[var(--ui-ink-strong)]">
                    {flow.title}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
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
              <div className="mt-4 flex min-w-0 flex-wrap gap-2 text-[12px] text-[var(--ui-ink-faint)]">
                <span className="min-w-0 break-words">
                  {flow.graph.nodes.length} nodes
                </span>
                <span className="min-w-0 break-words">
                  {flow.graph.edges.length} edges
                </span>
                {flow.homeSurfaceId ? (
                  <span className="min-w-0 break-words">
                    {flow.homeSurfaceId}
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(visibleResults as typeof filteredBoxes).map((box) => (
            <section
              key={box.id}
              className="min-w-0 rounded-lg border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5"
            >
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--ui-ink-strong)]">
                    {box.title}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {box.description || "No description available."}
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 py-1 text-[11px] text-[var(--ui-ink-soft)]">
                  {box.category || "Other"}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                    Inputs
                  </div>
                  <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
                    {box.inputs.length > 0
                      ? box.inputs
                          .slice(0, 4)
                          .map((input) => `${input.key}: ${input.kind}`)
                          .join(", ")
                      : "No typed inputs"}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase text-[var(--ui-ink-faint)]">
                    Outputs
                  </div>
                  <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
                    {(box.outputs ?? box.output ?? []).length > 0
                      ? (box.outputs ?? box.output ?? [])
                          .slice(0, 4)
                          .map((output) => `${output.key}: ${output.kind}`)
                          .join(", ")
                      : "No typed outputs"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex min-w-0 flex-wrap gap-2 text-[12px] text-[var(--ui-ink-faint)]">
                <span>{box.surfaceId}</span>
                <span className="min-w-0 break-all">{box.routePath}</span>
                {box.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!activeQuery.isLoading &&
      !activeQuery.isError &&
      visibleCount < activeResults.length ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setVisibleCount((current) => current + CATALOG_PAGE_SIZE)
            }
          >
            Show{" "}
            {Math.min(CATALOG_PAGE_SIZE, activeResults.length - visibleCount)}{" "}
            more
          </Button>
        </div>
      ) : null}

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
