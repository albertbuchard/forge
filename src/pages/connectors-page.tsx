import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { createAiConnector, listAiConnectors } from "@/lib/api";

export function ConnectorsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredSurface = searchParams.get("surface");
  const connectorsQuery = useQuery({
    queryKey: ["forge-ai-connectors"],
    queryFn: listAiConnectors
  });
  const createMutation = useMutation({
    mutationFn: (kind: "functor" | "chat") =>
      createAiConnector({
        title: kind === "chat" ? "New chat connector" : "New functor",
        description:
          kind === "chat"
            ? "Conversational connector graph."
            : "Single transformation connector graph.",
        kind,
        homeSurfaceId: preferredSurface
      }),
    onSuccess: ({ connector }) => {
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connectors"] });
      navigate(`/connectors/${connector.id}`);
    }
  });

  const connectors = connectorsQuery.data?.connectors ?? [];

  return (
    <div className="grid gap-6">
      <PageHero
        title="AI connectors"
        titleText="AI connectors"
        description="Global graph-based connectors that can pull from Forge boxes, run models, and publish outputs through the API."
        badge="graph runtime"
      />

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary"
          onClick={() => void createMutation.mutateAsync("functor")}
        >
          Create functor
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void createMutation.mutateAsync("chat")}
        >
          Create chat connector
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            type="button"
            className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5 text-left transition hover:bg-white/[0.05]"
            onClick={() => navigate(`/connectors/${connector.id}`)}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-white">{connector.title}</div>
                <div className="mt-1 text-sm text-white/54">
                  {connector.description || "No description yet."}
                </div>
              </div>
              <div className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/56">
                {connector.kind}
              </div>
            </div>
            <div className="mt-4 text-[12px] text-white/46">
              {connector.graph.nodes.length} nodes · {connector.graph.edges.length} edges
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
