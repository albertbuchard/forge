import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import type { SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";

const SURFACE_ID = "workbench";

export function WorkbenchPage() {
  const shell = useForgeShell();

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
          description="This surface supports utility widgets, AI processor widgets, and explicit widget-to-processor graph links."
          badge="surface runtime"
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

  return <AiSurfaceWorkspace surfaceId={SURFACE_ID} baseWidgets={baseWidgets} />;
}
