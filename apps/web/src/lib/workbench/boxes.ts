import {
  getWorkbenchNodeCatalog,
  getWorkbenchNodeDefinition,
  listWorkbenchNodeDefinitions
} from "./registry.js";

export function listWorkbenchBoxDefinitions() {
  return listWorkbenchNodeDefinitions();
}

export function getWorkbenchBoxDefinition(boxId: string) {
  return getWorkbenchNodeDefinition(boxId);
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

export function listWorkbenchBoxCatalogEntries() {
  return getWorkbenchNodeCatalog();
}
