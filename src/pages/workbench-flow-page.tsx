import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { WorkbenchFlowEditor } from "@/components/workbench/workbench-flow-editor";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  chatWorkbenchFlow,
  deleteWorkbenchFlow,
  getSettings,
  getWorkbenchFlow,
  listWorkbenchBoxCatalog,
  runWorkbenchFlow,
  updateWorkbenchFlow
} from "@/lib/api";

export function WorkbenchFlowPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const flowId = params.flowId ?? "";

  const flowQuery = useQuery({
    queryKey: ["forge-workbench-flow", flowId],
    queryFn: () => getWorkbenchFlow(flowId),
    enabled: flowId.length > 0
  });
  const boxesQuery = useQuery({
    queryKey: ["forge-workbench-boxes"],
    queryFn: listWorkbenchBoxCatalog
  });
  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateWorkbenchFlow>[1]) =>
      updateWorkbenchFlow(flowId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flow", flowId] });
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flows"] });
    }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkbenchFlow(flowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flows"] });
      navigate("/workbench");
    }
  });
  const runMutation = useMutation({
    mutationFn: (input: { userInput: string; debug: boolean }) =>
      runWorkbenchFlow(flowId, { userInput: input.userInput, debug: input.debug }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flow", flowId] });
    }
  });
  const chatMutation = useMutation({
    mutationFn: (input: { userInput: string; debug: boolean }) =>
      chatWorkbenchFlow(flowId, { userInput: input.userInput, debug: input.debug }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forge-workbench-flow", flowId] });
    }
  });

  if (flowQuery.isLoading || boxesQuery.isLoading || settingsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading flow"
        description="Preparing the Workbench graph editor."
      />
    );
  }

  if (
    flowQuery.isError ||
    boxesQuery.isError ||
    settingsQuery.isError ||
    !flowQuery.data
  ) {
    if (!flowQuery.data && !flowQuery.isError && !boxesQuery.isError && !settingsQuery.isError) {
      return (
        <EmptyState
          eyebrow="Workbench"
          title="Flow unavailable"
          description="Forge could not find that flow."
        />
      );
    }
    return (
      <ErrorState
        eyebrow="Workbench"
        error={flowQuery.error ?? boxesQuery.error ?? settingsQuery.error ?? null}
      />
    );
  }

  return (
    <WorkbenchFlowEditor
      flow={flowQuery.data.flow}
      boxes={boxesQuery.data!.boxes}
      modelConnections={(settingsQuery.data!.settings.modelSettings.connections ?? []).map(
        (connection) => ({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          model: connection.model,
          baseUrl: connection.baseUrl
        })
      )}
      runs={flowQuery.data.runs}
      onSave={async (patch) => {
        await updateMutation.mutateAsync(patch);
      }}
      onDelete={async () => {
        await deleteMutation.mutateAsync();
      }}
      onRun={async (userInput, _conversationId, debug) => {
        await runMutation.mutateAsync({ userInput, debug: Boolean(debug) });
      }}
      onChat={async (userInput, _conversationId, debug) => {
        await chatMutation.mutateAsync({ userInput, debug: Boolean(debug) });
      }}
    />
  );
}
