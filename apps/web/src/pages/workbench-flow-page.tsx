import { useNavigate, useParams } from "react-router-dom";
import { OpenInGraphButton } from "@/components/knowledge-graph/open-in-graph-button";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { useWorkbenchNodeCatalog } from "@/components/workbench/workbench-provider";
import { WorkbenchFlowEditor } from "@/components/workbench/workbench-flow-editor";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
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

  if (flowQuery.isLoading) {
    return (
      <LoadingState
        eyebrow="Workbench Flow"
        title="Loading flow"
        description="Preparing the Workbench graph editor."
      />
    );
  }

  if (flowQuery.isError || !flowQuery.data) {
    if (!flowQuery.data && !flowQuery.isError) {
      return (
        <EmptyState
          eyebrow="Workbench Flow"
          title="Flow unavailable"
          description="Forge could not find that flow."
        />
      );
    }
    return (
      <ErrorState eyebrow="Workbench Flow" error={flowQuery.error ?? null} />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind={flowQuery.data.flow.kind}
        title={flowQuery.data.flow.title}
        titleText={flowQuery.data.flow.title}
        description={
          flowQuery.data.flow.description ||
          "Inspect, run, and publish this Workbench flow."
        }
        badge={flowQuery.data.flow.kind}
        actions={
          <OpenInGraphButton
            entityType="workbench_flow"
            entityId={flowQuery.data.flow.id}
          />
        }
      />
      {settingsQuery.isError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[var(--ui-warning-soft)] px-4 py-3 text-sm text-[var(--warning)] sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Model settings are unavailable. The graph remains editable, but AI
            nodes cannot run until Forge reconnects.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void settingsQuery.refetch()}
          >
            Retry settings
          </Button>
        </div>
      ) : null}
      <WorkbenchFlowEditor
        flow={flowQuery.data.flow}
        boxes={boxes}
        modelConnections={(
          settingsQuery.data?.settings.modelSettings.connections ?? []
        ).map((connection) => ({
          id: connection.id,
          label: connection.label,
          provider: connection.provider,
          model: connection.model,
          baseUrl: connection.baseUrl
        }))}
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
