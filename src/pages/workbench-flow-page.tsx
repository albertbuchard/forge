import { useNavigate, useParams } from "react-router-dom";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { PageHero } from "@/components/shell/page-hero";
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
        eyebrow="Workbench Flow"
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
          eyebrow="Workbench Flow"
          title="Flow unavailable"
          description="Forge could not find that flow."
        />
      );
    }
    return (
      <ErrorState
        eyebrow="Workbench Flow"
        error={flowQuery.error ?? settingsQuery.error ?? null}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind={flowQuery.data.flow.kind}
        title={flowQuery.data.flow.title}
        titleText={flowQuery.data.flow.title}
        description={
          flowQuery.data.flow.description || "Inspect, run, and publish this Workbench flow."
        }
        badge={flowQuery.data.flow.kind}
        actions={
          <OpenInGraphButton
            entityType="workbench_flow"
            entityId={flowQuery.data.flow.id}
          />
        }
      />
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
        onRun={async (input) => {
          await runFlow({
            flowId,
            input
          }).unwrap();
        }}
        onChat={async (input) => {
          await chatFlow({
            flowId,
            input
          }).unwrap();
        }}
      />
    </div>
  );
}
