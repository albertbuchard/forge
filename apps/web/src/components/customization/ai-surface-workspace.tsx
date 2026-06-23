import type { ReactNode } from "react";
import {
  EditableSurface,
  type SurfaceWidgetDefinition
} from "@/components/customization/editable-surface";
import type { SurfaceLayoutPayload } from "@/lib/types";
import { Workflow } from "lucide-react";
import { Link } from "react-router-dom";

export function AiSurfaceWorkspace({
  surfaceId,
  baseWidgets,
  actions,
  normalizeLayout
}: {
  surfaceId: string;
  baseWidgets: SurfaceWidgetDefinition[];
  actions?: ReactNode;
  normalizeLayout?: (layout: SurfaceLayoutPayload) => SurfaceLayoutPayload;
}) {
  return (
    <EditableSurface
      surfaceId={surfaceId}
      widgets={baseWidgets}
      normalizeLayout={normalizeLayout}
      actions={
        <>
          {actions}
          <Link
            to={`/workbench?surface=${encodeURIComponent(surfaceId)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] px-2.5 text-[12px] font-medium text-[var(--ui-ink-medium)] backdrop-blur-xl transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
          >
            <Workflow className="size-3.5" />
            <span className="hidden sm:inline">Workbench</span>
          </Link>
        </>
      }
    />
  );
}
