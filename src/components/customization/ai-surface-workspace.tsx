import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Plus } from "lucide-react";
import { AiProcessorWidget } from "@/components/customization/ai-processor-widget";
import {
  EditableSurface,
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import { Button } from "@/components/ui/button";
import {
  createAiProcessor,
  createAiProcessorLink,
  deleteAiProcessor,
  deleteAiProcessorLink,
  getSettings,
  getSurfaceAiProcessors,
  runAiProcessor,
  updateAiProcessor
} from "@/lib/api";
import type { AiProcessor, SurfaceProcessorGraphPayload } from "@/lib/types";

function processorWidgetId(processorId: string) {
  return `aiproc:${processorId}`;
}

export function AiSurfaceWorkspace({
  surfaceId,
  baseWidgets,
  actions
}: {
  surfaceId: string;
  baseWidgets: SurfaceWidgetDefinition[];
  actions?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [pendingSourceWidgetId, setPendingSourceWidgetId] = useState<
    string | null
  >(null);
  const [linkAccessMode, setLinkAccessMode] = useState<
    "read" | "write" | "read_write" | "exec"
  >("read");

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });
  const graphQuery = useQuery({
    queryKey: ["forge-surface-ai-processors", surfaceId],
    queryFn: () => getSurfaceAiProcessors(surfaceId)
  });

  const patchGraphCache = (
    updater: (current: SurfaceProcessorGraphPayload) => SurfaceProcessorGraphPayload
  ) => {
    queryClient.setQueryData(
      ["forge-surface-ai-processors", surfaceId],
      (
        current:
          | {
              graph: SurfaceProcessorGraphPayload;
            }
          | undefined
      ) => ({
        graph: updater(
          current?.graph ?? {
            surfaceId,
            processors: [],
            links: []
          }
        )
      })
    );
  };

  const createProcessorMutation = useMutation({
    mutationFn: () =>
      createAiProcessor({
        surfaceId,
        title: "AI processor",
        promptFlow:
          "Read the linked inputs, execute the prompt flow, and return the final output only.",
        contextInput: "",
        agentIds: [],
        agentConfigs: [],
        triggerMode: "manual",
        endpointEnabled: true
      }),
    onSuccess: ({ processor }) => {
      patchGraphCache((current) => ({
        ...current,
        processors: [...current.processors, processor]
      }));
    }
  });

  const updateProcessorMutation = useMutation({
    mutationFn: ({
      processorId,
      patch
    }: {
      processorId: string;
      patch: Partial<AiProcessor>;
    }) => updateAiProcessor(processorId, patch),
    onSuccess: ({ processor }) => {
      patchGraphCache((current) => ({
        ...current,
        processors: current.processors.map((entry) =>
          entry.id === processor.id ? processor : entry
        )
      }));
    }
  });

  const runProcessorMutation = useMutation({
    mutationFn: ({
      processorId,
      input
    }: {
      processorId: string;
      input: string;
    }) => runAiProcessor(processorId, { input }),
    onSuccess: ({ processor }) => {
      patchGraphCache((current) => ({
        ...current,
        processors: current.processors.map((entry) =>
          entry.id === processor.id ? processor : entry
        )
      }));
    }
  });

  const deleteProcessorMutation = useMutation({
    mutationFn: deleteAiProcessor,
    onSuccess: ({ processor }) => {
      patchGraphCache((current) => ({
        ...current,
        processors: current.processors.filter((entry) => entry.id !== processor.id),
        links: current.links.filter((entry) => entry.targetProcessorId !== processor.id)
      }));
    }
  });

  const createLinkMutation = useMutation({
    mutationFn: ({
      sourceWidgetId,
      targetProcessorId,
      metadata,
      capabilityMode
    }: {
      sourceWidgetId: string;
      targetProcessorId: string;
      metadata: Record<string, unknown>;
      capabilityMode: "content" | "tool" | "mcp" | "processor";
    }) =>
      createAiProcessorLink({
        surfaceId,
        sourceWidgetId,
        targetProcessorId,
        accessMode: linkAccessMode,
        capabilityMode,
        metadata
      }),
    onSuccess: ({ link }) => {
      patchGraphCache((current) => ({
        ...current,
        links: [...current.links, link]
      }));
      setPendingSourceWidgetId(null);
    }
  });

  const deleteLinkMutation = useMutation({
    mutationFn: deleteAiProcessorLink,
    onSuccess: ({ link }) => {
      patchGraphCache((current) => ({
        ...current,
        links: current.links.filter((entry) => entry.id !== link.id)
      }));
    }
  });

  const agents = settingsQuery.data?.settings.agents ?? [];
  const modelConnections =
    settingsQuery.data?.settings.modelSettings.connections ?? [];
  const graph: SurfaceProcessorGraphPayload | null = graphQuery.data?.graph ?? null;
  const processors = graph?.processors ?? [];
  const links = graph?.links ?? [];

  const processorWidgets = useMemo<SurfaceWidgetDefinition[]>(
    () =>
      processors.map((processor) => ({
        id: processorWidgetId(processor.id),
        title: processor.title,
        description: "AI processor widget.",
        isProcessor: true,
        defaultWidth: 12,
        defaultHeight: 8,
        minWidth: 6,
        minHeight: 6,
        maxHeight: 12,
        defaultPlacement: "top",
        autoSizeHeight: false,
        processorCapability: {
          label: processor.title,
          mode: "processor",
          metadata: {
            processorId: processor.id,
            slug: processor.slug,
            runEndpoint: `/api/v1/aiproc/${processor.slug}/run`
          }
        },
        render: ({ compact, editing }) => (
          <AiProcessorWidget
            key={`${processor.id}:${processor.updatedAt}`}
            processor={processor}
            agents={agents}
            modelConnections={modelConnections}
            editing={editing}
            compact={compact}
            onSave={async (patch: Partial<AiProcessor>) => {
              await updateProcessorMutation.mutateAsync({
                processorId: processor.id,
                patch
              });
            }}
            onRun={async (input: string) => {
              await runProcessorMutation.mutateAsync({
                processorId: processor.id,
                input
              });
            }}
            onDelete={async () => {
              await deleteProcessorMutation.mutateAsync(processor.id);
              setSelectedWidgetId((current) =>
                current === processorWidgetId(processor.id) ? null : current
              );
            }}
          />
        )
      })),
    [
      agents,
      modelConnections,
      processors,
      deleteProcessorMutation,
      runProcessorMutation,
      updateProcessorMutation
    ]
  );

  const widgets = useMemo(
    () => [...baseWidgets, ...processorWidgets],
    [baseWidgets, processorWidgets]
  );
  const widgetById = useMemo(
    () => new Map(widgets.map((widget) => [widget.id, widget])),
    [widgets]
  );

  const linkedDescriptionsByWidgetId = useMemo(() => {
    const output: Record<string, string[]> = {};
    for (const processor of processors) {
      const widgetId = processorWidgetId(processor.id);
      if (selectedWidgetId !== widgetId) {
        continue;
      }
      output[widgetId] = links
        .filter((link) => link.targetProcessorId === processor.id)
        .map((link) => {
          const source = widgetById.get(link.sourceWidgetId);
          return `${source?.title ?? link.sourceWidgetId} -> ${link.capabilityMode} (${link.accessMode})`;
        });
    }
    return output;
  }, [links, processors, selectedWidgetId, widgetById]);

  function handleWidgetHandleClick(definition: SurfaceWidgetDefinition) {
    setSelectedWidgetId(definition.id);
    if (definition.isProcessor) {
      if (pendingSourceWidgetId && pendingSourceWidgetId !== definition.id) {
        const sourceDefinition = widgetById.get(pendingSourceWidgetId);
        const processorId = definition.id.replace(/^aiproc:/, "");
        if (!sourceDefinition?.processorCapability) {
          return;
        }
        void createLinkMutation.mutateAsync({
          sourceWidgetId: pendingSourceWidgetId,
          targetProcessorId: processorId,
          metadata: sourceDefinition.processorCapability.metadata ?? {},
          capabilityMode: sourceDefinition.processorCapability.mode
        });
      }
      return;
    }
    setPendingSourceWidgetId(definition.id);
  }

  return (
    <EditableSurface
      surfaceId={surfaceId}
      widgets={widgets}
      selectedWidgetId={selectedWidgetId}
      linkedDescriptionsByWidgetId={linkedDescriptionsByWidgetId}
      onWidgetHandleClick={handleWidgetHandleClick}
      actions={
        <>
          {actions}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            pending={createProcessorMutation.isPending}
            pendingLabel="Adding processor"
            onClick={() => void createProcessorMutation.mutateAsync()}
          >
            <Plus className="size-4" />
            Add AI processor
          </Button>
          <div className="flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-2 text-[12px] text-white/60">
            <Cpu className="size-3.5" />
            {pendingSourceWidgetId
              ? `Connecting ${widgetById.get(pendingSourceWidgetId)?.title ?? pendingSourceWidgetId}`
              : "Click a widget port, then a processor port"}
          </div>
          <select
            value={linkAccessMode}
            onChange={(event) =>
              setLinkAccessMode(
                event.target.value as "read" | "write" | "read_write" | "exec"
              )
            }
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white"
          >
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="read_write">read/write</option>
            <option value="exec">exec</option>
          </select>
          {selectedWidgetId?.startsWith("aiproc:") ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                !links.some(
                  (link) =>
                    link.targetProcessorId ===
                    selectedWidgetId.replace(/^aiproc:/, "")
                )
              }
              pending={deleteLinkMutation.isPending}
              pendingLabel="Removing link"
              onClick={() => {
                const firstLink = links.find(
                  (link) =>
                    link.targetProcessorId ===
                    selectedWidgetId.replace(/^aiproc:/, "")
                );
                if (firstLink) {
                  void deleteLinkMutation.mutateAsync(firstLink.id);
                }
              }}
            >
              Remove first link
            </Button>
          ) : null}
        </>
      }
    />
  );
}
