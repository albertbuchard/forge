import { useNavigate, useParams } from "react-router-dom";
import { useWorkbenchNodeCatalog } from "@/components/workbench/workbench-provider";
import { WorkbenchFlowEditor } from "@/components/workbench/workbench-flow-editor";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  useChatWorkbenchFlowMutation,
  useDeleteWorkbenchFlowMutation,
  useGetSettingsQuery,
  useGetWorkbenchFlowQuery,
  useRunWorkbenchFlowMutation,
  useUpdateWorkbenchFlowMutation
} from "@/store/api/forge-api";

export function WorkbenchFlowPage() {
  const params = useParams();
  const navigate = useNavigate();
  const flowId = params.flowId ?? "";
  const boxes = useWorkbenchNodeCatalog();

  const flowQuery = useGetWorkbenchFlowQuery(flowId, {
    skip: flowId.length === 0
  });
  const settingsQuery = useGetSettingsQuery();
  const [updateFlow] = useUpdateWorkbenchFlowMutation();
  const [deleteFlow] = useDeleteWorkbenchFlowMutation();
  const [runFlow] = useRunWorkbenchFlowMutation();
  const [chatFlow] = useChatWorkbenchFlowMutation();

  if (flowQuery.isLoading || settingsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading flow"
        description="Preparing the Workbench graph editor."
      />
    );
  }

  if (
    flowQuery.isError || settingsQuery.isError || !flowQuery.data
  ) {
    if (!flowQuery.data && !flowQuery.isError && !settingsQuery.isError) {
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
        error={flowQuery.error ?? settingsQuery.error ?? null}
      />
    );
  }

  return (
    <WorkbenchFlowEditor
      flow={flowQuery.data.flow}
      boxes={boxes}
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
        await updateFlow({ flowId, patch }).unwrap();
      }}
      onDelete={async () => {
        await deleteFlow(flowId).unwrap();
        navigate("/workbench");
      }}
      onRun={async (userInput, _conversationId, debug) => {
        await runFlow({
          flowId,
          input: { userInput, debug: Boolean(debug) }
        }).unwrap();
      }}
      onChat={async (userInput, _conversationId, debug) => {
        await chatFlow({
          flowId,
          input: { userInput, debug: Boolean(debug) }
        }).unwrap();
      }}
    />
  );
}
