import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FacetedTokenSearch, type FacetedTokenOption } from "@/components/search/faceted-token-search";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { EntityBadge } from "@/components/ui/entity-badge";
import { createWorkbenchFlow, listWorkbenchFlows } from "@/lib/api";
import { getEntityKindForWorkbenchFlowKind } from "@/lib/entity-visuals";

export function WorkbenchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredSurface = searchParams.get("surface");
  const [query, setQuery] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const flowsQuery = useQuery({
    queryKey: ["forge-workbench-flows"],
    queryFn: listWorkbenchFlows
  });
  const createMutation = useMutation({
    mutationFn: (kind: "functor" | "chat") =>
      createWorkbenchFlow({
        title: kind === "chat" ? "New chat flow" : "New flow",
        description:
          kind === "chat"
            ? "Conversational workbench flow."
            : "Reusable workbench transformation flow.",
        kind,
        homeSurfaceId: preferredSurface
      }),
    onSuccess: ({ flow }) => {
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flows"] });
      navigate(`/workbench/${flow.id}`);
    }
  });

  const flows = flowsQuery.data?.flows ?? [];
  const filterOptions = useMemo<FacetedTokenOption[]>(() => {
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
  }, [flows]);

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
          onClick={() => void createMutation.mutateAsync("functor")}
        >
          New flow
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void createMutation.mutateAsync("chat")}
        >
          New chat flow
        </Button>
      </div>

      <FacetedTokenSearch
        title="Flow search"
        description="Filter by flow kind or surface, then open a flow to edit or run it."
        query={query}
        onQueryChange={setQuery}
        options={filterOptions}
        selectedOptionIds={selectedOptionIds}
        onSelectedOptionIdsChange={setSelectedOptionIds}
        resultSummary={`${filteredFlows.length} of ${flows.length} flows`}
        placeholder="Search flow title, description, nodes, or home surface"
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {filteredFlows.map((flow) => (
          <button
            key={flow.id}
            type="button"
            className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,28,46,0.92),rgba(10,16,29,0.96))] p-5 text-left transition hover:border-white/12 hover:bg-[linear-gradient(180deg,rgba(24,34,55,0.94),rgba(12,18,34,0.98))]"
            onClick={() => navigate(`/workbench/${flow.id}`)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-white">
                  {flow.title}
                </div>
                <div className="mt-1 line-clamp-2 text-sm leading-6 text-white/54">
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
            <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-white/44">
              <span>{flow.graph.nodes.length} nodes</span>
              <span>{flow.graph.edges.length} edges</span>
              {flow.homeSurfaceId ? <span>{flow.homeSurfaceId}</span> : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
