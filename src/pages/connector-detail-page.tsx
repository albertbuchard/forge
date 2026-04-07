import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ConnectorGraphEditor } from "@/components/connectors/connector-graph-editor";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  chatAiConnector,
  deleteAiConnector,
  getAiConnector,
  getSettings,
  listForgeBoxCatalog,
  runAiConnector,
  updateAiConnector
} from "@/lib/api";

export function ConnectorDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connectorId = params.connectorId ?? "";

  const connectorQuery = useQuery({
    queryKey: ["forge-ai-connector", connectorId],
    queryFn: () => getAiConnector(connectorId),
    enabled: connectorId.length > 0
  });
  const boxesQuery = useQuery({
    queryKey: ["forge-box-catalog"],
    queryFn: listForgeBoxCatalog
  });
  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateAiConnector>[1]) =>
      updateAiConnector(connectorId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connector", connectorId] });
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connectors"] });
    }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteAiConnector(connectorId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connectors"] });
      navigate("/connectors");
    }
  });
  const runMutation = useMutation({
    mutationFn: (input: { userInput: string; conversationId?: string | null }) =>
      runAiConnector(connectorId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connector", connectorId] });
    }
  });
  const chatMutation = useMutation({
    mutationFn: (input: { userInput: string; conversationId?: string | null }) =>
      chatAiConnector(connectorId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-ai-connector", connectorId] });
    }
  });

  if (connectorQuery.isLoading || boxesQuery.isLoading || settingsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading connector"
        description="Preparing the connector graph editor."
      />
    );
  }

  if (
    connectorQuery.isError ||
    boxesQuery.isError ||
    settingsQuery.isError ||
    !connectorQuery.data
  ) {
    if (!connectorQuery.data && !connectorQuery.isError && !boxesQuery.isError && !settingsQuery.isError) {
      return (
        <EmptyState
          eyebrow="Connectors"
          title="Connector unavailable"
          description="Forge could not find that connector."
        />
      );
    }
    return (
      <ErrorState
        eyebrow="Connectors"
        error={
          connectorQuery.error ?? boxesQuery.error ?? settingsQuery.error ?? null
        }
      />
    );
  }

  return (
    <ConnectorGraphEditor
      connector={connectorQuery.data.connector}
      boxes={boxesQuery.data?.boxes ?? []}
      modelConnections={(settingsQuery.data?.settings.modelSettings.connections ?? []).map(
        (connection) => ({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          model: connection.model,
          baseUrl: connection.baseUrl
        })
      )}
      runs={connectorQuery.data.runs}
      onSave={async (patch) => {
        await updateMutation.mutateAsync(patch);
      }}
      onDelete={async () => {
        await deleteMutation.mutateAsync();
      }}
      onRun={async (userInput, conversationId) => {
        await runMutation.mutateAsync({ userInput, conversationId });
      }}
      onChat={async (userInput, conversationId) => {
        await chatMutation.mutateAsync({ userInput, conversationId });
      }}
    />
  );
}
