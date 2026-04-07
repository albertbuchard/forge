import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Plus } from "lucide-react";
import { AiProcessorWidget } from "../components/customization/ai-processor-widget";
import {
  EditableSurface,
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import {
  createAiProcessor,
  createAiProcessorLink,
  deleteAiProcessorLink,
  getSettings,
  getSurfaceAiProcessors,
  runAiProcessor,
  updateAiProcessor
} from "@/lib/api";
import type { AiProcessor, SurfaceProcessorGraphPayload } from "@/lib/types";

const SURFACE_ID = "workbench";

function processorWidgetId(processorId: string) {
  return `aiproc:${processorId}`;
}

export function WorkbenchPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [pendingSourceWidgetId, setPendingSourceWidgetId] = useState<string | null>(
    null
  );
  const [linkAccessMode, setLinkAccessMode] = useState<
    "read" | "write" | "read_write" | "exec"
  >("read");

  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings
  });
  const graphQuery = useQuery({
    queryKey: ["forge-surface-ai-processors", SURFACE_ID],
    queryFn: () => getSurfaceAiProcessors(SURFACE_ID)
  });

  const invalidateGraph = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["forge-surface-ai-processors", SURFACE_ID]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-settings"] })
    ]);
  };

  const createProcessorMutation = useMutation({
    mutationFn: () =>
      createAiProcessor({
        surfaceId: SURFACE_ID,
        title: "AI processor",
        promptFlow: "Summarize the provided context and produce the final output.",
        contextInput: "",
        agentIds: [],
        triggerMode: "manual",
        endpointEnabled: true
      }),
    onSuccess: invalidateGraph
  });

  const updateProcessorMutation = useMutation({
    mutationFn: ({
      processorId,
      patch
    }: {
      processorId: string;
      patch: Partial<AiProcessor>;
    }) => updateAiProcessor(processorId, patch),
    onSuccess: invalidateGraph
  });

  const runProcessorMutation = useMutation({
    mutationFn: ({
      processorId,
      input
    }: {
      processorId: string;
      input: string;
    }) => runAiProcessor(processorId, { input }),
    onSuccess: invalidateGraph
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
        surfaceId: SURFACE_ID,
        sourceWidgetId,
        targetProcessorId,
        accessMode: linkAccessMode,
        capabilityMode,
        metadata
      }),
    onSuccess: async () => {
      setPendingSourceWidgetId(null);
      await invalidateGraph();
    }
  });

  const deleteLinkMutation = useMutation({
    mutationFn: deleteAiProcessorLink,
    onSuccess: invalidateGraph
  });

  const agents = settingsQuery.data?.settings.agents ?? [];
  const graph: SurfaceProcessorGraphPayload | null = graphQuery.data?.graph ?? null;
  const processors = graph?.processors ?? [];
  const links = graph?.links ?? [];

  const baseWidgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Workbench",
      description: "Custom view with utility widgets and AI processors.",
      defaultWidth: 12,
      defaultHeight: 1,
      removable: false,
      processorCapability: {
        label: "Workbench summary",
        mode: "content",
        metadata: { source: "hero" }
      },
      render: () => (
        <PageHero
          title="Workbench"
          titleText="Workbench"
          description="This surface now supports utility widgets, AI processor widgets, and explicit widget-to-processor graph links."
          badge="custom view"
        />
      )
    },
    {
      id: "time",
      title: "Clock",
      description: "Live time widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      processorCapability: {
        label: "Time context",
        mode: "content",
        metadata: { widgetType: "time" }
      },
      render: ({ compact }) => <TimeWidget compact={compact} />
    },
    {
      id: "weather",
      title: "Weather",
      description: "Location-based weather widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      processorCapability: {
        label: "Weather context",
        mode: "content",
        metadata: { widgetType: "weather" }
      },
      render: ({ compact }) => <WeatherWidget compact={compact} />
    },
    {
      id: "mini-calendar",
      title: "Mini calendar",
      description: "Compact month view.",
      defaultWidth: 4,
      defaultHeight: 3,
      processorCapability: {
        label: "Calendar context",
        mode: "content",
        metadata: { widgetType: "mini-calendar" }
      },
      render: ({ compact }) => <MiniCalendarWidget compact={compact} />
    },
    {
      id: "spotify",
      title: "Spotify",
      description: "Pinned music link.",
      defaultWidth: 5,
      defaultHeight: 2,
      processorCapability: {
        label: "Spotify link",
        mode: "content",
        metadata: { widgetType: "spotify" }
      },
      render: () => <SpotifyWidget surfaceId={SURFACE_ID} />
    },
    {
      id: "quick-capture",
      title: "Quick capture",
      description: "Save a note or wiki page from a simple editor.",
      defaultWidth: 7,
      defaultHeight: 4,
      processorCapability: {
        label: "Quick capture actions",
        mode: "mcp",
        metadata: {
          widgetType: "quick-capture",
          noteEndpoint: "/api/v1/notes",
          wikiEndpoint: "/api/v1/wiki/pages"
        }
      },
      render: ({ compact }) => (
        <QuickCaptureWidget
          compact={compact}
          defaultUserId={
            shell.selectedUserIds[0] ?? shell.snapshot.users[0]?.id ?? null
          }
        />
      )
    }
  ];

  const processorWidgets: SurfaceWidgetDefinition[] = processors.map((processor) => ({
    id: processorWidgetId(processor.id),
    title: processor.title,
    description: "AI processor widget.",
    isProcessor: true,
    defaultWidth: 6,
    defaultHeight: 4,
    processorCapability: {
      label: processor.title,
      mode: "processor",
      metadata: {
        processorId: processor.id,
        runEndpoint: `/api/v1/aiproc/${processor.id}/run`
      }
    },
    render: ({ compact, editing }) => (
      <AiProcessorWidget
        processor={processor}
        agents={agents}
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
      />
    )
  }));

  const widgets = [...baseWidgets, ...processorWidgets];
  const widgetById = new Map(widgets.map((widget) => [widget.id, widget]));

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
      surfaceId={SURFACE_ID}
      widgets={widgets}
      selectedWidgetId={selectedWidgetId}
      linkedDescriptionsByWidgetId={linkedDescriptionsByWidgetId}
      onWidgetHandleClick={handleWidgetHandleClick}
      actions={
        <div className="flex flex-wrap items-center gap-2">
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
              : "Pick a widget handle, then pick a processor handle"}
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
        </div>
      }
    />
  );
}
