import boxDefinitions from "@/lib/workbench/box-definitions.json";
import type {
  ForgeBoxCatalogEntry,
  ForgeBoxSnapshot
} from "@/lib/types";

export type WorkbenchMountedBox = {
  boxId: string;
  surfaceId: string | null;
  routePath: string | null;
  mountedAt: string;
};

const DEFINITIONS = boxDefinitions as ForgeBoxCatalogEntry[];

export function listWorkbenchBoxDefinitions() {
  return DEFINITIONS;
}

export function getWorkbenchBoxDefinition(boxId: string) {
  return DEFINITIONS.find((definition) => definition.boxId === boxId) ?? null;
}

export function getWorkbenchBoxDefinitionForSurfaceWidget(
  surfaceId: string,
  widgetId: string
) {
  return getWorkbenchBoxDefinition(`surface:${surfaceId}:${widgetId}`);
}

export function getWorkbenchBoxDefinitionForRouteMain(surfaceId: string) {
  return getWorkbenchBoxDefinition(`surface:${surfaceId}:main`);
}

export function buildFallbackWorkbenchSnapshot(
  boxId: string,
  label: string
): ForgeBoxSnapshot {
  return {
    boxId,
    label,
    capturedAt: new Date().toISOString(),
    contentText: `${label}\nThis box is registered but does not expose a specialized server snapshot yet.`,
    contentJson: null,
    tools: []
  };
}
