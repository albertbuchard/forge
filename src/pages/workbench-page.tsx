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

export function WorkbenchPage() {
  const shell = useForgeShell();

  const widgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Workbench",
      description: "Custom view with utility widgets.",
      defaultWidth: 12,
      defaultHeight: 1,
      removable: false,
      render: () => (
        <PageHero
          title="Workbench"
          titleText="Workbench"
          description="This is the first custom surface: add, remove, resize, and reorder utility widgets without touching the main routed pages."
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
      render: ({ compact }) => <TimeWidget compact={compact} />
    },
    {
      id: "weather",
      title: "Weather",
      description: "Location-based weather widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      render: ({ compact }) => <WeatherWidget compact={compact} />
    },
    {
      id: "mini-calendar",
      title: "Mini calendar",
      description: "Compact month view.",
      defaultWidth: 4,
      defaultHeight: 3,
      render: ({ compact }) => <MiniCalendarWidget compact={compact} />
    },
    {
      id: "spotify",
      title: "Spotify",
      description: "Pinned music link.",
      defaultWidth: 5,
      defaultHeight: 2,
      render: () => <SpotifyWidget surfaceId="workbench" />
    },
    {
      id: "quick-capture",
      title: "Quick capture",
      description: "Save a note or wiki page from a simple editor.",
      defaultWidth: 7,
      defaultHeight: 4,
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

  return <EditableSurface surfaceId="workbench" widgets={widgets} />;
}
