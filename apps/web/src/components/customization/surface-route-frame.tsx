import type { ReactNode } from "react";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import type { SurfaceWidgetDefinition } from "@/components/customization/editable-surface";

export function SurfaceRouteFrame({
  surfaceId,
  title,
  description,
  children
}: {
  surfaceId: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const baseWidgets: SurfaceWidgetDefinition[] = [
    {
      id: "main",
      title,
      description,
      defaultWidth: 12,
      defaultHeight: 8,
      minWidth: 2,
      minHeight: 2,
      removable: false,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      defaultDensity: "comfortable",
      processorCapability: {
        label: `${title} content`,
        mode: "content",
        metadata: {
          surfaceId,
          title
        }
      },
      render: () => <div className="min-h-0">{children}</div>
    }
  ];

  return <AiSurfaceWorkspace surfaceId={surfaceId} baseWidgets={baseWidgets} />;
}
