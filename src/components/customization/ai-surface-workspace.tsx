import type { ReactNode } from "react";
import {
  EditableSurface,
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import { Workflow } from "lucide-react";
import { Link } from "react-router-dom";

export function AiSurfaceWorkspace({
  surfaceId,
  baseWidgets,
  actions
}: {
  surfaceId: string;
  baseWidgets: SurfaceWidgetDefinition[];
  actions?: ReactNode;
}) {
  return (
    <EditableSurface
      surfaceId={surfaceId}
      widgets={baseWidgets}
      actions={
        <>
          {actions}
          <Link
            to={`/connectors?surface=${encodeURIComponent(surfaceId)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-[rgba(32,40,70,0.78)] px-2.5 text-[12px] font-medium text-white/78 backdrop-blur-xl transition hover:border-white/16 hover:bg-[rgba(40,49,82,0.9)] hover:text-white"
          >
            <Workflow className="size-3.5" />
            <span className="hidden sm:inline">Connectors</span>
          </Link>
        </>
      }
    />
  );
}
